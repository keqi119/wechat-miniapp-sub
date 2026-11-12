import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {VehicleDocumentsController} from '../src/vehicle-documents/vehicle-documents';
import {FilesController} from '../src/files/files';
import {assertNotAssetFiles} from '../src/files/asset-files';
import {fileReadStore} from './file-store-fixture';
import {projectRoot} from '../src/common/config';
import {Module} from '@nestjs/common';
import {NestFactory,APP_GUARD} from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {Db} from '../src/common/db';
import {Access} from '../src/auth/access';
import {tokenHash} from '../src/auth/auth.service';
import {Errors} from '../src/common/errors';

const actor={id:'material-operator',role:'ADMIN',authVersion:3};
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
const input={revision:2,vehicleRevision:9,idempotencyKey:'remove-request-key'};
const syntheticBytes=Buffer.from('%PDF-1.4 synthetic retained original');
const digest=createHash('sha256').update(syntheticBytes).digest('hex');
function store(mimeType='application/pdf'){
 const vehicle:any={id:'vehicle-a',revision:9,documentRevision:2,status:'PUBLISHED',mileageKm:234,mediaFileIds:['public-image'],coverFileId:'public-image'};
 const file:any={id:'original-a',name:'合成原件.pdf',mimeType,size:syntheticBytes.length,sha256:digest,storagePath:resolve(projectRoot,'var/uploads',digest.slice(0,2),digest),purpose:'vehicle-document',customerId:null,fieldTaskId:null,adminId:actor.id};
 const binding:any={fileId:file.id,vehicleId:vehicle.id,category:'REGISTRATION',sourceRelativePath:'historical/original.pdf',sha256:digest,uploadedBy:actor.id,removedAt:null,removedBy:null,createdAt:new Date('2026-11-03'),file};
 const rows=[binding],commands:any[]=[],audits:any[]=[],events:string[]=[];
 let current:any={...actor,active:true},cas=true,failAudit=false;
 const tx:any={
  adminUser:{findUnique:async()=>current},
  vehicle:{findUnique:async({where}:any)=>where.id===vehicle.id?vehicle:null,updateMany:async({where,data}:any)=>{events.push('vehicle-cas');assert.deepEqual(data,{documentRevision:{increment:1}});if(!cas||where.id!==vehicle.id||where.revision!==vehicle.revision||where.documentRevision!==vehicle.documentRevision)return{count:0};vehicle.documentRevision++;return{count:1};}},
  vehicleDocumentFile:{
   findUnique:async({where}:any)=>rows.find(row=>row.fileId===where.fileId)??null,
   findMany:async({where}:any)=>{assert.equal(where.removedAt,null);return rows.filter(row=>row.vehicleId===where.vehicleId&&row.removedAt===null);},
   update:async({where,data}:any)=>{events.push('soft-remove');const row=rows.find(item=>item.fileId===where.fileId);assert(row);Object.assign(row,data);return row;},
   updateMany:async({where,data}:any)=>{events.push('soft-remove');const row=rows.find(item=>item.fileId===where.fileId&&item.vehicleId===where.vehicleId&&item.removedAt===where.removedAt);if(!row)return{count:0};Object.assign(row,data);return{count:1};},
   delete:async()=>{throw Error('Original binding must remain');},
   count:async({where}:any)=>rows.filter(row=>typeof where.fileId==='string'?row.fileId===where.fileId:where.fileId.in.includes(row.fileId)).length,
  },
  storedFile:{findUnique:async()=>file,delete:async()=>{throw Error('Stored original must remain');}},
  archiveCommand:{findUnique:async({where}:any)=>{events.push('command-lookup');const key=where.actorId_resourceId_action_key;return commands.find(row=>row.actorId===key.actorId&&row.resourceId===key.resourceId&&row.action===key.action&&row.key===key.key)??null;},create:async({data}:any)=>{events.push('command-save');commands.push(data);return data;}},
  auditLog:{create:async({data}:any)=>{events.push('audit');if(failAudit)throw Error('synthetic audit failure');audits.push(data);return data;}},
  $executeRaw:async()=>{events.push('advisory-lock');return 0;},$queryRaw:async()=>{events.push('vehicle-lock');return[];},
  serial:async(fn:any)=>{const before={vehicle:{...vehicle},bindings:rows.map(row=>({...row})),commands:commands.length,audits:audits.length};try{return await fn(tx);}catch(error){Object.assign(vehicle,before.vehicle);rows.splice(0,rows.length,...before.bindings);commands.splice(before.commands);audits.splice(before.audits);throw error;}},
 };
 return{tx,vehicle,file,binding,rows,commands,audits,events,setCurrent:(value:any)=>{current=value;},denyCas:()=>{cas=false;},failAudit:()=>{failAudit=true;}};
}
const response=()=>{const headers:Record<string,string>={};let sent='';return{headers,get sent(){return sent;},setHeader:(key:string,value:string)=>{headers[key]=value;},sendFile:(path:string)=>{sent=path;return path;}};};

