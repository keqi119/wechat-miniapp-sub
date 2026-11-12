import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {VehicleAssetsService} from '../src/vehicle-assets/service';
import {profilePatchInput} from '../src/vehicle-assets/types';
import {assetActor,assetAdmin,assetCommand,assetError,assetFixture,financeActor} from './asset-ledger-fixture';

const inventory={engineNumber:'SYNTHETIC-ENGINE-001',bodyColor:'合成灰色',initialMileageKm:123,purchaseAmount:12345678,purchaserName:'合成购车人',purchaseDate:'2024-02-29',nextInspectionDate:'2028-02-29'};
const emptyInventory={engineNumber:null,bodyColor:null,initialMileageKm:null,purchaseAmount:null,purchaserName:null,purchaseDate:null,nextInspectionDate:null};
const fields=Object.keys(inventory);
const pickInventory=(view:any)=>Object.fromEntries(fields.map(field=>[field,view[field]]));
const patchBody=(revision=0)=>({...assetCommand(revision),vehicleRevision:3});

test('inventory parser accepts each sole editable field, trims text, and preserves omitted versus explicit null',()=>{
 for(const [field,value]of Object.entries(inventory))assert.equal(profilePatchInput.safeParse({...patchBody(),[field]:value}).success,true,field);
 const input:any=profilePatchInput.parse({...patchBody(),...inventory,engineNumber:'  SYNTHETIC-ENGINE-001  ',bodyColor:' 合成灰色 ',purchaserName:' 合成购车人 '});
 assert.deepEqual(pickInventory(input),inventory);
 const omitted=profilePatchInput.parse({...patchBody(),notes:'只改备注'});
 for(const field of fields)assert.equal(Object.hasOwn(omitted,field),false,field);
 assert.deepEqual(pickInventory(profilePatchInput.parse({...patchBody(),...emptyInventory})),emptyInventory);
 assert.equal(profilePatchInput.safeParse(patchBody()).success,false);
});

test('inventory text validation rejects blank, NUL, wrong types and overflow without weakening maximum-length inputs',()=>{
 for(const [field,max]of [['engineNumber',200],['bodyColor',100],['purchaserName',200]] as const){
  assert.equal((profilePatchInput.parse({...patchBody(),[field]:'字'.repeat(max)}) as any)[field].length,max);
  for(const value of ['', '  ', 'a\u0000b', '字'.repeat(max+1), 123, {}, []])assert.equal(profilePatchInput.safeParse({...patchBody(),[field]:value}).success,false,`${field}: ${JSON.stringify(value)}`);
 }
});

test('inventory integer facts allow zero and Int maximum without coercion, rounding or negative values',()=>{
 for(const field of ['initialMileageKm','purchaseAmount']){
  for(const value of [0,2147483647])assert.equal((profilePatchInput.parse({...patchBody(),[field]:value}) as any)[field],value);
  for(const value of [-1,0.1,2147483648,Number.MAX_SAFE_INTEGER,NaN,Infinity,'123','',false])assert.equal(profilePatchInput.safeParse({...patchBody(),[field]:value}).success,false,`${field}: ${String(value)}`);
 }
});

test('inventory dates require real exact calendar dates, including leap-century rules',()=>{
 for(const field of ['purchaseDate','nextInspectionDate']){
  for(const value of ['0001-01-01','2000-02-29','2024-02-29','9999-12-31'])assert.equal((profilePatchInput.parse({...patchBody(),[field]:value}) as any)[field],value);
  for(const value of ['2023-02-29','1900-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','0000-01-01','10000-01-01','2026-1-01','2026-01-1',' 2026-01-01','2026-01-01 ','2026-01-01T00:00:00Z','',123])assert.equal(profilePatchInput.safeParse({...patchBody(),[field]:value}).success,false,`${field}: ${String(value)}`);
 }
});

test('inventory GET returns explicit nulls before registration and for pre-migration empty profiles',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();
 const empty=await service.detail(f.tx,assetActor,'vehicle');assert.equal(empty.registered,false);assert.deepEqual(pickInventory(empty),emptyInventory);
 f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:4,batteryOwnership:'UNKNOWN',notes:''});
 const legacy=await service.detail(f.tx,assetActor,'vehicle');assert.equal(legacy.revision,4);assert.deepEqual(pickInventory(legacy),emptyInventory);
});

