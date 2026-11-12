const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createApi}=require('../src/services/api'),config=require('../src/config');
const policy=require('../src/services/native-signing-policy');
const signing={mode:'MINIAPP_WEBVIEW',newOrderContractMode:'OFFLINE',newEsignRequestsEnabled:false,enabled:true,signProviderConfigured:true,providerHosts:['textapi17.fadada.com','realnameverify16.fadada.com'],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
const docs=['terms','privacy'].map(type=>({id:type,type,version:1,content:'合成已发布协议'}));
const technical={id:'ta1',customerId:'c1',revision:1,status:'AWAITING_CONFIRMATION',signatureStatus:'DRAFT',retentionStatus:'RETAINED',document:{id:'td1',type:'technical-signing-verification',version:1,title:'历史文件',content:'合成历史全文',templateHash:'a'.repeat(64),bodyHash:'b'.repeat(64),documentHash:'c'.repeat(64),sourcePdfHash:'d'.repeat(64)},sourceFileId:'source1',disclosure:{version:'1',text:'历史说明',privacyDocumentId:'privacy',privacyVersion:1},enabled:true,consentRequirementsMet:true,canConfirm:true,canSign:true,canSync:true,canStop:true};
function setup(capability=signing, intercept){
 const calls=[],jumps=[],storage=new Map([[config.storageKey,{token:'synthetic',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'c1',name:'合成客户'}}]]);
 const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),navigateTo:o=>{jumps.push(o.url);o.success?.({});},showToast(){},showModal(){},navigateBack(){},downloadFile:o=>o.success({statusCode:200,tempFilePath:'/synthetic.pdf'}),openDocument:o=>o.success({})};
 const api=createApi(config,o=>{
  const route=new URL(o.url).pathname.replace(/^\/api/,'');calls.push({route,method:o.method});if(intercept?.(route,o))return;let data;
  if(route==='/public/signing-config')data=capability;
  else if(route.startsWith('/public/legal/'))data=docs.find(d=>route.endsWith(d.type));
  else if(route==='/customer/profile')data={revision:0,name:'合成客户',mobile:'13800000000',drivingYears:0,files:{legacy:[]},readiness:{readyForApplication:false,blockers:[]}};
    else if(route==='/public/identity-config')data={mode:'MINIAPP_WEBVIEW',enabled:false,signProviderConfigured:false,providerHosts:[],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
    else if(route==='/customer/context')data={customer:storage.get(config.storageKey).customer,consents:docs.map(d=>({documentId:d.id,version:d.version}))};
  else if(route==='/customer/payment-verifications')data={items:[]};
  else if(route==='/customer/technical-acceptances')data={items:[technical]};
  else if(route.startsWith('/customer/technical-acceptances/'))data=technical;
  else if(route==='/customer/identity/readiness')data={verified:true,realNameStatus:'VERIFIED',certBound:true,readyForSigning:true};
  else if(route.startsWith('/customer/payments/'))data={status:'SUCCEEDED'};
  else if(route.startsWith('/customer/records/contracts/'))data={id:route.split('/').at(-1),executionMode:'ESIGN'};
  else if(/^\/customer\/handovers\/[^/]+$/.test(route))data={id:route.split('/').at(-1),executionMode:'ESIGN'};
  else if(route.endsWith('/sign-status'))data={status:'PENDING'};
  else if(route.endsWith('/sign'))data={taskId:'task1',status:'PENDING',url:'https://textapi17.fadada.com/synthetic'};
  else throw Error('Unexpected synthetic route '+route);
  o.success({statusCode:200,data});
 },wx);
 function page(name){let definition;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages',name,'index.js'),'utf8'),{Page:v=>definition=v,require:id=>id.includes('handover-location')?require('../src/utils/handover-location'):id.includes('services')?api:id.includes('config')?config:require('../src/utils/page'),wx,clearInterval,setInterval});return{...definition,data:structuredClone(definition.data),setData(v,done){Object.assign(this.data,v);done?.();}};}
 return{api,calls,jumps,storage,wx,page};
}
test('OFFLINE capability cannot be re-enabled by old native flags and malformed business fields fail closed',()=>{
 const value=policy.signingConfig(signing);assert.equal(value.newOrderContractMode,'OFFLINE');assert.equal(value.newEsignRequestsEnabled,false);assert.equal(value.enabled,false);
 for(const replacement of [{newOrderContractMode:undefined},{newOrderContractMode:'other'},{newEsignRequestsEnabled:'false'}])assert.throws(()=>policy.signingConfig({...signing,...replacement}),{code:'SIGN_CONFIG'});
});
test('ordinary OFFLINE settings reads only the existing personal identity result without signing configuration or technical history',async()=>{
 const e=setup(),p=e.page('profile');await p.refresh();assert.equal(p.data.authenticated,true);assert.equal(p.data.legalDocumentsReady,true);
 assert.equal(p.data.identityStatusText,'已实名');assert.equal(e.calls.filter(c=>c.route==='/customer/identity/readiness').length,1);
 assert.equal(e.calls.some(c=>/technical-acceptances|signing-config/.test(c.route)),false);
 assert.ok(e.calls.every(c=>c.method==='GET'));assert.equal(e.jumps.length,0);
});

test('missing signing capability does not affect the ordinary personal identity read',async()=>{
 const e=setup({}),p=e.page('profile');await p.refresh();assert.equal(p.data.authenticated,true);assert.equal(p.data.legalDocumentsReady,true);assert.equal(p.data.identityStatusText,'已实名');assert.equal(p.data.error,'');
 assert.equal(e.calls.some(c=>/technical-acceptances|signing-config/.test(c.route)),false);
});

test('OFFLINE cached signing and explicit status cannot invoke supplier routes while payment recovery still works',async()=>{
 const e=setup();e.storage.set(config.storageKey+':pending',{kind:'contract',id:'ct1'});e.storage.set(config.storageKey+':pending:payment',{id:'pay1',billId:'bill1'});
 await e.api.resumePayment();await e.api.resumeSigning();await assert.rejects(e.api.getSignStatus('ct1','contract'));
 assert.ok(e.calls.some(c=>c.route==='/customer/payments/pay1'));assert.equal(e.calls.some(c=>c.route.endsWith('/sign-status')),false);
 assert.equal(e.storage.get(config.storageKey+':pending').id,'ct1');
});
for(const kind of ['contract','handover','order-change','identity'])test('OFFLINE '+kind+' deep link never reads provider status or opens webview',async()=>{
 const e=setup(),p=e.page('sign');p.kind=kind;p.id=kind==='identity'?'c1':'ta1';p._pageGeneration=1;p._statusRevision=0;
 await p.reload();await p.onShow();assert.equal(p.data.url,'');assert.equal(p.data.enabled,false);
 assert.ok(e.calls.every(c=>c.method==='GET'));assert.equal(e.calls.some(c=>c.route.endsWith('/sign-status')||c.route.endsWith('/sync')),false);assert.equal(e.jumps.length,0);
});

for(const outcome of ['OFFLINE','ERROR','ESIGN'])test('an existing webview stays absent while '+outcome+' capability is checked on return',async()=>{
 const enabled={...signing,newOrderContractMode:'ESIGN',newEsignRequestsEnabled:true};let hold=false,held;
 const e=setup(enabled,(route,o)=>{if(hold&&route==='/public/signing-config'){held=o;return true;}});
 await e.api.startSigning('contract','ct1');const p=e.page('sign');p.kind='contract';p.id='ct1';p._pageGeneration=1;p._statusRevision=0;await p.reload();assert.ok(p.data.url);
 const oldUrl=p.data.url;hold=true;const pending=p.onShow();await new Promise(setImmediate);assert.equal(p.data.url,'');assert.equal(p.reloadPage(oldUrl),false);
 hold=false;held.success({statusCode:outcome==='ERROR'?503:200,data:outcome==='OFFLINE'?signing:enabled});await pending;
 assert.equal(p.data.url,outcome==='ESIGN'?oldUrl:'');assert.equal(e.calls.filter(c=>c.route.endsWith('/sign-status')).length,outcome==='ESIGN'?1:0);
});
test('OFFLINE legacy contract and handover views preserve files but remove signing and supplier-query actions',async()=>{
 const {contractRecord}=require('./fixtures/customer-contract-page.cjs'),{handoverRecord}=require('./fixtures/customer-handover-page.cjs');
 const {contractOverview}=require('../src/utils/customer-contract'),{handoverSigning}=require('../src/utils/customer-handover');
 const record=contractRecord('READY_TO_SIGN'),handover=handoverRecord('READY_TO_SIGN');
 const e=setup(signing,(route,o)=>{if(route==='/customer/records/contracts/'+record.id||route==='/customer/handovers/'+handover.id){o.success({statusCode:200,data:route.includes('/records/')?record:handover});return true;}});
 const contract=await e.api.getRecord('contracts',record.id),c=contractOverview(contract,record.id);assert.equal(c.available,true);assert.equal(c.canSign,false);assert.equal(c.canQuery,false);assert.equal(c.primaryAction,null);assert.equal(c.documents[0].id,'offline-source');assert.deepEqual(contract.actions,[]);
 const h=handoverSigning(await e.api.getHandover(handover.id));assert.equal(h.available,true);assert.equal(h.canSign,false);assert.equal(h.historyOnly,true);assert.equal(h.stage,'READY_TO_SIGN');
 assert.ok(e.calls.every(c=>c.method==='GET'));
});

function rendered(name,data){const compiler=require('miniprogram-compiler'),root=path.resolve(__dirname,'../src'),file='pages/'+name+'/index.wxml';const compiled=compiler.wxmlToJs(root,{wxmlList:[file],maxBuffer:16*1024*1024});return vm.runInNewContext('(function(global){'+compiled+'})({})',{window:{},console})(file)(data);}
test('OFFLINE and unknown settings render verified personal status without repeat authentication or signing actions',async()=>{
 const visible=node=>typeof node==='string'?node:node&&typeof node==='object'?(node.children||[]).map(visible).join(''):'';
 for(const capability of [signing,{}]){const e=setup(capability),p=e.page('profile');await p.refresh();const renderedTree=rendered('profile',p.data),tree=JSON.stringify(renderedTree),copy=visible(renderedTree);assert.match(copy,/个人信息/);assert.match(copy,/证件资料/);assert.match(copy,/已实名/);assert.doesNotMatch(copy,/历史资料|证书|法大大|本人身份证号码|开始实名认证/);assert.doesNotMatch(tree,/verifyIdentity|toggleHistory|clearCache|openTechnicalAcceptance/);}
});

test('ordinary OFFLINE identity read expiry recovers anonymous login and fresh public agreements',async()=>{
 const e=setup(signing,(route,o)=>{if(route==='/customer/identity/readiness'){o.success({statusCode:401,data:{error:{code:'SESSION_EXPIRED'}}});return true;}}),p=e.page('profile');await p.refresh();assert.equal(p.data.authenticated,false);assert.equal(p.data.legalDocumentsReady,true);assert.equal(p.data.profile,null);assert.ok(e.calls.every(c=>c.method==='GET'));assert.equal(e.calls.filter(c=>c.route==='/customer/identity/readiness').length,1);
});

test('a late personal identity read cannot repaint a replacement customer after settings refresh',async()=>{
 let held;const e=setup(signing,(route,o)=>{if(!held&&route==='/customer/identity/readiness'){held=o;return true;}}),p=e.page('profile');const old=p.refresh();await new Promise(setImmediate);e.storage.set(config.storageKey,{token:'replacement',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'replacement',name:'合成新客户'}});await p.refresh();const state=structuredClone(p.data);assert.ok(held);held.success({statusCode:200,data:{realNameStatus:'FAILED'}});await old;assert.deepEqual(structuredClone(p.data),state);
});

