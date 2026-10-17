import { projectRoot } from '../src/common/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { createApp } from '../src/app';
import { Db } from '../src/common/db';
import { passwordHash, tokenHash } from '../src/auth/auth.service';
import { seedUsageLegal } from './usage-fixtures';
import { listenForHttpTests } from './http-listener';
import type { ESignGateway, PaymentGateway } from '../src/common/gateways';

// HTTP-to-database journey. Only external provider responses and initial actors/legal
// fixtures are simulated; no order, payment, contract or handover status is patched.
let db: Db, app: any, base: string, customerToken: string, otherToken: string;
const origin = 'http://localhost:3100', csrf = randomUUID();
const admins: Record<string, string> = {};
const legal: Record<string, any> = {};
const signing = new Map<string, { customerId: string; documentHash: string; complete: boolean; signedFileId?: string }>();
const payments = new Map<string, { amount: number; complete: boolean }>();
const refunds = new Map<string, { paymentId: string; amount: number; totalAmount: number; complete: boolean }>();
const midnight = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T00:00:00+08:00');
const deliveryAt = new Date(midnight.getTime() - 2 * 86400000 + 10 * 3600000);
const returnAt = new Date(deliveryAt.getTime() + 86400000);
const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(deliveryAt);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function syntheticPdf(customerId: string) {
  const doc = new PDFDocument(), chunks: Buffer[] = [];
  const done = new Promise<Buffer>((yes, no) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => yes(Buffer.concat(chunks))); doc.on('error', no); });
  doc.text('SYNTHETIC LOCAL TEST ONLY - NOT A REAL CONTRACT'); doc.end();
  const bytes = await done, digest = sha(bytes), root = resolve(process.env.UPLOAD_DIR || resolve(projectRoot, 'var/uploads'));
  const storagePath = resolve(root, 'test-order-lifecycle', digest);
  await fs.mkdir(resolve(root, 'test-order-lifecycle'), { recursive: true }); await fs.writeFile(storagePath, bytes);
  return db.storedFile.create({ data: { customerId, name: 'synthetic-archive.pdf', mimeType: 'application/pdf', size: bytes.length, sha256: digest, storagePath, purpose: 'contract' } });
}
const esign: ESignGateway = {
  async create(input) {
    const taskId = `local-sign-${input.contractId}`;
    if (!signing.has(taskId)) signing.set(taskId, { customerId: input.customerId, documentHash: input.documentHash, complete: false });
    return { taskId, status: 'PENDING' };
  },
  async query(taskId) {
    const s = signing.get(taskId); assert.ok(s, 'only this test provider task may be queried');
    if (!s.complete) return { status: 'PENDING', documentHash: s.documentHash };
    s.signedFileId ||= (await syntheticPdf(s.customerId)).id;
    return { status: 'SIGNED', documentHash: s.documentHash, signedFileId: s.signedFileId };
  },
};
const payment: PaymentGateway = {
  async create(input) {
    assert.equal(input.amount, 1, 'each synthetic rent/deposit payment must be exactly one fen');
    payments.set(input.paymentId, { amount: input.amount, complete: false });
    return { timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: 'synthetic', package: 'synthetic', signType: 'RSA', paySign: 'synthetic' };
  },
  async query(id) { const p = payments.get(id); assert.ok(p); return { status: p.complete ? 'SUCCEEDED' : 'PENDING', amount: p.amount, ...(p.complete ? { transactionId: `local-pay-${id}` } : {}) }; },
  async close() { throw Error('unexpected close'); },
  async refund(input) { refunds.set(input.refundId, { ...input, complete: false }); return { status: 'PROCESSING', providerRefundId: `local-refund-${input.refundId}` }; },
  async queryRefund(id) { const r = refunds.get(id); assert.ok(r); return { status: r.complete ? 'SUCCEEDED' : 'PROCESSING', providerRefundId: `local-refund-${id}`, paymentId: r.paymentId, amount: r.amount, totalAmount: r.totalAmount }; },
};
async function request(path: string, body?: unknown, actor = 'admin') {
  const headers: Record<string, string> = { Origin: origin, 'Content-Type': 'application/json' };
  if (admins[actor]) { headers.Cookie = admins[actor]; headers['X-CSRF-Token'] = csrf; }
  else headers.Authorization = `Bearer ${actor === 'other' ? otherToken : customerToken}`;
  const r = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json() as any };
}
async function ok(path: string, body?: unknown, actor?: string) { const r = await request(path, body, actor); assert.equal(r.status, body === undefined ? 200 : 201, `${path}: ${JSON.stringify(r.data)}`); return r.data; }
async function expectStatus(path: string, status: number, body?: unknown, actor?: string) { const r = await request(path, body, actor); assert.equal(r.status, status, `${path}: ${JSON.stringify(r.data)}`); return r.data; }

