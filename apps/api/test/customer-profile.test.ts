import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {CustomerController} from '../src/orders/customer';
import {ApplicationsController} from '../src/applications/applications';
import {AdminController} from '../src/operations/admin';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';
import {customerProfileHash,requireCurrentQualification} from '../src/customers/qualifications';
import {canonicalHash} from '../src/customers/types';

const error=(code:string)=>(e:any)=>e?.getResponse?.()?.error?.code===code;
const encryptionKey=Buffer.alloc(32,23).toString('base64');
async function profileModule(){const m:any=await import('../src/customers/profile').catch(()=>({}));assert.equal(typeof m.captureCustomerProfileSnapshot,'function','profile snapshot implementation is required');return m;}
function fixture(){
 const customer:any={id:'customer',name:'合成客户',mobile:'13900000001',drivingYears:2,profile:{fileIds:['legacy']},legalIdentityFileId:null};
 const files:any[]=['front','back','license','legacy'].map((id,i)=>({id,customerId:customer.id,name:id+'.png',purpose:'identity',mimeType:'image/png',size:10,sha256:String(i+1).repeat(64),storagePath:'private-synthetic'}));
 let account:any=null;const commands:any[]=[],audits:any[]=[],applications:any[]=[],locks:string[]=[];
 const tx:any={
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},electronicFileQuarantine:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},
  $queryRaw:async(strings:any,...values:any[])=>{locks.push(strings.join('?'));return[];},
  customer:{findUnique:async()=>customer,findUniqueOrThrow:async()=>customer,update:async({data}:any)=>Object.assign(customer,data)},
  eSignAccount:{findUnique:async()=>account},
  storedFile:{findMany:async({where}:any)=>files.filter(f=>(!where?.id?.in||where.id.in.includes(f.id))&&(!where.customerId||where.customerId===f.customerId)),findUnique:async({where}:any)=>files.find(f=>f.id===where.id),count:async({where}:any)=>files.filter(f=>where.id.in.includes(f.id)&&f.customerId===where.customerId).length},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,v])=>c[k]===v)),create:async({data}:any)=>{commands.push(data);return data;}},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;},findFirst:async({where}:any)=>audits.find(a=>a.resourceId===where.resourceId&&a.action===where.action&&a.data.idempotencyKey===where.data.equals)},notification:{create:async({data}:any)=>data},
  vehicle:{findUnique:async()=>({id:'vehicle',status:'PUBLISHED'})},subscriptionPlan:{findFirst:async()=>({id:'plan',vehicleId:'vehicle'})},
  legalDocument:{findFirst:async({where}:any)=>({id:where.type,type:where.type,version:1,status:'PUBLISHED',confirmedAt:new Date()})},customerConsent:{count:async()=>1,createMany:async()=>({count:1}),findMany:async()=>[]},
  application:{findUnique:async({where}:any)=>where.id?applications.find(a=>a.id===where.id):applications.find(a=>a.idempotencyKey===where.customerId_idempotencyKey.idempotencyKey),count:async()=>0,create:async({data}:any)=>{const app={id:'application',status:'SUBMITTED',revision:0,...data};applications.push(app);return app;},findFirst:async({where}:any)=>applications.find(a=>a.id===where.id&&(!where.customerId||a.customerId===where.customerId)),update:async({where,data}:any)=>{const index=applications.findIndex(a=>a.id===where.id);applications[index]={...applications[index],...data};return applications[index];}},
  order:{findUnique:async()=>null},adminUser:{findUnique:async({where}:any)=>({id:where.id,role:where.id==='finance'?'FINANCE':'OPERATIONS',active:true,authVersion:1})},customerQualificationVersion:{findFirst:async()=>null}
 };
 const db:any={...tx,serial:(fn:any)=>fn(tx)};
 const complete=()=>{customer.profile={...customer.profile,revision:1,identityFrontFileId:'front',identityBackFileId:'back',drivingLicenseFileId:'license'};process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=encryptionKey;const cipher=encryptIdentity({name:customer.name,idCardNo:'110101199001010000'},customer.id,encryptionKey);account={customerId:customer.id,identityCiphertext:cipher,verifiedIdentityHash:createHash('sha256').update(cipher).digest('hex'),identityVersion:1,realNameStatus:'VERIFIED',registrationStatus:'REGISTERED',providerCustomerId:'provider',verifiedSerialNo:'serial',verificationTransactionNo:'transaction',verificationSource:'QUERY',verifiedAt:new Date()};};
 return{db,tx,customer,files,applications,commands,audits,locks,complete,setAccount:(value:any)=>account=value};
}
const submission=()=>({vehicleId:'vehicle',subscriptionPlanId:'plan',profile:{name:'伪造客户端姓名',fileIds:[]},consents:[{documentId:'application',version:1}],idempotencyKey:randomUUID()});

