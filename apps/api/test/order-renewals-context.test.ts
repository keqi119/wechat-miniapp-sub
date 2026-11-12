import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalFixture,renewalAfterSwapFixture,renewalPreviewInput,renewalNow,renewalOps} from './order-renewals-fixture';
import {versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
async function modules(){const types:any=await import('../src/order-renewals/types').catch(()=>({})),context:any=await import('../src/order-renewals/context').catch(()=>({}));assert.equal(typeof types.renewalPreviewInput?.parse,'function','strict renewal DTO exists');assert.equal(typeof context.previewRenewal,'function','renewal preview reads true source');return{...types,...context};}
const code=(v:string)=>(e:any)=>e.getResponse?.().error?.code===v;
test('renewal preview accepts the same real IN_USE car and freezes the new product without changing original price or funds',async()=>{
 const m=await modules(),f=renewalFixture(),original=structuredClone(f.initial),before=structuredClone(f.writes);const view=await m.previewRenewal(f.tx,f.order.id,renewalPreviewInput(f),renewalNow);
 assert.equal(view.kind,'SUBSCRIPTION_EXTENSION');assert.equal(view.startDate,'2027-10-01');assert.equal(view.endDate,'2028-10-01');assert.equal(view.months,12);assert.equal(view.monthlyFeeAmount,20000);assert.equal(view.depositAmount,0);assert.equal(view.usagePricing.baseAllowanceKm,2400);assert.equal(view.swapPolicy.includedCount,0);assert.equal(view.periods[0].sequence,13);assert.equal(view.periods[0].amount,20000);assert.equal(view.totalAmount,240000);assert.match(view.previewHash,/^[a-f0-9]{64}$/);assert.deepEqual(f.writes,before);assert.deepEqual(f.initial,original);assert.equal(f.credits.length,0);assert.equal(f.obligations.length,0);
});
test('renewal rejects client pricing and invalid text before source access, and stale or foreign product sources',async()=>{
 const m=await modules(),f=renewalFixture(),input=renewalPreviewInput(f);for(const patch of [{monthlyFeeAmount:1},{months:120},{startDate:'2026-01-01'},{reason:'bad\0text'}])assert.throws(()=>m.renewalPreviewInput.parse({...input,...patch}));
 await assert.rejects(m.previewRenewal(f.tx,f.order.id,{...input,listingRevision:99},renewalNow),code('GOODS_SOURCE_CHANGED'));
 f.plan.vehicleId='target';await assert.rejects(m.previewRenewal(f.tx,f.order.id,input,renewalNow));assert.equal(f.writes.length,0);
});
test('expired original term, changed assignment and a different actual owner cannot renew',async()=>{
 const m=await modules();for(const mutate of [(f:any)=>f.vehicle.reservedOrderId='foreign',(f:any)=>f.assignment.customerId='foreign',(f:any)=>f.owner.name='另一主体']){const f=renewalFixture();mutate(f);await assert.rejects(m.previewRenewal(f.tx,f.order.id,renewalPreviewInput(f),renewalNow));assert.equal(f.writes.length,0);}
 const f=renewalFixture();await assert.rejects(m.previewRenewal(f.tx,f.order.id,renewalPreviewInput(f),new Date('2027-09-30T16:00:00Z')));assert.equal(f.writes.length,0);
});
test('context and goods are read-only and expose only the actual current car and safe product pagination',async()=>{
 const m=await modules(),f=renewalFixture();const ctx=await m.renewalContext(f.tx,f.order.id,renewalNow);assert.equal(ctx.vehicle.id,f.vehicle.id);assert.equal(ctx.currentStage.id,f.stage.id);assert.equal(ctx.orderRevision,f.order.revision);
 const goods=await m.renewalGoods(f.tx,f.order.id,{page:1,pageSize:20},renewalNow);assert.equal(goods.total,1);assert.equal(goods.items[0].monthlyFeeAmount,20000);assert.equal('revenueRuleSnapshot'in goods.items[0],false);assert.equal('profileHash'in ctx,false);assert.equal(f.writes.length,0);assert.equal(f.locks.length,0);
});
test('the proposed stage marker and month sequence include voided history before customer text is frozen',async()=>{
 const m=await modules(),f=renewalFixture();f.stages.push({id:'voided',orderId:f.order.id,status:'VOIDED',sequence:2,lastPeriodSequence:24});
 const p=await m.buildRenewalPreview(f.tx,f.order.id,renewalPreviewInput(f),renewalNow);assert.equal(p.value.renewalTerms.serviceStageId,'renewal:order:3');assert.equal(p.value.periods[0].sequence,25);assert.equal(p.value.source.nextStageSequence,3);assert.equal(f.writes.length,0);
});
test('zero usage prices and maximum Int monthly money retain exact values while total uses safe arithmetic',async()=>{
 const m=await modules(),f=renewalFixture();Object.assign(f.product,{months:120,baseFeeAmount:2147483647,monthlyFeeAmount:2147483647,mileagePerMonthKm:0,excessMileagePriceAmount:0});f.agreementVersion.validUntil='2040-12-31';
 const snapshot=versionSnapshot(f.product);Object.assign(f.plan.listing,{snapshot,productSourceHash:canonicalHash(snapshot)});
 const p=await m.previewRenewal(f.tx,f.order.id,renewalPreviewInput(f),renewalNow);assert.equal(p.usagePricing.baseAllowanceKm,0);assert.equal(p.usagePricing.excessPriceAmount,0);assert.equal(p.totalAmount,257698037640);assert.equal(p.periods.length,120);assert(p.periods.every((r:any)=>r.amount===2147483647));assert.equal(f.writes.length,0);
 const input=renewalPreviewInput(f);Object.assign(f.product,{baseFeeAmount:2147483648,monthlyFeeAmount:2147483648});await assert.rejects(m.previewRenewal(f.tx,f.order.id,input,renewalNow));assert.equal(f.writes.length,0);
});
test('a prepared future stage or a competing live change blocks a new preview and its locks precede lessor locks',async()=>{
 const m=await modules(),f=renewalFixture();await m.previewRenewal(f.tx,f.order.id,renewalPreviewInput(f),renewalNow);assert.match(f.locks[0],/FROM "Order"/);assert(f.locks.some((v:string)=>v.includes('Vehicle')));assert.equal(f.writes.length,0);
 f.stages.push({...f.stage,id:'future-stage',kind:'RENEWAL',sequence:2,status:'SCHEDULED'});await assert.rejects(m.previewRenewal(f.tx,f.order.id,renewalPreviewInput(f),renewalNow),code('RENEWAL_FUTURE_EXISTS'));
 const g=renewalFixture();g.changes.push({id:'pending-change',orderId:g.order.id,status:'AWAITING_ARCHIVE'});await assert.rejects(m.previewRenewal(g.tx,g.order.id,renewalPreviewInput(g),renewalNow),code('RENEWAL_CHANGE_EXISTS'));assert.equal(g.writes.length,0);
});
test('renewal after an applied swap freezes this new product for the actual replacement car and preserves INITIAL history',async()=>{
 const m=await modules(),f=renewalAfterSwapFixture(),before=structuredClone({initial:f.initial,stage:f.stage,terms:f.terms,assignment:f.assignment,account:f.account}),p=await m.buildRenewalPreview(f.tx,f.order.id,renewalPreviewInput(f),renewalNow);
 assert.equal(p.facts.vehicle.id,'target');assert.equal(p.value.originalAssignmentId,f.currentAssignment.id);assert.equal(p.facts.current.snapshot.identity.vehicleId,'vehicle');assert.equal(p.facts.terms.monthlyFeeAmount,15000);assert.equal(p.value.monthlyFeeAmount,20000);assert.deepEqual(p.value.renewalTerms.currentVehicleProductSnapshot,p.value.product);assert.equal(p.value.renewalTerms.serviceStageId,'renewal:order:2');assert.equal(p.value.renewalTerms.quoteId,undefined);assert.deepEqual({initial:f.initial,stage:f.stage,terms:f.terms,assignment:f.assignment,account:f.account},before);assert.equal(f.writes.length,0);
});
