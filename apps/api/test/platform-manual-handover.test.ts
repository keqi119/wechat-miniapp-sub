import './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {FadadaESignGateway} from '../src/esign/fadada/fadada-esign.provider';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import {FadadaOwnerClient,runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {buildFadadaMsgDigest} from '../src/esign/fadada/fadada-digest';
import {SignatureService} from '../src/orders/signature.service';
import {OwnerH5HandoversService} from '../src/owner-h5/handovers.service';
import {createApp} from '../src/app';
import {listenForHttpTests} from './http-listener';
import {tokenHash} from '../src/auth/auth.service';
import {OWNER_H5_COOKIE} from '../src/owner-h5/config';
import {hashSigningPlanPayload} from '../src/esign/enterprise-seal/signing-plan-hash';
let db:Db,f:any,task:any,handover:any,approval:any,config:any,gateway:FadadaESignGateway,writer:ContractPdfArtifactWriterService,client:any;
let customerSigned=false,platformSigned=false,platformFailed=false,approved=true,certValid=true,sealValid=true,sealCalls=0,entries=0;
let service:OwnerH5HandoversService,app:any,base:string;const session=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),origin='https://app.subauto.keybox.cloud';
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
const accept=()=>({accepted:true,documentHash:task.documentHash,sourceSha256:task.sourcePdfHash});
before(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55432');assert.equal(url.pathname,'/chundian_test');process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.NODE_ENV='test';process.env.SESSION_SECRET='synthetic-manual-platform-session-key-0123456789';process.env.HANDOVER_PLATFORM_SIGNING_MODE='MANUAL';
 db=new Db();f=await ownerAuthorityFixture(db);process.env.PLATFORM_LEGAL_ENTITY_NAME=f.owner.name;
 f.customer=await db.customer.update({where:{id:f.customer.id},data:{mobile:'139'+randomInt(10000000,99999999)}});
 const profile=await db.ownerLegalRepresentative.create({data:{ownerId:f.owner.id,name:'合成法人',mobileHash:ownerMobileHash(f.customer.mobile),maskedMobile:'139****0000',evidenceHash:hash('legal'),createdBy:'fixture',updatedBy:'fixture'}});
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{evidenceHash:hash('identity'),consentedAt:new Date(),consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:f.customer.id,legalRevision:profile.revision,legalName:profile.name,legalMobileHash:profile.mobileHash}}});
 for(const d of f.docs.filter((d:any)=>['terms','privacy'].includes(d.type)))await db.customerConsent.create({data:{customerId:f.customer.id,documentId:d.id,type:d.type,version:d.version,source:'fixture'}});
 const tenant=await db.customer.create({data:{mobile:'tenant'+randomUUID()}}),plan=await db.subscriptionPlan.create({data:{vehicleId:f.vehicle.id,name:'fixture',months:12,monthlyFeeAmount:1,mileagePerMonthKm:100,excessMileagePriceAmount:1,energyDescription:'fixture',benefits:[],conditions:'fixture'}}),application=await db.application.create({data:{customerId:tenant.id,vehicleId:f.vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'fixture',status:'FINAL_PLAN_CONFIRMED'}}),order=await db.order.create({data:{applicationId:application.id,customerId:tenant.id,vehicleId:f.vehicle.id,confirmedMileageKm:100,finalPlanSnapshot:{}}});
 handover=await db.handover.create({data:{orderId:order.id,customerId:tenant.id,type:'DELIVERY',readingKm:100,fileIds:[],checklist:{},manifestHash:hash(randomUUID()),status:'CUSTOMER_CONFIRMED',signatureStatus:'PENDING',confirmedAt:new Date()}});
 writer=new ContractPdfArtifactWriterService(db);const file=await writer.persistPdf(Buffer.from('%PDF-'+'.'.repeat(100)),{customerId:tenant.id,name:'synthetic.pdf',purpose:'contract'});
 f.enterpriseSeal=await db.enterpriseSeal.create({data:{sealName:'fixture',organizationName:f.owner.name,providerCustomerId:f.seal.providerCustomerId,providerSignatureId:f.seal.providerSignatureId,status:'ACTIVE',evidenceFileId:'fixture',confirmedBy:'reviewer',confirmedAt:new Date()}});
 approval=await db.eSignApproval.create({data:{kind:'HANDOVER',resourceId:handover.id,customerId:tenant.id,documentHash:handover.manifestHash,sourceFileId:file.id,sourcePdfHash:file.sha256,slotCoordinates:[{slotId:'STAGE2_HANDOVER_PLATFORM',pageNumber:0,x:200,y:400}],policyId:'fixture',sealId:f.enterpriseSeal.id,requesterId:'requester',approverId:'reviewer',status:'APPROVED',planHash:hash('plan'),plan:{},approvedAt:new Date(),expiresAt:new Date(Date.now()+3600000)}});
 approval=await db.eSignApproval.update({where:{id:approval.id},data:{planHash:hashSigningPlanPayload({compiledPlan:approval.plan,documentHash:approval.documentHash,sourcePdfHash:approval.sourcePdfHash,slotCoordinates:approval.slotCoordinates})}});
 const prefix=randomUUID().replaceAll('-','');task=await db.fadadaTask.create({data:{kind:'HANDOVER',resourceId:handover.id,customerId:tenant.id,documentHash:handover.manifestHash,sourceFileId:file.id,sourcePdfHash:file.sha256,approvalId:approval.id,providerEnvelopeId:'E'+prefix,customerProviderId:'Tenant'+prefix,platformProviderId:f.seal.providerCustomerId,customerTransactionId:prefix,platformTransactionId:randomUUID().replaceAll('-',''),platformSigningMode:'MANUAL',uploadedAt:new Date(),status:'PENDING'}});await db.handover.update({where:{id:handover.id},data:{providerTaskId:task.id}});
 config={enabled:true,signingEnabled:true,appId:'fixture-app',appSecret:'fixture-secret',baseUrl:'https://textapi17.fadada.com/api2/',apiVersion:'2.0',requestTimeoutMs:1000,platformCustomerId:f.seal.providerCustomerId,platformSignatureId:f.seal.providerSignatureId,signNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign'};
 const transport:any=async(req:any)=>{const p=new URLSearchParams(req.body),platform=p.get('customer_id')===task.platformProviderId,signed=platform?platformSigned:customerSigned;
  if(req.url.endsWith('query_sign_result.api'))return{status:200,headers:{},bodyText:JSON.stringify(!signed?{code:1201,data:null,msg:'签署记录为空'}:{code:1,data:{result:platform&&platformFailed?'3001':'3000'}})};
  if(req.url.endsWith('extsign_auto.api')){sealCalls++;throw new Error('AUTO MUST NEVER BE CALLED');}
  if(req.url.endsWith('downLoadContract.api'))return{status:200,headers:{'content-type':'application/pdf'},bodyBuffer:Buffer.from('%PDF-'+':signed:'.repeat(30))};
  throw new Error('Unexpected provider request');
 };
 const pageClient=new FadadaOwnerClient(config);
 client={queryCertificate:async()=>({customerId:f.seal.providerCustomerId,bound:certValid,serialNo:'Cert'+f.seal.providerCustomerId.slice('Company'.length)}),querySeals:async()=>sealValid?[{customerId:f.seal.providerCustomerId,signatureId:f.seal.providerSignatureId,imageHash:f.seal.imageHash}]:[],createPlatformHandoverSignUrl:(input:any)=>{entries++;return pageClient.createPlatformHandoverSignUrl(input);}};
 const policies:any={approved:async(_kind:string,_id:string,_hash:string,approvalId?:string)=>{assert.ok(approved,'approval revoked');const a=await db.eSignApproval.findUniqueOrThrow({where:{id:approvalId||approval.id}});if(a.expiresAt<=new Date())throw new Error('approval expired');return{approval:a,policy:{executionMode:'SEQUENTIAL'},seal:{id:f.enterpriseSeal.id,providerCustomerId:f.seal.providerCustomerId,providerSignatureId:f.seal.providerSignatureId},resource:await writer.resource('HANDOVER',handover.id)};}};
 gateway=new FadadaESignGateway(db,config,new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config,transport)),writer,policies,client);
 service=new OwnerH5HandoversService(db,gateway,writer,new SignatureService(db),config);
 process.env.OWNER_LEGAL_H5_ENABLED='true';process.env.PORTAL_SMS_ENABLED='true';process.env.H5_SIGNING_ORIGIN=origin;
 for(const key of ['ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_LOGIN_TEMPLATE_CODE'])process.env[key]='synthetic-unused';
 await db.ownerH5Session.create({data:{id:tokenHash(session),customerId:f.customer.id,csrfToken:'csrf',expiresAt:new Date(Date.now()+3600000)}});
 app=await createApp({db,extraProviders:[{provide:OwnerH5HandoversService,useValue:service}]});base=(await listenForHttpTests(app))+'/api';
});
after(async()=>{await app?.close();await db?.$disconnect();delete process.env.PLATFORM_LEGAL_ENTITY_NAME;});
test('H5 exposes safe pending handover summaries and other verified companies have an empty list',async()=>{
 const list=await service.list(f.customer.id,f.owner.id);assert.equal(list.enabled,true);assert.equal(list.items[0].documentDomain,'PLATFORM_HANDOVER');assert.equal(list.items[0].handoverType,'DELIVERY');assert.equal(list.items[0].canSign,false);assert.deepEqual(list.items[0].parties.map(p=>p.role),['CUSTOMER','PLATFORM']);assert.equal(list.items[0].monthlyFeeAmount,null);
 for(const secret of [task.providerEnvelopeId,task.customerProviderId,task.platformProviderId,task.platformTransactionId])assert.ok(!JSON.stringify(list).includes(secret));
 const other=new OwnerH5HandoversService(db,gateway,writer,new SignatureService(db),{...config,platformCustomerId:'another'});assert.deepEqual((await other.list(f.customer.id,f.owner.id)).items,[]);assert.equal((await other.list(f.customer.id,f.owner.id)).manualSigningEnabled,false);await assert.rejects(other.detail(f.customer.id,f.owner.id,task.id),error('NOT_FOUND'));
 const member=await db.ownerMember.findUniqueOrThrow({where:{ownerId_customerId:{ownerId:f.owner.id,customerId:f.customer.id}}});await db.ownerMember.update({where:{id:member.id},data:{status:'CLAIMED'}});try{await assert.rejects(service.list(f.customer.id,f.owner.id),error('OWNER_LEGAL_NOT_VERIFIED'));}finally{await db.ownerMember.update({where:{id:member.id},data:{status:'VERIFIED'}});}
});
test('readonly portal rejects historical owner sessions and signing routes while legacy internal evidence remains readable',async()=>{
 const path=`/owner-h5/owners/${f.owner.id}/handovers/${task.id}`,cookie=OWNER_H5_COOKIE+'='+session;
 assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,401);
 assert.equal((await fetch(base+path+'/sign',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(accept())})).status,403);
 assert.equal((await fetch(base+path+'/sync',{method:'POST',headers:{Cookie:cookie,Origin:'https://bad.invalid','X-CSRF-Token':'csrf','Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+path+'/sync',{headers:{Cookie:cookie}})).status,404);
 assert.equal((await fetch(base+path+'/files/other',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await service.file(f.customer.id,f.owner.id,task.id,'source')).subarray(0,5).toString(),'%PDF-');await assert.rejects(service.file(f.customer.id,f.owner.id,task.id,'signed'),error('NOT_FOUND'));
});
test('manual entry enforces customer-first, confirmed hashes and current approval before issuing a URL',async()=>{
 await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_CUSTOMER_REQUIRED'));
 customerSigned=true;await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,{...accept(),accepted:false}));
 await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,{...accept(),signatureId:'injected'}));
 await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,{...accept(),sourceSha256:'0'.repeat(64)}),error('DOCUMENT_MISMATCH'));
 approved=false;try{await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept()),/approval revoked/);}finally{approved=true;}assert.equal(entries,0);
});
test('manual entry rejects stale certificate, selected seal, changed legal revision and foreign enterprise',async()=>{
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}});await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date(0)}});try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_CERTIFICATE'));}finally{await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:account.checkedAt}});}
 await db.ownerSeal.update({where:{id:f.seal.id},data:{status:'DISCOVERED'}});try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_SEAL'));}finally{await db.ownerSeal.update({where:{id:f.seal.id},data:{status:'ACTIVE'}});}
 certValid=false;try{await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_CERTIFICATE'));}finally{certValid=true;}
 sealValid=false;try{await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_SEAL'));}finally{sealValid=true;}
 const p=await db.ownerLegalRepresentative.findUniqueOrThrow({where:{ownerId:f.owner.id}});await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{revision:p.revision+1}});try{await assert.rejects((gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('OWNER_LEGAL_NOT_VERIFIED'));}finally{await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{revision:p.revision}});}
 await assert.rejects((gateway as any).platformManualSign('outsider',f.owner.id,task.id,accept()),error('OWNER_LEGAL_REQUIRED'));assert.equal(entries,0);
});
test('closed entry, old AUTO mode, expired review, changed file and ownership all block new entry',async()=>{
 process.env.HANDOVER_PLATFORM_SIGNING_MODE='AUTO';try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_MANUAL_DISABLED'));}finally{process.env.HANDOVER_PLATFORM_SIGNING_MODE='MANUAL';}
 await db.fadadaTask.update({where:{id:task.id},data:{platformSigningMode:'AUTO'}});try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('NOT_FOUND'));}finally{await db.fadadaTask.update({where:{id:task.id},data:{platformSigningMode:'MANUAL'}});}
 await db.eSignApproval.update({where:{id:approval.id},data:{expiresAt:new Date(0)}});try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),/approval expired/);}finally{await db.eSignApproval.update({where:{id:approval.id},data:{expiresAt:approval.expiresAt}});}
 const file=await db.storedFile.findUniqueOrThrow({where:{id:task.sourceFileId}});await db.storedFile.update({where:{id:file.id},data:{sha256:'0'.repeat(64)}});try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('ARTIFACT_HASH_MISMATCH'));}finally{await db.storedFile.update({where:{id:file.id},data:{sha256:file.sha256}});}
 await db.handover.update({where:{id:handover.id},data:{manifestHash:'f'.repeat(64)}});try{await assert.rejects(service.detail(f.customer.id,f.owner.id,task.id),error('DOCUMENT_MISMATCH'));await assert.rejects(service.sync(f.customer.id,f.owner.id,task.id,{}),error('DOCUMENT_MISMATCH'));}finally{await db.handover.update({where:{id:handover.id},data:{manifestHash:handover.manifestHash}});}
 assert.equal(entries,0);assert.equal(sealCalls,0);
});
test('valid callbacks cannot accept an unrequested platform signature or dispatch an automatic seal',async()=>{
 platformSigned=true;const payload={transaction_id:task.customerTransactionId,contract_id:task.providerEnvelopeId,timestamp:'20261025105900',result_code:'3000'},msg_digest=buildFadadaMsgDigest({appId:config.appId,appSecret:config.appSecret,timestamp:payload.timestamp,businessParams:payload,explicitSortString:payload.transaction_id});let settled=false;
 try{await assert.rejects(gateway.callback({...payload,msg_digest},async()=>{settled=true;}),error('PLATFORM_MANUAL_TRACE'));assert.equal(settled,false);assert.equal(sealCalls,0);}finally{platformSigned=false;}
});
test('repeated manual entries preserve envelope and transaction, save explicit evidence and use fadada-sign callback',async()=>{
 const a=await (gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept()),b=await (gateway as any).platformManualSign(f.customer.id,f.owner.id,task.id,accept());
 for(const result of [a,b]){const url=new URL(result.url);assert.equal(url.searchParams.get('transaction_id'),task.platformTransactionId);assert.equal(url.searchParams.get('contract_id'),task.providerEnvelopeId);assert.equal(url.searchParams.get('signature_id'),config.platformSignatureId);assert.equal(url.searchParams.get('notify_url'),config.signNotifyUrl);assert.equal(url.searchParams.get('open_environment'),'0');}
 const t=await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});assert.ok(t.platformManualRequestedAt);assert.equal(t.platformManualSignerId,f.customer.id);assert.equal((t.platformManualEvidence as any).accepted,true);assert.equal(t.sealRequestedAt,null);assert.equal(sealCalls,0);
});
test('changing the selected platform seal preserves old pending document reads but blocks any new signature entry',async()=>{
 const previous=config.platformSignatureId;config.platformSignatureId='ReplacementSeal';
 try{
  assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);
  assert.equal((await service.list(f.customer.id,f.owner.id)).items.length,1);
  assert.equal((await service.file(f.customer.id,f.owner.id,task.id,'source')).subarray(0,5).toString(),'%PDF-');
  await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_SEAL'));
 }finally{config.platformSignatureId=previous;}
});
test('normal same-identity refresh permits re-entry but substantive certificate changes stay blocked',async()=>{
 await db.vehicleOwner.update({where:{id:f.owner.id},data:{revision:{increment:1}}});await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date()}});await db.ownerSeal.update({where:{id:f.seal.id},data:{checkedAt:new Date()}});
 assert.ok((await gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept())).url);
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}});await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{certSerialNo:'renewed-certificate'}});try{await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_MANUAL_IDENTITY_CHANGED'));}finally{await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{certSerialNo:account.certSerialNo}});}
});
test('only a verified same-document approval renewal chain permits re-entry and preserves the former consent evidence',async()=>{
 const previous=await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}}),old=await db.eSignApproval.update({where:{id:previous.approvalId},data:{expiresAt:new Date(0)}});
 const create=async(plan:any)=>db.eSignApproval.create({data:{kind:old.kind,resourceId:old.resourceId,customerId:old.customerId,documentHash:old.documentHash,sourceFileId:old.sourceFileId,sourcePdfHash:old.sourcePdfHash,slotCoordinates:old.slotCoordinates as any,policyId:old.policyId,sealId:old.sealId,requesterId:'requester',approverId:'second-reviewer',status:'APPROVED',approvedAt:new Date(),expiresAt:new Date(Date.now()+3600000),plan,planHash:hashSigningPlanPayload({compiledPlan:plan,documentHash:old.documentHash,sourcePdfHash:old.sourcePdfHash,slotCoordinates:old.slotCoordinates})}});
 const forged=await create({});await db.fadadaTask.update({where:{id:task.id},data:{approvalId:forged.id}});await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('PLATFORM_MANUAL_RENEWAL'));
 const renewed=await create({renewal:{taskId:task.id,priorApprovalId:old.id}});await db.fadadaTask.update({where:{id:task.id},data:{approvalId:renewed.id}});
 const entry=await gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept());assert.equal(new URL(entry.url).searchParams.get('transaction_id'),task.platformTransactionId);
 const current=await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});assert.equal((current.platformManualEvidence as any).approvalId,renewed.id);assert.equal(current.platformManualRequestedAt?.getTime(),previous.platformManualRequestedAt?.getTime());
 const log=await db.auditLog.findFirst({where:{resourceId:task.id,action:'PLATFORM_HANDOVER_MANUAL_ENTRY'},orderBy:{createdAt:'desc'}});assert.deepEqual((log?.data as any).priorEvidence,previous.platformManualEvidence);assert.equal((log?.data as any).evidence.approvalId,renewed.id);approval=renewed;
});
test('manual query archives trusted signatures after approval expires without dispatch, then settles handover',async()=>{
 platformSigned=true;await db.eSignApproval.update({where:{id:approval.id},data:{expiresAt:new Date(0)}});process.env.HANDOVER_PLATFORM_SIGNING_MODE='AUTO';try{const result=await service.sync(f.customer.id,f.owner.id,task.id,{});assert.equal(result.status,'ARCHIVED');const h=await db.handover.findUniqueOrThrow({where:{id:handover.id}});assert.equal(h.signatureStatus,'SIGNED');assert.ok(h.signedFileId);assert.equal(sealCalls,0);assert.equal((await service.file(f.customer.id,f.owner.id,task.id,'signed')).subarray(0,5).toString(),'%PDF-');}finally{process.env.HANDOVER_PLATFORM_SIGNING_MODE='MANUAL';}
});
test('archived old-seal files remain readable and queryable alongside a new-seal task after configuration changes',async()=>{
 const previous=config.platformSignatureId;config.platformSignatureId='ReplacementSeal';
 try{
  assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).status,'ARCHIVED');
  for(const variant of ['source','signed'])assert.equal((await service.file(f.customer.id,f.owner.id,task.id,variant)).subarray(0,5).toString(),'%PDF-');
  assert.equal((await service.sync(f.customer.id,f.owner.id,task.id,{})).status,'ARCHIVED');
  const seal=await db.enterpriseSeal.create({data:{sealName:'replacement fixture',organizationName:f.owner.name,providerCustomerId:task.platformProviderId,providerSignatureId:config.platformSignatureId,status:'ACTIVE',evidenceFileId:'fixture',confirmedBy:'reviewer',confirmedAt:new Date()}});
  const h=await db.handover.create({data:{orderId:handover.orderId,customerId:task.customerId,type:'RETURN',readingKm:101,fileIds:[],checklist:{},manifestHash:task.documentHash,status:'CUSTOMER_CONFIRMED',signatureStatus:'PENDING',confirmedAt:new Date()}});
  const a=await db.eSignApproval.create({data:{kind:'HANDOVER',resourceId:h.id,customerId:task.customerId,documentHash:task.documentHash,sourceFileId:task.sourceFileId,sourcePdfHash:task.sourcePdfHash,slotCoordinates:[],policyId:'fixture',sealId:seal.id,requesterId:'a',approverId:'b',status:'APPROVED',approvedAt:new Date(),expiresAt:new Date(Date.now()+3600000),plan:{},planHash:'fixture'}});
  const next=await db.fadadaTask.create({data:{kind:'HANDOVER',resourceId:h.id,customerId:task.customerId,documentHash:task.documentHash,sourceFileId:task.sourceFileId,sourcePdfHash:task.sourcePdfHash,approvalId:a.id,platformProviderId:task.platformProviderId,customerProviderId:task.customerProviderId,providerEnvelopeId:randomUUID().replaceAll('-',''),customerTransactionId:randomUUID().replaceAll('-',''),platformTransactionId:randomUUID().replaceAll('-',''),platformSigningMode:'MANUAL',status:'PENDING',uploadedAt:new Date()}});await db.handover.update({where:{id:h.id},data:{providerTaskId:next.id}});
  const list=await service.list(f.customer.id,f.owner.id);assert.equal(list.items.length,2);assert.ok(list.items.some(item=>item.id===task.id&&item.status==='ARCHIVED'));assert.ok(list.items.some(item=>item.id===next.id&&item.status==='PENDING'));
 }finally{config.platformSignatureId=previous;}
});
test('verified manual callbacks query and settle without auto seal and reject forged callbacks',async()=>{
 await db.fadadaTask.update({where:{id:task.id},data:{status:'PENDING',platformSignedAt:null,signedFileId:null,signedPdfHash:null}});await db.handover.update({where:{id:handover.id},data:{signatureStatus:'PENDING',signedFileId:null}});
 const payload={transaction_id:task.platformTransactionId,contract_id:task.providerEnvelopeId,timestamp:'20261025110000',result_code:'3000'},msg_digest=buildFadadaMsgDigest({appId:config.appId,appSecret:config.appSecret,timestamp:payload.timestamp,businessParams:payload,explicitSortString:payload.transaction_id});
 await gateway.callback({...payload,msg_digest},async(t,result)=>new SignatureService(db).settleHandover(t.resourceId,{...result,taskId:t.id}));assert.equal((await db.handover.findUniqueOrThrow({where:{id:handover.id}})).signatureStatus,'SIGNED');assert.equal(sealCalls,0);await assert.rejects(gateway.callback({...payload,msg_digest:'fake'},async()=>{}),error('CALLBACK_SIGNATURE'));
});
test('explicit platform failure settles handover REJECTED and disables any further manual entry',async()=>{
 platformFailed=true;await db.fadadaTask.update({where:{id:task.id},data:{status:'PENDING',platformSignedAt:null,signedFileId:null,signedPdfHash:null}});await db.handover.update({where:{id:handover.id},data:{signatureStatus:'PENDING',signedFileId:null}});
 const result=await service.sync(f.customer.id,f.owner.id,task.id,{});assert.equal(result.status,'REJECTED');assert.equal(result.canSign,false);assert.equal(result.parties.find(p=>p.role==='PLATFORM')?.status,'REJECTED');assert.equal((await db.handover.findUniqueOrThrow({where:{id:handover.id}})).signatureStatus,'REJECTED');
 assert.equal((await service.sync(f.customer.id,f.owner.id,task.id,{})).status,'REJECTED');
 const before=entries;await assert.rejects(gateway.platformManualSign(f.customer.id,f.owner.id,task.id,accept()),error('SIGNATURE_STATE'));assert.equal(entries,before);assert.equal(sealCalls,0);
});


