import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VehicleAssetsService} from '../src/vehicle-assets/service';
import {profilePatchInput} from '../src/vehicle-assets/types';
import {assetActor,assetCommand,assetFixture,financeActor} from './asset-ledger-fixture';

test('battery capacity is an explicit decimal asset fact with partial-update, clear and replay semantics',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();
 assert.equal((await service.detail(f.tx,assetActor,'vehicle')).batteryCapacityKwh,null);
 const input={...assetCommand(),vehicleRevision:3,batteryCapacityKwh:'075.500'};
 const saved=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',input));assert.equal(saved.batteryCapacityKwh,'75.5');assert.equal(saved.revision,1);
 const count=f.writes.length;assert.deepEqual(await f.serial(tx=>service.patch(tx,assetActor,'vehicle',input)),saved);assert.equal(f.writes.length,count);
 const partial=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(1),vehicleRevision:3,notes:'其他资料'}));assert.equal(partial.batteryCapacityKwh,'75.5');
 assert.equal((await service.detail(f.tx,financeActor,'vehicle')).batteryCapacityKwh,'75.5');
 const cleared=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(2),vehicleRevision:3,batteryCapacityKwh:null}));assert.equal(cleared.batteryCapacityKwh,null);
 const audits=f.rows('auditLog');assert.equal(audits.length,3);assert.equal(JSON.stringify(audits).includes('75.5'),true);
 assert.equal(f.rows('vehicle')[0].revision,3);
});
test('capacity input rejects nonfinite, rounded, floating numeric and accidental empty clear values',()=>{
 for(const batteryCapacityKwh of ['NaN','Infinity','100000','1.0001','-1','',75.5])assert.equal(profilePatchInput.safeParse({...assetCommand(),vehicleRevision:3,batteryCapacityKwh}).success,false);
 assert.equal(profilePatchInput.parse({...assetCommand(),vehicleRevision:3,batteryCapacityKwh:'99999.999'}).batteryCapacityKwh,'99999.999');
});
