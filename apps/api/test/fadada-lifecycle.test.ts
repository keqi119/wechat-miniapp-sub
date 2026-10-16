import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Db } from '../src/common/db';
import { FadadaESignGateway } from '../src/esign/fadada/fadada-esign.provider';
import { FadadaApiClient } from '../src/esign/fadada/fadada-api.client';
import { FadadaHttpClient } from '../src/esign/fadada/fadada-http-client';
import { encryptIdentity } from '../src/esign/fadada/fadada-safety';
import { buildFadadaMsgDigest } from '../src/esign/fadada/fadada-digest';
import { ContractPdfArtifactWriterService } from '../src/contract/contract-pdf-artifact-writer.service';
let db:Db,gateway:FadadaESignGateway,customer:any,account:any,pdf:Buffer,prefix:string,settings:any;
let approved=true,customerSigned=false,platformSigned=false,downloadFails=false,replaceLease=false,sealCalls=0,uploadCalls=0,activeTask:any;
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;db=new Db();prefix='life-'+randomUUID();
  customer=await db.customer.create({data:{mobile:'137'+String(Date.now()).slice(-8),name:'Synthetic customer'}});
  const key=Buffer.alloc(32,9).toString('base64');
  const identityCiphertext=encryptIdentity({name:'Synthetic customer',idCardNo:'110101199001010000'},customer.id,key);
  account=await db.eSignAccount.create({data:{customerId:customer.id,providerCustomerId:prefix,registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',verificationSource:'QUERY',verifiedAt:new Date(),checkedAt:new Date(),certStatus:'BOUND',certSerialNo:'certificate',identityCiphertext,verifiedIdentityHash:createHash('sha256').update(identityCiphertext).digest('hex'),verifiedSerialNo:'synthetic-serial',verificationTransactionNo:prefix+'-verification'}});
  const doc=new PDFDocument();const chunks:Buffer[]=[];const done=new Promise<Buffer>(resolve=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));});doc.text('Synthetic signing source');doc.end();pdf=await done;
  const sourceHash=createHash('sha256').update(pdf).digest('hex');
  settings={enabled:true,signingEnabled:true,appId:'fixture-app',appSecret:'fixture-secret',baseUrl:'https://api.fadada.com/api/',apiVersion:'2.0',env:'sandbox',requestTimeoutMs:1000,signUrlQuantity:1,signUrlValidityMinutes:30,identityEncryptionKey:key,signNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign',signReturnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'};
  const realWriter=new ContractPdfArtifactWriterService(db);
  const resource={id:prefix,customerId:customer.id,orderId:prefix,status:'DRAFT',documentHash:'a'.repeat(64)};
  const writer:any={resource:async()=>resource,readVerified:async()=>pdf,persistPdf:(...args:any[])=>realWriter.persistPdf(args[0],args[1])};
  const approval=await db.eSignApproval.create({data:{kind:'SUBSCRIPTION',resourceId:prefix,customerId:customer.id,documentHash:resource.documentHash,sourceFileId:'synthetic-source-file',sourcePdfHash:sourceHash,slotCoordinates:[{slotId:'STAGE1_BODY_CUSTOMER',pageNumber:0,x:100,y:200},{slotId:'STAGE1_ATTACHMENT1_CUSTOMER',pageNumber:1,x:100,y:200},{slotId:'STAGE1_BODY_PLATFORM',pageNumber:0,x:500,y:200},{slotId:'STAGE1_ATTACHMENT1_PLATFORM',pageNumber:1,x:500,y:200}],policyId:'synthetic-policy',sealId:'synthetic-seal',requesterId:'requester',approverId:'reviewer',status:'APPROVED',planHash:'synthetic-plan-hash',plan:{},approvedAt:new Date(),expiresAt:new Date(Date.now()+3600000)}});
  const policies:any={approved:async()=>{if(!approved)throw Object.assign(new Error('approval required'),{code:'APPROVAL_REQUIRED'});return{approval,resource,policy:{executionMode:'SEQUENTIAL'},seal:{providerCustomerId:'platform-fixture',providerSignatureId:'seal-fixture'}};}};
  const transport:any=async(req:any)=>{
    const fields=new URLSearchParams(typeof req.body==='string'?req.body:'');
    if(req.url.endsWith('uploaddocs.api')){uploadCalls++;return{status:200,headers:{},bodyText:JSON.stringify({code:'1',doc_id:'uploaded'})};}
    if(req.url.endsWith('query_sign_result.api')){
      const platform=fields.get('customer_id')==='platform-fixture';const signed=platform?platformSigned:customerSigned;
      return{status:200,headers:{},bodyText:JSON.stringify(platform&&!signed?{result_desc:'签署记录为空'}:{contract_id:fields.get('contract_id'),customer_id:fields.get('customer_id'),transaction_id:fields.get('transaction_id'),result_code:signed?'3000':'0',result_desc:signed?'signed':'pending'})};
    }
    if(req.url.endsWith('extsign_auto.api')){sealCalls++;platformSigned=true;return{status:200,headers:{},bodyText:JSON.stringify({code:'1',result_code:'3000'})};}
    if(req.url.endsWith('downLoadContract.api')){if(downloadFails)throw new Error('provider download unavailable');if(replaceLease)await db.fadadaTask.update({where:{id:activeTask.taskId},data:{processingUntil:new Date(Date.now()+120000)}});return{status:200,headers:{'content-type':'application/pdf'},bodyBuffer:pdf};}
    throw new Error('Unexpected provider call '+new URL(req.url).pathname);
  };
  gateway=new FadadaESignGateway(db,settings,new FadadaApiClient(settings,new FadadaHttpClient(settings,transport)),writer,policies);
});
after(async()=>{if(db){await db.fadadaTask.deleteMany({where:{resourceId:prefix}});await db.eSignApproval.deleteMany({where:{resourceId:prefix}});await db.eSignAccount.deleteMany({where:{customerId:customer?.id}});await db.storedFile.deleteMany({where:{customerId:customer?.id}});await db.customer.deleteMany({where:{id:customer?.id}});await db.$disconnect();}});
test('approved document creates one persistent task; repeated create reuses upload and transaction identity',async()=>{
  const input={contractId:prefix,customerId:customer.id,documentHash:'a'.repeat(64),kind:'SUBSCRIPTION' as const,customerName:customer.name,mobile:customer.mobile};
  approved=false;await assert.rejects(gateway.create(input),{code:'APPROVAL_REQUIRED'});assert.equal(uploadCalls,0);approved=true;
  activeTask=await gateway.create(input);const again=await gateway.create(input);
  assert.equal(activeTask.taskId,again.taskId);assert.equal(uploadCalls,1);assert.equal(sealCalls,0);
  assert.equal(await db.fadadaTask.count({where:{resourceId:prefix}}),1);
});
test('customer completion alone never signs; provider PDF failure preserves pending state and retry archives before SIGNED',async()=>{
  assert.equal((await gateway.query(activeTask.taskId)).status,'PENDING');assert.equal(sealCalls,0);
  customerSigned=true;downloadFails=true;await assert.rejects(gateway.query(activeTask.taskId),/provider download unavailable/);
  const pending=await db.fadadaTask.findUniqueOrThrow({where:{id:activeTask.taskId}});assert.notEqual(pending.status,'SIGNED');assert.equal(pending.signedFileId,null);assert.equal(sealCalls,1);
  downloadFails=false;const signed=await gateway.query(activeTask.taskId);assert.equal(signed.status,'SIGNED');assert.ok(signed.signedFileId);assert.equal(sealCalls,1);
  assert.equal((await db.storedFile.findUniqueOrThrow({where:{id:signed.signedFileId!}})).sha256,createHash('sha256').update(pdf).digest('hex'));
});
test('verified callback queries persisted authoritative result and replay never repeats settlement',async()=>{
  const task=await db.fadadaTask.findUniqueOrThrow({where:{id:activeTask.taskId}});
  const payload={transaction_id:task.customerTransactionId,contract_id:task.providerEnvelopeId,timestamp:'20261016190000',result_code:'3001'};
  const msg_digest=buildFadadaMsgDigest({appId:settings.appId,appSecret:settings.appSecret,timestamp:payload.timestamp,businessParams:payload,explicitSortString:payload.transaction_id});
  let settlements=0;
  const settle=async(_task:any,event:any)=>{assert.equal(event.status,'SIGNED');settlements++;};
  assert.equal((await gateway.callback({...payload,msg_digest},settle)).replayed,false);
  assert.equal((await gateway.callback({...payload,msg_digest},settle)).replayed,true);
  assert.equal(settlements,1);
  await assert.rejects(gateway.callback({...payload,msg_digest:'invalid'},settle),(e:any)=>e.getResponse?.().error?.code==='CALLBACK_SIGNATURE');
  await assert.rejects(gateway.callback({...payload,contract_id:'other-envelope',msg_digest},settle),(e:any)=>e.getResponse?.().error?.code==='CALLBACK_TASK_MISMATCH');
  await db.providerEvent.deleteMany({where:{provider:'FADADA_SIGN',resourceId:prefix}});
});
test('expired worker cannot overwrite archive state or clear a newer worker lease',async()=>{
  const signed=await db.fadadaTask.findUniqueOrThrow({where:{id:activeTask.taskId}});
  await db.fadadaTask.update({where:{id:activeTask.taskId},data:{status:'PENDING',signedFileId:null,signedPdfHash:null}});
  replaceLease=true;
  await assert.rejects(gateway.query(activeTask.taskId),(e:any)=>e.getResponse?.().error?.code==='SIGNATURE_LEASE_LOST');
  const retained=await db.fadadaTask.findUniqueOrThrow({where:{id:activeTask.taskId}});
  assert.equal(retained.status,'PENDING');assert.ok(retained.processingUntil&&retained.processingUntil>new Date());
  replaceLease=false;await db.fadadaTask.update({where:{id:activeTask.taskId},data:{status:'SIGNED',signedFileId:signed.signedFileId,signedPdfHash:signed.signedPdfHash,processingUntil:null}});
});
