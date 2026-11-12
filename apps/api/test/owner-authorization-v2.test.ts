import {persistLegacySigningResource} from './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerH5Service} from '../src/owner-h5/service';
import {OwnerSigningTasks} from '../src/owner-signing/tasks';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
const flags=['OWNER_AUTHORIZATION_SCOPE_VERSION','OWNER_AUTHORIZATION_ENABLED','OWNER_AUTO_SIGNING_ENABLED','OWNER_ONBOARDING_ENABLED','PLATFORM_LEGAL_ENTITY_NAME'];
const prior=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
const delegate={id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'};
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
let db:Db,f:any,service:OwnerAuthorizationService,h5:OwnerH5Service,tasks:OwnerSigningTasks;
const scope=()=>({version:2,validFrom:new Date(Date.now()-3600000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),delegates:[delegate],documentKinds:['SUBSCRIPTION_WITH_FEES']});
const request=()=>({...f.request,scope:scope(),idempotencyKey:randomUUID()});
before(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
 db=new Db({datasourceUrl:url.href});f=await ownerAuthorityFixture(db);
 const initialNotice=f.docs.find((d:any)=>d.type==='owner-auto-sign');if(initialNotice.version<2){const notice=await db.legalDocument.create({data:{type:'owner-auto-sign',version:2,title:'Synthetic v2 authorization',content:'Synthetic three-control authorization',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});f.docs=f.docs.map((d:any)=>d.id===initialNotice.id?notice:d);f.request.consents=f.request.consents.map((d:any)=>d.documentId===initialNotice.id?{documentId:notice.id,version:notice.version}:d);}
 const mobile='135'+String(Date.now()).slice(-8),name='Synthetic legal representative';await db.customer.update({where:{id:f.customer.id},data:{mobile}});
 await db.ownerLegalRepresentative.create({data:{ownerId:f.owner.id,name,mobileHash:ownerMobileHash(mobile),maskedMobile:'135****'+mobile.slice(-4),evidenceHash:'f'.repeat(64),createdBy:'fixture',updatedBy:'fixture'}});
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{consentedAt:new Date(),consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:f.customer.id,legalRevision:1,legalName:name,legalMobileHash:ownerMobileHash(mobile)}}});
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}}),owners=new OwnerService(db);
 service=new OwnerAuthorizationService(db,owners,{assertAvailable:()=>{},createAuthorizationUrl:()=>({url:'https://textapi17.fadada.com/api2/before_authsign.api?synthetic=1'}),queryAuthorization:async()=>({authorized:true}),queryCertificate:async()=>({bound:true,serialNo:account.certSerialNo})} as any);
 h5=new OwnerH5Service(db,owners,{} as any,service,{enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true} as any);tasks=new OwnerSigningTasks(db,owners);
 process.env.OWNER_AUTHORIZATION_SCOPE_VERSION='2';process.env.OWNER_AUTHORIZATION_ENABLED='true';process.env.OWNER_AUTO_SIGNING_ENABLED='false';process.env.OWNER_ONBOARDING_ENABLED='true';process.env.PLATFORM_LEGAL_ENTITY_NAME=delegate.name;
});
after(async()=>{for(const k of flags){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}await db?.$disconnect();});
test('v2 authorization offers trusted choices and admits an authenticated owner before any vehicle is registered',async()=>{
 await db.ownerVehicle.deleteMany({where:{ownerId:f.owner.id}});
 const options:any=await h5.options(f.customer.id,f.owner.id);assert.equal(options.scopeVersion,2);assert.deepEqual(options.delegates,[delegate]);assert.deepEqual(options.documentKinds.map((x:any)=>x.id),['SUBSCRIPTION_WITH_FEES']);assert.ok(options.documentKinds[0].template.hash);assert.ok(options.authorizationNotice.version>=2);assert.equal(options.vehicles,undefined);
 const detail:any=await h5.detail(f.customer.id,f.owner.id);assert.equal(detail.certificationComplete,true);assert.equal(detail.capabilities.canRequestAuthority,true);assert.equal(detail.capabilities.canEnableAuthority,false);
 const input=request(),a=await service.request(f.customer.id,f.owner.id,input);assert.equal(a.enabled,false);assert.equal((a.scope as any).version,2);assert.equal((a.scope as any).vehicleIds,undefined);assert.equal((await service.request(f.customer.id,f.owner.id,input)).id,a.id);
 await assert.rejects(service.request(f.customer.id,f.owner.id,{...input,scope:{...input.scope,validUntil:new Date(Date.now()+172800000).toISOString()}}),error('IDEMPOTENCY_CONFLICT'));
 const refreshed=await service.refresh(f.customer.id,f.owner.id,a.id);assert.equal(refreshed.status,'AUTHORIZED');assert.equal(refreshed.enabled,false);
});
test('v2 new requests reject old scope payloads forged delegates and unsupported document kinds',async()=>{
 await assert.rejects(service.request(f.customer.id,f.owner.id,{...f.request,idempotencyKey:randomUUID()}),error('OWNER_SCOPE_VERSION'));
 await assert.rejects(service.request(f.customer.id,f.owner.id,{...request(),scope:{...scope(),delegates:[{...delegate,name:'上海晓浪网络科技有限公司'}]}}),error('OWNER_DELEGATE_SCOPE'));
 await assert.rejects(service.request(f.customer.id,f.owner.id,{...request(),scope:{...scope(),documentKinds:['AMENDMENT']}}));
});
test('v2 new requests and reentry require persisted legal H5 evidence and reject legacy delegates before any grant consent or URL',async()=>{
 const original=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}}),input=request(),existing=await service.request(f.customer.id,f.owner.id,input);
 const grantCount=await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id}}),consentCount=await db.customerConsent.count({where:{customerId:f.customer.id}});let urls=0;
 const guarded=new OwnerAuthorizationService(db,new OwnerService(db),{assertAvailable:()=>{},createAuthorizationUrl:()=>{urls++;return{url:'https://synthetic.invalid/should-not-be-created'};}} as any);
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{consentSnapshot:{channel:'LEGACY_MINIAPP'}}});
 try{
  await assert.rejects(guarded.request(f.customer.id,f.owner.id,request()),error('OWNER_LEGAL_H5_REQUIRED'));
  await assert.rejects(guarded.request(f.customer.id,f.owner.id,input),error('OWNER_LEGAL_H5_REQUIRED'));
  assert.equal(await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id}}),grantCount);assert.equal(await db.customerConsent.count({where:{customerId:f.customer.id}}),consentCount);assert.equal(urls,0);assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:existing.id}})).enabled,false);
 }finally{await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{consentSnapshot:original.consentSnapshot!}});}
});
test('the default new-request mode remains v1 and does not accept the broader v2 without an explicit switch',async()=>{
 delete process.env.OWNER_AUTHORIZATION_SCOPE_VERSION;
 try{const options:any=await h5.options(f.customer.id,f.owner.id);assert.ok(Array.isArray(options.vehicles));assert.ok(options.template?.id);assert.equal(options.scopeVersion,undefined);assert.equal((await h5.detail(f.customer.id,f.owner.id) as any).certificationComplete,true);await assert.rejects(service.request(f.customer.id,f.owner.id,request()),error('OWNER_SCOPE_VERSION'));}finally{process.env.OWNER_AUTHORIZATION_SCOPE_VERSION='2';}
});
test('a confirmed v2 grant remains disabled until an explicit current-actor current-revision enable and cannot follow a new operator',async()=>{
 const a=await service.request(f.customer.id,f.owner.id,request());process.env.OWNER_AUTO_SIGNING_ENABLED='true';
 const input={enabled:true,revision:a.revision,scopeHash:a.scopeHash};
 await assert.rejects(service.setEnabled(f.customer.id,f.owner.id,a.id,{...input,revision:a.revision+1}),error('OWNER_AUTH_CHANGED'));
 process.env.PLATFORM_LEGAL_ENTITY_NAME='另一运营主体';try{await assert.rejects(service.setEnabled(f.customer.id,f.owner.id,a.id,input),error('OWNER_DELEGATE_SCOPE'));assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:a.id}})).enabled,false);}finally{process.env.PLATFORM_LEGAL_ENTITY_NAME=delegate.name;}
 const enabled=await service.setEnabled(f.customer.id,f.owner.id,a.id,input);assert.equal(enabled.enabled,true);await service.setEnabled(f.customer.id,f.owner.id,a.id,{enabled:false,revision:enabled.revision,scopeHash:enabled.scopeHash});process.env.OWNER_AUTO_SIGNING_ENABLED='false';
});
test('v2 cannot open or record consent using the old authorization notice',async()=>{
 const docs=await db.legalDocument.findMany({where:{type:'owner-auto-sign'},select:{id:true,status:true,confirmedAt:true,confirmedBy:true}}),old=await db.legalDocument.findUnique({where:{type_version:{type:'owner-auto-sign',version:1}}});
 assert.ok(old);try{
  await db.legalDocument.updateMany({where:{type:'owner-auto-sign'},data:{status:'RETIRED'}});await db.legalDocument.update({where:{id:old.id},data:{status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
  assert.equal((await h5.detail(f.customer.id,f.owner.id)).capabilities.canRequestAuthority,false);
  await assert.rejects(service.request(f.customer.id,f.owner.id,request()),error('OWNER_AUTHORIZATION_NOTICE'));
 }finally{for(const d of docs)await db.legalDocument.update({where:{id:d.id},data:{status:d.status,confirmedAt:d.confirmedAt,confirmedBy:d.confirmedBy}});}
});
test('certificationComplete follows current identity and certificate evidence independently of stamp selection',async()=>{
 await db.ownerSeal.update({where:{id:f.seal.id},data:{status:'DISCOVERED'}});assert.equal((await h5.detail(f.customer.id,f.owner.id) as any).certificationComplete,true);assert.equal((await h5.detail(f.customer.id,f.owner.id)).capabilities.canRequestAuthority,false);
 await db.ownerSeal.update({where:{id:f.seal.id},data:{status:'ACTIVE'}});await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date(Date.now()-86400001)}});assert.equal((await h5.detail(f.customer.id,f.owner.id) as any).certificationComplete,false);await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{checkedAt:new Date()}});
});
async function taskFixture(){
 const x=await ownerAuthorityFixture(db),account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:x.owner.id}}),s=scope();
 const a=await db.ownerAutoAuthority.create({data:{ownerId:x.owner.id,sealId:x.seal.id,providerCustomerId:x.seal.providerCustomerId,providerSignatureId:x.seal.providerSignatureId,certificateSerialNo:account.certSerialNo!,providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:x.customer.id,idempotencyKey:randomUUID(),requestHash:hash(s),scope:s,scopeHash:hash(s),consentSnapshot:{synthetic:true},status:'AUTHORIZED',enabled:true,checkedAt:new Date()}});
 const snapshot={vehicleId:x.vehicle.id,monthlyFeeAmount:900000,depositAmount:1200000,months:24,delegate,documentKind:'SUBSCRIPTION_WITH_FEES',template:{id:x.scope.templateId,version:x.scope.templateVersion,hash:x.scope.templateHash,type:'owner-rental-contract'},lessor:{ownerId:x.owner.id,providerCustomerId:account.providerCustomerId,providerSignatureId:x.seal.providerSignatureId,certificateSerialNo:account.certSerialNo,sealImageHash:x.seal.imageHash}};
 const task=await db.ownerSigningTask.create({data:{ownerId:x.owner.id,customerId:x.customer.id,kind:'SUBSCRIPTION',resourceId:randomUUID(),documentHash:'a'.repeat(64),sourceFileId:'synthetic',sourceSha256:'a'.repeat(64),providerContractId:randomUUID(),ownerSealId:x.seal.id,status:'READY',uploadedAt:new Date(),reviewedBy:'fixture',reviewedAt:new Date(),snapshot,parties:{create:[{role:'OWNER',providerCustomerId:x.seal.providerCustomerId,providerSignatureId:x.seal.providerSignatureId,transactionId:randomUUID()},{role:'CUSTOMER',providerCustomerId:'synthetic-customer',transactionId:randomUUID(),status:'SIGNED',verifiedAt:new Date(),queryEvidenceHash:'synthetic-proof'}]}}});await persistLegacySigningResource(db,{id:task.resourceId,customerId:x.customer.id,vehicleId:x.vehicle.id,documentHash:task.documentHash});await db.contract.update({where:{id:task.resourceId},data:{providerTaskId:task.id}});return{...x,a,task,snapshot};
}
test('v2 claims only trusted current document evidence and rechecks vehicle ownership immediately before dispatch',async()=>{
 process.env.OWNER_AUTO_SIGNING_ENABLED='true';const x=await taskFixture();await db.ownerVehicle.update({where:{vehicleId:x.vehicle.id},data:{ownerId:f.owner.id}});await assert.rejects(tasks.claimAuto(x.task.id),error('OWNER_AUTO_NOT_ALLOWED'));await db.ownerVehicle.update({where:{vehicleId:x.vehicle.id},data:{ownerId:x.owner.id}});await tasks.claimAuto(x.task.id);
 await db.ownerVehicle.update({where:{vehicleId:x.vehicle.id},data:{status:'REJECTED'}});await assert.rejects(tasks.beginAuto(x.task.id),error('OWNER_AUTO_NOT_ALLOWED'));assert.equal((await db.ownerSigningTask.findUniqueOrThrow({where:{id:x.task.id}})).ownerDispatchAt,null);
 await db.ownerVehicle.update({where:{vehicleId:x.vehicle.id},data:{status:'APPROVED'}});await tasks.beginAuto(x.task.id);assert.ok((await db.ownerSigningTask.findUniqueOrThrow({where:{id:x.task.id}})).ownerDispatchAt);
});
test('v2 cannot use old tasks without a delegate, changed platform identity, wrong kind or altered template evidence',async()=>{
 const x=await taskFixture();
 for(const patch of [{delegate:undefined},{delegate:{...delegate,name:'Other operator'}},{documentKind:'AMENDMENT'},{template:{...x.snapshot.template,type:'owner-vehicle-change'}},{template:{...x.snapshot.template,hash:'f'.repeat(64)}}]){await db.ownerSigningTask.update({where:{id:x.task.id},data:{snapshot:JSON.parse(JSON.stringify({...x.snapshot,...patch}))}});await assert.rejects(tasks.claimAuto(x.task.id),error('OWNER_AUTO_NOT_ALLOWED'));}
 await db.ownerSigningTask.update({where:{id:x.task.id},data:{snapshot:x.snapshot}});process.env.PLATFORM_LEGAL_ENTITY_NAME='另一个运营主体';try{await assert.rejects(tasks.claimAuto(x.task.id),error('OWNER_AUTO_NOT_ALLOWED'));}finally{process.env.PLATFORM_LEGAL_ENTITY_NAME=delegate.name;}
 await tasks.claimAuto(x.task.id);await db.legalDocument.update({where:{id:x.scope.templateId},data:{confirmedBy:null}});await assert.rejects(tasks.beginAuto(x.task.id),error('OWNER_AUTO_NOT_ALLOWED'));
});
test('the same v2 grant covers a later approved main-contract template while exact task evidence remains checked',async()=>{
 const x=await taskFixture(),next=await db.legalDocument.create({data:{type:'owner-rental-contract',version:x.scope.templateVersion+1,title:'New synthetic approved subscription',content:'New synthetic subscription content',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
 await db.ownerSigningTask.update({where:{id:x.task.id},data:{snapshot:{...x.snapshot,template:{id:next.id,type:next.type,version:next.version,hash:hash(next.content)}}}});await tasks.claimAuto(x.task.id);assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:x.a.id}})).scopeHash,x.a.scopeHash);
});
