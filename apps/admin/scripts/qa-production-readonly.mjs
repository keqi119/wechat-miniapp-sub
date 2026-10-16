import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
import { resources } from '../src/resources.ts';

const env = parseEnv(await readFile(resolve(import.meta.dirname, '../../../.runtime/production/.env.production'), 'utf8'));
assert.ok(env.BOOTSTRAP_ADMIN_USERNAME && env.BOOTSTRAP_ADMIN_PASSWORD, 'production bootstrap credentials unavailable');
const secretValues = Object.entries(env).filter(([key, value]) => /password|secret|private|token|encryption|access_key/i.test(key) && value.length > 5).map(([, value]) => value);
const redact = text => secretValues.reduce((value, secret) => value.split(secret).join('[REDACTED]'), String(text));
const base = 'https://mini-admin.subauto.keybox.cloud', api = 'https://mini-api.subauto.keybox.cloud/api';
const critical = process.argv.includes('--critical');
const expectedVersion = process.argv.find(value => value.startsWith('--version='))?.slice('--version='.length);
const expectedBundle = process.argv.find(value => value.startsWith('--bundle='))?.slice('--bundle='.length);
const selected = critical ? resources.filter(resource => ['vehicles', 'legal-documents', 'esign-approvals'].includes(resource.key)) : resources;
const out = resolve(import.meta.dirname, '../qa'); await mkdir(out, { recursive: true });
const prefix = critical ? 'production-critical' : 'production-readonly';
const report = { at: new Date().toISOString(), base, mode: critical ? 'critical' : 'all-pages', checks: [], pages: [], errors: [], consoleErrors: [], unexpectedWrites: [], failedRequests: [], cookieMetadata: [], securityHeaders: {} };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(redact(error.message)));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401')) report.consoleErrors.push(redact(message.text())); });
page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') report.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }); });
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  const authentication = request.method() === 'POST' && url.origin === 'https://mini-api.subauto.keybox.cloud' && ['/api/admin/auth/login', '/api/admin/auth/logout'].includes(url.pathname);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !authentication) {
    report.unexpectedWrites.push({ method: request.method(), path: url.pathname }); return route.abort('blockedbyclient');
  }
  return route.continue();
});
const check = text => { report.checks.push(text); console.log(`PASS ${text}`); };
try {
  const document = await page.goto(base);
  assert.equal(document.status(), 200);
  const headers = await document.allHeaders();
  report.securityHeaders = Object.fromEntries(['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy'].map(name => [name, headers[name] ?? null]));
  assert.ok(headers['content-security-policy'], 'production admin CSP is missing');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  const assets = await page.locator('script[src]').evaluateAll(elements => elements.map(element => new URL(element.src).pathname)); report.bundleAssets = assets;
  if (expectedBundle) assert.ok(assets.some(asset => asset.endsWith(`index-${expectedBundle}.js`)), 'production bundle does not match expected deployment');
  const healthResponse = await page.request.get(`${api}/health`); assert.equal(healthResponse.status(), 200);
  const health = await healthResponse.json(); assert.equal(health.status, 'ok'); assert.equal(health.database, 'connected');
  if (expectedVersion) assert.equal(health.version, expectedVersion);
  report.apiHealth = { status: health.status, database: health.database, version: health.version };
  await page.getByLabel('工作账号', { exact: true }).fill(env.BOOTSTRAP_ADMIN_USERNAME);
  await page.getByLabel('登录密码', { exact: true }).fill(env.BOOTSTRAP_ADMIN_PASSWORD);
  const login = page.waitForResponse(response => response.url() === `${api}/admin/auth/login` && response.request().method() === 'POST');
  const dashboard = page.waitForResponse(response => response.url() === `${api}/admin/dashboard`);
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  const [loginResponse, dashboardResponse] = await Promise.all([login, dashboard]); assert.equal(loginResponse.ok(), true);
  const session = await loginResponse.json(); assert.equal(session.user.role, 'ADMIN');
  assert.equal(dashboardResponse.status(), 200);
  const counts = (await dashboardResponse.json()).counts;
  report.dashboardCounts = counts;
  await page.getByRole('heading', { name: '运营工作台.', exact: true }).waitFor();
  report.cookieMetadata = (await context.cookies()).filter(cookie => cookie.domain.includes('subauto.keybox.cloud')).map(({ name, domain, path, secure, httpOnly, sameSite }) => ({ name, domain, path, secure, httpOnly, sameSite }));
  assert.ok(report.cookieMetadata.some(cookie => cookie.httpOnly && cookie.secure && ['Lax', 'Strict'].includes(cookie.sameSite)), 'secure HttpOnly admin session cookie missing');
  check('production HTTPS cookie login, real dashboard, security headers and CSP');
  await page.screenshot({ path: resolve(out, `${prefix}-dashboard.png`), fullPage: true });
  for (const resource of selected) {
    assert.ok(session.user.permissions.includes('*') || session.user.permissions.includes(`${resource.key}.read`), `ADMIN missing read permission: ${resource.key}`);
    const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/${resource.key}` && response.request().method() === 'GET');
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: resource.title, exact: true }).click();
    const actual = await response; assert.equal(actual.status(), 200, `unexpected page permission/load error: ${resource.key} ${actual.status()}`);
    const body = await actual.json(); assert.ok(Array.isArray(body.items));
    await page.getByRole('heading', { name: `${resource.title}.`, exact: true }).waitFor();
    await page.getByText('正在读取真实数据', { exact: true }).waitFor({ state: 'hidden' });
    report.pages.push({ resource: resource.key, status: actual.status(), total: body.total });
    if (['vehicles', 'plans', 'orders', 'payments', 'customers', 'contracts'].includes(resource.key)) assert.equal(body.total, 0, `production ${resource.key} unexpectedly contains business records`);
    if (resource.key === 'vehicles') { await page.getByText('还没有车辆记录', { exact: true }).waitFor(); await page.screenshot({ path: resolve(out, `${prefix}-vehicles-empty.png`), fullPage: true }); }
    if (resource.key === 'legal-documents') {
      assert.ok(body.items.some(item => item.status === 'PUBLISHED'), 'approved legal documents missing');
      await page.getByRole('button', { name: '详情', exact: false }).first().click(); await page.getByRole('dialog').waitFor();
      assert.equal(await page.getByRole('button', { name: '编辑协议草稿', exact: true }).count(), 0, 'published legal content must be read-only');
      await page.screenshot({ path: resolve(out, `${prefix}-legal-readonly.png`), fullPage: true }); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    }
  }
  check(`${selected.length} production modules return 200 with ADMIN read permissions; empty inventory and published legal content verified`);
  await page.reload(); await page.getByRole('navigation', { name: '主导航' }).waitFor();
  assert.equal(await page.getByLabel('登录密码', { exact: true }).count(), 0);
  check('production cookie session survives browser refresh');
  const csrfDenied = await page.request.post(`${api}/admin/auth/logout`, { headers: { Origin: base }, data: {} });
  assert.equal(csrfDenied.status(), 403, 'authentication mutation without CSRF must be denied');
  assert.equal((await page.request.get(`${api}/admin/auth/me`)).status(), 200, 'denied logout must preserve current session');
  check('real production 403 rejects logout without CSRF and preserves session');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(out, `${prefix}-mobile.png`), fullPage: true });
  check('production 390px layout has no horizontal overflow');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.failedRequests, []); assert.deepEqual(report.unexpectedWrites, []);
  check('no JavaScript, CSP, network failures or non-authentication writes');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  const logout = page.waitForResponse(response => response.url() === `${api}/admin/auth/logout`);
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); assert.equal((await logout).ok(), true);
  await page.getByLabel('工作账号', { exact: true }).waitFor();
  check('production session explicitly signed out');
} catch (error) { report.failure = redact(error.message); console.error(report.failure); process.exitCode = 1; }
finally { await writeFile(resolve(out, `${prefix}-result.json`), JSON.stringify(report, null, 2)); await browser.close(); }
