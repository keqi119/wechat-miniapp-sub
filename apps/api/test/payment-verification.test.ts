import {listenForHttpTests} from './http-listener';
import '../src/common/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { Db } from '../src/common/db';
import { tokenHash } from '../src/auth/auth.service';
import { WechatPaymentGateway } from '../src/integrations/wechat-payment';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const origin = 'http://localhost:3100', apiKey = 'v'.repeat(32), suffix = randomUUID();
const provider = new Map<string, any>();
const calls: Array<{ method: string; id: string; data?: any }> = [];
let failCreate = false, failClose = false, createGate: Promise<void> | undefined;
let closeGate: Promise<void> | undefined, queryResponse: (() => Response) | undefined;
let db: Db, app: any, base: string, adminCookie: string, operationsCookie: string, customer: any, token: string;
const csrf = 'verification-test-csrf';
const verification: any = { enabled: true };
function signed(body: any, status = 200) {
  const raw = status === 204 ? '' : JSON.stringify(body), timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'provider-nonce';
  return new Response(raw || null, { status, headers: { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-serial': 'test-cert', 'wechatpay-signature': createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${raw}\n`).sign(keys.privateKey, 'base64') } });
}
verification.gateway = new WechatPaymentGateway({ enabled: true, appId: 'verification-app', merchantId: 'verification-mch', serial: 'merchant-cert', privateKey: keys.privateKey, apiV3Key: apiKey, notifyUrl: 'https://api.invalid/api/callbacks/wechat-pay-verification', refundNotifyUrl: '', verifier: () => keys.publicKey }, async (url, init) => {
  const path = new URL(url).pathname, data = init?.body ? JSON.parse(String(init.body)) : undefined;
  const id = data?.out_trade_no || path.split('/')[5];
  calls.push({ method: init?.method || 'GET', id, data });
  if (path === '/v3/pay/transactions/jsapi') {
    await createGate;
    if (failCreate) throw new Error('synthetic unknown network outcome');
    provider.set(id, provider.get(id) || { appid: 'verification-app', mchid: 'verification-mch', out_trade_no: id, amount: { total: 1, currency: 'CNY' }, payer: { openid: data.payer.openid }, trade_state: 'NOTPAY' });
    return signed({ prepay_id: `private-prepay-${id}` });
  }
  if (path.endsWith('/close')) {
    const gate = closeGate; closeGate = undefined; await gate;
    if (failClose) throw new Error('synthetic close timeout');
    if (!provider.has(id)) return signed({ code: 'ORDER_NOT_EXIST' }, 404);
    provider.get(id).trade_state = 'CLOSED'; return signed({}, 204);
  }
  return queryResponse ? queryResponse() : provider.has(id) ? signed(provider.get(id)) : signed({ code: 'ORDER_NOT_EXIST' }, 404);
});
async function request(path: string, method = 'GET', body?: any, who: 'admin'|'operations'|'customer'|'none' = 'admin', headers: any = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(who === 'admin' || who === 'operations' ? { Cookie: who === 'admin' ? adminCookie : operationsCookie, 'X-CSRF-Token': csrf } : who === 'customer' ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : undefined };
}
async function newCustomer(consented = true, openId = true) {
  const id = randomUUID();
  const c = await db.customer.create({ data: { mobile: `verification-${id}`, ...(openId ? { openId: `private-openid-${id}` } : {}) } });
  const raw = `customer-${id}`;
  await db.customerSession.create({ data: { id: tokenHash(raw), customerId: c.id, expiresAt: new Date(Date.now() + 3600000) } });
  if (consented) {
    for (const type of ['terms', 'privacy']) {
      const doc = await db.legalDocument.findFirstOrThrow({ where: { type, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
      await db.customerConsent.create({ data: { customerId: c.id, documentId: doc.id, type, version: doc.version, source: 'TEST' } });
    }
  }
  customer = c; token = raw; return c;
}
async function authorize() {
  const response = await request('/admin/payment-verifications', 'POST', { customerId: customer.id, authorizationNote: '测试夹具：仅指定客户自愿支付1分验收，不订阅车辆' });
  assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data;
}
async function pay(id: string) { return request(`/customer/payment-verifications/${id}/pay`, 'POST', {}, 'customer'); }
function callback(id: string, changes: any = {}, eventId = `event-${randomUUID()}`) {
  const data = { appid: 'verification-app', mchid: 'verification-mch', out_trade_no: id, transaction_id: `txn-${id}`, trade_state: 'SUCCESS', amount: { total: 1, currency: 'CNY' }, payer: { openid: customer.openId }, ...changes };
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiKey), '012345678901'); cipher.setAAD(Buffer.from('transaction'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  const body = { id: eventId, event_type: 'TRANSACTION.SUCCESS', resource: { algorithm: 'AEAD_AES_256_GCM', nonce: '012345678901', associated_data: 'transaction', ciphertext } };
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'callback-nonce', raw = JSON.stringify(body);
  return { body, headers: { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-serial': 'test-cert', 'wechatpay-signature': createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${raw}\n`).sign(keys.privateKey, 'base64') } };
}
async function deliver(event: ReturnType<typeof callback>) { return request('/callbacks/wechat-pay-verification', 'POST', event.body, 'none', event.headers); }
before(async () => {
  assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));
  process.env.NODE_ENV = 'test'; process.env.ADMIN_ORIGIN = origin;
  db = new Db({ datasourceUrl: process.env.TEST_DATABASE_URL });
  for (const role of ['ADMIN', 'OPERATIONS'] as const) {
    const admin = await db.adminUser.create({ data: { username: `verification-${role}-${suffix}`, name: 'Test', passwordHash: 'not-a-login-password', role } });
    const raw = `admin-${role}-${suffix}`;
    await db.adminSession.create({ data: { id: tokenHash(raw), adminId: admin.id, csrfToken: csrf, expiresAt: new Date(Date.now() + 3600000) } });
    if (role === 'ADMIN') adminCookie = `admin_session=${raw}`; else operationsCookie = `admin_session=${raw}`;
  }
  for (const type of ['terms', 'privacy']) {
    const max = await db.legalDocument.aggregate({ where: { type }, _max: { version: true } });
    await db.legalDocument.create({ data: { type, version: (max._max.version || 0) + 1, title: type, content: 'Synthetic verification consent', status: 'PUBLISHED', confirmedBy: 'fixture', confirmedAt: new Date() } });
  }
  app = await createApp({ db, verification } as any); base = await listenForHttpTests(app);
});
after(async () => { await app?.close(); await db?.$disconnect(); });

test('ADMIN authorizes fixed one-cent records without creating a subscription, with RBAC/CSRF and safe views', async () => {
  await newCustomer();
  const counts = await Promise.all([db.order.count(), db.bill.count(), db.payment.count(), db.contract.count()]);
  const payload = { customerId: customer.id, authorizationNote: '一次1分验收授权' };
  assert.equal((await request('/admin/payment-verifications', 'POST', payload, 'operations')).status, 403);
  assert.equal((await request('/admin/payment-verifications', 'GET', undefined, 'operations')).status, 403);
  assert.equal((await request('/admin/payment-verifications', 'POST', payload, 'admin', { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await request('/admin/payment-verifications', 'POST', { ...payload, amount: 519900 })).status, 400);
  const record = await authorize();
  assert.equal(record.amount, 1); assert.equal(record.currency, 'CNY'); assert.equal(record.status, 'AUTHORIZED'); assert.equal(record.title, '微信支付验收');
  assert.ok(Date.parse(record.expiresAt) - Date.now() > 86300000);
  assert.deepEqual(await Promise.all([db.order.count(), db.bill.count(), db.payment.count(), db.contract.count()]), counts);
  assert.equal((await request('/customer/payment-verifications', 'GET', undefined, 'customer')).data.items[0].id, record.id);
  assert.equal((await request('/admin/payment-verifications')).status, 200);
  assert.equal((await request('/admin/payment-verifications?page=1&pageSize=12&keyword=&status=')).status, 200);
  assert.ok(!JSON.stringify(record).includes(customer.openId));
});

test('concurrent authorizations allow only one nonterminal record per customer', async () => {
  await newCustomer();
  const body = { customerId: customer.id, authorizationNote: '并发授权测试' };
  const results = await Promise.all([request('/admin/payment-verifications', 'POST', body), request('/admin/payment-verifications', 'POST', body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
});

test('ownership, current consent, OpenID, expiry, and disabled capability block channel writes', async () => {
  await newCustomer(false); let r = await authorize(); const start = calls.length;
  assert.equal((await pay(r.id)).data.error.code, 'CONSENT_REQUIRED');
  await newCustomer(true, false); r = await authorize(); assert.equal((await pay(r.id)).data.error.code, 'WECHAT_REQUIRED');
  await newCustomer(); r = await authorize();
  await (db as any).paymentVerification.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await pay(r.id)).status, 409);
  await newCustomer(); assert.equal((await pay(r.id)).status, 404);
  r = await authorize(); verification.enabled = false;
  assert.equal((await pay(r.id)).status, 503);
  assert.equal((await request('/customer/payment-verifications', 'GET', undefined, 'customer')).data.items[0].canPay, false);
  verification.enabled = true; assert.equal(calls.length, start);
});

test('repeated pay uses one channel trade and only pay response contains prepay parameters', async () => {
  await newCustomer(); const r = await authorize(), before = calls.length;
  const first = await pay(r.id), second = await pay(r.id);
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  assert.equal(first.data.verification.id, r.id); assert.equal(first.data.paymentParams.package, second.data.paymentParams.package);
  assert.equal(calls.length - before, 1); assert.equal(calls.at(-1)!.data.amount.total, 1);
  assert.equal(Date.parse(calls.at(-1)!.data.time_expire), Date.parse(r.expiresAt), 'channel expiry must match the authorization, not default to days later');
  const trade = (await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).tradeNo;
  assert.ok(/^pv_[a-zA-Z0-9_-]{1,29}$/.test(trade));
  for (const view of [(await request('/customer/payment-verifications', 'GET', undefined, 'customer')).data, (await request('/admin/payment-verifications')).data]) {
    const json = JSON.stringify(view); assert.ok(!json.includes('private-openid')); assert.ok(!json.includes('private-prepay')); assert.ok(!json.includes('paySign'));
  }
});

test('uncertain create retains original trade and one concurrent recovery lease', async () => {
  await newCustomer(); const r = await authorize(); failCreate = true;
  assert.equal((await pay(r.id)).status, 503); failCreate = false;
  const saved = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(saved.status, 'CREATING'); assert.equal((await pay(r.id)).status, 409);
  await (db as any).paymentVerification.update({ where: { id: r.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  let release!: () => void; createGate = new Promise(resolve => { release = resolve; });
  const pending = pay(r.id);
  // Observe the persisted lease rather than relying on a fixed sleep.
  for (let i = 0; i < 100; i++) { const row = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } }); if (row.leaseUntil > new Date()) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  const competing = await pay(r.id); release(); createGate = undefined;
  assert.equal(competing.status, 409); assert.equal((await pending).status, 201);
  assert.equal((await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).tradeNo, saved.tradeNo);
  assert.equal(calls.filter(c => c.method === 'POST' && c.data?.out_trade_no === saved.tradeNo).length, 2);
});

test('expired cached credentials query then recreate the same trade; unknown status never creates another', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  const row = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  await (db as any).paymentVerification.update({ where: { id: r.id }, data: { clientParameters: { ...row.clientParameters, timeStamp: '1' }, leaseUntil: null } });
  const count = calls.length; assert.equal((await pay(r.id)).status, 201);
  assert.equal(calls[count].method, 'GET'); assert.equal(calls[count + 1].data.out_trade_no, row.tradeNo);
  provider.get(row.tradeNo).trade_state = 'UNKNOWN';
  const result = await request(`/customer/payment-verifications/${r.id}/query`, 'POST', {}, 'customer');
  assert.equal(result.status, 502); assert.equal((await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).status, 'PENDING');
});

test('verified channel query settles once and a successful customer cannot receive another authorization', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  const row = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  Object.assign(provider.get(row.tradeNo), { trade_state: 'SUCCESS', transaction_id: `txn-${row.tradeNo}` });
  const a = await request(`/customer/payment-verifications/${r.id}/query`, 'POST', {}, 'customer');
  assert.equal(a.data.status, 'SUCCEEDED'); assert.ok(a.data.paidAt); assert.equal(a.data.canPay, false);
  assert.equal((await request('/admin/payment-verifications', 'POST', { customerId: customer.id, authorizationNote: '重复实收禁止' })).status, 409);
  assert.equal((await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {})).status, 409);
  assert.equal((await pay(r.id)).status, 409);
});

test('unsigned, unknown, unstarted, wrong owner/amount/currency/app/merchant callbacks never settle or pollute formal events', async () => {
  await newCustomer(); const r = await authorize(), before = await db.providerEvent.count();
  let row = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal((await deliver(callback(row.tradeNo))).status, 409);
  await pay(r.id); row = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  const bad = callback(row.tradeNo); bad.headers['wechatpay-signature'] = 'invalid'; assert.equal((await deliver(bad)).status, 400);
  assert.equal((await deliver(callback('pv_unknown_record'))).status, 404);
  for (const changes of [{ amount: { total: 2, currency: 'CNY' } }, { amount: { total: 1, currency: 'USD' } }, { appid: 'wrong-app' }, { mchid: 'wrong-merchant' }, { payer: { openid: 'wrong-owner' } }]) assert.ok((await deliver(callback(row.tradeNo, changes))).status >= 400);
  assert.equal((await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).status, 'PENDING');
  assert.equal(await db.providerEvent.count(), before);
  assert.notEqual((await request('/callbacks/wechat-pay-verification', 'GET', undefined, 'none')).status, 200);
});

test('signed callback and query race settle atomically, replay is idempotent, conflicting transaction is rejected', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  const row = await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  Object.assign(provider.get(row.tradeNo), { trade_state: 'SUCCESS', transaction_id: `txn-${row.tradeNo}` });
  const event = callback(row.tradeNo), before = await db.providerEvent.count();
  const results = await Promise.all([deliver(event), deliver(event), request(`/customer/payment-verifications/${r.id}/query`, 'POST', {}, 'customer')]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 204, 204]);
  assert.equal((await deliver(event)).status, 204);
  assert.equal((await deliver(callback(row.tradeNo, { transaction_id: 'conflicting-txn' }))).status, 409);
  assert.equal((await deliver(callback(row.tradeNo, {}, event.body.id))).status, 204);
  assert.equal(await db.providerEvent.count(), before);
  assert.equal(await db.auditLog.count({ where: { resourceType: 'payment-verifications', resourceId: r.id, action: 'PAYMENT_VERIFIED' } }), 1);
});

test('failed close retains unknown trade, confirmed close terminates without reopening, expiry cannot hide pending trade', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  await (db as any).paymentVerification.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request('/admin/payment-verifications', 'POST', { customerId: customer.id, authorizationNote: '仍有渠道单' })).status, 409);
  failClose = true; assert.equal((await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {})).status, 503); failClose = false;
  assert.equal((await (db as any).paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).status, 'PENDING');
  await (db as any).paymentVerification.update({ where: { id: r.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  assert.equal((await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {})).data.status, 'CLOSED');
  assert.equal((await pay(r.id)).status, 409);
});

test('unstarted authorization closes without a channel request, and customer detail remains private', async () => {
  await newCustomer(); const r = await authorize(), before = calls.length;
  assert.equal((await request(`/admin/payment-verifications/${r.id}`)).data.customerId, customer.id);
  assert.equal((await request(`/admin/payment-verifications/${r.id}`, 'GET', undefined, 'customer')).status, 401);
  const closed = await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {});
  assert.equal(closed.data.status, 'CLOSED'); assert.equal(closed.data.canClose, false);
  assert.equal(calls.length, before);
  assert.equal((await request(`/customer/payment-verifications/${r.id}/query`, 'POST', {}, 'customer')).data.status, 'CLOSED');
});

test('a changed WeChat binding cannot reuse payment credentials or advertise canPay', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  await db.customer.update({ where: { id: customer.id }, data: { openId: 'different-bound-openid-' + randomUUID() } });
  assert.equal((await pay(r.id)).data.error.code, 'VERIFICATION_IDENTITY_CHANGED');
  assert.equal((await request('/customer/payment-verifications', 'GET', undefined, 'customer')).data.items[0].canPay, false);
});

test('expired uncertain create requires grace and verified absence, ends authorization but permanently blocks another charge', async () => {
  await newCustomer(); const r = await authorize(); failCreate = true;
  assert.equal((await pay(r.id)).status, 503); failCreate = false;
  const row = await db.paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  await db.paymentVerification.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000), leaseUntil: null } });
  assert.equal((await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {})).status, 404);
  assert.equal((await db.paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).status, 'CREATING');
  await db.paymentVerification.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 11 * 60000), leaseUntil: null } });
  queryResponse = () => new Response(JSON.stringify({ code: 'ORDER_NOT_EXIST' }), { status: 404 });
  assert.equal((await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {})).status, 400);
  queryResponse = undefined;
  assert.equal((await db.paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).status, 'CREATING');
  await db.paymentVerification.update({ where: { id: r.id }, data: { leaseUntil: null } });
  const closed = await request(`/admin/payment-verifications/${r.id}/close`, 'POST', {});
  assert.equal(closed.status, 201); assert.equal(closed.data.status, 'EXPIRED');
  assert.equal(closed.data.manualReviewRequired, true); assert.match(closed.data.statusMessage, /人工核对/);
  assert.equal(closed.data.canPay, false); assert.equal(closed.data.canClose, false);
  assert.equal((await request('/admin/payment-verifications', 'POST', { customerId: customer.id, authorizationNote: '不能因缺单再次扣款' })).status, 409);
  assert.equal((await deliver(callback(row.tradeNo))).status, 204);
  assert.equal((await db.paymentVerification.findUniqueOrThrow({ where: { id: r.id } })).status, 'SUCCEEDED');
});

