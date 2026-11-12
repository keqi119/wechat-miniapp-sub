import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import multer from 'multer';
import {FilesController} from '../src/files/files';
import {saveFile,streamFile} from '../src/files/storage';
import {projectRoot} from '../src/common/config';
import {SimpleAgreementService} from '../src/partners/simple-agreements';
import {PartnerSimplePortalController} from '../src/partners/simple-portal.controller';
import {readSimpleRevenue} from '../src/partners/simple-revenue';
import {fileReadStore} from './file-store-fixture';

const original='产证新1.1.jpg',garbled=Buffer.from(original,'utf8').toString('latin1'),bytes=Buffer.from([0xff,0xd8,0xff,0,1,2]),actor={id:'operator',role:'OPERATIONS',authVersion:0};
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
function noDisk(t:any){t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);}
function file(name=garbled){return{id:'file',name,adminId:actor.id,customerId:null,purpose:'contract',mimeType:'image/jpeg',size:bytes.length,sha256:sha(bytes),storagePath:resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'),'synthetic-upload-name')};}
async function browserMultipart(name:string){
 const body=new FormData();body.append('file',new Blob([bytes],{type:'image/jpeg'}),name);
 const request=new Request('http://synthetic.invalid/',{method:'POST',body}),raw=Buffer.from(await request.arrayBuffer()),incoming:any=Readable.from([raw]);
 incoming.headers={'content-type':request.headers.get('content-type'),'content-length':String(raw.length)};
 await new Promise<void>((resolve,reject)=>multer().single('file')(incoming,{} as any,error=>error?reject(error):resolve()));
 return incoming.file as Express.Multer.File;
}
function response(){const headers:Record<string,string>={};return{headers,res:{setHeader(name:string,value:string){headers[name]=value;},sendFile(path:string){return path;}}};}

test('browser FormData passes through real Multer/Busboy and stores the original UTF-8 filename',async t=>{
 noDisk(t);const parsed=await browserMultipart(original);assert.equal(parsed.originalname,garbled,'exercise the real multipart charset boundary');let stored:any;
 const controller=new FilesController({storedFile:{create:async({data}:any)=>(stored={id:'file',...data})},auditLog:{create:async()=>({})}} as any);
 const result=await controller.adminUpload(parsed,{admin:actor,body:{purpose:'contract'}});
 assert.equal(result.name,original);assert.equal(stored.name,original);assert.equal(stored.sha256,sha(bytes));assert.deepEqual(parsed.buffer,bytes);
});
test('shared storage preserves Chinese and emoji from real browser multipart without changing bytes',async t=>{
 noDisk(t);for(const name of [original,'协议🚗.pdf','café.jpg','ascii-file.jpg']){const parsed=await browserMultipart(name),saved=await saveFile(parsed);assert.equal(saved.name,name);assert.equal(saved.sha256,sha(bytes));assert.deepEqual(parsed.buffer,bytes);}
});
test('long browser multipart filenames truncate at a complete emoji and remain safe for download headers',async t=>{
 noDisk(t);
 for(const [name,expected] of [['a'.repeat(198)+'\u{1f697}.jpg','a'.repeat(198)+'\u{1f697}'],['a'.repeat(199)+'\u{1f697}.jpg','a'.repeat(199)],['a'.repeat(200)+'\u{1f697}.jpg','a'.repeat(200)]]){
  const parsed=await browserMultipart(name),saved=await saveFile(parsed);
  assert.doesNotThrow(()=>encodeURIComponent(saved.name));assert.equal(saved.name,expected);assert(saved.name.length<=200);assert.equal(saved.sha256,sha(bytes));assert.deepEqual(parsed.buffer,bytes);
 }
});

test('filename normalization preserves already decoded Unicode and genuine Latin1, sanitizes paths after decoding',async t=>{
 noDisk(t);for(const [name,expected] of [[original,original],['协议🚗.pdf','协议🚗.pdf'],['café.jpg','café.jpg'],['ascii.pdf','ascii.pdf'],['bad\u00ff.jpg','bad\u00ff.jpg'],[Buffer.from('../产证\\新\r\n.jpg','utf8').toString('latin1'),'.._产证_新__.jpg']]){const saved=await saveFile({originalname:name,buffer:bytes,size:bytes.length,mimetype:'image/jpeg'} as any);assert.equal(saved.name,expected);}
});
test('authorized downloads repair only disposition metadata and preserve stored files',async()=>{
 const record=Object.freeze(file()),before=JSON.stringify(record),shared=response();assert.equal(streamFile(record,shared.res),record.storagePath);assert.equal(shared.headers['Content-Disposition'],`inline; filename*=UTF-8''${encodeURIComponent(original)}`);
 const generic=response(),db=fileReadStore({storedFile:{findUnique:async()=>record}});await new FilesController(db as any).adminRead(record.id,{admin:{id:actor.id,role:'ADMIN'}},generic.res);assert.equal(generic.headers['Content-Disposition'],shared.headers['Content-Disposition']);assert.equal(JSON.stringify(record),before);
});
test('admin agreement DTO adds displayTitle without changing immutable title, contentHash or stored metadata',async()=>{
 const version=Object.freeze({id:'version',agreementId:'agreement',ownerId:'owner',version:1,title:garbled,status:'ACTIVE',fileIds:['file'],vehicleIds:[],partnerRateBps:8000,contentHash:'a'.repeat(64)}),stored=Object.freeze(file()),before=JSON.stringify({version,stored});
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},adminUser:{findUnique:async()=>({...actor,active:true})},vehicleOwner:{findUnique:async()=>({id:'owner'})},partnerAgreement:{findMany:async()=>[{id:'agreement',ownerId:'owner',currentVersionId:'version'}]},partnerAgreementVersion:{findMany:async()=>[version]},storedFile:{findMany:async()=>[stored]}};
 const [dto]=await new SimpleAgreementService().agreements(tx,actor,'owner');
 for(const value of [dto.currentVersion,dto.latestVersion,dto.versions[0]]){assert.equal(value.displayTitle,original);assert.equal(value.title,garbled);assert.equal(value.contentHash,version.contentHash);}
 assert.equal(dto.files[0].name,original);assert.equal(JSON.stringify({version,stored}),before);
});
test('new agreement version derives a readable default title from an existing uploaded filename',async()=>{
 const stored=Object.freeze(file()),versions:any[]=[];let agreement:any={id:'agreement',ownerId:'owner',status:'DRAFT',revision:0};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$executeRaw:async()=>0,$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},archiveCommand:{findUnique:async()=>null,create:async({data}:any)=>data},vehicleOwner:{findUnique:async()=>({id:'owner',status:'DRAFT'})},storedFile:{findMany:async()=>[stored]},partnerAgreement:{create:async()=>agreement,update:async({data}:any)=>(agreement={...agreement,...data,revision:1})},partnerAgreementVersion:{findFirst:async()=>null,findMany:async({select}:any)=>select?[]:versions,create:async({data}:any)=>{const value={id:'version',...data};versions.push(value);return value;}},auditLog:{create:async()=>({})}};
 const result=await new SimpleAgreementService().save(tx,actor,'owner',{revision:0,idempotencyKey:'synthetic-filename-save',status:'DRAFT',fileIds:['file'],vehicleIds:[],partnerRateBps:8000});assert.equal(versions[0].title,original);assert.equal(result.latestVersion.title,original);assert.equal(stored.name,garbled);
});
test('company portal projects readable agreement, attachment and vehicle facet labels without mutating service results',async()=>{
 const agreements={items:[{id:'a',title:garbled,files:[file()]}]},vehicles={items:[{agreementTitle:garbled}],agreements:[{id:'a',title:garbled}],models:[],total:1},before=JSON.stringify({agreements,vehicles});
 const controller=new PartnerSimplePortalController({portalAgreements:async()=>agreements,portalVehicles:async()=>vehicles} as any),request={partnerPortalSession:{id:'session'}};
 const result:any=await controller.agreements(request,'owner'),list:any=await controller.vehicles(request,'owner',{});assert.equal(result.items[0].title,original);assert.equal(result.items[0].files[0].name,original);assert.equal(list.items[0].agreementTitle,original);assert.equal(list.agreements[0].title,original);assert.equal(JSON.stringify({agreements,vehicles}),before);
});
test('revenue agreement group, item and filter labels decode while money and immutable source stay unchanged',async()=>{
 const version=Object.freeze({id:'version',agreementId:'agreement',title:garbled,vehicleIds:['vehicle']}),event=Object.freeze({id:'event',ownerId:'owner',agreementId:'agreement',agreementVersionId:'version',vehicleId:'vehicle',paymentId:'payment',sourceType:'PAYMENT',sourceId:'payment',modelId:'model',modelName:'车型',plateNumber:'沪合成',amount:10000,partnerAmount:8000,partnerRateBps:8000,occurredAt:new Date('2026-10-28T01:00:00Z')}),before=JSON.stringify({version,event});
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},vehicleOwner:{findUnique:async()=>({id:'owner'})},partnerRevenueEvent:{findMany:async()=>[event]},partnerAgreementVersion:{findMany:async()=>[version]},partnerAgreementVehicle:{findMany:async()=>[]},payment:{findMany:async()=>[{id:'payment',providerTransactionId:'synthetic',reconciliationRequired:false,succeededAt:event.occurredAt,bill:{order:{finalPlanSnapshot:{revenueRuleSnapshot:{ownerId:'owner'}}}},refunds:[]}]}};
 const result=await readSimpleRevenue(tx,'owner',{from:'2026-10-01',to:'2026-10-31',groupBy:'agreement'});assert.equal(result.groups[0].label,original);assert.equal(result.items[0].agreementTitle,original);assert.equal(result.filters.agreements[0].title,original);assert.deepEqual(result.totals,{receivedAmount:10000,refundedAmount:0,netAmount:10000,partnerAmount:8000,platformAmount:2000});assert.equal(JSON.stringify({version,event}),before);
});
