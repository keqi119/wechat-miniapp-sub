import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cancellationRefundGuardFixture} from './renewal-cancellation-refund-guard-fixture';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;

test('refund approval rejects the same real person using two accounts before issuing money',async()=>{
 const f=await cancellationRefundGuardFixture();Object.assign(f.staff.get(f.reviewer.id)!,{staffPersonId:'person-finance'});
 await assert.rejects(f.controller.approve(f.refund.id,{admin:f.reviewer}),code('DUAL_APPROVAL'));assert.equal(f.calls.length,0);assert.equal(f.refund.status,'PENDING_APPROVAL');
});
test('approval rechecks cancellation evidence and rejects stale full-refund amounts',async()=>{
 const f=await cancellationRefundGuardFixture();f.paper.version.status='INVALIDATED';await assert.rejects(f.controller.approve(f.refund.id,{admin:f.reviewer}));assert.equal(f.calls.length,0);assert.equal(f.refund.status,'PENDING_APPROVAL');
 const g=await cancellationRefundGuardFixture();g.refunds.push({id:'already-returned',paymentId:g.payment.id,customerId:g.customer.id,amount:100,status:'SUCCEEDED',providerRefundId:'prior-real-receipt',succeededAt:new Date('2026-10-31T01:00:00Z'),requestedBy:'finance',approvedBy:g.reviewer.id});
 await assert.rejects(g.controller.approve(g.refund.id,{admin:g.reviewer}),code('RENEWAL_CANCELLATION_REFUND_SOURCE'));assert.equal(g.calls.length,0);
});
test('independent approval locks and rereads the order before dispatching the exact remaining new-stage refund',async()=>{
 const f=await cancellationRefundGuardFixture(),old=structuredClone({stage:f.stage,bills:f.bills,assignment:f.assignment});await f.controller.approve(f.refund.id,{admin:f.reviewer});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].amount,f.payment.amount);assert.equal(f.calls[0].paymentId,f.payment.id);assert.equal(f.refund.approvedBy,f.reviewer.id);assert.equal(f.refund.status,'PROCESSING');assert(f.locks.some(sql=>sql.includes('FROM "Order"')));assert.deepEqual({stage:f.stage,bills:f.bills,assignment:f.assignment},old);assert.equal(f.cases[0].status,'OPEN');
});
test('recovery still records a verified existing channel result after paperwork changes, without another refund',async()=>{
 const f=await cancellationRefundGuardFixture();f.processing();f.paper.version.status='INVALIDATED';f.setQuery({status:'SUCCEEDED',paymentId:f.payment.id,amount:f.refund.amount,totalAmount:f.payment.amount,providerRefundId:'already-real',succeededAt:'2026-10-31T02:00:00Z'});
 const result=await (f.billing.retryRefund as any)(f.refund.id,f.reviewer.id,f.reviewer);assert.equal(result.status,'SUCCEEDED');assert.equal(f.calls.length,0);assert.equal(f.recorded.length,1);
});
test('a confirmed channel NOT_FOUND cannot resend money after cancellation evidence is invalidated',async()=>{
 const f=await cancellationRefundGuardFixture();f.processing();f.paper.version.status='INVALIDATED';await assert.rejects((f.billing.retryRefund as any)(f.refund.id,f.reviewer.id,f.reviewer));assert.equal(f.calls.length,0);assert.equal(f.recorded.length,0);
});
test('retry requires a current finance session, including the service boundary',async()=>{
 const f=await cancellationRefundGuardFixture();f.processing();f.staff.get(f.reviewer.id)!.authVersion++;
 await assert.rejects((f.billing.retryRefund as any)(f.refund.id,f.reviewer.id,f.reviewer),code('STAFF_SESSION_CHANGED'));assert.equal(f.calls.length,0);
});
test('reject rereads under the order lock and cannot overwrite a concurrently approved request',async()=>{
 const f=await cancellationRefundGuardFixture();f.onOrderLock(()=>{f.refund.status='PROCESSING';});
 await assert.rejects(f.controller.reject(f.refund.id,{reason:'独立复核暂不通过'},{admin:f.reviewer}),code('STATE_CONFLICT'));assert.equal(f.refund.status,'PROCESSING');assert.equal(f.calls.length,0);
});
test('partially attached or cross-customer cancellation refunds cannot use the legacy approval route',async()=>{
 const f=await cancellationRefundGuardFixture();f.refund.renewalCancellationStageId=null;await assert.rejects(f.controller.approve(f.refund.id,{admin:f.reviewer}),code('RENEWAL_CANCELLATION_REFUND_SOURCE'));assert.equal(f.calls.length,0);
 const g=await cancellationRefundGuardFixture();g.refund.customerId='foreign';await assert.rejects(g.controller.approve(g.refund.id,{admin:g.reviewer}),code('RENEWAL_CANCELLATION_REFUND_SOURCE'));assert.equal(g.calls.length,0);
});

test('a generic pending refund cannot bypass an OPEN cancellation full-refund arrangement',async()=>{
 const f=await cancellationRefundGuardFixture();for(const field of ['renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId'])f.refund[field]=null;
 await assert.rejects(f.controller.approve(f.refund.id,{admin:f.reviewer}),code('RENEWAL_CANCELLATION_REFUND_MANAGED'));assert.equal(f.calls.length,0);
});
test('confirmed NOT_FOUND recovery rechecks current permission before sending the same refund id',async()=>{
 const f=await cancellationRefundGuardFixture();f.processing();await (f.billing.retryRefund as any)(f.refund.id,f.reviewer.id,f.reviewer);assert.equal(f.calls.length,1);assert.equal(f.calls[0].refundId,f.refund.id);assert.equal(f.calls[0].amount,f.payment.amount);
 const g=await cancellationRefundGuardFixture();g.processing();const original=g.billing.syncRefund.bind(g.billing);g.billing.syncRefund=async(id:string)=>{g.staff.get(g.reviewer.id)!.authVersion++;return original(id);};
 await assert.rejects((g.billing.retryRefund as any)(g.refund.id,g.reviewer.id,g.reviewer),code('STAFF_SESSION_CHANGED'));assert.equal(g.calls.length,0);
});