test('inventory save persists dates as Date, reads normalized values and audits without changing current vehicle facts',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();f.rows('vehicle')[0].mileageKm=76543;
 const vehicleBefore=structuredClone(f.rows('vehicle')[0]);
 const saved:any=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(),...inventory,engineNumber:' SYNTHETIC-ENGINE-001 ',purchaserName:' 合成购车人 '}));
 assert.deepEqual(pickInventory(saved),inventory);assert.equal(saved.revision,1);assert.equal(saved.vehicleRevision,3);
 assert.deepEqual(pickInventory(await service.detail(f.tx,assetAdmin,'vehicle')),inventory);
 const row=f.rows('vehicleAssetProfile')[0];assert.ok(row.purchaseDate instanceof Date);assert.equal(row.purchaseDate.toISOString(),'2024-02-29T00:00:00.000Z');assert.ok(row.nextInspectionDate instanceof Date);assert.equal(row.nextInspectionDate.toISOString(),'2028-02-29T00:00:00.000Z');
 assert.deepEqual(f.rows('vehicle')[0],vehicleBefore);
 const created=f.rows('auditLog')[0];assert.equal(created.data.before,null);assert.deepEqual(pickInventory(created.data.after),inventory);
 const changed={engineNumber:'SYNTHETIC-ENGINE-002',bodyColor:'合成白色',initialMileageKm:0,purchaseAmount:0,purchaserName:'另一合成购车人',purchaseDate:'2000-02-29',nextInspectionDate:'2030-12-31'};
 assert.deepEqual(pickInventory(await f.serial(tx=>service.patch(tx,assetAdmin,'vehicle',{...patchBody(1),...changed}))),changed);
 const edited=f.rows('auditLog')[1];assert.deepEqual(pickInventory(edited.data.before),inventory);assert.deepEqual(pickInventory(edited.data.after),changed);assert.equal(edited.actorId,assetAdmin.id);
 assert.deepEqual(f.rows('vehicle')[0],vehicleBefore);
});

test('inventory omitted fields remain unchanged while explicit null clears all fields with complete audit snapshots',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();
 await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(),...inventory}));
 const partial:any=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(1),notes:'仅改合成备注'}));assert.deepEqual(pickInventory(partial),inventory);
 const cleared:any=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(2),...emptyInventory}));assert.deepEqual(pickInventory(cleared),emptyInventory);
 assert.deepEqual(pickInventory(f.rows('vehicleAssetProfile')[0]),emptyInventory);
 const audit=f.rows('auditLog')[2];assert.deepEqual(pickInventory(audit.data.before),inventory);assert.deepEqual(pickInventory(audit.data.after),emptyInventory);
});

test('inventory FINANCE projection excludes both personal names and notes while denying writes, SUPPORT and FIELD reads',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService();
 await f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(),...inventory,registeredOwnerName:'合成登记人',notes:'合成内部备注'}));
 const read:any=await service.detail(f.tx,financeActor,'vehicle');
 for(const field of ['purchaserName','registeredOwnerName','notes'])assert.equal(Object.hasOwn(read,field),false,field);
 for(const field of fields.filter(field=>field!=='purchaserName'))assert.equal(read[field],(inventory as any)[field],field);
 const before=f.writes.length;
 await assert.rejects(f.serial(tx=>service.patch(tx,financeActor,'vehicle',{...patchBody(1),purchaseAmount:100})),assetError('FORBIDDEN'));
 for(const role of ['SUPPORT','FIELD'])await assert.rejects(service.detail(f.tx,{id:role.toLowerCase(),role,authVersion:1},'vehicle'),assetError('FORBIDDEN'));
 assert.equal(f.writes.length,before);
});

