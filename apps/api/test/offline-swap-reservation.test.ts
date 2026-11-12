import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publish,confirm} from '../src/order-changes/quotes';
import {prepareFinance} from '../src/order-changes/finance';
import {guardSwapHandoverReservation} from '../src/vehicle-changes/handovers';
import {requireOfflineSwapFacts} from '../src/vehicle-changes/offline-facts';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;

test('future FIELD return reservation checks real agreement and finance without fabricating actual facts or writing anything',async()=>{
 const f=await offlineSwapLifecycleFixture();await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});f.archiveQuote();await prepareFinance(f.tx,f.change,{id:'finance'});
 f.vehicle.reservedOrderId=f.order.id;
 const due=f.obligations.find((o:any)=>o.sequence===2),bill=f.bills.find((b:any)=>b.id===due.chargeBillId);Object.assign(bill,{status:'PAID',paidAmount:bill.amount,payments:[{id:'new-payment',billId:bill.id,customerId:f.order.customerId,status:'SUCCEEDED',amount:bill.amount,refunds:[]}]});f.allocations.push({paymentId:'new-payment',obligationId:due.id,amount:bill.amount});
 const writes=structuredClone(f.writes),locks=f.locks.length;await guardSwapHandoverReservation(f.tx,{orderId:f.order.id,customerId:f.order.customerId,changeId:f.change.id,type:'SWAP_RETURN',vehicleId:f.vehicle.id,assignmentId:f.assignment.id});
 assert.deepEqual(f.writes,writes);assert.equal(f.locks.length,locks);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);assert.equal(f.handovers.length,1);
 f.version.invalidatedAt=new Date();await assert.rejects(guardSwapHandoverReservation(f.tx,{orderId:f.order.id,customerId:f.order.customerId,changeId:f.change.id,type:'SWAP_RETURN',vehicleId:f.vehicle.id,assignmentId:f.assignment.id}),code('AGREEMENT_ARCHIVE_REQUIRED'));
});

test('a real completed swap return remains usable as basis while no current vehicle is assigned, without pretending it is still active',async()=>{
 const f=await offlineSwapLifecycleFixture(),returnedAt=new Date('2026-11-01T01:00:00Z');
 Object.assign(f.assignment,{status:'CLOSED',endAt:returnedAt,endReadingKm:200,returnHandoverId:'returned'});f.order.currentAssignmentId=null;f.change.returnHandoverId='returned';f.change.status='SWAP_RETURNED';
 f.handovers.push({id:'returned',orderId:f.order.id,customerId:f.order.customerId,changeId:f.change.id,vehicleId:f.vehicle.id,assignmentId:f.assignment.id,type:'SWAP_RETURN',executionMode:'OFFLINE',status:'COMPLETED',actualAt:returnedAt,readingKm:200});
 const result=await requireOfflineSwapFacts(f.tx,f.order,f.change,new Date('2026-10-31'),true);assert.equal(result.assignment.status,'CLOSED');assert.equal(f.order.currentAssignmentId,null);
 f.handovers.at(-1)!.customerId='other-customer';await assert.rejects(requireOfflineSwapFacts(f.tx,f.order,f.change,new Date('2026-10-31'),true),code('ASSIGNMENT_EVIDENCE_REQUIRED'));
});
