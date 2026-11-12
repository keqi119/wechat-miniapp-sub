import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VehicleAssetsService} from '../src/vehicle-assets/service';
import {profilePatchInput} from '../src/vehicle-assets/types';
import {assetActor,assetCommand,assetFixture,financeActor} from './asset-ledger-fixture';

test('registered owner is an explicit registration-certificate fact with partial, clear, audit and replay semantics',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();assert.equal((await service.detail(f.tx,assetActor,'vehicle') as any).registeredOwnerName,null);
 const body={...assetCommand(),vehicleRevision:3,registeredOwnerName:'  合成登记证所有人  '};const saved:any=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',body));assert.equal(saved.registeredOwnerName,'合成登记证所有人');
 const count=f.writes.length;assert.deepEqual(await f.serial(tx=>service.patch(tx,assetActor,'vehicle',body)),saved);assert.equal(f.writes.length,count);
 const partial:any=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(1),vehicleRevision:3,notes:'独立备注'}));assert.equal(partial.registeredOwnerName,'合成登记证所有人');
 const clear:any=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(2),vehicleRevision:3,registeredOwnerName:null}));assert.equal(clear.registeredOwnerName,null);
 const audits=f.rows('auditLog');assert.equal(audits[2].data.before.registeredOwnerName,'合成登记证所有人');assert.equal(audits[2].data.after.registeredOwnerName,null);assert.equal(f.rows('vehicle')[0].revision,3);
});
test('registered owner rejects accidental blank/NUL/oversize; finance cannot edit or newly read personal owner text',async()=>{
 for(const value of ['', '   ', 'a\u0000b', '名'.repeat(201), 123])assert.equal(profilePatchInput.safeParse({...assetCommand(),vehicleRevision:3,registeredOwnerName:value}).success,false);
 assert.equal((profilePatchInput.parse({...assetCommand(),vehicleRevision:3,registeredOwnerName:'名'.repeat(200)}) as any).registeredOwnerName.length,200);
 const f=assetFixture(),service=new VehicleAssetsService();await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...assetCommand(),vehicleRevision:3,registeredOwnerName:'私密登记人'}));
 assert.equal(Object.hasOwn(await service.detail(f.tx,financeActor,'vehicle'),'registeredOwnerName'),false);
 await assert.rejects(f.serial(tx=>service.patch(tx,financeActor,'vehicle',{...assetCommand(1),vehicleRevision:3,registeredOwnerName:'试改'})),(e:any)=>e.getStatus()===403);
});
