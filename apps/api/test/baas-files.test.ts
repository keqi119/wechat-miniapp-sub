import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {promises as fs} from 'node:fs';
import {projectRoot} from '../src/common/config';
import {AssetFilesController,assertNotAssetFiles,requireAssetFiles} from '../src/files/asset-files';
import * as assetFiles from '../src/files/asset-files';
import {FilesController} from '../src/files/files';
import {assetActor,assetCommand,assetError,assetFixture,financeActor} from './asset-ledger-fixture';
import {fileReadStore} from './file-store-fixture';

const lifecycle={voidedAt:null,voidedBy:null,voidReason:null,removedAt:null,removedBy:null,removeReason:null};
function fixture(){
 const f=assetFixture();
 f.seed('vehicleBaasContract',{id:'contract',vehicleId:'vehicle',revision:0,status:'ACTIVE',updatedBy:assetActor.id});
 const attach=(id:string,parent='contract')=>{f.attach('BAAS',parent,id);Object.assign(f.rows('assetPrivateFile').at(-1),lifecycle);f.rows('storedFile').at(-1).storagePath=resolve(projectRoot,'var/uploads/synthetic-baas-file');};
 attach('file-a');
 const controller=new AssetFilesController({serial:f.serial} as any);
 return{...f,attach,attachCost:(parent:string,id:string)=>{f.attach('COST',parent,id);Object.assign(f.rows('assetPrivateFile').at(-1),lifecycle);},controller,command:(revision=0)=>({...assetCommand(revision),reason:'核对后处置合同附件'})};
}
const response=()=>{const headers:Record<string,string>={},sent:string[]=[];return{headers,sent,setHeader(key:string,value:string){headers[key]=value;},sendFile(path:string){sent.push(path);}};};

