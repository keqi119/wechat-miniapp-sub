import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QualificationService,customerProfileHash,requireCurrentQualification} from '../src/customers/qualifications';
import {CustomerRiskController} from '../src/customers/controller';
import {saveCustomerProfile} from '../src/customers/profile';
const actor={id:'reviewer',role:'ADMIN',authVersion:1};
const errorCode=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
export function fixture(){
 const files:any[]=['identityFront','identityBack','drivingLicense'].map((slot,i)=>({id:slot,customerId:'customer',adminId:null,purpose:'identity',mimeType:'image/jpeg',sha256:String(i+1).repeat(64),size:100}));
 const customer:any={id:'customer',name:'合成客户',mobile:'13800000000',drivingYears:3,legalIdentityFileId:null,profile:{revision:2,identityFrontFileId:'identityFront',identityBackFileId:'identityBack',drivingLicenseFileId:'drivingLicense'}};
 const qs:any[]=[],commands:any[]=[],audits:any[]=[],orders:any[]=[],apps:any[]=[];
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},customer:{findUnique:async()=>customer},
  storedFile:{findMany:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id)),count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},vehicleInspectionReport:{count:async()=>0},
  order:{findMany:async()=>orders},application:{findMany:async()=>apps},
  customerQualificationVersion:{findFirst:async()=>qs.at(-1),findUnique:async({where}:any)=>qs.find(q=>q.id===where.id),findMany:async()=>[...qs].reverse(),create:async({data}:any)=>{const q={...data,id:'q'+(qs.length+1),createdAt:new Date()};qs.push(q);return q;},update:async({where,data}:any)=>Object.assign(qs.find(q=>q.id===where.id),data)},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,v])=>c[k]===v)),create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}}};
 tx.electronicFileQuarantine={count:async()=>0};tx.eSignAccount={findUnique:async()=>null};
 return{tx,customer,files,qs,orders,apps,audits,commands};
}
export async function approve(f:ReturnType<typeof fixture>){
 const svc=new QualificationService(),c=f.customer;
 const q=await svc.submit(f.tx,actor,c.id,{revision:f.qs.length,profileHash:customerProfileHash(c),identityFileIds:[c.profile.identityFrontFileId,c.profile.identityBackFileId],drivingLicenseFileIds:[c.profile.drivingLicenseFileId],identityExpiresAt:'2030-02-25',drivingLicenseLongTerm:true,verificationSource:'MANUAL',idempotencyKey:'submit-'+f.qs.length});
 await svc.review(f.tx,actor,c.id,{qualificationId:q.id,revision:q.revision,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:'',idempotencyKey:'review-'+q.id});return f.qs.at(-1);
}
export function reupload(f:ReturnType<typeof fixture>,slot:string,changed=false){const old=f.files.find(x=>x.id===f.customer.profile[slot+'FileId']),file={...old,id:old.id+'-new',sha256:changed?'a'.repeat(64):old.sha256};f.files.push(file);f.customer.profile[slot+'FileId']=file.id;f.customer.profile.revision++;}
test('identical document content under a new owned file ID keeps approved qualification valid',async()=>{const f=fixture();const q=await approve(f);reupload(f,'identityFront');assert.equal((await requireCurrentQualification(f.tx,'customer')).id,q.id);assert.equal((await new QualificationService().status(f.tx,'customer')).status,'APPROVED');});
test('changed driving document reports specific recheck cause while keeping original approval',async()=>{const f=fixture();await approve(f);reupload(f,'drivingLicense',true);await assert.rejects(requireCurrentQualification(f.tx,'customer'),errorCode('CUSTOMER_QUALIFICATION_REQUIRED'));const state:any=await new QualificationService().status(f.tx,'customer');assert.equal(state.status,'RECHECK_REQUIRED');assert(state.recheckReasons.some((r:any)=>r.code==='DRIVING_DOCUMENT_CHANGED'));assert.equal(f.qs[0].status,'APPROVED');});

