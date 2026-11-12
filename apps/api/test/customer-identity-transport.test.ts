import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Access} from '../src/auth/access';
import {tokenHash} from '../src/auth/auth.service';
import {Db} from '../src/common/db';
import {Errors} from '../src/common/errors';
import {CustomerIdentityController,ESignCustomerController} from '../src/esign/esign.controller';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import * as native from '../src/esign/native-signing';
import {FadadaSettings} from '../src/esign/esign.settings';
import {FadadaRequest} from '../src/esign/fadada/fadada.types';
import {FadadaTransportRequest} from '../src/esign/fadada/fadada-http-client';
import {buildFadadaRequest} from '../src/esign/fadada/fadada-request-builder';
import {buildFadadaMsgDigest} from '../src/esign/fadada/fadada-digest';
import {createHash} from 'node:crypto';

const key=Buffer.alloc(32,29).toString('base64');
const flags={NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'false',MINIAPP_SIGNING_ENABLED:'false',CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',FADADA_APP_ID:'synthetic-identity-app',FADADA_APP_SECRET:'synthetic-identity-secret',FADADA_BASE_URL:native.MINIAPP_PROVIDER_API,ESIGN_IDENTITY_ENCRYPTION_KEY:key,MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com'};
const settings:FadadaSettings={enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,appId:flags.FADADA_APP_ID,appSecret:flags.FADADA_APP_SECRET,baseUrl:native.MINIAPP_PROVIDER_API,apiVersion:'2.0',env:'sandbox',fullSigningSmokeEnabled:false,requestTimeoutMs:1000,signUrlQuantity:1,signUrlValidityMinutes:5,signingEnabled:false,identityEncryptionKey:key,verifyNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-identity',verifyReturnUrl:native.miniappReturnUrl()};
const failure=(code:string)=>(error:any)=>error.getResponse?.()?.error?.code===code;
async function environment(action:()=>Promise<void>){
 const before=Object.fromEntries(Object.keys(flags).map(name=>[name,process.env[name]])),fetchBefore=globalThis.fetch;
 Object.assign(process.env,flags);
 globalThis.fetch=(async(input:any,init?:any)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(url.hostname,'127.0.0.1','No external HTTP is permitted in this test');return fetchBefore(input,init);}) as typeof fetch;
 try{await action();}finally{globalThis.fetch=fetchBefore;for(const[name,value]of Object.entries(before))if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
async function identity<T extends object>(action:()=>Promise<T>):Promise<T>{
 const run=(native as any).runCustomerIdentity;assert.equal(typeof run,'function','independent identity context is required');return run(action);
}
function matches(row:any,where:any):boolean{return Object.entries(where).every(([key,value]:[string,any])=>key==='OR'?value.some((clause:any)=>matches(row,clause)):value&&typeof value==='object'&&!(value instanceof Date)?Object.entries(value).every(([op,target]:[string,any])=>op==='not'?row[key]!==target:op==='lt'?row[key]<target:op==='gt'?row[key]>target:false):value instanceof Date?row[key]?.getTime()===value.getTime():row[key]===value);}
function fixture(certData:unknown={}){
 const customer:any={id:'customer',name:'合成实名客户',mobile:'13800000000'},audits:any[]=[],wire:FadadaTransportRequest[]=[];
 let row:any=null,failEndpoint='';
 const documents=['terms','privacy'].map(type=>({id:type,type,version:1,status:'PUBLISHED',confirmedAt:new Date(),content:'合成协议正文'}));
 const db:any={virtualAcceptanceScope:{findFirst:async()=>null},
  customerSession:{findUnique:async({where}:any)=>where.id===tokenHash('synthetic-session')?{customer,expiresAt:new Date(Date.now()+60000)}:null},
  customer:{count:async({where}:any)=>where.id===customer.id?1:0,findUniqueOrThrow:async()=>structuredClone(customer),update:async({data}:any)=>Object.assign(customer,data)},
  eSignAccount:{
   findUnique:async({where}:any)=>row&&Object.entries(where).every(([key,value])=>row[key]===value)?structuredClone(row):null,
   upsert:async()=>{row??={id:'account',customerId:customer.id,registrationStatus:'NOT_STARTED',registrationLeaseUntil:null,providerCustomerId:null,realNameStatus:'NOT_STARTED',verificationSource:'UNKNOWN',identityVersion:0,identityCiphertext:null,verificationLeaseToken:null,verificationLeaseUntil:null,verificationTransactionNo:null,verifiedSerialNo:null,verifiedIdentityHash:null,verifiedAt:null,checkedAt:null,certStatus:'UNKNOWN',certSerialNo:null};return structuredClone(row);},
   update:async({where,data}:any)=>{assert.ok(matches(row,where));Object.assign(row,data);return structuredClone(row);},
   updateMany:async({where,data}:any)=>{if(!row||!matches(row,where))return{count:0};Object.assign(row,data);return{count:1};}
  },
  legalDocument:{findFirst:async({where}:any)=>documents.find(doc=>doc.type===where.type)},customerConsent:{count:async()=>1},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},serial:async(action:any)=>action(db)
 };
 const transport=async(request:FadadaTransportRequest)=>{
  wire.push(request);const endpoint=request.url.slice(native.MINIAPP_PROVIDER_API.length).split('?')[0];
  if(endpoint===failEndpoint){failEndpoint='';return{status:503,headers:{},bodyText:'synthetic transport failure'};}
  const responses:Record<string,object>={
   'account_register.api':{code:'1',data:'synthetic-provider-customer'},
   'get_person_verify_url.api':{code:'1',transactionNo:'synthetic-identity-attempt',url:Buffer.from('https://realnameverify.fadada.com/verify?opaque=synthetic%2Ftoken').toString('base64')},
   'find_personCertInfo.api':{code:'1',status:'2'},'query_cert.api':{code:'1',data:certData},'apply_cert.api':{code:'1'}
  };
  assert.ok(responses[endpoint],'unexpected final transport endpoint: '+endpoint);
  return{status:200,headers:{},bodyText:JSON.stringify(responses[endpoint])};
 };
 const http=new NativeAwareFadadaHttp(settings,transport),client=new NativeAwareFadadaClient(settings,http),service=new CustomerESignOnboardingService(db,settings,client);
 return{db,wire,http,client,service,customer,audits,get row(){return row;},failNext:(endpoint:string)=>{failEndpoint=endpoint;}};
}
async function withServer(action:(f:ReturnType<typeof fixture>,call:(path:string,body?:any)=>Promise<{status:number;body:any}>)=>Promise<void>){
 const f=fixture();
 @Module({controllers:[CustomerIdentityController,ESignCustomerController],providers:[{provide:Db,useValue:f.db},{provide:CustomerESignOnboardingService,useValue:f.service}]})class TestModule{}
 const app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('api');app.useGlobalGuards(new Access(f.db));app.useGlobalFilters(new Errors());await app.listen(0,'127.0.0.1');
 const base=await app.getUrl(),call=async(path:string,body?:any)=>{const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer synthetic-session','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};};
 try{await action(f,call);}finally{await app.close();}
}
const verifyBody={name:'合成实名客户',idCardNo:'110101199001010000',consent:{accepted:true,documentId:'privacy',version:1}};
const personalRequest=()=>buildFadadaRequest({config:settings,endpoint:'account_register.api',businessParams:{account_type:'1',open_id:'synthetic-open-id'}});

