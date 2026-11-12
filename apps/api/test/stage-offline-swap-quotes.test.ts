import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeStageSwapFixture} from './stage-offline-swap-fixture';
import {createOfflineSwapQuote} from '../src/vehicle-changes/offline-quote';
import {assertOfflineSwapQuote} from '../src/vehicle-changes/offline-target';
import {publishOfflineSwap} from '../src/vehicle-changes/offline-publish';
import {canonicalHash} from '../src/customers/types';

test('real active renewal quote keeps global/local periods and publishes current-stage gifts rather than original or target product rights',async()=>{
 const f=await activeStageSwapFixture(),initial=structuredClone(f.initial),stage=structuredClone(f.stage.snapshot);
 await createOfflineSwapQuote(f.tx,f.change,f.input,f.ops);const q=f.quotes.at(-1)!;
 assert.equal(q.snapshot.serviceStageScope.serviceStageId,f.stage.id);assert.equal(q.snapshot.serviceStageScope.stageSourceHash,f.stage.snapshotHash);assert.deepEqual(q.snapshot.periods.map((p:any)=>[p.sequence,p.stageSequence]),Array.from({length:12},(_,i)=>[i+13,i+1]));assert.equal(q.snapshot.affectedSequence,13);assert.equal(q.snapshot.newEndDate,'2028-09-30');assert.equal(q.snapshot.periods[0].amount,29677);assert.equal(q.snapshot.periods[0].netPaidAmount,20000);assert.equal(q.snapshot.periods[0].chargeAmount,9677);
 Object.assign(q,{status:'REVIEWED',reviewedBy:'finance',reviewNote:'独立核对'});f.change.status='REVIEWED';await publishOfflineSwap(f.tx,f.order,f.change,q);
 assert.match(q.snapshot.document.content,/本服务段.*赠送3次/);assert.doesNotMatch(q.snapshot.document.content,/赠送99次/);assert.deepEqual(f.initial,initial);assert.deepEqual(f.stage.snapshot,stage);assert.equal(f.terms.length,1);assert.equal(f.obligations.filter(o=>o.quoteId===q.id).length,0);
});
test('frozen pricing must bind stage source and local sequence, including independently recomputed outer pricing hashes',async()=>{
 for(const mutate of [(q:any)=>delete q.snapshot.serviceStageScope,(q:any)=>q.snapshot.periods[0].stageSequence=2,(q:any)=>{q.snapshot.pricing.serviceStageScope.stageSourceHash='f'.repeat(64);q.snapshot.pricingHash=canonicalHash(q.snapshot.pricing);}]){
  const f=await activeStageSwapFixture();await createOfflineSwapQuote(f.tx,f.change,f.input,f.ops);const q=f.quotes.at(-1)!;mutate(q);assert.throws(()=>assertOfflineSwapQuote(f.change,q),(e:any)=>e.getResponse?.().error?.code==='SWAP_QUOTE_SOURCE_MISMATCH');
 }
});

test('a continuous original assignment does not permit renewal swap return to rewrite the ended original service stage',async()=>{
 const f=await activeStageSwapFixture(),count=f.writes.length;
 await assert.rejects(createOfflineSwapQuote(f.tx,f.change,{...f.input,plannedReturnAt:'2027-09-30T23:59:59+08:00'},f.ops),(e:any)=>e.getResponse?.().error?.code==='SWAP_OUTSIDE_TERM');
 assert.equal(f.writes.length,count);assert.equal(f.change.activeQuoteId,null);assert.equal(f.holds.length,0);
});
