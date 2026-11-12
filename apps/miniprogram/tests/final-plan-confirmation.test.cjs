const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceRoot = path.resolve(process.env.MINIAPP_SOURCE_ROOT || path.join(__dirname, '../src'));
const { createApi } = require(path.join(sourceRoot, 'services/api'));
const config = require(path.join(sourceRoot, 'config'));
const { renderPage } = require('./helpers/wxml-view.cjs');
const terms = Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(key => [key, '离线合成完整约定']));
const policy = { policyVersion: 'USAGE_V1', documentId: 'usage-1', documentVersion: 1, hash: 'a'.repeat(64), content: '离线合成已批准里程规则', baseAllowanceKm: 1500, excessPriceAmount: 150 };
const finalPlan = () => ({ revision: 1, commercialHash: 'commercial-hash', creditVerificationId: 'cv1', creditRuleVersion: 'ZHIMA_MANUAL_V1', creditBand: 'GE750', creditRevision: 2, monthlyFeeAmount: 1, depositAmount: 0, months: 12, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '充电自理', benefits: [], conditions: '合成的完整逐单约定', startDate: '2026-11-01', firstDueDate: '2026-10-26', commercialTerms: terms, usagePolicyVersion: 'USAGE_V1', usagePolicy: structuredClone(policy), lessorHash: 'lessor-hash', lessorSnapshot: { name: '离线企业', sharingNotice: { content: '离线资料提供说明', contentHash: 'sharing-hash' } } });
const credit = () => ({ applicationId: 'a1', creditRevision: 2, ruleVersion: 'ZHIMA_MANUAL_V1', document: { id: 'credit-1', type: 'credit-verification', version: 1, title: '合成信用核验说明', content: '合成说明' }, consent: { id: 'cc1', status: 'ACCEPTED', documentId: 'credit-1', version: 1 }, verification: { id: 'cv1', band: 'GE750', consentId: 'cc1', verifiedAt: '2026-10-25T08:00:00Z' }, status: 'VERIFIED', canConfirmFinalPlan: true, consentRequirementsMet: true, verificationCurrent: true, depositMultiplier: 0 });
async function setup(options = {}) {
  let state = { id: 'a1', status: 'AWAITING_CONFIRMATION', finalPlan: finalPlan() }, reads = 0;
  let creditState = options.review || credit();
  options.change?.(state.finalPlan);
  const calls = [], dialogs = [], toasts = [];
  const memory = new Map([[config.storageKey, { token: 'offline-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'offline-customer' } }]]);
  const platform = { getStorageSync: k => memory.get(k), setStorageSync: (k,v) => memory.set(k,v), removeStorageSync: k => memory.delete(k), showToast: v => toasts.push(v), showModal(v) { dialogs.push(v); if (v.showCancel === false) return v.success({confirm:true}); if(options.holdModal) return; if(options.modalFailure) return v.fail({errMsg:'offline failure'}); v.success({confirm:!options.cancel}); } };
  const api = createApi(config, v => {
    calls.push({ method:v.method, route:new URL(v.url).pathname, data:v.data });
    if(v.method === 'POST') {
      if(options.postFailure === 'NETWORK') return v.fail({});
      if(options.postFailure === 'CONFLICT') return v.success({statusCode:409,data:{error:{code:'VERSION_CONFLICT',message:'最终方案已更新，请重新阅读。'}}});
      state={...state,status:v.url.endsWith('/confirm')?'CONFIRMED':v.url.endsWith('/cancel')?'CANCELLED':'IN_REVIEW'};
      return v.success({statusCode:200,data:{message:'处理已保存。'}});
    }
    if(v.url.endsWith('/credit-review')) return v.success({statusCode:200,data:structuredClone(creditState)});
    reads++;
    if(options.refreshFailure && reads > 1) return v.fail({});
    v.success({statusCode:200,data:structuredClone(state)});
  }, platform);
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,'pages/application-detail/index.js'),'utf8'), { Page: v => definition=v, wx: platform, require: name => name.includes('/services/') ? api : name.includes('/config') ? config : {load: async (p,fn) => { p.setData({loading:true,error:''}); try {const v=await fn();p.setData({...v,loading:false});return v;}catch(e){p.setData({loading:false,error:e.message});return null;}},toastError:e=>platform.showToast({title:e.message}),confirm:(title,content)=>new Promise(resolve=>platform.showModal({title,content,success:r=>resolve(!!r.confirm),fail:()=>resolve(false)}))} });
  const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v)}};
  page.onLoad({id:'a1'});await page.refresh();
  return {page,calls,dialogs,toasts,setReview(value){creditState=value;},approve(){page.setData({planRead:true,ownerSharingAccepted:true})},posts:()=>calls.filter(v=>v.method==='POST')};
}
test('real API policyVersion contract is recognized and both explicit consents are required', async () => {
  const env=await setup();assert.equal(env.page.data.application.finalPlan.complete,true);
  await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.match(env.dialogs.at(-1)?.content || '',/实际出租方/);
  env.page.setData({ownerSharingAccepted:true});await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.match(env.dialogs.at(-1)?.content || '',/阅读.*最终方案/);
  env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,1);
  assert.equal(env.posts()[0].data.commercialHash,'commercial-hash');assert.equal(env.posts()[0].data.revision,1);
  assert.equal(env.posts()[0].data.ownerSharing.accepted,true);assert.equal(env.posts()[0].data.ownerSharing.noticeHash,'sharing-hash');
  assert.equal(env.page.data.application.status,'CONFIRMED');assert.equal(env.page.data.planRead,false);assert.equal(env.page.data.ownerSharingAccepted,false);assert.equal(env.page.data.busy,false);assert.equal(env.dialogs.at(-1).showCancel,false);
});
test('missing or inconsistent policy versions, amounts and hashes stay blocked with visible feedback', async () => {
  for(const change of [f=>{f.usagePolicy.version='USAGE_V1';delete f.usagePolicy.policyVersion;},f=>{delete f.usagePolicyVersion;},f=>{f.usagePolicyVersion='USAGE_V2';},f=>{f.usagePolicy.hash='';},f=>{f.usagePolicy.excessPriceAmount=50;},f=>{f.commercialHash='';}]){
    const env=await setup({change});env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.ok(env.dialogs.at(-1)?.content);assert.equal(env.page.data.busy,false);
  }
});
test('a second tap while confirmation is open does not duplicate the request', async () => {
  const env=await setup({holdModal:true});env.approve();const pending=env.page.confirmPlan();await env.page.confirmPlan();assert.equal(env.dialogs.length,1);env.dialogs[0].success({confirm:true});await pending;assert.equal(env.posts().length,1);
});
test('dismissed confirmation and native dialog failure do not submit and are visible',async()=>{
  for(const options of [{cancel:true},{modalFailure:true}]){const env=await setup(options);env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,0);assert.equal(env.page.data.busy,false);assert.equal(env.dialogs.at(-1).showCancel,false);}
});
test('network errors and version conflicts use a dialog and clear stale consent',async()=>{
  for(const failure of ['NETWORK','CONFLICT']){const env=await setup({postFailure:failure});env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,1);assert.equal(env.dialogs.at(-1).showCancel,false);assert.match(env.dialogs.at(-1).content,failure==='NETWORK'?/网络|核实/:/方案已更新/);assert.equal(env.page.data.planRead,false);assert.equal(env.page.data.ownerSharingAccepted,false);assert.equal(env.page.data.busy,false);}
});
test('successful submit followed by read failure is distinguished from failed submit',async()=>{
  const env=await setup({refreshFailure:true});env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,1);assert.match(env.dialogs.at(-1)?.content || '',/已.*保存|已确认/);assert.match(env.dialogs.at(-1)?.content || '',/刷新|重.*加载/);assert.equal(env.page.data.busy,false);
});
test('reject missing reason and successful reject/cancel have floating feedback',async()=>{
  const env=await setup();await env.page.rejectPlan();assert.equal(env.posts().length,0);assert.match(env.dialogs.at(-1)?.content || '',/原因/);
  env.page.setData({rejectReason:'合成拒绝原因'});await env.page.rejectPlan();assert.equal(env.posts().length,1);assert.equal(env.posts()[0].data.reason,'合成拒绝原因');assert.equal(env.dialogs.at(-1).showCancel,false);
  const cancel=await setup();await cancel.page.cancelApplication();assert.equal(cancel.posts().length,1);assert.equal(cancel.page.data.application.status,'CANCELLED');assert.equal(cancel.dialogs.at(-1).showCancel,false);
});
test('details and rejection are collapsed by default and opening them never grants consent',async()=>{
  const env=await setup();
  for(const name of ['showPlanDetails','showCreditDetails','showLessorDetails','showRejectForm'])assert.equal(env.page.data[name],false);
  env.page.togglePlanDetails();env.page.toggleCreditDetails();env.page.toggleLessorDetails();env.page.beginReject();
  for(const name of ['showPlanDetails','showCreditDetails','showLessorDetails','showRejectForm'])assert.equal(env.page.data[name],true);
  assert.equal(env.page.data.planRead,false);assert.equal(env.page.data.ownerSharingAccepted,false);assert.equal(env.posts().length,0);
  env.page.setData({creditReview:null,application:{...env.page.data.application,finalPlan:{...env.page.data.application.finalPlan,complete:false}},rejectReason:'不接受当前安排'});
  await env.page.rejectPlan();assert.equal(env.posts().length,1);assert.match(env.posts()[0].route,/reject$/);
});

