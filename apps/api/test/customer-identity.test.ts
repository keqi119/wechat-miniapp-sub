import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import * as native from '../src/esign/native-signing';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';
const key=Buffer.alloc(32,23).toString('base64');
const flags={CUSTOMER_IDENTITY_POLICY:'PROVIDER_REQUIRED',NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'false',MINIAPP_SIGNING_ENABLED:'false',CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',FADADA_APP_ID:'fixture',FADADA_APP_SECRET:'fixture-secret',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',ESIGN_IDENTITY_ENCRYPTION_KEY:key,MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',MINIAPP_FACE_BRIDGE_ENABLED:'true'};
async function environment(fn:()=>Promise<void>|void){const old=Object.fromEntries(Object.keys(flags).map(k=>[k,process.env[k]]));Object.assign(process.env,flags);try{await fn();}finally{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
function matches(row:any,where:any):boolean{return Object.entries(where).every(([k,v]:[string,any])=>k==='OR'?v.some((x:any)=>matches(row,x)):v&&typeof v==='object'&&!(v instanceof Date)?Object.entries(v).every(([op,t]:[string,any])=>op==='not'?row[k]!==t:op==='lt'?row[k]<t:op==='gt'?row[k]>t:false):v instanceof Date?row[k]?.getTime()===v.getTime():row[k]===v);}
function fixture(){
 const row:any={id:'account',customerId:'customer',providerCustomerId:'provider',registrationStatus:'REGISTERED',realNameStatus:'NOT_STARTED',verificationSource:'UNKNOWN',identityVersion:0,verificationLeaseUntil:null,verificationLeaseToken:null,identityCiphertext:null,verifiedIdentityHash:null,verifiedSerialNo:null,verificationTransactionNo:null,verifiedAt:null,checkedAt:null,certStatus:'UNKNOWN',certSerialNo:null};
 let certificateCalls=0,verifyCalls=0,verifyInput:any,status='2';
 const customer:any={id:'customer',name:'合成客户',mobile:'13800000000',drivingYears:2,profile:{revision:0}};
 const db:any={virtualAcceptanceScope:{findFirst:async()=>null},$queryRaw:async()=>[],archiveCommand:{findUnique:async()=>null},eSignAccount:{findUnique:async()=>structuredClone(row),updateMany:async({where,data}:any)=>{if(!matches(row,where))return{count:0};Object.assign(row,data);return{count:1};}},customer:{findUnique:async()=>customer,findUniqueOrThrow:async()=>customer,update:async({data}:any)=>Object.assign(customer,data)},auditLog:{create:async()=>({})},serial:async(fn:any)=>fn(db)};
 const settings:any={enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,identityEncryptionKey:key,verifyNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-identity',verifyReturnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'};
 const service=new CustomerESignOnboardingService(db,settings,{getPersonVerifyUrl:async(input:any)=>{verifyCalls++;verifyInput=input;return{resultCode:'1',transactionNo:'attempt-1',verifyUrl:'https://realnameverify16.fadada.com/verify?opaque=fixture'};},findPersonCertInfo:async()=>({realNameStatus:status}),queryCert:async()=>{certificateCalls++;throw new Error('Identity must not query certificates');}} as any);
 return{db,row,service,get certificateCalls(){return certificateCalls;},get verifyInput(){return verifyInput;},get verifyCalls(){return verifyCalls;},setStatus(value:string){status=value;}};
}
test('OFFLINE identity capability opens only with its own explicit gate while every signing gate stays closed',async()=>environment(()=>{
 const config=(native as any).customerIdentityConfig;assert.equal(typeof config,'function');
 assert.equal(config().enabled,true);assert.deepEqual(config().faceBridgeKinds,['identity']);assert.equal(native.nativeSigningConfig().enabled,false);assert.throws(()=>native.requireNativeSigning());
 for(const flag of ['CUSTOMER_IDENTITY_ENABLED','FADADA_REALNAME_VERIFY_ENABLED','FADADA_ACCOUNT_REGISTER_ENABLED']){process.env[flag]='false';assert.equal(config().enabled,false,flag);process.env[flag]='true';}
 process.env.MINIAPP_SIGNING_PROVIDER_HOSTS='textapi17.fadada.com';assert.equal(config().enabled,false);
}));
test('identity-only verification works in OFFLINE and does not request or query a signing certificate',async()=>environment(async()=>{
 const f=fixture();await f.service.verify('customer',{name:'合成客户',idCardNo:'110101199001010000'},undefined,true);
 assert.equal(f.verifyInput.certFlag,false);assert.equal(f.row.realNameStatus,'PENDING');assert.equal(f.row.identityCiphertext.includes('110101'),false);
 const result=await f.service.refresh('customer',true);assert.equal(result.realNameStatus,'VERIFIED');assert.equal(f.certificateCalls,0);assert.equal(f.row.certStatus,'UNKNOWN');
 await assert.rejects(f.service.verify('customer',{name:'其他客户',idCardNo:'110101199001010001'},undefined,false),code('ESIGN_INITIATION_DISABLED'));
}));
test('an unrecognised supplier response and a disabled identity gate cannot become a verified identity',async()=>environment(async()=>{
 const f=fixture();process.env.CUSTOMER_IDENTITY_ENABLED='false';await assert.rejects(f.service.verify('customer',{name:'合成客户',idCardNo:'110101199001010000'},undefined,true));assert.equal(f.verifyInput,undefined);
 process.env.CUSTOMER_IDENTITY_ENABLED='true';await f.service.verify('customer',{name:'合成客户',idCardNo:'110101199001010000'},undefined,true);f.setStatus('generic-success');assert.equal((await f.service.refresh('customer',true)).realNameStatus,'PENDING');assert.equal(f.row.verifiedIdentityHash,null);
}));
test('application evidence needs a bound provider result matching the saved customer name and exposes no identity number',async()=>environment(async()=>{
 const module=await import('../src/esign/customer-identity').catch(()=>null);assert.ok(module,'identity evidence module is required');
 const f=fixture();f.row.identityCiphertext=encryptIdentity({name:'合成客户',idCardNo:'110101199001010000'},'customer',key);
 Object.assign(f.row,{identityVersion:1,realNameStatus:'VERIFIED',verificationSource:'QUERY',verifiedAt:new Date('2026-01-01T00:00:00Z'),verifiedSerialNo:'attempt',verificationTransactionNo:'attempt',verifiedIdentityHash:createHash('sha256').update(f.row.identityCiphertext).digest('hex')});
 const evidence=await module.readCustomerIdentityEvidence(f.db,'customer','合成客户');assert.equal(evidence.verified,true);assert.equal(evidence.snapshot?.provider,'FADADA');assert.equal(evidence.snapshot?.identityVersion,1);assert.equal(JSON.stringify(evidence).includes('110101'),false);assert.equal(JSON.stringify(evidence).includes(f.row.identityCiphertext),false);
 assert.equal((await module.readCustomerIdentityEvidence(f.db,'customer','另一人')).verified,false);
 f.row.verificationSource='FRONTEND';assert.equal((await module.readCustomerIdentityEvidence(f.db,'customer','合成客户')).verified,false);
 f.row.verificationSource='QUERY';f.row.verifiedIdentityHash='0'.repeat(64);assert.equal((await module.readCustomerIdentityEvidence(f.db,'customer','合成客户')).verified,false);
}));
test('identity evidence cannot borrow another customer account or accept malformed encrypted identity',async()=>environment(async()=>{
 const module=await import('../src/esign/customer-identity').catch(()=>null);assert.ok(module);
 const f=fixture();f.row.customerId='other';assert.equal((await module.readCustomerIdentityEvidence(f.db,'customer','合成客户')).verified,false);
 Object.assign(f.row,{customerId:'customer',identityCiphertext:'malformed',realNameStatus:'VERIFIED',verificationSource:'QUERY',verifiedAt:new Date(),verifiedSerialNo:'attempt',verificationTransactionNo:'attempt',identityVersion:1,verifiedIdentityHash:createHash('sha256').update('malformed').digest('hex')});
 assert.equal((await module.readCustomerIdentityEvidence(f.db,'customer','合成客户')).verified,false);
}));


for(const [status,expected] of [['1','PENDING'],['3','FAILED'],['4','EXPIRED']])test('11h fix1 first success survives later '+expected+' query without unlocking or identity replacement',async()=>environment(async()=>{
 const f=fixture();await f.service.verify('customer',{name:'合成客户',idCardNo:'110101199001010000'},undefined,true);await f.service.refresh('customer',true);
 const proof={cipher:f.row.identityCiphertext,hash:f.row.verifiedIdentityHash,time:f.row.verifiedAt,version:f.row.identityVersion,transaction:f.row.verificationTransactionNo,serial:f.row.verifiedSerialNo,source:f.row.verificationSource};
 f.setStatus(status);const current=await f.service.refresh('customer',true);assert.equal(current.realNameStatus,expected);assert.equal(current.readyForSigning,false);
 assert.equal(f.row.verifiedIdentityHash,proof.hash);assert.deepEqual(f.row.verifiedAt,proof.time);assert.equal(f.row.identityCiphertext,proof.cipher);assert.equal(f.row.identityVersion,proof.version);assert.equal(f.row.verificationTransactionNo,proof.transaction);assert.equal(f.row.verifiedSerialNo,proof.serial);assert.equal(f.row.verificationSource,proof.source);
 const m=await import('../src/customers/profile');const profile=await m.readCustomerProfile(f.db,'customer');assert.equal(profile.identity.verified,false);assert.equal(profile.identity.locked,true);
 await assert.rejects(m.saveCustomerProfile(f.db,'customer',{revision:0,idempotencyKey:randomUUID(),name:'改名',drivingYears:3}),code('IDENTITY_IMMUTABLE'));assert.equal((await f.db.customer.findUnique()).name,'合成客户');
 await assert.rejects(f.service.verify('customer',{name:'另一身份',idCardNo:'110101199001010001'},undefined,true),code('IDENTITY_ALREADY_VERIFIED'));assert.equal(f.verifyCalls,1);assert.equal(f.certificateCalls,0);
}));
test('11h fix1 stale verify claim cannot overwrite a concurrent first-success binding after downgrade',async()=>environment(async()=>{
 const f=fixture(),update=f.db.eSignAccount.updateMany;let inserted=false;
 f.db.eSignAccount.updateMany=async(args:any)=>{if(!inserted&&args.data.realNameStatus==='STARTING'){inserted=true;Object.assign(f.row,{realNameStatus:'EXPIRED',verifiedIdentityHash:'a'.repeat(64),verifiedAt:new Date(),identityCiphertext:'concurrent-first-success',verificationSource:'QUERY'});}return update(args);};
 await assert.rejects(f.service.verify('customer',{name:'另一身份',idCardNo:'110101199001010001'},undefined,true),code('IDENTITY_PROCESSING'));assert.equal(f.verifyCalls,0);assert.equal(f.row.identityCiphertext,'concurrent-first-success');assert.equal(f.row.verifiedIdentityHash,'a'.repeat(64));
}));
