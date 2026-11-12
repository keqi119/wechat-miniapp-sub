import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.ADMIN_QA_ORIGIN || 'http://127.0.0.1:4311';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = new URL('../../../.runtime/ninda/customer-order-overview-20261026/admin-contract-baseline/', import.meta.url);
await mkdir(out, { recursive: true });
const report = { mode: 'localhost fixture API only; no real preparation or signing', checks: [], writes: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function scenario(flow, width, permissions = ['*'], role = 'ADMIN') {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const ownerAllowed = permissions.includes('*') && ['ADMIN', 'OPERATIONS'].includes(role);
  const requests = [];
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin ? route.continue() : route.abort();
    requests.push(url.pathname);
    if (req.method() !== 'GET') { report.writes.push({ method: req.method(), path: url.pathname }); return route.fulfill({ status: 409, json: { error: { message: 'QA blocks mutations' } } }); }
    const path = url.pathname.slice(4);
    let json = { items: [], total: 0, page: 1, pageSize: 12 };
    if (path === '/admin/auth/me') json = { user: { id: 'qa-user', username: 'qa-only', role, permissions }, csrfToken: 'qa-only' };
    if (path === '/admin/contracts/qa-owner-contract') json = { id: 'qa-owner-contract', customerId: 'qa-customer', status: 'DRAFT', kind: 'SUBSCRIPTION', signingFlow: flow, ownerId: flow === 'OWNER' ? 'qa-owner' : null, ownerName: flow === 'OWNER' ? '测试车主企业' : null };
    if (path === '/admin/vehicle-owners') json = [{ id: 'qa-owner', name: '测试车主企业', status: 'VERIFIED' }];
    if (path.endsWith('/esign-readiness')) json = { state: 'READY', certBound: true, readyForSigning: true, realNameStatus: 'VERIFIED' };
    await route.fulfill({ json });
  });
  try {
    await page.goto(`${base}/#contracts?record=qa-owner-contract`);
    await page.getByRole('tab', { name: '处理概览', exact: true }).waitFor();
    const prepare = page.getByRole('button', { name: '准备PDF与签署复核', exact: true });
    const send = page.getByRole('button', { name: '发起签署', exact: true });
    assert.equal(await prepare.count(), flow === 'PLATFORM' ? 1 : 0);
    assert.equal(await send.count(), flow === 'PLATFORM' ? 1 : 0);
    assert.equal(await page.getByRole('heading', { name: '冻结文档与签署复核', exact: true }).count(), flow === 'PLATFORM' ? 1 : 0);
    const owner = page.getByRole('button', { name: '前往车主合同办理', exact: true });
    assert.equal(await owner.count(), flow === 'OWNER' && ownerAllowed ? 1 : 0);
    if (flow === 'OWNER') {
      await page.getByText('实际出租方：测试车主企业', { exact: true }).waitFor();
      assert.ok(!requests.includes('/api/admin/esign-approvals'));
      if (!ownerAllowed) await page.getByText('当前账号无企业车主工作台访问权限，请由有权限的运营人员办理。', { exact: true }).waitFor();
    } else if (flow !== 'PLATFORM') await page.getByRole('heading', { name: '合同办理路线待核对', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.drawer').evaluate(e => e.scrollWidth > e.clientWidth + 1), false);
    if (flow === 'OWNER' && ownerAllowed) {
      const box = await owner.boundingBox(); assert.ok(box && box.y >= 0 && box.y + box.height < 450);
      await page.screenshot({ path: new URL(`owner-contract-route-${width}.png`, out).pathname.replace(/^\/(?=[A-Za-z]:)/, ''), fullPage: true });
      await owner.click();
      await page.waitForURL('**/#vehicle-owners');
      await page.getByRole('heading', { name: '企业身份与订阅签约', exact: true }).waitFor();
      await page.getByRole('option', { name: /测试车主企业/ }).waitFor({ state: 'attached' });
    }
    report.checks.push({ flow: flow ?? 'MISSING', width, role, ownerAllowed, correctRoute: true });
  } finally { await context.close(); }
}
try {
  for (const width of [390, 1440]) await scenario('OWNER', width);
  await scenario('OWNER', 390, ['contracts.read', 'contracts.write']);
  await scenario('OWNER', 390, ['*'], 'FINANCE');
  await scenario('PLATFORM', 1440);
  await scenario('UNKNOWN', 390);
  await scenario(undefined, 390);
  assert.deepEqual(report.writes, []); assert.deepEqual(report.errors, []);
} finally { await browser.close(); await writeFile(new URL('browser-route-qa.json', out), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