test('OFFLINE consent and confirmation describe the actual enterprise or individual lessor and three-party paper signing', async () => {
  for (const subjectType of ['ENTERPRISE', 'INDIVIDUAL']) {
    const env = await setup({ change: final => { final.contractMode = 'OFFLINE'; final.lessorSnapshot.subjectType = subjectType; final.lessorSnapshot.name = subjectType === 'INDIVIDUAL' ? '合成个人出租方' : '合成企业出租方'; } });
    env.page.toggleLessorDetails();
    const view = renderPage('application-detail', env.page.data);
    assert.match(view, /宁达/); assert.match(view, /三方.*纸质/); assert.match(view, /实际出租方/); assert.match(view, /本单.*必要资料/);
    assert.doesNotMatch(view, /晓浪|电子签|上述企业|该企业/);
    await env.page.confirmPlan();
    assert.match(env.dialogs.at(-1).content, /该实际出租方/); assert.doesNotMatch(env.dialogs.at(-1).content, /该企业/); assert.equal(env.posts().length, 0);
    env.approve(); await env.page.confirmPlan();
    const confirmation = env.dialogs.find(row => row.title === '确认这份最终方案？');
    assert.match(confirmation.content, /三方.*纸质/); assert.equal(env.posts().length, 1);
    assert.equal(env.posts()[0].data.ownerSharing.noticeHash, 'sharing-hash'); assert.equal(env.posts()[0].data.ownerSharing.lessorHash, 'lessor-hash');
  }
});

