import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {projectRoot} from '../src/common/config';
import {VehicleDocumentsController,validDocumentMime} from '../src/vehicle-documents/vehicle-documents';
const actor={id:'operator',role:'ADMIN',authVersion:2};
const bytes=Buffer.from('%PDF-synthetic-original');
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
const upload=(buffer=bytes,mimetype='application/pdf')=>({originalname:'原件.pdf',buffer,size:buffer.length,mimetype} as Express.Multer.File);
const input={revision:0,vehicleRevision:7,idempotencyKey:'original-key',category:'REGISTRATION',sourceRelativePath:'登记/原件.pdf'};
function store(){
 const vehicle:any={id:'vehicle',revision:7,documentRevision:0,status:'PUBLISHED',mileage:999,price:1234};
 const files:any[]=[],bindings:any[]=[],commands:any[]=[],audits:any[]=[];
 let current:any={...actor,active:true};
 const tx:any={adminUser:{findUnique:async()=>current},
  vehicle:{findUnique:async({where}:any)=>where.id===vehicle.id?vehicle:null,updateMany:async({where,data}:any)=>{if(where.id!==vehicle.id||where.revision!==vehicle.revision||where.documentRevision!==vehicle.documentRevision)return{count:0};assert.deepEqual(data,{documentRevision:{increment:1}});vehicle.documentRevision++;return{count:1};}},
  vehicleDocumentFile:{findMany:async({where}:any)=>bindings.filter(b=>b.vehicleId===where.vehicleId),findUnique:async({where}:any)=>bindings.find(b=>where.fileId?b.fileId===where.fileId:b.vehicleId===where.vehicleId_sourceRelativePath.vehicleId&&b.sourceRelativePath===where.vehicleId_sourceRelativePath.sourceRelativePath)??null,create:async({data}:any)=>{const result={...data,file:files.find(f=>f.id===data.fileId),createdAt:new Date('2026-11-03')};bindings.push(result);return result;}},
  storedFile:{create:async({data}:any)=>{const file={id:`file-${files.length}`,fieldTaskId:null,...data};files.push(file);return file;}},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>c.key===where.actorId_resourceId_action_key.key)??null,create:async({data}:any)=>{commands.push(data);return data;}},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},$queryRaw:async()=>[],$executeRaw:async()=>0,serial:async(fn:any)=>fn(tx)};
 return{tx,vehicle,files,bindings,commands,audits,setCurrent:(c:any)=>{current=c;}};
}
function disk(t:any){t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);}
test('dedicated uploads preserve business state, retain source paths and replay with actual-byte identity',async t=>{
 disk(t);const s=store(),c=new VehicleDocumentsController(s.tx),before={...s.vehicle};
 const result=await c.upload('vehicle',input,upload(),{admin:actor});
 assert.equal(result.revision,1);assert.equal(result.vehicleRevision,7);assert.equal(result.sourceRelativePath,'登记/原件.pdf');assert.equal(result.category,'REGISTRATION');
 assert.deepEqual(s.vehicle,{...before,documentRevision:1});assert.equal(s.audits.length,1);assert.equal(s.bindings.length,1);
 assert.equal(s.files[0].purpose,'vehicle-document');assert.equal(JSON.stringify(result).includes('storagePath'),false);
 assert.deepEqual(await c.upload('vehicle',input,upload(),{admin:actor}),result);
 for(const [body,file] of [[input,upload(Buffer.from('%PDF-changed'))],[{...input,sourceRelativePath:'其他.pdf'},upload()],[{...input,category:'OTHER'},upload()]] as const)await assert.rejects(c.upload('vehicle',body,file,{admin:actor}),code('IDEMPOTENCY_CONFLICT'));
 assert.equal(s.bindings.length,1);
 await assert.rejects(c.upload('vehicle',{...input,revision:1,idempotencyKey:'second-key'},upload(),{admin:actor}),code('VEHICLE_DOCUMENT_PATH_EXISTS'));
 await c.upload('vehicle',{...input,revision:1,idempotencyKey:'third-key',sourceRelativePath:'副本.pdf'},upload(),{admin:actor});assert.equal(s.bindings.length,2);
});
test('list and download expose only this vehicle metadata, private attachment headers and current operator rights',async t=>{
 disk(t);const s=store(),c=new VehicleDocumentsController(s.tx);await c.upload('vehicle',input,upload(),{admin:actor});
 const manifest=await c.list('vehicle',{admin:actor});assert.equal(manifest.revision,1);assert.equal(manifest.vehicleRevision,7);assert.equal(manifest.items[0].name,'原件.pdf');assert.equal(manifest.items[0].sha256,createHash('sha256').update(bytes).digest('hex'));assert(!JSON.stringify(manifest).includes('storagePath'));
 const headers:any={};let path='';await c.read('vehicle','file-0',{admin:actor},{setHeader(k:string,v:string){headers[k]=v;},sendFile(p:string){path=p;}});
 assert.equal(headers['Cache-Control'],'private, no-store');assert.equal(headers['X-Content-Type-Options'],'nosniff');assert.match(headers['Content-Disposition'],/^attachment;/);assert.equal(path,s.files[0].storagePath);
 await assert.rejects(c.read('other','file-0',{admin:actor},{}),code('NOT_FOUND'));
 s.bindings[0].vehicleId='other';await assert.rejects(c.read('vehicle','file-0',{admin:actor},{}),code('NOT_FOUND'));
});
test('all reads and writes require ADMIN/OPERATIONS and an active matching versioned session',async t=>{
 disk(t);
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD']){
  const s=store(),a={...actor,role};s.setCurrent({...a,active:true});const c=new VehicleDocumentsController(s.tx);
  if(['ADMIN','OPERATIONS'].includes(role)){await c.list('vehicle',{admin:a});await c.upload('vehicle',input,upload(),{admin:a});}
  else{await assert.rejects(c.list('vehicle',{admin:a}),code('FORBIDDEN'));await assert.rejects(c.upload('vehicle',input,upload(),{admin:a}),code('FORBIDDEN'));}
 }
 for(const current of [{...actor,active:false},{...actor,active:true,authVersion:3},{...actor,active:true,role:'OPERATIONS'}]){const s=store();s.setCurrent(current);await assert.rejects(new VehicleDocumentsController(s.tx).list('vehicle',{admin:actor}),code('STAFF_SESSION_CHANGED'));}
 await assert.rejects(new VehicleDocumentsController(store().tx).list('vehicle',{admin:{id:actor.id,role:actor.role}}),code('STAFF_SESSION_CHANGED'));
});
test('upload rechecks staff after disk I/O and rejects either stale revision before relational mutation',async t=>{
 disk(t);const s=store();t.mock.method(fs,'writeFile',async()=>{s.setCurrent({...actor,active:false});});await assert.rejects(new VehicleDocumentsController(s.tx).upload('vehicle',input,upload(),{admin:actor}),code('STAFF_SESSION_CHANGED'));assert.equal(s.files.length,0);
 t.mock.method(fs,'writeFile',async()=>undefined);
 for(const body of [{...input,revision:1},{...input,vehicleRevision:6}]){const fresh=store();await assert.rejects(new VehicleDocumentsController(fresh.tx).upload('vehicle',body,upload(),{admin:actor}),code('REVISION_CONFLICT'));assert.equal(fresh.files.length,0);assert.equal(fresh.vehicle.documentRevision,0);}
});
test('upload rejects traversal, ambiguous paths, invalid category, oversize or mismatched body bytes',async()=>{
 const c=new VehicleDocumentsController(store().tx);
 for(const sourceRelativePath of ['','../x','a/../x','/root','C:/x','a\\x','a//x','./x','a/./x','a\u0000x'])await assert.rejects(c.upload('vehicle',{...input,sourceRelativePath},upload(),{admin:actor}));
 await assert.rejects(c.upload('vehicle',{...input,category:'PUBLIC'},upload(),{admin:actor}));
 for(const file of [upload(Buffer.from('invalid')),{...upload(),size:1},upload(Buffer.alloc(32*1024*1024+1))])await assert.rejects(c.upload('vehicle',input,file,{admin:actor}),code('VEHICLE_DOCUMENT_INVALID'));
});
// A minimal ZIP with a local entry per required OOXML part and bounded central directory.
function docx(){const chunks:Buffer[]=[],directory:Buffer[]=[];let offset=0;for(const name of ['[Content_Types].xml','word/document.xml']){const n=Buffer.from(name),data=Buffer.from('<xml/>'),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);chunks.push(local,n,data);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);directory.push(central,n);offset+=local.length+n.length+data.length;}const d=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(d.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,d,end]);}
test('document formats admit bounded OOXML and MP4 ftyp but reject generic/truncated zip and fake video',()=>{
 const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';assert.equal(validDocumentMime(docx(),mime),true);
 for(const buffer of [Buffer.from('PK\u0003\u0004'),docx().subarray(0,-10),Buffer.from('word/document.xml [Content_Types].xml')])assert.equal(validDocumentMime(buffer,mime),false);
 const mp4=Buffer.from('000000186674797069736f6d0000000069736f6d6d703432','hex');assert.equal(validDocumentMime(mp4,'video/mp4'),true);assert.equal(validDocumentMime(Buffer.from('ftyp'),'video/mp4'),false);assert.equal(validDocumentMime(bytes,'text/html'),false);
});
test('source path schema accepts 1000 characters and rejects 1001 before disk writes',async t=>{
 disk(t);const s=store(),c=new VehicleDocumentsController(s.tx);
 await c.upload('vehicle',{...input,sourceRelativePath:'x'.repeat(1000)},upload(),{admin:actor});
 await assert.rejects(c.upload('vehicle',{...input,revision:1,idempotencyKey:'long-path-key',sourceRelativePath:'x'.repeat(1001)},upload(),{admin:actor}));assert.equal(s.bindings.length,1);
});
test('original DOCX and MP4 download as attachments, and valid images above 10MiB retain exact bytes',async t=>{
 disk(t);const png=Buffer.alloc(11*1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
 const video=Buffer.from('000000186674797069736f6d0000000069736f6d6d703432','hex');
 for(const [buffer,mime] of [[docx(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],[video,'video/mp4'],[png,'image/png']] as const){
  const s=store(),c=new VehicleDocumentsController(s.tx);await c.upload('vehicle',input,upload(buffer,mime),{admin:actor});assert.equal(s.files[0].size,buffer.length);assert.equal(s.files[0].sha256,createHash('sha256').update(buffer).digest('hex'));
  const headers:any={};await c.read('vehicle','file-0',{admin:actor},{setHeader(k:string,v:string){headers[k]=v;},sendFile(){}});assert.match(headers['Content-Disposition'],/^attachment;/);assert.equal(headers['Content-Type'],mime);
 }
});
