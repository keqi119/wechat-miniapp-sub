import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalPaymentFixture} from './order-renewals-payment-fixture';
import {lateRefundGuardFixture} from './renewal-cancellation-late-refund-guard-fixture';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;

test('a new trusted late SUCCEEDED receipt advances Payment revision once, and duplicate notification preserves it',async()=>{
 const f=await renewalPaymentFixture(),p:any=f.late();Object.assign(p,{revision:4,status:'CLOSED'});
 f.tx.orderRenewalCancellation={findFirst:async()=>({id:'open-case',changeId:f.change.id,status:'OPEN'})};
 const update=f.tx.payment.update;f.tx.payment.update=async(args:any)=>update({...args,data:{...args.data,...(args.data.revision?.increment?{revision:p.revision+args.data.revision.increment}:{})}});
 const event={status:'SUCCEEDED' as const,amount:p.amount,transactionId:'trusted-once-closed-receipt'};
 const result=await f.billing.settle(p.id,event);assert.equal(result.revision,5);assert.equal(result.reconciliationRequired,true);assert.equal(f.counters.allocated,0);
 await f.billing.settle(p.id,event);assert.equal(p.revision,5);assert.equal(f.counters.allocated,0);
});

test('COMPLETED cancellation can refund only its frozen original late receipt with independent approval, without reopening history',async()=>{
 const f=await lateRefundGuardFixture(),before=structuredClone({record:f.record,stage:f.stage,change:f.change,account:f.account});
 await f.controller.approve(f.request.id,{admin:f.reviewer});assert.equal(f.calls.length,1);assert.equal(f.calls[0].amount,f.attempt.amount);assert.equal(f.calls[0].paymentId,f.attempt.id);assert.equal(f.request.status,'PROCESSING');assert.deepEqual({record:f.record,stage:f.stage,change:f.change,account:f.account},before);
});
test('completed late approval and retry retain source, full-amount and real-person checks',async()=>{
 const f=await lateRefundGuardFixture();f.record.completionHash='f'.repeat(64);await assert.rejects(f.controller.approve(f.request.id,{admin:f.reviewer}));assert.equal(f.calls.length,0);
 const g=await lateRefundGuardFixture();g.request.amount--;await assert.rejects(g.controller.approve(g.request.id,{admin:g.reviewer}),code('RENEWAL_CANCELLATION_REFUND_SOURCE'));assert.equal(g.calls.length,0);
 const h=await lateRefundGuardFixture();Object.assign(h.staff.get(h.reviewer.id)!,{staffPersonId:'person-finance'});await assert.rejects(h.controller.approve(h.request.id,{admin:h.reviewer}),code('DUAL_APPROVAL'));assert.equal(h.calls.length,0);
});
test('NOT_FOUND retry accepts intact completed cancellation evidence and rejects a changed original payment',async()=>{
 const f=await lateRefundGuardFixture();Object.assign(f.request,{status:'PROCESSING',approvedBy:f.reviewer.id,updatedAt:new Date(Date.now()-60000)});await f.billing.retryRefund(f.request.id,f.reviewer.id,f.reviewer);assert.equal(f.calls.length,1);assert.equal(f.calls[0].refundId,f.request.id);
 const g=await lateRefundGuardFixture();Object.assign(g.request,{status:'PROCESSING',approvedBy:g.reviewer.id,updatedAt:new Date(Date.now()-60000)});g.attempt.amount--;await assert.rejects(g.billing.retryRefund(g.request.id,g.reviewer.id,g.reviewer));assert.equal(g.calls.length,0);
});
test('generic request and legacy pending approval cannot bypass a completed cancellation late-refund route',async()=>{
 const f=await lateRefundGuardFixture();f.refunds.length=0;await assert.rejects(f.controller.requestRefund({paymentId:f.attempt.id,amount:1,reason:'不允许任意小额',idempotencyKey:'generic-completed-bypass'},{admin:f.reviewer}),code('RENEWAL_CANCELLATION_REFUND_MANAGED'));assert.equal(f.refunds.length,0);f.refunds.push(f.request);
 for(const key of ['renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId'])f.request[key]=null;
 await assert.rejects(f.controller.approve(f.request.id,{admin:f.reviewer}),code('RENEWAL_CANCELLATION_REFUND_MANAGED'));assert.equal(f.calls.length,0);
});
