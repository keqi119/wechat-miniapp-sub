import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VehicleAssetsService} from '../src/vehicle-assets/service';
import {assetActor,assetCommand,assetError,assetFixture,financeActor} from './asset-ledger-fixture';

test('unregistered asset profile is an explicit read projection and first patch creates revision one without touching vehicle facts',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService(),before=structuredClone(f.rows('vehicle')[0]);const read=await service.detail(f.tx,assetActor,'vehicle');assert.equal(read.registered,false);assert.equal(read.revision,0);assert.equal(read.vehicleRevision,3);assert.equal(read.batteryOwnership,'UNKNOWN');assert.equal(f.writes.length,0);
 const input={...assetCommand(),vehicleRevision:3,batteryOwnership:'BAAS',firstRegistrationDate:'2024-02-29',notes:'已核对'};
 const saved=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',input));assert.equal(saved.registered,true);assert.equal(saved.revision,1);assert.equal(saved.firstRegistrationDate,'2024-02-29');assert.deepEqual(f.rows('vehicle')[0],before);
 const count=f.writes.length;assert.deepEqual(await f.serial(tx=>service.patch(tx,assetActor,'vehicle',input)),saved);assert.equal(f.writes.length,count);
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...input,notes:'同键异内容'})),assetError('IDEMPOTENCY_CONFLICT'));
 f.revoke(assetActor.id);await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',input)),assetError('STAFF_SESSION_CHANGED'));
});

test('profile partial edits preserve omitted fields, clear explicit null and reject stale asset/vehicle revisions',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(),vehicleRevision:3,batteryOwnership:'OWNED',firstRegistrationDate:'2024-02-29',notes:'保留'}));
 const updated=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(1),vehicleRevision:3,notes:'新备注'}));assert.equal(updated.firstRegistrationDate,'2024-02-29');assert.equal(updated.batteryOwnership,'OWNED');assert.equal(updated.revision,2);
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(1),vehicleRevision:3,notes:'过期'})),assetError('REVISION_CONFLICT'));
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(2),vehicleRevision:2,notes:'车辆过期'})),assetError('REVISION_CONFLICT'));
 assert.equal((await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(2),vehicleRevision:3,firstRegistrationDate:null}))).firstRegistrationDate,null);
 assert.equal(f.rows('auditLog').length,3);
});

test('active BAAS prevents ownership downgrade and current role limits finance projection and rejects support/field',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(),vehicleRevision:3,batteryOwnership:'BAAS',notes:'内部备注'}));f.seed('vehicleBaasContract',{id:'contract',vehicleId:'vehicle',status:'ACTIVE'});
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(1),vehicleRevision:3,batteryOwnership:'OWNED'})),assetError('ACTIVE_BAAS_CONTRACT'));
 const financial=await service.detail(f.tx,financeActor,'vehicle');assert.equal(financial.notes,undefined);assert.equal(financial.vehicle.id,'vehicle');assert.equal(financial.batteryOwnership,'BAAS');
 await assert.rejects(f.serial(tx=>service.patch(tx,financeActor,'vehicle',{...assetCommand(1),vehicleRevision:3,notes:'越权'})),assetError('FORBIDDEN'));
 for(const role of ['SUPPORT','FIELD'])await assert.rejects(service.detail(f.tx,{id:role.toLowerCase(),role,authVersion:1},'vehicle'),assetError('FORBIDDEN'));
});
