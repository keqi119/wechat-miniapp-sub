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
test('11h trusted profile identity is immutable across stale certificate and manual policy',async()=>{
 const prior=process.env.CUSTOMER_IDENTITY_POLICY;
 try { const f=fixture();f.complete();const m=await profileModule();
 for(const policy of ['PROVIDER_REQUIRED','MANUAL_REVIEW','SIGNING_REQUIRED']){
 process.env.CUSTOMER_IDENTITY_POLICY=policy;
 const dto=await m.readCustomerProfile(f.tx,'customer');assert.equal(dto.identity.verified,true);assert.equal(dto.identity.name,'合成客户');assert.equal(dto.identity.maskedIdCardNo,'110101********0000');assert.ok(!JSON.stringify(dto).includes('110101199001010000'));
 await assert.rejects(m.saveCustomerProfile(f.tx,'customer',{revision:1,idempotencyKey:randomUUID(),name:'篡改',drivingYears:2}),error('IDENTITY_IMMUTABLE'));assert.equal(f.customer.name,'合成客户');assert.equal(f.customer.profile.revision,1);
 }
 await m.saveCustomerProfile(f.tx,'customer',{revision:1,idempotencyKey:randomUUID(),name:'合成客户',drivingYears:3,identityFrontFileId:null});assert.equal(f.customer.profile.revision,2);
 }finally{if(prior===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=prior;}
});
test('11h profile strict input rejects phone and ID injection',async()=>{
 const m=await profileModule();const normal=fixture();normal.complete();const evidence=await import('../src/esign/customer-identity');assert.equal((await evidence.readCustomerIdentityEvidence(normal.tx,'customer',normal.customer.name)).maskedIdCardNo,undefined);for(const field of ['mobile','idCardNo']){const f=fixture();await assert.rejects(m.saveCustomerProfile(f.tx,'customer',{revision:0,idempotencyKey:randomUUID(),name:'可修改姓名',drivingYears:2,[field]:'forged'}));assert.equal(f.customer.profile.revision,undefined);}
 const f=fixture();await m.saveCustomerProfile(f.tx,'customer',{revision:0,idempotencyKey:randomUUID(),name:'可修改姓名',drivingYears:2});assert.equal(f.customer.name,'可修改姓名');
});


test('11h display trusts only owned bound provider evidence, including a certificate-query lease',async()=>{
 const m=await profileModule();const normal=fixture();normal.complete();const evidence=await import('../src/esign/customer-identity');assert.equal((await evidence.readCustomerIdentityEvidence(normal.tx,'customer',normal.customer.name)).maskedIdCardNo,undefined);for(const field of ['customerId','verificationSource','verifiedIdentityHash','identityCiphertext']){
 const f=fixture();f.complete();const original=await f.tx.eSignAccount.findUnique();f.setAccount({...original,[field]:field==='customerId'?'other':field==='verificationSource'?'FRONTEND':'corrupt'});assert.equal((await m.readCustomerProfile(f.tx,'customer')).identity.verified,false);
 }
 const f=fixture();f.complete();const original=await f.tx.eSignAccount.findUnique();f.setAccount({...original,checkedAt:new Date('2020-01-01'),certStatus:'UNKNOWN',verificationLeaseToken:'query-lease'});assert.equal((await m.readCustomerProfile(f.tx,'customer')).identity.verified,true);await assert.rejects(m.saveCustomerProfile(f.tx,'customer',{revision:1,idempotencyKey:randomUUID(),name:'篡改',drivingYears:2}),error('IDENTITY_IMMUTABLE'));
});

test('11h unavailable established evidence fails closed without a false verified badge',async()=>{
 const f=fixture();f.complete();const original=await f.tx.eSignAccount.findUnique();f.setAccount({...original,identityCiphertext:'unreadable'});const m=await profileModule();const dto=await m.readCustomerProfile(f.tx,'customer');assert.equal(dto.identity.verified,false);assert.equal(dto.identity.locked,true);assert.equal(dto.identity.maskedIdCardNo,undefined);await assert.rejects(m.saveCustomerProfile(f.tx,'customer',{revision:1,idempotencyKey:randomUUID(),name:'篡改',drivingYears:2}),error('IDENTITY_IMMUTABLE'));assert.equal(f.customer.name,'合成客户');
});
