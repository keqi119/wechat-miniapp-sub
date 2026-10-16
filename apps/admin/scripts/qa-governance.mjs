import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
const dbUrl = new URL(process.env.DATABASE_URL); assert.equal(dbUrl.pathname, '/chundian_dev'); assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname));
assert.notEqual(process.env.FADADA_SIGNING_ENABLED, 'true', 'Governance QA must not run with live signing enabled');
const { PrismaClient } = createRequire(import.meta.url)(resolve(import.meta.dirname, '../../api/node_modules/@prisma/client'));
const db = new PrismaClient();
const out = resolve(import.meta.dirname, '../qa');
const prior = JSON.parse(await readFile(resolve(out, 'review-result.json'), 'utf8'));
const customerToken = randomBytes(32).toString('hex'), reviewerPassword = randomBytes(24).toString('base64url');
let application, activeOrder, reviewer;
try {
  application = await db.application.findUniqueOrThrow({ where: { id: prior.applicationId }, include: { vehicle: true, subscriptionPlan: true, finalPlans: { orderBy: { revision: 'desc' }, take: 1 } } });
  await db.customerSession.create({ data: { id: createHash('sha256').update(customerToken).digest('hex'), customerId: application.customerId, expiresAt: new Date(Date.now() + 3600000) } });
  const salt = randomBytes(16).toString('hex'), passwordHash = `${salt}:${scryptSync(reviewerPassword, salt, 64).toString('hex')}`;
  reviewer = await db.adminUser.upsert({ where: { username: 'qa-browser-finance-reviewer' }, create: { username: 'qa-browser-finance-reviewer', name: 'QA 独立财务复核', role: 'FINANCE', passwordHash }, update: { passwordHash, role: 'FINANCE', active: true } });
  // This fixture models an existing ACTIVE subscription for operational actions.
  // It does not create SIGNED contracts, PAID payments, or provider success data.
  const prefix = `qa-active-${application.vehicleId}`;
  const v = application.vehicle, p = application.subscriptionPlan;
  const vehicle = await db.vehicle.upsert({ where: { id: prefix }, update: {}, create: { id: prefix, brand: v.brand, model: v.model, title: 'QA 已有用车运营场景（合成）', year: v.year, city: v.city, mileageKm: 12000, description: '合成运营fixture，未执行真实签署或付款', conditionDisclosure: '合成验收资料' } });
  const plan = await db.subscriptionPlan.upsert({ where: { id: `${prefix}-plan` }, update: {}, create: { id: `${prefix}-plan`, vehicleId: vehicle.id, name: 'QA 运营场景套餐', months: p.months, monthlyFeeAmount: p.monthlyFeeAmount, mileagePerMonthKm: p.mileagePerMonthKm, excessMileagePriceAmount: p.excessMileagePriceAmount, energyDescription: p.energyDescription, benefits: p.benefits, conditions: '仅合成测试' } });
  const activeApp = await db.application.upsert({ where: { id: `${prefix}-app` }, update: {}, create: { id: `${prefix}-app`, customerId: application.customerId, vehicleId: vehicle.id, subscriptionPlanId: plan.id, status: 'FINAL_PLAN_CONFIRMED', profile: { name: 'QA 运营场景' }, consents: [], idempotencyKey: prefix, requestHash: 'qa-only-active-fixture' } });
  activeOrder = await db.order.upsert({ where: { applicationId: activeApp.id }, update: {}, create: { applicationId: activeApp.id, customerId: application.customerId, vehicleId: vehicle.id, status: 'ACTIVE', confirmedMileageKm: 12000, finalPlanSnapshot: application.finalPlans[0] } });
  await db.vehicle.update({ where: { id: vehicle.id }, data: { status: 'IN_USE', reservedOrderId: activeOrder.id } });
} finally { await db.$disconnect(); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { checks: [], errors: [], fixture: 'local chundian_dev / QA ACTIVE scenario; no signed or paid provider states', records: {} };
page.on('pageerror', error => report.errors.push(error.message));
const check = text => { report.checks.push(text); console.log(`PASS ${text}`); };
const field = key => page.locator(`#field-${key}`);
const origin = 'http://127.0.0.1:3100';
async function login(username, password) { await page.getByLabel('工作账号', { exact: true }).fill(username); await page.getByLabel('登录密码', { exact: true }).fill(password); const pending = page.waitForResponse(r => r.url().endsWith('/api/admin/auth/login') && r.request().method() === 'POST'); await page.getByRole('button', { name: '进入工作台', exact: true }).click(); const response = await pending; assert.equal(response.ok(), true); const session = await response.json(); await page.getByRole('navigation', { name: '主导航' }).waitFor(); return session; }
async function openModule(name) { if (await page.getByRole('dialog').isVisible()) await page.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); await page.getByText('正在读取真实数据').waitFor({ state: 'hidden' }); }
async function save(resource) { const pending = page.waitForResponse(r => r.url().endsWith(`/api/admin/${resource}`) && r.request().method() === 'POST'); await page.getByRole('button', { name: '保存资料', exact: true }).click(); const response = await pending; assert.equal(response.ok(), true, `${resource} save status ${response.status()}`); const value = await response.json(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); return value; }
async function upload(key) { const pending = page.waitForResponse(r => r.url().endsWith('/api/admin/files') && r.request().method() === 'POST'); await field(key).setInputFiles({ name: 'qa-evidence.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }); assert.equal((await pending).ok(), true); await page.getByText('正在上传真实文件…').waitFor({ state: 'hidden' }); }
async function action(label, path, fill, confirmation = true) { await page.getByRole('button', { name: label, exact: true }).click(); if (fill) await fill(); if (confirmation) await page.getByRole('checkbox', { name: '我已核对上述业务对象和操作影响' }).check(); const pending = page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST'); await page.getByRole('button', { name: label, exact: true }).click(); const response = await pending; assert.equal(response.ok(), true, `${label} status ${response.status()}`); return response.json(); }
try {
  await page.goto(origin); const admin = await login(process.env.BOOTSTRAP_ADMIN_USERNAME, process.env.BOOTSTRAP_ADMIN_PASSWORD);
  assert.ok(admin.user.permissions.includes('enterprise-seals.write'), 'ESign permissions must be registered before governance QA');
  await openModule('企业印章'); await page.getByRole('button', { name: '新增印章档案', exact: true }).first().click();
  assert.equal(await field('organizationName').inputValue(), '上海晓浪网络科技有限公司');
  const sealName = `QA 未核验印章 ${Date.now().toString(36)}`;
  await field('sealName').fill(sealName); await field('providerCustomerId').fill('qa-unverified-enterprise'); await field('providerSignatureId').fill('qa-unverified-seal'); await upload('evidenceFileId');
  const seal = await save('enterprise-seals'); assert.equal(seal.status, 'DRAFT'); assert.equal(typeof seal.evidenceFileId, 'string'); report.records.sealId = seal.id;
  await page.getByRole('button', { name: sealName, exact: true }).click(); await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button', { name: '核验并启用印章', exact: true }).count(), 0);
  await page.screenshot({ path: resolve(out, 'seal-draft.png'), fullPage: true }); check('real seal draft and evidence upload; creator cannot activate own seal');
  await page.goto(`${origin}/#customers?record=${application.customerId}`); await page.getByText('尚未注册签署账号', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'customer-esign-readiness.png'), fullPage: true }); check('real customer readiness shows unregistered state without fabricated verification');
  await page.goto(`${origin}/#bills`); await page.getByRole('button', { name: '新增费用账单', exact: true }).first().click();
  await field('orderId').selectOption(activeOrder.id); await field('type').selectOption('EXTRA_FEE'); await field('amount').fill('123.45'); await field('dueDate').fill('2026-11-01'); await field('description').fill('QA 合成额外费用，验证独立复核；无真实付款'); await upload('fileIds');
  const bill = await save('bills'); assert.equal(bill.amount, 12345); assert.equal(bill.status, 'DRAFT'); report.records.billId = bill.id;
  await page.goto(`${origin}/#bills?record=${bill.id}`); await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button', { name: '审核费用账单', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '发布账单', exact: true }).count(), 0); check('extra fee real create uses exact cents and creator cannot self-review or publish');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click(); await login(reviewer.username, reviewerPassword);
  await page.goto(`${origin}/#bills?record=${bill.id}`);
  const reviewed = await action('审核费用账单', `/bills/${bill.id}/review`, async () => { await field('decision').selectOption('APPROVED'); await field('note').fill('QA 独立财务复核通过，无真实支付'); }); assert.equal(reviewed.status, 'REVIEWED'); assert.equal(reviewed.reviewedBy, reviewer.id);
  await page.getByRole('button', { name: '发布账单', exact: true }).waitFor(); const published = await action('发布账单', `/bills/${bill.id}/publish`); assert.equal(published.status, 'PENDING');
  await page.screenshot({ path: resolve(out, 'extra-fee-reviewed-published.png'), fullPage: true }); check('independent finance review and subsequent real publication');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click(); await login(process.env.BOOTSTRAP_ADMIN_USERNAME, process.env.BOOTSTRAP_ADMIN_PASSWORD);
  await openModule('车辆交接'); await page.getByRole('button', { name: '新增交接单', exact: true }).first().click(); await field('orderId').selectOption(activeOrder.id); await field('type').selectOption('RETURN'); await field('readingKm').fill('13000'); await upload('fileIds'); for (const [index, value] of ['2026-10-16 上海QA验收点（合成）', '75%', 'QA 合成钥匙与随车工具清单', 'QA 合成车况待客户核对', 'QA 外观未结事项', 'QA 补充外观照片并重新核对', 'QA 现场工作人员'].entries()) await page.getByLabel(`检查结果 ${index + 1}`, { exact: true }).fill(value);
  const handover = await save('handovers'); report.records.handoverId = handover.id;
  await page.goto(`${origin}/#handovers?record=${handover.id}`); await action('发布交接单', `/handovers/${handover.id}/publish`);
  const objection = await page.request.post(`${origin}/api/customer/handovers/${handover.id}/object`, { headers: { Authorization: `Bearer ${customerToken}` }, data: { manifestHash: handover.manifestHash, reason: 'QA 合成客户异议：外观记录需修订', fileIds: [], readFileIds: [], idempotencyKey: `qa-objection-${handover.id}` } }); assert.equal(objection.ok(), true);
  await page.reload(); await page.getByRole('button', { name: '处理异议并修订交接', exact: true }).waitFor();
  const revised = await action('处理异议并修订交接', `/handovers/${handover.id}/revise`, async () => { await page.getByLabel('检查结果 4', { exact: true }).fill('QA 已补充修订说明，待客户重新确认'); await field('resolutionNote').fill('QA 合成异议已受理并重新核对外观'); });
  assert.equal(revised.status, 'DRAFT'); assert.equal(revised.previousHandoverId, handover.id); assert.equal(revised.revision, handover.revision + 1); assert.notEqual(revised.manifestHash, handover.manifestHash);
  await page.getByRole('button', { name: '发布交接单', exact: true }).waitFor(); await page.screenshot({ path: resolve(out, 'handover-objection-revised.png'), fullPage: true }); check('real customer objection and immutable new handover revision');
  const confirmation = await page.request.post(`${origin}/api/customer/applications/${application.id}/confirm`, { headers: { Authorization: `Bearer ${customerToken}` }, data: { revision: application.revision, commercialHash: application.finalPlans[0].commercialHash } }); assert.equal(confirmation.ok(), true); const order = await confirmation.json();
  await page.goto(`${origin}/#orders?record=${order.id}`);
  const cancelled = await action('安全取消订单', `/orders/${order.id}/cancel`, async () => { await field('reason').fill('QA 未交付合成订单取消，无签署或实付'); }); assert.equal(cancelled.status, 'CANCELLED');
  await page.screenshot({ path: resolve(out, 'order-safely-cancelled.png'), fullPage: true }); check('real pre-delivery order safely cancelled without payment or signing');
  assert.deepEqual(report.errors, []); await writeFile(resolve(out, 'governance-result.json'), JSON.stringify(report, null, 2));
} catch (error) { await writeFile(resolve(out, 'governance-result.json'), JSON.stringify({ ...report, failure: error.message }, null, 2)); await page.screenshot({ path: resolve(out, 'governance-failure.png'), fullPage: true }); console.error(error.message); process.exitCode = 1; }
finally { await browser.close(); }
