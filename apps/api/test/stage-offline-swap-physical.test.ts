import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageSwapPhysicalFixture} from './stage-offline-swap-physical-fixture';
import {completeSwapHandover} from '../src/vehicle-changes/handovers';
import {readCurrentOfflineVehicleSource} from '../src/vehicle-changes/offline-effective';
import {readOfflineSwapFunds} from '../src/vehicle-changes/offline-money';

test('actual stage swap switches only stage obligations, preserves global usage/old allocations and consumes one stage gift',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2027-10-02T11:00:00+08:00')});
 const f=await stageSwapPhysicalFixture(),old=structuredClone({initial:f.initial,stage:f.stage.snapshot,oldObligation:f.oldObligation,allocation:f.allocations.find(a=>a.obligationId===f.oldObligation.id),periods:f.usagePeriods.filter(p=>!p.serviceStageId),segments:f.segments.filter(s=>f.usagePeriods.find(p=>p.id===s.periodId)?.sequence<=12)});
 const back=f.addFact('RETURN','old-task');await completeSwapHandover(f.tx,back,'ops');const front=f.addFact('DELIVERY','new-task');await completeSwapHandover(f.tx,front,'ops');
 assert.deepEqual(f.oldObligation,old.oldObligation);assert.deepEqual(f.allocations.find(a=>a.obligationId===f.oldObligation.id),old.allocation);
 assert(f.obligations.filter(o=>o.serviceStageId===f.stage.id&&o.quoteId===f.renewalQuote.id).every(o=>!o.active));assert(f.obligations.filter(o=>o.quoteId===f.q.id).every(o=>o.active&&o.serviceStageId===f.stage.id));
 const terms=f.terms.at(-1)!;assert.equal(terms.snapshot.serviceStageId,f.stage.id);assert.deepEqual(terms.snapshot.productSnapshot,f.stage.snapshot.termsSnapshot.productSnapshot);assert.deepEqual(terms.snapshot.usagePolicy,f.stage.snapshot.termsSnapshot.usagePolicy);assert.equal(terms.snapshot.currentVehicleProductSnapshot.productVersionId,f.swapProduct.id);assert.deepEqual(terms.snapshot.billingSchedule.map((p:any)=>[p.sequence,p.stageSequence]),Array.from({length:12},(_,i)=>[i+13,i+1]));
 assert.deepEqual(f.initial,old.initial);assert.deepEqual(f.stage.snapshot,old.stage);assert.deepEqual(f.usagePeriods.filter(p=>!p.serviceStageId),old.periods);assert.deepEqual(f.segments.filter(s=>f.usagePeriods.find(p=>p.id===s.periodId)?.sequence<=12),old.segments);
 const added=f.segments.filter(s=>s.assignmentId==='new-assignment');assert.equal(added.length,12);assert(added.every(s=>f.usagePeriods.find(p=>p.id===s.periodId)?.serviceStageId===f.stage.id));
 const gift=f.credits.find(c=>c.serviceStageId===f.stage.id)!;assert.equal(gift.termSequence,1);assert.equal(gift.consumedChangeId,f.change.id);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,1);
 assert.equal((await readCurrentOfflineVehicleSource(f.tx,f.order,terms)).range.endDate,'2028-09-30');assert.equal((await readOfflineSwapFunds(f.tx,f.order,f.change,f.q.id,f.q.revision+1)).rows[0].sequence,13);
 const count=[f.terms.length,f.segments.length,f.ledger.length];await completeSwapHandover(f.tx,front,'ops');assert.deepEqual([f.terms.length,f.segments.length,f.ledger.length],count);
 const next=f.addChange();next.change.kind='VEHICLE_CHANGE';const nextFunds=await readOfflineSwapFunds(f.tx,f.order,next.change,null);assert.equal(nextFunds.baseRows[0].sequence,13);assert.equal(nextFunds.baseRows[0].stageSequence,1);assert.equal(nextFunds.baseRows[0].amount,29677);assert.equal(nextFunds.baseRows[0].netPaidAmount,29677);
 terms.snapshot.productSnapshot=f.q.snapshot.targetSource.product;await assert.rejects(readCurrentOfflineVehicleSource(f.tx,f.order,terms),(e:any)=>e.getResponse?.().error?.code==='SWAP_STAGE_SOURCE');
});
