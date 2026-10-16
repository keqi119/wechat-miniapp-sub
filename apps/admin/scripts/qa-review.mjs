import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
const dbUrl = new URL(process.env.DATABASE_URL);
assert.equal(dbUrl.pathname, '/chundian_dev', 'QA seed is restricted to chundian_dev');
assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname), 'QA seed is restricted to local database');
const require = createRequire(import.meta.url);
const { PrismaClient } = require(resolve(import.meta.dirname, '../../api/node_modules/@prisma/client'));
const prisma = new PrismaClient();
const out = resolve(import.meta.dirname, '../qa');
const prior = JSON.parse(await readFile(resolve(out, 'result.json'), 'utf8'));
const applicationId = `qa-admin-browser-${prior.records.vehicleId}`;
let application;
try {
  const customer = await prisma.customer.upsert({ where: { mobile: '13900009901' }, update: { name: 'QA 后台浏览器验收' }, create: { mobile: '13900009901', name: 'QA 后台浏览器验收', profile: { name: 'QA 后台浏览器验收', drivingYears: 5, note: '独立开发数据库合成验收资料' } } });
  application = await prisma.application.upsert({ where: { id: applicationId }, update: {}, create: { id: applicationId, customerId: customer.id, vehicleId: prior.records.vehicleId, subscriptionPlanId: prior.records.planId, profile: { name: 'QA 后台浏览器验收', drivingYears: 5, fileIds: [], note: '合成验收资料，无真实客户或法律效力' }, consents: [], idempotencyKey: applicationId, requestHash: 'qa-only-browser-review-fixture' } });
} finally { await prisma.$disconnect(); }
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const report = { applicationId, checks: [], errors };
const check = text => { report.checks.push(text); console.log(`PASS ${text}`); };
try {
  await page.goto('http://127.0.0.1:3100/');
  await page.getByLabel('工作账号', { exact: true }).fill(process.env.BOOTSTRAP_ADMIN_USERNAME);
  await page.getByLabel('登录密码', { exact: true }).fill(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  const dashboard = page.waitForResponse(r => r.url().endsWith('/api/admin/dashboard'));
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  assert.equal((await dashboard).ok(), true);
  await page.getByText('正在读取真实数据').waitFor({ state: 'hidden' });
  await page.screenshot({ path: resolve(out, 'dashboard-desktop.png'), fullPage: true });
  check('dashboard response loaded before screenshot');
  await page.goto(`http://127.0.0.1:3100/#applications?record=${encodeURIComponent(applicationId)}`);
  await page.getByRole('dialog').waitFor();
  if (['SUBMITTED', 'NEEDS_INFO', 'IN_REVIEW'].includes(application.status)) {
    await page.getByRole('button', { name: '受理审核', exact: true }).click();
    await page.locator('#field-note').fill('QA 合成资料已核验，进入最终方案流程；无真实交易。');
    const review = page.waitForResponse(r => r.url().endsWith(`/applications/${applicationId}/review`));
    await page.getByRole('button', { name: '受理审核', exact: true }).click();
    const response = await review; assert.equal(response.ok(), true); assert.equal((await response.json()).status, 'IN_REVIEW');
    await page.getByRole('button', { name: '发布最终方案', exact: true }).waitFor();
    check('application review and latest state reread');
  }
  await page.getByRole('button', { name: '发布最终方案', exact: true }).click();
  assert.equal(await page.locator('#field-revision').getAttribute('readonly'), '');
  assert.equal(await page.locator('#field-monthlyFeeAmount').inputValue(), '2999.29');
  await page.locator('#field-depositAmount').fill('6000.50');
  await page.locator('#field-startDate').fill('2026-11-01');
  await page.locator('#field-firstDueDate').fill('2026-11-01');
  const commercialTerms = {
    vehicleIdentification: 'QA 合成车辆识别信息 TESTVIN0000000001', permittedUse: 'QA 仅供验收，不用于真实驾驶或交易', conditionDisclosure: 'QA 合成车况披露，无实际交付车辆', customerAddress: 'QA 合成联系地址，上海验收路1号',
    mileageCarryRule: 'QA 本验收方案里程不结转', excessMileageCalculation: 'QA 按结构化超里程单价计算，不产生真实收费', usageCosts: 'QA 用于验证费用责任条款展示，无实际用车支出', insuranceDetails: 'QA 合成保险说明，不对应任何真实保险或保单',
    maintenanceRule: 'QA 合成保养责任说明', serviceCoverage: 'QA 合成权益覆盖说明，不承诺实际服务', handoverArrangement: 'QA 合成交还车安排，不实施真实交付', earlyTerminationRule: 'QA 合成提前解约规则，不产生真实解约费用', depositRefundRule: 'QA 合成押金结算规则，不实施真实退款', otherFees: '不适用',
  };
  for (const [key, value] of Object.entries(commercialTerms)) await page.locator(`#commercial-${key}`).fill(value);
  await page.getByRole('checkbox', { name: '我已核对上述业务对象和操作影响' }).check();
  const finalResponse = page.waitForResponse(r => r.url().endsWith(`/applications/${applicationId}/final-plan`));
  await page.getByRole('button', { name: '发布最终方案', exact: true }).click();
  const response = await finalResponse; assert.equal(response.ok(), true);
  const updated = await response.json();
  assert.equal(updated.status, 'AWAITING_CONFIRMATION');
  assert.equal(updated.finalPlan.monthlyFeeAmount, 299929);
  assert.equal(updated.finalPlan.depositAmount, 600050);
  assert.deepEqual(updated.finalPlan.commercialTerms, commercialTerms);
  assert.equal(updated.revision, application.revision + 1);
  assert.equal(updated.commercialHash.length, 64);
  await page.getByRole('button', { name: '发布最终方案', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'application-final-plan.png'), fullPage: true });
  check('versioned final plan uses exact cents and server commercial hash');
  await page.reload(); await page.getByRole('dialog').waitFor();
  await page.getByText(updated.commercialHash, { exact: true }).first().waitFor();
  check('final-plan detail restores and rereads after reload');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'application-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  check('390px final-plan detail has no viewport overflow');
  report.revision = updated.revision; report.commercialHash = updated.commercialHash;
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'review-result.json'), JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(resolve(out, 'review-result.json'), JSON.stringify({ ...report, failure: error.message }, null, 2));
  await page.screenshot({ path: resolve(out, 'review-failure.png'), fullPage: true }); console.error(error.message); process.exitCode = 1;
} finally { await browser.close(); }
