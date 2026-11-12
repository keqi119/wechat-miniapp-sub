import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectionDay,collectionLevel,collectionBillFact,collectionSummary} from '../src/collections/facts';

const order={id:'order',customerId:'customer'},today='2026-10-31';
const bill=(changes:any={})=>({id:'bill',orderId:order.id,customerId:order.customerId,type:'SUBSCRIPTION',status:'PENDING',amount:10000,paidAmount:0,dueDate:new Date('2026-10-30'),payments:[],...changes});
const payment=(changes:any={})=>({id:'payment',billId:'bill',customerId:'customer',revision:0,status:'SUCCEEDED',amount:10000,providerTransactionId:'synthetic-verified-'+(changes.id??'payment'),reconciliationRequired:false,refunds:[],...changes});
const refund=(changes:any={})=>({id:'refund',paymentId:'payment',customerId:'customer',status:'SUCCEEDED',amount:10000,...changes});

test('collection dates use Shanghai midnight and retain the five original day bands',()=>{
 assert.equal(collectionDay(new Date('2026-10-30T15:59:59.999Z')),'2026-10-30');assert.equal(collectionDay(new Date('2026-10-30T16:00:00Z')),today);
 for(const [days,level]of [[0,null],[1,'D1'],[3,'D1'],[4,'D2'],[7,'D2'],[8,'D3'],[15,'D3'],[16,'D4'],[30,'D4'],[31,'D5']]as const)assert.equal(collectionLevel(days),level);
 assert.throws(()=>collectionLevel(-1));assert.throws(()=>collectionDay(new Date('invalid')));
});
test('only published pending obligations produce overdue debt; neither today nor unissued bills are overdue',()=>{
 const original=bill(),before=JSON.stringify(original),fact=collectionBillFact(original,order,today);
 assert.equal(fact.overdueDays,1);assert.equal(fact.confirmedOverdueAmount,10000);assert.equal(fact.level,'D1');assert.equal(fact.settled,false);assert.deepEqual(fact.blockers,[]);assert.equal(JSON.stringify(original),before);
 for(const status of ['DRAFT','REVIEWED','VOID'])assert.equal(collectionBillFact(bill({status}),order,today).confirmedOverdueAmount,0);
 for(const dueDate of ['2026-10-31','2026-11-01'])assert.equal(collectionBillFact(bill({dueDate}),order,today).confirmedOverdueAmount,0);
 const partial=collectionBillFact(bill({paidAmount:2500,payments:[payment({amount:2500})]}),order,today);assert.equal(partial.confirmedOverdueAmount,7500);assert.deepEqual(partial.blockers,[]);
});
test('completed refunds do not manufacture new receivables and unresolved reconciliation prevents settlement',()=>{
 for(const amount of [2500,10000]){const fact=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment({refunds:[refund({amount})]})]}),order,today);assert.equal(fact.confirmedOverdueAmount,0);assert.equal(fact.settled,true);assert.deepEqual(fact.blockers,[]);}
 const double=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment(),payment({id:'extra',refunds:[refund({paymentId:'extra'})]})]}),order,today);assert.equal(double.settled,true);
 const unresolved=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment({reconciliationRequired:true,refunds:[refund()]})]}),order,today);assert.equal(unresolved.settled,false);assert.ok(unresolved.blockers.includes('RECONCILIATION_REQUIRED'));
 const noReceipt=collectionBillFact(bill({status:'PAID',paidAmount:10000}),order,today);assert.equal(noReceipt.settled,false);assert.ok(noReceipt.blockers.includes('RECEIPT_MISMATCH'));
});
test('unknown cash, wrong ownership and invalid totals are explicit blockers rather than zero debt',()=>{
 for(const change of [{payments:[payment({status:'CREATING'})]},{payments:[payment({status:'PENDING'})]},{payments:[payment({providerTransactionId:null})]},{payments:[payment({billId:'other'})]},{payments:[payment({customerId:'other'})]},{payments:[payment({refunds:[refund({paymentId:'other'})]})]},{payments:[payment({refunds:[refund({amount:10001})]})]},{paidAmount:10001},{amount:1.5},{payments:[payment({refunds:[refund({status:'PROCESSING'})]})]}]){const fact=collectionBillFact(bill(change),order,today);assert.ok(fact.blockers.length,JSON.stringify(change));assert.equal(fact.confirmedOverdueAmount,null);assert.equal(fact.settled,false);}
 assert.throws(()=>collectionBillFact(bill({orderId:'other'}),order,today));assert.throws(()=>collectionBillFact(bill({customerId:'other'}),order,today));assert.throws(()=>collectionBillFact(bill({dueDate:'2026-02-30'}),order,today));
});
test('a cleared VOID receipt is settled but retained cash and duplicate unpaid receipts need reconciliation',()=>{
 assert.equal(collectionBillFact(bill({status:'VOID',payments:[payment({refunds:[refund()]})]}),order,today).settled,true);
 assert.ok(collectionBillFact(bill({status:'VOID',payments:[payment()]}),order,today).blockers.includes('RECEIPT_MISMATCH'));
 assert.ok(collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment(),payment({id:'extra'})]}),order,today).blockers.includes('RECEIPT_MISMATCH'));
});
test('collection preview freezes ordered facts and separates blocked bills from confirmed amounts',()=>{
 const rows=[bill({id:'b'}),bill({id:'a',amount:30000,dueDate:'2026-09-30'}),bill({id:'c',payments:[payment({billId:'c',status:'PENDING'})]})],original=JSON.stringify(rows),summary=collectionSummary(order,rows,today);
 assert.equal(summary.totalOverdueAmount,40000);assert.equal(summary.maxOverdueDays,31);assert.equal(summary.level,'D5');assert.deepEqual(summary.blockedBillIds,['c']);assert.deepEqual(summary.overdueBillIds,['a','b']);assert.equal(summary.canClose,false);
 assert.equal(summary.sourceHash,collectionSummary(order,[...rows].reverse(),today).sourceHash);assert.notEqual(summary.sourceHash,collectionSummary(order,rows,'2026-11-01').sourceHash);assert.equal(JSON.stringify(rows),original);
 const settled=collectionSummary(order,[bill({status:'PAID',paidAmount:10000,payments:[payment()]})],today,['bill']);assert.equal(settled.canClose,true);
 assert.equal(collectionSummary(order,[bill({dueDate:'2026-11-01'})],today,['bill']).canClose,false,'A linked unpaid bill cannot be closed merely because its due date was extended');
 assert.throws(()=>collectionSummary(order,rows,today,['missing']));
});
test('aggregate cents never exceed storage range or accept repeated bill identities',()=>{
 assert.throws(()=>collectionSummary(order,[bill({id:'a',amount:2147483647}),bill({id:'b',amount:1})],today));assert.throws(()=>collectionSummary(order,[bill(),bill()],today));
});
