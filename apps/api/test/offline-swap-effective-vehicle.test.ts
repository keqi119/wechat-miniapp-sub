import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completeSwapHandover} from '../src/vehicle-changes/handovers';
import {readDeliveryBusinessReady} from '../src/orders/business-gates';
import {offlineSwapPhysicalFixture} from './offline-swap-physical-fixture';

async function applied(){const f=await offlineSwapPhysicalFixture();await completeSwapHandover(f.tx,f.addFact('RETURN'),'ops');await completeSwapHandover(f.tx,f.addFact('DELIVERY'),'ops');f.productReads.length=0;return f;}
test('after actual swap, current vehicle coverage and cooperation use its real product and remaining interval while original usage product stays frozen',async()=>{
 const f=await applied(),result=await readDeliveryBusinessReady(f.tx,f.order.id,new Date('2026-10-31'));assert.deepEqual(result.blockers,[]);assert.equal(result.ready,true);assert.equal(result.coverageEvidence?.productVersionId,f.plan.productVersionId);assert.deepEqual(f.productReads,[f.plan.productVersionId]);assert.equal(f.terms[0].snapshot.productSnapshot.productVersionId,'original-version');assert.deepEqual(f.terms[0].snapshot.lessorSnapshot.leaseRange,{startDate:'2026-10-30',endDate:'2026-12-31'});
});
test('malformed current product, foreign assignment or mutated actual source blocks without falling back to the old product',async()=>{
 for(const mutate of [(f:Awaited<ReturnType<typeof applied>>)=>{f.terms[0].snapshot.currentVehicleProductSnapshot=null;},(f:Awaited<ReturnType<typeof applied>>)=>{f.assignments[1].customerId='other';},(f:Awaited<ReturnType<typeof applied>>)=>{f.handovers.at(-1)!.manifestHash='f'.repeat(64);}]){const f=await applied();mutate(f);const result=await readDeliveryBusinessReady(f.tx,f.order.id,new Date('2026-10-31'));assert.equal(result.ready,false);assert(result.blockers.some(b=>b.code==='CURRENT_VEHICLE_SOURCE_INVALID'||b.code==='SWAP_HANDOVER_SOURCE_CHANGED'));assert(!f.productReads.includes('original-version'));}
});
