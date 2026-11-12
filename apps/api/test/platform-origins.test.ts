import './legacy-esign-mode';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeSigningConfig,runNativeSigning} from '../src/esign/native-signing';
import {h5Config,h5Origin,approvedReturnUrl} from '../src/h5-sign/config';
import {fadadaSettings} from '../src/esign/esign.settings';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import {FadadaOwnerClient} from '../src/owner-signing/fadada-owner.client';
import {FadadaHttpClient} from '../src/esign/fadada/fadada-http-client';
import {FadadaESignGateway} from '../src/esign/fadada/fadada-esign.provider';
import {ownerH5EntryUrl,ownerH5ReturnUrl} from '../src/common/platform-origins';

const origins={PLATFORM_API_ORIGIN:'https://api.evsub.ndacar.com',H5_SIGNING_ORIGIN:'https://sign.evsub.ndacar.com'};
const config:any={enabled:true,signingEnabled:true,appId:'synthetic',appSecret:'synthetic',baseUrl:'https://textapi17.fadada.com/api2/',apiVersion:'2.0',requestTimeoutMs:1000};
async function configured(action:()=>unknown|Promise<unknown>){
 const prior=Object.fromEntries(Object.keys(origins).map(key=>[key,process.env[key]]));
 Object.assign(process.env,origins);
 try{return await action();}finally{for(const[key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
const errorCode=(code:string)=>(error:any)=>error.getResponse?.().error?.code===code;

test('production refuses either missing deployment origin instead of returning a legacy callback',()=>{
 for(const partial of [{},{PLATFORM_API_ORIGIN:origins.PLATFORM_API_ORIGIN},{H5_SIGNING_ORIGIN:origins.H5_SIGNING_ORIGIN}])assert.throws(()=>fadadaSettings({NODE_ENV:'production',FADADA_ENABLED:'false',...partial}),errorCode('PLATFORM_ORIGIN_INVALID'));
 assert.equal(fadadaSettings({NODE_ENV:'production',FADADA_ENABLED:'false',...origins}).signNotifyUrl,'https://api.evsub.ndacar.com/api/callbacks/fadada-sign');
 for(const NODE_ENV of ['test','development'])assert.equal(fadadaSettings({NODE_ENV,FADADA_ENABLED:'false'}).signNotifyUrl,'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign');
});

test('public signing entries and allowed return URLs stay inside the configured environment',()=>configured(()=>{
 assert.equal(nativeSigningConfig().returnUrl,'https://api.evsub.ndacar.com/api/public/esign-return');
 assert.equal(h5Config().entryUrl,'https://sign.evsub.ndacar.com/miniapp-sign/');
 for(const url of ['https://api.evsub.ndacar.com/api/public/esign-return','https://sign.evsub.ndacar.com/miniapp-sign/return/'])assert.equal(approvedReturnUrl(url),url);
 for(const url of ['https://mini-api.subauto.keybox.cloud/api/public/esign-return','https://app.subauto.keybox.cloud/miniapp-sign/return/','https://api.evsub.ndacar.com/api/public/esign-return?next=old','https://sign.evsub.ndacar.com/miniapp-sign/return/other','https://api.evsub.ndacar.com.evil.test/api/public/esign-return'])assert.throws(()=>approvedReturnUrl(url),errorCode('FADADA_CALLBACK_CONFIG'));
}));

test('H5 writes accept only the new exact origin and reject legacy or lookalike origins',()=>configured(()=>{
 assert.doesNotThrow(()=>h5Origin({headers:{origin:'https://sign.evsub.ndacar.com'}}));
 for(const origin of ['https://app.subauto.keybox.cloud','https://sign.evsub.ndacar.com.evil.test','https://sign.evsub.ndacar.com/','http://sign.evsub.ndacar.com'])assert.throws(()=>h5Origin({headers:{origin}}),errorCode('ORIGIN_DENIED'));
}));

test('legal owner H5 uses a fixed separate entry and exact approved return path',()=>configured(()=>{
 assert.equal(ownerH5EntryUrl(),'https://sign.evsub.ndacar.com/owner/');
 assert.equal(ownerH5ReturnUrl(),'https://sign.evsub.ndacar.com/owner/return/');
 assert.equal(approvedReturnUrl(ownerH5ReturnUrl()),ownerH5ReturnUrl());
 for(const path of ['/owner/','/owner/return/?success=true','/owner/return/elsewhere','/owner/return/#next'])assert.throws(()=>approvedReturnUrl(origins.H5_SIGNING_ORIGIN+path),errorCode('FADADA_CALLBACK_CONFIG'));
}));

test('configured origins reject credentials, ports, path, query, fragment, whitespace and non-HTTPS values',()=>configured(()=>{
 for(const key of Object.keys(origins))for(const value of ['', 'http://api.evsub.ndacar.com','https://user:secret@api.evsub.ndacar.com','https://api.evsub.ndacar.com/','https://api.evsub.ndacar.com/path','https://api.evsub.ndacar.com?x=1','https://api.evsub.ndacar.com#x',' https://api.evsub.ndacar.com','https://api.evsub.ndacar.com:443','https://api.evsub.ndacar.com:8443','https://api.evsub.ndacar.com\\evil']){
  process.env[key]=value;
  assert.throws(()=>nativeSigningConfig(),errorCode('PLATFORM_ORIGIN_INVALID'),`${key}: ${value}`);
  process.env[key]=origins[key as keyof typeof origins];
 }
}));

test('Fadada default callbacks follow supplied environment and reject cross-environment or wrong endpoint overrides',()=>{
 const result=fadadaSettings({...origins,FADADA_ENABLED:'false'});
 assert.equal(result.signNotifyUrl,'https://api.evsub.ndacar.com/api/callbacks/fadada-sign');
 assert.equal(result.verifyNotifyUrl,'https://api.evsub.ndacar.com/api/callbacks/fadada-identity');
 assert.equal(result.signReturnUrl,'https://api.evsub.ndacar.com/api/public/esign-return');
 assert.equal(result.verifyReturnUrl,'https://api.evsub.ndacar.com/api/public/esign-return');
 for(const key of ['FADADA_SIGN_NOTIFY_URL','FADADA_VERIFY_NOTIFY_URL'])for(const value of ['https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign','https://api.evsub.ndacar.com/anything','https://api.evsub.ndacar.com/api/callbacks/fadada-sign?x=1'])assert.throws(()=>fadadaSettings({...origins,FADADA_ENABLED:'false',[key]:value}),errorCode('FADADA_CALLBACK_CONFIG'));
 assert.throws(()=>fadadaSettings({...origins,FADADA_SIGN_RETURN_URL:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'}),errorCode('FADADA_CALLBACK_CONFIG'));
});

test('native provider requests bind new notification and return URLs without changing the supplier host',()=>configured(async()=>{
 const requests:any[]=[];
 const api=new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config,async request=>{requests.push(request);return{status:200,headers:{},bodyText:JSON.stringify({code:'1',transactionNo:'synthetic',url:Buffer.from('https://realnameverify16.fadada.com/verify').toString('base64')})};}));
 const input={customerId:'synthetic',name:'Synthetic',idCardNo:'110101199001010000',mobile:'13900000000',notifyUrl:'https://api.evsub.ndacar.com/api/callbacks/fadada-identity',returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
 await runNativeSigning(async()=>{await api.getPersonVerifyUrl(input);return{};});
 assert.equal(requests[0].url,'https://textapi17.fadada.com/api2/get_person_verify_url.api');
 const params=new URLSearchParams(String(requests[0].body));assert.equal(params.get('return_url'),input.returnUrl);assert.equal(params.get('notify_url'),input.notifyUrl);
 await assert.rejects(runNativeSigning(async()=>{await api.getPersonVerifyUrl({...input,returnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'});return{};}),errorCode('FADADA_CALLBACK_CONFIG'));
 assert.equal(requests.length,1);
}));

test('owner verification, authorization, revocation and signing send only new environment callback URLs',()=>configured(async()=>{
 const requests:any[]=[];
 const owner=new FadadaOwnerClient(config,new FadadaHttpClient(config,async request=>{requests.push(request);return{status:200,headers:{},bodyText:JSON.stringify({code:1,data:{transactionNo:'synthetic',url:Buffer.from('https://realnameverify16.fadada.com/verify').toString('base64')}})};}));
 await owner.createVerification({customerId:'OwnerA',name:'合成企业',creditCode:'TEST00000000000001'});
 assert.equal(new URLSearchParams(String(requests[0].body)).get('notify_url'),'https://api.evsub.ndacar.com/api/callbacks/fadada-owner-identity');
 assert.equal(new URLSearchParams(String(requests[0].body)).get('return_url'),'https://api.evsub.ndacar.com/api/public/esign-return');
 const identity={customerId:'OwnerA',contractId:'ContractA',transactionId:'TransactionA',signatureId:'SealA'};
 for(const[result,callback]of [[owner.createAuthorizationUrl(identity),'fadada-owner-authorization'],[owner.createRevocationUrl('OwnerA'),'fadada-owner-authorization'],[owner.createManualSignUrl({...identity,title:'合成',positions:[{pagenum:0,x:100,y:100}]}),'fadada-owner-sign']] as const){const url=new URL(result.url);assert.equal(url.origin,'https://textapi17.fadada.com');assert.equal(url.searchParams.get('notify_url'),'https://api.evsub.ndacar.com/api/callbacks/'+callback);assert.equal(url.searchParams.get('return_url'),'https://api.evsub.ndacar.com/api/public/esign-return');}
}));

test('signing gateway rejects wrong callback before reading or mutating signing records',()=>configured(async()=>{
 let reads=0;const db:any={fadadaTask:{findUnique:async()=>{reads++;throw Error('reached-business-validation');}}};
 const input:any={kind:'SUBSCRIPTION',contractId:'contract',documentHash:'hash',returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
 for(const notify of ['https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign','https://api.evsub.ndacar.com/other','https://api.evsub.ndacar.com/api/callbacks/fadada-sign?x=1'])await assert.rejects(new FadadaESignGateway(db,{...config,signNotifyUrl:notify} as any,{} as any,{} as any,{} as any).create(input),errorCode('FADADA_CALLBACK_CONFIG'));
 assert.equal(reads,0);
 await assert.rejects(new FadadaESignGateway(db,{...config,signNotifyUrl:'https://api.evsub.ndacar.com/api/callbacks/fadada-sign'} as any,{} as any,{} as any,{} as any).create(input),/reached-business-validation/);assert.equal(reads,1);
}));