test('customer refresh persists the verified certificate subject from JSON-string query_cert data',async()=>environment(async()=>{
 const cn='1@Synthetic@123456789012345678@123456',data={certType:'0',sequenceNo:'SyntheticCert123',dn:`CN=${cn},O=CA,C=CN`,startTime:'2026-01-01',endTime:'2099-01-01'};
 const f=fixture(JSON.stringify(data));
 await identity(()=>f.service.register(f.customer.id,true));
 await identity(async()=>{await f.service.verify(f.customer.id,{name:verifyBody.name,idCardNo:verifyBody.idCardNo},undefined,true);return{};});
 const identityVersion=f.row.identityVersion,ciphertext=f.row.identityCiphertext;
 await f.service.refresh(f.customer.id);
 assert.equal(f.row.certSubjectHash,createHash('sha256').update(cn).digest('hex'));
 assert.equal((await f.db.eSignAccount.findUnique({where:{customerId:f.customer.id}})).certSubjectHash,f.row.certSubjectHash);
 assert.equal(f.row.realNameStatus,'VERIFIED');assert.equal(f.row.verificationSource,'QUERY');assert.equal(f.row.certStatus,'BOUND');assert.equal(f.row.certSerialNo,data.sequenceNo);
 assert.equal(f.row.certValidFrom.toISOString(),'2025-12-31T16:00:00.000Z');assert.equal(f.row.certValidUntil.toISOString(),'2098-12-31T16:00:00.000Z');assert.match(f.row.certEvidenceHash,/^[a-f0-9]{64}$/);
 assert.equal(f.row.identityVersion,identityVersion);assert.equal(f.row.verifiedIdentityHash,createHash('sha256').update(ciphertext).digest('hex'));assert.equal(f.row.verificationLeaseToken,null);
 assert.deepEqual(f.wire.map(request=>request.url.slice(native.MINIAPP_PROVIDER_API.length).split('?')[0]),['account_register.api','get_person_verify_url.api','find_personCertInfo.api','query_cert.api']);
}));