before(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname === '/chundian_test', 'local isolated chundian_test database required');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; process.env.ADMIN_ORIGIN = origin;
  // Enable only the native route guard in this test process; both providers below
  // are injected local doubles, so these URLs are never contacted.
  process.env.MINIAPP_SIGNING_ENABLED = 'true';
  process.env.FADADA_BASE_URL = 'https://textapi17.fadada.com/api2/';
  process.env.MINIAPP_SIGNING_PROVIDER_HOSTS = 'textapi17.fadada.com,realnameverify16.fadada.com';
  db = new Db(); await seedUsageLegal(db);
  for (const type of ['terms', 'privacy', 'application', 'credit-verification']) {
    const max = await db.legalDocument.aggregate({ where: { type }, _max: { version: true } });
    legal[type] = await db.legalDocument.create({ data: { type, version: (max._max.version || 0) + 1, title: `合成${type}`, content: '仅供本地完整流程测试的合成条款，不适用于真实交易。', status: 'PUBLISHED', confirmedBy: 'synthetic-fixture', confirmedAt: new Date() } });
  }
  for (const role of ['admin', 'reviewer']) {
    const a = await db.adminUser.create({ data: { username: `journey-${randomUUID()}`, name: '合成管理员', role: 'ADMIN', passwordHash: passwordHash(randomUUID()) } });
    const token = randomUUID(); await db.adminSession.create({ data: { id: tokenHash(token), adminId: a.id, csrfToken: csrf, expiresAt: new Date(Date.now() + 3600000) } }); admins[role] = `admin_session=${token}`;
  }
  for (const who of ['customer', 'other']) {
    const c = await db.customer.create({ data: { mobile: randomUUID(), openId: randomUUID(), name: '合成验收客户' } });
    const token = randomUUID(); await db.customerSession.create({ data: { id: tokenHash(token), customerId: c.id, expiresAt: new Date(Date.now() + 3600000) } });
    if (who === 'customer') customerToken = token; else otherToken = token;
  }
  app = await createApp({ db, payment, esign, usageClock: () => new Date() }); base = await listenForHttpTests(app);
});
after(async () => { await app?.close(); await db?.$disconnect(); });