test('removal hides the list/read/open/category while retaining private identity, bytes and business facts',async t=>{
 const unlink=t.mock.method(fs,'unlink',async()=>{throw Error('Original bytes must remain');}),rm=t.mock.method(fs,'rm',async()=>{throw Error('Original bytes must remain');});
 const s=store(),controller=new VehicleDocumentsController(s.tx),before={...s.vehicle},file={...s.file};
 const removed=await controller.remove('vehicle-a','original-a',input,{admin:actor});
 assert.deepEqual(removed,{removed:true,fileId:'original-a',revision:3,vehicleRevision:9});
 assert.deepEqual(s.vehicle,{...before,documentRevision:3});assert.deepEqual(s.file,file);assert.equal(s.rows.length,1);assert.equal(s.rows[0].sourceRelativePath,'historical/original.pdf');assert.equal(s.rows[0].sha256,digest);
 assert(s.rows[0].removedAt instanceof Date);assert.equal(s.rows[0].removedBy,actor.id);assert.equal(unlink.mock.calls.length,0);assert.equal(rm.mock.calls.length,0);
 assert.deepEqual((await controller.list('vehicle-a',{admin:actor})).items,[]);
 for(const action of [()=>controller.read('vehicle-a','original-a',{admin:actor},response()),()=>controller.open('vehicle-a','original-a',{admin:actor},response()),()=>controller.category('vehicle-a','original-a',{...input,revision:3,idempotencyKey:'classify-removed-key',category:'INSURANCE'},{admin:actor})])await assert.rejects(action(),code('NOT_FOUND'));
 assert.equal(s.audits.length,1);assert.equal(s.audits[0].action,'VEHICLE_DOCUMENT_REMOVE');assert.equal(s.audits[0].data.fileId,'original-a');assert.equal(s.audits[0].data.sha256,digest);
 assert.equal(s.commands.length,1);assert(s.events.indexOf('vehicle-lock')<s.events.indexOf('vehicle-cas'));
});

