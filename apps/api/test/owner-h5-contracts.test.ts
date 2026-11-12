import './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerContractAccess} from '../src/owner-signing/contract-access';
import {OwnerSigningTasks} from '../src/owner-signing/tasks';
import {OwnerH5ContractsService} from '../src/owner-h5/contracts.service';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {isOwnerH5Request,runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
import {createApp} from '../src/app';
import {listenForHttpTests} from './http-listener';
import {tokenHash} from '../src/auth/auth.service';
import {OWNER_H5_COOKIE} from '../src/owner-h5/config';

let db:Db,service:OwnerH5ContractsService,f:any,task:any,contract:any,app:any,base:string;
let calls:any[]=[];const secret='owner-workspace-synthetic-session-key-0123456789',origin='https://app.subauto.keybox.cloud',rawSession=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');
const config:any={enabled:true,signingEnabled:false};
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
before(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(url.pathname.endsWith('_test')&&['localhost','127.0.0.1'].includes(url.hostname));
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.NODE_ENV='test';process.env.SESSION_SECRET=secret;process.env.OWNER_LEGAL_H5_ENABLED='true';process.env.OWNER_WORKSPACE_ENABLED='true';process.env.OWNER_CONTRACTS_ENABLED='true';process.env.OWNER_MANUAL_CONTRACTS_ENABLED='true';process.env.H5_SIGNING_ORIGIN=origin;
 process.env.PORTAL_SMS_ENABLED='true';for(const key of ['ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_LOGIN_TEMPLATE_CODE'])process.env[key]='synthetic-unused';
 db=new Db();f=await ownerAuthorityFixture(db);
 f.customer=await db.customer.update({where:{id:f.customer.id},data:{mobile:'139'+randomInt(10000000,99999999)}});
 const profile=await db.ownerLegalRepresentative.create({data:{ownerId:f.owner.id,name:'合成法人',mobileHash:ownerMobileHash(f.customer.mobile),maskedMobile:'139****0000',evidenceHash:hash('synthetic legal evidence'),createdBy:'fixture',updatedBy:'fixture'}});
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{consentedAt:new Date(),consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:f.customer.id,legalRevision:profile.revision,legalName:profile.name,legalMobileHash:profile.mobileHash}}});
 for(const d of f.docs.filter((d:any)=>['terms','privacy'].includes(d.type)))await db.customerConsent.create({data:{customerId:f.customer.id,documentId:d.id,type:d.type,version:d.version,source:'synthetic-h5'}});
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}}),tenant=await db.customer.create({data:{mobile:'fixture-tenant-'+randomUUID()}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:f.vehicle.id,name:'合成',months:12,monthlyFeeAmount:1,mileagePerMonthKm:100,excessMileagePriceAmount:1,energyDescription:'合成',benefits:[],conditions:'合成'}});
 const application=await db.application.create({data:{customerId:tenant.id,vehicleId:f.vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'synthetic',status:'FINAL_PLAN_CONFIRMED'}});
 const lessor={ownerId:f.owner.id,name:f.owner.name,creditCode:f.owner.creditCode,sharingNotice:{contentHash:hash('sharing')}};
 const order=await db.order.create({data:{applicationId:application.id,customerId:tenant.id,vehicleId:f.vehicle.id,confirmedMileageKm:100,finalPlanSnapshot:{lessorSnapshot:lessor,ownerDataConsent:{ownerId:f.owner.id,customerId:tenant.id,lessorHash:lessorIdentityHash(lessor),notice:{contentHash:lessor.sharingNotice.contentHash}}}}});
 contract=await db.contract.create({data:{orderId:order.id,customerId:tenant.id,documentHash:hash('frozen contract'),sourceFileId:'synthetic-source',status:'PENDING',body:'合成合同正文'}});
 task=await db.ownerSigningTask.create({data:{ownerId:f.owner.id,customerId:tenant.id,kind:'SUBSCRIPTION',resourceId:contract.id,documentHash:contract.documentHash,sourceFileId:contract.sourceFileId!,sourceSha256:'b'.repeat(64),providerContractId:randomUUID(),ownerSealId:f.seal.id,status:'READY',uploadedAt:new Date(),reviewedAt:new Date(),reviewedBy:'fixture',snapshot:{vehicleId:f.vehicle.id,vehicleTitle:f.vehicle.title,monthlyFeeAmount:1,depositAmount:0,months:12,lessor:{ownerId:f.owner.id,providerCustomerId:account.providerCustomerId,providerSignatureId:f.seal.providerSignatureId,certificateSerialNo:account.certSerialNo,sealImageHash:f.seal.imageHash}},parties:{create:[{role:'OWNER',providerCustomerId:account.providerCustomerId!,providerSignatureId:f.seal.providerSignatureId,transactionId:randomUUID()},{role:'CUSTOMER',providerCustomerId:'SyntheticTenant',transactionId:randomUUID(),status:'SIGNED',attemptedAt:new Date(),verifiedAt:new Date(),queryEvidenceHash:'synthetic-proof'}]}}});
 await db.contract.update({where:{id:contract.id},data:{providerTaskId:task.id}});
 const template=f.docs.find((d:any)=>d.type==='owner-rental-contract');task=await db.ownerSigningTask.update({where:{id:task.id},data:{snapshot:{...(task.snapshot as any),template:{id:template.id,version:template.version,hash:hash(template.content)}}}});
 const writer:any={readVerified:async(id:string,sha:string)=>{assert.equal(id,'synthetic-source');assert.equal(sha,task.sourceSha256);return Buffer.from('%PDF-synthetic');}};
 const gateway:any={ownerSign:async(...args:any[])=>{assert.ok(isOwnerH5Request());calls.push(['sign',...args]);return{taskId:task.id,status:'PENDING',url:'https://textapi17.fadada.com/api2/synthetic'};},query:async(...args:any[])=>{assert.ok(isOwnerH5Request());calls.push(['query',...args]);return{taskId:task.id,status:'PENDING'};}};
 service=new OwnerH5ContractsService(db,new OwnerContractAccess(db,new OwnerService(db),writer),gateway,config);
 await db.ownerH5Session.create({data:{id:tokenHash(rawSession),customerId:f.customer.id,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+3600000)}});
 app=await createApp({db});base=(await listenForHttpTests(app))+'/api';
});
after(async()=>{await app?.close();await db?.$disconnect();delete process.env.OWNER_MANUAL_CONTRACTS_ENABLED;delete process.env.OWNER_CONTRACTS_ENABLED;});