test('profile read preserves unclassified legacy files and does not satisfy typed document slots',async()=>{
 const f=fixture(),controller:any=new CustomerController(f.db);assert.equal(typeof controller.getProfile,'function');const result=await controller.getProfile({customer:f.customer});
 assert.equal(result.revision,0);assert.equal(result.files.legacy.length,1);assert.equal(result.files.identityFront,null);assert.equal(result.readiness.profileComplete,false);assert.ok(result.readiness.missingFields.includes('identityFrontFileId'));assert.equal(result.readiness.realNameVerified,false);assert.ok(!JSON.stringify(result).includes('storagePath'));
});

test('profile save supports drafts, keeps legacy files, CAS and exact idempotency',async()=>{
 const f=fixture(),controller=new CustomerController(f.db),body={revision:0,idempotencyKey:randomUUID(),name:'',drivingYears:0,identityFrontFileId:'front'};
 const saved:any=await controller.profile(body,{customer:f.customer});assert.equal(saved.revision,1);assert.equal(saved.readiness.readyForApplication,false);assert.deepEqual(f.customer.profile.fileIds,['legacy']);
 assert.deepEqual(await controller.profile(body,{customer:f.customer}),saved);
 await assert.rejects(controller.profile({...body,idempotencyKey:randomUUID()},{customer:f.customer}),error('REVISION_CONFLICT'));
 await assert.rejects(controller.profile({...body,name:'Changed'},{customer:f.customer}),error('IDEMPOTENCY_CONFLICT'));
});

test('profile typed slots reject another customer, wrong purpose and duplicated documents',async()=>{
 for(const mode of ['other','purpose','duplicate']){const f=fixture();if(mode==='other')f.files[0].customerId='other';if(mode==='purpose')f.files[0].purpose='contract';
 const body={revision:0,idempotencyKey:randomUUID(),name:'合成客户',drivingYears:2,identityFrontFileId:'front',...(mode==='duplicate'?{identityBackFileId:'front'}:{})};
 await assert.rejects(new CustomerController(f.db).profile(body,{customer:f.customer}),error(mode==='duplicate'?'PROFILE_DOCUMENT_DUPLICATE':'PROFILE_FILE_INVALID'));assert.equal(f.customer.profile.revision,undefined);}
});

test('actual submit refuses incomplete current profile even when client supplied a name',async()=>{
 const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';try{const f=fixture();await assert.rejects(new ApplicationsController(f.db).submit(submission(),{customer:f.customer}),error('CUSTOMER_PROFILE_REQUIRED'));assert.equal(f.applications.length,0);}finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
});

test('actual submit refuses a complete profile with no trusted realname result',async()=>{
 const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';try{const f=fixture();f.complete();f.setAccount(null);await assert.rejects(new ApplicationsController(f.db).submit(submission(),{customer:f.customer}),error('IDENTITY_REQUIRED'));assert.equal(f.applications.length,0);}finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
});

test('actual submit freezes server profile and replays original application after current profile changes',async()=>{
 const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';try{const f=fixture();f.complete();const body=submission(),controller=new ApplicationsController(f.db),result:any=await controller.submit(body,{customer:f.customer});
 assert.equal(result.profile.name,'合成客户');const snap=f.applications[0].profile.customerProfileSnapshot;assert.equal(snap.captureStage,'APPLICATION_SUBMISSION');assert.equal(snap.identity.provider,'FADADA');assert.deepEqual(snap.documents.identityFront,{id:'front',sha256:f.files[0].sha256});assert.ok(f.locks.some(s=>s.includes('Customer')));assert.ok(f.locks.some(s=>s.includes('ESignAccount')));
 f.customer.name='之后修改';assert.deepEqual(await controller.submit(body,{customer:f.customer}),result);assert.equal(f.applications[0].profile.customerProfileSnapshot.name,'合成客户');
 }finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
});

