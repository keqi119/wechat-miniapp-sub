const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApi } = require('../src/services/api');

// Local transport only. These fixtures exercise the shipped JS without API TypeScript or a database.
const ORDER = 'lease-order';
const PERIOD = 'lease-month';
const KIND = 'MILEAGE_PACK';
const input = {
  productId: 'lease-product', versionId: 'lease-version', quoteId: 'q1000',
  sourceHash: 'a'.repeat(64), periodId: PERIOD,
  termsVersion: 'MILEAGE_PACK_V2', termsHash: 'b'.repeat(64), accepted: true,
};
function directory() {
  return {
    orderId: ORDER, kind: KIND, eligible: true, blockers: [], targetModels: [],
    context: { periodId: PERIOD, startDate: '2026-11-02', endDate: '2026-12-02', expiresAt: '2026-12-01T16:00:00Z', serviceStageId: 'lease-stage', assignmentId: 'lease-assignment', modelDefinitionId: 'lease-model' },
    terms: { version: input.termsVersion, hash: input.termsHash, content: '合成本地月包说明，仅原月有效。' },
    products: [{ productId: input.productId, versionId: input.versionId, sourceHash: input.sourceHash, version: 1, name: '合成租约月包', quotes: [1000, 1500, 2000].map((km, i) => ({ quoteId: 'q' + km, km, amount: [31007, 43009, 51011][i], currency: 'CNY' })) }],
  };
}
function receipt(suffix) {
  return {
    purchase: { id: 'pack-' + suffix, billId: 'bill-' + suffix, status: 'PENDING_PAYMENT', km: 1000, amount: 31007, ruleVersion: 'MILEAGE_PACK_V2', periodId: PERIOD, expiresAt: '2026-12-01T16:00:00Z' },
    bill: { id: 'bill-' + suffix, amount: 31007, status: 'PENDING' },
  };
}
function unpaidRow(suffix) {
  const r = receipt(suffix);
  return {
    ...r.purchase, remainingKm: 0, canUseNow: false, canPay: true, effectiveStatus: 'PENDING_PAYMENT',
    bill: { ...r.bill, type: KIND, paidAmount: 0 },
    paymentReview: { required: false, reason: null, reasons: [], unresolvedReceiptCount: 0 },
    paymentFacts: { receiptCount: 0, receivedAmount: 0, refundedAmount: 0, netReceivedAmount: 0, pendingRefundCount: 0 },
  };
}
function environment() {
  const sessionKey = 'lease-test-session';
  const storage = new Map([[sessionKey, { token: 'same-token', customer: { id: 'lease-customer', role: 'CUSTOMER' }, expiresAt: '2099-01-01T00:00:00Z' }]]);
  const calls = [], navigations = [];
  let handler;
  const platform = {
    getStorageSync: key => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
  };
  const reply = (request, statusCode, data) => request.success({ statusCode, data: structuredClone(data) });
  const forbidden = (request, statusCode = 403) => reply(request, statusCode, { error: { code: statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: '合成访问已失效' } });
  const isPost = request => request.method === 'POST' && request.url.endsWith('/mileage-packs');
  function fallback(request) {
    if (request.url.endsWith('/addon-products')) return reply(request, 200, directory());
    if (isPost(request)) return reply(request, 201, receipt('B'));
    if (request.url.endsWith('/usage-account')) return reply(request, 200, { orderId: ORDER, packs: [unpaidRow('A'), unpaidRow('B')] });
    return forbidden(request, 404);
  }
  const request = value => {
    calls.push({ method: value.method, url: value.url, data: structuredClone(value.data) });
    return handler ? handler(value, () => fallback(value)) : fallback(value);
  };
  const newApi = () => createApi({ apiBase: 'http://localhost:3101', storageKey: sessionKey }, request, platform);
  return {
    api: newApi(), newApi, calls, navigations, reply, forbidden, isPost,
    handle(value) { handler = value; },
    rotate(token = 'same-token', role = 'UPDATED_CUSTOMER') {
      storage.set(sessionKey, { ...storage.get(sessionKey), token, customer: { id: 'lease-customer', role } });
    },
  };
}
const turn = () => new Promise(setImmediate);
const posts = e => e.calls.filter(call => call.method === 'POST');
function page(e) {
  const filename = path.resolve(__dirname, '../src/pages/records/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, wx: { setNavigationBarTitle() {} },
    require: id => id.includes('services/index') ? e.api : id === '../../utils/page' ? { load: async () => {}, go: url => e.navigations.push(url) } : require(path.resolve(path.dirname(filename), id)),
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  p.onLoad({ type: 'addons', orderId: ORDER, kind: KIND });
  return p;
}
async function loseNewRequest(e) {
  e.handle((request, fallback) => e.isPost(request) ? request.fail() : fallback());
  await assert.rejects(e.newApi().createAddonPurchase(ORDER, KIND, input), error => error.code === 'NETWORK');
  const expected = posts(e).at(-1).data;
  assert.equal(e.api.getAddonPurchaseState(ORDER, KIND).state, 'UNKNOWN');
  return expected;
}
async function retryNewRequest(e, expected) {
  assert.equal(e.api.getAddonPurchaseState(ORDER, KIND).state, 'UNKNOWN');
  e.handle(null);
  const restored = await e.newApi().recoverAddonPurchase(ORDER, KIND);
  assert.deepEqual(posts(e).at(-1).data, expected);
  assert.equal(restored.bill.id, 'bill-B');
  assert.equal(e.api.getAddonPurchaseState(ORDER, KIND).state, 'COMMITTED');
}

for (const late of ['accepted', 'raw403']) test('same-token new access preserves UNKNOWN B after old POST ' + late, async () => {
  const e = environment();
  let held;
  e.handle((request, fallback) => { if (e.isPost(request)) { held = request; return; } return fallback(); });
  const old = e.api.createAddonPurchase(ORDER, KIND, input);
  await turn();
  const oldBody = posts(e)[0].data;
  e.handle((request, fallback) => request.url.endsWith('/addon-products') ? e.forbidden(request) : fallback());
  await assert.rejects(e.api.getAddonProducts(ORDER, KIND));
  const expected = await loseNewRequest(e);
  assert.notEqual(expected.idempotencyKey, oldBody.idempotencyKey);
  if (late === 'accepted') e.reply(held, 201, receipt('A')); else e.forbidden(held);
  await assert.rejects(old, error => error.code === 'ADDON_ACCESS_REVOKED');
  await retryNewRequest(e, expected);
});

for (const change of ['role', 'token']) test('late old-' + change + ' raw403 cannot discard the newer UNKNOWN intent', async () => {
  const e = environment();
  let held;
  e.handle((request, fallback) => { if (request.url.endsWith('/addon-products')) { held = request; return; } return fallback(); });
  const old = e.api.getAddonProducts(ORDER, KIND);
  await turn();
  e.rotate(change === 'token' ? 'new-token' : 'same-token');
  const expected = await loseNewRequest(e);
  e.forbidden(held);
  await assert.rejects(old, error => error.code === 'SESSION_CHANGED');
  await retryNewRequest(e, expected);
});

test('old Page catch clears only its own private view and preserves newer UNKNOWN body/key', async () => {
  const e = environment(), p = page(e);
  await p.reloadAddon();
  p.selectAddonQuote({ currentTarget: { dataset: { key: 'lease-version:q1000' } } });
  p.onAddonAccepted({ detail: { value: ['addon'] } });
  let held;
  e.handle((request, fallback) => { if (e.isPost(request)) { held = request; return; } return fallback(); });
  const oldSubmit = p.submitAddon();
  await turn();
  assert.ok(held);
  e.handle((request, fallback) => request.url.endsWith('/addon-products') ? e.forbidden(request) : fallback());
  await assert.rejects(e.api.getAddonProducts(ORDER, KIND));
  const expected = await loseNewRequest(e);
  e.forbidden(held);
  await oldSubmit;
  for (const key of ['addonCatalog', 'addonPending', 'addonReceipt', 'addonSelected']) assert.equal(p.data[key], null, key);
  assert.equal(p.data.addonAccepted, false);
  assert.equal(p.data.addonSheet, false);
  await retryNewRequest(e, expected);
});

test('a Page with an old receipt cannot revoke the newer intent when its bill no longer matches', async () => {
  const e = environment();
  e.handle((request, fallback) => e.isPost(request) ? e.reply(request, 201, receipt('A')) : fallback());
  await e.api.createAddonPurchase(ORDER, KIND, input);
  const p = page(e);
  await p.reloadAddon();
  assert.equal(p.data.addonReceipt.bill.id, 'bill-A');
  e.api.finishAddonPurchase(ORDER, KIND);
  const expected = await loseNewRequest(e);
  p.openAddonBill();
  assert.equal(e.navigations.length, 0);
  assert.equal(p.data.addonReceipt, null);
  await retryNewRequest(e, expected);
});

test('public vehicle reads do not inspect a customer session or capture an add-on lease', async () => {
  const seen = [];
  const api = createApi({ apiBase: 'http://localhost:3101' }, request => {
    seen.push(request);
    request.success({ statusCode: 200, data: { vehicle: { id: 'public-car', available: true, title: '合成公开车型' }, plans: [] } });
  }, { getStorageSync() { throw new Error('Public vehicle reads must not read session storage'); } });
  const result = await api.getVehicle('public-car');
  assert.equal(result.vehicle.id, 'public-car');
  assert.equal(seen[0].header.Authorization, undefined);
});
