import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectionDay,collectionBillFact,collectionSummary} from '../src/collections/facts';
const order={id:'order',customerId:'customer'},today='2026-10-31';
const payment=(extra:any={})=>({id:'payment',billId:'bill',customerId:'customer',revision:0,status:'SUCCEEDED',amount:10000,providerTransactionId:'channel-'+(extra.id??'payment'),reconciliationRequired:false,refunds:[],...extra});
const refund=(extra:any={})=>({id:'refund',paymentId:'payment',customerId:'customer',status:'SUCCEEDED',amount:10000,providerRefundId:null,...extra});
const bill=(extra:any={})=>({id:'bill',orderId:'order',customerId:'customer',type:'SUBSCRIPTION',status:'PENDING',amount:10000,paidAmount:0,dueDate:'2026-10-30',payments:[],...extra});

test('actual terminal payment and refund states are distinguished from unknown or still processing cash',()=>{
 for(const status of ['FAILED','CLOSED']){const fact=collectionBillFact(bill({payments:[payment({status,providerTransactionId:null})]}),order,today);assert.equal(fact.confirmedOverdueAmount,10000);assert.deepEqual(fact.blockers,[]);}
 for(const status of ['FAILED','REJECTED']){const fact=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment({refunds:[refund({status})]})]}),order,today);assert.equal(fact.settled,true);}
 for(const status of ['PENDING_APPROVAL','PROCESSING','UNKNOWN']){const fact=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment({refunds:[refund({status})]})]}),order,today);assert.equal(fact.confirmedOverdueAmount,null);assert.equal(fact.settled,false);assert.ok(fact.blockers.length);}
 for(const status of ['UNKNOWN','SUCCEEDED_BUT_UNVERIFIED'])assert.equal(collectionBillFact(bill({payments:[payment({status})]}),order,today).confirmedOverdueAmount,null);
});
test('missing nested facts or reconciliation flags cannot become an empty trusted receipt set',()=>{
 for(const changes of [{payments:undefined},{payments:null},{payments:[payment({refunds:undefined})]},{payments:[payment({refunds:null})]},{payments:[payment({reconciliationRequired:undefined})]},{payments:[payment({revision:-1})]}]){const fact=collectionBillFact(bill(changes),order,today);assert.equal(fact.confirmedOverdueAmount,null);assert.equal(fact.settled,false);assert.ok(fact.blockers.length);}
});
test('duplicate rows and wrong refund ownership do not double-count verified cash',()=>{
 for(const payments of [[payment(),payment()],[payment(),payment({id:'other',providerTransactionId:'channel-payment'})],[payment({refunds:[refund(),refund()]})],[payment({refunds:[refund({id:'r1',amount:2000,providerRefundId:'same-refund'}),refund({id:'r2',amount:2000,providerRefundId:'same-refund'})]})],[payment({refunds:[refund({customerId:'foreign'})]})],[payment({status:'FAILED',refunds:[refund()]})]]){const fact=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments}),order,today);assert.equal(fact.settled,false);assert.equal(fact.confirmedOverdueAmount,null);assert.ok(fact.blockers.length);}
});
test('an incomplete nested row is frozen as unknown and cannot share a trusted empty-source hash',()=>{
 const empty=collectionSummary(order,[bill()],today),missing=collectionSummary(order,[bill({payments:[null]})],today);assert.notEqual(empty.sourceHash,missing.sourceHash);assert.deepEqual(missing.blockedBillIds,['bill']);
 const normal=bill({status:'PAID',paidAmount:10000,payments:[payment()]}),broken=bill({status:'PAID',paidAmount:10000,payments:[payment({refunds:[null]})]});assert.notEqual(collectionSummary(order,[normal],today).sourceHash,collectionSummary(order,[broken],today).sourceHash);
});
test('cash identifiers and provider transaction references cannot be reused across different bills of one order',()=>{
 const first=bill({status:'PAID',paidAmount:10000,payments:[payment()]}),second=bill({id:'second',status:'PAID',paidAmount:10000,payments:[payment({billId:'second'})]});assert.throws(()=>collectionSummary(order,[first,second],today));second.payments=[payment({id:'other',billId:'second',providerTransactionId:'channel-payment'})];assert.throws(()=>collectionSummary(order,[first,second],today));
});
test('partial pending receipts reconcile net cash without turning a refund into another obligation',()=>{
 const valid=collectionBillFact(bill({paidAmount:2500,payments:[payment({amount:2500}),payment({id:'returned-extra',refunds:[refund({paymentId:'returned-extra'})]})]}),order,today);assert.equal(valid.confirmedOverdueAmount,7500);
 const refundedPartial=collectionBillFact(bill({paidAmount:2500,payments:[payment({amount:2500,refunds:[refund({amount:2500})]})]}),order,today);assert.equal(refundedPartial.confirmedOverdueAmount,null);assert.ok(refundedPartial.blockers.includes('RECEIPT_MISMATCH'));
 const zero=collectionBillFact(bill({status:'PAID',amount:0,paidAmount:0}),order,today);assert.equal(zero.settled,true);assert.equal(zero.confirmedOverdueAmount,0);
});
test('cash arithmetic uses exact cents including cumulative refund limits and invalid primitive amounts',()=>{
 for(const value of [-1,NaN,Infinity,2147483648,'10000']){const fact=collectionBillFact(bill({amount:value}),order,today);assert.equal(fact.confirmedOverdueAmount,null);assert.ok(fact.blockers.length);}
 for(const amount of [0,-1,1.5,2147483648])assert.ok(collectionBillFact(bill({payments:[payment({amount})]}),order,today).blockers.length);
 const over=collectionBillFact(bill({status:'PAID',paidAmount:10000,payments:[payment({refunds:[refund({id:'r1',amount:6000}),refund({id:'r2',amount:5000})]})]}),order,today);assert.equal(over.settled,false);assert.ok(over.blockers.length);
});
test('date-only debt boundaries preserve leap day and reject non-dates or timestamps',()=>{
 assert.equal(collectionBillFact(bill({dueDate:'2024-02-29'}),order,'2024-03-01').overdueDays,1);assert.equal(collectionBillFact(bill({dueDate:'2026-01-31'}),order,'2026-02-28').overdueDays,28);
 for(const date of ['0000-01-01','2026-02-29','2026-10-30T00:00:00Z','2026-1-01'])assert.throws(()=>collectionBillFact(bill({dueDate:date}),order,today));
 assert.throws(()=>collectionDay(new Date('9999-12-31T20:00:00Z')));assert.throws(()=>collectionSummary(order,[], 'invalid'));
});
test('canonical snapshot freezes nested cash facts, rejects repeats, and omits private transport payload',()=>{
 const row=bill({status:'PAID',paidAmount:10000,payments:[payment({clientParameters:{secret:'must-not-freeze'},requestSnapshot:{secret:'must-not-freeze'},refunds:[refund({id:'r1',amount:2000}),refund({id:'r2',amount:1000})]})]}),before=JSON.stringify(row),a=collectionSummary(order,[row],today,['bill']),b=collectionSummary(order,[{...row,payments:[{...row.payments[0],refunds:[...row.payments[0].refunds].reverse()}]}],today,['bill']);assert.equal(a.sourceHash,b.sourceHash);assert.equal(JSON.stringify(a).includes('must-not-freeze'),false);assert.equal(JSON.stringify(row),before);
 const changed=structuredClone(row);changed.payments[0].revision++;assert.notEqual(a.sourceHash,collectionSummary(order,[changed],today,['bill']).sourceHash);assert.throws(()=>collectionSummary(order,[row],today,['bill','bill']));
});
test('blocked nonoverdue cash and linked unpublished bills block closing without inflating confirmed overdue totals',()=>{
 const clear=bill({status:'PAID',paidAmount:10000,payments:[payment()]}),pending=bill({id:'future',dueDate:'2026-11-01',payments:[payment({id:'pending',billId:'future',status:'PENDING',providerTransactionId:null})]}),summary=collectionSummary(order,[clear,pending],today,['bill']);assert.equal(summary.totalOverdueAmount,0);assert.equal(summary.canClose,false);assert.deepEqual(summary.blockedBillIds,['future']);
 for(const status of ['DRAFT','REVIEWED','PENDING'])assert.equal(collectionSummary(order,[bill({status})],today,['bill']).canClose,false);
 const voided=collectionSummary(order,[bill({status:'VOID'})],today,['bill']);assert.equal(voided.canClose,true);
});
