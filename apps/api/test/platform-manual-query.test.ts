import './legacy-esign-mode';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FadadaESignGateway} from '../src/esign/fadada/fadada-esign.provider';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import * as manual from '../src/esign/platform-handover';
import {createHash} from 'node:crypto';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';

function fixture(signed:boolean|'FAILED'=false){
 let autoCalls=0,downloads=0;
 const task:any={id:'task',kind:'HANDOVER',resourceId:'handover',customerId:'tenant',documentHash:'a'.repeat(64),sourcePdfHash:'b'.repeat(64),sourceFileId:'source',approvalId:'approval',providerEnvelopeId:'envelope',customerProviderId:'tenant-provider',platformProviderId:'platform-provider',customerTransactionId:'TenantTransaction',platformTransactionId:'PlatformTransaction',status:'PENDING',uploadedAt:new Date(),platformSigningMode:'MANUAL',sealRequestedAt:null,platformManualRequestedAt:null};
 const db:any={fadadaTask:{findUnique:async()=>task,findUniqueOrThrow:async()=>task,updateMany:async({data}:any)=>{Object.assign(task,data);return{count:1};}},auditLog:{create:async()=>({})},serial:async(fn:any)=>fn(db)};
 const config:any={enabled:true,signingEnabled:true,appId:'fixture-app',appSecret:'fixture-secret',baseUrl:'https://textapi17.fadada.com/api2/',apiVersion:'2.0',requestTimeoutMs:1000,signNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign'};
 const transport:any=async(req:any)=>{const p=new URLSearchParams(req.body),platform=p.get('customer_id')===task.platformProviderId;
  if(req.url.endsWith('query_sign_result.api'))return{status:200,headers:{},bodyText:JSON.stringify(platform&&!signed?{code:1201,data:null,msg:'签署记录为空'}:{code:1,data:{result:platform&&signed==='FAILED'?'3001':'3000'}})};
  if(req.url.endsWith('extsign_auto.api')){autoCalls++;return{status:200,headers:{},bodyText:JSON.stringify({code:1,result_code:'3000'})};}
  if(req.url.endsWith('downLoadContract.api')){downloads++;return{status:200,headers:{'content-type':'application/pdf'},bodyBuffer:Buffer.from('%PDF-'+'.'.repeat(80))};}
  throw new Error('Unexpected provider request');
 };
 const writer:any={resource:async()=>({id:'handover',customerId:'tenant',manifestHash:task.documentHash,providerTaskId:task.id,confirmedAt:new Date(),order:{customerId:'tenant'}}),readVerified:async()=>Buffer.from('%PDF-'),persistPdf:async()=>({id:'archive',sha256:'c'.repeat(64)})};
 const policies:any={approved:async()=>({seal:{providerCustomerId:task.platformProviderId,providerSignatureId:'seal'},approval:{kind:'HANDOVER',approverId:'reviewer',slotCoordinates:[{slotId:'STAGE2_HANDOVER_PLATFORM',pageNumber:0,x:200,y:400}]}})};
 const gateway=new FadadaESignGateway(db,config,new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config,transport)),writer,policies);
 return{gateway,task,counters:()=>({autoCalls,downloads})};
}
test('manual HANDOVER customer completion queries never dispatch autoSealContract',async()=>{
 const f=fixture();assert.equal((await f.gateway.query('task')).status,'PENDING');assert.deepEqual(f.counters(),{autoCalls:0,downloads:0});assert.equal(f.task.sealRequestedAt,null);
});
test('unrequested manual platform signature cannot be archived',async()=>{
 const f=fixture(true);await assert.rejects(f.gateway.query('task'),(e:any)=>e.getResponse?.()?.error?.code==='PLATFORM_MANUAL_TRACE');assert.deepEqual(f.counters(),{autoCalls:0,downloads:0});
});
test('a requested manual platform failure settles REJECTED on the same task with no new signing action',async()=>{
 const f=fixture('FAILED'),t=f.task;t.platformManualRequestedAt=new Date();t.platformManualSignerId='legal';t.platformManualOwnerId='owner';t.platformManualEvidence={accepted:true,role:'PLATFORM',signerId:'legal',ownerId:'owner',documentHash:t.documentHash,sourceFileId:t.sourceFileId,sourcePdfHash:t.sourcePdfHash,providerCustomerId:t.platformProviderId,providerEnvelopeId:t.providerEnvelopeId,platformTransactionId:t.platformTransactionId,approvalId:'approval',planHash:'plan',certificateSerialNo:'cert',providerSignatureId:'seal',legalRevision:1};
 assert.equal((await f.gateway.query(t.id)).status,'REJECTED');assert.equal(t.status,'REJECTED');assert.deepEqual(f.counters(),{autoCalls:0,downloads:0});
});
test('mode defaults to AUTO, accepts explicit modes, and rejects invalid configuration',()=>{
 const mode=(manual as any).newPlatformSigningMode;
 assert.equal(mode('HANDOVER',{}),'AUTO');assert.equal(mode('HANDOVER',{HANDOVER_PLATFORM_SIGNING_MODE:'MANUAL'}),'MANUAL');assert.equal(mode('SUBSCRIPTION',{HANDOVER_PLATFORM_SIGNING_MODE:'MANUAL'}),'AUTO');
 for(const value of ['manual','MANUL',''])assert.throws(()=>mode('HANDOVER',{HANDOVER_PLATFORM_SIGNING_MODE:value}));
});
test('task creation freezes MANUAL or AUTO once, retries reuse provider identity despite mode changes',async()=>{
 const saved=process.env.HANDOVER_PLATFORM_SIGNING_MODE;
 const make=()=>{
  let task:any=null,uploads=0;const key=Buffer.alloc(32,7).toString('base64'),cipher=encryptIdentity({name:'Synthetic',idCardNo:'110101199001010000'},'tenant',key);
  const account={providerCustomerId:'Tenant',registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',verificationSource:'QUERY',verifiedAt:new Date(),checkedAt:new Date(),certStatus:'BOUND',certSerialNo:'cert',identityCiphertext:cipher,verifiedIdentityHash:createHash('sha256').update(cipher).digest('hex'),verifiedSerialNo:'serial',verificationTransactionNo:'verification'};
  const db:any={eSignAccount:{findUnique:async()=>account},fadadaTask:{findUnique:async()=>task,findUniqueOrThrow:async()=>task,create:async({data}:any)=>task={...data,status:'PREPARED',uploadedAt:null},updateMany:async({data}:any)=>{Object.assign(task,data);return{count:1};}}};
  const config:any={enabled:true,signingEnabled:true,identityEncryptionKey:key,signNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign',signReturnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'};
  const policy:any={approved:async()=>({resource:{id:'handover',customerId:'tenant'},policy:{executionMode:'SEQUENTIAL'},seal:{providerCustomerId:'Platform'},approval:{id:'approval',kind:'HANDOVER',sourceFileId:'source',sourcePdfHash:'b'.repeat(64),slotCoordinates:[{slotId:'STAGE2_HANDOVER_CUSTOMER',pageNumber:0,x:100,y:200}]}})};
  const api:any={uploadDocs:async()=>{uploads++;return{raw:{code:'1'}};},createExternalSignUrl:async()=>({signUrl:'https://textapi17.fadada.com/api2/synthetic'})};
  return{gateway:new FadadaESignGateway(db,config,api,{readVerified:async()=>Buffer.from('%PDF-')} as any,policy),task:()=>task,uploads:()=>uploads};
 };
 const input:any={kind:'HANDOVER',contractId:'handover',customerId:'tenant',documentHash:'a'.repeat(64),mobile:'13900000000'};
 try{
  for(const first of ['MANUAL','AUTO']){const f=make();process.env.HANDOVER_PLATFORM_SIGNING_MODE=first;const a=await f.gateway.create(input),transaction=f.task().platformTransactionId;process.env.HANDOVER_PLATFORM_SIGNING_MODE=first==='MANUAL'?'AUTO':'MANUAL';const b=await f.gateway.create(input);assert.equal(a.taskId,b.taskId);assert.equal(f.task().platformSigningMode,first);assert.equal(f.task().platformTransactionId,transaction);assert.equal(f.uploads(),1);}
  const f=make();process.env.HANDOVER_PLATFORM_SIGNING_MODE='MANUL';await assert.rejects(f.gateway.create(input),(e:any)=>e.getResponse?.()?.error?.code==='PLATFORM_SIGNING_MODE');assert.equal(f.task(),null);
 }finally{if(saved===undefined)delete process.env.HANDOVER_PLATFORM_SIGNING_MODE;else process.env.HANDOVER_PLATFORM_SIGNING_MODE=saved;}
});