test('same removal request replays after the file is removed and later parent revisions change',async()=>{
 const s=store(),controller=new VehicleDocumentsController(s.tx);const receipt=await controller.remove('vehicle-a','original-a',input,{admin:actor});
 s.vehicle.documentRevision=20;s.vehicle.revision=13;
 assert.deepEqual(await controller.remove('vehicle-a','original-a',input,{admin:actor}),receipt);assert.equal(s.vehicle.documentRevision,20);assert.equal(s.audits.length,1);
 for(const [id,body] of [['original-b',input],['original-a',{...input,revision:20}],['original-a',{...input,vehicleRevision:13}]] as const)await assert.rejects(controller.remove('vehicle-a',id,body,{admin:actor}),code('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(controller.remove('vehicle-a','original-a',{revision:20,vehicleRevision:13,idempotencyKey:'new-removed-request'},{admin:actor}),code('NOT_FOUND'));
 assert.equal(s.audits.length,1);
});

test('remove rejects either stale version, failed CAS, cross-vehicle files and changed file identity',async()=>{
 for(const body of [{...input,revision:1},{...input,vehicleRevision:8}]){const s=store();await assert.rejects(new VehicleDocumentsController(s.tx).remove('vehicle-a','original-a',body,{admin:actor}),code('REVISION_CONFLICT'));assert.equal(s.rows[0].removedAt,null);assert.equal(s.vehicle.documentRevision,2);}
 const cas=store();cas.denyCas();await assert.rejects(new VehicleDocumentsController(cas.tx).remove('vehicle-a','original-a',input,{admin:actor}),code('REVISION_CONFLICT'));assert.equal(cas.rows[0].removedAt,null);
 for(const kind of ['missing-parent','missing-file','cross-file','corrupt-digest']){const s=store();if(kind==='cross-file')s.binding.vehicleId='another-vehicle';if(kind==='corrupt-digest')s.file.sha256='b'.repeat(64);await assert.rejects(new VehicleDocumentsController(s.tx).remove(kind==='missing-parent'?'other':'vehicle-a',kind==='missing-file'?'missing':'original-a',input,{admin:actor}),code(kind==='corrupt-digest'?'VEHICLE_DOCUMENT_INVALID':'NOT_FOUND'));assert.equal(s.audits.length,0);assert.equal(s.vehicle.documentRevision,2);}
});

test('remove input is strict and does not accept hidden file/category/purge controls',async()=>{
 for(const body of [{...input,fileId:'original-b'},{...input,category:'OTHER'},{...input,purge:true},{...input,revision:-1},{...input,vehicleRevision:1.5},{...input,idempotencyKey:'short'}]){const s=store();await assert.rejects(new VehicleDocumentsController(s.tx).remove('vehicle-a','original-a',body,{admin:actor}));assert.equal(s.audits.length,0);assert.equal(s.rows[0].removedAt,null);}
});

test('remove and open require a currently valid ADMIN/OPERATIONS session, including on replay',async()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD']){
  const s=store(),who={...actor,role};s.setCurrent({...who,active:true});const controller=new VehicleDocumentsController(s.tx);
  if(['ADMIN','OPERATIONS'].includes(role)){await controller.open('vehicle-a','original-a',{admin:who},response());await controller.remove('vehicle-a','original-a',input,{admin:who});}
  else{await assert.rejects(controller.open('vehicle-a','original-a',{admin:who},response()),code('FORBIDDEN'));await assert.rejects(controller.remove('vehicle-a','original-a',input,{admin:who}),code('FORBIDDEN'));assert.equal(s.audits.length,0);}
 }
 for(const changed of [{...actor,active:false},{...actor,active:true,authVersion:4},{...actor,active:true,role:'OPERATIONS'}]){const s=store(),controller=new VehicleDocumentsController(s.tx);await controller.remove('vehicle-a','original-a',input,{admin:actor});s.setCurrent(changed);await assert.rejects(controller.remove('vehicle-a','original-a',input,{admin:actor}),code('STAFF_SESSION_CHANGED'));await assert.rejects(controller.open('vehicle-a','original-a',{admin:actor},response()),code('STAFF_SESSION_CHANGED'));assert.equal(s.audits.length,1);}
});

test('audit failure rolls removal back instead of leaving an unrecorded disappearing file',async()=>{
 const s=store();s.failAudit();await assert.rejects(new VehicleDocumentsController(s.tx).remove('vehicle-a','original-a',input,{admin:actor}),/synthetic audit failure/);assert.equal(s.rows[0].removedAt,null);assert.equal(s.rows[0].removedBy,null);assert.equal(s.vehicle.documentRevision,2);assert.equal(s.commands.length,0);
});