test('confirmation snapshot detects profile/evidence changes and legacy capture is explicitly current',async()=>{
 const f=fixture();f.complete();const m=await profileModule(),snapshot=await m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION');
 assert.deepEqual(await m.confirmCustomerProfileSnapshot(f.tx,f.customer.id,snapshot),snapshot);
 f.files[0].sha256='a'.repeat(64);await assert.rejects(m.confirmCustomerProfileSnapshot(f.tx,f.customer.id,snapshot),error('CUSTOMER_PROFILE_CHANGED'));
 const current=await m.confirmCustomerProfileSnapshot(f.tx,f.customer.id,null);assert.equal(current.captureStage,'ORDER_CONFIRMATION');assert.equal(current.documents.identityFront.sha256,'a'.repeat(64));assert.equal(snapshot.documents.identityFront.sha256,'1'.repeat(64));
});

test('scoped review labels old applications as current supplement and enforces current reviewer roles',async()=>{
 const f=fixture();f.applications.push({id:'application',customerId:f.customer.id,status:'SUBMITTED',profile:{name:'旧提交',fileIds:[]}});const controller:any=new AdminController(f.db);assert.equal(typeof controller.customerProfile,'function');
 const result=await controller.customerProfile('applications','application',{admin:{id:'ops',role:'OPERATIONS',authVersion:1}});assert.equal(result.source,'CURRENT_SUPPLEMENT');assert.equal(result.snapshot,null);assert.equal(result.files.snapshot,null);assert.equal(result.files.current.legacy.length,1);assert.equal(result.files.current.legacy[0].url,'/api/admin/applications/application/customer-profile/files/legacy');assert.equal(f.applications[0].profile.customerProfileSnapshot,undefined);
 await assert.rejects(controller.customerProfile('applications','application',{admin:{id:'finance',role:'FINANCE',authVersion:1}}),error('FORBIDDEN'));
 await assert.rejects(controller.customerProfile('applications','application',{admin:{id:'ops',role:'OPERATIONS',authVersion:2}}),error('STAFF_SESSION_CHANGED'));
});

test('scoped review keeps frozen documents distinct from current replacement and rejects unrelated files',async()=>{
 const f=fixture();f.complete();const m=await profileModule(),snapshot=await m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION');f.applications.push({id:'application',customerId:f.customer.id,profile:{customerProfileSnapshot:snapshot}});f.customer.profile.identityFrontFileId='legacy';
 const review:any=await import('../src/customers/profile-review'),result=await review.readRecordCustomerProfile(f.tx,'applications','application',{id:'ops',role:'OPERATIONS',authVersion:1});
 assert.equal(result.files.snapshot.identityFront.id,'front');assert.equal(result.files.current.identityFront.id,'legacy');assert.equal(result.snapshot.name,snapshot.name);
 f.files.push({...f.files[0],id:'unrelated'});await assert.rejects(review.readRecordCustomerProfileFile(f.tx,'applications','application','unrelated',{id:'ops',role:'OPERATIONS',authVersion:1}),error('NOT_FOUND'));
 f.files[0].sha256='b'.repeat(64);await assert.rejects(review.readRecordCustomerProfileFile(f.tx,'applications','application','front',{id:'ops',role:'OPERATIONS',authVersion:1}),error('PROFILE_FILE_CHANGED'));
});

test('profile changes have an explicit path to amend the same awaiting application and preserve old audit snapshot',async()=>{
 const f=fixture();f.complete();const m=await profileModule(),snapshot=await m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION');f.applications.push({id:'application',customerId:f.customer.id,status:'AWAITING_CONFIRMATION',revision:2,profile:{customerProfileSnapshot:snapshot}});
 const controller=new ApplicationsController(f.db);await controller.review('application',{decision:'NEEDS_INFO',note:'请更新本人资料'},{admin:{id:'ops',role:'OPERATIONS',authVersion:1}});assert.equal(f.applications[0].status,'NEEDS_INFO');
 f.customer.profile.revision=2;const body={profile:{name:'客户端不可信姓名',fileIds:[]},note:'已更新',idempotencyKey:randomUUID()};
 const amended:any=await controller.amend('application',body,{customer:f.customer});assert.equal(amended.status,'IN_REVIEW');assert.equal(amended.profile.customerProfileSnapshot.captureStage,'APPLICATION_AMENDMENT');assert.equal(amended.profile.customerProfileSnapshot.profileRevision,2);
 assert.equal(f.audits.find(a=>a.action==='AMEND').data.previousProfile.customerProfileSnapshot.profileRevision,1);assert.deepEqual(await controller.amend('application',body,{customer:f.customer}),amended);
});

