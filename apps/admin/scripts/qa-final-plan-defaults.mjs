import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.ADMIN_QA_ORIGIN || 'http://127.0.0.1:4312';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = new URL('../../../.runtime/ninda/final-plan-defaults-20261029/qa/', import.meta.url);
await mkdir(out, { recursive: true });
const report = { mode: 'localhost synthetic API interception; no real business actions', checks: [], writes: [], errors: [], external: [] };
const keys = ['vehicleIdentification', 'permittedUse', 'conditionDisclosure', 'customerAddress', 'mileageCarryRule', 'excessMileageCalculation', 'usageCosts', 'insuranceDetails', 'maintenanceRule', 'serviceCoverage', 'handoverArrangement', 'earlyTerminationRule', 'depositRefundRule', 'otherFees'];
const commercialTerms = Object.fromEntries(keys.map((key, index) => [key, `${index + 1}：接口默认商业约定，仅用于本地合成验收。`]));
commercialTerms.conditionDisclosure = '车辆实际车况以现场查验、影像及双方签署的交接单为依据。';
const sourceHash = 'f'.repeat(64);
const defaults = { applicationId: 'qa-app', revision: 3, source: { productId: 'qa-product', productVersionId: 'qa-product-v4', version: 4, name: '接口读取的二十四期产品', hash: sourceHash }, values: { monthlyFeeAmount: 572300, months: 24, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '接口能源说明：包含电池租金', benefits: ['接口产品权益'], conditions: '接口产品适用条件', commercialTerms, productSourceHash: sourceHash }, missingFields: [] };
const credit = { applicationId: 'qa-app', creditRevision: 2, ruleVersion: 'ZHIMA_MANUAL_V1', status: 'VERIFIED', document: { id: 'qa-doc', type: 'credit-verification', version: 1, title: '合成信用说明', content: '仅本地测试' }, consent: { id: 'qa-consent', status: 'ACCEPTED', documentId: 'qa-doc', version: 1 }, verification: { id: 'qa-verification', consentId: 'qa-consent', band: 'B700_749', verifiedBy: 'qa-operator' }, canFinalize: true, canVerify: false };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function scenario(name, { width = 1440, previous = false, firstFailure = false, role = 'ADMIN' } = {}, run) {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const application = { id: 'qa-app', customerId: 'qa-customer', vehicleId: 'qa-vehicle', subscriptionPlanId: 'qa-subscription', status: 'IN_REVIEW', revision: 3, vehicle: { title: '合成车辆' }, profile: { name: '合成客户' }, subscriptionPlan: { monthlyFeeAmount: 100000, months: 12, mileagePerMonthKm: 1, excessMileagePriceAmount: 1, energyDescription: '过时套餐缓存', conditions: '过时套餐缓存', benefits: [] }, ...(previous ? { finalPlan: { id: 'qa-final', revision: 3, monthlyFeeAmount: 560000, months: 24, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: defaults.values.energyDescription, benefits: defaults.values.benefits, conditions: defaults.values.conditions, startDate: '2026-11-01', firstDueDate: '2026-10-31', priceAdjustmentReason: '已记录的调价原因', commercialTerms: { otherFees: '已保存的本单人工约定，必须保留。' } } } : {}) };
  let reads = 0; let submitted; let failDefaults = firstFailure;
  page.on('pageerror', error => report.errors.push(error.message));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== new URL(base).origin) { report.external.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice(4);
    if (req.method() !== 'GET') {
      assert.equal(path, '/admin/applications/qa-app/final-plan');
      assert.equal(req.method(), 'POST');
      submitted = req.postDataJSON();
      report.writes.push({ scenario: name, path, fields: Object.keys(submitted) });
      assert.equal(submitted.productSourceHash, sourceHash);
      assert.ok(submitted.idempotencyKey?.length >= 8);
      return route.fulfill({ json: { ...application, revision: 4 } });
    }
    let data = { items: [], total: 0, page: 1, pageSize: 20 };
    if (path === '/admin/auth/me') data = { user: { id: 'qa-admin', username: 'qa', name: '合成验收', role, permissions: role === 'SUPPORT' ? ['applications.read'] : ['*'] }, csrfToken: 'qa-only' };
    else if (path === '/public/config') data = { mvpV2Enabled: true };
    else if (path === '/admin/applications') data = { ...data, items: [application], total: 1 };
    else if (path === '/admin/applications/qa-app') data = application;
    else if (path === '/admin/applications/qa-app/credit-review') data = credit;
    else if (path === '/admin/applications/qa-app/final-plan-defaults') {
      reads++;
      if (failDefaults) return route.fulfill({ status: 503, json: { error: { code: 'QA_PRODUCT_UNAVAILABLE', message: '合成产品接口暂不可用' } } });
      data = defaults;
    }
    else if (path === '/admin/applications/qa-app/risk-reviews') data = { current: { status: 'PENDING' } };
    else if (path === '/admin/customers/qa-customer/qualifications') data = { items: [], revision: 0 };
    else if (path.endsWith('/customer-profile')) return route.fulfill({ status: 404, json: { error: { code: 'QA_PROFILE', message: '合成资料未提供' } } });
    return route.fulfill({ json: data });
  });
  try {
    await page.goto(`${base}/#applications?record=qa-app`);
    if (role === 'SUPPORT') {
      await page.getByText('当前账号无权访问此模块', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '生成待审方案', exact: true }).count(), 0);
      assert.equal(reads, 0);
    } else {
      await page.getByRole('button', { name: '生成待审方案', exact: true }).click();
      await run(page, { readCount: () => reads, submitted: () => submitted, allowDefaults: () => { failDefaults = false; } });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no viewport overflow');
      for (const drawer of await page.locator('.drawer').all()) assert.equal(await drawer.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'no drawer overflow');
      await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
    }
    report.checks.push(name);
  } catch (error) {
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-failed.png`, out)) });
    await writeFile(new URL(`${name}-failed.html`, out), await page.content());
    throw error;
  } finally { await context.close(); }
}
try {
  await scenario('product-defaults-edit-submit', {}, async (page, state) => {
    await page.locator('#commercial-conditionDisclosure').waitFor();
    assert.equal(await page.locator('.commercial-field textarea').count(), 14);
    for (const key of keys) assert.equal(await page.locator(`#commercial-${key}`).inputValue(), commercialTerms[key]);
    assert.equal(await page.locator('[id$="-field-monthlyFeeAmount"]:visible').inputValue(), '5723.00');
    assert.equal(await page.locator('[id$="-field-months"]:visible').inputValue(), '24');
    assert.equal(await page.locator('[id$="-field-mileagePerMonthKm"]:visible').inputValue(), '1500');
    assert.equal(await page.locator('[id$="-field-excessMileagePriceAmount"]:visible').inputValue(), '1.50');
    assert.equal(await page.locator('[id$="-field-energyDescription"]:visible').inputValue(), defaults.values.energyDescription);
    await page.screenshot({ path: fileURLToPath(new URL('product-defaults-form-desktop.png', out)) });
    await page.locator('#commercial-otherFees').fill('人工补充：仅本地验收，不产生真实费用。');
    const beforeReload = state.readCount();
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/final-plan-defaults')),
      page.getByRole('button', { name: '重新读取产品', exact: true }).click(),
    ]);
    await page.getByRole('button', { name: '重新读取产品', exact: true }).waitFor();
    assert.equal(state.readCount(), beforeReload + 1);
    assert.match(await page.locator('#commercial-otherFees').inputValue(), /人工补充/);
    await page.locator('#commercial-permittedUse').fill('临时编辑后恢复');
    await page.getByRole('button', { name: '恢复允许用途与使用限制默认条款', exact: true }).click();
    assert.equal(await page.locator('#commercial-permittedUse').inputValue(), commercialTerms.permittedUse);
    assert.match(await page.locator('#commercial-otherFees').inputValue(), /人工补充/);
    await page.locator('[id$="-field-monthlyFeeAmount"]:visible').fill('5800.00');
    await page.locator('[id$="-field-priceAdjustmentReason"]:visible').fill('合成月费调整');
    assert.equal(await page.locator('[id$="-field-depositAmount"]:visible').inputValue(), '5800.00');
    await page.locator('[id$="-field-startDate"]:visible').fill('2026-11-01');
    await page.locator('[id$="-field-firstDueDate"]:visible').fill('2026-10-31');
    await page.getByRole('checkbox', { name: '我已核对上述业务对象和操作影响' }).check();
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/final-plan') && response.request().method() === 'POST'),
      page.locator('.record-form').getByRole('button', { name: '生成待审方案', exact: true }).click(),
    ]);
    assert.equal(state.submitted().monthlyFeeAmount, 580000);
    assert.equal(state.submitted().months, 24);
    assert.match(state.submitted().commercialTerms.otherFees, /人工补充/);
    assert.equal(state.submitted().commercialTerms.conditionDisclosure, commercialTerms.conditionDisclosure);
  });
  await scenario('saved-terms-preserved-mobile', { width: 390, previous: true }, async page => {
    await page.locator('#commercial-otherFees').waitFor();
    assert.equal(await page.locator('#commercial-otherFees').inputValue(), '已保存的本单人工约定，必须保留。');
    assert.equal(await page.locator('#commercial-conditionDisclosure').inputValue(), commercialTerms.conditionDisclosure);
    assert.equal(await page.locator('[id$="-field-monthlyFeeAmount"]:visible').inputValue(), '5600.00');
    await page.locator('#commercial-otherFees').fill('修改后保留。');
    await page.locator('[id$="-field-startDate"]:visible').fill('2026-11-02');
    assert.equal(await page.locator('#commercial-otherFees').inputValue(), '修改后保留。');
    await page.locator('#commercial-conditionDisclosure').scrollIntoViewIfNeeded();
  });
  await scenario('defaults-failure-retry', { firstFailure: true }, async (page, state) => {
    await page.getByText('合成产品接口暂不可用', { exact: true }).waitFor();
    assert.equal(await page.locator('.record-form').count(), 0);
    const before = state.readCount(); state.allowDefaults();
    await page.getByRole('button', { name: /重新连接/ }).click();
    await page.locator('#commercial-conditionDisclosure').waitFor();
    assert.equal(state.readCount(), before + 1);
  });
  await scenario('readonly-no-generation', { role: 'SUPPORT' });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
  await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.checks.length, checks: report.checks, syntheticWrites: report.writes.length }));
} finally { await browser.close(); }