// Catch accidentally admitting a voided/removed BAAS file as current evidence.
test('only current BAAS attachments authorize new use while COST evidence keeps its existing scope',async()=>{
 const f=fixture();f.attach('voided');f.attach('removed');
 Object.assign(f.rows('assetPrivateFile')[1],{voidedAt:new Date('2026-11-05'),voidedBy:assetActor.id,voidReason:'原件错误'});
 Object.assign(f.rows('assetPrivateFile')[2],{removedAt:new Date('2026-11-05'),removedBy:assetActor.id,removeReason:'移除重复件'});
 assert.deepEqual((await requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',required:true})).map(row=>row.id),['file-a']);
 await assert.rejects(requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',fileIds:['voided'],required:true}),assetError('ASSET_FILE_INVALID'));
 await assert.rejects(requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',fileIds:['removed'],required:true}),assetError('ASSET_FILE_INVALID'));
 f.seed('assetCostEntry',{id:'cost',vehicleId:'vehicle',revision:2});f.attachCost('cost','cost-evidence');
 assert.deepEqual((await requireAssetFiles(f.tx,financeActor,{kind:'COST',resourceId:'cost',required:true})).map(row=>row.id),['cost-evidence']);
 Object.assign(f.rows('assetPrivateFile')[0],{voidedAt:new Date(),voidedBy:assetActor.id,voidReason:'全部失效'});
 await assert.rejects(requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',required:true}),assetError('ASSET_FILES_REQUIRED'));
});

// Catch hiding voided records or exposing removed records in the contract card.
test('BAAS list keeps visible void reasons and the correct dedicated URL but hides removed records',async()=>{
 const f=fixture();f.attach('file-b');f.attach('file-c');
 Object.assign(f.rows('assetPrivateFile')[1],{voidedAt:new Date('2026-11-05'),voidedBy:assetActor.id,voidReason:'保留作废依据'});
 Object.assign(f.rows('assetPrivateFile')[2],{removedAt:new Date('2026-11-05'),removedBy:assetActor.id,removeReason:'移除重复件'});
 const list=await f.controller.listBaas('contract',{admin:assetActor});
 assert.equal(list.revision,0);assert.deepEqual(list.items.map((row:any)=>[row.id,row.state]),[['file-a','ACTIVE'],['file-b','VOIDED']]);
 assert.equal((list.items[0] as any).url,'/api/admin/baas-contracts/contract/files/file-a');
 assert.equal((list.items[1] as any).url,'/api/admin/baas-contracts/contract/files/file-b/history');
 assert.equal((list.items[1] as any).voidReason,'保留作废依据');assert(!JSON.stringify(list).includes('storagePath'));
});

test('void preserves the original binding, records its reason, advances the parent once and replays safely',async()=>{
 const f=fixture(),body=f.command(),original=structuredClone(f.rows('storedFile'));
 const result=await (f.controller as any).voidBaas('contract','file-a',body,{admin:assetActor});
 assert.equal(result.state,'VOIDED');assert.equal(result.revision,1);assert.equal(result.voidReason,body.reason);assert.equal(result.voidedBy,assetActor.id);
 assert.equal(f.rows('assetPrivateFile')[0].baasContractId,'contract');assert.deepEqual(f.rows('storedFile'),original);
 assert.equal(f.rows('vehicleBaasContract')[0].status,'ACTIVE');assert.equal(f.rows('auditLog').length,1);
 const writes=f.writes.length;assert.deepEqual(await (f.controller as any).voidBaas('contract','file-a',body,{admin:assetActor}),result);assert.equal(f.writes.length,writes);
 assert.match(f.locks[1],/FROM "Vehicle"/);assert.match(f.locks[2],/FROM "VehicleBaasContract"/);
 await assert.rejects((f.controller as any).voidBaas('contract','file-a',f.command(1),{admin:assetActor}),assetError('BAAS_FILE_STATE'));
});

test('remove hides an active or voided attachment without deleting the file, binding or previous void reason',async()=>{
 for(const previouslyVoided of [false,true]){
  const f=fixture();let revision=0;
  if(previouslyVoided){await (f.controller as any).voidBaas('contract','file-a',f.command(),{admin:assetActor});revision=1;}
  const previousVoid=f.rows('assetPrivateFile')[0].voidReason,stored=structuredClone(f.rows('storedFile'));
  const result=await (f.controller as any).removeBaas('contract','file-a',f.command(revision),{admin:assetActor});
  assert.equal(result.state,'REMOVED');assert.equal(result.revision,revision+1);assert.equal(f.rows('assetPrivateFile').length,1);assert.deepEqual(f.rows('storedFile'),stored);
  assert.equal(f.rows('assetPrivateFile')[0].voidReason,previousVoid);assert.deepEqual((await f.controller.listBaas('contract',{admin:assetActor})).items,[]);
  await assert.rejects((f.controller as any).removeBaas('contract','file-a',f.command(revision+1),{admin:assetActor}),assetError('BAAS_FILE_STATE'));
 }
});

test('normal and history downloads enforce distinct lifecycle states and private no-store headers',async()=>{
 const f=fixture(),active=response();await f.controller.readBaas('contract','file-a',{admin:financeActor},active);
 assert.equal(active.headers['Cache-Control'],'private, no-store');assert.equal(active.sent.length,1);
 await assert.rejects((f.controller as any).readBaasHistory('contract','file-a',{admin:assetActor},response()),assetError('NOT_FOUND'));
 await (f.controller as any).voidBaas('contract','file-a',f.command(),{admin:assetActor});
 await assert.rejects(f.controller.readBaas('contract','file-a',{admin:assetActor},response()),assetError('NOT_FOUND'));
 const historic=response();await (f.controller as any).readBaasHistory('contract','file-a',{admin:financeActor},historic);assert.equal(historic.sent.length,1);assert.equal(historic.headers['Cache-Control'],'private, no-store');
 await (f.controller as any).removeBaas('contract','file-a',f.command(1),{admin:assetActor});
 await assert.rejects(f.controller.readBaas('contract','file-a',{admin:assetActor},response()),assetError('NOT_FOUND'));
 await assert.rejects((f.controller as any).readBaasHistory('contract','file-a',{admin:assetActor},response()),assetError('NOT_FOUND'));
});

test('actions reject stale revisions, cross-file key reuse, changed requests and cross-contract evidence without writes',async()=>{
 const f=fixture();f.attach('file-b');f.seed('vehicleBaasContract',{id:'other',vehicleId:'vehicle',revision:0,status:'DRAFT'});f.attach('foreign','other');
 await assert.rejects((f.controller as any).voidBaas('contract','file-a',f.command(1),{admin:assetActor}),assetError('REVISION_CONFLICT'));assert.equal(f.writes.length,0);
 await assert.rejects((f.controller as any).voidBaas('contract','foreign',f.command(),{admin:assetActor}),assetError('ASSET_FILE_INVALID'));assert.equal(f.writes.length,0);
 const body=f.command();await (f.controller as any).voidBaas('contract','file-a',body,{admin:assetActor});const count=f.writes.length;
 await assert.rejects((f.controller as any).voidBaas('contract','file-b',body,{admin:assetActor}),assetError('IDEMPOTENCY_CONFLICT'));
 await assert.rejects((f.controller as any).voidBaas('contract','file-a',{...body,reason:'改变原因'},{admin:assetActor}),assetError('IDEMPOTENCY_CONFLICT'));assert.equal(f.writes.length,count);
});

test('current RBAC and staff session are checked before replay or protected history reads',async()=>{
 const f=fixture(),body=f.command();await (f.controller as any).voidBaas('contract','file-a',body,{admin:assetActor});
 await assert.rejects((f.controller as any).removeBaas('contract','file-a',f.command(1),{admin:financeActor}),assetError('FORBIDDEN'));
 f.revoke(assetActor.id);await assert.rejects((f.controller as any).voidBaas('contract','file-a',body,{admin:assetActor}),assetError('STAFF_SESSION_CHANGED'));
 for(const actor of [{id:'support',role:'SUPPORT',authVersion:1},{id:'field',role:'FIELD',authVersion:1},{...financeActor,authVersion:0}])await assert.rejects((f.controller as any).readBaasHistory('contract','file-a',{admin:actor},response()));
});

test('strict action input and exact binding identity prevent malformed or corrupted disposition',async()=>{
 for(const patch of [{reason:'   '},{reason:'x'.repeat(501)},{reason:'理由\0截断'},{idempotencyKey:'invalid\0key'},{actor:'forged'},{revision:-1},{revision:'0'}]){
  const f=fixture();await assert.rejects((f.controller as any).voidBaas('contract','file-a',{...f.command(),...patch},{admin:assetActor}));assert.equal(f.writes.length,0);
 }
 for(const patch of [{kind:'COST'},{costEntryId:'foreign'},{sha256:'b'.repeat(64)},{uploadedBy:'foreign'}]){
  const f=fixture();Object.assign(f.rows('assetPrivateFile')[0],patch);await assert.rejects((f.controller as any).voidBaas('contract','file-a',f.command(),{admin:assetActor}),assetError('ASSET_FILE_INVALID'));assert.equal(f.writes.length,0);
 }
});

test('retained removed BAAS bindings permanently block generic, customer and public file access despite purpose tampering',async()=>{
 const f=fixture();await (f.controller as any).removeBaas('contract','file-a',f.command(),{admin:assetActor});
 await assert.rejects(assertNotAssetFiles(f.tx,['file-a']),assetError('ASSET_FILE_ROUTE_REQUIRED'));
 Object.assign(f.rows('storedFile')[0],{purpose:'vehicle',mimeType:'image/png'});
 const files=new FilesController(fileReadStore({...f.tx}) as any);
 await assert.rejects(files.adminRead('file-a',{admin:assetActor},response()),assetError('ASSET_FILE_ROUTE_REQUIRED'));
 await assert.rejects(files.customerRead('file-a',{customer:{id:'customer'}},response()),assetError('ASSET_FILE_ROUTE_REQUIRED'));
 await assert.rejects(files.media('file-a',response()),assetError('NOT_FOUND'));
 assert.equal(f.rows('assetPrivateFile').length,1);assert.equal(f.rows('storedFile').length,1);
});

test('new BaaS uploads reject images and mislabeled PDF bytes before storage with a signed-contract PDF prompt',async t=>{
 const f=fixture();let diskWrites=0;t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>{diskWrites++;});
 const png=Buffer.from([137,80,78,71,13,10,26,10]),jpeg=Buffer.from([0xff,0xd8,0xff]);
 for(const [buffer,mimetype] of [[png,'image/png'],[jpeg,'image/jpeg'],[png,'application/pdf'],[Buffer.from('%PDF-synthetic'),'image/png']] as const){
  const file={originalname:'合同文件',buffer,size:buffer.length,mimetype} as Express.Multer.File;
  await assert.rejects(f.controller.uploadBaas('contract',assetCommand(),file,{admin:assetActor}),(error:any)=>error.getResponse?.().error?.code==='ASSET_FILE_INVALID'&&error.getResponse?.().error?.message.includes('请上传已签署的BaaS合同PDF'));
 }
 assert.equal(diskWrites,0);assert.equal(f.writes.length,0);assert.equal(f.rows('storedFile').length,1);
});

test('existing BaaS PDF requires no reupload while historical images stay readable and disposable without qualifying as PDF evidence',async()=>{
 const f=fixture();f.attach('legacy-image');Object.assign(f.rows('storedFile').at(-1),{mimeType:'image/jpeg',name:'旧合同照片.jpg'});
 assert.deepEqual((await requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',required:true})).map(row=>row.id),['file-a']);
 await assert.rejects(requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',fileIds:['legacy-image'],required:true}),assetError('ASSET_FILE_INVALID'));
 const list=await f.controller.listBaas('contract',{admin:assetActor});assert.deepEqual(list.items.map(row=>row.id),['file-a','legacy-image']);
 const opened=response();await f.controller.readBaas('contract','legacy-image',{admin:financeActor},opened);assert.equal(opened.headers['Content-Type'],'image/jpeg');assert.equal(opened.sent.length,1);
 await f.controller.voidBaas('contract','legacy-image',f.command(),{admin:assetActor});const history=response();await f.controller.readBaasHistory('contract','legacy-image',{admin:financeActor},history);assert.equal(history.sent.length,1);
 await f.controller.removeBaas('contract','legacy-image',f.command(1),{admin:assetActor});assert.equal((await f.controller.listBaas('contract',{admin:assetActor})).items.length,1);
 assert.deepEqual((await requireAssetFiles(f.tx,assetActor,{kind:'BAAS',resourceId:'contract',required:true})).map(row=>row.id),['file-a']);assert.equal(f.rows('storedFile').length,2);
});

test('valid PDF uploads keep existing semantics and COST image uploads remain supported',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 const f=fixture(),buffer=Buffer.from('%PDF-synthetic-contract');
 const pdf=await f.controller.uploadBaas('contract',assetCommand(),{originalname:'已签署合同.pdf',buffer,size:buffer.length,mimetype:'application/pdf'} as Express.Multer.File,{admin:assetActor});
 assert.equal(pdf.mimeType,'application/pdf');assert.equal(pdf.revision,1);assert.equal(f.rows('storedFile').at(-1).purpose,'asset-baas');
 f.seed('assetCostPlan',{id:'plan',vehicleId:'vehicle',sourceKind:'BAAS',baasContractId:'contract',depreciationPolicyId:null,workOrderCostId:null});f.seed('assetCostEntry',{id:'cost',vehicleId:'vehicle',planId:'plan',revision:0,lockedAt:null});
 const image=Buffer.from([137,80,78,71,13,10,26,10]),uploaded=await f.controller.uploadCost('cost',assetCommand(),{originalname:'付款凭据.png',buffer:image,size:image.length,mimetype:'image/png'} as Express.Multer.File,{admin:financeActor});
 assert.equal(uploaded.mimeType,'image/png');assert.equal(f.rows('storedFile').at(-1).purpose,'asset-cost');
});

test('internal registration PDF facts reuse exact private bindings without impersonating a staff session or exposing storage',async()=>{
 const f=fixture();f.attach('legacy-image');f.attach('voided-pdf');Object.assign(f.rows('storedFile')[1],{mimeType:'image/jpeg'});Object.assign(f.rows('assetPrivateFile')[2],{voidedAt:new Date(),voidedBy:assetActor.id,voidReason:'旧版本'});
 const tx={...f.tx,adminUser:{findUnique:async()=>{throw Error('Internal facts must not invent a staff actor');}}};
 const facts=await (assetFiles as any).readBaasRegistrationPdfFiles(tx,'contract');assert.deepEqual(facts.map((row:any)=>row.id),['file-a']);assert.deepEqual(Object.keys(facts[0]).sort(),['id','mimeType','name','sha256','size']);
 Object.assign(f.rows('assetPrivateFile')[0],{baasContractId:'foreign'});assert.deepEqual(await (assetFiles as any).readBaasRegistrationPdfFiles(tx,'contract'),[]);
 f.rows('assetPrivateFile')[0].baasContractId='contract';f.rows('assetPrivateFile')[0].sha256='b'.repeat(64);await assert.rejects((assetFiles as any).readBaasRegistrationPdfFiles(tx,'contract'),assetError('ASSET_FILE_INVALID'));
});
