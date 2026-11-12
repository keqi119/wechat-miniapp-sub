import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordSimpleRevenuePayment,recordSimpleRevenueRefund,readSimpleRevenue} from '../src/partners/simple-revenue';
import {renewalRevenueFixture} from './renewal-simple-revenue-fixture';

const period={from:'2026-10-01',to:'2026-11-30'};
test('original and prepared renewal receipts use their own frozen agreement rates, never the original rate for a new stage',async()=>{
 const f=await renewalRevenueFixture(),old=f.receive(f.bills[0]),next=f.receive();
 const original=await recordSimpleRevenuePayment(f.tx,old.id),renewal=await recordSimpleRevenuePayment(f.tx,next.id);
 assert.equal(original.partnerRateBps,2500);assert.equal(original.partnerAmount,2500);
 assert.equal(renewal.partnerRateBps,8000);assert.equal(renewal.partnerAmount,16000);assert.equal(renewal.agreementVersionId,f.agreementVersion.id);
 assert.equal(f.stage.status,'PREPARED');assert.equal(f.order.effectiveTermsVersionId,null);
 const before=f.events.length;assert.deepEqual(await recordSimpleRevenuePayment(f.tx,next.id),renewal);assert.equal(f.events.length,before);
});
test('historical active and ended stage receipts keep original stage car, agreement and rate after the current assignment changes',async()=>{
 for(const status of ['ACTIVE','ENDED'] as const){const f=await renewalRevenueFixture();f.historical(status);assert.equal(f.obligations.find(o=>o.chargeBillId===f.second.id)!.active,false);const p=f.receive(f.second),e=await recordSimpleRevenuePayment(f.tx,p.id);assert.ok(e,'a replaced historical obligation still uses its original frozen receipt source');assert.equal(e.partnerRateBps,8000);assert.equal(e.vehicleId,'vehicle');assert.equal(e.agreementVersionId,f.agreementVersion.id);assert.notEqual(e.vehicleId,f.order.vehicleId);}
});
test('wrong renewal amount, period, due date, idempotency key or obligation skips the event and reports incomplete without changing cash',async()=>{
 for(const change of [(f:any)=>f.first.amount++,(f:any)=>f.first.sequence=1,(f:any)=>f.first.dueDate=new Date('2028-01-01'),(f:any)=>f.first.idempotencyKey='wrong',(f:any)=>f.obligations[0].chargeAmount--,(f:any)=>f.version.status='INVALIDATED']){
  const f=await renewalRevenueFixture();change(f);const p=f.receive(),before=structuredClone(p);assert.equal(await recordSimpleRevenuePayment(f.tx,p.id),null);assert.deepEqual(p,before);assert.equal(f.events.length,0);
  const view=await readSimpleRevenue(f.tx,f.owner.id,period);assert.equal(view.total,0);assert.equal(view.incompleteCount,1);assert.equal(view.totals.receivedAmount,0);
 }
});
test('future non-first receipt and voided stage never earn revenue; expected failures do not throw away the actual payment',async()=>{
 for(const scenario of ['future-month','voided'] as const){const f=await renewalRevenueFixture();if(scenario==='voided')Object.assign(f.stage,{status:'VOIDED',voidedAt:new Date(),voidedBy:'finance',voidReason:'明确撤销'});const p=f.receive(scenario==='future-month'?f.second:f.first);assert.equal(await recordSimpleRevenuePayment(f.tx,p.id),null);assert.equal(p.status,'SUCCEEDED');assert.equal((await readSimpleRevenue(f.tx,f.owner.id,period)).incompleteCount,1);}
});
test('missing original-owner metadata cannot hide an owned stage receipt, and foreign owner queries cannot see it',async()=>{
 const f=await renewalRevenueFixture(),p=f.receive();f.first.orderId=f.order.id;
 // Only the stage association selects this candidate: the original owner belongs to a different frozen period.
 const old=f.orders[0];f.orders[0]={...old,finalPlanSnapshot:{...old.finalPlanSnapshot,revenueRuleSnapshot:{...f.originalRevenue,ownerId:'old-owner'},lessorSnapshot:{...old.finalPlanSnapshot.lessorSnapshot,ownerId:'old-owner'}}};
 const view=await readSimpleRevenue(f.tx,f.owner.id,period);assert.equal(view.incompleteCount,1);assert.equal(view.total,0);assert.ok(f.queries[0].where.OR.some((r:any)=>r.bill?.serviceStage?.ownerId===f.owner.id));assert.equal(f.events.length,0);assert.equal(p.status,'SUCCEEDED');
 f.tx.vehicleOwner.findUnique=async({where}:any)=>({id:where.id});const other=await readSimpleRevenue(f.tx,'unrelated-owner',period);assert.equal(other.incompleteCount,0);assert.equal(other.total,0);
});
test('recorded payment and cumulative refund events preserve their frozen ratio after paper invalidation, with no rewrite',async()=>{
 const f=await renewalRevenueFixture(),p=f.receive();const event=await recordSimpleRevenuePayment(f.tx,p.id),before=structuredClone(event);f.version.status='INVALIDATED';
 for(const amount of [1,1,p.amount-2]){const r=f.refund(p,amount);await recordSimpleRevenueRefund(f.tx,r.id);await recordSimpleRevenueRefund(f.tx,r.id);}
 assert.deepEqual(f.events[0],before);assert.equal(f.events.length,4);assert.equal(f.events.reduce((n,e)=>n+e.partnerAmount,0),0);assert.ok(f.events.every(e=>e.partnerRateBps===8000));
 const view=await readSimpleRevenue(f.tx,f.owner.id,period);assert.equal(view.incompleteCount,0);assert.equal(view.totals.netAmount,0);assert.equal(view.totals.partnerAmount,0);assert.equal(view.total,4);
});
test('unexpected source storage failures propagate rather than masquerade as incomplete success',async()=>{
 const f=await renewalRevenueFixture(),p=f.receive(),failure=new Error('synthetic storage failure');f.tx.orderServiceStage.findUnique=async()=>{throw failure;};await assert.rejects(recordSimpleRevenuePayment(f.tx,p.id),e=>e===failure);assert.equal(f.events.length,0);
});
test('verified stage cash awaiting reconciliation is incomplete rather than falsely complete, without showing its money or changing legacy behavior',async()=>{
 const f=await renewalRevenueFixture(),p=f.receive();p.reconciliationRequired=true;f.version.status='INVALIDATED';
 assert.equal(await recordSimpleRevenuePayment(f.tx,p.id),null);let result=await readSimpleRevenue(f.tx,f.owner.id,period);assert.equal(result.incompleteCount,1);assert.equal(result.total,0);assert.equal(result.totals.receivedAmount,0);
 const old=f.receive(f.bills[0]);old.reconciliationRequired=true;result=await readSimpleRevenue(f.tx,f.owner.id,period);assert.equal(result.incompleteCount,1,'legacy reconciliation stays excluded');
 p.providerTransactionId='';result=await readSimpleRevenue(f.tx,f.owner.id,period);assert.equal(result.incompleteCount,0,'unverified stage data cannot impersonate a true receipt');
});
test('scheduled first receipt is usable but malformed payment ownership and amount cannot mint a stage event',async()=>{
 const f=await renewalRevenueFixture();Object.assign(f.stage,{status:'SCHEDULED',scheduledAt:new Date(),scheduledBy:'finance'});f.change.status='SCHEDULED';const p=f.receive();assert.equal((await recordSimpleRevenuePayment(f.tx,p.id)).partnerRateBps,8000);
 for(const mutate of [(p:any)=>p.amount++,(p:any)=>p.customerId='foreign-customer']){const other=await renewalRevenueFixture(),receipt=other.receive();mutate(receipt);assert.equal(await recordSimpleRevenuePayment(other.tx,receipt.id),null);assert.equal(other.events.length,0);}
});
test('stage model filters and incomplete ownership use the frozen stage, never a later car or broken foreign parent',async()=>{
 const f=await renewalRevenueFixture(),p=f.receive(),modelId=f.stage.snapshot.termsSnapshot.revenueRuleSnapshot.modelId;assert.ok(modelId);const result=await readSimpleRevenue(f.tx,f.owner.id,{...period,modelId});assert.equal(result.incompleteCount,1);assert.equal(result.total,0);assert.equal(f.events.length,0);
 f.first.customerId='foreign-customer';p.customerId='foreign-customer';assert.equal(await recordSimpleRevenuePayment(f.tx,p.id),null);assert.equal((await readSimpleRevenue(f.tx,f.owner.id,period)).incompleteCount,0);
});
