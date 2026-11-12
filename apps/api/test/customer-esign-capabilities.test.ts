import {test} from 'node:test';
import assert from 'node:assert/strict';
import {H5AuthController} from '../src/h5-sign/auth.controller';
import {requireNativeSigning} from '../src/esign/native-signing';
import {TechnicalAcceptanceService} from '../src/technical-acceptance/service';
import {OrderChangesService} from '../src/order-changes/service';

const configured={MINIAPP_SIGNING_ENABLED:'true',MINIAPP_FACE_BRIDGE_ENABLED:'true',MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',TECHNICAL_ACCEPTANCE_SIGNING_ENABLED:'true'};
async function withConfig<T>(values:Record<string,string|undefined>,work:()=>Promise<T>|T){
 const next={...configured,...values},before=Object.fromEntries(Object.keys(next).map(key=>[key,process.env[key]]));
 for(const[key,value]of Object.entries(next))if(value===undefined)delete process.env[key];else process.env[key]=value;
 try{return await work();}finally{for(const[key,value]of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
const blockedModes=[{NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'true'},{NEW_ORDER_CONTRACT_MODE:'ESIGN',ESIGN_NEW_REQUESTS_ENABLED:'false'},{NEW_ORDER_CONTRACT_MODE:undefined,ESIGN_NEW_REQUESTS_ENABLED:'true'}];

test('public signing capability closes all new native and face flows in OFFLINE, including legacy flags accidentally enabled',async()=>{
 for(const values of blockedModes)await withConfig(values,()=>{
  const result:any=new H5AuthController({} as any,{} as any).publicConfig();
  assert.equal(result.mode,'MINIAPP_WEBVIEW');
  assert.equal(result.newOrderContractMode,values.NEW_ORDER_CONTRACT_MODE==='ESIGN'?'ESIGN':'OFFLINE');
  assert.equal(result.newEsignRequestsEnabled,false);assert.equal(result.enabled,false);
  assert.equal(result.signProviderConfigured,true);assert.equal(result.faceBridgeConfigured,false);
  assert.equal(result.faceBridgeProtocol,null);assert.deepEqual(result.faceBridgeKinds,[]);
  assert.throws(()=>requireNativeSigning());
 });
});
test('ESIGN total capability and native channel switches remain independent and fail closed when total flag is missing',async()=>{
 for(const [total,native,capability,enabled]of [['true','true',true,true],['true','false',true,false],[undefined,'true',false,false]] as const)await withConfig({NEW_ORDER_CONTRACT_MODE:'ESIGN',ESIGN_NEW_REQUESTS_ENABLED:total,MINIAPP_SIGNING_ENABLED:native},()=>{
  const result:any=new H5AuthController({} as any,{} as any).publicConfig();
  assert.equal(result.newOrderContractMode,'ESIGN');assert.equal(result.newEsignRequestsEnabled,capability);assert.equal(result.enabled,enabled);assert.equal(result.faceBridgeConfigured,enabled);
  if(enabled)assert.doesNotThrow(()=>requireNativeSigning());else assert.throws(()=>requireNativeSigning());
 });
});

function technicalFixture(){
 const record:any={id:'technical',customerId:'customer',revision:1,status:'DRAFT',createdAt:new Date('2026-01-01'),confirmedAt:null,stoppedAt:null,purgedAt:null,purgeStartedAt:null,retentionDueAt:null,legalHold:false,documentId:'document',templateVersion:1,templateHash:'a'.repeat(64),bodyHash:'b'.repeat(64),documentHash:'c'.repeat(64),sourcePdfHash:'d'.repeat(64),sourceFileId:'source',signedFileId:null,body:'Historical technical document',signingLeaseUntil:null};
 let task:any=null;
 const approval={id:'approval',status:'APPROVED',expiresAt:new Date('2099-01-01'),requesterId:'maker',approverId:'reviewer',planHash:'e'.repeat(64)};
 const db:any={technicalAcceptance:{findFirst:async({where}:any)=>where.id===record.id&&(!where.customerId||where.customerId===record.customerId)?record:null},fadadaTask:{findFirst:async()=>task},eSignApproval:{findFirst:async()=>approval,findUnique:async()=>approval},legalDocument:{findFirst:async({where}:any)=>({id:where.type,version:1,type:where.type,status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'reviewer'})},customerConsent:{count:async()=>1}};
 const noExternal:any=new Proxy({},{get(){throw new Error('Read projection must not use signing provider, PDF writer or policy mutations');}});
 return{record,service:new TechnicalAcceptanceService(db,noExternal,noExternal,noExternal),setTask:(value:any)=>{task=value;}};
}
test('technical history cannot confirm, prepare or sign when new electronic handling is closed',async()=>{
 for(const values of blockedModes)await withConfig(values,async()=>{
  const f=technicalFixture();let view=await f.service.view('technical',false,'customer');
  assert.equal(view.canConfirm,false);assert.equal(view.enabled,false);assert.equal(view.sourceFileId,'source');assert.equal(view.document.content,f.record.body);assert.equal(view.status,'AWAITING_CONFIRMATION');assert.doesNotMatch(view.statusMessage,/请本人.*同意/);assert.match(view.statusMessage,/关闭/);
  f.record.confirmedAt=new Date();view=await f.service.view('technical',true);assert.equal(view.canPrepare,false);
  view=await f.service.view('technical',false,'customer');assert.equal(view.canSign,false);assert.equal(view.status,'CONFIRMED');
 });
});
test('technical existing confirmation and archived signature evidence survive disabling new requests',async()=>{
 await withConfig({NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
  const f=technicalFixture();f.record.confirmedAt=new Date('2026-01-02');f.record.status='SIGNED';f.record.signedFileId='signed';f.record.completedAt=new Date('2026-01-03');
  f.setTask({approvalId:'approval',status:'SIGNED',customerSignedAt:f.record.confirmedAt,uploadedAt:new Date('2026-01-02')});
  const view=await f.service.view('technical',false,'customer');assert.equal(view.status,'SIGNED');assert.equal(view.signatureStatus,'SIGNED');assert.equal(view.signedFileId,'signed');assert.equal(view.canSign,false);assert.equal(view.canConfirm,false);assert.equal(view.canSync,true);assert.equal(view.completedAt,f.record.completedAt);
  await assert.rejects(f.service.view('technical',false,'other'),(e:any)=>e.getStatus?.()===404);
 });
});
test('explicit ESIGN mode retains technical confirmation and signing prerequisites',async()=>{
 await withConfig({NEW_ORDER_CONTRACT_MODE:'ESIGN',ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
  const f=technicalFixture();assert.equal((await f.service.view('technical',false,'customer')).canConfirm,true);
  f.record.confirmedAt=new Date();assert.equal((await f.service.view('technical',true)).canPrepare,true);assert.equal((await f.service.view('technical',false,'customer')).canSign,true);
 });
});

function changeFixture(){
 const quote:any={id:'quote',revision:1,status:'PUBLISHED',commercialHash:'a'.repeat(64),snapshot:{expiresAt:'2099-01-01T00:00:00Z',periods:[],document:{id:'document',content:'Historical amendment'}},contract:{id:'amendment',executionMode:'ESIGN',status:'DRAFT',sourceFileId:'source',signedFileId:null}};
 const item:any={id:'change',orderId:'order',customerId:'customer',kind:'DELIVERY_DELAY',status:'AWAITING_CONFIRMATION',revision:1,activeQuoteId:'quote',quotes:[quote]};
 const tx:any={orderChange:{findFirst:async({where}:any)=>where.id===item.id&&(!where.customerId||where.customerId===item.customerId)?item:null},delayQuote:{findUniqueOrThrow:async()=>quote},serviceObligation:{findMany:async()=>[]},refund:{findMany:async()=>[]},bill:{findMany:async()=>[]}};
 return{item,quote,tx,service:new OrderChangesService(tx,()=>new Date())};
}
test('historical order changes close new confirmation and signature but retain quotes, files and controlled sync',async()=>{
 for(const values of blockedModes)await withConfig(values,async()=>{
  const f=changeFixture();let view=await f.service.view(f.tx,'change',undefined,'customer');assert.equal(view.canConfirm,false);assert.equal(view.quote?.document.content,'Historical amendment');
  f.item.status='AWAITING_SIGNATURE';f.quote.status='CONFIRMED';view=await f.service.view(f.tx,'change',undefined,'customer');assert.equal(view.canSign,false);assert.equal(view.contract?.sourceFileId,'source');assert.equal(view.canSync,true);
  assert.equal((await f.service.view(f.tx,'change',{id:'operator',role:'OPERATIONS'})).canPrepareSignature,false);
  f.item.status='APPLIED';f.quote.contract.status='SIGNED';f.quote.contract.signedFileId='signed';view=await f.service.view(f.tx,'change',undefined,'customer');assert.equal(view.status,'APPLIED');assert.equal(view.contract?.status,'SIGNED');assert.equal(view.contract?.signedFileId,'signed');
  await assert.rejects(f.service.view(f.tx,'change',undefined,'other'),(e:any)=>e.getStatus?.()===404);
 });
});
test('explicit ESIGN retains valid change capabilities while OFFLINE amendment objects never gain signing',async()=>{
 await withConfig({NEW_ORDER_CONTRACT_MODE:'ESIGN',ESIGN_NEW_REQUESTS_ENABLED:'true'},async()=>{
  const f=changeFixture();assert.equal((await f.service.view(f.tx,'change',undefined,'customer')).canConfirm,true);
  f.item.status='AWAITING_SIGNATURE';f.quote.status='CONFIRMED';assert.equal((await f.service.view(f.tx,'change',undefined,'customer')).canSign,true);
  f.quote.contract.executionMode='OFFLINE';assert.equal((await f.service.view(f.tx,'change',undefined,'customer')).canSign,false);
 });
});
test('ELECTRONIC native capability is separate from legacy and requires every explicit channel gate',async()=>{
 for(const [electronic,total,native,expected] of [['true','true','true',true],['false','true','true',false],['true','false','true',false],['true','true','false',false]] as const)await withConfig({NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',ELECTRONIC_SIGNING_ENABLED:electronic,ESIGN_NEW_REQUESTS_ENABLED:total,MINIAPP_SIGNING_ENABLED:native},()=>{
  const result:any=new H5AuthController({} as any,{} as any).publicConfig();assert.equal(result.electronicEnabled,expected);assert.equal(result.enabled,false);assert.equal(result.newEsignRequestsEnabled,false);assert.throws(()=>requireNativeSigning());
 });
});