test('historical ESIGN final plan still displays its electronic signing context', async () => {
  const env = await setup({ change: final => { final.contractMode = 'ESIGN'; } }); env.page.toggleLessorDetails();
  assert.match(renderPage('application-detail', env.page.data), /电子签/);
  env.approve(); await env.page.confirmPlan(); assert.equal(env.posts().length, 1);
  assert.doesNotMatch(env.dialogs.find(row => row.title === '确认这份最终方案？').content, /纸质/);
});

function safeCredit() {
  const result = credit();
  result.verification = { verifiedAt: result.verification.verifiedAt, current: true };
  delete result.depositMultiplier;
  return result;
}
function publicFinal(final) { delete final.creditVerificationId; delete final.creditBand; final.contractMode = 'OFFLINE'; }

test('safe customer credit verification confirms using public versions even when an older plan contains optional internal fields', async () => {
  const env = await setup({ review: safeCredit() });
  assert.deepEqual(Object.keys(env.page.data.creditReview.verification).sort(), ['current', 'verifiedAt']);
  env.approve(); await env.page.confirmPlan();
  assert.equal(env.posts().length, 1, env.page.data.actionError);
  assert.deepEqual(Object.keys(env.posts()[0].data).sort(), ['commercialHash', 'ownerSharing', 'revision']);
});