test('one HTTP order reaches completed only after archived signatures, exact payment, physical handovers and deposit refund', async () => {
  const consents = ['terms', 'privacy'].map(t => ({ documentId: legal[t].id, version: legal[t].version }));
  await ok('/customer/consents', { consents }, 'customer');
  const vehicle = await ok('/admin/vehicles', { brand: '合成', model: 'EV', title: '本地闭环测试车', year: 2026, city: '上海', mileageKm: 118000, conditionDisclosure: '本地合成车辆，无真实交付。' });
  const plan = await ok('/admin/plans', { vehicleId: vehicle.id, name: '合成12个月', months: 12, monthlyFeeAmount: 1, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '合成自行充电', benefits: [], conditions: '仅合成测试方案' });
  await ok(`/admin/plans/${plan.id}/activate`, {}); await ok(`/admin/vehicles/${vehicle.id}/publish`, {});
  const application = await ok('/customer/applications', { vehicleId: vehicle.id, subscriptionPlanId: plan.id, profile: { name: '合成验收客户', drivingYears: 3 }, consents: [{ documentId: legal.application.id, version: legal.application.version }], idempotencyKey: randomUUID() }, 'customer');
  await ok(`/admin/applications/${application.id}/review`, { decision: 'IN_REVIEW', note: '合成资料核对' });
  const consent = await ok(`/customer/applications/${application.id}/credit-consent`, { documentId: legal['credit-verification'].id, version: legal['credit-verification'].version, decision: 'ACCEPT', idempotencyKey: randomUUID() }, 'customer');
  const credit = await ok(`/admin/applications/${application.id}/credit-verifications`, { consentId: consent.consent.id, creditRevision: consent.creditRevision, band: 'B700_749', customerPresented: true, idempotencyKey: randomUUID() });
  const commercialTerms = Object.fromEntries(['vehicleIdentification', 'permittedUse', 'conditionDisclosure', 'customerAddress', 'mileageCarryRule', 'excessMileageCalculation', 'usageCosts', 'insuranceDetails', 'maintenanceRule', 'serviceCoverage', 'handoverArrangement', 'earlyTerminationRule', 'depositRefundRule', 'otherFees'].map(key => [key, '本地合成明确条款：' + key]));
  const proposal = await ok(`/admin/applications/${application.id}/final-plan`, { revision: application.revision, creditVerificationId: credit.verification.id, commercialTerms, monthlyFeeAmount: 1, depositAmount: 1, months: 12, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '合成自行充电', benefits: [], conditions: '仅合成测试', startDate, firstDueDate: startDate });
  const confirmation = { revision: proposal.finalPlan.revision, commercialHash: proposal.finalPlan.commercialHash };
  const order = await ok(`/customer/applications/${application.id}/confirm`, confirmation, 'customer');
  assert.equal((await ok(`/customer/applications/${application.id}/confirm`, confirmation, 'customer')).id, order.id);
  const state = async () => (await ok(`/customer/records/orders/${order.id}`, undefined, 'customer')).status;
  assert.equal(await state(), 'AWAITING_SIGNATURE');
  await expectStatus(`/customer/records/orders/${order.id}`, 404, undefined, 'other');
  const contract = await db.contract.findFirstOrThrow({ where: { orderId: order.id } });
  async function sign(kind: 'contracts' | 'handovers', id: string) {
    const task = await ok(`/customer/${kind}/${id}/sign`, {}, 'customer');
    assert.equal((await ok(`/customer/${kind}/${id}/sign-status`, undefined, 'customer')).status, 'PENDING');
    signing.get(task.taskId)!.complete = true;
    const signed = await ok(`/customer/${kind}/${id}/sign-status`, undefined, 'customer'); assert.equal(signed.status, 'SIGNED');
    assert.equal((await ok(`/customer/${kind}/${id}/sign-status`, undefined, 'customer')).signedFileId, signed.signedFileId);
    const bytes = await fetch(base + `/api/customer/files/${signed.signedFileId}`, { headers: { Authorization: `Bearer ${customerToken}` } }); assert.equal(bytes.status, 200); assert.equal(Buffer.from(await bytes.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }
  await sign('contracts', contract.id); assert.equal(await state(), 'AWAITING_PAYMENT');
  const bills = await db.bill.findMany({ where: { orderId: order.id }, orderBy: { sequence: 'asc' } });
  assert.equal(bills.length, 13); assert.ok(bills.every(b => b.amount === 1));
  const deposit = bills.find(b => b.type === 'DEPOSIT')!, rent = bills.find(b => b.type === 'SUBSCRIPTION' && b.sequence === 1)!;
  async function pay(id: string) {
    await ok(`/admin/bills/${id}/publish`, {});
    const payload = { idempotencyKey: randomUUID() }, p = await ok(`/customer/bills/${id}/pay`, payload, 'customer');
    assert.equal((await ok(`/customer/bills/${id}/pay`, payload, 'customer')).paymentId, p.paymentId);
    assert.equal((await ok(`/customer/payments/${p.paymentId}`, undefined, 'customer')).status, 'PENDING');
    payments.get(p.paymentId)!.complete = true;
    assert.equal((await ok(`/customer/payments/${p.paymentId}`, undefined, 'customer')).status, 'SUCCEEDED'); await ok(`/admin/payments/${p.paymentId}/sync`, {});
    return p.paymentId;
  }
  await pay(rent.id); assert.equal(await state(), 'AWAITING_PAYMENT');
  await expectStatus('/admin/handovers', 409, { orderId: order.id, type: 'DELIVERY', actualAt: deliveryAt.toISOString(), readingKm: 118000, fileIds: [], checklist: [{ label: '合成核对', value: '押金未支付不得交付' }] });
  const depositPayment = await pay(deposit.id); assert.equal(await state(), 'AWAITING_HANDOVER');
  const evidenceForm = new FormData(); evidenceForm.set('purpose', 'handover'); evidenceForm.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKe8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'synthetic-odometer.png');
  const uploaded = await fetch(base + '/api/customer/files', { method: 'POST', headers: { Authorization: `Bearer ${customerToken}` }, body: evidenceForm }); assert.equal(uploaded.status, 201); const evidence = await uploaded.json() as any;
  async function handover(type: 'DELIVERY' | 'RETURN', actualAt: Date, readingKm: number) {
    const h = await ok('/admin/handovers', { orderId: order.id, type, actualAt: actualAt.toISOString(), readingKm, fileIds: [evidence.id], checklist: [{ label: '合成交接事实', value: '仅本地测试，无真实车辆交还' }] });
    await ok(`/admin/handovers/${h.id}/publish`, {});
    await expectStatus(`/customer/handovers/${h.id}/confirm`, 400, { manifestHash: h.manifestHash, readFileIds: [], idempotencyKey: randomUUID() }, 'customer');
    await ok(`/customer/handovers/${h.id}/confirm`, { manifestHash: h.manifestHash, readFileIds: [evidence.id], idempotencyKey: randomUUID() }, 'customer');
    await expectStatus(`/admin/handovers/${h.id}/complete`, 409, {});
    await sign('handovers', h.id); await ok(`/admin/handovers/${h.id}/complete`, {}); await expectStatus(`/admin/handovers/${h.id}/complete`, 409, {});
    return h;
  }
  await handover('DELIVERY', deliveryAt, 118000); assert.equal(await state(), 'ACTIVE');
  await handover('RETURN', returnAt, 118010); assert.equal(await state(), 'SETTLING');
  const usage = await ok(`/customer/orders/${order.id}/usage-account`, undefined, 'customer');
  assert.equal(usage.periods[0].status, 'READY');
  await ok(`/admin/usage-periods/${usage.periods[0].id}/settle`, { revision: usage.periods[0].revision, idempotencyKey: randomUUID() });
  let settlement = await ok(`/admin/return-settlements/${usage.returnSettlement.id}`);
  assert.equal(settlement.depositRefundRequiredAmount, 1); assert.equal(settlement.canComplete, false);
  await expectStatus(`/admin/return-settlements/${settlement.id}/complete`, 409, { revision: settlement.revision, idempotencyKey: randomUUID() });
  const refundInput = { paymentId: depositPayment, amount: 1, reason: '合成订单押金核清退还', idempotencyKey: randomUUID() };
  const refund = await ok('/admin/refunds', refundInput); assert.equal((await ok('/admin/refunds', refundInput)).id, refund.id);
  await expectStatus(`/admin/refunds/${refund.id}/approve`, 403, {}); await ok(`/admin/refunds/${refund.id}/approve`, {}, 'reviewer');
  assert.equal((await ok(`/admin/return-settlements/${settlement.id}`)).canComplete, false);
  refunds.get(refund.id)!.complete = true; await ok(`/admin/refunds/${refund.id}/sync`, {}); await ok(`/admin/refunds/${refund.id}/sync`, {});
  settlement = await ok(`/admin/return-settlements/${settlement.id}`); assert.equal(settlement.canComplete, true);
  const finish = { revision: settlement.revision, idempotencyKey: randomUUID() };
  assert.equal((await ok(`/admin/return-settlements/${settlement.id}/complete`, finish)).status, 'COMPLETED');
  assert.equal((await ok(`/admin/return-settlements/${settlement.id}/complete`, finish)).status, 'COMPLETED'); assert.equal(await state(), 'COMPLETED');
  assert.equal(await db.payment.count({ where: { bill: { orderId: order.id } } }), 2);
  assert.equal(await db.depositEntry.count({ where: { orderId: order.id, type: 'RECEIPT' } }), 1);
  assert.equal(await db.depositEntry.count({ where: { orderId: order.id, type: 'REFUND' } }), 1);
  assert.equal(await db.bill.count({ where: { orderId: order.id, type: 'SUBSCRIPTION', sequence: { gt: 1 }, status: 'VOID' } }), 11);
  assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).reservedOrderId, null);
});