test('H5 list exposes frozen business summaries only to current verified legal representative',async()=>{
 const list=await service.list(f.customer.id,f.owner.id);assert.equal(list.signingMode,'MANUAL');assert.equal(list.manualSigningEnabled,true);assert.equal(list.automaticSigningEnabled,false);assert.equal(list.items.length,1);
 const t=list.items[0];assert.equal(t.id,task.id);assert.equal(t.resourceId,contract.id);assert.equal(t.monthlyFeeAmount,1);assert.equal(t.months,12);assert.equal(t.canSign,true);assert.equal(t.sourceAvailable,true);assert.equal(t.signedAvailable,false);
 assert.ok(!JSON.stringify(t).includes('providerCustomerId'));assert.ok(!('body'in t));
 await assert.rejects(service.detail('another-person',f.owner.id,task.id),error('OWNER_LEGAL_REQUIRED'));
 await assert.rejects(service.detail(f.customer.id,'another-company',task.id),error('OWNER_LEGAL_REQUIRED'));
 const profile=await db.ownerLegalRepresentative.findUniqueOrThrow({where:{ownerId:f.owner.id}});await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{revision:{increment:1}}});
 try{await assert.rejects(service.list(f.customer.id,f.owner.id),error('OWNER_LEGAL_NOT_VERIFIED'));}finally{await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{revision:profile.revision}});}
});
test('missing customer sharing consent hides list records and denies detail/files/sync',async()=>{
 const order=await db.order.findUniqueOrThrow({where:{id:contract.orderId}}),snapshot=order.finalPlanSnapshot as any;await db.order.update({where:{id:order.id},data:{finalPlanSnapshot:{...snapshot,ownerDataConsent:{...snapshot.ownerDataConsent,customerId:'another'}}}});
 try{
  assert.equal((await service.list(f.customer.id,f.owner.id)).items.length,0);
  for(const action of [()=>service.detail(f.customer.id,f.owner.id,task.id),()=>service.file(f.customer.id,f.owner.id,task.id,'source'),()=>service.sync(f.customer.id,f.owner.id,task.id,{})])await assert.rejects(action(),error('OWNER_SHARING_CONSENT'));
 }finally{await db.order.update({where:{id:order.id},data:{finalPlanSnapshot:snapshot}});}
});
test('manual action requires explicit acceptance, exact document hashes, current consent and ready parties',async()=>{
 const accepted={accepted:true,documentHash:task.documentHash,sourceSha256:task.sourceSha256};calls=[];
 await assert.rejects(service.sign(f.customer.id,f.owner.id,task.id,{...accepted,accepted:false}));
 await assert.rejects(service.sign(f.customer.id,f.owner.id,task.id,{...accepted,sourceSha256:'c'.repeat(64)}),error('DOCUMENT_MISMATCH'));assert.equal(calls.length,0);
 const cp=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:task.id,role:'CUSTOMER'}}});await db.ownerSigningParty.update({where:{id:cp.id},data:{status:'PENDING'}});
 try{assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);await assert.rejects(service.sign(f.customer.id,f.owner.id,task.id,accepted),error('OWNER_CONTRACT_NOT_READY'));}finally{await db.ownerSigningParty.update({where:{id:cp.id},data:{status:'SIGNED'}});}
 const doc=f.docs.find((d:any)=>d.type==='privacy');await db.customerConsent.deleteMany({where:{customerId:f.customer.id,documentId:doc.id}});
 try{await assert.rejects(service.sign(f.customer.id,f.owner.id,task.id,accepted),error('CONSENT_REQUIRED'));}finally{await db.customerConsent.create({data:{customerId:f.customer.id,documentId:doc.id,type:doc.type,version:doc.version,source:'synthetic-h5'}});}
 assert.ok((await service.sign(f.customer.id,f.owner.id,task.id,accepted)).url);assert.deepEqual(calls,[['sign',f.customer.id,f.owner.id,task.id]]);
});
test('status sync is always non-dispatching; protected PDF reads pin the source hash',async()=>{
 calls=[];await service.sync(f.customer.id,f.owner.id,task.id,{});assert.deepEqual(calls,[['query',task.id,false]]);
 await assert.rejects(service.sync(f.customer.id,f.owner.id,task.id,{advanceAuto:true}));assert.equal(calls.length,1);
 assert.equal((await service.file(f.customer.id,f.owner.id,task.id,'source')).toString(),'%PDF-synthetic');await assert.rejects(service.file(f.customer.id,f.owner.id,task.id,'signed'),error('NOT_FOUND'));
});
test('changed frozen identity or seal blocks manual readiness without rebinding the document',async()=>{
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}});await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{certSerialNo:'renewed'}});
 try{assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);}finally{await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{certSerialNo:account.certSerialNo}});}
 await db.ownerSeal.update({where:{id:f.seal.id},data:{status:'DISCOVERED'}});try{assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);}finally{await db.ownerSeal.update({where:{id:f.seal.id},data:{status:'ACTIVE'}});}
 assert.equal((await db.ownerSigningTask.findUniqueOrThrow({where:{id:task.id}})).sourceSha256,task.sourceSha256);
});
test('pending outcome remains query-only and revoked vehicle/template review blocks new manual dispatch',async()=>{
 const party=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:task.id,role:'OWNER'}}});
 for(const status of ['SUBMITTING','UNKNOWN']){await db.ownerSigningParty.update({where:{id:party.id},data:{status,attemptedAt:new Date()}});assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);}
 await db.ownerSigningParty.update({where:{id:party.id},data:{status:party.status,attemptedAt:null}});
 const binding=await db.ownerVehicle.findUniqueOrThrow({where:{vehicleId:f.vehicle.id}});await db.ownerVehicle.update({where:{id:binding.id},data:{status:'PENDING'}});
 try{assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);await assert.rejects(runOwnerH5(()=>new OwnerSigningTasks(db,new OwnerService(db)).claimManual(f.customer.id,f.owner.id,task.id)),error('OWNER_DOCUMENT_BINDING'));}finally{await db.ownerVehicle.update({where:{id:binding.id},data:{status:binding.status}});}
 const template=f.docs.find((d:any)=>d.type==='owner-rental-contract');await db.legalDocument.update({where:{id:template.id},data:{status:'DRAFT'}});
 try{assert.equal((await service.detail(f.customer.id,f.owner.id,task.id)).canSign,false);assert.equal((await service.file(f.customer.id,f.owner.id,task.id,'source')).toString(),'%PDF-synthetic');}finally{await db.legalDocument.update({where:{id:template.id},data:{status:'PUBLISHED'}});}
});
test('manual task review accepts the bound vehicle-change template and rejects a delivery template for that change',async()=>{
 const change=await db.orderChange.create({data:{kind:'VEHICLE_CHANGE',orderId:contract.orderId,customerId:contract.customerId,priorTerms:{},priorTermsHash:hash('terms'),originalContractId:contract.id,reason:'合成换车',createdBy:'fixture',idempotencyKey:randomUUID(),requestHash:randomUUID(),status:'AWAITING_SIGNATURE'}});
 const quote=await db.delayQuote.create({data:{changeId:change.id,revision:1,status:'CONFIRMED',commercialHash:hash('amendment'),snapshot:{},fundsSnapshot:[],createdBy:'fixture',confirmedAt:new Date()}});
 const amendment=await db.contract.create({data:{kind:'AMENDMENT',orderId:contract.orderId,customerId:contract.customerId,delayQuoteId:quote.id,documentHash:quote.commercialHash,sourceFileId:task.sourceFileId,status:'PENDING'}});
 const doc=await db.legalDocument.create({data:{type:'owner-vehicle-change',version:Date.now()%1000000000,title:'合成换车',content:'合成换车批准正文',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
 const snapshot={...(task.snapshot as any),template:{id:doc.id,version:doc.version,hash:hash(doc.content)}};
 const saved=await db.ownerSigningTask.create({data:{ownerId:f.owner.id,customerId:task.customerId,kind:'AMENDMENT',resourceId:amendment.id,documentHash:amendment.documentHash,sourceFileId:task.sourceFileId,sourceSha256:task.sourceSha256,providerContractId:randomUUID(),ownerSealId:f.seal.id,status:'READY',uploadedAt:new Date(),reviewedAt:new Date(),reviewedBy:'fixture',snapshot,parties:{create:[{role:'OWNER',providerCustomerId:f.seal.providerCustomerId,providerSignatureId:f.seal.providerSignatureId,transactionId:randomUUID()},{role:'CUSTOMER',providerCustomerId:'SyntheticTenant',transactionId:randomUUID(),status:'SIGNED',attemptedAt:new Date(),verifiedAt:new Date(),queryEvidenceHash:'synthetic-proof'}]}}});
 await db.contract.update({where:{id:amendment.id},data:{providerTaskId:saved.id}});
 const tasks=new OwnerSigningTasks(db,new OwnerService(db));await db.legalDocument.update({where:{id:doc.id},data:{type:'owner-delivery-delay'}});
 try{await assert.rejects(runOwnerH5(()=>tasks.claimManual(f.customer.id,f.owner.id,saved.id)),error('OWNER_DOCUMENT_BINDING'));}finally{await db.legalDocument.update({where:{id:doc.id},data:{type:'owner-vehicle-change'}});}
 await runOwnerH5(()=>tasks.claimManual(f.customer.id,f.owner.id,saved.id));const intent=await runOwnerH5(()=>tasks.beginManual(f.customer.id,f.owner.id,saved.id));assert.equal(intent.ownerMode,'MANUAL');
});
test('historical contract H5 GET requires new portal authentication and old signed-in write links are read-only',async()=>{
 const path=`/owner-h5/owners/${f.owner.id}/contracts/${task.id}`,cookie=OWNER_H5_COOKIE+'='+rawSession;
 assert.equal((await fetch(base+path)).status,401);
 const own=await fetch(base+path,{headers:{Cookie:cookie}});assert.equal(own.status,401);assert.match(own.headers.get('cache-control')||'',/no-store/);
 for(const headers of [{Cookie:cookie,Origin:origin},{Cookie:cookie,Origin:'https://other.invalid','X-CSRF-Token':'synthetic-csrf'}]){
  const result=await fetch(base+path+'/sign',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({accepted:true,documentHash:task.documentHash,sourceSha256:task.sourceSha256})});assert.equal(result.status,403);
 }
 const readonly=await fetch(base+path+'/sync',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':'synthetic-csrf','Content-Type':'application/json'},body:'{}'});assert.equal(readonly.status,403);assert.equal((await readonly.json()).error.code,'PARTNER_READ_ONLY');
});
