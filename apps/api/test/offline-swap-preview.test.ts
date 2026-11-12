import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineSwapPreviewFixture,swapOps,previewNow} from './offline-swap-preview-fixture';
import {canonicalHash} from '../src/customers/types';
import {swapQuote} from '../src/vehicle-changes/quotes';
import {listedProductSnapshot,versionSnapshot} from '../src/products/snapshot';
import {activeStageSwapFixture} from './stage-offline-swap-fixture';
import * as previewImplementation from '../src/vehicle-changes/offline-quote-preview';
const load=async()=>previewImplementation;
const preview=async(f:ReturnType<typeof offlineSwapPreviewFixture>,input:any=f.input)=>{
 const implementation=await load();assert.equal(typeof implementation.readOfflineSwapQuotePreview,'function','the actual read-only automatic quote preview is missing');
 return implementation.readOfflineSwapQuotePreview(f.tx,f.change.id,input,swapOps,previewNow);
};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('actual preview uses listed source and exact automatic periods while performing no writes',async()=>{
 const f=offlineSwapPreviewFixture(),before=structuredClone({order:f.order,change:f.change,bills:f.bills,account:f.account});
 const p=await preview(f);assert.equal(p.changeId,f.change.id);assert.equal(p.revision,f.change.revision);
 assert.equal(p.target.targetSourceHash,f.input.targetSourceHash);assert.notEqual(p.target.targetSourceHash,f.plan.listing.productSourceHash);
 assert.deepEqual(p.periods.map((r:any)=>[r.sequence,r.originalAmount,r.differenceAmount,r.amount]),[[1,10000,0,10000],[2,10000,10000,20000],[3,10000,10000,20000]]);
 assert.equal(p.financialGate,'BEFORE_RETURN');assert.equal(p.targetMonthlyFeeAmount,20000);assert.match(p.previewHash,/^[a-f0-9]{64}$/);
 assert.deepEqual({order:f.order,change:f.change,bills:f.bills,account:f.account},before);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);assert.equal(f.holds.length,0);assert.equal(f.credits.length,0);
 assert.equal((await preview(f)).previewHash,p.previewHash);
});
test('targets paginate the same search scope and return the actual listing hash, not raw product hash',async()=>{
 const f=offlineSwapPreviewFixture(),implementation=await load();assert.equal(typeof implementation.listOfflineSwapTargets,'function','target listing reader is missing');
 const result=await implementation.listOfflineSwapTargets(f.tx,f.change.id,{keyword:'换入',page:3,pageSize:20},swapOps,previewNow);
 assert.equal(result.total,41);assert.equal(result.page,3);assert.equal(result.items[0].targetListingId,f.plan.listing.id);assert.equal(result.items[0].targetSourceHash,f.input.targetSourceHash);
 assert.equal(f.queries[0].skip,40);assert.equal(f.queries[0].take,20);assert.deepEqual(f.queries[0].where,f.queries[1].where);assert.equal(f.writes.length,0);
});
test('preview rejects price overrides, missing source, unavailable vehicle and revoked staff',async()=>{
 const f=offlineSwapPreviewFixture();await assert.rejects(preview(f,{...f.input,periods:[],newMonthlyFeeAmount:1}),e=>(e as any).name==='ZodError');
 await assert.rejects(preview(f,{...f.input,targetSourceHash:f.plan.listing.productSourceHash}),code('GOODS_SOURCE_CHANGED'));
 f.target.status='IN_USE';await assert.rejects(preview(f),code('VEHICLE_UNAVAILABLE'));f.target.status='PUBLISHED';
 f.staff.get('ops').role='FINANCE';await assert.rejects(preview(f),code('STAFF_SESSION_CHANGED'));assert.equal(f.writes.length,0);
});
test('saving the viewed preview rechecks current real source before any quote/hold write',async()=>{
 const f=offlineSwapPreviewFixture(),p=await preview(f);f.target.conditionDisclosure='新披露事实';
 await assert.rejects(swapQuote(f.tx,f.change,{...f.input,idempotencyKey:'preview-quote-source',previewHash:p.previewHash},swapOps),code('SWAP_PREVIEW_CHANGED'));assert.equal(f.writes.length,0);
 const current=await preview(f);await swapQuote(f.tx,f.change,{...f.input,idempotencyKey:'preview-quote-source',previewHash:current.previewHash},swapOps);
 assert.equal(f.quotes.at(-1).snapshot.pricingHash,canonicalHash(f.quotes.at(-1).snapshot.pricing));assert.equal(f.quotes.at(-1).snapshot.previewHash,current.previewHash);assert.equal(f.holds.length,1);
});
test('changed input and financial receipts invalidate the viewed preview',async()=>{
 const f=offlineSwapPreviewFixture(),p=await preview(f);
 await assert.rejects(swapQuote(f.tx,f.change,{...f.input,reason:'新的办理原因',idempotencyKey:'changed-preview-key',previewHash:p.previewHash},swapOps),code('SWAP_PREVIEW_CHANGED'));
 f.bills[0].payments[0].amount=9000;f.bills[0].paidAmount=9000;
 await assert.rejects(swapQuote(f.tx,f.change,{...f.input,idempotencyKey:'changed-preview-funds',previewHash:p.previewHash},swapOps));assert.equal(f.writes.length,0);
});
test('same-price preview has zero differences and a future confirmed renewal blocks quotation',async()=>{
 const f=offlineSwapPreviewFixture();Object.assign(f.plan.productVersion,{monthlyFeeAmount:10000,baseFeeAmount:10000});f.plan.listing.snapshot=versionSnapshot(f.plan.productVersion);f.plan.listing.productSourceHash=canonicalHash(f.plan.listing.snapshot);f.input.targetSourceHash=listedProductSnapshot(f.plan).sourceHash;
 const p=await preview(f);assert.deepEqual(p.periods.map((r:any)=>r.differenceAmount),[0,0,0]);
 f.tx.orderChange.findMany=async()=>[{id:'future',kind:'SUBSCRIPTION_EXTENSION',orderId:f.order.id,customerId:f.order.customerId,status:'AWAITING_ARCHIVE',activeQuoteId:'future-q'}];f.tx.delayQuote.findUnique=async()=>({id:'future-q',changeId:'future',confirmedAt:new Date()});
 await assert.rejects(preview(f),code('SWAP_FUTURE_STAGE_CONFIRMED'));assert.equal(f.writes.length,0);
});
test('preview of actual activated renewal preserves global 13+ and local stage sequences without writing',async()=>{
 const f=await activeStageSwapFixture(),implementation=await load(),{idempotencyKey,...input}=f.input,before=f.writes.length;
 const p=await implementation.readOfflineSwapQuotePreview(f.tx,f.change.id,input,f.ops,f.now());
 assert.ok(p.serviceStageScope);
 assert.equal(p.serviceStageScope.serviceStageId,f.stage.id);assert.equal(p.serviceStageScope.stageSourceHash,f.stage.snapshotHash);assert.equal(p.serviceStageScope.startDate,'2027-10-01');
 assert.deepEqual(p.periods.map((r:any)=>[r.sequence,r.stageSequence]),Array.from({length:12},(_,i)=>[i+13,i+1]));assert.equal(p.periods[0].amount,29677);assert.equal(f.writes.length,before);
 await swapQuote(f.tx,f.change,{...input,idempotencyKey:'strict-stage-preview',previewHash:p.previewHash},f.ops);assert.equal(f.quotes.at(-1).snapshot.previewHash,p.previewHash);
});