test('stale close completion cannot override a new lease or its provider result', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  let release!: () => void; closeGate = new Promise(resolve => { release = resolve; });
  const before = calls.length, pending = request(`/admin/payment-verifications/${r.id}/close`, 'POST', {});
  for (let i = 0; i < 100 && !calls.slice(before).some(c => c.method === 'POST'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  await db.paymentVerification.update({ where: { id: r.id }, data: { leaseToken: 'new-owner', leaseUntil: new Date(Date.now() + 45000) } });
  release();
  assert.equal((await pending).status, 409);
  const row = await db.paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  assert.equal(row.status, 'PENDING'); assert.equal(row.leaseToken, 'new-owner');
});

test('close response arriving after a verified success never rewrites the paid record', async () => {
  await newCustomer(); const r = await authorize(); await pay(r.id);
  const row = await db.paymentVerification.findUniqueOrThrow({ where: { id: r.id } });
  let release!: () => void; closeGate = new Promise(resolve => { release = resolve; });
  const before = calls.length, pending = request(`/admin/payment-verifications/${r.id}/close`, 'POST', {});
  for (let i = 0; i < 100 && !calls.slice(before).some(c => c.method === 'POST'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await deliver(callback(row.tradeNo))).status, 204); release();
  assert.equal((await pending).data.status, 'SUCCEEDED');
  assert.equal(await db.auditLog.count({ where: { resourceId: r.id, action: 'CLOSE_VERIFICATION' } }), 0);
});
