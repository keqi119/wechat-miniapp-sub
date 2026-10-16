import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';

process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
const dbUrl = new URL(process.env.DATABASE_URL);
assert.equal(dbUrl.pathname, '/chundian_dev'); assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname));
const { PrismaClient } = createRequire(import.meta.url)(resolve(import.meta.dirname, '../../api/node_modules/@prisma/client'));
const prisma = new PrismaClient();
const qaPassword = randomBytes(24).toString('base64url'), salt = randomBytes(16).toString('hex');
try { await prisma.adminUser.upsert({ where: { username: 'qa-browser-support' }, update: { passwordHash: `${salt}:${scryptSync(qaPassword, salt, 64).toString('hex')}`, role: 'SUPPORT', active: true }, create: { username: 'qa-browser-support', name: 'QA 只读车源客服', role: 'SUPPORT', passwordHash: `${salt}:${scryptSync(qaPassword, salt, 64).toString('hex')}` } }); } finally { await prisma.$disconnect(); }
const out = resolve(import.meta.dirname, '../qa');
const previous = JSON.parse(await readFile(resolve(out, 'review-result.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { checks: [], errors: [] }; page.on('pageerror', error => report.errors.push(error.message));
const check = text => { report.checks.push(text); console.log(`PASS ${text}`); };
async function login(username, password) {
  await page.getByLabel('工作账号', { exact: true }).fill(username); await page.getByLabel('登录密码', { exact: true }).fill(password);
  const response = page.waitForResponse(r => r.url().endsWith('/api/admin/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  const r = await response; assert.equal(r.ok(), true); const session = await r.json();
  await page.getByRole('navigation', { name: '主导航' }).waitFor(); return session;
}
async function vehicles() { await page.getByRole('navigation').getByRole('button', { name: '车辆管理', exact: true }).click(); await page.getByText('正在读取真实数据').waitFor({ state: 'hidden' }); }
try {
  await page.goto('http://127.0.0.1:3100');
  const support = await login('qa-browser-support', qaPassword);
  assert.equal(await page.getByRole('navigation').getByRole('button', { name: '后台账号', exact: true }).count(), 0);
  await vehicles(); assert.equal(await page.getByRole('button', { name: '新增车辆', exact: true }).count(), 0);
  const denied = await page.request.post('http://127.0.0.1:3100/api/admin/vehicles', { headers: { 'X-CSRF-Token': support.csrfToken, Origin: 'http://127.0.0.1:3100' }, data: {} });
  assert.equal(denied.status(), 403);
  await page.screenshot({ path: resolve(out, 'vehicles-readonly.png'), fullPage: true }); check('SUPPORT write controls hidden and real API write denied');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await login(process.env.BOOTSTRAP_ADMIN_USERNAME, process.env.BOOTSTRAP_ADMIN_PASSWORD);
  await vehicles();
  await page.getByRole('textbox', { name: '搜索车辆管理', exact: true }).fill('qa-no-matching-record-xyz');
  await page.getByRole('button', { name: '执行搜索', exact: true }).click();
  await page.getByRole('heading', { name: '未找到符合条件的记录', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'vehicles-filter-empty.png'), fullPage: true }); check('real no-match empty state and clear filter');
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.route('**/api/admin/vehicles?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'QA_UNAVAILABLE', message: 'QA 服务暂时不可用' }, requestId: 'qa-request-503' }) }));
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.getByText('QA 服务暂时不可用', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'vehicles-service-error.png'), fullPage: true });
  assert.equal(await page.locator('tbody tr').count(), 0); check('503 server message and request ID display without stale success data');
  await page.unroute('**/api/admin/vehicles?*');
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await page.getByText('QA 服务暂时不可用', { exact: true }).waitFor({ state: 'hidden' });
  await page.goto(`http://127.0.0.1:3100/#applications?record=${encodeURIComponent(previous.applicationId)}`);
  await page.getByRole('button', { name: '发布最终方案', exact: true }).click();
  await page.getByRole('checkbox', { name: '我已核对上述业务对象和操作影响' }).check();
  await page.route('**/api/admin/applications/*/final-plan', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'QA 最终方案已更新，请刷新' }, requestId: 'qa-request-409' }) }));
  await page.getByRole('button', { name: '发布最终方案', exact: true }).click();
  await page.getByText('QA 最终方案已更新，请刷新', { exact: true }).waitFor();
  assert.equal(await page.locator('#field-monthlyFeeAmount').inputValue(), '2999.29');
  await page.screenshot({ path: resolve(out, 'application-version-conflict.png'), fullPage: true }); check('409 version conflict preserves entered form and requests reload');
  await page.unroute('**/api/admin/applications/*/final-plan');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.route('**/api/admin/vehicles?*', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'QA 会话已失效' } }) }));
  await page.getByRole('navigation').getByRole('button', { name: '车辆管理', exact: true }).click();
  await page.getByRole('heading', { name: '登录运营后台', exact: true }).waitFor();
  await page.getByText('登录会话已过期，请重新登录后继续', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'session-expired.png'), fullPage: true }); check('401 clears business UI and returns to reauthentication');
  assert.deepEqual(report.errors, []);
  await writeFile(resolve(out, 'errors-result.json'), JSON.stringify(report, null, 2));
} catch (error) { await writeFile(resolve(out, 'errors-result.json'), JSON.stringify({ ...report, failure: error.message }, null, 2)); await page.screenshot({ path: resolve(out, 'errors-failure.png'), fullPage: true }); console.error(error.message); process.exitCode = 1; }
finally { await browser.close(); }
