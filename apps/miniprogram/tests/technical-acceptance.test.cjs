const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createApi } = require('../src/services/api'), config = require('../src/config');
const { document, detail, summary, confirmInput, ready } = require('./fixtures/technical-acceptance.cjs');
const signingConfig = { mode: 'MINIAPP_WEBVIEW', enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com','realnameverify16.fadada.com'], returnUrl: 'https://mini-api.subauto.keybox.cloud/api/public/esign-return' };
function setup(extra = {}) {
  let value = extra.value || detail(), fail = null; const calls = [], opened = [], navigations = [], storage = new Map([[config.storageKey,{token:'token-a',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'c1'}}]]);
  const platform = { getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),navigateTo:v=>{navigations.push(v.url);v.success({});},showToast(){},showModal:v=>v.success({confirm:true}),downloadFile:v=>{if(extra.download)return extra.download(v);v.success({statusCode:200,tempFilePath:'/synthetic/local.pdf'});},openDocument:v=>{opened.push(v.filePath);v.success({});},request(v) {
    const route = v.url.replace(/^https:\/\/[^/]+\/api/,''); calls.push({route,method:v.method,data:v.data}); if(extra.intercept?.(route,v))return;
    if(fail)return v.success({statusCode:fail,data:{error:{code:'SYNTHETIC_ERROR',message:'合成失败'}}});
    let data;if(route==='/public/signing-config')data=extra.config||signingConfig;else if(route==='/customer/technical-acceptances')data={items:extra.items||[summary()]};else if(route.endsWith('/confirm')){value=detail({revision:2,status:'CONFIRMED',confirmedAt:'2026-10-16T12:01:00Z',canConfirm:false});data=value;}else if(route.endsWith('/sign'))data={taskId:'task1',status:'PENDING',url:extra.url||'https://textapi17.fadada.com/api2/technical?opaque=synthetic'};else if(route.endsWith('/stop')){value={...value,revision:value.revision+1,status:'STOPPED',stoppedAt:'2026-10-16T12:02:00Z',canSign:false,canConfirm:false,canStop:false};data=value;}else if(route.endsWith('/sync'))data=extra.sync||value;else if(route==='/customer/auth/logout')data={};else data=value;
    v.success({statusCode:200,data});
  } };
  return { api:createApi(config,v=>platform.request(v),platform),platform,calls,storage,opened,navigations,set:v=>{value=v;},fail:v=>{fail=v;} };
}
test('technical list and detail are authenticated and customer-scoped, with resolved full text and safe fields only', async () => {
  const env=setup({value:{...detail(),idCardNo:'never-display',providerRaw:{secret:'never-display'},url:'https://evil.invalid/'}});
  const items=await env.api.getTechnicalAcceptances();assert.equal(items.length,1);assert.equal(items[0].document.content,undefined);
  const value=await env.api.getTechnicalAcceptance('ta1');assert.equal(value.document.content,document.content);assert.equal(value.idCardNo,undefined);assert.equal(value.url,undefined);
  env.set(detail({customerId:'another'}));await assert.rejects(env.api.getTechnicalAcceptance('ta1'));env.storage.clear();await assert.rejects(env.api.getTechnicalAcceptances(),{code:'AUTH_REQUIRED'});
});
test('empty assigned list stays empty and missing document, unresolved variables or wrong type fails closed before confirmation', async () => {
  const env=setup({items:[]});assert.deepEqual(await env.api.getTechnicalAcceptances(),[]);
  for(const doc of [null,{...document,content:'{{participantName}}'},{...document,type:'subscription'}]){env.set(detail({document:doc}));await assert.rejects(env.api.confirmTechnicalAcceptance('ta1',confirmInput()));}
  assert.equal(env.calls.some(v=>v.method==='POST'),false);
});
test('confirmation requires explicit full reading and separate current data consent with exactly displayed revision and three hashes', async () => {
  for(const payload of [{...confirmInput(),read:false},{...confirmInput(),consent:{...confirmInput().consent,accepted:false}},{...confirmInput(),bodyHash:'f'.repeat(64)},{...confirmInput(),revision:0},{...confirmInput(),consent:{...confirmInput().consent,privacyVersion:1}}]){const env=setup();await assert.rejects(env.api.confirmTechnicalAcceptance('ta1',payload));assert.equal(env.calls.some(v=>v.method==='POST'),false);}
  const env=setup();await env.api.confirmTechnicalAcceptance('ta1',confirmInput());const call=env.calls.find(v=>v.route.endsWith('/confirm'));assert.equal(call.data.read,undefined);assert.equal(call.data.bodyHash,document.bodyHash);assert.equal(call.data.consent.accepted,true);assert.ok(call.data.idempotencyKey);
});
test('closed switch, stopped record or missing independent double approval cannot start a signing task', async () => {
  for(const value of [ready({enabled:false}),ready({stoppedAt:'2026-10-16T12:02:00Z',status:'STOPPED'}),ready({approval:null}),ready({approval:{...ready().approval,approverId:'admin1'}})]){const env=setup({value});await assert.rejects(env.api.signTechnicalAcceptance('ta1'));assert.equal(env.calls.some(v=>v.route.endsWith('/sign')),false);}
});
test('independent technical sign uses native exact-host gate and only its route, keeping opaque URL out of persisted storage', async () => {
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');const call=env.calls.find(v=>v.route.endsWith('/sign'));assert.equal(call.route,'/customer/technical-acceptances/ta1/sign');assert.equal(call.data.revision,3);assert.ok(env.navigations[0].includes('kind=technical-acceptance'));assert.equal(JSON.stringify([...env.storage.values()]).includes('opaque'),false);assert.ok(env.api.getSigningTask('technical-acceptance','ta1').url);
  for(const url of ['https://evil.invalid/sign','https://textapi17.fadada.com:443/sign']){const other=setup({value:ready(),url});await assert.rejects(other.api.signTechnicalAcceptance('ta1'));assert.equal(other.navigations.length,0);}
});
test('passive sign-status is DB GET-only while explicit sync uses current revision; signed requires archived file', async () => {
  const env=setup({value:ready(),sync:ready({status:'SIGNED',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false})});assert.equal((await env.api.getSignStatus('ta1','technical-acceptance')).status,'DRAFT');assert.equal(env.calls.some(v=>v.method==='POST'),false);
  const result=await env.api.syncTechnicalAcceptance('ta1');assert.equal(result.signatureStatus,'SIGNED');assert.equal(env.calls.find(v=>v.route.endsWith('/sync')).data.revision,3);
  env.set(ready({status:'SIGNED',signatureStatus:'SIGNED',signedFileId:null}));await assert.rejects(env.api.getSignStatus('ta1','technical-acceptance'));
});
test('stopping clears only this in-memory entry and cannot claim provider cancellation; late archived signatures remain visible independently', async () => {
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');const stopped=await env.api.stopTechnicalAcceptance('ta1');assert.equal(stopped.status,'STOPPED');assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');await assert.rejects(env.api.signTechnicalAcceptance('ta1'));
  env.set(ready({status:'STOPPED',stoppedAt:'2026-10-16T12:02:00Z',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false}));const state=await env.api.getSignStatus('ta1','technical-acceptance');assert.equal(state.status,'SIGNED');assert.ok(state.stoppedAt);
});
test('unknown confirm responses retry with the same original key and malformed or conflict results never imply success', async () => {
  const env=setup();env.fail(500);await assert.rejects(env.api.confirmTechnicalAcceptance('ta1',confirmInput())); // first read cannot authorize
  env.fail(null);let unknown=true;const calls=[];const other=setup({intercept:(route,v)=>{if(route.endsWith('/confirm')){calls.push(v.data);if(unknown){v.fail({errMsg:'synthetic network'});return true;}}}});
  await assert.rejects(other.api.confirmTechnicalAcceptance('ta1',confirmInput()));unknown=false;await other.api.confirmTechnicalAcceptance('ta1',confirmInput());assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
});
test('late detail/sign replies after account or same-customer token change cannot expose body or open the old signing URL', async () => {
  for(const next of [{id:'other',token:'b'},{id:'c1',token:'rotated'},null])for(const action of ['get','sign']){let delayed;const env=setup({value:ready(),intercept:(route,v)=>{if(route.endsWith(action==='sign'?'/sign':'/ta1')){delayed=v;return true;}}});const promise=action==='sign'?env.api.signTechnicalAcceptance('ta1'):env.api.getTechnicalAcceptance('ta1');const rejected=assert.rejects(promise);await new Promise(setImmediate);assert.ok(delayed);if(next)env.storage.set(config.storageKey,{token:next.token,expiresAt:'2099-01-01T00:00:00Z',customer:{id:next.id}});else env.storage.clear();delayed.success({statusCode:200,data:action==='sign'?{taskId:'old',status:'PENDING',url:'https://textapi17.fadada.com/old'}:ready()});await rejected;assert.equal(env.navigations.length,0);}
});
test('private source/signed files must belong to freshly read record and switching session during download cannot open the PDF', async () => {
  let download;const env=setup({download:v=>{download=v;}});await assert.rejects(env.api.openTechnicalAcceptanceFile('ta1','another-file'));assert.equal(download,undefined);
  const pending=env.api.openTechnicalAcceptanceFile('ta1','source1');const rejected=assert.rejects(pending);await new Promise(setImmediate);assert.ok(download);env.storage.set(config.storageKey,{token:'another-token',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'another'}});download.success({statusCode:200,tempFilePath:'/old-customer.pdf'});await rejected;assert.equal(env.opened.length,0);
});
function page(env,name,options={id:'ta1'}) {
  let definition; const utilities = { load: require('../src/utils/page').load, toastError() {}, confirm: async()=>true, go:url=>env.navigations.push(url) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages/'+name+'/index.js'),'utf8'),{Page:v=>{definition=v;},require:id=>id.includes('services')?env.api:id.includes('config')?config:utilities,wx:env.platform,clearInterval(){}});
  const p={...definition,data:structuredClone(definition.data),setData:v=>Object.assign(p.data,v)};if(name==='technical-acceptance'){p.id=options.id;p._pageGeneration=1;}else if(name==='sign'){p.id=options.id;p.kind='technical-acceptance';p._pageGeneration=1;p.setData({kind:p.kind});}return p;
}
test('assigned settings entry is read-only and hides entirely with no records or no login',async()=>{
  const env=setup(),p=page(env,'settings');await p.refreshTechnicalAcceptances();assert.equal(p.data.technicalAcceptances.length,1);assert.equal(env.calls.some(v=>v.method==='POST'),false);
  const empty=page(setup({items:[]}),'settings');await empty.refreshTechnicalAcceptances();assert.equal(empty.data.technicalAcceptances.length,0);env.storage.clear();await p.refreshTechnicalAcceptances();assert.equal(p.data.technicalAcceptances.length,0);
});
test('detail starts both choices unchecked and cannot confirm without current reading plus independent data choice',async()=>{
  const env=setup(),p=page(env,'technical-acceptance');await p.reload();assert.equal(p.data.documentRead,false);assert.equal(p.data.dataAccepted,false);await p.confirmDocument();assert.equal(env.calls.some(v=>v.method==='POST'),false);
  p.onDocumentRead({detail:{value:['read']}});p.onDataConsent({detail:{value:['data']}});await p.confirmDocument();assert.ok(env.calls.some(v=>v.route.endsWith('/confirm')));assert.equal(p.data.documentRead,false);assert.equal(p.data.dataAccepted,false);
});
test('detail onShow and webview message never POST a supplier query; explicit verification uses only technical sync',async()=>{
  const env=setup({value:ready()}),p=page(env,'technical-acceptance');await p.onShow();assert.equal(env.calls.some(v=>v.method==='POST'),false);await p.syncSignature();assert.equal(env.calls.filter(v=>v.method==='POST').length,1);assert.ok(env.calls.at(-2).route.endsWith('/sync')||env.calls.at(-1).route.endsWith('/sync'));
  const sign=page(env,'sign');await sign.onShow();await sign.onWebMessage({detail:{data:[{status:'SIGNED'}]}});assert.equal(env.calls.filter(v=>v.method==='POST').length,1);assert.notEqual(sign.data.status,'SIGNED');await sign.refreshStatus();assert.equal(env.calls.filter(v=>v.route.endsWith('/sync')).length,2);
});
test('stopped late signed page shows both archived fact and stopping without reopening a task or commercial success',async()=>{
  const env=setup({value:ready({status:'STOPPED',stoppedAt:'2026-10-16T12:02:00Z',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false})}),p=page(env,'technical-acceptance');await p.reload();assert.equal(p.data.record.signatureCompleted,true);assert.ok(p.data.record.stoppedAt);await p.signDocument();assert.equal(env.navigations.length,0);
});
test('late page detail after account change or unload cannot render old personal body',async()=>{
  for(const action of ['switch','unload']){let delayed;const env=setup({intercept:(route,v)=>{if(route.endsWith('/ta1')){delayed=v;return true;}}}),p=page(env,'technical-acceptance');const pending=p.reload();await new Promise(setImmediate);if(action==='switch')env.storage.set(config.storageKey,{token:'other',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'other'}});else p.onUnload();delayed.success({statusCode:200,data:detail()});await pending;assert.equal(p.data.record,null);}
});
test('closing the independent switch makes a cached technical short URL unavailable even though ordinary native mode remains enabled',async()=>{
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');env.set(ready({enabled:false,canSign:false}));const p=page(env,'sign');await p.reload();await p.onShow();assert.equal(p.data.url,'');assert.equal(p.data.enabled,false);assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');
});
test('an unknown stop invalidates the old entry and a record-level busy lease prevents concurrent supplier actions',async()=>{
  let delayed;const env=setup({value:ready(),intercept:(route,v)=>{if(route.endsWith('/stop')){delayed=v;return true;}}});await env.api.signTechnicalAcceptance('ta1');const pending=env.api.stopTechnicalAcceptance('ta1'),rejected=assert.rejects(pending);await new Promise(setImmediate);assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');await assert.rejects(env.api.syncTechnicalAcceptance('ta1'),{code:'TECHNICAL_BUSY'});delayed.fail({});await rejected;
});
test('a passive read after independent shutdown clears an already rendered webview without a supplier query',async()=>{
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');const p=page(env,'sign');await p.reload();assert.ok(p.data.url);env.set(ready({enabled:false,canSign:false}));const before=env.calls.filter(v=>v.method==='POST').length;await p.onShow();assert.equal(p.data.url,'');assert.equal(p.data.enabled,false);assert.equal(env.calls.filter(v=>v.method==='POST').length,before);
});
test('signing execution disabled still allows server-authorized document confirmation without any sign or provider call',async()=>{
  const env=setup({value:detail({enabled:false,canConfirm:true})});await env.api.confirmTechnicalAcceptance('ta1',confirmInput());assert.ok(env.calls.some(v=>v.route.endsWith('/confirm')));assert.equal(env.calls.some(v=>v.route.endsWith('/sign')||v.route.includes('/esign/')),false);
});
test('actual source PDF SHA stays distinct from the business document hash and missing PDF evidence cannot confirm',async()=>{
  const env=setup();const value=await env.api.getTechnicalAcceptance('ta1');assert.equal(value.document.sourcePdfHash,document.sourcePdfHash);assert.notEqual(value.document.documentHash,value.document.sourcePdfHash);env.set(detail({document:{...document,sourcePdfHash:null}}));await assert.rejects(env.api.confirmTechnicalAcceptance('ta1',confirmInput()));assert.equal(env.calls.some(v=>v.method==='POST'),false);
});
test('old general privacy consent guides existing settings and back to fresh explicit choices, never redoing identity or silently accepting',async()=>{
  const env=setup({value:detail({consentRequirementsMet:false,canConfirm:false})}),p=page(env,'technical-acceptance');await p.reload();assert.equal(p.data.consentUpdateRequired,true);p.openSettings();assert.ok(env.navigations.at(-1).includes('/pages/settings/index'));assert.equal(env.calls.some(v=>v.method==='POST'),false);
  env.set(detail());await p.onShow();assert.equal(p.data.consentUpdateRequired,false);assert.equal(p.data.documentRead,false);assert.equal(p.data.dataAccepted,false);p.onDocumentRead({detail:{value:['read']}});p.onDataConsent({detail:{value:['data']}});await p.confirmDocument();assert.ok(env.calls.some(v=>v.route.endsWith('/confirm')));assert.equal(env.calls.some(v=>v.route.includes('/esign/')),false);
});
test('an authoritative stale-consent conflict clears both choices and points to account updates without automatic consent writes',async()=>{
  const env=setup({intercept:(route,v)=>{if(route.endsWith('/confirm')){v.success({statusCode:409,data:{error:{code:'CONSENT_REQUIRED',message:'先阅读当前协议'}}});return true;}}}),p=page(env,'technical-acceptance');await p.reload();p.onDocumentRead({detail:{value:['read']}});p.onDataConsent({detail:{value:['data']}});await p.confirmDocument();assert.equal(p.data.consentUpdateRequired,true);assert.equal(p.data.documentRead,false);assert.equal(p.data.dataAccepted,false);assert.match(p.data.error,/账户设置/);assert.equal(env.calls.some(v=>v.route==='/customer/consents'||v.route.includes('/esign/')),false);
});
test('foreground recovery reads a stopped technical fact without an artificial session-change error or new task',async()=>{
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');env.set(ready({status:'STOPPED',stoppedAt:'2026-10-16T12:02:00Z',canSign:false}));const before=env.calls.filter(v=>v.method==='POST').length;const result=await env.api.resumeSigning();assert.equal(result.status,'CLOSED');assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');assert.equal(env.calls.filter(v=>v.method==='POST').length,before);
});
test('lawful independent purge keeps historical signature fact but never claims a missing archived PDF is still available',async()=>{
  const env=setup({value:ready({status:'PURGED',retentionStatus:'PURGED',document:null,signatureStatus:'SIGNED',sourceFileId:null,signedFileId:null,canSign:false,canSync:false,canStop:false})});const value=await env.api.getTechnicalAcceptance('ta1');assert.equal(value.status,'PURGED');assert.equal(value.signatureStatus,'SIGNED');assert.equal(value.signatureCompleted,false);assert.equal((await env.api.getSignStatus('ta1','technical-acceptance')).status,'CLOSED');
});
test('logout invalidates an in-flight private download even if a subsequent synthetic login reuses the same token',async()=>{
  let download;const env=setup({download:v=>{download=v;}}),original=env.storage.get(config.storageKey);const pending=env.api.openTechnicalAcceptanceFile('ta1','source1'),rejected=assert.rejects(pending);await new Promise(setImmediate);await env.api.logout();env.storage.set(config.storageKey,original);download.success({statusCode:200,tempFilePath:'/prior-session.pdf'});await rejected;assert.equal(env.opened.length,0);
});
test('a late 401 from public signing configuration cannot expire a newer authenticated customer session',async()=>{
  let delayed;const env=setup({value:ready(),intercept:(route,v)=>{if(route==='/public/signing-config'){delayed=v;return true;}}});const request=env.api.signTechnicalAcceptance('ta1'),rejected=assert.rejects(request);await new Promise(setImmediate);env.storage.set(config.storageKey,{token:'new-session',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'other'}});delayed.success({statusCode:401,data:{error:{code:'PUBLIC_UNAVAILABLE',message:'合成公共接口错误'}}});await rejected;assert.equal(env.api.getContext().authenticated,true);assert.equal(env.api.getContext().customer.id,'other');assert.equal(env.navigations.length,0);
});
test('a general-consent change after the page was displayed is detected by fresh preflight and points to settings before any confirmation POST',async()=>{
  const env=setup(),p=page(env,'technical-acceptance');await p.reload();p.onDocumentRead({detail:{value:['read']}});p.onDataConsent({detail:{value:['data']}});env.set(detail({consentRequirementsMet:false,canConfirm:false}));await p.confirmDocument();assert.equal(p.data.consentUpdateRequired,true);assert.match(p.data.error,/账户设置/);assert.equal(env.calls.some(v=>v.method==='POST'),false);
});
test('onShow during a document mutation cannot let an older GET overwrite its later confirmed revision',async()=>{
  let post,oldGet,inMutation=false,passiveReads=0;const env=setup({intercept:(route,v)=>{if(route.endsWith('/confirm')){post=v;inMutation=true;return true;}if(inMutation&&route.endsWith('/ta1')){passiveReads++;oldGet=v;return true;}}}),p=page(env,'technical-acceptance');await p.reload();p.onDocumentRead({detail:{value:['read']}});p.onDataConsent({detail:{value:['data']}});const action=p.confirmDocument();await new Promise(setImmediate);assert.ok(post);const passive=p.onShow();post.success({statusCode:200,data:detail({revision:2,status:'CONFIRMED',confirmedAt:'2026-10-16T12:01:00Z',canConfirm:false})});await action;if(oldGet)oldGet.success({statusCode:200,data:detail()});await passive;assert.equal(p.data.record.revision,2);assert.equal(p.data.record.status,'CONFIRMED');assert.equal(passiveReads,0);assert.equal(p.data.busy,false);
});
test('a freshly archived technical record cannot reopen a previously pending short URL during entry reload',async()=>{
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');env.set(ready({status:'SIGNED',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false}));const p=page(env,'sign');await p.reload();assert.equal(p.data.url,'');assert.equal(p.data.status,'SIGNED');assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');
});
test('explicit authoritative archived sync immediately forgets the former pending entry',async()=>{
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');env.set(ready({status:'SIGNED',signatureStatus:'SIGNED',signedFileId:'signed1',canSign:false}));await env.api.syncTechnicalAcceptance('ta1');assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');
});
test('an expired approval cannot reopen the cached technical entry even before the next explicit signing request',async()=>{
  const env=setup({value:ready()});await env.api.signTechnicalAcceptance('ta1');env.set(ready({canSign:false,approval:{...ready().approval,expiresAt:'2020-01-01T00:00:00Z'}}));const p=page(env,'sign');await p.reload();assert.equal(p.data.url,'');assert.equal(env.api.getSigningTask('technical-acceptance','ta1').url,'');assert.equal(p.data.enabled,true);
});
test('approval hashes use the existing canonical sha256 prefix and malformed plans never authorize signing',async()=>{
  const env=setup({value:ready({approval:{...ready().approval,planHash:'sha256:'+'d'.repeat(64)}})});assert.equal((await env.api.getTechnicalAcceptance('ta1')).canSign,true);
  for(const planHash of ['d'.repeat(64),'sha256:bad','md5:'+'d'.repeat(64),'sha256:'+'g'.repeat(64)]){env.set(ready({approval:{...ready().approval,planHash}}));await assert.rejects(env.api.signTechnicalAcceptance('ta1'));assert.equal(env.calls.some(v=>v.route.endsWith('/sign')),false);}
});
module.exports={setup,signingConfig};
