import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guardSwapHandover,completeSwapHandover} from '../src/vehicle-changes/handovers';
import {offlineSwapPhysicalFixture} from './offline-swap-physical-fixture';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;

test('actual OFFLINE return requires the archived quote and exact agreed day without eSign or additional credit grants',async()=>{
 const f=await offlineSwapPhysicalFixture(),h=f.actualFact('RETURN');const result=await guardSwapHandover(f.tx,h);assert.equal(result.q.id,f.q.id);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);assert.equal(f.ledger.length,2);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);assert.equal(f.order.currentAssignmentId,f.assignment.id);
 h.actualAt=new Date('2026-10-29T01:00:00Z');await assert.rejects(guardSwapHandover(f.tx,h),code('SWAP_DATE_AMENDMENT_REQUIRED'));
});

test('new-car actual guard uses frozen target coverage and current qualification and does not materialize a gift',async()=>{
 const f=await offlineSwapPhysicalFixture(),ret=f.addFact('RETURN');ret.status='COMPLETED';Object.assign(f.assignment,{status:'CLOSED',endAt:ret.actualAt,endReadingKm:ret.readingKm,returnHandoverId:ret.id});f.change.status='SWAP_RETURNED';f.order.currentAssignmentId=null;
 const delivery=f.actualFact('DELIVERY');await guardSwapHandover(f.tx,delivery);assert.deepEqual(f.productReads,[f.plan.productVersionId]);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);assert.equal(f.ledger.length,2);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);
 f.policy.endAt=new Date('2026-10-29');await assert.rejects(guardSwapHandover(f.tx,delivery),code('DELIVERY_INSURANCE_COMPULSORY_TRAFFIC_REQUIRED'));f.policy.endAt=new Date('2027-01-01');f.qualification.status='REJECTED';await assert.rejects(guardSwapHandover(f.tx,delivery),code('CUSTOMER_QUALIFICATION_REQUIRED'));
});

test('paper return and delivery complete exact FIELD tasks, one original TERM credit and a real archived effective chain without changing original usage',async()=>{
 const f=await offlineSwapPhysicalFixture(),original=structuredClone(f.initial) as any,pack=f.account.packKm,started=f.account.startedOn,ret=f.addFact('RETURN','return-task');f.tasks.push({id:'unrelated-task',orderId:f.order.id,currentHandoverId:'other-handover',status:'PUBLISHED',version:1});
 await completeSwapHandover(f.tx,ret,'ops');assert.equal(f.change.status,'SWAP_RETURNED');assert.equal(f.order.currentAssignmentId,null);assert.equal(f.account.returnedOn,null);assert.equal(f.tasks.find(t=>t.id==='return-task').status,'COMPLETED');assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);
 const incoming=f.addFact('DELIVERY','delivery-task');await completeSwapHandover(f.tx,incoming,'ops');await completeSwapHandover(f.tx,incoming,'ops');
 assert.equal(f.change.status,'APPLIED');assert.equal(f.order.vehicleId,f.target.id);assert.equal(incoming.assignmentId,'new-assignment');assert.equal(f.assignments[1].changeId,f.change.id);assert.equal(f.assignments[1].deliveryHandoverId,incoming.id);assert.equal(f.tasks.find(t=>t.id==='delivery-task').vehicleAssignmentId,'new-assignment');assert.equal(f.tasks.find(t=>t.id==='delivery-task').status,'COMPLETED');assert.equal(f.tasks.find(t=>t.id==='unrelated-task').status,'PUBLISHED');
 assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.credits[0].policySnapshot.includedCount,2);assert.equal(f.account.packKm,pack);assert.deepEqual(f.account.startedOn,started);assert.equal(f.usagePeriods.length,3);assert.deepEqual(f.initial,original);
 const terms=f.terms[0];assert.equal(terms.offlineArchiveVersionId,f.paper.id);assert.equal(terms.snapshot.vehicleId,f.target.id);assert.equal(terms.snapshot.lessorSnapshot.vehicleId,f.target.id);assert.deepEqual(terms.snapshot.productSnapshot,original.productSnapshot);assert.deepEqual(terms.snapshot.currentVehicleProductSnapshot,f.q.snapshot.targetSource.product);assert.equal(terms.snapshot.commercialTerms.customerAddress,original.commercialTerms.customerAddress);assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).ready,true);
});

test('completion rejects a stale paper manifest or wrong FIELD current pointer before closing the actual assignment',async()=>{
 for(const bad of ['paper','task']){const f=await offlineSwapPhysicalFixture(),h=f.addFact('RETURN','return-task');if(bad==='paper')f.receipts[0].versions[0].businessSnapshotHash='f'.repeat(64);else f.tasks[0].currentHandoverId='other';await assert.rejects(completeSwapHandover(f.tx,h,'ops'),code(bad==='paper'?'ARCHIVE_SNAPSHOT_MISMATCH':'FIELD_SWAP_SOURCE_CHANGED'));assert.equal(f.assignment.status,'ACTIVE');assert.equal(f.ledger.length,2);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);}
});

test('swap final completion rechecks insurance after preview and does not assign an uninsured vehicle',async()=>{const f=await offlineSwapPhysicalFixture(),ret=f.addFact('RETURN');await completeSwapHandover(f.tx,ret,'ops');const incoming=f.addFact('DELIVERY');await guardSwapHandover(f.tx,incoming);const before={assignments:f.assignments.length,terms:f.terms.length,ledger:f.ledger.length};f.policy.coverageItems=f.policy.coverageItems.filter((row:any)=>row.code!=='COMMERCIAL');await assert.rejects(completeSwapHandover(f.tx,incoming,'ops'),code('DELIVERY_INSURANCE_COMMERCIAL_REQUIRED'));assert.equal(f.change.status,'SWAP_RETURNED');assert.equal(incoming.status,'CUSTOMER_CONFIRMED');assert.equal(f.order.currentAssignmentId,null);assert.deepEqual({assignments:f.assignments.length,terms:f.terms.length,ledger:f.ledger.length},before);});
