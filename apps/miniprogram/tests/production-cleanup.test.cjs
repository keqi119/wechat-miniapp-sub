const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createNativeSigningApi}=require('../src/services/native-signing');
const {createApi}=require('../src/services/api');
const config=require('../src/config');
const source=path.resolve(__dirname,'../src');
const disabled={mode:'MINIAPP_WEBVIEW',enabled:false,electronicEnabled:false,newElectronicRequestsEnabled:false,newOrderContractMode:'OFFLINE',newEsignRequestsEnabled:false,identityPolicy:'MANUAL_REVIEW',signProviderConfigured:false,providerHosts:[],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return',faceBridgeConfigured:false};
test('production routes and source contain no temporary acceptance capabilities or clipboard access',()=>{
 const app=JSON.parse(fs.readFileSync(path.join(source,'app.json')));
 assert.ok(!app.pages.some(p=>/acceptance/.test(p)),'acceptance pages must not ship');
 function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(/\.(js|json|wxml|wxss)$/.test(p))assert.doesNotMatch(fs.readFileSync(p,'utf8'),/getClipboardData|setClipboardData|virtual-acceptance|technical-acceptance|payment-verifications|虚拟流程验收|微信支付验收/,path.relative(source,p));}}
 visit(source);
 assert.ok(app.pages.includes('pages/electronic-contracts/index'));
 assert.ok(app.pages.includes('pages/profile/index'));
 assert.equal(app.tabBar.list.length,4);
});
for(const kind of ['identity','electronic'])test('private test grant cannot override disabled public '+kind+' capability',async()=>{
 const calls=[];
 const api=createNativeSigningApi({call:async(method,route)=>{calls.push(route);return route.startsWith('/public/')?disabled:{entry:{vehicleId:'v'},identity:{...disabled,identityPolicy:'SIGNING_REQUIRED',enabled:true,signProviderConfigured:true},signing:{...disabled,electronicEnabled:true,enabled:true,signProviderConfigured:true},recovery:{identity:true}};},getContext:()=>({authenticated:true,customer:{id:'customer'}}),sessionKey:()=> 'session',platform:{},error:(m,c)=>Object.assign(new Error(m),{code:c})});
 const result=await api.getSigningConfig(kind);
 assert.equal(result.enabled,false);
 assert.deepEqual(calls,[kind==='identity'?'/public/identity-config':'/public/signing-config']);
});
test('ordinary customer profile remains manual review without reading a test capability',async()=>{
 const calls=[],session={token:'synthetic',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'c'}};
 const profile={revision:1,name:'合成客户',mobile:'13800000000',readiness:{identityPolicy:'MANUAL_REVIEW',readyForApplication:false,blockers:[]}};
 const api=createApi(config,o=>{const route=new URL(o.url).pathname.replace(/^\/api/,'');calls.push(route);o.success({statusCode:200,data:route==='/customer/profile'?profile:disabled});},{getStorageSync:k=>k===config.storageKey?session:null,setStorageSync(){},removeStorageSync(){}});
 const result=await api.getProfile();assert.equal(result.readiness.identityPolicy,'MANUAL_REVIEW');assert.deepEqual(calls,['/customer/profile']);
 for(const key of ['getVirtualAcceptance','getVirtualAcceptanceCapabilities','claimVirtualCompany','getTechnicalAcceptances','payPaymentVerification','getPaymentVerifications'])assert.equal(typeof api[key],'undefined',key);
});