test('existing confirmed order retry never captures new customer facts',async()=>{
 const f=fixture(),order={id:'order',applicationId:'application',status:'ACTIVE',contractMode:'OFFLINE',createdAt:new Date()},commercialHash='a'.repeat(64);f.applications.push({id:'application',customerId:f.customer.id,status:'FINAL_PLAN_CONFIRMED',revision:1,profile:{},order,finalPlans:[{commercialHash}]});
 const result=await new ApplicationsController(f.db).confirm('application',{revision:1,commercialHash},{customer:f.customer});assert.equal(result.id,order.id);assert.ok(!f.locks.some(s=>s.includes('ESignAccount')));assert.equal(f.applications[0].profile.customerProfileSnapshot,undefined);
});

test('generic finance detail strips new identity and document snapshots recursively',async()=>{
 const f=fixture();f.tx.order.findUnique=async()=>({id:'order',finalPlanSnapshot:{customerProfileSnapshot:{name:'私密快照',documents:{identityFront:{id:'secret'}}},monthlyFeeAmount:100},customer:{id:'customer',name:'合成客户',mobile:'13900000001'}});f.db.order=f.tx.order;
 const result=await new AdminController(f.db).detail('orders','order',{admin:{id:'finance',role:'FINANCE',authVersion:1}});assert.equal(result.finalPlanSnapshot.customerProfileSnapshot,undefined);assert.equal(result.finalPlanSnapshot.monthlyFeeAmount,100);
});

test('saving unchanged content with a fresh key preserves profile revision and an existing qualification approval',async()=>{
 const f=fixture();f.complete();const originalHash=customerProfileHash(f.customer),evidence=f.files.slice(0,3),q={id:'qualification',customerId:f.customer.id,status:'APPROVED',revision:1,reviewedBy:'reviewer',submittedBy:'submitter',reviewedAt:new Date(),identityExpiresAt:new Date('2099-01-01'),drivingLicenseExpiresAt:new Date('2099-01-01'),profileHash:originalHash,identityFileIds:['front','back'],drivingLicenseFileIds:['license'],evidenceHash:canonicalHash(evidence.map(file=>({id:file.id,sha256:file.sha256,customerId:file.customerId,adminId:file.adminId})).sort((a,b)=>a.id.localeCompare(b.id)))};
 f.tx.customerQualificationVersion.findFirst=async()=>q;await requireCurrentQualification(f.tx,f.customer.id);
 const body={revision:1,idempotencyKey:randomUUID(),name:f.customer.name,drivingYears:f.customer.drivingYears,identityFrontFileId:'front',identityBackFileId:'back',drivingLicenseFileId:'license'};
 const result:any=await new CustomerController(f.db).profile(body,{customer:f.customer});assert.equal(result.revision,1);assert.equal(customerProfileHash(f.customer),originalHash);assert.equal((await requireCurrentQualification(f.tx,f.customer.id)).id,q.id);
});

test('old profile payload receives explicit update guidance without overwriting typed records',async()=>{
 const f=fixture();f.complete();const before=structuredClone(f.customer);
 await assert.rejects(new CustomerController(f.db).profile({name:'旧客户端',drivingYears:4,fileIds:['legacy']},{customer:f.customer}),error('CLIENT_UPDATE_REQUIRED'));
 assert.deepEqual(f.customer,before);
});

test('admin current profile hash belongs to the same displayed document selection',async()=>{
 const f=fixture();f.complete();f.applications.push({id:'application',customerId:f.customer.id,profile:{}});
 const result=await new AdminController(f.db).customerProfile('applications','application',{admin:{id:'ops',role:'OPERATIONS',authVersion:1}});
 assert.equal((result.currentProfile as any).profileHash,customerProfileHash(f.customer));assert.equal(result.files.current.identityFront.id,f.customer.profile.identityFrontFileId);
});

