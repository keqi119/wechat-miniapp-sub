import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.ADMIN_QA_ORIGIN || 'http://127.0.0.1:4306';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = new URL('../qa/', import.meta.url); await mkdir(out, { recursive: true });
const report = { mode: 'localhost mocked API, no database or real business actions', checks: [], writes: [], errors: [] };
const longText = Array.from({ length: 80 }, (_, i) => `完整合同条款第 ${i + 1} 项：保留金额、责任、授权及完整合同文字。`).join('\n');
const application = { id: 'qa-app', status: 'IN_REVIEW', customerId: 'qa-customer', vehicleId: 'qa-vehicle', revision: 3, vehicle: { title: '晓浪 ET5T 验收样例' }, finalPlan: { monthlyFeeAmount: 1, depositAmount: 0, months: 12, commercialTerms: { other: longText } }, consents: [{ id: 'qa-consent', version: 2, acceptedAt: '2026-10-26T01:00:00Z' }], profile: { name: '测试客户', contact: 'QA-only' }, note: '业务备注完整保留', createdAt: '2026-10-26T01:00:00Z' };
const credit = { applicationId: 'qa-app', creditRevision: 2, ruleVersion: 'ZHIMA_MANUAL_V1', status: 'VERIFIED', document: { id: 'qa-doc', type: 'credit-verification', version: 1, title: '信用核验说明', content: '完整信用核验说明' }, consent: { id: 'qa-credit-consent', status: 'ACCEPTED', documentId: 'qa-doc', version: 1 }, verification: { id: 'qa-verification', consentId: 'qa-credit-consent', band: 'GE750', verifiedBy: 'qa-operator', verifiedAt: '2026-10-26T01:00:00Z' }, canFinalize: true, canVerify: false };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function scenario(width, permissions, resource, callback) {
  const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin !== new URL(base).origin) { report.errors.push(`external request: ${url.origin}`); return route.abort(); }
      return route.continue();
    }
    if (request.method() !== 'GET') { report.writes.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 409, json: { error: { code: 'QA_NO_WRITE', message: '禁止真实操作' } } }); }
    const path = url.pathname.slice(4); let data = { items: [], total: 0, page: 1, pageSize: 12 };
    if (path === '/admin/auth/me') data = { user: { id: 'qa-user', username: 'qa-only', role: 'ADMIN', permissions }, csrfToken: 'qa-only' };
    else if (path === '/admin/applications') data = { ...data, items: [application], total: 1 };
    else if (path === '/admin/applications/qa-app') data = application;
    else if (path === '/admin/applications/qa-app/credit-review') data = credit;
    else if (path === '/admin/orders/qa-order') data = { id: 'qa-order', status: 'ACTIVE', customerId: 'qa-customer', finalPlanSnapshot: application.finalPlan, history: [{ action: 'QA_HISTORICAL', note: longText }] };
    else if (path === '/admin/contracts/qa-contract') data = { id: 'qa-contract', status: 'DRAFT', kind: 'SUBSCRIPTION', customerId: 'qa-customer', documentHash: 'qa-hash', sourceFileId: 'qa-file', snapshot: { content: longText } };
    else if (path === '/admin/technical-acceptances/qa-tech') data = { id: 'qa-tech', status: 'CONFIRMED', customerId: 'qa-customer', signatureStatus: 'DRAFT', enabled: true, revision: 1 };
    else if (path === '/admin/swap-credit-purchases/qa-purchase') data = { id: 'qa-purchase', status: 'ACTIVE', quantity: 1, amount: 80000, currency: 'CNY', billId: 'qa-bill', bill: { id: 'qa-bill', type: 'SWAP_CREDIT', amount: 80000, paidAmount: 80000 } };
    else if (path.endsWith('/esign-readiness')) data = { state: 'CERT_BINDING_PENDING', certBound: false, readyForSigning: false, realNameStatus: 'VERIFIED', nextAction: 'QUERY_PROVIDER_STATUS' };
    else if (path.endsWith('/usage-account')) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '尚未交车' } } });
    else if (path.endsWith('/delivery-delay-context')) data = { orderId: 'qa-order', orderRevision: 1, canCreate: true, blockers: [], months: 12, depositAmount: 0 };
    else if (path.endsWith('/vehicle-change-context')) data = { orderId: 'qa-order', orderRevision: 1, canCreate: true, blockers: [], currentAssignment: null, swapAccount: null };
    return route.fulfill({ status: 200, json: data });
  });
  try {
    const record = { applications: 'qa-app', orders: 'qa-order', contracts: 'qa-contract', 'technical-acceptances': 'qa-tech', 'swap-credit-purchases': 'qa-purchase' }[resource];
    await page.goto(`${base}/#${resource}?record=${record}`);
    await page.getByRole('tab', { name: '处理概览', exact: true }).waitFor();
    await callback(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.drawer').evaluate(e => e.scrollWidth > e.clientWidth + 1), false);
  } finally { await context.close(); }
}
try {
  for (const [resource, label] of [['technical-acceptances', '已确认'], ['swap-credit-purchases', '已可信到账']]) await scenario(390, ['*'], resource, async page => {
    await page.getByRole('region', { name: '当前状态与操作' }).getByText(label, { exact: true }).waitFor();
    report.checks.push(`${resource}: authoritative status remains visible without widening safe detail projection`);
  });
  for (const width of [320, 390, 1280, 1440]) await scenario(width, ['*'], 'applications', async page => {
    const action = page.getByRole('button', { name: '发布最终方案', exact: true }); await action.waitFor();
    const before = await action.boundingBox(); assert.ok(before.y >= 0 && before.y + before.height < 440, 'primary action is in first screen');
    await page.getByText('申请级信用核验', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '详细资料', exact: true }).click();
    await page.locator('summary').filter({ hasText: '最终方案' }).click();
    await page.getByText(longText, { exact: true }).waitFor();
    await page.locator('.detail-panel-scroll').evaluate(e => { e.scrollTop = e.scrollHeight; });
    const after = await action.boundingBox(); assert.equal(after.y, before.y, 'commands stay put during detail scrolling');
    await page.getByRole('tab', { name: '历史记录', exact: true }).click();
    await page.locator('summary').filter({ hasText: '协议同意记录' }).click();
    await page.getByText('qa-consent', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '处理概览', exact: true }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`detail-layout-application-${width}.png`, out)) });
    await action.click();
    const submit = page.getByRole('button', { name: '发布最终方案', exact: true }); await submit.waitFor();
    const box = await submit.boundingBox(); assert.ok(box.y > 0 && box.y + box.height <= 900, 'form footer visible before reading long fields');
    await page.locator('.drawer-content').evaluate(e => { e.scrollTop = e.scrollHeight; });
    const bottom = await submit.boundingBox(); assert.ok(bottom.y > 0 && bottom.y + bottom.height <= 900, 'form footer remains visible at end');
    await page.getByRole('checkbox', { name: '我已核对上述业务对象和操作影响' }).waitFor();
    assert.equal(await submit.isDisabled(), true, 'original explicit confirmation retained');
    await page.screenshot({ path: fileURLToPath(new URL(`detail-layout-form-${width}.png`, out)) });
    report.checks.push(`${width}px: first-screen action, separate full clauses/history, fixed commands, fixed submit, original confirmation`);
  });
  await scenario(390, ['applications.read'], 'applications', async page => {
    assert.equal(await page.getByRole('button', { name: '发布最终方案', exact: true }).count(), 0);
    await page.getByText('当前账号仅可查看，本页不提供修改操作。', { exact: true }).waitFor();
    report.checks.push('read-only role sees explicit explanation and no write actions');
  });
  await scenario(1440, ['*'], 'contracts', async page => {
    await page.getByText('待绑定实名证书', { exact: true }).waitFor();
    await page.getByText(/当前文档尚未生成冻结 PDF/).waitFor();
    await page.getByRole('tab', { name: '详细资料', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByRole('tab', { name: '处理概览' }).getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: fileURLToPath(new URL('detail-layout-contract.png', out)) });
    report.checks.push('contract signing blockers visible on default overview, keyboard tab navigation');
  });
  await scenario(390, ['*'], 'orders', async page => {
    await page.getByRole('tab', { name: '履约与变更', exact: true }).click();
    await page.getByRole('button', { name: '发起延期草案', exact: true }).waitFor();
    await page.getByRole('button', { name: '发起真实换车草案', exact: true }).waitFor();
    await page.getByRole('button', { name: '发起延期草案', exact: true }).click();
    await page.getByLabel('双方协商延期原因').fill('QA 未提交草案');
    await page.getByRole('tab', { name: '处理概览', exact: true }).click();
    await page.getByRole('tab', { name: '履约与变更', exact: true }).click();
    assert.equal(await page.getByLabel('双方协商延期原因').inputValue(), 'QA 未提交草案');
    report.checks.push('order fulfillment/change entry points retained and in-progress draft preserved across tabs');
  });
  assert.deepEqual(report.writes, []); assert.deepEqual(report.errors, []);
  await writeFile(new URL('detail-layout-fixtures.json', out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
