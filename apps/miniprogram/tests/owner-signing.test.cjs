const {test}=require('node:test');const assert=require('node:assert/strict');
const {createNativeSigningApi}=require('../src/services/native-signing');
const {createOwnerApi}=require('../src/services/owners');
test('revocation remains pending while the previous provider authorization is still valid',async()=>{
 const api=createOwnerApi({call:async()=>[{id:'grant',status:'AUTHORIZED'}],identifier:x=>x,error:m=>new Error(m)});
 assert.equal((await api.ownerSigningStatus('owner:grant','owner-revoke')).status,'PENDING');
 assert.equal((await api.ownerSigningStatus('owner:grant','owner-authority')).status,'VERIFIED');
});
test('owner signing entry binds owner and record, validates supplier host and keeps URLs out of storage',async()=>{
 const calls=[],stored=[],opened=[];let token='a';const api=createNativeSigningApi({call:async(method,path,body)=>{calls.push({method,path,body});return path==='/public/signing-config'?{mode:'MINIAPP_WEBVIEW',enabled:true,signProviderConfigured:true,providerHosts:['textapi17.fadada.com','realnameverify16.fadada.com'],returnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'}:{url:'https://textapi17.fadada.com/api2/extsign.api?secret=signed',status:'PENDING',taskId:'t'};},native:async(method,input)=>opened.push(input),identifier:encodeURIComponent,error:(message,code)=>Object.assign(new Error(message),{code}),getContext:()=>({authenticated:true,customer:{id:'owner-user'}}),sessionKey:()=>token,getSignStatus:async()=>({status:'PENDING'}),platform:{setStorageSync:(_k,v)=>stored.push(v),getStorageSync:()=>null},pendingKey:'pending'});
 await api.startOwnerSigning('owner-contract','enterprise','document',{accepted:true});assert.equal(calls[1].path,'/customer/owners/enterprise/contracts/document/sign');assert.equal(api.getSigningTask('owner-contract','enterprise:document').taskId,'t');assert.ok(!JSON.stringify(stored).includes('secret'));assert.match(opened[0].url,/kind=owner-contract/);token='b';assert.equal(api.getSigningTask('owner-contract','enterprise:document').contextOnly,true);
 await assert.rejects(api.startOwnerSigning('contract','enterprise','document',{}));
});
