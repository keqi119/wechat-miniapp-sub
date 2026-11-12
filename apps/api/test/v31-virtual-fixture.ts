import {randomUUID,randomInt} from 'node:crypto';
import {hash} from '../src/common/data';
import {platformCallback} from '../src/common/platform-origins';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import type {JourneyHarness} from './seven-module-journey-fixtures';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {syntheticSigningTime,syntheticFinalVerification} from './electronic-fixtures';
import {activateElectronicCooperation} from '../src/electronic-documents/cooperation';
import {archiveSealGrant} from '../src/electronic-documents/seal-authorization';
import {activateElectronicSubscription} from '../src/electronic-documents/subscription';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import {NativeAwareFadadaHttp,NativeAwareFadadaClient} from '../src/esign/native-fadada-adapter';
import {runCustomerIdentity,miniappReturnUrl,MINIAPP_PROVIDER_API} from '../src/esign/native-signing';
export async function completeVirtualPersonalIdentity(h:JourneyHarness,customerId:string){
 const key=process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||Buffer.alloc(32,37).toString('base64');Object.assign(process.env,{ESIGN_IDENTITY_ENCRYPTION_KEY:key,CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',FADADA_APP_ID:'synthetic',FADADA_APP_SECRET:'synthetic-secret',FADADA_BASE_URL:MINIAPP_PROVIDER_API,MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com'});
 const settings:any={enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,appId:'synthetic',appSecret:'synthetic-secret',baseUrl:MINIAPP_PROVIDER_API,apiVersion:'2.0',requestTimeoutMs:1000,identityEncryptionKey:key,verifyNotifyUrl:platformCallback('fadada-identity'),verifyReturnUrl:miniappReturnUrl()},wire:any[]=[],providerId='synthetic-person-'+customerId;
 const http=new NativeAwareFadadaHttp(settings,async request=>{wire.push(request);const endpoint=new URL(request.url).pathname.split('/').pop()!,responses:any={'account_register.api':{code:'1',data:providerId},'get_person_verify_url.api':{code:'1',transactionNo:'synthetic-attempt-'+customerId,url:Buffer.from('https://realnameverify16.fadada.com/verify?synthetic=1').toString('base64')},'find_personCertInfo.api':{code:'1',status:'2'},'query_cert.api':{code:'1',data:{certType:0,sequenceNo:'synthetic-cert-'+customerId,dn:'CN=1@synthetic@identity@person,O=Synthetic',startTime:new Date(Date.now()-86400000).toISOString(),endTime:new Date(Date.now()+86400000).toISOString()}}};assert.ok(responses[endpoint],'unexpected synthetic identity dispatch');return{status:200,headers:{},bodyText:JSON.stringify(responses[endpoint])};});
 const service=new CustomerESignOnboardingService(h.db,settings,new NativeAwareFadadaClient(settings,http)),customer=await h.db.customer.findUniqueOrThrow({where:{id:customerId}});
 await runCustomerIdentity(()=>service.register(customerId,true),true);await runCustomerIdentity(()=>service.verify(customerId,{name:customer.name,idCardNo:'110101199001010000'},miniappReturnUrl(),true),true);await service.refresh(customerId,true);
 const params=new URLSearchParams(String(wire.find(r=>r.url.endsWith('get_person_verify_url.api')).body));assert.equal(params.get('cert_flag'),'1');assert.equal(params.get('is_mini_program'),'3');assert.ok(wire.some(r=>new URL(r.url).pathname.endsWith('query_cert.api')));const stored=await h.db.eSignAccount.findUniqueOrThrow({where:{customerId}});assert.equal(stored.certStatus,'BOUND');assert.ok(stored.certSubjectHash);return{service,wire};
}
/** Synthetic provider proof only in the guarded local DB; never called by application code. */
export async function seedVirtualEnterpriseProof(h:JourneyHarness,ownerId:string,customerId:string){
 const person=await h.db.customer.update({where:{id:customerId},data:{mobile:'139'+randomInt(10000000,99999999)}}),now=new Date(),serial=randomUUID(),mobileHash=ownerMobileHash(person.mobile);
 await h.db.vehicleOwner.update({where:{id:ownerId},data:{status:'VERIFIED',creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase(),contractProfile:{serviceContactName:'合成联系人',serviceContactChannel:'合成留痕渠道',signerAuthorityRole:'LEGAL_REPRESENTATIVE'}}});
 await h.db.ownerLegalRepresentative.upsert({where:{ownerId},create:{ownerId,name:person.name,mobileHash,maskedMobile:'合成手机号',evidenceHash:'a'.repeat(64),revision:1,createdBy:h.reviewer.id,updatedBy:h.reviewer.id},update:{name:person.name,mobileHash}});
 await h.db.ownerMember.upsert({where:{ownerId_customerId:{ownerId,customerId}},create:{ownerId,customerId,status:'VERIFIED',verifiedAt:now,verifiedSerialNo:serial},update:{status:'VERIFIED',verifiedAt:now,verifiedSerialNo:serial}});
 const account=await h.db.ownerESignAccount.create({data:{ownerId,providerCustomerId:'SYN-'+randomUUID(),realNameStatus:'VERIFIED',managerCustomerId:customerId,verificationTransactionNo:serial,evidenceHash:'b'.repeat(64),checkedAt:now,verifiedAt:now,consentSnapshot:{ownerId,customerId,legalRevision:1,legalName:person.name,legalMobileHash:mobileHash,channel:'OWNER_LEGAL_H5'},certStatus:'BOUND',certSerialNo:serial,certValidFrom:new Date(now.getTime()-86400000),certValidUntil:new Date(now.getTime()+86400000),certEvidenceHash:'c'.repeat(64),certSubjectHash:hash('SYNTHETIC '+serial),certCheckedAt:now}});
 const seal=await h.db.ownerSeal.create({data:{ownerId,providerCustomerId:account.providerCustomerId!,providerSignatureId:'SYN-SEAL-'+randomUUID(),status:'ACTIVE',imageHash:'d'.repeat(64),imageCiphertext:'SYNTHETIC-NOT-REAL',selectedBy:customerId,selectedAt:now,checkedAt:now}});
 return{account,seal};
}
export async function finishVirtualTask(h:JourneyHarness,task:any,actors:any[]){
 const signed=new Set<string>();const provider:any={upload:async()=>({evidenceHash:'a'.repeat(64)}),manualUrl:async()=>({url:'https://synthetic.invalid/'}),querySigner:async(_d:any,p:any)=>({...syntheticSigningTime(new Date()),status:signed.has(p.transactionId)?'SIGNED':'ABSENT',evidenceHash:'b'.repeat(64)}),fileContract:async()=>({evidenceHash:'c'.repeat(64)}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSynthetic virtual proof '+randomUUID()+'\n%%EOF')}),verifyFinalFile:async(t:any,b:Buffer)=>syntheticFinalVerification(t,createHash('sha256').update(b).digest('hex'))};
 const service=new ElectronicDocumentService(h.db,provider,new ContractPdfArtifactWriterService(h.db),{afterArchive:async(tx:any,t:any)=>t.kind==='COOPERATION_GRANT'?archiveSealGrant(tx,t):t.kind==='COOPERATION'?activateElectronicCooperation(tx,t):activateElectronicSubscription(tx,t)});
 const command=(revision:number)=>({revision,idempotencyKey:randomUUID()});let current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});
 await service.start({kind:'ADMIN',id:h.reviewer.id},task.id,command(current.revision));
 for(const actor of actors){current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.sign(actor,task.id,{...command(current.revision),sourceSha256:task.sourceSha256,accepted:true});const party=await h.db.electronicSigningParty.findFirstOrThrow({where:{taskId:task.id,subjectId:actor.kind==='CUSTOMER'?actor.id:actor.ownerId}});signed.add(party.transactionId);current=await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});await service.sync(actor,task.id,command(current.revision));}
 assert.equal((await h.db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id}})).status,'ARCHIVED');return service;
}