test('inventory keeps both revision checks and replay validation before current staff session changes',async()=>{
 const f=assetFixture(),service=new VehicleAssetsService(),body={...patchBody(),...inventory};
 const saved=await f.serial(tx=>service.patch(tx,assetActor,'vehicle',body)),before=f.writes.length;
 assert.deepEqual(await f.serial(tx=>service.patch(tx,assetActor,'vehicle',body)),saved);assert.equal(f.writes.length,before);
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...body,purchaseAmount:1})),assetError('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(0),bodyColor:'过期资产'})),assetError('REVISION_CONFLICT'));
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',{...patchBody(1),vehicleRevision:2,bodyColor:'过期车辆'})),assetError('REVISION_CONFLICT'));
 assert.equal(f.writes.length,before);assert.deepEqual(pickInventory(await service.detail(f.tx,assetActor,'vehicle')),inventory);
 f.rows('adminUser').find(row=>row.id===assetActor.id).authVersion=2;
 await assert.rejects(f.serial(tx=>service.patch(tx,assetActor,'vehicle',body)),assetError('STAFF_SESSION_CHANGED'));
 await assert.rejects(service.detail(f.tx,assetActor,'vehicle'),assetError('STAFF_SESSION_CHANGED'));
 assert.equal(f.writes.length,before);
});

test('inventory real HTTP and database roundtrip preserves private projections, revisions, replay and untouched vehicle mileage',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const {JourneyHarness,command}=await import('./seven-module-journey-fixtures');
 const h=new JourneyHarness();try{
  await h.start();
  const vehicle=await h.db.vehicle.create({data:{title:'合成库存资料测试',brand:'合成',model:'合成EV',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:76543,status:'DRAFT'}}),path='/admin/vehicle-assets/'+vehicle.id;
  assert.deepEqual(pickInventory(await h.get(path)),emptyInventory);
  const body={...command(),vehicleRevision:vehicle.revision,...inventory,registeredOwnerName:'合成登记人'};
  const writes=await Promise.all([h.raw(path,body,h.maker,'PATCH'),h.raw(path,body,h.maker,'PATCH')]);assert.deepEqual(writes.map(row=>row.status),[200,200]);assert.deepEqual(writes[0].data,writes[1].data);assert.deepEqual(pickInventory(writes[0].data),inventory);
  assert.deepEqual(pickInventory(await h.get(path)),inventory);
  const stored:any=await h.db.vehicleAssetProfile.findUniqueOrThrow({where:{vehicleId:vehicle.id}});assert.equal(stored.purchaseDate.toISOString(),'2024-02-29T00:00:00.000Z');assert.equal(stored.nextInspectionDate.toISOString(),'2028-02-29T00:00:00.000Z');
  const finance=await h.get(path,h.finance);for(const field of ['purchaserName','registeredOwnerName','notes'])assert.equal(Object.hasOwn(finance,field),false,field);for(const field of fields.filter(field=>field!=='purchaserName'))assert.equal(finance[field],(inventory as any)[field],field);
  await h.reject(path,{...command(1),vehicleRevision:0,purchaseAmount:1},h.finance,'FORBIDDEN','PATCH');await h.reject(path,undefined,h.field,'FORBIDDEN');
  await h.reject(path,{...body,purchaseAmount:1},h.maker,'IDEMPOTENCY_CONFLICT','PATCH');await h.reject(path,{...command(),vehicleRevision:0,bodyColor:'过期资产'},h.maker,'REVISION_CONFLICT','PATCH');await h.reject(path,{...command(1),vehicleRevision:1,bodyColor:'过期车辆'},h.maker,'REVISION_CONFLICT','PATCH');
  assert.equal(await h.db.auditLog.count({where:{resourceType:'vehicle-assets',resourceId:vehicle.id}}),1);
  assert.deepEqual(pickInventory(await h.post(path,{...command(1),vehicleRevision:0,notes:'合成部分更新'},h.maker,'PATCH')),inventory);
  const clear=await h.post(path,{...command(2),vehicleRevision:0,...emptyInventory},h.maker,'PATCH');assert.deepEqual(pickInventory(clear),emptyInventory);
  const audits=await h.db.auditLog.findMany({where:{resourceType:'vehicle-assets',resourceId:vehicle.id}}),clearAudit:any=audits.find(row=>(row.data as any).after.revision===3);assert.deepEqual(pickInventory(clearAudit.data.before),inventory);assert.deepEqual(pickInventory(clearAudit.data.after),emptyInventory);
  const vehicleAfter=await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}});assert.equal(vehicleAfter.mileageKm,76543);assert.equal(vehicleAfter.revision,0);
  await h.db.adminUser.update({where:{id:h.maker.id},data:{authVersion:{increment:1}}});await h.reject(path,body,h.maker,undefined,'PATCH');
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.payment.providerCalls,0);
 }finally{await h.close();}
});
