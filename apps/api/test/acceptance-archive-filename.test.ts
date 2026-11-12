import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';
import multer from 'multer';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {FieldArchiveService} from '../src/offline-documents/field';
import {projectRoot} from '../src/common/config';
const bytes=Buffer.from('%PDF-synthetic'),actor={id:'op',role:'OPERATIONS'};
async function multipart(name:string){const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),name);const request=new Request('http://synthetic.invalid/',{method:'POST',body:form}),raw=Buffer.from(await request.arrayBuffer()),incoming:any=Readable.from([raw]);incoming.headers={'content-type':request.headers.get('content-type'),'content-length':String(raw.length)};await new Promise<void>((done,reject)=>multer().single('file')(incoming,{} as any,(e:any)=>e?reject(e):done()));return incoming.file;}
function fixture(){const v:any={id:'v',status:'DRAFT',sourceFileId:'source',files:[]},a:any={id:'a',kind:'RENTAL',revision:1,versions:[v]},created:any[]=[];const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},archiveCommand:{findUnique:async()=>null,findFirst:async()=>({id:'confirmed'}),create:async()=>({})},documentArchive:{update:async()=>({})},archiveVersion:{update:async()=>({})},archiveFile:{create:async()=>({})},storedFile:{create:async({data}:any)=>{const f={id:'f',...data};created.push(f);return f;}},auditLog:{create:async()=>({})}};return{tx,a,v,created};}
test('admin and field archive uploads normalize real browser multipart names and preserve exact file content',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async(_path:any,data:any)=>{assert.deepEqual(data,bytes);});
 for(const name of ['签字合同🚗.pdf','café.pdf','签字合同.pdf','ascii.pdf'])for(const kind of ['admin','field']){const f=fixture(),file=await multipart(name);if(kind==='admin'){const service:any=new ArchiveService({serial:async(fn:any)=>fn(f.tx)} as any,{} as any);service.writable=async()=>f.a;await service.upload('a','v',{revision:1,position:1,idempotencyKey:'filename-upload'},file,actor);}else{const service:any=new FieldArchiveService({serial:async(fn:any)=>fn(f.tx)} as any);service.scope=async()=>({archive:f.a,version:f.v,task:{id:'task',materialGeneration:1}});await service.upload('task',{archiveId:'a',versionId:'v',taskVersion:1,revision:1,position:1,idempotencyKey:'filename-upload'},file,{id:'field',role:'FIELD'});}assert.equal(f.created[0].name,name);assert.equal(f.created[0].size,bytes.length);}
});
test('archive downloads repair legacy disposition only and keep immutable original rows',async()=>{
 const name='签字合同.pdf',legacy=Buffer.from(name).toString('latin1'),file=Object.freeze({id:'f',name:legacy,mimeType:'application/pdf',storagePath:resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'),'synthetic-filename')});const f=fixture();f.v.files=[{versionId:'v',fileId:'f',file}];let headers:any;const service:any=new ArchiveService({vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0}} as any,{} as any);service.loaded=async()=>f.a;service.authorized=async()=>undefined;await service.readFile('a','v','f',actor,{set(value:any){headers=value;},sendFile(path:string){assert.equal(path,file.storagePath);}});assert.equal(headers['Content-Disposition'],`inline; filename*=UTF-8''${encodeURIComponent(name)}`);assert.equal(file.name,legacy);
});