test('scoped review never combines old document selection with a concurrently saved profile hash',async()=>{
 const f=fixture();f.complete();f.applications.push({id:'application',customerId:f.customer.id,profile:{}});
 const before=structuredClone(f.customer),beforeHash=customerProfileHash(before);let customerLocked=false,firstRead=true;
 // A READ COMMITTED transaction may observe a committed save between separate SELECTs.
 f.tx.$queryRaw=async(strings:any)=>{if(strings.join('?').includes('FROM "Customer"'))customerLocked=true;return[];};
 f.tx.customer.findUnique=async()=>{const selected=structuredClone(f.customer);if(firstRead){firstRead=false;if(!customerLocked)f.customer.profile={...f.customer.profile,revision:2,identityFrontFileId:'legacy'};}return selected;};
 const result=await new AdminController(f.db).customerProfile('applications','application',{admin:{id:'ops',role:'OPERATIONS',authVersion:1}});
 assert.equal(result.files.current.identityFront.id,'front');assert.equal((result.currentProfile as any).profileHash,beforeHash);
});

async function identityPolicy(value:string|undefined,action:()=>Promise<void>){
 const old=process.env.CUSTOMER_IDENTITY_POLICY;
 if(value===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=value;
 try{await action();}finally{if(old===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=old;}
}
// Manual admission still skips provider eligibility; local persisted identity reads/locks
// are required independently to keep an established verified name immutable.
function allowPersistedIdentityRead(f:ReturnType<typeof fixture>){
 assert.equal(typeof f.tx.eSignAccount.findUnique,'function');
}

test('manual policy submits classified documents without provider evidence and freezes an explicitly unverified v2 snapshot',async()=>identityPolicy('MANUAL_REVIEW',async()=>{
 const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';
 try{const f=fixture();f.complete();f.setAccount(null);allowPersistedIdentityRead(f);
 const profile=await new CustomerController(f.db).getProfile({customer:f.customer});
 assert.equal(profile.readiness.identityPolicy,'MANUAL_REVIEW');assert.equal(profile.readiness.realNameVerified,false);assert.equal(profile.readiness.readyForApplication,true);
 const app:any=await new ApplicationsController(f.db).submit(submission(),{customer:f.customer}),snapshot=app.profile.customerProfileSnapshot;
 assert.equal(app.status,'SUBMITTED');assert.equal(snapshot.version,2);assert.equal(snapshot.identityPolicy,'MANUAL_REVIEW');assert.equal(snapshot.identity,null);
 assert.equal(snapshot.documents.identityFront.id,'front');assert.equal(f.applications.length,1);
 await assert.rejects(requireCurrentQualification(f.tx,f.customer.id),error('CUSTOMER_QUALIFICATION_REQUIRED'));
 }finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
}));
test('manual policy still rejects missing or foreign documents and stale profile saves',async()=>identityPolicy('MANUAL_REVIEW',async()=>{
 const m=await profileModule();
 for(const mode of ['missing','foreign']){const f=fixture();f.complete();allowPersistedIdentityRead(f);if(mode==='missing')f.customer.profile.identityBackFileId=null;else f.files[0].customerId='other';
 await assert.rejects(m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION'),error('CUSTOMER_PROFILE_REQUIRED'));
 }
 const f=fixture();f.complete();allowPersistedIdentityRead(f);const body={revision:1,idempotencyKey:randomUUID(),name:f.customer.name,drivingYears:2,identityFrontFileId:'front'};
 f.files[0].customerId='other';await assert.rejects(new CustomerController(f.db).profile(body,{customer:f.customer}),error('PROFILE_FILE_INVALID'));
 f.files[0].customerId=f.customer.id;await assert.rejects(new CustomerController(f.db).profile({...body,revision:0},{customer:f.customer}),error('REVISION_CONFLICT'));
}));
test('manual current evidence does not rewrite historical provider snapshots and policy switches require renewed application review',async()=>identityPolicy('PROVIDER_REQUIRED',async()=>{
 const f=fixture();f.complete();const m=await profileModule(),v1=await m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION'),original=structuredClone(v1);
 process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';allowPersistedIdentityRead(f);
 assert.deepEqual(m.parseCustomerProfileSnapshot(v1),original);await assert.rejects(m.confirmCustomerProfileSnapshot(f.tx,f.customer.id,v1),error('CUSTOMER_PROFILE_CHANGED'));
 const v2=await m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_AMENDMENT');assert.equal(v2.identity,null);assert.deepEqual(m.parseCustomerProfileSnapshot(v2),v2);assert.deepEqual(await m.confirmCustomerProfileSnapshot(f.tx,f.customer.id,v2),v2);
 f.applications.push({id:'application',customerId:f.customer.id,profile:{customerProfileSnapshot:v1}});
 const review=await new AdminController(f.db).customerProfile('applications','application',{admin:{id:'ops',role:'OPERATIONS',authVersion:1}});
 assert.deepEqual(review.snapshot,original);assert.equal(review.identity.current.verified,false);assert.equal((review.currentProfile as any).identity.verified,true);assert.equal(review.currentProfile.readiness.identityPolicy,'MANUAL_REVIEW');
 process.env.CUSTOMER_IDENTITY_POLICY='PROVIDER_REQUIRED';await assert.rejects(m.confirmCustomerProfileSnapshot(f.tx,f.customer.id,v2),error('CUSTOMER_PROFILE_CHANGED'));assert.deepEqual(v1,original);
}));
test('manual snapshot refuses forged provider identity and the default still requires trusted provider evidence',async()=>identityPolicy(undefined,async()=>{
 const f=fixture();f.complete();f.setAccount(null);const m=await profileModule();
 const profile=await new CustomerController(f.db).getProfile({customer:f.customer});assert.equal(profile.readiness.identityPolicy,'PROVIDER_REQUIRED');assert.equal(profile.readiness.readyForApplication,false);
 await assert.rejects(m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION'),error('IDENTITY_REQUIRED'));
 process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';const v2=await m.captureCustomerProfileSnapshot(f.tx,f.customer.id,'APPLICATION_SUBMISSION');
 assert.throws(()=>m.parseCustomerProfileSnapshot({...v2,identity:{provider:'FADADA'}}),error('PROFILE_SNAPSHOT_INVALID'));
 assert.throws(()=>m.parseCustomerProfileSnapshot({...v2,identityPolicy:'unknown'}),error('PROFILE_SNAPSHOT_INVALID'));
}));

test('profile save replay reprojects current policy in both directions and repairs legacy cached readiness without another write',async()=>identityPolicy('PROVIDER_REQUIRED',async()=>{
 for(const scenario of ['verified-provider-to-manual','unverified-provider-to-manual','manual-to-provider','legacy-cache-to-manual']){
  const f=fixture();f.complete();if(scenario!=='verified-provider-to-manual')f.setAccount(null);
  process.env.CUSTOMER_IDENTITY_POLICY=scenario==='manual-to-provider'?'MANUAL_REVIEW':'PROVIDER_REQUIRED';
  const controller=new CustomerController(f.db),body={revision:1,idempotencyKey:randomUUID(),name:f.customer.name,drivingYears:3,identityFrontFileId:'front',identityBackFileId:'back',drivingLicenseFileId:'license'};
  let writes=0;const update=f.tx.customer.update;f.tx.customer.update=async(input:any)=>{writes++;return update(input);};
  const saved:any=await controller.profile(body,{customer:f.customer});assert.equal(saved.revision,2);assert.equal(writes,1);assert.equal(f.audits.length,1);
  if(scenario==='legacy-cache-to-manual')delete f.commands[0].resultSnapshot.readiness.identityPolicy;
  const cached=structuredClone(f.commands[0].resultSnapshot);
  process.env.CUSTOMER_IDENTITY_POLICY=scenario==='manual-to-provider'?'PROVIDER_REQUIRED':'MANUAL_REVIEW';
  if(process.env.CUSTOMER_IDENTITY_POLICY==='MANUAL_REVIEW')allowPersistedIdentityRead(f);
  const replay:any=await controller.profile(body,{customer:f.customer});
  assert.equal(replay.readiness.identityPolicy,process.env.CUSTOMER_IDENTITY_POLICY,scenario);assert.equal(replay.readiness.realNameVerified,false,scenario);
  assert.equal(replay.readiness.readyForApplication,scenario!=='manual-to-provider',scenario);assert.equal(replay.revision,2);
  assert.equal(writes,1);assert.equal(f.audits.length,1);assert.equal(f.commands.length,1);assert.deepEqual(f.commands[0].resultSnapshot,cached);
  await assert.rejects(controller.profile({...body,name:'不同请求'},{customer:f.customer}),error('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(controller.profile({...body,idempotencyKey:randomUUID()},{customer:f.customer}),error('REVISION_CONFLICT'));
 }
}));