test('contract capability preflight cannot return an earlier customers document after token rotation',async()=>{
 let held;const {contractRecord}=require('./fixtures/customer-contract-page.cjs'),record=contractRecord();const e=setup(signing,(route,o)=>{if(route==='/public/signing-config'){held=o;return true;}if(route.includes('/records/contracts/')){o.success({statusCode:200,data:record});return true;}});const result=e.api.getRecord('contracts',record.id),rejected=assert.rejects(result,{code:'SESSION_CHANGED'});await new Promise(setImmediate);e.storage.set(config.storageKey,{token:'replacement',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'replacement'}});held.success({statusCode:200,data:signing});await rejected;
});

for(const method of ['onWebMessage','refreshStatus'])test('allowed PENDING '+method+' keeps the current webview mounted without reload',async()=>{
 const e=setup({...signing,newOrderContractMode:'ESIGN',newEsignRequestsEnabled:true});await e.api.startSigning('contract','ct1');const p=e.page('sign');p.kind='contract';p.id='ct1';p._pageGeneration=1;p._statusRevision=0;await p.reload();const oldUrl=p.data.url;assert.ok(oldUrl);
 const updates=[],originalSet=p.setData;p.setData=function(value,done){updates.push(value);return originalSet.call(this,value,done);};let reloads=0;const originalReload=e.api.reloadSigningPage;e.api.reloadSigningPage=(...args)=>{reloads++;return originalReload(...args);};await p[method]();assert.equal(p.data.status,'PENDING');assert.equal(p.data.url,oldUrl);assert.equal(updates.some(value=>Object.prototype.hasOwnProperty.call(value,'url')&&value.url===''),false);assert.equal(reloads,0);
});

