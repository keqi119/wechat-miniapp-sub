import test from 'node:test';
import assert from 'node:assert/strict';
import {completedCancellationFixture} from './renewal-cancellation-history-fixture';
const load=async(f:Awaited<ReturnType<typeof completedCancellationFixture>>,paymentId?:string)=>(await import('../src/order-renewals/cancellation-late-facts')).readCompletedRenewalCancellationLateFacts(f.tx,f.change.id,{paymentId});

test('only original known CLOSED receipt can become a late refund candidate, even when channel time precedes completion',async()=>{
 const f=await completedCancellationFixture(),original=structuredClone(f.record);f.arrive();const v=await load(f,f.attempt.id),p=v.payments[0];assert.equal(p.eligibleLateReceipt,true);assert.equal(p.completionStatus,'CLOSED');assert.equal(p.receivedAmount,f.attempt.amount);assert.equal(p.remainingRefundAmount,f.attempt.amount);assert.equal(p.reconciliationRequired,true);assert.deepEqual(f.record,original);assert.equal(f.writes.length,f.writesBefore);
});
test('legacy and exact cancellation successful refunds count real money, pending IDs are not silently excluded',async()=>{
 const f=await completedCancellationFixture();f.arrive();const first=await load(f);f.refund(123);const pending=f.refund(f.attempt.amount-123,'PENDING_APPROVAL',true);let v=await load(f);assert.equal(v.payments[0].refundedAmount,123);assert.equal(v.payments[0].remainingRefundAmount,f.attempt.amount-123);assert.deepEqual(v.payments[0].pendingRefundIds,[pending.id]);assert.notEqual(first.sourceHash,v.sourceHash);
 Object.assign(pending,{status:'SUCCEEDED',providerRefundId:'actual-rest-refund',succeededAt:new Date()});v=await load(f);assert.equal(v.payments[0].remainingRefundAmount,0);assert.equal(v.payments[0].reconciliationRequired,true);
});
test('new payment, changed amount/payer, same revision, missing provider receipt and original-term money are never candidates',async()=>{
 for(const mutate of [(f:any)=>f.attempt.id='new-payment',(f:any)=>f.attempt.amount--,(f:any)=>f.attempt.customerId='foreign',(f:any)=>f.attempt.revision=2,(f:any)=>f.attempt.providerTransactionId=null]){const f=await completedCancellationFixture();f.arrive();mutate(f);const v=await load(f);assert.equal(v.payments[0].eligibleLateReceipt,false);assert.ok(v.payments[0].blockers.length>0);}
 const f=await completedCancellationFixture();f.arrive();assert.equal((await load(f,f.bills.find(b=>!b.serviceStageId)!.payments[0]?.id??'old-payment')).payments.length,0);
});
test('unknown or cross-case refund evidence is not counted as successful returned cash',async()=>{
 for(const mutate of [(r:any)=>r.providerRefundId=null,(r:any)=>r.customerId='foreign',(r:any)=>r.renewalCancellationBillId='old-bill']){const f=await completedCancellationFixture();f.arrive();const r=f.refund(f.attempt.amount,'SUCCEEDED',true);mutate(r);const p=(await load(f)).payments[0];assert.equal(p.refundedAmount,null);assert.equal(p.remainingRefundAmount,null);assert.ok(p.blockers.length>0);}
});
test('unknown storage error remains an error and never becomes zero late money',async()=>{
 const f=await completedCancellationFixture();f.arrive();const error=new Error('unavailable');f.tx.payment.findMany=async()=>{throw error;};await assert.rejects(load(f),e=>e===error);
});
test('completed refunded receipt and unchanged closed attempt do not block another genuine late receipt',async()=>{
 const f=await completedCancellationFixture(true,true),before=await load(f);assert.deepEqual(before.blockers,[]);assert.equal(before.payments.every(p=>!p.eligibleLateReceipt),true);
 f.arrive();const v=await load(f,f.attempt.id);assert.equal(v.payments[0].eligibleLateReceipt,true);assert.deepEqual(v.blockers,['PAYMENT_RECONCILIATION_REQUIRED']);assert.equal(v.payments[0].remainingRefundAmount,f.attempt.amount);
 const history=await load(f,f.originalPayment!.id);assert.equal(history.payments[0].eligibleLateReceipt,false);assert.equal(history.payments[0].remainingRefundAmount,0);
});
test('missing frozen payment or a changed successful historical refund remains a global blocker',async()=>{
 const f=await completedCancellationFixture(true,true);f.arrive();f.bill!.payments.splice(f.bill!.payments.findIndex((p:any)=>p.id===f.originalPayment!.id),1);assert.ok((await load(f)).blockers.includes('COMPLETION_PAYMENT_MISSING'));
 const g=await completedCancellationFixture(true,true);g.arrive();g.refunds[0].providerRefundId='substituted-provider';assert.ok((await load(g)).blockers.includes('COMPLETION_REFUND_CHANGED'));
});
test('late counter zero allows real receipt but counter/state contradictions remain blockers',async()=>{
 const f=await completedCancellationFixture();f.arrive();assert.equal((await load(f)).blockers.includes('BILL_RECEIPT_COUNTER_CONFLICT'),false);f.bill!.paidAmount=f.attempt.amount+1;assert.ok((await load(f)).blockers.includes('BILL_RECEIPT_COUNTER_CONFLICT'));Object.assign(f.bill!,{status:'PAID',paidAmount:0});assert.ok((await load(f)).blockers.includes('BILL_PAID_STATE_CONFLICT'));
});
test('refund reconciliation must preserve actual receipt, independent reviewers and REFUNDED resolution',async()=>{
 const f=await completedCancellationFixture();f.arrive();f.refund();f.attempt.reconciliationRequired=false;
 assert.ok((await load(f)).blockers.includes('PAYMENT_RECONCILIATION_REQUIRED'));
 const p=f.attempt,r:any={id:'actual-refunded-review',paymentId:p.id,status:'APPROVED',resolution:'REFUNDED',paymentSnapshot:{paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,status:'SUCCEEDED'},submittedBy:'finance-1',reviewedBy:'finance-2',createdAt:new Date('2026-10-31T03:00:00Z'),reviewedAt:new Date('2026-10-31T04:00:00Z'),evidenceFileIds:[f.evidence.id]};f.reconciliations.push(r);
 const valid=await load(f);assert.deepEqual(valid.blockers,[]);assert.equal(valid.payments[0].remainingRefundAmount,0);r.createdAt=new Date('2026-10-31T03:01:00Z');assert.notEqual((await load(f)).sourceHash,valid.sourceHash);
 for(const mutate of [(r:any)=>r.resolution='APPLY_TO_BILL',(r:any)=>r.reviewedBy=r.submittedBy,(r:any)=>r.paymentSnapshot.amount--]){const before=structuredClone(r);mutate(r);assert.ok((await load(f)).blockers.includes('RECONCILIATION_SOURCE_MISMATCH'));Object.assign(r,before);}
});