test('exact public final plan and safe credit projection retain separate consents, commercial hash and revision binding', async () => {
  const env = await setup({ review: safeCredit(), change: publicFinal });
  assert.equal(env.page.data.application.finalPlan.complete, true);
  assert.equal(env.page.data.application.finalPlan.creditVerificationId, undefined);
  assert.equal(env.page.data.application.finalPlan.creditBand, undefined);
  assert.equal(env.page.data.creditReview.verification.id, undefined);
  await env.page.confirmPlan(); assert.equal(env.posts().length, 0);
  env.page.setData({ ownerSharingAccepted: true }); await env.page.confirmPlan(); assert.equal(env.posts().length, 0);
  env.approve(); await env.page.confirmPlan(); assert.equal(env.posts().length, 1);
  assert.equal(env.posts()[0].data.revision, 1); assert.equal(env.posts()[0].data.commercialHash, 'commercial-hash');
  assert.equal(env.posts()[0].data.ownerSharing.noticeHash, 'sharing-hash');
});

test('safe credit status, consent and public version changes still block confirmation and clear both checks', async () => {
  const changes = [
    (_final, review) => { review.verificationCurrent = false; },
    (_final, review) => { review.verification.current = false; },
    (_final, review) => { review.canConfirmFinalPlan = false; },
    (_final, review) => { review.consent.status = 'WITHDRAWN'; },
    (_final, review) => { review.consentRequirementsMet = false; },
    (_final, review) => { review.creditRevision += 1; },
    final => { delete final.creditRevision; },
    final => { final.creditRevision = '2'; },
    final => { final.creditRevision = -1; },
    final => { delete final.creditRuleVersion; },
    final => { final.creditRuleVersion = 'STALE_RULE'; },
  ];
  for (const change of changes) {
    const review = safeCredit(); const env = await setup({ review, change: final => { publicFinal(final); change(final, review); } });
    env.approve(); await env.page.confirmPlan();
    assert.equal(env.posts().length, 0); assert.equal(env.page.data.planRead, false); assert.equal(env.page.data.ownerSharingAccepted, false);
    assert.match(env.dialogs.at(-1).content, /核验.*已变更/);
  }
});

test('refreshing a changed public credit revision clears old consent and cannot confirm the stale final plan', async () => {
  const env = await setup({ review: safeCredit(), change: publicFinal }); env.approve();
  env.setReview({ ...safeCredit(), creditRevision: 3 }); await env.page.refresh();
  assert.equal(env.page.data.planRead, false); assert.equal(env.page.data.ownerSharingAccepted, false);
  env.approve(); await env.page.confirmPlan(); assert.equal(env.posts().length, 0);
  assert.match(env.dialogs.at(-1).content, /核验.*已变更/);
});
test('actual mounted ELECTRONIC final-plan confirmation uses three facts, frozen product minimum and fee components',async()=>{
  const env=await setup({change:f=>Object.assign(f,{contractMode:'ELECTRONIC',commercialHash:'a'.repeat(64),product:{months:12,minimumTermMonths:3},agreedFeeComponents:{baseFeeAmount:1,mileageMonthlyFeeAmount:0},commercialTerms:{vehicleIdentification:'合成车辆标识',customerAddress:'合成联系地址',handoverArrangement:'合成计划地点联系人'}})});
  assert.equal(env.page.data.application.finalPlan.complete,true);env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,1);assert.equal(env.posts()[0].data.commercialHash,'a'.repeat(64));assert.equal(env.posts()[0].data.revision,1);
});
test('ELECTRONIC missing minimum source or inconsistent integer fee components cannot confirm',async()=>{
  for(const change of [f=>delete f.product.minimumTermMonths,f=>f.agreedFeeComponents.baseFeeAmount=2]){const env=await setup({change:f=>{Object.assign(f,{contractMode:'ELECTRONIC',commercialHash:'a'.repeat(64),product:{months:12,minimumTermMonths:3},agreedFeeComponents:{baseFeeAmount:1,mileageMonthlyFeeAmount:0},commercialTerms:{vehicleIdentification:'合成车',customerAddress:'合成地址',handoverArrangement:'合成地点联系人'}});change(f);}});env.approve();await env.page.confirmPlan();assert.equal(env.posts().length,0);}
});
