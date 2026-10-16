const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const safe = (extra = {}) => ({ id: 'pv-1', amount: 1, currency: 'CNY', status: 'AUTHORIZED', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-10-16T00:00:00Z', canPay: true, title: '微信支付验收', ...extra });
const params = { timeStamp: '1792100000', nonceStr: 'synthetic-nonce', package: 'prepay_id=synthetic', signType: 'RSA', paySign: 'synthetic-private-signature' };
function setup(overrides = {}) {
  const storage = new Map(), calls = [], nativeCalls = [], toasts = [];
  let rows = overrides.rows ?? [safe()], result = overrides.result ?? safe({ status: 'PENDING' }), failure = overrides.failure, currentConsents = overrides.currentConsents ?? true;
  const documents = ['terms','privacy'].map(type => ({ id: type + '-1', type, version: 1, title: type, content: '当前正式文案' }));
  const consents = documents.map(doc => ({ documentId: doc.id, version: doc.version }));
  const session = { token: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1', name: '合成客户', mobile: '13800000000' }, consents };
  storage.set(config.storageKey, session);
  const platform = { getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),showToast:value=>toasts.push(value.title),setNavigationBarTitle(){},navigateTo(){},switchTab(){},requestPayment(value){nativeCalls.push(value);if(overrides.native)overrides.native(value);else value.success({});},request(value){
    calls.push(value);const route=value.url.replace(/^https:\/\/[^/]+\/api/,'');let data={};
    if(failure?.route===route)return value.success({statusCode:failure.status,data:{error:{code:failure.code||'PROVIDER_ERROR',message:'合成接口错误'}}});
    if(route.startsWith('/public/legal/'))data=documents.find(doc=>route.endsWith('/'+doc.type));
    else if(route==='/customer/context')data={customer:session.customer,consents:currentConsents?consents:[]};
    else if(route==='/customer/esign/readiness')data={readyForSigning:false};
    else if(route==='/customer/payment-verifications')data={items:rows};
    else if(route==='/customer/payment-verifications/pv-1/pay')data={verification:safe({status:'PENDING',canPay:false,...overrides.paySafe}),paymentParams:overrides.params||params};
    else if(route==='/customer/payment-verifications/pv-1/query')data=result;
    else throw new Error('Unexpected endpoint: '+route);
    value.success({statusCode:200,data});
  }};
  const api=createApi(config,value=>platform.request(value),platform);
  return{api,storage,calls,nativeCalls,platform,toasts,setRows:value=>{rows=value;},setResult:value=>{result=value;},setFailure:value=>{failure=value;}};
}
function page(env){global.wx=env.platform;let definition;global.Page=value=>{definition=value;};for(const file of ['../src/services/index','../src/pages/settings/index'])delete require.cache[require.resolve(file)];require('../src/pages/settings/index');return{...definition,data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};}
const click={currentTarget:{dataset:{id:'pv-1'}}};
test('payment verification list is authenticated, scoped and strips native credentials from display values',async()=>{
  const env=setup({rows:[safe({paymentParams:params,openid:'must-not-leak'})]});
  const rows=await env.api.getPaymentVerifications();assert.equal(rows.length,1);assert.equal(rows[0].paymentParams,undefined);assert.equal(rows[0].openid,undefined);
  env.storage.clear();await assert.rejects(env.api.getPaymentVerifications(),{code:'AUTH_REQUIRED'});assert.equal(env.calls.length,1);
});
test('native success cannot mark verification paid until authoritative server query says SUCCEEDED',async()=>{
  const env=setup();const result=await env.api.payPaymentVerification('pv-1');
  assert.equal(result.verification.status,'PENDING');assert.doesNotMatch(result.message,/支付成功/);assert.equal(env.nativeCalls.length,1);
  assert.equal(env.calls.at(-1).url.endsWith('/pv-1/query'),true);assert.equal(env.calls.at(-1).method,'POST');
  assert.equal(JSON.stringify([...env.storage.values()]).includes(params.paySign),false);assert.equal(JSON.stringify(result).includes(params.paySign),false);
});
test('native cancellation queries the same record and never closes or automatically pays again',async()=>{
  const env=setup({native:value=>value.fail({errMsg:'requestPayment:fail cancel'})});
  const result=await env.api.payPaymentVerification('pv-1');assert.equal(result.nativeOutcome,'CANCELLED');assert.equal(result.verification.status,'PENDING');
  assert.equal(env.calls.filter(call=>call.url.endsWith('/pay')).length,1);assert.equal(env.calls.some(call=>call.url.endsWith('/close')),false);
  env.setRows([safe({status:'PENDING'})]);await assert.rejects(env.api.payPaymentVerification('pv-1'),{code:'PAYMENT_VERIFICATION_QUERY_REQUIRED'});assert.equal(env.nativeCalls.length,1);
  env.setResult(safe({status:'SUCCEEDED',canPay:false}));const resumed=await env.api.payPaymentVerification('pv-1',{resume:true});assert.equal(resumed.verification.status,'SUCCEEDED');
});
test('native failure still trusts a SUCCEEDED server result; query failure never becomes success',async()=>{
  const paid=setup({native:value=>value.fail({errMsg:'requestPayment:fail'}),result:safe({status:'SUCCEEDED',canPay:false})});assert.equal((await paid.api.payPaymentVerification('pv-1')).verification.status,'SUCCEEDED');
  const unknown=setup({failure:{route:'/customer/payment-verifications/pv-1/query',status:500}});await assert.rejects(unknown.api.payPaymentVerification('pv-1'),{code:'PAYMENT_VERIFICATION_QUERY_REQUIRED'});
});
test('native failure without an SDK payload still queries; terminal query results are explicit and cannot be resumed',async()=>{
  const unknown=setup({native:value=>value.fail()});const result=await unknown.api.payPaymentVerification('pv-1');assert.equal(result.verification.status,'PENDING');assert.equal(unknown.calls.at(-1).url.endsWith('/query'),true);
  const expired=setup({result:safe({status:'EXPIRED',canPay:true})});const terminal=await expired.api.payPaymentVerification('pv-1');assert.equal(terminal.verification.canPay,false);assert.match(terminal.message,/过期/);assert.doesNotMatch(terminal.message,/待确认/);
});
test('wrong amount/currency, expiry, terminal states, missing ownership and stale consent never invoke native pay',async()=>{
  for(const row of [safe({amount:2}),safe({currency:'USD'}),safe({expiresAt:'2020-01-01T00:00:00Z'}),...['SUCCEEDED','CLOSED','FAILED','EXPIRED'].map(status=>safe({status,canPay:true}))]){
    const env=setup({rows:[row]});await assert.rejects(env.api.payPaymentVerification('pv-1'));assert.equal(env.nativeCalls.length,0);assert.equal(env.calls.some(call=>call.url.endsWith('/pay')),false);
  }
  const missing=setup({rows:[]});await assert.rejects(missing.api.payPaymentVerification('pv-1'),{code:'PAYMENT_VERIFICATION_NOT_AUTHORIZED'});
  const stale=setup({currentConsents:false});await assert.rejects(stale.api.payPaymentVerification('pv-1'),{code:'CONSENT_REQUIRED'});assert.equal(stale.nativeCalls.length,0);
});
test('409 pay refreshes server state; rate/server/permission errors and malformed native parameters remain failures',async()=>{
  const closed=setup({failure:{route:'/customer/payment-verifications/pv-1/pay',status:409},result:safe({status:'CLOSED',canPay:false})});assert.equal((await closed.api.payPaymentVerification('pv-1')).verification.status,'CLOSED');assert.equal(closed.nativeCalls.length,0);
  for(const status of [500,429,403]){const env=setup({failure:{route:'/customer/payment-verifications/pv-1/pay',status}});await assert.rejects(env.api.payPaymentVerification('pv-1'),{statusCode:status});assert.equal(env.nativeCalls.length,0);}
  const malformed=setup({params:{...params,signType:'MD5'}});await assert.rejects(malformed.api.payPaymentVerification('pv-1'),{code:'RESPONSE'});assert.equal(malformed.nativeCalls.length,0);
});
test('a second pay call cannot reenter an active native confirmation',async()=>{
  let resolveNative;const env=setup({native:value=>{resolveNative=value.success;}});const pending=env.api.payPaymentVerification('pv-1');
  for(let i=0;i<20&&!resolveNative;i++)await new Promise(resolve=>setTimeout(resolve,1));
  await assert.rejects(env.api.payPaymentVerification('pv-1'),{code:'PAYMENT_VERIFICATION_BUSY'});resolveNative({});await pending;assert.equal(env.nativeCalls.length,1);
});
test('settings hides verification completely for anonymous customers and customers without authorization',async()=>{
  const anonymous=setup();anonymous.storage.clear();const p=page(anonymous);await p.refresh();assert.deepEqual(p.data.paymentVerifications,[]);assert.equal(anonymous.calls.some(call=>call.url.includes('/payment-verifications')),false);
  const empty=setup({rows:[]});const q=page(empty);await q.refresh();assert.deepEqual(q.data.paymentVerifications,[]);
});
test('settings refresh after login or consent still loads authorization while the account action is busy',async()=>{
  const env=setup();const p=page(env);p.data.busy=true;await p.refresh();assert.equal(p.data.paymentVerifications.length,1);assert.equal(p.data.paymentVerifications[0].id,'pv-1');
});
test('settings requires current consent, prevents reentry, queries pending records and clears stale resume permission on query failure',async()=>{
  const stale=setup({currentConsents:false});const blocked=page(stale);await blocked.refresh();await blocked.payVerification(click);assert.equal(stale.nativeCalls.length,0);
  let resolveNative;const env=setup({native:value=>{resolveNative=value.success;},result:safe({status:'PENDING',canPay:true})});const p=page(env);await p.refresh();assert.equal(p.data.paymentVerifications[0].canStart,true);
  const first=p.payVerification(click);await p.payVerification(click);for(let i=0;i<20&&!resolveNative;i++)await new Promise(resolve=>setTimeout(resolve,1));resolveNative({});await first;
  assert.equal(env.nativeCalls.length,1);assert.equal(p.data.paymentVerifications[0].canStart,false);assert.doesNotMatch(p.data.verificationMessage,/支付成功/);
  await p.queryVerification(click);assert.equal(p.data.paymentVerifications[0].canStart,true);assert.equal(p.data.paymentVerifications[0].resumeAllowed,true);
  env.setFailure({route:'/customer/payment-verifications/pv-1/query',status:429});await p.queryVerification(click);assert.equal(p.data.paymentVerifications[0].canStart,false);assert.equal(p.data.paymentVerifications[0].resumeAllowed,false);assert.ok(p.data.verificationError);
  assert.equal(JSON.stringify(p.data).includes(params.paySign),false);assert.equal(p.data.busy,false);
});
test('settings shows success only from SUCCEEDED and never enables any terminal record',async()=>{
  const env=setup({result:safe({status:'SUCCEEDED',canPay:false})});const p=page(env);await p.refresh();await p.payVerification(click);assert.match(p.data.verificationMessage,/支付成功/);assert.equal(p.data.paymentVerifications[0].canStart,false);
  for(const status of ['CLOSED','FAILED','EXPIRED']){env.setRows([safe({status,canPay:true})]);await p.refreshPaymentVerifications();assert.equal(p.data.paymentVerifications[0].canStart,false);}
});
test('expired unknown channel orders display the server manual-review warning without asserting no debit',async()=>{
  const statusMessage='授权已到期，渠道暂未查到本单，需人工核对；不能认定未扣款。';
  const expired=safe({status:'EXPIRED',canPay:false,manualReviewRequired:true,statusMessage});
  const env=setup({result:expired});const result=await env.api.payPaymentVerification('pv-1');assert.equal(result.verification.manualReviewRequired,true);assert.equal(result.verification.statusMessage,statusMessage);assert.equal(result.message,statusMessage);
  const p=page(env);await p.refresh();await p.queryVerification(click);assert.equal(p.data.verificationMessage,statusMessage);assert.equal(p.data.paymentVerifications[0].canStart,false);assert.equal(p.data.paymentVerifications[0].manualReviewRequired,true);
});
