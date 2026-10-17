const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNativeSigningApi}=require('../src/services/native-signing');
const config={mode:'MINIAPP_WEBVIEW',enabled:true,signProviderConfigured:true,providerHosts:['textapi17.fadada.com','realnameverify16.fadada.com'],returnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return',faceBridgeConfigured:true,faceBridgeProtocol:'FADADA_H5_CURRENT_FLOW_V1'};
const initial='https://realnameverify16.fadada.com/fddAuthenticationService/v1/api/synsAuthentication.action?transaction_no=synthetic&sign=opaque';
const callback='https://realnameverify.fadada.com/fddAuthenticationService/app/index.html?opaque=face%2Bresult#/result';
const normalized=callback.replace('realnameverify.fadada.com','realnameverify16.fadada.com');
const appId='wx0123456789abcdef',path='pages/face/index';
const options=()=>Object.fromEntries(Object.entries({bizToken:'synthetic-token',miniProgramAppId:appId,miniProgramPath:path,miniProgramCallBackUrl:callback}).map(([k,v])=>[k,encodeURIComponent(v)]));
function setup(){let customerId='person',token='session',cfg={...config},rejectJump=false;const calls=[],navigations=[],storage=new Map();
 const api=createNativeSigningApi({call:async(method,p)=>{calls.push({method,p});return p==='/public/signing-config'?cfg:{url:initial,status:'PENDING'};},native:async(method,args)=>{navigations.push({method,args});if(method==='navigateToMiniProgram'&&rejectJump)throw Error('synthetic cancellation');},identifier:encodeURIComponent,error:(message,code)=>Object.assign(new Error(message),{code}),getContext:()=>({authenticated:!!token,customer:{id:customerId}}),sessionKey:()=>token,getSignStatus:async()=>({status:'PENDING'}),platform:{setStorageSync:(k,v)=>storage.set(k,v),getStorageSync:k=>storage.get(k),removeStorageSync:k=>storage.delete(k)},pendingKey:'pending'});
 const parent={kind:'owner-identity',id:'enterprise:new',url:initial};
 return{api,parent,calls,navigations,storage,config:v=>cfg=v,rotate:()=>token='rotated',reject:v=>rejectJump=v,start:()=>api.startOwnerSigning('owner-identity','enterprise',null,{accepted:true})};
}
test('face bridge requires a loaded current provider page, and returns to that flow without declaring verified',async()=>{
 const e=setup();assert.throws(()=>e.api.prepareFaceBridge(options(),e.parent));await e.start();assert.throws(()=>e.api.prepareFaceBridge(options(),e.parent));
 e.api.markSigningWebLoaded(e.parent.kind,e.parent.id,e.parent.url);const handle=e.api.prepareFaceBridge(options(),e.parent);
 assert.deepEqual(Object.keys(handle),['bridgeId']);assert.equal(e.navigations.filter(x=>x.method==='navigateToMiniProgram').length,0);
 await e.api.startFaceBridge(handle.bridgeId,e.parent);assert.deepEqual(e.navigations.at(-1),{method:'navigateToMiniProgram',args:{appId,path:path+'?bizToken=synthetic-token',envVersion:'release'}});
 const result=e.api.completeFaceBridge(handle.bridgeId,{scene:1038,referrerInfo:{appId,extraData:{faceResult:'SIGNED'}}},e.parent);
 assert.equal(result.reloadUrl,normalized);assert.equal(result.status,undefined);assert.equal(e.api.reloadSigningPage(e.parent.kind,e.parent.id,result.reloadUrl),normalized);
 assert.equal(e.api.getSigningTask(e.parent.kind,e.parent.id).status,'PENDING');assert.throws(()=>e.api.completeFaceBridge(handle.bridgeId,{scene:1038,referrerInfo:{appId}},e.parent));
 assert.equal(e.calls.filter(x=>x.method==='POST').length,1);assert.ok(!JSON.stringify([...e.storage]).includes('synthetic-token'));
});
test('unrelated pages, disabled bridge, unsafe callbacks and malformed dynamic parameters cannot jump',async()=>{
 const e=setup();await e.start();e.api.markSigningWebLoaded(e.parent.kind,e.parent.id,e.parent.url);
 for(const parent of [{...e.parent,id:'other:new'},{...e.parent,url:initial+'&other=1'},{...e.parent,kind:'contract'}])assert.throws(()=>e.api.prepareFaceBridge(options(),parent));
 for(const bad of [
  {miniProgramAppId:'other'}, {miniProgramPath:'pages/index?steal=true'}, {bizToken:'%E0%A4%A'},
  ...['https://evil.test/callback','https://realnameverify16.fadada.com:443/fddAuthenticationService/return','https://user@realnameverify16.fadada.com/fddAuthenticationService/return','https://realnameverify16.fadada.com/other','https://realnameverify16.fadada.com.evil.test/fddAuthenticationService/return','https://realnameverify16.fadada.com/fddAuthenticationService/return\n'].map(v=>({miniProgramCallBackUrl:encodeURIComponent(v)}))
 ])assert.throws(()=>e.api.prepareFaceBridge({...options(),...bad},e.parent));
 const off=setup();off.config({...config,faceBridgeConfigured:false});await off.start();off.api.markSigningWebLoaded(off.parent.kind,off.parent.id,off.parent.url);assert.throws(()=>off.api.prepareFaceBridge(options(),off.parent));
 assert.equal(e.navigations.filter(x=>x.method==='navigateToMiniProgram').length,0);
});
test('session changes, expiry, another active flow, logout and revoked task invalidate face handles',async()=>{
 for(const change of ['session','expiry','other','logout','forgotten']){const e=setup();await e.start();e.api.markSigningWebLoaded(e.parent.kind,e.parent.id,e.parent.url);const h=e.api.prepareFaceBridge(options(),e.parent);const now=Date.now;
  try{if(change==='session')e.rotate();if(change==='expiry')Date.now=()=>now()+11*60*1000;if(change==='other')await e.api.startOwnerSigning('owner-identity','another',null,{});if(change==='logout')e.api.clearSigningState();if(change==='forgotten')e.api.forgetSigningTask(e.parent.kind,e.parent.id);
   await assert.rejects(e.api.startFaceBridge(h.bridgeId,e.parent));assert.throws(()=>e.api.completeFaceBridge(h.bridgeId,{scene:1038,referrerInfo:{appId}},e.parent));
  }finally{Date.now=now;}
 }
});
test('return checks initiation, referrer and scene; user cancellation permits explicit retry only',async()=>{
 const e=setup();await e.start();e.api.markSigningWebLoaded(e.parent.kind,e.parent.id,e.parent.url);const h=e.api.prepareFaceBridge(options(),e.parent);
 assert.throws(()=>e.api.completeFaceBridge(h.bridgeId,{scene:1038,referrerInfo:{appId}},e.parent));
 e.reject(true);await assert.rejects(e.api.startFaceBridge(h.bridgeId,e.parent));assert.throws(()=>e.api.completeFaceBridge(h.bridgeId,{scene:1038,referrerInfo:{appId}},e.parent));
 e.reject(false);await e.api.startFaceBridge(h.bridgeId,e.parent);
 for(const entry of [{scene:1001,referrerInfo:{appId}},{scene:1038,referrerInfo:{appId:'wx1111111111111111'}}])assert.throws(()=>e.api.completeFaceBridge(h.bridgeId,entry,e.parent));
 assert.equal(e.api.completeFaceBridge(h.bridgeId,{scene:1038,referrerInfo:{appId,extraData:{faceResult:false}}},e.parent).reloadUrl,normalized);
});
function middlePage(e){
 const fs=require('node:fs'),vm=require('node:vm');let definition,entry={scene:1001};const actions=[];
 const parent={route:'pages/sign/index',kind:e.parent.kind,id:e.parent.id,data:{url:e.parent.url},reloadPage(url){this.data.url=e.api.reloadSigningPage(this.kind,this.id,url);return true;}};
 const stack=[parent];const wx={getEnterOptionsSync:()=>entry,navigateBack:()=>actions.push('back')};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/pagesFace/pages/middle/middle.js'),'utf8'),{Page:v=>definition=v,require:()=>e.api,wx,getCurrentPages:()=>stack});
 const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};stack.push(page);
 return{page,parent,actions,setEntry:v=>entry=v,stack};
}
test('middle page waits for a user click and genuine return, then reloads only its original parent',async()=>{
 const e=setup();await e.start();e.api.markSigningWebLoaded(e.parent.kind,e.parent.id,e.parent.url);const p=middlePage(e);
 p.setEntry({scene:1038,referrerInfo:{appId,extraData:{faceResult:'success'}}});p.page.onLoad(options());p.page.onShow();assert.equal(p.page.data.ready,true);assert.equal(p.actions.length,0);assert.equal(e.navigations.length,1);
 await p.page.startFace();p.page.onShow();assert.equal(p.actions.length,0);p.page.onHide();p.page.onShow();assert.equal(p.parent.data.url,normalized);assert.deepEqual(p.actions,['back']);
 assert.ok(!JSON.stringify(p.page.data).includes('synthetic-token'));assert.equal(p.page.data.ready,false);
});
test('middle page rejects direct entry, mismatched parent, and a failed native jump without status changes',async()=>{
 const e=setup();await e.start();e.api.markSigningWebLoaded(e.parent.kind,e.parent.id,e.parent.url);
 const direct=middlePage(e);direct.stack.shift();direct.page.onLoad(options());assert.equal(direct.page.data.ready,false);
 const p=middlePage(e);p.page.onLoad(options());e.reject(true);await p.page.startFace();assert.equal(p.page.data.busy,false);assert.ok(p.page.data.error);p.page.onHide();p.page.onShow();assert.equal(p.actions.length,0);
 e.reject(false);await p.page.startFace();p.page.onHide();p.setEntry({scene:1038,referrerInfo:{appId}});p.stack[0]={...p.parent};p.page.onShow();assert.equal(p.actions.length,0);assert.equal(p.page.data.ready,false);
 assert.equal(e.api.getSigningTask(e.parent.kind,e.parent.id).status,'PENDING');
});
