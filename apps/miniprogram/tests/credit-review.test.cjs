const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const document = { id: 'credit-doc-1', type: 'credit-verification', version: 1, title: '人工核验芝麻分及押金规则说明', content: '本地合成测试说明，非生产正文。' };
const review = (extra = {}) => ({ applicationId: 'a1', creditRevision: 1, ruleVersion: 'ZHIMA_MANUAL_V1', document, consent: null, verification: null, status: 'CONSENT_REQUIRED', canConsent: true, canDecline: true, consentRequirementsMet: true, canWithdraw: false, canVerify: false, canFinalize: false, verificationCurrent:false,canConfirmFinalPlan:false,depositMultiplier: null, ...extra });
const accepted = () => review({ creditRevision: 2, consent: { id: 'cc1', status: 'ACCEPTED', documentId: document.id, version: 1, acceptedAt: '2026-10-16T07:00:00Z', withdrawnAt: null }, status: 'AWAITING_VERIFICATION', canWithdraw: true, canVerify: true });
const verified = (band = 'GE750', multiplier = 0) => review({ ...accepted(), creditRevision: 3, verification: { id: 'cv1', band, verifiedBy: 'internal-reviewer', verifiedAt: '2026-10-16T08:00:00Z', consentId: 'cc1' }, status: multiplier == null ? 'MANUAL_REVIEW' : 'VERIFIED', verificationCurrent:true,canConfirmFinalPlan:multiplier!=null,depositMultiplier: multiplier });
function setup(extra = {}) {
  const memory = new Map([[config.storageKey, { token: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' }, consents: [{ documentId: 'privacy-v2', version: 2 }] }]]);
  const calls = [], phones = [], navigations = [];
  let state = extra.review || review(), failure = extra.failure;
  const platform = { getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value), removeStorageSync: key => memory.delete(key), showToast() {}, showModal: value => value.success({ confirm: true }), makePhoneCall: value => phones.push(value.phoneNumber), navigateTo: value => navigations.push(value.url), setNavigationBarTitle() {}, request(value) {
    calls.push(value); const route = value.url.replace(/^https:\/\/[^/]+\/api/, '');
    if (failure?.route === route) return value.success({ statusCode: failure.status, data: { error: { code: 'CONFLICT', message: '合成冲突或不可用' } } });
    let data;
    if (route === '/customer/applications/a1') data = { id: 'a1', status: extra.applicationStatus || 'IN_REVIEW', finalPlan: extra.finalPlan || null };
    else if (route === '/customer/applications/a1/credit-review') data = state;
    else if (route === '/customer/applications/a1/credit-consent') { state = value.data.decision === 'ACCEPT' ? accepted() : review({ creditRevision: 2, consent: { id: 'cc1', status: 'DECLINED', documentId: document.id, version: 1 }, status: 'MANUAL_REVIEW', canConsent: true }); data = state; }
    else if (route === '/customer/applications/a1/credit-consent/withdraw') { state = review({ creditRevision: 4, consent: { ...accepted().consent, status: 'WITHDRAWN', withdrawnAt: '2026-10-16T09:00:00Z' }, status: 'MANUAL_REVIEW' }); data = state; }
    else if (route === '/public/legal/credit-verification') data = document;
    else if (route.endsWith('/confirm')) data = { id: 'o1' };
    else throw new Error('Unexpected endpoint ' + route);
    value.success({ statusCode: 200, data });
  } };
  return { api: createApi(config, value => platform.request(value), platform), platform, memory, calls, phones, navigations, setReview: value => { state = value; }, setFailure: value => { failure = value; } };
}
function page(env, name = 'application-detail', options = { id: 'a1' }) {
  global.wx = env.platform; let definition; global.Page = value => { definition = value; };
  for (const file of ['../src/services/index', '../src/pages/' + name + '/index']) delete require.cache[require.resolve(file)];
  require('../src/pages/' + name + '/index');
  const result = { ...definition, data: structuredClone(definition.data), setData: function(value) { Object.assign(this.data, value); } };
  result.onLoad?.(options); return result;
}
test('credit review is authenticated and application scoped; display excludes exact score and evidence', async () => {
  const env = setup({ review: { ...verified(), score: 799, screenshot: 'private', evidence: 'private' } });
  const result = await env.api.getCreditReview('a1'); assert.equal(result.verification.band, 'GE750'); assert.equal(result.depositMultiplier, 0); assert.equal(result.score, undefined); assert.equal(result.verification.verifiedBy, undefined);
  assert.match(env.calls[0].header.Authorization, /^Bearer /); env.setReview(review({ applicationId: 'other' })); await assert.rejects(env.api.getCreditReview('a1'), { code: 'RESPONSE' });
  env.memory.clear(); await assert.rejects(env.api.getCreditReview('a1'), { code: 'AUTH_REQUIRED' });
});
test('credit consent uses a separate explicit decision and immutable visible document, excluding customer score fields', async () => {
  const env = setup(); await env.api.submitCreditConsent('a1', { documentId: document.id, version: 1, decision: 'ACCEPT', score: 799, verifiedBy: 'forged' });
  const body = env.calls.find(call => call.method === 'POST').data; assert.equal(body.decision, 'ACCEPT'); assert.equal(body.documentId, document.id); assert.equal(body.version, 1); assert.ok(body.idempotencyKey); assert.equal(body.score, undefined); assert.equal(body.verifiedBy, undefined);
});
test('unpublished/missing/changed credit document or disabled consent fails closed before posting', async () => {
  for (const state of [review({ document: null }), review({ document: { ...document, content: '' } }), review({ document: { ...document, type: 'privacy' } }), review({ document: { ...document, version: 2 } }), review({ canConsent: false })]) {
    const env = setup({ review: state }); await assert.rejects(env.api.submitCreditConsent('a1', { documentId: document.id, version: 1, decision: 'ACCEPT' })); assert.equal(env.calls.some(call => call.method === 'POST'), false);
  }
});
test('decline is explicit and never becomes acceptance; transient retry keeps the same idempotency key', async () => {
  const env = setup({ failure: { route: '/customer/applications/a1/credit-consent', status: 500 } });
  const payload = { documentId: document.id, version: 1, decision: 'DECLINE' }; await assert.rejects(env.api.submitCreditConsent('a1', payload)); env.setFailure(null); const result = await env.api.submitCreditConsent('a1', payload);
  const posts = env.calls.filter(call => call.method === 'POST'); assert.equal(posts[0].data.idempotencyKey, posts[1].data.idempotencyKey); assert.equal(result.consent.status, 'DECLINED'); assert.equal(result.status, 'MANUAL_REVIEW');
});
test('withdrawal binds the actual active consent and cannot withdraw another attempt', async () => {
  const env = setup({ review: accepted() }); await assert.rejects(env.api.withdrawCreditConsent('a1', { consentId: 'other' })); assert.equal(env.calls.some(call => call.method === 'POST'), false);
  const result = await env.api.withdrawCreditConsent('a1', { consentId: 'cc1' }); assert.equal(result.consent.status, 'WITHDRAWN'); assert.equal(result.canConfirmFinalPlan, false); assert.equal(env.calls.at(-1).data.consentId, 'cc1');
  const changed=setup({review:accepted()});changed.setReview({...accepted(),document:null,consentRequirementsMet:false,canConsent:false,status:'HISTORICAL'});assert.equal((await changed.api.withdrawCreditConsent('a1',{consentId:'cc1'})).consent.status,'WITHDRAWN');
});
test('all five operator bands show only ranges and server deposit rule; low/unverifiable never claim final eligibility', async () => {
  for (const [band, multiplier] of [['GE750', 0], ['B700_749', 1], ['B650_699', 2], ['LT650', null], ['UNVERIFIABLE', null]]) {
    const env = setup({ review: verified(band, multiplier) }); const result = await env.api.getCreditReview('a1'); assert.ok(result.bandText); assert.ok(result.depositRuleText); assert.equal(result.canConfirmFinalPlan, multiplier != null);
  }
});
test('application defaults separate credit acceptance off and opens the credit explanation, never credit uploads', async () => {
  const env = setup(); const p = page(env); await p.refresh(); assert.equal(p.data.creditAccepted, false); assert.equal(p.data.creditReview.status, 'CONSENT_REQUIRED');
  await p.acceptCreditConsent(); assert.equal(env.calls.some(call => call.method === 'POST'), false); p.openCreditExplanation(); assert.equal(env.navigations.at(-1), '/pages/legal/index?type=credit-verification'); assert.equal(p.chooseCreditScreenshot, undefined);
});
test('application consent and withdrawal refresh both application and credit state, clearing old final plan acceptance', async () => {
  const env = setup(); const p = page(env); await p.refresh(); p.setData({ creditAccepted: true, planRead: true }); await p.acceptCreditConsent(); assert.equal(p.data.creditReview.consent.status, 'ACCEPTED'); assert.equal(p.data.creditAccepted, false); assert.equal(p.data.planRead, false);
  p.setData({ planRead: true }); await p.withdrawCreditConsent(); assert.equal(p.data.creditReview.consent.status, 'WITHDRAWN'); assert.equal(p.data.planRead, false);
});
test('manual decline needs no acceptance checkbox and allows calling the actual public service number', async () => {
  const env = setup(); const p = page(env); await p.refresh(); await p.declineCreditConsent(); assert.equal(p.data.creditReview.consent.status, 'DECLINED'); assert.equal(p.data.creditAccepted, false); p.contactCreditService(); assert.equal(env.phones.at(-1), '18616570212');
});
test('credit failure is isolated from application readback and cannot authorize or confirm an old plan', async () => {
  const env = setup({ failure: { route: '/customer/applications/a1/credit-review', status: 503 } }); const p = page(env); await p.refresh(); assert.equal(p.data.application.id, 'a1'); assert.equal(p.data.error, ''); assert.equal(p.data.creditReview, null); assert.ok(p.data.creditError); p.setData({ creditAccepted: true }); await p.acceptCreditConsent(); assert.equal(env.calls.some(call => call.method === 'POST'), false);
});
test('credit legal page uses the dedicated published type instead of falling back to account terms', async () => {
  const env = setup(); const p = page(env, 'legal', { type: 'credit-verification' }); await p.reload(); assert.equal(p.type, 'credit-verification'); assert.equal(p.data.title, document.title); assert.equal(p.data.sections[0].text, document.content);
});
test('final confirmation is blocked when credit readback fails or its immutable verification snapshot differs', async () => {
  for(const state of [null, verified('LT650', null), verified(), verified('UNVERIFIABLE', null)]) {
    const env=setup();const p=page(env);p.setData({application:{id:'a1',status:'AWAITING_CONFIRMATION',finalPlan:{complete:true,revision:1,commercialHash:'hash',creditVerificationId:'cv-old',creditRuleVersion:'ZHIMA_MANUAL_V1',creditBand:'GE750',creditRevision:3}},creditReview:state,planRead:true});await p.confirmPlan();assert.equal(env.calls.some(call=>call.method==='POST'),false);
  }
});
test('consent requirements do not turn a manual decline or withdrawal into general login consent', async () => {
  const env=setup({review:review({canConsent:false,canDecline:true,consentRequirementsMet:false})});await assert.rejects(env.api.submitCreditConsent('a1',{documentId:document.id,version:1,decision:'ACCEPT'}));const result=await env.api.submitCreditConsent('a1',{documentId:document.id,version:1,decision:'DECLINE'});assert.equal(result.consent.status,'DECLINED');
});
test('credit submit is busy guarded and 409 clears acceptance then reloads authoritative state', async () => {
  const env=setup({failure:{route:'/customer/applications/a1/credit-consent',status:409}});const p=page(env);await p.refresh();p.setData({creditAccepted:true,planRead:true});await Promise.all([p.acceptCreditConsent(),p.acceptCreditConsent()]);assert.equal(env.calls.filter(call=>call.method==='POST').length,1);assert.equal(p.data.creditAccepted,false);assert.equal(p.data.planRead,false);assert.match(p.data.creditError,/冲突/);assert.equal(p.data.busy,false);
});
test('a current matching customer credit snapshot can confirm without any admin finalization permission', async () => {
  const env=setup({review:verified()});const p=page(env);await p.refresh();p.setData({application:{id:'a1',status:'AWAITING_CONFIRMATION',finalPlan:{complete:true,revision:1,commercialHash:'hash',creditVerificationId:'cv1',creditRuleVersion:'ZHIMA_MANUAL_V1',creditBand:'GE750',creditRevision:3}},planRead:true});await p.confirmPlan();assert.ok(env.calls.find(call=>call.method==='POST'&&call.url.endsWith('/confirm')),p.data.actionError);
});
test('historical review does not imply a confirmed contract or allow fresh authorization; withdrawal remains available', async () => {
  const env=setup({review:{...accepted(),status:'HISTORICAL',canConsent:true,canDecline:true}});const result=await env.api.getCreditReview('a1');assert.doesNotMatch(result.statusText,/已确认|合同/);assert.equal(result.canConsent,false);assert.equal(result.canDecline,false);assert.equal(result.canWithdraw,true);assert.equal(result.canConfirmFinalPlan,false);
});
test('an already current authorization is displayed as recorded and cannot accidentally reset its review by accepting twice',async()=>{
  const env=setup({review:accepted()});const p=page(env);await p.refresh();assert.equal(p.data.creditReview.consentCurrent,true);p.setData({creditAccepted:true});await p.acceptCreditConsent();assert.equal(env.calls.some(call=>call.method==='POST'),false);
});
test('a malformed or contradictory deposit multiplier cannot be displayed as a valid verified rule',async()=>{
  for(const state of [verified('GE750',1),verified('LT650',0),review({depositMultiplier:0}),verified('B700_749',3)]){const env=setup({review:state});await assert.rejects(env.api.getCreditReview('a1'),{code:'RESPONSE'});}
});
