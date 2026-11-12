import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {AssetFilesController,requireAssetFiles} from '../src/files/asset-files';
import {allowed} from '../src/auth/role-policy';
import {FilesController} from '../src/files/files';
import {fileReadStore} from './file-store-fixture';

const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
const bytes=Buffer.from('%PDF-synthetic work order proof'),sha256=createHash('sha256').update(bytes).digest('hex');
const upload={originalname:'合成凭据.pdf',buffer:bytes,mimetype:'application/pdf',size:bytes.length} as Express.Multer.File;
function fixture(kind:'WORK_ORDER'|'WORK_ORDER_COST'|'COST'){
 const fields={WORK_ORDER:'workOrderId',WORK_ORDER_COST:'workOrderCostId',COST:'costEntryId'},purposes={WORK_ORDER:'asset-work-order',WORK_ORDER_COST:'asset-work-order-cost',COST:'asset-cost'};
 const staff={id:'staff',active:true,role:kind==='WORK_ORDER'?'OPERATIONS':'FINANCE',authVersion:1};
 const work:any={id:kind==='WORK_ORDER'?'parent':'work',vehicleId:'vehicle',revision:0,status:'IN_PROGRESS'};
 const line:any={id:kind==='WORK_ORDER_COST'?'parent':'line',workOrderId:work.id,vehicleId:'vehicle',revision:0,status:'DRAFT'};
 const entry:any={id:'parent',vehicleId:'vehicle',planId:'plan',revision:0,lockedAt:null};
 const parent=kind==='WORK_ORDER'?work:kind==='WORK_ORDER_COST'?line:entry;
 const file={id:'proof',name:'合成凭据.pdf',purpose:purposes[kind],mimeType:'application/pdf',size:bytes.length,sha256,customerId:null,adminId:staff.id,fieldTaskId:null};
 const binding:any={kind,fileId:file.id,baasContractId:null,depreciationPolicyId:null,costEntryId:null,licensePlateId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,[fields[kind]]:parent.id,uploadedBy:staff.id,sha256,file};
 const events:string[]=[],commands:any[]=[],bindings=[binding];
 const aggregate=(row:any)=>({findUnique:async()=>row,updateMany:async({where,data}:any)=>{if(where.revision!==row.revision)return{count:0};row.revision++;events.push('revision');return{count:1};}});
 const tx:any={adminUser:{findUnique:async()=>staff},assetWorkOrder:aggregate(work),assetWorkOrderCost:aggregate(line),assetCostEntry:aggregate(entry),assetCostPlan:{findUnique:async()=>({id:'plan',vehicleId:'vehicle',sourceKind:'WORK_ORDER',baasContractId:null,depreciationPolicyId:null,workOrderCostId:line.id})},
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findMany:async()=>bindings,create:async({data}:any)=>{bindings.push({...data,file});events.push('file-map');return data;}},storedFile:{create:async({data}:any)=>({id:'created-file',...data})},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>c.key===where.actorId_resourceId_action_key.key)??null,create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async()=>({})},
  $queryRaw:async(strings:TemplateStringsArray)=>{events.push(strings.join('?'));return[];},$executeRaw:async()=>0,serial:async(fn:any)=>fn(tx)};
 return{tx,staff,parent,work,line,binding,events,commands,bindings};
}
test('work order role matrix separates operational evidence from finance source lines',()=>{
 for(const role of ['ADMIN','OPERATIONS'])for(const resource of ['asset-work-orders','vehicle-maintenance'])assert(allowed(role,resource,true));
 assert(allowed('FINANCE','asset-work-orders',false));assert(!allowed('FINANCE','asset-work-orders',true));assert(!allowed('FINANCE','vehicle-maintenance',false));
 for(const resource of ['asset-work-order-costs','asset-work-order-cost-lines']){for(const role of ['ADMIN','FINANCE'])assert(allowed(role,resource,true));for(const role of ['OPERATIONS','SUPPORT','FIELD'])assert(!allowed(role,resource,false));}
 for(const resource of ['asset-work-orders','vehicle-maintenance'])for(const role of ['SUPPORT','FIELD'])assert(!allowed(role,resource,false));
});
test('eight-parent evidence rejects cross-domain aliases and finance files remain inaccessible to operations',async()=>{
 for(const kind of ['WORK_ORDER','WORK_ORDER_COST'] as const){const f=fixture(kind);assert.equal((await requireAssetFiles(f.tx,f.staff,{kind:kind as any,resourceId:'parent'}))[0].id,'proof');f.binding.valuationReviewId='unrelated';await assert.rejects(requireAssetFiles(f.tx,f.staff,{kind:kind as any,resourceId:'parent'}),code('ASSET_FILE_INVALID'));}
 const f=fixture('WORK_ORDER_COST');f.staff.role='OPERATIONS';await assert.rejects(requireAssetFiles(f.tx,f.staff,{kind:'WORK_ORDER_COST' as any,resourceId:'parent'}),code('FORBIDDEN'));
});
test('source uploads lock vehicle then true work order then line; frozen replay cannot append or survive revocation',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 const f=fixture('WORK_ORDER_COST'),controller=new AssetFilesController(f.tx) as any,input={revision:0,idempotencyKey:'synthetic-work-cost-key'};
 const first=await controller.uploadWorkOrderCost('parent',input,upload,{admin:{...f.staff}});assert.equal(f.parent.revision,1);assert.equal(f.events.filter(x=>x==='file-map').length,1);
 const locks=f.events.filter(x=>x.startsWith('SELECT'));assert.match(locks[0],/"Vehicle"/);assert.match(locks[1],/"AssetWorkOrder"/);assert.match(locks[2],/"AssetWorkOrderCost"/);
 f.parent.status='FROZEN';assert.deepEqual(await controller.uploadWorkOrderCost('parent',input,upload,{admin:{...f.staff}}),first);await assert.rejects(controller.uploadWorkOrderCost('parent',{revision:1,idempotencyKey:'another-source-key'},upload,{admin:{...f.staff}}),code('ASSET_SOURCE_CLOSED'));assert.equal(f.events.filter(x=>x==='file-map').length,1);
 const actor={...f.staff};f.staff.authVersion++;await assert.rejects(controller.uploadWorkOrderCost('parent',input,upload,{admin:actor}),code('STAFF_SESSION_CHANGED'));
 const other=fixture('WORK_ORDER_COST');other.work.vehicleId='other-vehicle';await assert.rejects((new AssetFilesController(other.tx) as any).uploadWorkOrderCost('parent',input,upload,{admin:other.staff}),code('ASSET_FILE_INVALID'));
});
test('terminal work orders reject new evidence while cost evidence retains work order source lock order',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 for(const status of ['CLOSED','CANCELLED']){const f=fixture('WORK_ORDER');f.parent.status=status;await assert.rejects((new AssetFilesController(f.tx) as any).uploadWorkOrder('parent',{revision:0,idempotencyKey:'terminal-proof-key'},upload,{admin:f.staff}),code('ASSET_SOURCE_CLOSED'));assert.equal(f.parent.revision,0);assert.equal((await requireAssetFiles(f.tx,f.staff,{kind:'WORK_ORDER' as any,resourceId:'parent'})).length,1);}
 const f=fixture('COST');await new AssetFilesController(f.tx).uploadCost('parent',{revision:0,idempotencyKey:'confirmed-cost-key'},upload,{admin:f.staff});const locks=f.events.filter(x=>x.startsWith('SELECT'));assert.deepEqual(locks.map(x=>x.match(/FROM "([^"]+)"/)?.[1]),['Vehicle','AssetWorkOrder','AssetWorkOrderCost','AssetCostPlan','AssetCostEntry']);
});
test('unmapped work-order purposes cannot use the generic admin file route',async()=>{
 for(const purpose of ['asset-work-order','asset-work-order-cost']){const tx:any=fileReadStore({storedFile:{findUnique:async()=>({id:'proof',purpose,adminId:'staff',customerId:null,mimeType:'application/pdf'})}});const controller=new FilesController(tx);(controller as any).stream=()=>({streamed:true});await assert.rejects(controller.adminRead('proof',{admin:{id:'staff',role:'ADMIN'}},{}),code('ASSET_FILE_ROUTE_REQUIRED'));}
});
