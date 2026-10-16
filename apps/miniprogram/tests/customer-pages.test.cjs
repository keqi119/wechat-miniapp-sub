const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const memory = new Map();
let calls = [], toasts = [], uploadFails = false, conflict = false, legalVersion = 3, handoverResponse = null, handoverId = 'h1', applicationStatus = 'AWAITING_CONFIRMATION';
const session = { token: 'token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1', profile: { name: '测试客户', mobile: '13800000000', drivingYears: 0 } } };
const storageKey = require('../src/config').storageKey;
const commercialTerms = Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(key => [key, '本测试确认的' + key]));
global.wx = {
  getStorageSync: key => memory.get(key), setStorageSync: (key, value) => memory.set(key, value), removeStorageSync: key => memory.delete(key),
  setNavigationBarTitle() {}, showToast: v => toasts.push(v.title), navigateTo: v => { calls.push({ navigation: v.url }); v.success?.({}); }, switchTab() {},
  showModal: v => v.success({ confirm: true }), login: v => v.success({ code: 'wx-code' }),
  makePhoneCall: v => { calls.push({ phone: v.phoneNumber }); v.success?.({}); },
  chooseMedia: v => v.success({ tempFiles: [{ tempFilePath: '/local/photo.jpg', size: 100 }] }),
  uploadFile: v => uploadFails ? v.fail({}) : v.success({ statusCode: 201, data: JSON.stringify({ id: 'f1', name: 'photo.jpg', url: '/api/customer/files/f1', mimeType: 'image/jpeg', size: 100 }) }),
  request(v) {
    calls.push(v);
    const route = v.url.replace(/^https:\/\/[^/]+\/api/, '');
    let data = {};
    if (route === '/customer/context') data = { customer: session.customer };
    else if (route === '/customer/payment-verifications') data = { items: [] };
    else if (route === '/customer/applications/a1/credit-review') data = { applicationId:'a1',creditRevision:3,ruleVersion:'ZHIMA_MANUAL_V1',document:{id:'credit-v1',type:'credit-verification',version:1,title:'人工核验说明',content:'本地测试说明'},consent:{id:'cc1',status:'ACCEPTED',documentId:'credit-v1',version:1},verification:{id:'cv1',band:'GE750',consentId:'cc1',verifiedAt:'2026-10-16T08:00:00Z'},status:'VERIFIED',canConsent:true,canDecline:true,consentRequirementsMet:true,canWithdraw:true,canFinalize:false,verificationCurrent:true,canConfirmFinalPlan:true,depositMultiplier:0 };
    else if (route === '/customer/dashboard') data = { subscription: { id: 'o1', orderId: 'o1', vehicleName: '当前车辆' }, handover: { id: handoverId } };
    else if (route.startsWith('/public/vehicles/')) data = { vehicle: { id: 'v1', name: '当前车辆', available: true }, plans: [{ id: 'p1', available: true, monthlyFeeAmount: 0 }] };
    else if (route.startsWith('/public/legal/')) { const type = route.split('/').at(-1); data = { id: type === 'application' ? 'legal-1' : type + '-1', type, version: legalVersion, title: '正式须知', content: '正式文案' }; }
    else if (route === '/customer/applications/a1') data = { id: 'a1', status: applicationStatus, profile: { name: '原审查资料', drivingYears: 2, fileIds: ['f-old'] }, note: '请补驾驶证', finalPlan: { creditVerificationId:'cv1',creditRuleVersion:'ZHIMA_MANUAL_V1',creditBand:'GE750',creditRevision:3,revision: 4, commercialHash: 'hash-4', title: '最终套餐', monthlyFeeAmount: 12345, depositAmount: 0, months: 12, mileagePerMonthKm: 1500, excessMileagePriceAmount: 80, energyDescription: '自费充电', benefits: ['用车服务'], conditions: '提前退出按合同', startDate: '2026-11-01', firstDueDate: '2026-10-25', commercialTerms } };
    else if (route === '/customer/applications') data = { id: 'a1' };
    else if (route.startsWith('/customer/handovers/')) data = { id: handoverId, manifestHash: 'manifest-' + handoverId, fileIds: ['f1'], status: handoverResponse === 'CONFIRM' ? 'CUSTOMER_CONFIRMED' : handoverResponse === 'OBJECT' ? 'OBJECTION_SUBMITTED' : 'PUBLISHED', customerResponse: handoverResponse, signatureStatus: 'PENDING', checklist: [{ label: '钥匙', value: '2把' }], evidence: [{ id: 'f1', name: '现场照片' }] };
    else if (route.endsWith('/sign-status')) data = { status: 'SIGNED' };
    else if (route.endsWith('/services') || route.endsWith('/mileages') || route.endsWith('/confirm')) data = { id: 'result-1' };
    if (conflict && route.endsWith('/confirm')) v.success({ statusCode: 409, data: { error: { code: 'VERSION_CONFLICT', message: '方案已更新' } } });
    else v.success({ statusCode: 200, data });
  },
};
function page(name, options = {}) {
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../src/pages/' + name + '/index.js');
  delete require.cache[file]; require(file);
  const result = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  result.onLoad?.(options);
  return result;
}
async function settle(result) {
  for (let i = 0; i < 50 && result.data.loading; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(result.data.loading, false);
  return result;
}
beforeEach(() => { memory.clear(); memory.set(storageKey, session); calls = []; toasts = []; uploadFails = false; conflict = false; legalVersion = 3; handoverResponse = null; handoverId = 'h1'; applicationStatus = 'AWAITING_CONFIRMATION'; });
test('application page can submit real intent with the agreement version it displayed', async () => {
  const p = await settle(page('application', { vehicleId: 'v1', planId: 'p1' }));
  p.setData({ accepted: true, name: '测试客户', mobile: '13800000000' });
  await p.submit();
  const submission = calls.find(v => v.method === 'POST' && v.url.endsWith('/applications'));
  assert.ok(submission, p.data.formError);
  assert.deepEqual(submission.data.consents, [{ documentId: 'legal-1', version: 3 }]);
  assert.equal(p.data.submittedId, 'a1');
});
test('application conflict clears acceptance and refreshes the final commercial version', async () => {
  const p = page('application-detail', { id: 'a1' }); await p.refresh();
  p.setData({ planRead: true }); conflict = true;
  await p.confirmPlan();
  assert.equal(p.data.planRead, false);
  const submission = calls.find(v => v.method === 'POST' && v.url.endsWith('/confirm'));
  assert.equal(submission.data.commercialHash, 'hash-4');
  assert.match(p.data.actionError, /方案已更新/);
});
test('service page uploads bytes before submitting private file ids, and failure leaves no phantom file', async () => {
  const p = await settle(page('service', { type: 'rescue' }));
  await p.chooseAttachments();
  assert.equal(p.data.attachments[0].id, 'f1');
  p.setData({ location: '上海路口', description: '车辆轮胎无法行驶', mobile: '13800000000' });
  await p.submit();
  assert.deepEqual(calls.find(v => v.method === 'POST' && v.url.endsWith('/services')).data.fileIds, ['f1']);
  const failed = await settle(page('service', { type: 'rescue' })); uploadFails = true;
  await failed.chooseAttachments();
  assert.deepEqual(failed.data.attachments, []);
  assert.match(toasts.at(-1), /上传失败/);
});
test('mileage page submits dashboard order identity and uploaded evidence', async () => {
  const p = await settle(page('mileage')); await p.chooseAttachments();
  p.setData({ reading: '0' }); await p.submit();
  const submission = calls.find(v => v.method === 'POST' && v.url.endsWith('/mileages'));
  assert.equal(submission.data.orderId, 'o1');
  assert.equal(submission.data.readingKm, 0);
});
test('handover reads real current manifest and never confirms before private evidence is opened', async () => {
  const p = await settle(page('handover'));
  assert.equal(p.data.handover.manifestHash, 'manifest-h1');
  p.showEvidence(); p.acknowledgeEvidence();
  assert.equal(p.data.evidenceRead, false);
  p.setData({ readFileIds: ['f1'], accepted: true }); p.acknowledgeEvidence(); await p.submit();
  const submission = calls.find(v => v.method === 'POST' && v.url.endsWith('/handovers/h1/confirm'));
  assert.equal(submission.data.manifestHash, 'manifest-h1');
  assert.deepEqual(submission.data.readFileIds, ['f1']);
});
test('production settings exposes account operations and has no scenario mutation methods', async () => {
  const p = page('settings'); await p.refresh();
  assert.equal(p.changeScenario, undefined);
  assert.equal(p.changeFault, undefined);
  assert.equal(p.reset, undefined);
  assert.equal(p.data.authenticated, true);
  assert.equal(typeof p.phoneLogin, 'function');
  assert.equal(typeof p.smsLogin, 'function');
  await p.logout();
  assert.equal(memory.has(storageKey), false);
});
test('changed published agreement requires a new explicit consent rather than reusing old checkbox', async () => {
  const p = await settle(page('application', { vehicleId: 'v1', planId: 'p1' }));
  p.setData({ accepted: true }); legalVersion = 4; await p.refresh();
  assert.equal(p.data.accepted, false);
  assert.equal(p.data.legal.version, 4);
});
test('application startup resumes pending payment using only server status', async () => {
  memory.set(storageKey + ':pending:payment', { id: 'p-resume', billId: 'b-resume' });
  let definition; global.App = value => { definition = value; };
  delete require.cache[require.resolve('../src/app')]; require('../src/app');
  definition.onLaunch(); await definition.onShow();
  assert.equal(calls.some(v => v.url?.endsWith('/payments/p-resume')), true);
});
test('rejection UI asks for a reason before sending the current revision', async () => {
  const p=page('application-detail',{id:'a1'});await p.refresh();await p.rejectPlan();
  assert.equal(calls.some(v=>v.url?.endsWith('/reject')),false);
  p.setData({rejectReason:'月费不符合预算'});await p.rejectPlan();
  assert.equal(calls.find(v=>v.url?.endsWith('/reject')).data.reason,'月费不符合预算');
});
test('handover reopening restores acknowledged response and a replacement id clears old response and evidence', async () => {
  handoverResponse='CONFIRM';const p=await settle(page('handover'));
  assert.equal(p.data.submitted.id,'h1');assert.equal(p.data.decision,'confirm');
  handoverResponse=null;handoverId='h2';await p.reload();
  assert.equal(p.data.handover.id,'h2');assert.equal(p.data.submitted,null);assert.equal(p.data.evidenceRead,false);
});
test('NEEDS_INFO profile workflow uploads privately and amends application review snapshot', async () => {
  applicationStatus='NEEDS_INFO';const p=await settle(page('profile',{applicationId:'a1'}));
  assert.equal(p.data.name,'原审查资料');assert.equal(p.data.attachments[0].id,'f-old');
  await p.chooseAttachments();p.setData({name:'补正客户',drivingYears:'3'});await p.submit();
  const mutation=calls.find(v=>v.url?.endsWith('/applications/a1/amend'));
  assert.deepEqual(mutation.data.profile.fileIds,['f-old','f1']);assert.equal(mutation.data.profile.name,'补正客户');
});
test('mileage result opens its own record type and verified public customer service number can be called', async () => {
  const mileage=await settle(page('mileage'));mileage.setData({submitted:{id:'m1'}});mileage.openRecord();
  assert.equal(calls.find(v=>v.navigation).navigation,'/pages/record/index?type=mileages&id=m1');
  const settings=page('settings');settings.callService();assert.equal(calls.find(v=>v.phone).phone,'18616570212');
});
