const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/services/api');
const { money } = require('../src/utils/format');

function setup(handler = () => ({ statusCode: 200, data: {} }), native = {}) {
  const storage = new Map();
  const calls = [];
  const platform = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    login: value => value.success({ code: 'wx-login' }),
    requestPayment: value => value.success({}),
    navigateTo: value => { calls.push({ navigation: value.url }); value.success?.({}); },
    navigateToMiniProgram: value => { calls.push({ miniProgram: value.appId }); value.success?.({}); },
    uploadFile: value => { calls.push(value); value.success({ statusCode: 201, data: JSON.stringify({ id: 'file-1', name: '仪表照片', url: '/api/customer/files/file-1', mimeType: 'image/jpeg', size: 10 }) }); },
    ...native,
  };
  const api = createApi({ apiBase: 'https://mini-api.subauto.keybox.cloud', storageKey: 'customer-session', signingHosts: ['sign.fadada.com'] }, value => {
    calls.push(value);
    const result = value.url.endsWith('/public/signing-config') ? { statusCode: 200, data: { mode: 'MINIAPP_WEBVIEW', enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com', 'realnameverify16.fadada.com'], returnUrl: 'https://mini-api.subauto.keybox.cloud/api/public/esign-return' } } : handler(value);
    if (result.network) value.fail({ errMsg: 'request:fail' });
    else value.success(result);
  }, platform);
  const session = { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z', customer: { id: 'customer-1', profile: { name: '测试客户', mobile: '13800000000' } } };
  storage.set('customer-session', session);
  return { api, calls, platform, storage, session };
}

test('authenticated calls target new customer API with Bearer, never old portal routes', async () => {
  const { api, calls } = setup(() => ({ statusCode: 200, data: { subscription: null } }));
  assert.deepEqual(await api.getDashboard(), { subscription: null });
  assert.equal(calls[0].url, 'https://mini-api.subauto.keybox.cloud/api/customer/dashboard');
  assert.equal(calls[0].header.Authorization, 'Bearer session-token');
});
test('401 revokes cached session and propagates expired error without fallback', async () => {
  const { api, storage } = setup(() => ({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED', message: '请重新登录' } } }));
  await assert.rejects(api.getDashboard(), { code: 'SESSION_EXPIRED' });
  assert.equal(storage.has('customer-session'), false);
  assert.equal(api.getContext().authenticated, false);
});
test('expired local sessions do not send protected requests', async () => {
  const { api, storage, session, calls } = setup();
  storage.set('customer-session', { ...session, expiresAt: '2020-01-01T00:00:00Z' });
  await assert.rejects(api.getDashboard(), { code: 'AUTH_REQUIRED' });
  assert.equal(calls.length, 0);
});
test('network and provider errors stay errors with request ids', async () => {
  const network = setup(() => ({ network: true }));
  await assert.rejects(network.api.getHome(), { code: 'NETWORK' });
  const provider = setup(() => ({ statusCode: 503, data: { error: { code: 'PROVIDER_UNAVAILABLE', message: '签署暂不可用' }, requestId: 'r-123' } }));
  await assert.rejects(provider.api.getRecord('contracts', 'c-1'), { code: 'PROVIDER_UNAVAILABLE', requestId: 'r-123' });
});
test('public vehicle lists use pagination wrapper and preserve zero versus null money', async () => {
  const { api, calls } = setup(() => ({ statusCode: 200, data: { items: [{ id: 'v-1', title: '纯电车辆', brand: 'A', mileageKm: 0, monthlyFeeFromAmount: 0, available: true }, { id: 'v-2', title: '待报价', monthlyFeeFromAmount: null }], total: 2, page: 1, pageSize: 20 } }));
  const result = await api.getVehicles({ query: '纯电', brand: 'A' });
  assert.equal(result.items[0].minFeeText, '¥0.00');
  assert.equal(result.items[0].mileageText, '0 km');
  assert.equal(result.items[1].minFeeText, '待确认');
  assert.equal(calls[0].data.keyword, '纯电');
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(money(1), '¥0.01');
  assert.equal(money('0'), '待确认');
});
test('anonymous home derives only real public directory and has no invented customer next step', async () => {
  const { api, storage } = setup(() => ({ statusCode: 200, data: { items: [], total: 0, page: 1, pageSize: 20 } }));
  storage.clear();
  const result = await api.getHome();
  assert.deepEqual(result.vehicles, []);
  assert.equal(result.context.authenticated, false);
  assert.equal(result.nextAction, null);
});
test('wechat phone login exchanges native code and stores only validated server session', async () => {
  const { api, storage, session, calls } = setup(() => ({ statusCode: 200, data: { token: 'new-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c-2', mobile: '13900000000' } } }));
  const consents = [{ documentId: 'terms-1', version: 1 }, { documentId: 'privacy-1', version: 1 }];
  await api.loginWechat('phone-code', consents);
  assert.deepEqual(calls[0].data, { loginCode: 'wx-login', phoneCode: 'phone-code', consents });
  assert.equal(storage.get('customer-session').token, 'new-token');
  assert.notEqual(storage.get('customer-session').token, session.token);
});
test('SMS fallback sends native login code to bind OpenID and invalid sessions are rejected', async () => {
  const { api, calls } = setup(() => ({ statusCode: 200, data: { sent: true } }));
  await api.requestSms('13800000000');
  assert.deepEqual(calls[0].data, { mobile: '13800000000' });
  await assert.rejects(api.loginSms('13800000000', '123456', [{ documentId: 'terms-1', version: 1 }, { documentId: 'privacy-1', version: 1 }]), { code: 'RESPONSE' });
  assert.equal(calls[1].data.loginCode, 'wx-login');
});
test('submit application pins published agreement version and stable retry key', async () => {
  const { api, calls } = setup(v => ({ statusCode: 200, data: v.url.includes('/public/legal/') ? { id: 'legal-1', version: 2, title: '申请须知', content: '正式发布文案' } : { id: 'application-1' } }));
  const payload = { vehicleId: 'v-1', planId: 'p-1', name: '测试客户', mobile: '13800000000', accepted: true };
  await assert.rejects(api.submitApplication(payload), { code: 'CONSENT_REQUIRED' });
  const legal = await api.getLegal('application');
  await api.submitApplication({ ...payload, consents: [{ documentId: legal.id, version: legal.version }], idempotencyKey: 'apply-once' });
  const body = calls.at(-1).data;
  assert.equal(body.subscriptionPlanId, 'p-1');
  assert.equal(body.idempotencyKey, 'apply-once');
  assert.deepEqual(body.consents, [{ documentId: 'legal-1', version: 2 }]);
  assert.equal(body.customerId, undefined);
});
test('final plan confirmation carries exact revision/hash and 409 clears no client business state', async () => {
  const { api, calls } = setup(() => ({ statusCode: 409, data: { error: { code: 'VERSION_CONFLICT', message: '方案已更新' } } }));
  await assert.rejects(api.performAction('application', 'a-1', 'confirm', { revision: 2 }), { code: 'VALIDATION' });
  await assert.rejects(api.performAction('application', 'a-1', 'confirm', { revision: 2, commercialHash: 'hash-v2' }), { code: 'VERSION_CONFLICT' });
  assert.deepEqual(calls[0].data, { revision: 2, commercialHash: 'hash-v2' });
});
test('payment cancellation has own result and server remains authoritative', async () => {
  const { api, calls } = setup(v => ({ statusCode: 200, data: v.url.endsWith('/pay') ? { paymentId: 'payment-1', timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=1', signType: 'RSA', paySign: 'signature' } : { status: 'PENDING' } }), { requestPayment: value => value.fail({ errMsg: 'requestPayment:fail cancel' }) });
  const result = await api.performAction('bills', 'b-1', 'pay', { idempotencyKey: 'payment-once' });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(calls.at(-1).url, 'https://mini-api.subauto.keybox.cloud/api/customer/payments/payment-1');
  assert.equal(result.payment.status, 'PENDING');
});
test('payment native success queries server and never declares settlement from native callback', async () => {
  const { api } = setup(v => ({ statusCode: 200, data: v.url.endsWith('/pay') ? { paymentId: 'payment-1', timeStamp: '1', nonceStr: 'n', package: 'prepay_id=1', signType: 'RSA', paySign: 's' } : { status: 'PENDING' } }));
  const result = await api.performAction('bills', 'b-1', 'pay');
  assert.equal(result.status, 'PENDING');
  assert.match(result.message, /确认|处理中/);
});
test('explicit native signing opens the validated provider page and refresh obtains archived server status', async () => {
  const { api, calls } = setup(v => ({ statusCode: 200, data: v.url.endsWith('/sign') ? { taskId: 'task1', status: 'PENDING', url: 'https://textapi17.fadada.com/api2/sign' } : { status: 'SIGNED', signedFileId: 'archive1' } }));
  const result = await api.performAction('contracts', 'c-1', 'sign');
  assert.match(calls.find(c => c.navigation).navigation, /^\/pages\/sign\/index\?/);
  assert.equal(result.status, 'PENDING');
  assert.equal((await api.getSignStatus('c-1')).status, 'SIGNED');
  assert.equal(calls.filter(value => value.method === 'POST').length, 1);
});
test('malformed payment payloads are never sent to native payment APIs', async () => {
  const pay = setup(() => ({ statusCode: 200, data: { paymentId: 'p-1', paySign: 's' } }));
  await assert.rejects(pay.api.performAction('bills', 'b-1', 'pay'), { code: 'RESPONSE' });
});
test('upload transfers local image with Bearer; upload failure cannot become private attachment', async () => {
  const { api, calls } = setup();
  const file = await api.uploadFile({ tempFilePath: '/local/photo.jpg', size: 10 }, 'mileage');
  assert.equal(file.id, 'file-1');
  assert.equal(calls[0].header.Authorization, 'Bearer session-token');
  assert.equal(calls[0].formData.purpose, 'mileage');
  const bad = setup(undefined, { uploadFile: value => value.success({ statusCode: 413, data: JSON.stringify({ error: { code: 'FILE_TOO_LARGE', message: '文件过大' } }) }) });
  await assert.rejects(bad.api.uploadFile({ tempFilePath: '/local/a.jpg', size: 10 }, 'service'), { code: 'FILE_TOO_LARGE' });
  await assert.rejects(api.submitService({ type: 'rescue', attachments: [{ url: 'https://external/file' }] }), { code: 'UPLOAD_REQUIRED' });
});
test('service/mileage submissions transmit file ids and order identity with stable idempotency', async () => {
  const { api, calls } = setup(() => ({ statusCode: 201, data: { id: 'service-1' } }));
  await api.submitService({ type: 'rescue', location: '上海', description: '轮胎故障', mobile: '13800000000', attachments: [{ id: 'file-1' }], idempotencyKey: 'service-once' });
  assert.deepEqual(calls[0].data.fileIds, ['file-1']);
  assert.equal(calls[0].data.attachments, undefined);
  await api.submitMileage({ orderId: 'order-1', reading: 0, attachments: [{ id: 'file-1' }], idempotencyKey: 'mileage-once' });
  assert.equal(calls[1].data.readingKm, 0);
  assert.equal(calls[1].data.orderId, 'order-1');
  await assert.rejects(api.submitMileage({ orderId: 'order-1', reading: '', attachments: [{ id: 'file-1' }] }), { code: 'VALIDATION' });
});
test('handover response pins evidence manifest and read private file ids', async () => {
  const { api, calls } = setup(value => ({ statusCode: 200, data: value.method==='GET'?{id:'handover-1',type:'DELIVERY',actualAt:'2026-10-16T00:30:00Z',manifestHash:'manifest-v1'}:{ id: 'handover-1', status: 'CUSTOMER_CONFIRMED' } }));
  await assert.rejects(api.submitHandover({ decision: 'confirm', handoverId: 'handover-1', accepted: true }), { code: 'VALIDATION' });
  await api.submitHandover({ decision: 'confirm', handoverId: 'handover-1', actualAt:'2026-10-16T00:30:00Z',manifestHash: 'manifest-v1', readFileIds: ['file-1'], evidenceRead: true, accepted: true, idempotencyKey: 'confirm-once' });
  const post=calls.find(call=>call.method==='POST');assert.equal(post.url.endsWith('/handovers/handover-1/confirm'), true);
  assert.deepEqual(post.data, { manifestHash: 'manifest-v1', readFileIds: ['file-1'], idempotencyKey: 'confirm-once' });
  await assert.rejects(api.submitHandover({decision:'confirm',handoverId:'handover-1',actualAt:'2026-10-16T01:00:00Z',manifestHash:'manifest-v1',evidenceRead:true,accepted:true}),{code:'HANDOVER_ACTUAL_TIME'});
});
test('unsupported record/action combinations cannot become arbitrary API requests', async () => {
  const { api, calls } = setup();
  await assert.rejects(api.getRecord('../admin/users', 'x'), { code: 'VALIDATION' });
  await assert.rejects(api.performAction('orders', 'x', 'pay'), { code: 'VALIDATION' });
  assert.equal(calls.length, 0);
});
test('logout revokes remotely and clears cache; profile mobile cannot silently change', async () => {
  const { api, storage, calls } = setup();
  await assert.rejects(api.saveProfile({ name: '新称呼', mobile: '13900000000', drivingYears: 1 }), { code: 'PHONE_REVERIFY' });
  await api.logout();
  assert.equal(storage.has('customer-session'), false);
  assert.equal(calls[0].url.endsWith('/auth/logout'), true);
});
test('private file access downloads with Bearer and never forwards token to an external URL', async () => {
  let download, opened;
  const { api } = setup(undefined, {
    downloadFile: value => { download = value; value.success({ statusCode: 200, tempFilePath: '/local/private.jpg', header: { 'Content-Type': 'image/jpeg' } }); },
    previewImage: value => { opened = value; value.success({}); },
  });
  await api.openPrivateFile('file-1');
  assert.equal(download.url, 'https://mini-api.subauto.keybox.cloud/api/customer/files/file-1');
  assert.equal(download.header.Authorization, 'Bearer session-token');
  assert.deepEqual(opened.urls, ['/local/private.jpg']);
  const denied = setup(undefined, { downloadFile: value => value.success({ statusCode: 403, tempFilePath: '/local/error.html' }) });
  await assert.rejects(denied.api.openPrivateFile('other-file'), { code: 'HTTP_403' });
});
test('native interrupted payment recovers after app restart with same server payment identifier', async () => {
  const { api, storage, calls } = setup(() => ({ statusCode: 200, data: { id: 'payment-resume', status: 'PAID' } }));
  storage.set('customer-session:pending:payment', { id: 'payment-resume', billId: 'bill-resume' });
  assert.equal((await api.resumePayment()).status, 'PAID');
  assert.equal(calls[0].url.endsWith('/payments/payment-resume'), true);
  assert.equal(storage.has('customer-session:pending:payment'), false);
});
test('logging out removes signing and payment recovery data belonging to previous customer', async () => {
  const { api, storage } = setup();
  storage.set('customer-session:pending', { kind: 'contract', id: 'other-contract' });
  storage.set('customer-session:pending:payment', { id: 'other-payment' });
  await api.logout();
  assert.equal(storage.has('customer-session:pending'), false);
  assert.equal(storage.has('customer-session:pending:payment'), false);
});
test('server upload budget rejects an 11MB attachment before transferring bytes', async () => {
  const { api, calls } = setup();
  await assert.rejects(api.uploadFile({ tempFilePath: '/local/large.jpg', size: 11 * 1024 * 1024 }, 'service'), { code: 'VALIDATION' });
  assert.equal(calls.length, 0);
});
test('new platform relative public media is resolved to the new API origin', async () => {
  const { api } = setup(() => ({ statusCode: 200, data: { items: [{ id: 'v', coverImageUrl: '/api/public/media/cover-1' }], total: 1, page: 1, pageSize: 20 } }));
  assert.equal((await api.getVehicles()).items[0].imageUrl, 'https://mini-api.subauto.keybox.cloud/api/public/media/cover-1');
});
test('logged-in home maps new API media and final commercial conditions remain readable before accepting', async () => {
  const { api } = setup(value => ({ statusCode: 200, data: value.url.endsWith('/home') ? { vehicles: [{ id: 'v1', imageUrl: '/api/public/media/image-1' }], nextAction: null } : { id: 'a1', planName: '运营套餐', finalPlan: { revision: 2, commercialHash: 'hash-2', title: '运营最终方案', months: 12, monthlyFeeAmount: 0, depositAmount: 100, mileagePerMonthKm: 1500, excessMileagePriceAmount: 80, energyDescription: '充电自付', benefits: [], conditions: '超里程另计；提前退车按合同结算', startDate: '2026-11-01', firstDueDate: '2026-10-25' } } }));
  assert.equal((await api.getHome()).vehicles[0].imageUrl, 'https://mini-api.subauto.keybox.cloud/api/public/media/image-1');
  const row = await api.getApplication('a1');
  assert.equal(row.finalPlan.planTitle, '运营最终方案');
  assert.equal(row.finalPlan.notes, '超里程另计；提前退车按合同结算');
  assert.equal(row.finalPlan.excessMileagePriceText, '¥0.80');
  assert.equal(row.finalPlan.startDateText, '2026.11.01');
  assert.equal(row.finalPlan.firstDueDateText, '2026.10.25');
});
test('final plan rejection requires the customer reason and amendment submits private file ids', async () => {
  const { api, calls } = setup(() => ({ statusCode: 200, data: { id: 'a1', status: 'IN_REVIEW' } }));
  await assert.rejects(api.performAction('application', 'a1', 'reject', { revision: 1 }), { code: 'VALIDATION' });
  await api.performAction('application', 'a1', 'reject', { revision: 1, reason: '费用不符合预期' });
  assert.deepEqual(calls[0].data, { revision: 1, reason: '费用不符合预期' });
  await api.amendApplication('a1', { profile: { name: '客户', drivingYears: 2, fileIds: ['f1'] }, note: '补充驾照', idempotencyKey: 'amend-once' });
  assert.equal(calls[1].url.endsWith('/applications/a1/amend'), true);
  assert.deepEqual(calls[1].data.profile.fileIds, ['f1']);
});
test('login refuses an unchecked or missing published document snapshot before native login exchange', async () => {
  const { api, calls } = setup();
  await assert.rejects(api.loginWechat('phone-code', []), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(api.loginSms('13800000000', '123456', []), { code: 'CONSENT_REQUIRED' });
  assert.equal(calls.length, 0);
});
test('all confirmed commercial clauses and anchored monthly periods are available before accepting; old incomplete plans block confirmation', async () => {
  const terms = Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(key => [key, '明确' + key]));
  let commercialTerms = terms;
  let usagePolicy={version:'USAGE_V1',documentId:'usage-v1',documentVersion:1,hash:'a'.repeat(64),content:'本地合成已批准月台账全文，不作为生产文案。',baseAllowanceKm:1500,excessPriceAmount:150};
  const { api } = setup(() => ({ statusCode: 200, data: { id: 'a', finalPlan: { revision: 1, commercialHash: 'h', title: '确定方案', monthlyFeeAmount: 0, depositAmount: 100, months: 2, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '自付', benefits: [], conditions: '明确限制', startDate: '2026-01-31', firstDueDate: '2026-01-25', commercialTerms,usagePolicy } } }));
  const plan = (await api.getApplication('a')).finalPlan;
  assert.equal(plan.complete, true);assert.equal(plan.commercialRows.length, 14);
  assert.equal(plan.commercialRows.find(row => row.key === 'insuranceDetails').value, '明确insuranceDetails');
  assert.equal(plan.endDateText, '2026.03.30');
  assert.deepEqual(plan.billingRows[1], { sequence: 2, amountText: '¥0.00', dueDateText: '2026.02.25', periodText: '2026.02.28—2026.03.30' });
  commercialTerms = null;assert.equal((await api.getApplication('a')).finalPlan.complete, false);
  commercialTerms = { ...terms, insuranceDetails: '待确认' };assert.equal((await api.getApplication('a')).finalPlan.complete, false);
  commercialTerms=terms;usagePolicy=null;assert.equal((await api.getApplication('a')).finalPlan.complete,false);
});
