import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {AssetFilesController,requireAssetFiles,assertNotAssetFiles} from '../src/files/asset-files';
import {FilesController} from '../src/files/files';
import {fileReadStore} from './file-store-fixture';

const actor={id:'operator',role:'ADMIN',authVersion:2},bytes=Buffer.from('%PDF-local synthetic'),digest=createHash('sha256').update(bytes).digest('hex');
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
const purposes={BAAS:'asset-baas',DEPRECIATION:'asset-depreciation',COST:'asset-cost'};
function store(kind:'BAAS'|'DEPRECIATION'|'COST'='BAAS'){
 const parent:any={id:'parent',vehicleId:'vehicle',planId:'plan',revision:3,amount:12345,lockedAt:null};
 const file:any={id:'file',name:'合同.pdf',mimeType:'application/pdf',size:bytes.length,sha256:digest,purpose:purposes[kind],customerId:null,adminId:actor.id,fieldTaskId:null,storagePath:'private-not-a-dto'};
 const binding:any={fileId:'file',kind,baasContractId:null,depreciationPolicyId:null,costEntryId:null,licensePlateId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,sha256:digest,uploadedBy:actor.id,file};binding[{BAAS:'baasContractId',DEPRECIATION:'depreciationPolicyId',COST:'costEntryId'}[kind]]='parent';
 const bindings:any[]=[binding],commands:any[]=[],events:string[]=[];let active=true,role=actor.role,authVersion=2;
 const aggregate={findUnique:async()=>parent,updateMany:async({where,data}:any)=>{events.push('revision');if(where.revision!==parent.revision)return{count:0};parent.revision+=data.revision.increment;return{count:1};}};
 const tx:any={adminUser:{findUnique:async()=>({id:actor.id,active,role,authVersion})},vehicle:{findUnique:async()=>({id:'vehicle'})},vehicleBaasContract:aggregate,vehicleDepreciationPolicy:aggregate,assetCostEntry:aggregate,
  assetCostPlan:{findUnique:async()=>({id:'plan',vehicleId:'vehicle',sourceKind:'BAAS',baasContractId:'source'})},
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findUnique:async()=>bindings[0]??null,findMany:async({where}:any)=>bindings.filter(b=>!where?.fileId?.in||where.fileId.in.includes(b.fileId)),count:async()=>bindings.length,create:async({data}:any)=>{events.push('binding');const b={...data,file};bindings.push(b);return b;}},
  storedFile:{create:async({data}:any)=>{events.push('file');return{id:'new-file',...data};}},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>c.key===where.actorId_resourceId_action_key.key)??null,create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async()=>{events.push('audit');return{};}},$queryRaw:async()=>[],
  $executeRaw:async()=>0,serial:async(fn:any)=>fn(tx)};
 return{tx,parent,file,binding,bindings,commands,events,revoke:()=>{active=false;},changeRole:(r:string)=>{role=r;},changeVersion:()=>{authVersion++;}};
}
const upload=()=>({originalname:'test.pdf',buffer:bytes,mimetype:'application/pdf',size:bytes.length} as Express.Multer.File);
test('asset manifest is scoped, sorted and exposes no storage paths',async()=>{
 for(const kind of ['BAAS','DEPRECIATION','COST'] as const){const s=store(kind),manifest=await requireAssetFiles(s.tx,actor,{kind,resourceId:'parent',required:true});assert.deepEqual(manifest,[{id:'file',name:'合同.pdf',mimeType:'application/pdf',size:bytes.length,sha256:digest}]);}
});
test('asset reads require current session, explicit auth version and resource role',async()=>{
 for(const change of [(s:any)=>s.revoke(),(s:any)=>s.changeVersion(),(s:any)=>s.changeRole('SUPPORT')]){const s=store();change(s);await assert.rejects(requireAssetFiles(s.tx,actor,{kind:'BAAS',resourceId:'parent'}),code('STAFF_SESSION_CHANGED'));}
 const s=store();await assert.rejects(requireAssetFiles(s.tx,{id:actor.id,role:'ADMIN'},{kind:'BAAS',resourceId:'parent'}),code('STAFF_SESSION_CHANGED'));
 s.changeRole('FIELD');await assert.rejects(requireAssetFiles(s.tx,{...actor,role:'FIELD'},{kind:'BAAS',resourceId:'parent'}),code('FORBIDDEN'));
});
test('asset manifest rejects absent, cross-parent, cross-kind, conflicting and corrupt evidence',async()=>{
 const mutations=[(s:any)=>{s.binding.baasContractId='other';},(s:any)=>{s.binding.kind='COST';},(s:any)=>{s.binding.costEntryId='other';},(s:any)=>{s.binding.fileId='other';},(s:any)=>{s.file.purpose='vehicle';},(s:any)=>{s.file.customerId='customer';},(s:any)=>{s.file.fieldTaskId='task';},(s:any)=>{s.file.adminId=null;},(s:any)=>{s.binding.uploadedBy='other';},(s:any)=>{s.binding.sha256='a'.repeat(64);},(s:any)=>{s.file.sha256='invalid';},(s:any)=>{s.file.size=0;},(s:any)=>{s.file.size=10*1024*1024+1;},(s:any)=>{s.file.mimeType='text/html';}];
 for(const mutation of mutations){const s=store();mutation(s);await assert.rejects(requireAssetFiles(s.tx,actor,{kind:'BAAS',resourceId:'parent',fileIds:['file'],required:true}),code('ASSET_FILE_INVALID'));}
 const s=store();s.bindings.length=0;assert.deepEqual(await requireAssetFiles(s.tx,actor,{kind:'BAAS',resourceId:'parent'}),[]);await assert.rejects(requireAssetFiles(s.tx,actor,{kind:'BAAS',resourceId:'parent',required:true}),code('ASSET_FILES_REQUIRED'));await assert.rejects(requireAssetFiles(s.tx,actor,{kind:'BAAS',resourceId:'parent',fileIds:['missing']}),code('ASSET_FILE_INVALID'));
 await assert.rejects(requireAssetFiles(store().tx,actor,{kind:'BAAS',resourceId:'parent',fileIds:['file','file']}));
});
test('mapped private assets cannot escape generic admin, customer or public media even with vehicle purpose',async()=>{
 const file={id:'file',purpose:'vehicle',mimeType:'image/png',customerId:'customer'},tx:any=fileReadStore({storedFile:{findUnique:async()=>file,findFirst:async()=>({...file,customerId:null})},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findUnique:async()=>({fileId:'file'}),count:async()=>1},vehicle:{count:async()=>1}}),response={setHeader(){},sendFile(){throw new Error('private asset streamed');}},controller=new FilesController(tx);
 await assert.rejects(controller.adminRead('file',{admin:actor},response),code('ASSET_FILE_ROUTE_REQUIRED'));await assert.rejects(controller.customerRead('file',{customer:{id:'customer'}},response),code('ASSET_FILE_ROUTE_REQUIRED'));await assert.rejects(controller.media('file',response),code('NOT_FOUND'));await assert.rejects(assertNotAssetFiles(tx,['file']),code('ASSET_FILE_ROUTE_REQUIRED'));
});
test('generic uploads reject all private asset purposes before disk writes',async t=>{
 t.mock.method(fs,'writeFile',async()=>{throw new Error('must not save');});for(const purpose of Object.values(purposes)){await assert.rejects(new FilesController({} as any).adminUpload(upload(),{admin:actor,body:{purpose}}),code('FILE_PURPOSE'));}
});
test('dedicated uploads save before transaction, revise parent only once and replay with bytes-bound idempotency',async t=>{
 const s=store();let inside=false;t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>{assert.equal(inside,false);s.events.push('disk');});s.tx.serial=async(fn:any)=>{inside=true;try{return await fn(s.tx);}finally{inside=false;}};
 const c=new AssetFilesController(s.tx),input={revision:3,idempotencyKey:'upload-key'},first=await c.uploadBaas('parent',input,upload(),{admin:actor});assert.equal(first.id,'new-file');assert.equal(first.revision,4);assert.equal(s.parent.amount,12345);assert.equal(JSON.stringify(first).includes('storagePath'),false);assert(s.events.indexOf('disk')<s.events.indexOf('file'));assert.deepEqual(await c.uploadBaas('parent',input,upload(),{admin:actor}),first);assert.equal(s.parent.revision,4);assert.equal(s.events.filter(e=>e==='binding').length,1);
 const changed=Buffer.from('%PDF-different');await assert.rejects(c.uploadBaas('parent',input,{...upload(),buffer:changed,size:changed.length},{admin:actor}),code('IDEMPOTENCY_CONFLICT'));s.revoke();await assert.rejects(c.uploadBaas('parent',input,upload(),{admin:actor}),code('STAFF_SESSION_CHANGED'));
});
test('dedicated upload rechecks auth after saving and never edits locked cost or stale aggregate',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);const s=store();t.mock.method(fs,'writeFile',async()=>{s.revoke();});await assert.rejects(new AssetFilesController(s.tx).uploadBaas('parent',{revision:3,idempotencyKey:'upload-key'},upload(),{admin:actor}),code('STAFF_SESSION_CHANGED'));assert.deepEqual(s.events,[]);
 t.mock.method(fs,'writeFile',async()=>undefined);const cost=store('COST');cost.parent.lockedAt=new Date();await assert.rejects(new AssetFilesController(cost.tx).uploadCost('parent',{revision:3,idempotencyKey:'upload-key'},upload(),{admin:actor}),code('ASSET_COST_LOCKED'));assert(!cost.events.includes('file'));
 const stale=store();await assert.rejects(new AssetFilesController(stale.tx).uploadBaas('parent',{revision:2,idempotencyKey:'upload-key'},upload(),{admin:actor}),code('REVISION_CONFLICT'));assert(!stale.events.includes('file'));
});
test('dedicated upload validates magic bytes, size and exact command fields',async()=>{
 const c=new AssetFilesController(store().tx);for(const file of [{...upload(),buffer:Buffer.from('not-pdf')},{...upload(),size:1},{...upload(),buffer:Buffer.alloc(10*1024*1024+1),size:10*1024*1024+1}])await assert.rejects(c.uploadBaas('parent',{revision:3,idempotencyKey:'upload-key'},file,{admin:actor}),code('ASSET_FILE_INVALID'));
 await assert.rejects(c.uploadBaas('parent',{revision:3,idempotencyKey:'upload-key',amount:100},upload(),{admin:actor}));
});
test('dedicated lists and downloads keep current read permissions and resource scope',async()=>{
 for(const [kind,role,allowed] of [['BAAS','FINANCE',true],['BAAS','OPERATIONS',true],['DEPRECIATION','FINANCE',true],['DEPRECIATION','OPERATIONS',false],['COST','FINANCE',true],['COST','OPERATIONS',false],['BAAS','SUPPORT',false]] as const){
  const s=store(kind);s.changeRole(role);const c=new AssetFilesController(s.tx),request={admin:{...actor,role}},method={BAAS:'listBaas',DEPRECIATION:'listDepreciation',COST:'listCost'}[kind] as 'listBaas';
  if(allowed){const result=await c[method]('parent',request);assert.equal(result.items[0].id,'file');assert.equal(result.revision,3);assert.equal(JSON.stringify(result).includes('storagePath'),false);}else await assert.rejects(c[method]('parent',request),code('FORBIDDEN'));
 }
 const s=store(),c=new AssetFilesController(s.tx),response={setHeader(){},sendFile(){throw new Error('must not stream');}};s.binding.baasContractId='other';await assert.rejects(c.readBaas('parent','file',{admin:actor},response),code('ASSET_FILE_INVALID'));s.revoke();await assert.rejects(c.listBaas('parent',{admin:actor}),code('STAFF_SESSION_CHANGED'));
});