test('removed bindings still prevent general/admin/customer/public reuse when purpose is corrupted',async()=>{
 const s=store();await new VehicleDocumentsController(s.tx).remove('vehicle-a','original-a',input,{admin:actor});s.file.purpose='vehicle';s.file.mimeType='image/png';
 const db:any=fileReadStore({storedFile:{findUnique:async()=>s.file,findFirst:async()=>s.file},vehicleDocumentFile:s.tx.vehicleDocumentFile,vehicle:{count:async()=>1}}),files=new FilesController(db);
 await assert.rejects(files.adminRead('original-a',{admin:actor},response()),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
 await assert.rejects(files.customerRead('original-a',{customer:{id:'customer'}},response()),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
 await assert.rejects(files.media('original-a',response()),code('NOT_FOUND'));
 await assert.rejects(assertNotAssetFiles(db,['original-a']),code('VEHICLE_DOCUMENT_ROUTE_REQUIRED'));
});

test('open uses private inline presentation for browser formats and attachment fallback for DOCX',async()=>{
 for(const mime of ['application/pdf','image/jpeg','image/png','video/mp4','application/vnd.openxmlformats-officedocument.wordprocessingml.document']){
  const s=store(mime),controller=new VehicleDocumentsController(s.tx),opened=response();await controller.open('vehicle-a','original-a',{admin:actor},opened);
  assert.equal(opened.headers['Content-Type'],mime);assert.equal(opened.headers['Cache-Control'],'private, no-store');assert.equal(opened.headers['X-Content-Type-Options'],'nosniff');assert.match(opened.headers['Content-Disposition'],mime.includes('wordprocessingml')?/^attachment;/:/^inline;/);assert.equal(opened.sent,s.file.storagePath);assert.equal(s.audits.length,0);assert.equal(s.vehicle.documentRevision,2);
  const original=response();await controller.read('vehicle-a','original-a',{admin:actor},original);assert.match(original.headers['Content-Disposition'],/^attachment;/);
 }
 const cross=store();cross.binding.vehicleId='other';await assert.rejects(new VehicleDocumentsController(cross.tx).open('vehicle-a','original-a',{admin:actor},response()),code('NOT_FOUND'));
 const path=store();path.file.storagePath=resolve(projectRoot,'outside-secret.pdf');await assert.rejects(new VehicleDocumentsController(path.tx).open('vehicle-a','original-a',{admin:actor},response()),code('STORAGE_PATH'));
});

test('HTTP remove is routed through cookie, Origin, CSRF and write RBAC before mutating',async()=>{
 const s=store(),raw='synthetic-material-session',origin='https://admin.material-test.invalid',savedOrigin=process.env.ADMIN_ORIGIN;
 let sessionAdmin:any={...actor,active:true};
 s.tx.adminSession={findUnique:async({where}:any)=>where.id===tokenHash(raw)?{id:where.id,admin:sessionAdmin,authVersion:3,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+60000)}:null};
 @Module({controllers:[VehicleDocumentsController],providers:[{provide:Db,useValue:s.tx},{provide:APP_GUARD,useClass:Access}]})class RemovalHttpModule{}
 const app=await NestFactory.create(RemovalHttpModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalFilters(new Errors());
 process.env.ADMIN_ORIGIN=origin;
 try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),path='/api/admin/vehicles/vehicle-a/documents/original-a/remove',open='/api/admin/vehicles/vehicle-a/documents/original-a/open';
  const send=(headers:Record<string,string>)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  assert.equal((await send({})).status,401);
  assert.equal((await fetch(base+open)).status,401);
  assert.equal((await send({Cookie:'admin_session='+raw,Origin:'https://wrong.material-test.invalid','X-CSRF-Token':'synthetic-csrf'})).status,403);
  const absentCsrf=await send({Cookie:'admin_session='+raw,Origin:origin});assert.equal(absentCsrf.status,403);assert.equal((await absentCsrf.json()).error.code,'CSRF_DENIED');
  sessionAdmin={...actor,role:'FINANCE',active:true};s.setCurrent(sessionAdmin);assert.equal((await send({Cookie:'admin_session='+raw,Origin:origin,'X-CSRF-Token':'synthetic-csrf'})).status,403);
  assert.equal((await fetch(base+open,{headers:{Cookie:'admin_session='+raw}})).status,403);
  assert.equal(s.vehicle.documentRevision,2);assert.equal(s.audits.length,0);
  sessionAdmin={...actor,active:true};s.setCurrent(sessionAdmin);const headers={Cookie:'admin_session='+raw,Origin:origin,'X-CSRF-Token':'synthetic-csrf'};
  const done=await send(headers);assert.equal(done.status,201);assert.deepEqual(await done.json(),{removed:true,fileId:'original-a',revision:3,vehicleRevision:9});
  const list=await fetch(base+'/api/admin/vehicles/vehicle-a/documents',{headers:{Cookie:'admin_session='+raw}});assert.equal(list.status,200);assert.deepEqual((await list.json()).items,[]);
  assert.equal((await fetch(base+open,{headers:{Cookie:'admin_session='+raw}})).status,404);
  const replay=await send(headers);assert.equal(replay.status,201);assert.deepEqual(await replay.json(),{removed:true,fileId:'original-a',revision:3,vehicleRevision:9});assert.equal(s.audits.length,1);
 }finally{await app.close();if(savedOrigin===undefined)delete process.env.ADMIN_ORIGIN;else process.env.ADMIN_ORIGIN=savedOrigin;}
});
