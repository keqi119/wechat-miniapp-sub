const {test}=require('node:test');const assert=require('node:assert/strict');
const {createNativeSigningApi}=require('../src/services/native-signing');
const {createOwnerApi}=require('../src/services/owners');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('new authorization uses the returned grant for navigation, cache and later status',async()=>{
 const store=new Map(),opened=[];const ownerApi=createOwnerApi({call:async()=>[{id:'real-grant',status:'AUTHORIZED'}],identifier:encodeURIComponent,error:m=>new Error(m)});
 const api=createNativeSigningApi({call:async(method,p)=>p==='/public/signing-config'?{mode:'MINIAPP_WEBVIEW',enabled:true,signProviderConfigured:true,providerHosts:['textapi17.fadada.com'],returnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return'}:{id:'real-grant',url:'https://textapi17.fadada.com/api2/auth'},native:async(m,v)=>opened.push(v.url),identifier:encodeURIComponent,error:(m,code)=>Object.assign(new Error(m),{code}),getContext:()=>({authenticated:true,customer:{id:'person'}}),sessionKey:()=> 'session',getSignStatus:ownerApi.ownerSigningStatus,platform:{setStorageSync:(k,v)=>store.set(k,v),getStorageSync:k=>store.get(k),removeStorageSync:k=>store.delete(k)},pendingKey:'pending'});
 await api.startOwnerSigning('owner-authority','enterprise',null,{});
 assert.equal(store.get('pending').id,'enterprise:real-grant');assert.match(opened[0],/enterprise%3Areal-grant/);assert.equal(api.getSigningTask('owner-authority','enterprise:real-grant').taskId,'real-grant');assert.equal((await api.resumeSigning()).status,'VERIFIED');
});
function ownerPage(){
 let token='one',record={id:'task',sourceSha256:'a'.repeat(64),documentHash:'b'.repeat(64),canSign:true};const api={getContext:()=>({customer:{id:'person'}}),getOwners:async()=>[],getOwner:async()=>({memberStatus:'VERIFIED',seals:[]}),getOwnerAuthorities:async()=>[],getOwnerContracts:async()=>[record],getOwnerOptions:async()=>({}),getOwnerContract:async()=>record,openOwnerFile:async()=>{},startOwnerSigning:async()=>{}};let page;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages/owner/index.js'),'utf8'),{Page:p=>page=p,require:n=>n.includes('services')?api:n.includes('config')?{storageKey:'session'}:{go(){},confirm:async()=>true},wx:{getStorageSync:()=>({token})}});
 page.data=structuredClone(page.data);page.setData=function(v){Object.assign(this.data,v);};page.onLoad({id:'enterprise'});
 return{page,setRecord:v=>record=v,setToken:v=>token=v,getRecord:()=>record};
}
test('returning from PDF preserves only the same session task and source, while explicit consent resets',async()=>{
 const e=ownerPage(),p=e.page;await p.onShow();await p.openContract({currentTarget:{dataset:{id:'task'}}});await p.openPdf({currentTarget:{dataset:{kind:'source'}}});p.data.documentAccepted=true;p.onHide();await p.onShow();assert.equal(p.data.record?.id,'task');assert.equal(p.data.pdfRead,true);assert.equal(p.data.documentAccepted,false);
 e.setRecord({...e.getRecord(),sourceSha256:'c'.repeat(64)});p.onHide();await p.onShow();assert.equal(p.data.pdfRead,false);
 await p.openPdf({currentTarget:{dataset:{kind:'source'}}});e.setToken('two');p.onHide();await p.onShow();assert.equal(p.data.record,null);assert.equal(p.data.pdfRead,false);
});
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
