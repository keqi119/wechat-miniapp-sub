import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OrderChangesService} from '../src/order-changes/service';
import {completeSwapHandover} from '../src/vehicle-changes/handovers';
import {offlineSwapPhysicalFixture} from './offline-swap-physical-fixture';
import {swapOps} from './offline-swap-quotes-fixture';
test('physical projections advertise only the current archived side to operations and perform no writes or row locks',async()=>{
 const f=await offlineSwapPhysicalFixture(),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31')),writes=f.writes.length,locks=f.locks.length;
 let view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.canCreateReturn,true);assert.equal(view.canCreateDelivery,false);assert.equal(f.writes.length,writes);assert.equal(f.locks.length,locks);
 const returned=f.addFact('RETURN');view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.returnHandover!.canComplete,true);assert.equal(view.canCreateReturn,false);f.receipts[0].versions[0].businessSnapshotHash='wrong';assert.equal((await service.view(f.tx,f.change.id,swapOps)).returnHandover!.canComplete,false);f.receipts[0].versions[0].businessSnapshotHash=returned.manifestHash;
 await completeSwapHandover(f.tx,returned,'ops');view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.canCreateDelivery,true);const incoming=f.addFact('DELIVERY');view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.canComplete,true);
 const readOnly=await service.view(f.tx,f.change.id,{id:'finance',role:'FINANCE',authVersion:1});assert.equal(readOnly.canComplete,false);assert.equal(readOnly.deliveryHandover!.canComplete,false);
});
