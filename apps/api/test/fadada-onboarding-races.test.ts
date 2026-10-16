import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CustomerESignOnboardingService } from '../src/esign/customer-esign-onboarding.service';
import { accountReadiness, encryptIdentity } from '../src/esign/fadada/fadada-safety';
const key=Buffer.alloc(32,7).toString('base64');
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function latch(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};}
function matches(row:any,where:any):boolean{return Object.entries(where).every(([key,value]:[string,any])=>key==='OR'?value.some((x:any)=>matches(row,x)):key==='AND'?value.every((x:any)=>matches(row,x)):value&&typeof value==='object'&&!(value instanceof Date)?Object.entries(value).every(([op,target]:[string,any])=>op==='not'?row[key]!==target:op==='lt'?row[key]<target:op==='gt'?row[key]>target:op==='in'?target.includes(row[key]):false):value instanceof Date?row[key]?.getTime()===value.getTime():row[key]===value);}
function fixture(api:any){
  const row:any={id:'account',customerId:'customer',providerCustomerId:'provider',registrationStatus:'REGISTERED',realNameStatus:'PENDING',verificationSource:'UNKNOWN',verifiedSerialNo:'serial-A',verificationTransactionNo:'transaction-A',identityCiphertext:encryptIdentity({name:'身份A',idCardNo:'110101199001010000'},'customer',key),identityVersion:1,verifiedIdentityHash:null,verificationLeaseUntil:null,verificationLeaseToken:null,verifiedAt:null,certSerialNo:null,certStatus:'UNKNOWN',checkedAt:null};
  const db:any={eSignAccount:{findUnique:async()=>structuredClone(row),updateMany:async({where,data}:any)=>{if(!matches(row,where))return{count:0};for(const[key,value]of Object.entries(data))row[key]=(value as any)?.increment!==undefined?(row[key]||0)+(value as any).increment:value;return{count:1};},update:async({data}:any)=>Object.assign(row,data)},customer:{findUniqueOrThrow:async()=>({mobile:'13800000000'})},auditLog:{create:async()=>({})},serial:async(fn:any)=>fn(db)};
  const service=new CustomerESignOnboardingService(db,{enabled:true,realNameVerifyEnabled:true,identityEncryptionKey:key,verifyNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-identity',verifyReturnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'} as any,api);
  return{row,service};
}
const cert={certBound:true,certSerialNo:'cert-A',raw:{startTime:'2026-01-01',endTime:'2099-01-01'}};
const urlResult=(id:string)=>({resultCode:'1',transactionNo:id,verifyUrl:'https://testapi.fadada.com/verify/'+id});
const isCode=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
test('old provider query cannot mark a replacement identity VERIFIED or bind its old certificate',async()=>{
  const entered=latch(),release=latch();
  const{row,service}=fixture({findPersonCertInfo:async()=>{entered.resolve();await release.promise;return{realNameStatus:'2'};},queryCert:async()=>cert,getPersonVerifyUrl:async()=>urlResult('transaction-B')});
  const pending=service.refresh('customer');const rejected=assert.rejects(pending,isCode('IDENTITY_ATTEMPT_CHANGED'));
  await entered.promise;row.verificationLeaseUntil=new Date(0);await service.verify('customer',{name:'身份B',idCardNo:'110101199001010001'});const ciphertextB=row.identityCiphertext;
  release.resolve();await rejected;
  assert.equal(row.identityCiphertext,ciphertextB);assert.equal(row.verificationTransactionNo,'transaction-B');assert.equal(row.realNameStatus,'PENDING');assert.equal(row.certSerialNo,null);assert.equal(accountReadiness(row).readyForSigning,false);
});
test('verification claims a persistent lease before provider work; concurrent starts never create a second task',async()=>{
  const entered=latch(),release=latch();let starts=0;
  const{row,service}=fixture({getPersonVerifyUrl:async()=>{starts++;entered.resolve();await release.promise;return urlResult('transaction-B');}});
  const first=service.verify('customer',{name:'身份B',idCardNo:'110101199001010001'});await entered.promise;
  await assert.rejects(service.verify('customer',{name:'身份C',idCardNo:'110101199001010002'}),isCode('IDENTITY_PROCESSING'));assert.equal(starts,1);
  release.resolve();await first;assert.equal(row.verificationTransactionNo,'transaction-B');assert.equal(row.verificationLeaseToken,null);
});
test('expired verification worker cannot replace a newer attempt; provider failure releases only its own lease',async()=>{
  const entered=latch(),release=latch();let starts=0;
  const{row,service}=fixture({getPersonVerifyUrl:async()=>{if(++starts===1){entered.resolve();await release.promise;return urlResult('transaction-B');}return urlResult('transaction-C');}});
  const first=service.verify('customer',{name:'身份B',idCardNo:'110101199001010001'});const rejected=assert.rejects(first,isCode('IDENTITY_ATTEMPT_CHANGED'));await entered.promise;row.verificationLeaseUntil=new Date(0);
  await service.verify('customer',{name:'身份C',idCardNo:'110101199001010002'});const ciphertextC=row.identityCiphertext;release.resolve();await rejected;
  assert.equal(row.verificationTransactionNo,'transaction-C');assert.equal(row.identityCiphertext,ciphertextC);assert.equal(row.realNameStatus,'PENDING');
  const broken=fixture({getPersonVerifyUrl:async()=>{throw new Error('supplier unavailable');}});
  await assert.rejects(broken.service.verify('customer',{name:'身份B',idCardNo:'110101199001010001'}),/supplier unavailable/);assert.equal(broken.row.verificationLeaseToken,null);assert.equal(broken.row.realNameStatus,'FAILED');assert.equal(broken.row.verifiedSerialNo,null);
});
test('readiness requires the verified identity digest to match the current encrypted attempt',()=>{
  const{row}=fixture({});Object.assign(row,{realNameStatus:'VERIFIED',verificationSource:'QUERY',verifiedAt:new Date(),checkedAt:new Date(),certStatus:'BOUND',certSerialNo:'cert',verifiedIdentityHash:digest(row.identityCiphertext)});
  assert.equal(accountReadiness(row).readyForSigning,true);row.identityCiphertext+='changed';assert.equal(accountReadiness(row).readyForSigning,false);
});
test('active provider queries exclude new identity creation; an expired query lease can be safely recovered',async()=>{
  const entered=latch(),release=latch();let queries=0;
  const{row,service}=fixture({findPersonCertInfo:async()=>{if(++queries===1){entered.resolve();await release.promise;}return{realNameStatus:'2'};},queryCert:async()=>cert,getPersonVerifyUrl:async()=>urlResult('unused')});
  const first=service.refresh('customer');const rejected=assert.rejects(first,isCode('IDENTITY_ATTEMPT_CHANGED'));await entered.promise;
  await assert.rejects(service.verify('customer',{name:'身份B',idCardNo:'110101199001010001'}),isCode('IDENTITY_PROCESSING'));
  row.verificationLeaseUntil=new Date(0);assert.equal((await service.refresh('customer')).readyForSigning,true);release.resolve();await rejected;assert.equal(accountReadiness(row).readyForSigning,true);
});