test('OFFLINE identity HTTP routes reach the real onboarding, SDK and native transport without opening signing',async()=>environment(()=>withServer(async(f,call)=>{
 const registered=await call('/customer/identity/register',{});assert.equal(registered.status,201,JSON.stringify(registered.body));assert.equal(f.row.registrationStatus,'REGISTERED');
 const started=await call('/customer/identity/verify',verifyBody);assert.equal(started.status,201,JSON.stringify(started.body));assert.equal(started.body.url,'https://realnameverify16.fadada.com/verify?opaque=synthetic%2Ftoken');
 const completed=await call('/customer/identity/refresh',{});assert.equal(completed.status,201,JSON.stringify(completed.body));assert.equal(completed.body.verified,true);assert.equal(completed.body.realNameStatus,'VERIFIED');assert.equal(f.row.certStatus,'UNKNOWN');
 assert.deepEqual(f.wire.map(request=>request.url),['account_register.api','get_person_verify_url.api','find_personCertInfo.api'].map(endpoint=>native.MINIAPP_PROVIDER_API+endpoint));
 const params=Object.fromEntries(new URLSearchParams(String(f.wire[1].body)));assert.equal(params.cert_flag,'0');assert.equal(params.is_mini_program,'3');assert.equal(params.return_url,native.miniappReturnUrl());assert.equal(params.msg_digest,buildFadadaMsgDigest({appId:settings.appId,appSecret:settings.appSecret,timestamp:params.timestamp,businessParams:params}));
 assert.ok(f.wire.every(request=>request.method==='POST'));assert.ok(!JSON.stringify(f.audits).includes(verifyBody.idCardNo));
 const before=f.wire.length;assert.equal((await call('/customer/identity/readiness')).body.verified,true);assert.equal(f.wire.length,before);
 assert.equal((await call('/customer/esign/register',{})).body.error.code,'ESIGN_INITIATION_DISABLED');assert.equal(f.wire.length,before);
})));

