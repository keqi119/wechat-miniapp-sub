import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
const actor={id:'operator',role:'OPERATIONS',authVersion:1};
const code=(s:string)=>(e:any)=>e.getResponse?.().error?.code===s;
async function inspections(){const m:any=await import('../src/vehicle-inspections/service').catch(()=>({}));assert.equal(typeof m.InspectionService,'function','inspection service implements private versioned sources');return m;}
function fixture(){
 let sequence=0;const tables:any={vehicle:[{id:'car',revision:4,documentRevision:0,mediaFileIds:[],coverFileId:null,status:'PUBLISHED',reservedOrderId:null,holdId:null}],vehicleInspection:[],vehicleInspectionFile:[],vehicleDocumentFile:[],storedFile:[],archiveCommand:[],auditLog:[]};
 const matches=(r:any,w:any):boolean=>Object.entries(w||{}).every(([k,v]:any)=>k==='OR'?v.some((p:any)=>matches(r,p)):v&&typeof v==='object'&&'in'in v?v.in.includes(r[k]):v&&typeof v==='object'&&!Array.isArray(v)?matches(r,v):r[k]===v);
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},$queryRaw:async()=>[],$executeRaw:async()=>0,serial:async(f:any)=>f(tx)};
 for(const name of Object.keys(tables)){const rows=tables[name],join=(r:any)=>r&&({...r,...(name.endsWith('File')&&name!=='storedFile'?{file:tables.storedFile.find((f:any)=>f.id===r.fileId)}:{})});tx[name]={findUnique:async({where}:any)=>join(rows.find((r:any)=>matches(r,where))),findFirst:async({where}:any)=>join(rows.find((r:any)=>matches(r,where))),findMany:async({where}:any={})=>rows.filter((r:any)=>matches(r,where)).map(join),count:async({where}:any)=>rows.filter((r:any)=>matches(r,where)).length,create:async({data}:any)=>{const r={id:`id-${++sequence}`,createdAt:new Date(),updatedAt:new Date(),revision:0,...data};rows.push(r);return join(r);},updateMany:async({where,data}:any)=>{const selected=rows.filter((r:any)=>matches(r,where));for(const r of selected)for(const[k,v]of Object.entries(data))r[k]=v&&typeof v==='object'&&'increment'in v?r[k]+(v as any).increment:v;return{count:selected.length};},update:async({where,data}:any)=>{await tx[name].updateMany({where,data});return tx[name].findUnique({where});}};}
 tx.assetPrivateFile={count:async()=>0};
 return{tx,tables};
}
const body=(key:string)=>({revision:0,idempotencyKey:key,title:'第三方检测',provider:null,inspectedAt:'2026-11-03',description:'未发现车身修复',imageFileIds:[]});
test('inspection sources support multiple independent records, CAS and immutable per-goods snapshots',async()=>{
 const {InspectionService,buildInspectionSnapshots,inspectionSnapshotViews}=await inspections(),f=fixture(),s=new InspectionService();
 const a=await s.create(f.tx,actor,'car',body('create-first')),b=await s.create(f.tx,actor,'car',body('create-second'));assert.notEqual(a.id,b.id);
 const selected=await buildInspectionSnapshots(f.tx,'car',[{id:a.id,revision:0}]);assert.equal(selected[0].description,'未发现车身修复');
 await s.update(f.tx,actor,'car',a.id,{...body('update-first'),description:'新增复核结论'});
 assert.equal(inspectionSnapshotViews(selected,'goods','car')[0].description,'未发现车身修复');
 await assert.rejects(buildInspectionSnapshots(f.tx,'car',[{id:a.id,revision:0}]),code('REVISION_CONFLICT'));
 await assert.rejects(s.update(f.tx,actor,'car',a.id,body('stale-update')),code('REVISION_CONFLICT'));
 assert.deepEqual(await buildInspectionSnapshots(f.tx,'car',[]),[]);assert.equal(f.tables.vehicle[0].revision,4);
 const bad=structuredClone(selected);bad[0].description='tampered';assert.throws(()=>inspectionSnapshotViews(bad,'goods','car'));
});
test('inspection inputs and file ownership fail closed and source mutation replays only for current staff',async()=>{
 const {InspectionService,requireInspectionFiles}=await inspections(),f=fixture(),s=new InspectionService(),input=body('create-replay');
 const first=await s.create(f.tx,actor,'car',input);assert.deepEqual(await s.create(f.tx,actor,'car',input),first);assert.equal(f.tables.vehicleInspection.length,1);
 await assert.rejects(s.create(f.tx,actor,'car',{...input,title:'changed'}),code('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(s.update(f.tx,actor,'other',first.id,body('cross-car')));
 await assert.rejects(s.create(f.tx,actor,'car',{...body('duplicate-images'),imageFileIds:['x','x']}));
 await assert.rejects(s.create(f.tx,actor,'car',{...body('bad-date'),inspectedAt:'2026-02-30'}));
 await assert.rejects(requireInspectionFiles(f.tx,'car',['foreign']));
 f.tx.adminUser.findUnique=async()=>({...actor,active:false});await assert.rejects(s.create(f.tx,actor,'car',input),code('STAFF_SESSION_CHANGED'));
});
test('dedicated inspection purposes cannot escape through generic file reads',async()=>{
 const {FilesController}=await import('../src/files/files');
 const c=new FilesController({storedFile:{findUnique:async()=>({purpose:'vehicle-inspection'})}} as any);
 await assert.rejects(c.adminRead('file',{},{}),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
 await assert.rejects(c.customerRead('file',{},{}),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
});
test('photo uploads atomically append, choose only the first cover, replay, and respect occupied vehicles',async t=>{
 const m:any=await import('../src/vehicle-photos/controller').catch(()=>({}));assert.equal(typeof m.VehiclePhotosController,'function','dedicated gallery controller exists');
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 const f=fixture(),c=new m.VehiclePhotosController(f.tx),buffer=Buffer.from([137,80,78,71,13,10,26,10,0]),file={buffer,size:buffer.length,mimetype:'image/png',originalname:'照片.png'};
 const first=await c.upload('car',{revision:4,idempotencyKey:'first-photo'},file,{admin:actor});assert.equal(first.vehicleRevision,5);assert.equal(first.coverFileId,first.mediaFileIds[0]);
 assert.deepEqual(await c.upload('car',{revision:4,idempotencyKey:'first-photo'},file,{admin:actor}),first);assert.equal(f.tables.storedFile.length,1);
 const next=await c.upload('car',{revision:5,idempotencyKey:'second-photo'},file,{admin:actor});assert.equal(next.coverFileId,first.coverFileId);assert.equal(next.mediaFileIds.length,2);
 await assert.rejects(c.update('car',{revision:6,idempotencyKey:'foreign-photo',mediaFileIds:['foreign'],coverFileId:'foreign'},{admin:actor}));
 f.tables.vehicle[0].holdId='held';await assert.rejects(c.upload('car',{revision:6,idempotencyKey:'held-photo'},file,{admin:actor}),code('VEHICLE_RESERVED'));
});
test('document reclassification preserves original file identity and increments only document revision',async()=>{
 const {VehicleDocumentsController}=await import('../src/vehicle-documents/vehicle-documents');
 const f=fixture(),c:any=new VehicleDocumentsController(f.tx);assert.equal(typeof c.category,'function','category action exists');
 const sha='a'.repeat(64);f.tables.storedFile.push({id:'doc',purpose:'vehicle-document',customerId:null,adminId:actor.id,fieldTaskId:null,name:'购车.pdf',mimeType:'application/pdf',size:8,sha256:sha});f.tables.vehicleDocumentFile.push({fileId:'doc',vehicleId:'car',sha256:sha,uploadedBy:actor.id,category:'PURCHASE',sourceRelativePath:'购车.pdf',createdAt:new Date()});
 const input={revision:0,vehicleRevision:4,idempotencyKey:'classify-doc',category:'INVOICE'},before=JSON.stringify(f.tables.storedFile);
 const result=await c.category('car','doc',input,{admin:actor});assert.equal(result.category,'INVOICE');assert.equal(result.revision,1);assert.equal(f.tables.vehicle[0].revision,4);assert.equal(JSON.stringify(f.tables.storedFile),before);
 assert.deepEqual(await c.category('car','doc',input,{admin:actor}),result);
});

test('source selection rejects other vehicles, duplicate selections, over-limit images and non-image bytes',async()=>{
 const {InspectionService,buildInspectionSnapshots}=await inspections(),f=fixture(),s=new InspectionService();
 const one=await s.create(f.tx,actor,'car',body('limit-source'));
 await assert.rejects(buildInspectionSnapshots(f.tx,'other',[{id:one.id,revision:0}]),code('INSPECTION_SOURCE_INVALID'));
 await assert.rejects(buildInspectionSnapshots(f.tx,'car',[{id:one.id,revision:0},{id:one.id,revision:0}]));
 await assert.rejects(s.create(f.tx,actor,'car',{...body('too-many-images'),imageFileIds:Array.from({length:21},(_,i)=>'f'+i)}));
 const {validateImageUpload}=await import('../src/vehicle-inspections/controller');
 for(const [buffer,mimetype]of [[Buffer.from('%PDF-'), 'application/pdf'],[Buffer.from('fake'),'image/png'],[Buffer.alloc(0),'image/jpeg']]as const)assert.throws(()=>validateImageUpload({buffer,mimetype,size:buffer.length}as any),code('IMAGE_INVALID'));
});

test('inspection binding remains private when purpose is corrupted, including cross-business evidence reuse',async()=>{
 const {FilesController}=await import('../src/files/files'),{fileReadStore}=await import('./file-store-fixture'),{assertNotAssetFiles}=await import('../src/files/asset-files');
 const file={id:'inspection-file',purpose:'vehicle',customerId:null,mimeType:'image/png'};
 const tx:any=fileReadStore({storedFile:{findUnique:async()=>file,findFirst:async()=>file,count:async()=>0},vehicleInspectionFile:{count:async()=>1},vehicle:{count:async()=>1}}),c=new FilesController(tx);
 await assert.rejects(c.adminRead(file.id,{admin:actor},{}),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
 await assert.rejects(c.customerRead(file.id,{customer:{id:'customer'}},{}),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
 await assert.rejects(c.media(file.id,{}),code('NOT_FOUND'));await assert.rejects(assertNotAssetFiles(tx,[file.id]),code('VEHICLE_INSPECTION_ROUTE_REQUIRED'));
});

test('photo gallery includes a separate historical cover and rejects its twenty-first upload',async t=>{
 const {VehiclePhotosController}=await import('../src/vehicle-photos/controller');t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 const f=fixture(),c=new VehiclePhotosController(f.tx);f.tables.storedFile.push({id:'historical',purpose:'vehicle',customerId:null,adminId:actor.id,name:'旧封面.png',mimeType:'image/png',size:9,sha256:'a'.repeat(64)});f.tables.vehicle[0].coverFileId='historical';
 const gallery=await c.list('car',{admin:actor});assert.deepEqual(gallery.mediaFileIds,[]);assert.deepEqual(gallery.items.map((f:any)=>f.id),['historical']);
 const changed=await c.update('car',{revision:4,idempotencyKey:'reuse-historical',coverFileId:'historical',mediaFileIds:['historical']},{admin:actor});assert.equal(changed.items.length,1);
 f.tables.vehicle[0].mediaFileIds=Array.from({length:20},(_,i)=>'photo'+i);const buffer=Buffer.from([137,80,78,71,13,10,26,10,0]);
 await assert.rejects(c.upload('car',{revision:5,idempotencyKey:'twenty-first'},{buffer,size:9,mimetype:'image/png',originalname:'太多.png'}as any,{admin:actor}),code('PHOTO_LIMIT'));
});
