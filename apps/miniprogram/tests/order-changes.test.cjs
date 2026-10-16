const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const document = { id: 'delay-legal1', type: 'delivery-delay-amendment', version: 1, hash: 'd'.repeat(64), content: '离线合成已发布补充条款，逐单协商延期与原款安排。' };
const period = { sequence: 1, startDate: '2026-11-16', endDate: '2026-12-16', dueDate: '2026-11-10', amount: 519900, originalAmount: 519900, netPaidAmount: 519900, carryAmount: 519900, chargeAmount: 0, refundAmount: 0, calculationBasis: '沿用原订阅月费，原成功付款分配至本期。' };
const change = extra => ({ id: 'dc1', orderId: 'o1', kind: 'DELIVERY_DELAY', status: 'AWAITING_CONFIRMATION', revision: 3, reason: '协商延期交车', createdAt: '2026-10-16T08:00:00Z', quote: { id: 'q1', revision: 1, commercialHash: 'a'.repeat(64), newStartDate: '2026-11-16', newEndDate: '2026-12-15', months: 1, expiresAt: '2099-01-01T00:00:00Z', periods: [period], reason: '双方协商', settlementExplanation: '原款沿用，不重复收取', handoverArrangement: '上海预约交车', cancellationTerms: '逐单协商取消费用', document }, contract: null, finance: { obligations: [], refunds: [] , blockers: [] }, canConfirm: true, canReject: true, canSign: false, canSync: false, blockers: [], capabilityNote: '生效由后台核对，签署不代表交车完成。', ...extra });
function setup(extra = {}) {
  let current = extra.change || change(), failure = extra.failure;
  const calls = [], navigations = [], storage = new Map([[config.storageKey, { token: 'synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' } }]]);
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast() {}, showModal: v => v.success({ confirm: true }), setNavigationBarTitle() {}, navigateTo: v => { navigations.push(v.url); v.success?.({}); }, requestPayment() { throw Error('No payment from order change'); }, request(v) {
    calls.push(v); const route = v.url.replace(/^https:\/\/[^/]+\/api/, '');
    if (failure === 'NETWORK') return v.fail({ errMsg: 'synthetic network failure' });
    if (failure && v.method === 'POST') return v.success({ statusCode: failure, data: { error: { message: '合成失败状态', code: 'CONFLICT' } } });
    let data;
    if (route === '/public/signing-config') return v.success({ statusCode: 200, data: { mode: 'MINIAPP_WEBVIEW', enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com', 'realnameverify16.fadada.com'], returnUrl: 'https://mini-api.subauto.keybox.cloud/api/public/esign-return' } });
    if (route === '/customer/order-changes') { const { id, orderId, kind, status, revision, reason, createdAt, quote } = current; data = { items: [{ id, orderId, kind, status, revision, reason, createdAt, quoteSummary: quote ? { id: quote.id, revision: quote.revision, newStartDate: quote.newStartDate, newEndDate: quote.newEndDate, months: quote.months, commercialHash: quote.commercialHash, expiresAt: quote.expiresAt } : null }], total: 1, page: 1, pageSize: 50 }; }
    else if (route === '/customer/order-changes/dc1' && v.method === 'GET') data = current;
    else if (route.endsWith('/confirm')) { current = { ...current, status: 'AWAITING_SIGNATURE', revision: 4, canConfirm: false, canSign: true }; data = current; }
    else if (route.endsWith('/reject')) { current = { ...current, status: 'REJECTED', revision: 4, canConfirm: false, canReject: false }; data = current; }
    else if (route.endsWith('/sign')) data = extra.sign || { taskId: 'task1', url: 'https://textapi17.fadada.com/api2/current', status: 'PENDING' };
    else if (route.endsWith('/sync')) data = { ...current, contract: { id: 'am1', status: extra.signed ? 'SIGNED' : 'PENDING', sourceFileId: 'pdf1', signedFileId: extra.signed ? 'signed1' : null } };
    else if (route === '/customer/records/orders/o1') data = { id: 'o1', title: '合成订单', statusText: '待交车', details: [], timeline: [], documents: [], actions: [] };
    else throw Error('Unexpected route ' + route);
    v.success({ statusCode: 200, data });
  } };
  return { api: createApi({ ...config, signingHosts: ['sign.example.test'] }, v => wx.request(v), wx), wx, calls, navigations, storage, set: v => { current = v; }, fail: v => { failure = v; } };
}
function page(env, name = 'record', options = { type: 'orderchanges', id: 'dc1' }) {
  global.wx = env.wx; let definition; global.Page = v => { definition = v; };
  for (const file of ['../src/services/index', '../src/pages/' + name + '/index']) delete require.cache[require.resolve(file)];
  require('../src/pages/' + name + '/index');
  const p = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } }; p.onLoad?.(options); return p;
}
test('own change list uses dedicated authenticated route and server status', async () => {
  const env = setup(); const rows = await env.api.getRecords('orderchanges');
  assert.equal(rows[0].title, '延期交车补充方案'); assert.match(rows[0].statusText, /待客户确认/); assert.equal(env.calls[0].header.Authorization, 'Bearer synthetic');
  assert.ok(env.calls[0].url.endsWith('/customer/order-changes'));
});
test('safe quote displays server periods, last included end day and separate positive money directions', async () => {
  const env = setup(); const value = await env.api.getOrderChange('dc1');
  assert.equal(value.quote.newEndDateText, '2026.12.15（含当日）'); assert.equal(value.quote.periods[0].periodText, '2026.11.16—2026.12.16（末日不含）');
  assert.equal(value.quote.periods[0].carryAmountText, '¥5,199.00'); assert.equal(value.quote.periods[0].chargeAmountText, '¥0.00'); assert.equal(value.canConfirm, true);
  assert.equal(value.quote.document.content, document.content);
});
test('unknown status/kind or invalid money and unapproved document fail closed', async () => {
  const env = setup();
  for (const bad of [change({ status: 'MAGIC' }), change({ kind: 'VEHICLE_CHANGE' }), change({ quote: { ...change().quote, periods: [{ ...period, refundAmount: -1 }] } })]) { env.set(bad); await assert.rejects(env.api.getOrderChange('dc1'), { code: 'RESPONSE' }); }
  env.set(change({ quote: { ...change().quote, document: null } })); const value = await env.api.getOrderChange('dc1'); assert.equal(value.canConfirm, false); assert.equal(value.canSign, false);
});
test('confirmation requires current revision/hash and explicit reading; stale quote never posts', async () => {
  const env = setup();
  await assert.rejects(env.api.confirmOrderChange('dc1', { revision: 3, commercialHash: change().quote.commercialHash, read: false }));
  env.set(change({ revision: 4 })); await assert.rejects(env.api.confirmOrderChange('dc1', { revision: 3, commercialHash: change().quote.commercialHash, read: true }), { code: 'CHANGE_STALE' });
  assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
test('confirm posts bound revision/hash and stable idempotency key after a lost response', async () => {
  const env = setup({ failure: 500 }); const input = { revision: 3, commercialHash: change().quote.commercialHash, read: true };
  await assert.rejects(env.api.confirmOrderChange('dc1', input)); env.fail(null); await env.api.confirmOrderChange('dc1', input);
  const posts = env.calls.filter(v => v.method === 'POST'); assert.equal(posts[0].data.idempotencyKey, posts[1].data.idempotencyKey); assert.equal(posts[1].data.revision, 3); assert.equal(posts[1].data.commercialHash, input.commercialHash); assert.equal('read' in posts[1].data, false);
});
test('reject requires reason and current server capability and never signs or pays', async () => {
  const env = setup(); await assert.rejects(env.api.rejectOrderChange('dc1', { revision: 3, reason: '' }));
  const result = await env.api.rejectOrderChange('dc1', { revision: 3, reason: '新交车日不合适' }); assert.equal(result.status, 'REJECTED');
  assert.equal(env.calls.filter(v => v.method === 'POST').length, 1); assert.equal(env.calls.at(-1).data.reason, '新交车日不合适');
});
test('change native sign posts bound revision after current capability check and stores only opaque context', async () => {
  const env = setup({ change: change({ status: 'AWAITING_SIGNATURE', canConfirm: false, canSign: true }) });
  await env.api.signOrderChange('dc1', { revision: 3 }); assert.equal(env.navigations.at(-1), '/pages/sign/index?kind=order-change&id=dc1');
  assert.equal(env.storage.get(config.storageKey + ':pending').kind, 'order-change');
  assert.equal(env.calls.filter(value => value.method === 'POST').length, 1); assert.equal(env.calls.find(value => value.method === 'POST').data.revision, 3); assert.deepEqual(env.storage.get(config.storageKey + ':pending'), { kind: 'order-change', id: 'dc1' });
});
test('sign status fresh-reads change revision then POST sync; only archived server SIGNED is success', async () => {
  const env = setup({ change: change({ revision: 8, status: 'AWAITING_SIGNATURE', canSync: true, canConfirm: false }) });
  const result = await env.api.getSignStatus('dc1', 'order-change'); assert.equal(result.status, 'PENDING'); assert.equal(env.calls.at(-1).data.revision, 8);
  const done = setup({ change: change({ canSync: true, canConfirm: false }), signed: true }); assert.equal((await done.api.getSignStatus('dc1', 'order-change')).status, 'SIGNED');
});
test('record page defaults reading unchecked, guards busy and clears consent after changed revision', async () => {
  const env = setup(); const p = page(env); await p.reload(); assert.equal(p.data.changeRead, false);
  await p.confirmChange(); assert.equal(env.calls.some(v => v.method === 'POST'), false);
  p.onChangeRead({ detail: { value: ['change'] } }); await Promise.all([p.confirmChange(), p.confirmChange()]); assert.equal(env.calls.filter(v => v.method === 'POST').length, 1); assert.equal(p.data.changeRead, false);
  env.set(change({ revision: 9 })); await p.reload(); assert.equal(p.data.changeRead, false);
});
test('409/429/network-like errors clear previous action rights and do not show success', async () => {
  for (const failure of [409, 429, 500]) { const env = setup({ failure }); const p = page(env); await p.reload(); p.setData({ changeRead: true }); await p.confirmChange(); assert.equal(p.data.changeRead, false); assert.match(p.data.changeError, /合成失败状态/); assert.doesNotMatch(p.data.message, /成功|已确认/); }
});
test('draft quote stays hidden with no executable customer action, finance stays server-only', async () => {
  const env = setup({ change: change({ status: 'DRAFT', quote: null, canConfirm: false, canReject: false, canSign: false, finance: { obligations: [{ sequence: 1, startDate: period.startDate, endDate: period.endDate, dueDate: period.dueDate, amount: 519900, allocatedAmount: 500000, chargeAmount: 19900, chargeBillId: 'b-diff', chargeStatus: 'PUBLISHED' }], refunds: [{ id: 'r1', amount: 10000, status: 'PENDING', paymentId: 'p1' }], blockers: ['原交易待核对'] } }) });
  const value = await env.api.getOrderChange('dc1'); assert.equal(value.quote, null); assert.equal(value.finance.obligations[0].chargeAmountText, '¥199.00'); assert.equal(value.finance.refunds[0].amountText, '¥100.00'); assert.equal(value.canConfirm, false);
});
test('terminal or missing formal text cannot start signature, and unsigned archive cannot become SIGNED', async () => {
  const env = setup({ change: change({ status: 'APPLIED', canSign: true }) }); await assert.rejects(env.api.signOrderChange('dc1', { revision: 3 }), { code: 'CHANGE_UNAVAILABLE' }); assert.equal(env.calls.some(v => v.method === 'POST'), false);
  env.set(change({ quote: { ...change().quote, document: { ...document, content: '未填变量{{vehicle}}' } }, status: 'AWAITING_SIGNATURE', canSign: true })); await assert.rejects(env.api.signOrderChange('dc1', { revision: 3 }), { code: 'CHANGE_UNAVAILABLE' });
  env.set(change({ canSync: false, contract: { id: 'am1', status: 'SIGNED', signedFileId: null } })); assert.equal((await env.api.getSignStatus('dc1', 'order-change')).status, 'PENDING');
});
test('network readback failures never return cached signing success or retain an accepted page', async () => {
  const env = setup(); const p = page(env); await p.reload(); p.setData({ changeRead: true }); env.fail('NETWORK'); await p.reload(); assert.equal(p.data.change, null); assert.equal(p.data.changeRead, false); assert.ok(p.data.error); await assert.rejects(env.api.getSignStatus('dc1', 'order-change'), { code: 'NETWORK' });
});
test('financial detail links only open ordinary bill records and never invoke payment or refund writes', async () => {
  const env = setup(); const p = page(env); await p.reload(); p.openChangeBill({ currentTarget: { dataset: { id: 'bill-diff' } } }); assert.equal(env.navigations.at(-1), '/pages/record/index?type=bills&id=bill-diff'); assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
test('initial revision-zero draft remains readable without exposing an unpublished quote or action', async () => {
  const env = setup({ change: change({ revision: 0, status: 'DRAFT', canConfirm: true, canSign: true, canReject: true, quote: change().quote }) });
  const value = await env.api.getOrderChange('dc1'); assert.equal(value.revision, 0); assert.equal(value.quote, null); assert.equal(value.canConfirm, false); assert.equal(value.canSign, false); assert.equal(value.canReject, false);
});
test('list summary is readable without loading personal legal body, finance or contract', async () => {
  const env = setup(); const result = await env.api.getOrderChanges(); const item = result.items[0];
  assert.match(item.subtitle, /2026.11.16/); assert.equal('quote' in item, false); assert.equal('document' in item, false); assert.equal('finance' in item, false); assert.equal('contract' in item, false); assert.equal(env.calls.length, 1);
});
test('expired or unverified confirmation deadlines fail closed before POST while confirmed historical quotes stay signable', async () => {
  const env = setup();
  for (const expiresAt of ['2020-01-01T00:00:00Z', null, 'bad', '2099-01-01T00:00:00']) { env.set(change({ quote: { ...change().quote, expiresAt } })); const value = await env.api.getOrderChange('dc1'); assert.equal(value.canConfirm, false); assert.match(value.quote.expiresAtText, /北京时间|期限待核对/); await assert.rejects(env.api.confirmOrderChange('dc1', { revision: 3, commercialHash: value.quote.commercialHash, read: true })); }
  assert.equal(env.calls.some(v => v.method === 'POST'), false);
  env.set(change({ status: 'AWAITING_SIGNATURE', canSign: true, canConfirm: false, quote: { ...change().quote, expiresAt: '2020-01-01T00:00:00Z', confirmedAt: '2019-12-31T08:00:00Z' } })); const confirmed = await env.api.getOrderChange('dc1'); assert.equal(confirmed.canSign, true); assert.equal(confirmed.quote.confirmationExpired, false);
});
test('a deadline passing after display is freshly read and cannot reuse the checked permission', async () => {
  const env = setup(); const p = page(env); await p.reload(); p.setData({ changeRead: true }); env.set(change({ quote: { ...change().quote, expiresAt: '2020-01-01T00:00:00Z' }, canConfirm: false })); await p.confirmChange(); assert.equal(env.calls.some(v => v.method === 'POST'), false); assert.equal(p.data.changeRead, false); assert.equal(p.data.change.quote.confirmationExpired, true); assert.ok(p.data.changeError);
});
