import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from '../src/common/config';
import {customerIdentityConfig,requireCustomerIdentity} from '../src/esign/native-signing';
import {CustomerESignOnboardingService} from '../src/esign/customer-esign-onboarding.service';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';
import {buildFadadaMsgDigest} from '../src/esign/fadada/fadada-digest';

async function environment(values:Record<string,string|undefined>,action:()=>Promise<void>|void){const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));for(const[k,v]of Object.entries(values))if(v===undefined)delete process.env[k];else process.env[k]=v;try{await action();}finally{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
test('policy defaults to provider verification and rejects unknown configuration before startup',async()=>{
 const module:any=await import('../src/customers/identity-policy').catch(()=>({}));assert.equal(typeof module.customerIdentityPolicy,'function');
 assert.equal(module.customerIdentityPolicy({}),'PROVIDER_REQUIRED');assert.equal(module.customerIdentityPolicy({CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW'}),'MANUAL_REVIEW');
 for(const value of ['','manual_review',' MANUAL_REVIEW','MANUAL_REVIEW ', 'unknown'])assert.throws(()=>module.customerIdentityPolicy({CUSTOMER_IDENTITY_POLICY:value}),/CUSTOMER_IDENTITY_POLICY/);
 await environment({CUSTOMER_IDENTITY_POLICY:'typo'},()=>assert.throws(()=>validateConfig(),/CUSTOMER_IDENTITY_POLICY/));
});
test('manual policy closes native verification and old service calls even if every legacy flag is enabled',async()=>environment({CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',NEW_ORDER_CONTRACT_MODE:'ESIGN',ESIGN_NEW_REQUESTS_ENABLED:'true',MINIAPP_SIGNING_ENABLED:'true',CUSTOMER_IDENTITY_ENABLED:'true',FADADA_ENABLED:'true',FADADA_ACCOUNT_REGISTER_ENABLED:'true',FADADA_REALNAME_VERIFY_ENABLED:'true',FADADA_APP_ID:'synthetic',FADADA_APP_SECRET:'synthetic',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',ESIGN_IDENTITY_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),MINIAPP_SIGNING_PROVIDER_HOSTS:'textapi17.fadada.com,realnameverify16.fadada.com',MINIAPP_FACE_BRIDGE_ENABLED:'true'},async()=>{
 const config=customerIdentityConfig() as any;assert.equal(config.identityPolicy,'MANUAL_REVIEW');assert.equal(config.enabled,false);assert.equal(config.signProviderConfigured,false);assert.deepEqual(config.providerHosts,[]);assert.deepEqual(config.faceBridgeKinds,[]);assert.equal(config.faceBridgeConfigured,false);assert.equal(config.faceBridgeProtocol,null);
 assert.throws(()=>requireCustomerIdentity(),code('CUSTOMER_IDENTITY_UNAVAILABLE'));
 const forbidden=new Proxy({},{get(_target,key){if(key==='virtualAcceptanceScope')return{findFirst:async()=>null};throw Error('Manual mode must reject before accessing provider or account');}}),service=new CustomerESignOnboardingService(forbidden as any,{enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true} as any,forbidden as any);
 for(const identityOnly of [true,false]){
 await assert.rejects(service.register('customer',identityOnly),code('CUSTOMER_IDENTITY_UNAVAILABLE'));
 await assert.rejects(service.verify('customer',{name:'合成客户',idCardNo:'110101199001010000'},undefined,identityOnly),code('CUSTOMER_IDENTITY_UNAVAILABLE'));
 await assert.rejects(service.refresh('customer',identityOnly),code('CUSTOMER_IDENTITY_UNAVAILABLE'));
 }
}));
test('paused identity still verifies original signed callbacks and preserves provider history without opening customer mutations',async()=>environment({CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',NEW_ORDER_CONTRACT_MODE:'OFFLINE'},async()=>{
 const key=Buffer.alloc(32,5).toString('base64'),cipher=encryptIdentity({name:'合成客户',idCardNo:'110101199001010000'},'customer',key);
 const account:any={id:'original-account',customerId:'customer',registrationStatus:'REGISTERED',providerCustomerId:'original-provider',identityVersion:1,identityCiphertext:cipher,verifiedSerialNo:'original-attempt',verificationTransactionNo:'original-attempt',verificationLeaseToken:null,verificationLeaseUntil:null,checkedAt:null,realNameStatus:'PENDING',verificationSource:'UNKNOWN',verifiedAt:null,certStatus:'UNKNOWN'};
 let savedEvent:any,queries=0;
 const db:any={virtualAcceptanceScope:{findFirst:async()=>null},eSignAccount:{findUnique:async({where}:any)=>Object.entries(where).every(([k,v])=>account[k]===v)?structuredClone(account):null,updateMany:async({where,data}:any)=>{assert.equal(where.id,account.id);assert.equal(where.verificationTransactionNo,'original-attempt');assert.equal(where.identityCiphertext,cipher);Object.assign(account,data);return{count:1};}},providerEvent:{findUnique:async()=>savedEvent,upsert:async({create}:any)=>savedEvent=create,update:async({data}:any)=>Object.assign(savedEvent,data)},auditLog:{create:async()=>({})},serial:async(fn:any)=>fn(db),customer:{findUniqueOrThrow:async()=>({id:'customer',name:'合成客户'})}};
 const settings:any={enabled:true,appId:'synthetic-app',appSecret:'synthetic-secret'},service=new CustomerESignOnboardingService(db,settings,{findPersonCertInfo:async({verifiedSerialNo}:any)=>{assert.equal(verifiedSerialNo,'original-attempt');queries++;return{realNameStatus:'2'};},queryCert:async()=>{throw Error('Offline callback must not query certificates');}} as any);
 const payload={transactionNo:'original-attempt',customer_id:'original-provider',timestamp:'20261031000000',status:'2'},signed={...payload,msg_digest:buildFadadaMsgDigest({...settings,timestamp:payload.timestamp,businessParams:payload,explicitSortString:payload.transactionNo})};
 await assert.rejects(service.callback({...signed,msg_digest:'forged'}),code('CALLBACK_SIGNATURE'));assert.equal(queries,0);
 assert.deepEqual(await service.callback(signed),{accepted:true,replayed:false});assert.equal(account.realNameStatus,'VERIFIED');assert.equal(account.identityCiphertext,cipher);assert.equal(account.identityVersion,1);assert.equal(account.verificationTransactionNo,'original-attempt');assert.equal(queries,1);
 assert.deepEqual(await service.callback(signed),{accepted:true,replayed:true});assert.equal(queries,1);
 assert.equal((await service.readiness('customer')).realNameStatus,'VERIFIED');
 const current=await service.identityReadiness('customer');assert.equal(current.identityPolicy,'MANUAL_REVIEW');assert.equal(current.verified,false);assert.equal('snapshot' in current,false);
 await assert.rejects(service.refresh('customer',true),code('CUSTOMER_IDENTITY_UNAVAILABLE'));assert.equal(queries,1);
}));