test('real transport failures release registration and verification leases so the same customer can retry',async()=>environment(()=>withServer(async(f,call)=>{
 f.failNext('account_register.api');assert.equal((await call('/customer/identity/register',{})).status,500);assert.equal(f.wire.length,1);assert.equal(f.row.registrationLeaseUntil,null);
 assert.equal((await call('/customer/identity/register',{})).status,201);
 f.failNext('get_person_verify_url.api');assert.equal((await call('/customer/identity/verify',verifyBody)).status,500);assert.equal(f.row.verificationLeaseToken,null);assert.equal(f.row.verificationLeaseUntil,null);assert.equal(f.row.realNameStatus,'FAILED');
 assert.equal((await call('/customer/identity/verify',verifyBody)).status,201);assert.equal(f.row.identityVersion,2);
 f.failNext('find_personCertInfo.api');assert.equal((await call('/customer/identity/refresh',{})).status,500);assert.equal(f.row.verificationLeaseToken,null);assert.equal(f.row.verificationLeaseUntil,null);assert.equal((await call('/customer/identity/refresh',{})).body.verified,true);
})));

test('disabled identity gate blocks all three HTTP mutations before final transport',async()=>environment(()=>withServer(async(f,call)=>{
 process.env.CUSTOMER_IDENTITY_ENABLED='false';
 for(const[path,body]of [['register',{}],['verify',verifyBody],['refresh',{}]] as const){const result=await call('/customer/identity/'+path,body);assert.equal(result.status,503);assert.equal(result.body.error.code,'CUSTOMER_IDENTITY_UNAVAILABLE');}
 assert.equal(f.wire.length,0);assert.equal(f.row,null);
})));

for(const endpoint of ['apply_cert.api','query_cert.api','uploaddocs.api','extsign.api','extsign_auto.api','query_sign_result.api','find_serialNo.api','get_company_verify_url.api','viewContract.api'] as const){
 test('identity context rejects '+endpoint+' even when legacy signing is enabled',async()=>environment(async()=>{
  process.env.ESIGN_NEW_REQUESTS_ENABLED='true';const f=fixture(),request=buildFadadaRequest({config:settings,endpoint});
  await assert.rejects(identity(()=>f.http.send(request)),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));assert.equal(f.wire.length,0);
 }));
}
const invalidRequests:[string,(request:FadadaRequest)=>FadadaRequest][]=[
 ['GET method',r=>({...r,method:'GET'})],['foreign request URL',r=>({...r,url:'https://other.invalid/account_register.api'})],
 ['endpoint URL mismatch',r=>({...r,url:native.MINIAPP_PROVIDER_API+'apply_cert.api'})],['URL suffix',r=>({...r,url:r.url+'?alternate=1'})],
 ['multipart content type',r=>({...r,contentType:'multipart/form-data;charset=utf8'})],['enterprise account',r=>({...r,params:{...r.params,account_type:'2'}})]
];
for(const[label,change]of invalidRequests)test('identity transport refuses '+label,async()=>environment(async()=>{
 const f=fixture();await assert.rejects(identity(()=>f.http.send(change(personalRequest()))),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));assert.equal(f.wire.length,0);
}));

test('identity rejects file uploads, binary dispatch and an unapproved configured base before transport',async()=>environment(async()=>{
 const f=fixture();await assert.rejects(identity(()=>f.http.send(personalRequest(),{fileName:'synthetic.pdf',contentType:'application/pdf',buffer:Buffer.from('%PDF')})),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));
 await assert.rejects(identity(()=>f.http.sendBinary(personalRequest())),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));
 const wrong=new NativeAwareFadadaHttp({...settings,baseUrl:'https://textapi.fadada.com/api2/'},async()=>{throw Error('wrong base reached network');});
 await assert.rejects(identity(()=>wrong.send(personalRequest())),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));assert.equal(f.wire.length,0);
}));