test('new qualification cannot approve old evidence while capturing a changed current driving photo',async()=>{const f=fixture();await approve(f);reupload(f,'drivingLicense',true);await assert.rejects(new QualificationService().submit(f.tx,actor,'customer',{revision:1,profileHash:customerProfileHash(f.customer),identityFileIds:['identityFront','identityBack'],drivingLicenseFileIds:['drivingLicense'],identityExpiresAt:'2030-02-25',drivingLicenseLongTerm:true,verificationSource:'MANUAL',idempotencyKey:'stale-documents'}),errorCode('QUALIFICATION_DOCUMENTS_CHANGED'));assert.equal(f.qs.length,1);});
test('same-document equivalence cannot conceal identity changes, expiration or another customer file',async()=>{
 for(const change of [(f:any)=>f.customer.name='另一客户',(f:any)=>f.customer.mobile='13900000000',(f:any)=>f.qs[0].identityExpiresAt=new Date(0),(f:any)=>f.files.at(-1).customerId='other']){const f=fixture();await approve(f);reupload(f,'identityFront');change(f);await assert.rejects(requireCurrentQualification(f.tx,'customer'));}
});
test('legacy approval accepts identical reupload only with a proven original order snapshot',async()=>{const f=fixture();const q=await approve(f);const snapshot={profileHash:q.profileHash,profileRevision:2,name:f.customer.name,mobile:f.customer.mobile,drivingYears:3,documents:Object.fromEntries(f.files.map(x=>[x.id,{id:x.id,sha256:x.sha256}]))};q.profileSnapshot=null;f.orders.push({finalPlanSnapshot:{customerProfileSnapshot:snapshot}});reupload(f,'identityFront');assert.equal((await requireCurrentQualification(f.tx,'customer')).id,q.id);f.orders.length=0;await assert.rejects(requireCurrentQualification(f.tx,'customer'));});

test('canonical file reuse cannot put the same file into two identity slots',async()=>{const f=fixture();let writes=0;f.tx.customer.update=async({data}:any)=>{writes++;return Object.assign(f.customer,data)};f.files.push({...f.files[1],id:'back-copy'});await assert.rejects(saveCustomerProfile(f.tx,'customer',{revision:2,name:f.customer.name,drivingYears:3,identityFrontFileId:'identityBack',identityBackFileId:'back-copy',drivingLicenseFileId:'drivingLicense',idempotencyKey:'cross-slot'}),errorCode('PROFILE_DOCUMENT_DUPLICATE'));assert.equal(writes,0);});
export async function orderFixture(){
 const f=fixture(),first=await approve(f),snapshot={profileHash:first.profileHash,profileRevision:2,name:f.customer.name,mobile:f.customer.mobile,drivingYears:3,documents:Object.fromEntries(f.files.map(x=>[x.id,{id:x.id,sha256:x.sha256}]))};
 const risk={reviewId:'risk',applicationId:'app',customerId:'customer',qualificationId:first.id,qualificationRevision:1,planId:'plan',planRevision:1,commercialHash:'commercial'};
 const o:any={id:'order',applicationId:'app',customerId:'customer',status:'AWAITING_HANDOVER',revision:4,contractMode:'OFFLINE',effectiveTermsVersionId:null,finalPlanSnapshot:{customerProfileSnapshot:snapshot,riskSnapshot:risk}};
 f.orders.push(o);f.tx.order.findUnique=async()=>o;f.tx.applicationRiskReview={findUnique:async()=>({...risk,id:'risk',finalPlanId:'plan',profileHash:first.profileHash,decision:'APPROVED'})};
 const confirmations:any[]=[];f.tx.orderQualificationConfirmation={findFirst:async({where}:any)=>[...confirmations].reverse().find(c=>Object.entries(where).every(([k,v])=>c[k]===v)),create:async({data}:any)=>{const row={...data,id:'confirmation',createdAt:new Date()};confirmations.push(row);return row;}};

 return {f,o,confirmations};
}

