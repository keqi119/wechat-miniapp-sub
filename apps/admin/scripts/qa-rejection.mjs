import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';

process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
const url = new URL(process.env.DATABASE_URL); assert.equal(url.pathname, '/chundian_dev'); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.notEqual(process.env.FADADA_SIGNING_ENABLED, 'true');
const require = createRequire(import.meta.url), { PrismaClient } = require(resolve(import.meta.dirname, '../../api/node_modules/@prisma/client'));
const PDFDocument = require(resolve(import.meta.dirname, '../../api/node_modules/pdfkit'));
const db = new PrismaClient(), out = resolve(import.meta.dirname, '../qa');
const prior = JSON.parse(await readFile(resolve(out, 'governance-result.json'), 'utf8'));
const review = JSON.parse(await readFile(resolve(out, 'review-result.json'), 'utf8'));
const password = randomBytes(24).toString('base64url'), salt = randomBytes(16).toString('hex');
const requester = await db.adminUser.upsert({ where: { username: 'qa-signature-requester' }, create: { username: 'qa-signature-requester', name: 'QA 签署申请人', role: 'OPERATIONS', passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}` }, update: { passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}`, role: 'OPERATIONS', active: true } });
const doc = new PDFDocument({ size: 'A4' }), chunks = [];
doc.on('data', data => chunks.push(data));
const pdf = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
doc.font('Helvetica').fontSize(16).text('QA review rejection fixture').moveDown().fontSize(11).text('This document and review record are synthetic local development fixtures. They are not approved for signing. No signature or payment is created by this test.'); doc.end();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const origin = 'http://127.0.0.1:3100', report = { checks: [], errors: [], fixture: 'local QA pending review metadata; not a successful contract preparation' };
page.on('pageerror', error => report.errors.push(error.message));
async function login(username, value) { await page.getByLabel('工作账号', { exact: true }).fill(username); await page.getByLabel('登录密码', { exact: true }).fill(value); const wait = page.waitForResponse(r => r.url().endsWith('/api/admin/auth/login') && r.request().method() === 'POST'); await page.getByRole('button', { name: '进入工作台', exact: true }).click(); const response = await wait; assert.equal(response.ok(), true); const session = await response.json(); await page.getByRole('navigation').waitFor(); return session; }
const check = value => { report.checks.push(value); console.log(`PASS ${value}`); };
try {
  await page.goto(origin); const session = await login(process.env.BOOTSTRAP_ADMIN_USERNAME, process.env.BOOTSTRAP_ADMIN_PASSWORD);
  const response = await page.request.post(`${origin}/api/admin/files`, { headers: { 'X-CSRF-Token': session.csrfToken, Origin: origin }, multipart: { purpose: 'evidence', file: { name: 'qa-review-only.pdf', mimeType: 'application/pdf', buffer: await pdf } } }); assert.equal(response.ok(), true); const file = await response.json();
  const stored = await db.storedFile.findUniqueOrThrow({ where: { id: file.id } });
  const application = await db.application.findUniqueOrThrow({ where: { id: review.applicationId }, include: { order: { include: { contracts: true } } } });
  await db.sealAuthority.upsert({ where: { sealId_subjectType_subjectId_authorityType: { sealId: prior.records.sealId, subjectType: 'USER', subjectId: session.user.id, authorityType: 'APPROVE_USE' } }, create: { sealId: prior.records.sealId, subjectType: 'USER', subjectId: session.user.id, authorityType: 'APPROVE_USE', status: 'ACTIVE', requiresTwoPersonApproval: true }, update: { status: 'ACTIVE' } });
  const approval = await db.eSignApproval.create({ data: { kind: 'SUBSCRIPTION', resourceId: application.order.contracts[0].id, customerId: application.customerId, documentHash: application.order.contracts[0].documentHash, sourceFileId: file.id, sourcePdfHash: stored.sha256, slotCoordinates: [], policyId: 'qa-rejection-fixture-only', sealId: prior.records.sealId, requesterId: requester.id, status: 'PENDING', planHash: 'a'.repeat(64), plan: { fixture: 'QA rejection only; no executable signing plan' }, expiresAt: new Date(Date.now() + 3600000) } });
  await page.goto(`${origin}/#esign-approvals?record=${approval.id}`); await page.getByRole('button', { name: '驳回签署计划', exact: true }).click(); await page.locator('#field-reason').fill('QA 元数据复核驳回验收；此fixture不可用于实际签署'); await page.getByRole('checkbox', { name: '我已核对上述业务对象和操作影响' }).check();
  const wait = page.waitForResponse(r => r.url().endsWith(`/esign-approvals/${approval.id}/reject`)); await page.getByRole('button', { name: '驳回签署计划', exact: true }).click(); const rejectedResponse = await wait; assert.equal(rejectedResponse.ok(), true); const rejected = await rejectedResponse.json(); assert.equal(rejected.status, 'REJECTED'); assert.equal(rejected.sourceFileId, file.id); assert.equal(rejected.planHash, approval.planHash); assert.equal(rejected.approverId, session.user.id);
  await page.getByText('已拒绝', { exact: true }).first().waitFor(); await page.screenshot({ path: resolve(out, 'signing-plan-rejected.png'), fullPage: true }); check('real independent rejection preserves source PDF and original plan hash');
  assert.equal(await db.fadadaTask.count({ where: { approvalId: approval.id } }), 0); check('rejection creates no provider signing task');
  const own = await db.eSignApproval.create({ data: { kind: 'SUBSCRIPTION', resourceId: application.order.contracts[0].id, customerId: application.customerId, documentHash: application.order.contracts[0].documentHash, sourceFileId: file.id, sourcePdfHash: stored.sha256, slotCoordinates: [], policyId: 'qa-self-review-fixture-only', sealId: prior.records.sealId, requesterId: requester.id, status: 'PENDING', planHash: 'b'.repeat(64), plan: { fixture: 'QA self-review denial only' }, expiresAt: new Date(Date.now() + 3600000) } });
  await page.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click(); const op = await login(requester.username, password); await page.goto(`${origin}/#esign-approvals?record=${own.id}`); await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button', { name: '驳回签署计划', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '复核通过签署计划', exact: true }).count(), 0);
  const denied = await page.request.post(`${origin}/api/admin/esign-approvals/${own.id}/reject`, { headers: { 'X-CSRF-Token': op.csrfToken, Origin: origin }, data: { reason: 'QA self-review must be denied' } }); assert.equal(denied.status(), 403); check('requester has no approval/rejection buttons and real API denies self-rejection');
  assert.deepEqual(report.errors, []); await writeFile(resolve(out, 'rejection-result.json'), JSON.stringify(report, null, 2));
} catch (error) { await writeFile(resolve(out, 'rejection-result.json'), JSON.stringify({ ...report, failure: error.message }, null, 2)); await page.screenshot({ path: resolve(out, 'rejection-failure.png'), fullPage: true }); console.error(error.message); process.exitCode = 1; }
finally { await db.$disconnect(); await browser.close(); }
