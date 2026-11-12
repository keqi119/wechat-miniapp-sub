import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Access} from '../src/auth/access';
import {Errors} from '../src/common/errors';
import {Db} from '../src/common/db';
import {tokenHash} from '../src/auth/auth.service';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import * as controllers from '../src/esign/esign.controller';
const env={CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',FADADA_APP_ID:'fixture',FADADA_APP_SECRET:'fixture-secret',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',ESIGN_IDENTITY_ENCRYPTION_KEY:Buffer.alloc(32,23).toString('base64'),MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'false',MINIAPP_SIGNING_ENABLED:'false'};
test('identity routes require the authenticated customer, current agreements and a separate privacy choice',async()=>{
 const Controller=(controllers as any).CustomerIdentityController;assert.equal(typeof Controller,'function');
 const prior=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const customer={id:'customer',name:'合成客户',mobile:'13800000000'};let consented=true,verifyInput:any,providerCalls=0;
 const documents=[{id:'terms',type:'terms',version:1,content:'条款正文',status:'PUBLISHED',confirmedBy:'approver',confirmedAt:new Date()},{id:'privacy',type:'privacy',version:1,content:'隐私正文',status:'PUBLISHED',confirmedBy:'approver',confirmedAt:new Date()}];
 const db:any={virtualAcceptanceScope:{findFirst:async()=>null},customerSession:{findUnique:async({where}:any)=>where.id===tokenHash('session')?{customer,expiresAt:new Date(Date.now()+60000)}:null},customer:{findUniqueOrThrow:async()=>customer},legalDocument:{findFirst:async({where}:any)=>documents.find(d=>d.type===where.type),findMany:async()=>documents},customerConsent:{count:async()=>consented?1:0},auditLog:{create:async()=>({})},serial:async(fn:any)=>fn(db)};
 // Persistence/auth/consent code stays real; the existing provider service is covered separately.
 const accounts:any={identityReadiness:async()=>({realNameStatus:'NOT_STARTED',verifiedAt:null}),register:async(id:string,only:boolean)=>{assert.equal(id,customer.id);assert.equal(only,true);providerCalls++;},verify:async(id:string,input:any,returnUrl:string,only:boolean)=>{assert.equal(id,customer.id);assert.equal(only,true);verifyInput=input;providerCalls++;return{status:'PENDING',url:'https://realnameverify.fadada.com/verify?opaque=fixture'};},refresh:async(id:string,only:boolean)=>{assert.equal(id,customer.id);assert.equal(only,true);providerCalls++;}};
 @Module({controllers:[Controller],providers:[{provide:Db,useValue:db},{provide:CustomerESignOnboardingService,useValue:accounts}]})class TestModule{}
 const app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('api');app.useGlobalGuards(new Access(db));app.useGlobalFilters(new Errors());await app.listen(0,'127.0.0.1');
 const base=await app.getUrl(),call=async(path:string,body?:any,authenticated=true)=>{const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(authenticated?{authorization:'Bearer session'}:{}),'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json(),cache:response.headers.get('cache-control')};};
 try{
  assert.equal((await call('/public/identity-config',undefined,false)).data.enabled,true);
  assert.equal((await call('/customer/identity/register',{},false)).status,401);assert.equal(providerCalls,0);
  consented=false;assert.equal((await call('/customer/identity/register',{})).status,409);assert.equal(providerCalls,0);consented=true;
  const input={name:'合成客户',idCardNo:'110101199001010000'};
  assert.equal((await call('/customer/identity/verify',input)).status,400);
  assert.equal((await call('/customer/identity/verify',{...input,consent:{accepted:true,documentId:'privacy',version:2}})).status,409);
  assert.equal((await call('/customer/identity/verify',{...input,name:'另一客户',consent:{accepted:true,documentId:'privacy',version:1}})).status,409);assert.equal(providerCalls,0);
  const result=await call('/customer/identity/verify',{...input,consent:{accepted:true,documentId:'privacy',version:1}});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.url,'https://realnameverify16.fadada.com/verify?opaque=fixture');assert.equal(result.cache,'no-store');assert.deepEqual(verifyInput,input);
  assert.equal((await call('/customer/identity/refresh',{realNameStatus:'VERIFIED'})).status,400);
  process.env.CUSTOMER_IDENTITY_ENABLED='false';assert.equal((await call('/customer/identity/register',{})).status,503);assert.equal((await call('/customer/identity/readiness')).data.realNameStatus,'NOT_STARTED');
 }finally{await app.close();for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