test('foreground return supersedes an in-flight message capability check before its old response can restore the webview',async()=>{
 const enabled={...signing,newOrderContractMode:'ESIGN',newEsignRequestsEnabled:true};let hold=false;const waiting=[];const e=setup(enabled,(route,o)=>{if(hold&&route==='/public/signing-config'){waiting.push(o);return true;}});await e.api.startSigning('contract','ct1');const p=e.page('sign');p.kind='contract';p.id='ct1';p._pageGeneration=1;p._statusRevision=0;await p.reload();hold=true;const old=p.onWebMessage();await new Promise(setImmediate);assert.ok(p.data.url);const foreground=p.onShow();await new Promise(setImmediate);assert.equal(p.data.url,'');assert.equal(waiting.length,2);waiting[0].success({statusCode:200,data:enabled});await old;assert.equal(p.data.url,'');assert.equal(p._checkingCapability,true);waiting[1].success({statusCode:200,data:signing});await foreground;assert.equal(p.data.url,'');assert.equal(e.calls.some(c=>c.route.endsWith('/sign-status')),false);
});
test('a delayed old webview remount cannot restore its URL during a newer foreground capability check',async()=>{
 const enabled={...signing,newOrderContractMode:'ESIGN',newEsignRequestsEnabled:true};let hold=false,held;const e=setup(enabled,(route,o)=>{if(hold&&route==='/public/signing-config'){held=o;return true;}});await e.api.startSigning('contract','ct1');const p=e.page('sign');p.kind='contract';p.id='ct1';p._pageGeneration=1;p._statusRevision=0;await p.reload();const callbacks=[];p.setData=function(value,done){Object.assign(this.data,value);if(done)callbacks.push(done);};p.reloadPage(p.data.url);assert.equal(callbacks.length,1);hold=true;const foreground=p.onShow();await new Promise(setImmediate);callbacks.shift()();assert.equal(p.data.url,'');held.success({statusCode:200,data:signing});await foreground;assert.equal(p.data.url,'');
});
