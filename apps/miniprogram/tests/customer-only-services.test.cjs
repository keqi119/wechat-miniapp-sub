const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sourceRoot=path.resolve(process.env.MINIAPP_SOURCE_ROOT||path.join(__dirname,'../src'));
const {createApi}=require(path.join(sourceRoot,'services/api'));
const {createNativeSigningApi}=require(path.join(sourceRoot,'services/native-signing'));
const {createFaceBridgeApi}=require(path.join(sourceRoot,'services/native-face-bridge'));
const policy=require(path.join(sourceRoot,'services/native-signing-policy'));
const config=require(path.join(sourceRoot,'config'));
const kinds=['owner-identity','owner-contract','owner-authority','owner-revoke'];
const signingConfig={mode: 'MINIAPP_WEBVIEW', newOrderContractMode: 'ESIGN', newEsignRequestsEnabled: true,enabled:true,signProviderConfigured:true,providerHosts:['realnameverify16.fadada.com','textapi17.fadada.com'],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
function apiSetup(){
 const calls=[],downloads=[],storage=new Map([[config.storageKey,{token:'synthetic',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'customer'}}]]);
 const platform={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),downloadFile:x=>{downloads.push(x);x.success({statusCode:200,tempFilePath:'synthetic.pdf'});},openDocument:x=>x.success({})};
 const api=createApi(config,req=>{calls.push(req);req.success({statusCode:200,data:{verified:true,realNameStatus:"VERIFIED",readyForSigning:true,certBound:true,status:'PENDING'}});},platform);
 return{api,calls,downloads,storage};
}
test('customer API exposes no enterprise owner operations and rejects owner status before transport',async()=>{
 const {api,calls}=apiSetup();
 for(const name of ['getOwners','claimOwner','getOwner','refreshOwner','selectOwnerSeal','getOwnerAuthorities','getOwnerContracts','getOwnerContract','manualOwnerContract','syncOwnerContract','openOwnerFile','startOwnerSigning'])assert.equal(api[name],undefined,name);
 for(const kind of kinds)await assert.rejects(api.getSignStatus('enterprise:record',kind),e=>e.code==='OWNER_H5_REQUIRED');
 assert.deepEqual(calls,[]);
});
test('private downloads cannot use the removed owner path parameter',async()=>{
 const {api,calls,downloads}=apiSetup();
 await assert.rejects(api.openPrivateFile(null,'/owners/enterprise/contracts/record/files/source'));
 assert.deepEqual(calls,[]);assert.deepEqual(downloads,[]);
 await api.openPrivateFile('customer-file','/owners/enterprise/contracts/record/files/source');
 assert.equal(downloads.length,1);assert.ok(downloads[0].url.endsWith('/api/customer/files/customer-file'));
});
test('legacy owner pending contexts are discarded without resuming or contacting services',async()=>{
 for(const kind of kinds){
  const {api,calls,storage}=apiSetup();const key=config.storageKey+':pending';
  storage.set(key,{kind,id:'enterprise:record'});assert.equal(await api.resumeSigning(),null);assert.equal(storage.has(key),false);assert.deepEqual(calls,[]);
  assert.throws(()=>api.getSigningTask(kind,'enterprise:record'),e=>e.code==='SIGN_CONTEXT');
  await assert.rejects(api.startSigning(kind,'enterprise:record',{}),e=>e.code==='SIGN_CONTEXT');assert.deepEqual(calls,[]);
 }
});
test('customer readiness queries still work without any owner metadata dependency',async()=>{
 const {api,calls}=apiSetup();const result=await api.getSignStatus('customer','identity');assert.equal(result.status,'VERIFIED');assert.equal(calls[0].method,'GET');assert.ok(calls[0].url.endsWith('/customer/identity/readiness'));
 assert.equal(policy.ownerPortalConfig,undefined);
 for(const ownerPortal of [undefined,{mode:'unexpected',entryUrl:'https://evil.invalid/?secret=do-not-use'}]){
  const value=policy.signingConfig({...signingConfig,ownerPortal});assert.equal('ownerPortal'in value,false);assert.equal(value.enabled,true);
 }
});
test('face bridge rejects enterprise identity before looking up a task or opening any app',()=>{
 const lookups=[],navigations=[];const api=createFaceBridgeApi({currentTask:(...a)=>{lookups.push(a);return{};},native:(...a)=>navigations.push(a),error:(m,c)=>Object.assign(new Error(m),{code:c})});
 assert.throws(()=>api.prepareFaceBridge({}, {kind:'owner-identity',id:'enterprise:record',url:'https://realnameverify16.fadada.com/path'}),e=>e.code==='FACE_CONTEXT');assert.deepEqual(lookups,[]);assert.deepEqual(navigations,[]);
});
test('old owner sign links show one modal and return to account with no service requests or webview',async()=>{
 for(const kind of kinds){
  let page;const calls=[],modals=[],navigation=[];
  const services=new Proxy({}, {get:(_,name)=>(...args)=>{calls.push([name,args]);throw Error('Owner flow must not call any service');}});
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/sign/index.js'),'utf8'),{Page:p=>page=p,require:id=>id.includes('services')?services:{load:()=>calls.push(['load']),go:url=>navigation.push(url)},wx:{showModal:input=>modals.push(input)}});
  page.data=structuredClone(page.data);page.setData=function(v){Object.assign(this.data,v);};page.onLoad({kind,id:'enterprise%3Arecord'});
  await page.reload();await page.onShow();await page.refreshStatus();await page.retry();page.onWebMessage();page.onWebLoad();page.onWebError();assert.equal(page.reloadPage('https://textapi17.fadada.com/api2/sign'),false);page.onUnload();
  assert.equal(modals.length,1);assert.match(modals[0].content,/服务号/);assert.equal(modals[0].showCancel,false);modals[0].success({confirm:true});assert.deepEqual(navigation,['/pages/profile/index']);assert.deepEqual(calls,[]);assert.equal(page.data.url,'');assert.equal(page.data.enabled,false);
 }
});
