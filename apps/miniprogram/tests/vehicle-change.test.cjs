const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const { vehicle, assignment, account, period, change } = require('./fixtures/b2.cjs');
function setup(extra = {}) {
  let current = extra.account || account(), failure = extra.failure;
  const calls = [], navigations = [], storage = new Map([[config.storageKey, { token: 'synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' } }]]);
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast() {}, showModal: v => v.success({ confirm: true }), setNavigationBarTitle() {}, navigateTo: v => { navigations.push(v.url); v.success?.({}); }, requestPayment() { throw Error('B2 cannot purchase swap credits'); }, request(v) {
    calls.push(v); const route = v.url.replace(/^https:\/\/[^/]+\/api/, '');
    if (failure === 'NETWORK') return v.fail({ errMsg: 'synthetic network failure' });
    if (failure && v.method === 'POST') return v.success({ statusCode: failure, data: { error: { code: 'STATE_CONFLICT', message: '合成失败' } } });
    let data;
    if (route.endsWith('/swap-account')) data = current;
    else if (route.endsWith('/vehicle-changes')) data = { id: 'vc1', kind: 'VEHICLE_CHANGE' };
    else if (route === '/customer/order-changes/vc1') data = extra.change || change();
    else if (route === '/customer/records/entitlements') data = { items: [], total: 0 };
    else if (route === '/customer/dashboard') data = extra.dashboard || { subscription: { id: 'o1', orderId: 'o1', vehicleName: '合成旧车' } };
    else if (extra.route) data = extra.route(route, v);
    else throw Error('Unexpected route ' + route);
    v.success({ statusCode: 200, data });
  } };
  return { api: createApi(config, v => wx.request(v), wx), wx, calls, navigations, storage, set: v => { current = v; }, fail: v => { failure = v; } };
}
function page(env, name, options = {}) {
  global.wx = env.wx; let definition; global.Page = v => { definition = v; };
  for (const file of ['../src/services/index', '../src/pages/' + name + '/index']) delete require.cache[require.resolve(file)];
  require('../src/pages/' + name + '/index');
  const p = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } }; p.onLoad?.(options); return p;
}
test('swap account authenticates and displays only authoritative free availability, reservations and consumption', async () => {
  const env = setup({ account: account({ cycle: { ...account().cycle, freeAvailable: 0, freeReserved: 1 }, reservations: [{ id: 'r1', changeId: 'vc1', source: 'FREE', cycleSequence: 1, status: 'RESERVED' }], ledger: [{ id: 'l1', type: 'RESERVE', source: 'FREE', cycleSequence: 1, changeId: 'vc1', actualAt: null, recordedAt: '2026-10-16T01:00:00Z' }], canRequest: false }) });
  const result = await env.api.getSwapAccount('o1'); assert.equal(env.calls[0].header.Authorization, 'Bearer synthetic'); assert.equal(result.cycle.freeAvailable, 0); assert.equal(result.cycle.freeReserved, 1); assert.equal(result.cycle.freeConsumed, 0); assert.match(result.ledger[0].typeText, /预占/); assert.equal(result.canPurchase, false); assert.equal(result.canRequest, false);
  env.storage.clear(); await assert.rejects(env.api.getSwapAccount('o1'), { code: 'AUTH_REQUIRED' });
});
test('swap account rejects wrong order, invalid counts and unknown assignment states without inventing a current car', async () => {
  const env = setup(); for (const raw of [account({ orderId: 'other' }), account({ cycle: { ...account().cycle, freeAvailable: -1 } }), account({ currentAssignment: assignment({ status: 'MAGIC' }) })]) { env.set(raw); await assert.rejects(env.api.getSwapAccount('o1'), { code: 'RESPONSE' }); }
  env.set(account({ currentAssignment: null, canRequest: false })); const result = await env.api.getSwapAccount('o1'); assert.equal(result.currentAssignment, null); assert.match(result.currentVehicleText, /待交付|暂无/);
});
test('request needs a reason and a fresh server capability, never spends a free credit or invokes payment', async () => {
  const env = setup(); await assert.rejects(env.api.requestVehicleChange('o1', { reason: '' })); env.set(account({ canRequest: false })); await assert.rejects(env.api.requestVehicleChange('o1', { reason: '希望换车' }), { code: 'SWAP_UNAVAILABLE' }); assert.equal(env.calls.some(v => v.method === 'POST'), false);
  env.set(account()); const result = await env.api.requestVehicleChange('o1', { reason: ' 希望换车 ' }); assert.equal(result.id, 'vc1'); const post = env.calls.find(v => v.method === 'POST'); assert.deepEqual(Object.keys(post.data).sort(), ['idempotencyKey', 'reason']); assert.equal(post.data.reason, '希望换车'); assert.equal((await env.api.getSwapAccount('o1')).cycle.freeAvailable, 1); assert.equal(env.calls.some(v => /swap-purchases|\/pay/.test(v.url)), false);
});
test('request retry after an unknown response reuses the same key and conflicts do not fabricate success', async () => {
  const env = setup({ failure: 500 }); await assert.rejects(env.api.requestVehicleChange('o1', { reason: '希望换车' })); env.fail(null); await env.api.requestVehicleChange('o1', { reason: '希望换车' }); const posts = env.calls.filter(v => v.method === 'POST'); assert.equal(posts[0].data.idempotencyKey, posts[1].data.idempotencyKey);
  for (const code of [403, 409, 429, 503, 'NETWORK']) { const e = setup({ failure: code }); await assert.rejects(e.api.requestVehicleChange('o1', { reason: '希望换车' })); }
});
test('vehicle quote preserves original months and server money, fixed finance-before-return gate and complete document', async () => {
  const env = setup(); const result = await env.api.getOrderChange('vc1'); assert.equal(result.kind, 'VEHICLE_CHANGE'); assert.equal(result.title, '换车补充方案'); assert.equal(result.targetVehicle.title, '合成新车'); assert.equal(result.currentAssignment.vehicle.title, '合成旧车'); assert.equal(result.quote.newStartDate, '2026-09-16'); assert.equal(result.quote.handoverFeeAmountText, '¥500.00'); assert.match(result.quote.financialGateText, /交旧车前|旧车交还前/); assert.equal(result.finance.adjustments[0].id, 'fee1'); assert.equal(result.canConfirm, true);
});
test('missing replacement legal text, wrong document type and changed or expired quote cannot be confirmed', async () => {
  for (const q of [{ ...change().quote, document: null }, { ...change().quote, document: { ...change().quote.document, type: 'delivery-delay-amendment' } }, { ...change().quote, document: { ...change().quote.document, content: '{{targetVehicle}}' } }, { ...change().quote, expiresAt: '2020-01-01T00:00:00Z' }, { ...change().quote, financialGate: 'AFTER_RETURN' }]) { const env = setup({ change: change({ quote: q }) }); const result = await env.api.getOrderChange('vc1'); assert.equal(result.canConfirm, false); await assert.rejects(env.api.confirmOrderChange('vc1', { revision: 3, commercialHash: q.commercialHash, read: true })); assert.equal(env.calls.some(v => v.method === 'POST'), false); }
  const env = setup({ change: change({ revision: 4 }) }); await assert.rejects(env.api.confirmOrderChange('vc1', { revision: 3, commercialHash: change().quote.commercialHash, read: true }), { code: 'CHANGE_STALE' });
});
test('segment reading binds one vehicle assignment and its own odometer baseline, never the old car cumulative reading', async () => {
  const segments = [{ id: 's-old', assignmentId: 'a-old', vehicleId: 'v-old', vehicleTitle: '合成旧车', startAt: '2026-09-16T02:00:00Z', endAt: '2026-10-10T02:00:00Z', startReadingKm: 90000, endReadingKm: 90500, readingId: null, status: 'READY', revision: 1, canSubmit: false }, { id: 's-new', assignmentId: 'a-new', vehicleId: 'v-new', vehicleTitle: '合成新车', startAt: '2026-10-10T03:00:00Z', endAt: null, startReadingKm: 20, endReadingKm: null, readingId: null, status: 'OPEN', revision: 1, canSubmit: true }];
  const usage = { orderId: 'o1', orderStatus: 'ACTIVE', policyVersion: 'USAGE_V1', startedOn: '2026-09-16', returnedOn: null, baseAllowanceKm: 1500, excessPriceAmount: 150, packBalanceKm: 1000, packStatus: 'ACTIVE', currentAssignment: assignment({ id: 'a-new', vehicle: vehicle('v-new'), startReadingKm: 20 }), periods: [{ ...period, id: 'up1', effectiveEndDate: '2026-10-16', status: 'AWAITING_READING', revision: 1, startReadingKm: 90000, endReadingKm: null, canSubmit: true, segments }], packs: [], ledger: [], products: [], purchaseTerms: null, canPurchase: false };
  const env = setup({ route: (route, v) => route.endsWith('/usage-account') ? usage : route === '/customer/usage-segments/s-new/readings' ? { id: 'mr1', segmentId: 's-new', status: 'SUBMITTED' } : (() => { throw Error(route); })() });
  const current = await env.api.getUsageAccount('o1'); assert.equal(current.periods[0].segments[1].vehicleTitle, '合成新车'); assert.equal(current.periods[0].usedKm, null);
  const payload = { orderId: 'o1', periodId: 'up1', segmentId: 's-new', readingKm: 120, recordedAt: '2026-10-16T00:00:00Z', fileIds: ['photo-new'] }; const saved = await env.api.submitUsageReading(payload); assert.equal(saved.id, 'mr1'); const post = env.calls.find(v => v.method === 'POST'); assert.ok(post.url.endsWith('/usage-segments/s-new/readings')); assert.equal(post.data.vehicleId, undefined); assert.equal(post.data.assignmentId, undefined); assert.equal(post.data.usedKm, undefined);
  for (const bad of [{ ...payload, segmentId: '' }, { ...payload, segmentId: 's-old' }, { ...payload, segmentId: 'other' }, { ...payload, readingKm: 10 }, { ...payload, recordedAt: '2026-10-15T00:00:00Z' }]) await assert.rejects(env.api.submitUsageReading(bad));
  const form = page(env, 'mileage', { orderId: 'o1' }); await form.reload(); form.selectUsagePeriod({ detail: { value: 'up1' } }); assert.equal(form.data.selectedSegment, null); form.selectUsageSegment({ detail: { value: 's-new' } }); assert.equal(form.data.selectedSegment.vehicleTitle, '合成新车'); assert.equal(form.data.boundaryDate, '2026-10-16'); form.setData({ reading: '120', attachments: [{ id: 'photo-new' }], recordedDate: '2026-10-16', recordedTime: '08:00' }); await form.submit(); assert.equal(form.data.submitted.segmentId, 's-new');
  form.setData({ reading: '999', attachments: [{ id: 'old-selection-photo' }] }); usage.periods[0].revision = 2; usage.periods[0].segments[1].revision = 2; await form.reload(); assert.equal(form.data.reading, ''); assert.deepEqual(form.data.attachments, []);
  usage.periods[0].status = 'SETTLED'; await assert.rejects(env.api.submitUsageReading(payload)); usage.periods[0].status = 'AWAITING_READING'; usage.periods[0].segments = []; await assert.rejects(env.api.submitUsageReading({ ...payload, segmentId: undefined })); assert.equal(env.calls.some(v => v.url.includes('/usage-periods/') && v.method === 'POST'), false);
});
test('entitlement page can read free credits even if usage is unavailable; request is busy guarded and opens only the real created record', async () => {
  const env = setup({ route: () => { throw Error('合成里程读取失败'); } }); const p = page(env, 'records', { type: 'entitlements', orderId: 'o1' }); await p.reload(); assert.equal(p.data.swap.cycle.freeAvailable, 1); assert.ok(p.data.usageError); assert.equal(p.data.swapReason, ''); await p.requestSwap(); assert.equal(env.calls.some(v => v.method === 'POST'), false); p.inputSwapReason({ detail: { value: '希望换车' } }); await Promise.all([p.requestSwap(), p.requestSwap()]); assert.equal(env.calls.filter(v => v.method === 'POST').length, 1); assert.ok(env.navigations.some(url => url === '/pages/record/index?type=orderchanges&id=vc1')); assert.equal(p.data.swap.canPurchase, false);
});
test('two physical sides open their own handover IDs and a no-car gap is not described as an active old vehicle', async () => {
  const r = { id: 'return1', type: 'SWAP_RETURN', vehicleId: 'v-old', assignmentId: 'a-old', status: 'COMPLETED', signatureStatus: 'SIGNED', actualAt: '2026-10-10T02:00:00Z', readingKm: 90500, manifestHash: 'r'.repeat(64) };
  const env = setup({ change: change({ status: 'SWAP_RETURNED', currentAssignment: null, returnHandover: r, deliveryHandover: { ...r, id: 'delivery1', type: 'SWAP_DELIVERY', vehicleId: 'v-new', assignmentId: null, status: 'PUBLISHED', signatureStatus: 'DRAFT', readingKm: 20 } }), route: route => route.startsWith('/customer/handovers/') ? { ...r, id: route.split('/').pop(), vehicleTitle: '合成旧车', changeId: 'vc1', fileIds: [], checklist: [] } : undefined });
  const p = page(env, 'record', { type: 'orderchanges', id: 'vc1' }); await p.reload(); assert.equal(p.data.change.currentAssignment, null); assert.match(p.data.change.statusText, /待交新车/); p.openChangeHandover({ currentTarget: { dataset: { id: 'return1' } } }); assert.equal(env.navigations.at(-1), '/pages/handover/index?id=return1');
  const h = page(env, 'handover', { id: 'return1' }); await h.reload(); assert.equal(h.data.handover.id, 'return1'); assert.equal(h.data.handover.actualAtValid, true); assert.match(h.data.handover.actualAtLabel, /旧车/); assert.equal(h.data.subscription.vehicleName, '合成旧车');
});
test('dashboard explicitly null current assignment suppresses old vehicle projection and use page links to active change or swap account', async () => {
  const env = setup({ dashboard: { subscription: { id: 'o1', orderId: 'o1', vehicleName: '旧车已还不得冒充当前', imageUrl: '/old.png', currentAssignment: null, activeChangeId: 'vc1' } } }); const dashboard = await env.api.getDashboard(); assert.match(dashboard.subscription.vehicleName, /待交付|暂无/); assert.equal(dashboard.subscription.imageUrl, ''); const p = page(env, 'use'); await p.reload(); p.openVehicleChange(); assert.equal(env.navigations.at(-1), '/pages/record/index?type=orderchanges&id=vc1'); p.openSwapAccount(); assert.equal(env.navigations.at(-1), '/pages/records/index?type=entitlements&orderId=o1');
});
test('vehicle-change summary omits body and preserves target; confirmed swap signature opens only H5 guidance even after confirmation deadline', async () => {
  const raw = change({ status: 'AWAITING_SIGNATURE', originalAssignment: assignment({ status: 'CLOSED', endAt: '2026-10-10T02:00:00Z', endReadingKm: 90500 }), canConfirm: false, canSign: true, quote: { ...change().quote, confirmedAt: '2019-12-31T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' } });
  const summary = { id: raw.id, orderId: raw.orderId, kind: raw.kind, status: raw.status, revision: raw.revision, reason: raw.reason, createdAt: raw.createdAt, quoteSummary: { ...raw.quote, targetVehicleId: 'v-new', targetVehicleTitle: '合成新车' } };
  const env = setup({ change: raw, route: route => route === '/customer/order-changes' ? { items: [summary], total: 1, page: 1, pageSize: 50 } : route === '/public/signing-config' ? { mode: 'SERVICE_ACCOUNT_H5', entryUrl: 'https://app.subauto.keybox.cloud/miniapp-sign/', enabled: true } : undefined });
  const list = await env.api.getOrderChanges({ kind: 'VEHICLE_CHANGE' }); assert.equal(list.items[0].title, '换车补充方案'); assert.match(list.items[0].subtitle, /合成新车/); assert.equal(list.items[0].quote, undefined); const detail = await env.api.getOrderChange('vc1'); assert.equal(detail.originalAssignment.endReadingKm, 90500); await env.api.signOrderChange('vc1', { revision: 3 }); assert.equal(env.navigations.at(-1), '/pages/sign/index?kind=order-change&id=vc1'); assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
test('swap confirmation requires the customer checkbox and posts only current server revision/hash, then clears the read flag', async () => {
  const env = setup({ route: route => route.endsWith('/confirm') ? change({ status: 'AWAITING_SIGNATURE', revision: 4, canConfirm: false, canSign: true }) : undefined });
  const p = page(env, 'record', { type: 'orderchanges', id: 'vc1' }); await p.reload(); assert.equal(p.data.changeRead, false); await p.confirmChange(); assert.equal(env.calls.some(v => v.method === 'POST'), false); p.onChangeRead({ detail: { value: ['change'] } }); await p.confirmChange(); const post = env.calls.find(v => v.method === 'POST'); assert.equal(post.data.revision, 3); assert.equal(post.data.commercialHash, change().quote.commercialHash); assert.equal(post.data.amount, undefined); assert.equal(post.data.targetVehicleId, undefined); assert.equal(p.data.changeRead, false);
});
test('confirmation retains frozen vehicle identities even when live title changes; assignment history remains distinct and read only', async () => {
  const env = setup({ change: change({ targetVehicle: { ...vehicle('v-new'), title: '后续运营修改的标题' } }), account: account({ assignments: [assignment({ status: 'CLOSED', endAt: '2026-10-10T02:00:00Z', endReadingKm: 90500 }), assignment({ id: 'a-new', vehicle: vehicle('v-new'), startReadingKm: 20 })] }) });
  const detail = await env.api.getOrderChange('vc1'); assert.equal(detail.quote.oldVehicleIdentification, '冻结旧车 VIN SYNTHETIC-OLD'); assert.equal(detail.quote.targetVehicleIdentification, '冻结新车 VIN SYNTHETIC-NEW'); const accountView = await env.api.getSwapAccount('o1'); assert.equal(accountView.assignments[0].endReadingKm, 90500); assert.equal(accountView.assignments[1].startReadingKm, 20); assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
test('recovery quote preserves its latest signed baseline and original finance source while confirming only the fresh version', async () => {
  const old = { id: 'return1', type: 'SWAP_RETURN', vehicleId: 'v-old', assignmentId: 'a-old', status: 'COMPLETED', signatureStatus: 'SIGNED', actualAt: '2026-10-10T02:00:00Z', readingKm: 90500 };
  const raw = change({ recoveryOnly: true, currentAssignment: null, originalAssignment: assignment({ status: 'CLOSED', endAt: old.actualAt, endReadingKm: 90500 }), returnHandover: old, quote: { ...change().quote, id: 'q3', revision: 3, previousQuoteId: 'q2', recoveryFromQuoteId: 'q2', financeSourceQuoteId: 'q1' } });
  const env = setup({ change: raw, route: route => route.endsWith('/confirm') ? { ...raw, status: 'AWAITING_SIGNATURE', revision: 4, canConfirm: false, canSign: true } : undefined }); const detail = await env.api.getOrderChange('vc1'); assert.equal(detail.quote.isRecovery, true); assert.equal(detail.quote.recoveryFromQuoteId, 'q2'); assert.equal(detail.quote.financeSourceQuoteId, 'q1'); assert.equal(detail.returnHandover.completed, true); assert.match(detail.returnHandover.actionText, /查看已完成/);
  const p = page(env, 'record', { type: 'orderchanges', id: 'vc1' }); await p.reload(); assert.equal(p.data.changeRead, false); await p.confirmChange(); assert.equal(env.calls.some(v => v.method === 'POST'), false); p.onChangeRead({ detail: { value: ['change'] } }); await p.confirmChange(); const post = env.calls.find(v => v.method === 'POST'); assert.deepEqual(Object.keys(post.data).sort(), ['commercialHash', 'idempotencyKey', 'revision']); assert.equal(post.data.commercialHash, raw.quote.commercialHash); assert.equal(p.data.changeRead, false);
});
test('malformed recovery links fail closed instead of presenting an original funding plan as a fresh charge', async () => {
  const raw = change({ recoveryOnly: true, quote: { ...change().quote, financeSourceQuoteId: 'q1', recoveryFromQuoteId: null } }); const env = setup({ change: raw }); await assert.rejects(env.api.getOrderChange('vc1'), { code: 'RESPONSE' }); await assert.rejects(env.api.confirmOrderChange('vc1', { revision: 3, commercialHash: raw.quote.commercialHash, read: true })); assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
test('rejecting an unsigned recovery reads the restored latest signed version without repeating the completed old handover', async () => {
  const old = { id: 'return1', type: 'SWAP_RETURN', vehicleId: 'v-old', status: 'COMPLETED', signatureStatus: 'SIGNED', actualAt: '2026-10-10T02:00:00Z', readingKm: 90500 };
  const raw = change({ recoveryOnly: true, currentAssignment: null, returnHandover: old, quote: { ...change().quote, id: 'q3', revision: 3, recoveryFromQuoteId: 'q2', financeSourceQuoteId: 'q1' } }); const restored = { ...raw, status: 'SWAP_RETURNED', revision: 4, canConfirm: false, canReject: false, quote: { ...raw.quote, id: 'q2', revision: 2, recoveryFromQuoteId: 'q1' }, contract: { id: 'am2', status: 'SIGNED', signedFileId: 'signed2' } };
  const env = setup({ change: raw, route: route => route.endsWith('/reject') ? restored : undefined }); const result = await env.api.rejectOrderChange('vc1', { revision: 3, reason: '不接受本次新安排' }); assert.equal(result.quote.id, 'q2'); assert.equal(result.quote.financeSourceQuoteId, 'q1'); assert.equal(result.currentAssignment, null); assert.equal(result.returnHandover.completed, true); assert.equal(result.canConfirm, false); assert.equal(env.calls.filter(v => v.method === 'POST').length, 1); assert.ok(env.calls.at(-1).url.endsWith('/reject'));
});
module.exports = { vehicle, assignment, account, setup, page };
