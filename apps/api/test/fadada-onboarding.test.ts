import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/common/db';
import { FadadaApiClient } from '../src/esign/fadada/fadada-api.client';
import { FadadaHttpClient } from '../src/esign/fadada/fadada-http-client';
import { CustomerESignOnboardingService } from '../src/esign/customer-esign-onboarding.service';
import { buildFadadaMsgDigest } from '../src/esign/fadada/fadada-digest';
let db:Db,service:CustomerESignOnboardingService,customer:any,settings:any;
let registrationFails=true,realNameStatus='',certReady=false,expiredCert=false,registrations=0,certQueries=0,refreshes=0;
const verificationId=randomUUID().replaceAll('-','');
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;db=new Db();customer=await db.customer.create({data:{mobile:'136'+String(Date.now()).slice(-8),name:'Synthetic identity'}});
  settings={enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,apiVersion:'2.0',appId:'fixture-app',appSecret:'fixture-secret',baseUrl:'https://testapi.fadada.com/api/',identityEncryptionKey:Buffer.alloc(32,5).toString('base64'),requestTimeoutMs:1000,verifyNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-identity',verifyReturnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'};
  const transport:any=async(req:any)=>{let result:any={code:'1'};
    if(new URL(req.url).pathname.endsWith('account_register.api')){registrations++;if(!registrationFails)result.customer_id='provider-'+customer.id;}
    else if(new URL(req.url).pathname.endsWith('get_person_verify_url.api'))result={code:'1',transactionNo:verificationId,url:Buffer.from('https://testapi.fadada.com/verify/synthetic').toString('base64')};
    else if(new URL(req.url).pathname.endsWith('find_personCertInfo.api')){refreshes++;result={code:'1',status:realNameStatus};}
    else if(new URL(req.url).pathname.endsWith('query_cert.api')){certQueries++;result=certReady?{code:'1',data:{sequenceNo:'synthetic-cert',dn:'CN=Synthetic',certType:'1',startTime:'2026-01-01',endTime:expiredCert?'2020-01-01':'2099-01-01'}}:{code:'1'};}
    else if(new URL(req.url).pathname.endsWith('apply_cert.api'))certReady=true;
    else throw new Error('unexpected provider endpoint');
    return{status:200,headers:{},bodyText:JSON.stringify(result)};
  };
  service=new CustomerESignOnboardingService(db,settings,new FadadaApiClient(settings,new FadadaHttpClient(settings,transport)));
});
after(async()=>{if(db){await db.providerEvent.deleteMany({where:{provider:'FADADA_IDENTITY',resourceId:customer?.id}});await db.eSignAccount.deleteMany({where:{customerId:customer?.id}});await db.customer.deleteMany({where:{id:customer?.id}});await db.$disconnect();}});
test('registration failure never becomes a registered identity; provider success reuses binding',async()=>{
  await assert.rejects(service.register(customer.id),/FADADA_ACCOUNT_CUSTOMER_ID_MISSING/);
  assert.equal((await service.readiness(customer.id)).readyForSigning,false);
  registrationFails=false;await service.register(customer.id);await service.register(customer.id);assert.equal(registrations,2);
});
test('generic provider success does not verify real name; explicit query and full certificate are required',async()=>{
  await service.verify(customer.id,{name:'Synthetic identity',idCardNo:'110101199001010000'});
  assert.equal((await service.refresh(customer.id)).readyForSigning,false);assert.equal(certQueries,0);
  const account=await db.eSignAccount.findUniqueOrThrow({where:{customerId:customer.id}});assert.equal(account.identityCiphertext?.includes('110101'),false);
  realNameStatus='2';assert.equal((await service.refresh(customer.id)).readyForSigning,true);assert.equal(certQueries,2);
  expiredCert=true;assert.equal((await service.refresh(customer.id)).readyForSigning,false);expiredCert=false;
});
test('identity callback is signature-bound, requires provider query, and replay is durable',async()=>{
  const payload={transactionNo:verificationId,timestamp:'20261016193000',status:'2'};
  const digest=buildFadadaMsgDigest({appId:settings.appId,appSecret:settings.appSecret,timestamp:payload.timestamp,businessParams:payload,explicitSortString:verificationId});
  const prior=refreshes;
  assert.equal((await service.callback({...payload,msg_digest:digest})).replayed,false);
  assert.equal((await service.callback({...payload,msg_digest:digest})).replayed,true);assert.equal(refreshes,prior+1);
  await assert.rejects(service.callback({...payload,msg_digest:'bad'}),(e:any)=>e.getResponse?.().error?.code==='CALLBACK_SIGNATURE');
});
