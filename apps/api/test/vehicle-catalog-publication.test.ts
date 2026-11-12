import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminController} from '../src/operations/admin';
import {GoodsService} from '../src/goods/service';
import {addPublicationFacts} from './publish-readiness-fixture';
import {versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const code=(c:string)=>(e:any)=>e.getResponse?.().error?.code===c;
function fixture(){
 const vehicle:any={id:'vehicle',vin:'LNDTEST0000000001',revision:1,status:'PUBLISHED',catalogPublished:false,holdId:null,reservedOrderId:null},actor:any={id:'operator',role:'OPERATIONS',authVersion:1,active:true},locks:string[]=[],commands:any[]=[],audits:any[]=[];
 const version:any={id:'version',productId:'product',version:1,status:'PUBLISHED',name:'合成方案',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'合成约定',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]},snapshot=versionSnapshot(version),plan:any={id:'plan',vehicleId:vehicle.id,productVersionId:version.id,active:true},listing:any={id:'goods',vehicleId:vehicle.id,subscriptionPlanId:plan.id,productVersionId:version.id,revision:0,status:'PUBLISHED',source:'EXPLICIT',visible:true,snapshot,productSourceHash:canonicalHash(snapshot)};
 const match=(row:any,w:any)=>Object.entries(w).every(([k,v])=>row[k]===v),update=(row:any,w:any,data:any)=>{if(!match(row,w))return{count:0};for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+(v as any).increment:v;return{count:1};},joined=()=>({...listing,vehicle,productVersion:version,subscriptionPlan:plan});
 const tx:any={adminUser:{findUnique:async()=>({...actor})},$queryRaw:async(strings:any)=>{locks.push(strings.join('?'));return[];},vehicle:{findUnique:async()=>({...vehicle}),updateMany:async({where,data}:any)=>update(vehicle,where,data),update:async({data}:any)=>{update(vehicle,{id:vehicle.id},data);return{...vehicle};}},vehicleListing:{findMany:async()=>[joined()],findUnique:async()=>joined(),updateMany:async({where,data}:any)=>update(listing,where,data)},subscriptionPlan:{updateMany:async({data}:any)=>update(plan,{id:plan.id},data)},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
 archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>match(c,where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.push(data);return data;}},productCommand:{findUnique:async({where}:any)=>commands.find(c=>match(c,where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.push(data);return data;}}};
 const facts=addPublicationFacts(tx,vehicle),isolated=resolve(dirname(facts.publicFile.storagePath),'catalog-'+randomUUID());mkdirSync(isolated,{recursive:true});for(const file of facts.files){const bytes=file.mimeType==='image/png'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9fcAAAAASUVORK5CYII=','base64'):Buffer.from('%PDF-1.4 synthetic '+file.id.slice(5));file.storagePath=resolve(isolated,file.id);writeFileSync(file.storagePath,bytes);}
 const controller:any=new AdminController({serial:async(fn:any)=>fn(tx)} as any),request={admin:actor};return{...facts,vehicle,actor,locks,commands,audits,plan,listing,version,tx,controller,request};
}
test('only explicit parent publish changes the catalog flag with current dual RBAC, CAS, lock order, audit and exact replay',async()=>{
 const f=fixture(),body={revision:1,idempotencyKey:'catalog-publish-once',reason:'核对商品资料'};assert.equal(typeof f.controller.publishVehicleCatalog,'function');assert.equal(typeof f.controller.catalogReadiness,'function');
 const readiness=await f.controller.catalogReadiness(f.vehicle.id,f.request);assert.equal(readiness.ready,true);assert.equal(readiness.catalogPublished,false);assert.equal(readiness.vehicleActivated,true);assert.equal(readiness.publishedPlanCount,1);assert.equal(readiness.checks.length,6);
 f.condition.fireDamage=true;const result=await f.controller.publishVehicleCatalog(f.vehicle.id,f.request,body);assert.equal(result.catalogPublished,true);assert.equal(result.status,'PUBLISHED');assert.equal(result.revision,2);assert.equal(f.plan.active,true);assert.equal(f.listing.status,'PUBLISHED');assert.equal(f.listing.revision,1);assert.equal(f.listing.basicConditionSnapshot.fireDamage,true);assert.equal(f.listing.basicConditionSnapshot.sourceRevision,f.condition.revision);assert.match(f.locks[0],/Vehicle/);assert.match(f.locks[1],/VehicleListing/);
 assert.deepEqual(await f.controller.publishVehicleCatalog(f.vehicle.id,f.request,body),result);assert.equal(f.audits.length,1);assert.equal(f.commands.length,1);await assert.rejects(f.controller.publishVehicleCatalog(f.vehicle.id,f.request,{...body,reason:'改内容'}),code('IDEMPOTENCY_CONFLICT'));
 f.actor.active=false;await assert.rejects(f.controller.publishVehicleCatalog(f.vehicle.id,f.request,body),code('STAFF_SESSION_CHANGED'));
});
test('parent publication requires activation, all six readiness categories and a confirmed source-valid public plan',async()=>{
 for(const kind of ['inactive-vehicle','draft-plan','hidden-plan','corrupt-source','condition','held']){const f=fixture();assert.equal(typeof f.controller.publishVehicleCatalog,'function');if(kind==='inactive-vehicle')f.vehicle.status='DRAFT';if(kind==='draft-plan')f.listing.status='DRAFT';if(kind==='hidden-plan')f.listing.visible=false;if(kind==='corrupt-source')f.listing.productSourceHash='wrong';if(kind==='condition')f.condition.fireDamage=null;if(kind==='held')f.vehicle.holdId='synthetic-hold';
  await assert.rejects(f.controller.publishVehicleCatalog(f.vehicle.id,f.request,{revision:1,idempotencyKey:'reject-'+kind}),code(kind==='inactive-vehicle'?'VEHICLE_NOT_ACTIVATED':kind==='condition'?'PUBLISH_REQUIREMENTS':kind==='held'?'VEHICLE_RESERVED':'CATALOG_PLAN_REQUIRED'));assert.equal(f.vehicle.catalogPublished,false);assert.equal(f.vehicle.revision,1);assert.equal(f.audits.length,0);assert.equal(f.commands.length,0);
 }
 const f=fixture();f.actor.role='FINANCE';await assert.rejects(f.controller.publishVehicleCatalog(f.vehicle.id,f.request,{revision:1,idempotencyKey:'finance-denied'}),code('FORBIDDEN'));
});
test('parent withdrawal is separate from scheme/activation state and must precede deactivating an already listed vehicle',async()=>{
 const f=fixture();assert.equal(typeof f.controller.withdrawVehicleCatalog,'function');f.vehicle.catalogPublished=true;
 await assert.rejects(f.controller.unpublishVehicle(f.vehicle.id,f.request,{revision:1,idempotencyKey:'reject-other-entry'}),code('CATALOG_WITHDRAW_REQUIRED'));
 f.vehicle.holdId='synthetic-hold';const result=await f.controller.withdrawVehicleCatalog(f.vehicle.id,f.request,{revision:1,idempotencyKey:'parent-withdraw-once'});assert.equal(result.catalogPublished,false);assert.equal(result.status,'PUBLISHED');assert.equal(f.listing.status,'PUBLISHED');assert.equal(f.plan.active,true);assert.equal(f.listing.revision,0);
 f.vehicle.holdId=null;await f.controller.unpublishVehicle(f.vehicle.id,f.request,{revision:2,idempotencyKey:'deactivate-after-withdraw'});assert.equal(f.vehicle.status,'UNPUBLISHED');assert.equal(f.vehicle.catalogPublished,false);
});
test('legacy activation, single-scheme publish and ordinary metadata cannot open the parent catalog switch',async()=>{
 const f=fixture();f.vehicle.status='DRAFT';const oldSnapshot={historical:'preserve'};f.listing.basicConditionSnapshot=oldSnapshot;await f.controller.publishVehicle(f.vehicle.id,f.request,{revision:1,idempotencyKey:'vehicle-activate-only'});assert.equal(f.vehicle.status,'PUBLISHED');assert.equal(f.vehicle.catalogPublished,false);assert.deepEqual(f.listing.basicConditionSnapshot,oldSnapshot);f.listing.status='DRAFT';f.plan.active=false;
 try{await new GoodsService().publish(f.tx,f.actor,f.listing.id,{revision:f.listing.revision,idempotencyKey:'scheme-publish-only'});}catch(error:any){throw new Error(JSON.stringify(error.getResponse?.()??error.message));}assert.equal(f.listing.status,'PUBLISHED');assert.equal(f.plan.active,true);assert.equal(f.vehicle.catalogPublished,false);
 await assert.rejects(f.controller.patch('vehicles',f.vehicle.id,{revision:f.vehicle.revision,idempotencyKey:'metadata-cannot-open',catalogPublished:true},f.request));assert.equal(f.vehicle.catalogPublished,false);
 await assert.rejects(f.controller.create('vehicles',{brand:'合成',model:'合成',title:'合成',vin:'LNDTEST0000000002',year:2026,city:'上海',mileageKm:0,mediaFileIds:[],revision:0,idempotencyKey:'create-cannot-open',catalogPublished:true},f.request));
});
test('activation and a hidden parent scheme can be prepared without acquiring the whole catalog seven-category gate',async()=>{
 const f=fixture();f.vehicle.status='DRAFT';f.vehicle.coverFileId=null;f.vehicle.mediaFileIds=[];f.owner.contactPhone='';f.policies.length=0;f.condition.fireDamage=null;f.listing.status='DRAFT';f.plan.active=false;assert.equal(typeof f.controller.activationReadiness,'function');
 const activation=await f.controller.activationReadiness(f.vehicle.id,f.request);assert.equal(activation.ready,true);assert.deepEqual(activation.checks.map((v:any)=>v.key),['VEHICLE_INFO']);await f.controller.publishVehicle(f.vehicle.id,f.request,{revision:1,idempotencyKey:'base-only-activate'});assert.equal(f.vehicle.status,'PUBLISHED');assert.equal(f.vehicle.catalogPublished,false);
 const result=await new GoodsService().publish(f.tx,f.actor,f.listing.id,{revision:0,idempotencyKey:'prepare-hidden-parent-scheme'});assert.equal(result.status,'PUBLISHED');assert.equal(f.listing.basicConditionSnapshot,undefined);assert.equal(f.vehicle.catalogPublished,false);
 await assert.rejects(f.controller.publishVehicleCatalog(f.vehicle.id,f.request,{revision:2,idempotencyKey:'whole-catalog-still-checks'}),code('PUBLISH_REQUIREMENTS'));
});
test('publishing a new scheme under a live parent rechecks seven categories and freezes current basic condition',async()=>{
 const f=fixture();f.vehicle.catalogPublished=true;f.listing.status='DRAFT';f.plan.active=false;f.owner.contactPhone='';const input={revision:0,idempotencyKey:'new-public-scheme'};
 await assert.rejects(new GoodsService().publish(f.tx,f.actor,f.listing.id,input),code('PUBLISH_REQUIREMENTS'));assert.equal(f.listing.status,'DRAFT');f.owner.contactPhone='13800000000';f.condition.fireDamage=true;f.condition.revision=2;await new GoodsService().publish(f.tx,f.actor,f.listing.id,input);assert.equal(f.listing.basicConditionSnapshot.fireDamage,true);assert.equal(f.listing.basicConditionSnapshot.sourceRevision,2);assert.equal(f.vehicle.catalogPublished,true);
});
test('a hidden scheme under a live parent may be prepared without catalog materials and remains absent from App',async()=>{
 const f=fixture();f.vehicle.catalogPublished=true;f.listing.status='DRAFT';f.listing.visible=false;f.plan.active=false;f.owner.contactPhone='';f.condition.fireDamage=null;
 const result=await new GoodsService().publish(f.tx,f.actor,f.listing.id,{revision:0,idempotencyKey:'prepare-hidden-live-parent'});assert.equal(result.status,'PUBLISHED');assert.equal(result.appDisplay.visible,false);assert(result.appDisplay.reasons.some((r:any)=>r.code==='DISPLAY_DISABLED'));assert.equal(f.listing.basicConditionSnapshot,undefined);assert.equal(f.vehicle.catalogPublished,true);
});
test('revealing a published hidden scheme under a live parent is an atomic publication gate while draft and parent-off edits remain metadata',async()=>{
 const f=fixture();f.vehicle.catalogPublished=true;f.listing.visible=false;f.owner.contactPhone='';const input={revision:0,idempotencyKey:'reveal-live-scheme',visible:true};
 await assert.rejects(new GoodsService().update(f.tx,f.actor,f.listing.id,input),code('PUBLISH_REQUIREMENTS'));assert.equal(f.listing.visible,false);f.owner.contactPhone='13800000000';f.condition.floodDamage=true;f.locks.length=0;await new GoodsService().update(f.tx,f.actor,f.listing.id,input);assert.equal(f.listing.basicConditionSnapshot.floodDamage,true);assert.match(f.locks[0],/Vehicle/);assert.match(f.locks[1],/VehicleListing/);
 for(const draft of [false,true]){const g=fixture();g.vehicle.catalogPublished=draft;g.listing.visible=false;g.listing.status=draft?'DRAFT':'PUBLISHED';g.owner.contactPhone='';g.condition.fireDamage=null;await new GoodsService().update(g.tx,g.actor,g.listing.id,{revision:0,idempotencyKey:'metadata-'+String(draft),visible:true});assert.equal(g.listing.visible,true);assert.equal(g.listing.basicConditionSnapshot,undefined);}
});

test('catalog parent switch accepts a fully prepared uninsured car without reading insurance',async()=>{const f=fixture();f.tx.insurancePolicy.findMany=async()=>{throw Error('no insurance gate at publication');};assert.equal((await f.controller.catalogReadiness(f.vehicle.id,f.request)).ready,true);assert.equal((await f.controller.publishVehicleCatalog(f.vehicle.id,f.request,{revision:1,idempotencyKey:'uninsured-catalog'})).catalogPublished,true);});