test('risk approved after an identical document reupload still accepts the semantically valid original qualification',async()=>{const {f,o}=await orderFixture();reupload(f,'identityFront');const risk=await f.tx.applicationRiskReview.findUnique();risk.profileHash=customerProfileHash(f.customer);f.tx.applicationRiskReview.findUnique=async()=>risk;o.finalPlanSnapshot.customerProfileSnapshot={...o.finalPlanSnapshot.customerProfileSnapshot,profileHash:risk.profileHash,profileRevision:3,documents:{...o.finalPlanSnapshot.customerProfileSnapshot.documents,identityFront:{id:f.customer.profile.identityFrontFileId,sha256:f.files[0].sha256}}};const controller=new CustomerRiskController({serial:(op:any)=>op(f.tx)} as any);assert.equal((await controller.orderQualificationContext('order',{admin:actor})).ready,true);});
test('order confirmation API supports linking reviewed replacement documents without rewriting original order',async()=>{
 const {f,o,confirmations}=await orderFixture();
 reupload(f,'drivingLicense',true);await approve(f);const original=JSON.stringify(o),controller:any=new CustomerRiskController({serial:(op:any)=>op(f.tx)} as any);
 assert.equal(typeof controller.orderQualificationContext,'function','must provide a scoped order qualification context');
 const context=await controller.orderQualificationContext('order',{admin:actor});assert.equal(context.canConfirm,true);assert.equal(context.ready,false);
 const body={revision:4,qualificationId:'q2',qualificationRevision:2,profileHash:context.profileHash,originalScopeHash:context.originalScopeHash,sameCustomerConfirmed:true,reason:'已对照原合同核对同一承租人与当前两证',idempotencyKey:'confirm-update'};
 const result=await controller.confirmOrderQualification('order',body,{admin:actor});assert.equal(result.qualificationId,'q2');assert.equal((await controller.orderQualificationContext('order',{admin:actor})).ready,true);assert.equal(JSON.stringify(o),original);
 assert.deepEqual(await controller.confirmOrderQualification('order',body,{admin:actor}),result);assert.equal(confirmations.length,1);
 await assert.rejects(controller.confirmOrderQualification('order',{...body,reason:'changed'},{admin:actor}),errorCode('IDEMPOTENCY_CONFLICT'));
 reupload(f,'drivingLicense',true);f.files.at(-1).sha256='b'.repeat(64);assert.equal((await controller.orderQualificationContext('order',{admin:actor})).ready,false);
});


test('order confirmation rejects stale tokens, identity substitution, expired or unreviewed qualifications and unauthorized operators',async()=>{
 for(const scenario of ['order','profile','scope','version','pending','expired','subject','rbac','self-review']){
  const {f,o,confirmations}=await orderFixture();reupload(f,'drivingLicense',true);await approve(f);
  const controller:any=new CustomerRiskController({serial:(op:any)=>op(f.tx)} as any),context=await controller.orderQualificationContext('order',{admin:actor});
  const body:any={revision:o.revision,qualificationId:'q2',qualificationRevision:2,profileHash:context.profileHash,originalScopeHash:context.originalScopeHash,sameCustomerConfirmed:true,reason:'已逐项核对同一承租人',idempotencyKey:'reject-'+scenario};let acting:any=actor;
  if(scenario==='order')body.revision--;
  if(scenario==='profile')body.profileHash='f'.repeat(64);
  if(scenario==='scope')body.originalScopeHash='f'.repeat(64);
  if(scenario==='version')body.qualificationRevision=1;
  if(scenario==='pending')f.qs[1].status='SUBMITTED';
  if(scenario==='expired')f.qs[1].identityExpiresAt=new Date(0);
  if(scenario==='subject')f.customer.name='不同签约主体';
  if(scenario==='rbac')acting={...actor,role:'FINANCE'};
  if(scenario==='self-review'){acting={...actor,role:'OPERATIONS'};f.tx.adminUser.findUnique=async()=>({...acting,active:true});}
  await assert.rejects(controller.confirmOrderQualification('order',body,{admin:acting}),undefined,scenario);assert.equal(confirmations.length,0,scenario);
 }
});