test('identity rejects certificate requests including the SDK default cert_flag=1',async()=>environment(async()=>{
 const f=fixture(),input={customerId:'synthetic-provider-customer',name:verifyBody.name,idCardNo:verifyBody.idCardNo,mobile:'13800000000',notifyUrl:settings.verifyNotifyUrl!,returnUrl:native.miniappReturnUrl()};
 for(const certFlag of [undefined,true])await assert.rejects(identity(()=>f.client.getPersonVerifyUrl({...input,certFlag})),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));
 await assert.rejects(identity(()=>f.client.getPersonVerifyUrl({...input,certFlag:false,returnUrl:'https://other.invalid/return'})),failure('FADADA_CALLBACK_CONFIG'));assert.equal(f.wire.length,0);
}));

test('identity context cannot construct a local signing URL even inside a nested native signing context',async()=>environment(async()=>{
 process.env.ESIGN_NEW_REQUESTS_ENABLED='true';process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';const f=fixture(),input={contractId:'contract',customerId:'customer',docTitle:'Synthetic',transactionId:'synthetic123',returnUrl:native.miniappReturnUrl(),notifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign',signaturePositions:[{pagenum:1,x:120,y:250}]};
 await assert.rejects(identity(()=>f.client.createExternalSignUrl(input)),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));
 await assert.rejects(identity(()=>native.runNativeSigning(()=>f.client.createExternalSignUrl(input))),failure('CUSTOMER_IDENTITY_REQUEST_DENIED'));
 assert.ok((await native.runNativeSigning(()=>f.client.createExternalSignUrl(input))).signUrl.includes('extsign.api'));assert.equal(f.wire.length,0);
}));

test('concurrent identity and legacy signing requests keep separate capabilities across awaits',async()=>environment(async()=>{
 assert.equal(typeof (native as any).runCustomerIdentity,'function','independent identity context is required');
 const f=fixture();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(done=>{enter=done;}),waiting=new Promise<void>(done=>{release=done;});
 const task=identity(async()=>{enter();await waiting;assert.equal(native.isNativeSigning(),false);return f.client.registerAccount({accountType:'PERSONAL',openId:'identity'});});
 await entered;
 try{await assert.rejects(native.runNativeSigning(()=>f.client.registerAccount({accountType:'PERSONAL',openId:'signing'})),failure('ESIGN_INITIATION_DISABLED'));await assert.rejects(f.client.registerAccount({accountType:'PERSONAL',openId:'unscoped'}),failure('ESIGN_INITIATION_DISABLED'));}finally{release();}
 assert.equal((await task).providerCustomerId,'synthetic-provider-customer');assert.equal(f.wire.length,1);assert.equal(new URLSearchParams(String(f.wire[0].body)).get('open_id'),'identity');
 await assert.rejects(f.client.registerAccount({accountType:'PERSONAL',openId:'after'}),failure('ESIGN_INITIATION_DISABLED'));
}));

test('turning identity off during an awaited action revokes its next transport without affecting historical recovery',async()=>environment(async()=>{
 const f=fixture();await assert.rejects(identity(async()=>{await Promise.resolve();process.env.CUSTOMER_IDENTITY_ENABLED='false';return f.client.registerAccount({accountType:'PERSONAL',openId:'revoked'});}),failure('CUSTOMER_IDENTITY_UNAVAILABLE'));assert.equal(f.wire.length,0);
 await f.client.findPersonCertInfo({verifiedSerialNo:'original-attempt'});assert.equal(f.wire.length,1);
 await assert.rejects(f.client.registerAccount({accountType:'PERSONAL',openId:'ordinary'}),failure('ESIGN_INITIATION_DISABLED'));
}));

test('an identity action throwing after an await does not grant later unscoped requests its capability',async()=>environment(async()=>{
 const f=fixture();await assert.rejects(identity(async()=>{await Promise.resolve();throw Error('synthetic action failure');}),/synthetic action failure/);
 await assert.rejects(f.client.registerAccount({accountType:'PERSONAL',openId:'after-error'}),failure('ESIGN_INITIATION_DISABLED'));assert.equal(f.wire.length,0);
}));