import {canonicalHash} from '../src/customers/types';
async function originalVersion1RefundShape(){
 const f=await completedCancellationFixture(true,true);
 // This is an explicit pre9b completion fixture, not today's newly projected shape.
 const strip=(v:any)=>{if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(k==='refunds'&&Array.isArray(x))for(const r of x){delete r.method;delete r.receiptIdentity;}strip(x);}};
 strip(f.record.completionSnapshot);f.record.completionHash=canonicalHash(f.record.completionSnapshot);
 assert.equal(f.record.sourceSnapshot.version,1);assert.equal(f.record.completionSnapshot.version,1);
 const frozen=f.record.completionSnapshot.funding.payments.find((p:any)=>p.id===f.originalPayment!.id).refunds[0];assert.equal('method'in frozen,false);assert.equal('receiptIdentity'in frozen,false);
 return f;
}
test('version1 frozen pre9b refund shape retains unchanged actual settled money without rewriting history',async()=>{
 const f=await originalVersion1RefundShape(),frozen=structuredClone(f.record);const view=await load(f),p=view.payments.find(p=>p.id===f.originalPayment!.id)!;
 assert.deepEqual(view.blockers,[]);assert.equal(p.refundedAmount,f.originalPayment!.amount);assert.equal(p.remainingRefundAmount,0);assert.deepEqual(f.record,frozen);
});
test('version1 compatibility still rejects changed frozen monetary source, receipt identity or time',async()=>{
 for(const change of [(r:any)=>r.id='different-refund',(r:any)=>r.amount--,(r:any)=>r.customerId='different-customer',(r:any)=>r.paymentId='different-payment',(r:any)=>r.providerRefundId='different-channel',(r:any)=>r.succeededAt=new Date('2026-10-30T00:00:00Z'),(r:any)=>r.renewalCancellationId='different-case',(r:any)=>r.method='MANUAL_BANK']){
  const f=await originalVersion1RefundShape();change(f.refunds[0]);assert.ok((await load(f)).blockers.includes('COMPLETION_REFUND_CHANGED'));
 }
});
