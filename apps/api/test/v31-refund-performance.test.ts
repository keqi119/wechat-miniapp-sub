import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {refundObligationPerformance} from '../src/billing/refund-obligations';
test('deadline passage is not late initiation; unrelated success reduces capacity without discharging debt',async()=>{
 const source={originalPaymentAmount:1000,refs:{proposalHash:'proposal',baselineRefundIds:[]}},row={id:'obligation',orderId:'order',customerId:'customer',ownerId:'owner',paymentId:'payment',sourceKind:'CANCEL04',sourceId:'case',sourceHash:canonicalHash(source),source,amount:1000,triggerAt:new Date('2026-11-08T01:00:00Z'),factAt:new Date('2026-11-08T01:00:00Z'),amountConfirmedAt:new Date('2026-11-08T01:00:00Z'),workingDays:3};
 const p={id:'payment',status:'SUCCEEDED',amount:1000,providerTransactionId:'synthetic',succeededAt:new Date('2026-11-01'),customerId:'customer',bill:{orderId:'order',customerId:'customer'},refunds:[{id:'other-refund',amount:200,status:'SUCCEEDED',customerId:'customer',succeededAt:new Date('2026-11-09'),providerRefundId:'synthetic-other'}]};const tx={payment:{findUnique:async()=>p},refundObligationDeadline:{findUnique:async()=>null}};
 const v=await refundObligationPerformance(tx,row,new Date('2026-11-30'));assert.equal(v.deadlinePassed,true);assert.equal(v.overdue,null);assert.equal(v.initiationTimeliness,null);assert.equal(v.completedAmount,0);assert.equal(v.remainingAmount,1000);assert.equal(v.availablePaymentCapacity,800);assert.equal(v.requiresRefundSourceReview,true);assert.equal(v.calendarBlocksExecution,false);
 p.refunds=[{...p.refunds[0],amount:1000,preDeliveryCancellationId:'case',preDeliveryCancellationSourceHash:'proposal'} as any];const done=await refundObligationPerformance(tx,row,new Date('2026-11-30'));assert.equal(done.completedAmount,1000);assert.equal(done.remainingAmount,0);assert.equal(done.completedBeforeDeadline,true);assert.equal(done.initiationTimeliness,null);
});
