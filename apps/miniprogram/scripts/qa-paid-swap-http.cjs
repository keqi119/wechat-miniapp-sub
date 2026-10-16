// Local synthetic API acceptance only; never calls any native payment SDK.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { createApi } = require('../src/services/api'), config = require('../src/config');
const root = path.resolve(__dirname, '../../..'), fixturePath = path.join(root, '.runtime/b3-ui-acceptance.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8').replace(/^\uFEFF/, ''));
assert.equal(fixture.syntheticOnly, true); assert.equal(fixture.database, 'chundian_b3_ui_acceptance');
assert.match(fixture.apiBase, /^http:\/\/127\.0\.0\.1:3191\/api\/?$/);
const base = fixture.apiBase.replace(/\/$/, ''), storage = new Map(), calls = [];
async function transport(route, method = 'GET', data, headers = {}) {
  assert.ok(route.startsWith('/')); assert.equal(/payment-verification|callbacks|fadada|\/sign$/.test(route), false);
  const response = await fetch(base + route, { method, headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  const body = await response.json(); calls.push({ method, route, status: response.status }); return { statusCode: response.status, data: body };
}
const wx = { getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: k => storage.delete(k), login: v => v.success({ code: 'synthetic-b3-native-login' }), requestPayment() { throw Error('Forbidden: no native payment invocation in local HTTP acceptance'); } };
const api = createApi({ ...config, apiBase: 'http://127.0.0.1:3101/api' }, options => { const route = options.url.slice('http://127.0.0.1:3101/api'.length); transport(route, options.method, options.data, options.header).then(options.success, options.fail); }, wx);
function input(account) { const t = account.purchaseTerms; assert.ok(t); return { productId: account.product.id, termsVersion: t.version, termsDocumentId: t.documentId, termsDocumentVersion: t.documentVersion, termsHash: t.hash, accepted: true }; }
async function main() {
  await api.loginSms(fixture.customer.mobile, fixture.customer.code, fixture.customer.consents);
  if (process.argv[2] === '--read-state') {
    const expected = process.argv[3]; assert.ok(['REFUND_PENDING', 'ACTIVE'].includes(expected));
    const ids = JSON.parse(fs.readFileSync(path.join(root, '.runtime/b3-native-customer-http.json'), 'utf8'));
    assert.equal(ids.syntheticOnly, true); assert.equal(ids.orderId, fixture.orderId);
    const purchase = await api.getSwapCreditPurchase(fixture.orderId, ids.activePurchaseId), account = await api.getSwapAccount(fixture.orderId);
    assert.equal(purchase.status, expected); assert.equal(purchase.bill.paidAmount, 80000); assert.equal(purchase.canPay, false);
    assert.ok(purchase.refunds.length > 0); assert.equal(purchase.refunds.every(v => v.status === 'REJECTED'), expected === 'ACTIVE');
    if (expected === 'REFUND_PENDING') { assert.ok(account.paidFrozen > 0); assert.equal(purchase.canClose, false); }
    else { assert.ok(account.paidAvailable > 0); assert.ok(account.ledger.some(v => v.type === 'RESTORE')); }
    const report = { generatedAt: new Date().toISOString(), scope: 'Customer safe readback against local synthetic HTTP fixture after independent admin action; no channel query or SDK.', status: purchase.status, purchaseId: purchase.id, creditId: purchase.creditId, billPaidAmount: purchase.bill.paidAmount, refundStatuses: purchase.refunds.map(v => v.status), canPay: purchase.canPay, canClose: purchase.canClose, statusText: purchase.statusText, statusMessage: purchase.statusMessage, counters: { available: account.paidAvailable, reserved: account.paidReserved, consumed: account.paidConsumed, frozen: account.paidFrozen, expired: account.paidExpired }, ledgerTypes: account.ledger.map(v => v.type), calls };
    const out = 'evidence/paid-swap-http/customer-' + expected.toLowerCase() + '.json'; fs.writeFileSync(path.join(__dirname, '..', out), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ syntheticOnly: true, readOnly: true, status: expected, httpCalls: calls.length, report: out })); return;
  }
  const initial = await api.getSwapAccount(fixture.orderId); assert.equal(initial.canPurchase, true); assert.equal(initial.product.amount, 80000);
  const first = await api.createSwapCredit(fixture.orderId, input(initial)); assert.equal(first.purchase.status, 'PENDING_PAYMENT'); assert.equal((await api.getSwapAccount(fixture.orderId)).paidAvailable, initial.paidAvailable);
  assert.equal((await api.querySwapCreditPurchase(fixture.orderId, first.purchase.id)).status, 'PENDING_PAYMENT');
  const closed = await api.closeSwapCreditPurchase(fixture.orderId, first.purchase.id); assert.equal(closed.status, 'VOID');
  const funded = await api.createSwapCredit(fixture.orderId, input(await api.getSwapAccount(fixture.orderId)));
  // Validate the existing ordinary bill/pay contract with the local DI gateway;
  // discard credentials immediately and never hand them to wx.requestPayment.
  const payment = await transport('/customer/bills/' + encodeURIComponent(funded.bill.id) + '/pay', 'POST', { idempotencyKey: randomUUID() }, { Authorization: 'Bearer ' + storage.get(config.storageKey).token });
  assert.equal(payment.statusCode, 201); assert.equal(typeof payment.data.paymentId, 'string'); for (const k of ['timeStamp','nonceStr','package','signType','paySign']) assert.equal(typeof payment.data[k], 'string');
  const paymentId = payment.data.paymentId; payment.data = undefined;
  let active = await api.querySwapCreditPurchase(fixture.orderId, funded.purchase.id); if (active.status === 'PENDING_PAYMENT') active = await api.querySwapCreditPurchase(fixture.orderId, funded.purchase.id);
  assert.equal(active.status, 'ACTIVE'); assert.equal(active.bill.paidAmount, 80000); assert.equal(active.paymentId, paymentId); assert.ok(active.creditId);
  const account = await api.getSwapAccount(fixture.orderId); assert.equal(account.paidAvailable, initial.paidAvailable + 1);
  const pending = await api.createSwapCredit(fixture.orderId, input(account)); assert.equal(pending.purchase.status, 'PENDING_PAYMENT');
  assert.equal(calls.some(v => /payment-verification/.test(v.route)), false);
  const shared = { syntheticOnly: true, apiBase: base, orderId: fixture.orderId, closedPurchaseId: first.purchase.id, activePurchaseId: active.id, activePaymentId: paymentId, pendingPurchaseId: pending.purchase.id };
  fs.writeFileSync(path.join(root, '.runtime/b3-native-customer-http.json'), JSON.stringify(shared, null, 2) + '\n');
  const report = { generatedAt: new Date().toISOString(), scope: 'Real local HTTP against independent synthetic UI acceptance database and DI gateway. No real channel/PII, native payment SDK, production, preview or upload.', checks: { fixed80000: true, independentTerms: true, pendingDoesNotGrant: true, unpaidQueryStaysPending: true, originalUnpaidCloseVoid: true, ordinaryBillPayContract: true, nativePaymentInvocations: 0, trustedQueryActive: true, accountDelta: 1, multipleSeparatePurchases: true, verificationPaths: 0 }, ...shared, calls };
  fs.mkdirSync(path.join(__dirname, '../evidence/paid-swap-http'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '../evidence/paid-swap-http/customer.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ syntheticOnly: true, checks: Object.keys(report.checks).length, httpCalls: calls.length, report: 'evidence/paid-swap-http/customer.json', sharedIds: '.runtime/b3-native-customer-http.json' }));
}
main().catch(error => { console.error(JSON.stringify({ name: error.name, code: error.code || 'LOCAL_HTTP_QA_FAILED', statusCode: error.statusCode || null })); process.exitCode = 1; });
