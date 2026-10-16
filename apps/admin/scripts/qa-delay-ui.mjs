import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Isolated browser fixtures only. Every API request is intercepted; no credentials, database or payment provider is used.
const base = 'http://127.0.0.1:3100';
const output = resolve(import.meta.dirname, '../qa'); await mkdir(output, { recursive: true });
const report = { mode: 'isolated-browser-fixtures-not-api-e2e', checks: [], pageErrors: [], writes: [] };
const periods = Array.from({ length: 12 }, (_, index) => ({ sequence: index + 1, startDate: '2026-10-16', endDate: '2026-11-16', dueDate: '2026-10-15', amount: 519900, billId: index === 11 ? null : `qa-bill-${index}`, billStatus: 'PAID', netPaidAmount: 519900 }));
const contextData = { orderId: 'qa-order', orderRevision: 3, priorTermsHash: 'qa-terms-hash', months: 12, startDate: '2026-10-16', endDate: '2027-10-16', depositAmount: 0, periods, canCreate: true, activeChangeId: null, blockers: [], capabilityNote: '本地隔离浏览器验收资料；没有真实订单或渠道调用。' };
const quote = { id: 'qa-quote', revision: 1, expiresAt: '2099-01-01T04:34:00Z', commercialHash: 'qa-quote-hash', newStartDate: '2026-11-16', newEndDate: '2027-11-16', months: 12, periods: periods.map(p => ({ ...p, originalAmount: p.amount, carryAmount: p.amount, chargeAmount: 0, refundAmount: 0, calculationBasis: '隔离测试：沿用本期原金额' })), reason: 'QA延期', settlementExplanation: 'QA原款沿用', handoverArrangement: 'QA新日期交车', cancellationTerms: 'QA再次延期重新确认', createdBy: 'qa-creator', confirmedAt: null };
quote.document = { id: 'qa-legal', version: 1, hash: 'qa-body', bodyHash: 'qa-body', templateHash: 'qa-template', content: 'QA隔离测试完整补充协议正文，无真实实名或签署' };
const detail = { id: 'qa-change', orderId: 'qa-order', customerId: 'qa-customer', kind: 'DELIVERY_DELAY', status: 'REVIEW_PENDING', revision: 4, reason: 'QA延期', quote, history: [{ id: quote.id, revision: quote.revision, status: 'SUPERSEDED', commercialHash: quote.commercialHash }], contract: null, finance: { obligations: [], refunds: [], blockers: ['隔离测试，无已核清资金状态'] }, canQuote: true, canReview: true, canPublish: true, canPrepareSignature: true, canPrepareFinance: true, canApply: true, canCancel: true, blockers: [], capabilityNote: contextData.capabilityNote };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const role of ['OPERATIONS', 'FINANCE', 'SUPPORT']) {
    const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let expiryMode = 'future';
    const page = await browserContext.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message));
    await browserContext.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (request.method() !== 'GET') { const body = request.postDataJSON(); report.writes.push({ role, path: url.pathname, body }); return respond({ error: body.externalCompensationRequired === true ? { code: 'MANUAL_FINANCE_REQUIRED', message: '隔离测试：额外赔付需人工财务处理，未生成报价' } : { code: 'REVISION_CONFLICT', message: '隔离测试：版本冲突，未写入任何业务数据' } }, 409); }
      if (url.pathname.endsWith('/auth/me')) return respond({ csrfToken: 'fixture-csrf', user: { id: `qa-${role}`, username: 'QA', name: '本地验收', role, permissions: ['orders.read', 'order-changes.read', ...(role === 'SUPPORT' ? [] : ['order-changes.write'])] } });
      if (url.pathname.endsWith('/delivery-delay-context')) return respond(contextData);
      if (url.pathname.endsWith('/order-changes/qa-change')) { const safe = structuredClone(detail); if (role !== 'OPERATIONS') delete safe.quote.document.content; if (expiryMode !== 'future') { safe.quote.expiresAt = '2000-01-01T00:00:00Z'; safe.status = expiryMode === 'confirmed' ? 'AWAITING_SIGNATURE' : 'AWAITING_CONFIRMATION'; if (expiryMode === 'confirmed') safe.quote.confirmedAt = '2026-10-16T00:00:00Z'; } return respond(safe); }
      if (url.pathname.endsWith('/order-changes')) return respond({ items: [{ id: detail.id, orderId: detail.orderId, kind: detail.kind, status: detail.status, revision: detail.revision, reason: detail.reason, createdAt: '2026-10-16T00:00:00Z', quoteSummary: { id: quote.id, revision: quote.revision, newStartDate: quote.newStartDate, newEndDate: quote.newEndDate, months: quote.months, commercialHash: quote.commercialHash, expiresAt: quote.expiresAt } }], total: 1, page: 1, pageSize: 12 });
      if (url.pathname.endsWith('/orders/qa-order')) return respond({ id: 'qa-order', status: 'AWAITING_HANDOVER', customerId: 'qa-customer' });
      if (url.pathname.endsWith('/orders')) return respond({ items: [{ id: 'qa-order', status: 'AWAITING_HANDOVER' }], total: 1, page: 1, pageSize: 12 });
      return respond({ items: [], total: 0, page: 1, pageSize: 100 });
    });
    await page.goto(`${base}/#order-changes?record=qa-change`);
    await page.getByRole('heading', { name: '交车延期详情' }).waitFor();
    await page.getByText('QA原款沿用', { exact: true }).first().waitFor();
    await page.getByText('查看历史报价版本（1）', { exact: true }).click();
    assert.equal(await page.getByText(/undefined/).count(), 0);
    await page.getByText('批准补充协议正文与摘要 · v1', { exact: true }).click();
    if (role === 'OPERATIONS') await page.getByText(quote.document.content, { exact: true }).waitFor();
    else await page.getByText('当前角色只提供文案版本与摘要；完整正文未在此权限范围返回。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '编制新报价版本', exact: true }).count(), role === 'OPERATIONS' ? 1 : 0);
    assert.equal(await page.getByRole('button', { name: '独立复核延期报价', exact: true }).count(), role === 'FINANCE' ? 1 : 0);
    assert.equal(await page.getByRole('button', { name: '生效已核清延期条款', exact: true }).count(), role === 'OPERATIONS' ? 1 : 0);
    assert.equal(await page.getByRole('button', { name: /代客|标记已签|直接标已收|客户确认报价/ }).count(), 0);
    report.checks.push(`${role}: role-specific actions and no customer impersonation`);
    if (role === 'OPERATIONS') {
      await page.getByRole('button', { name: '编制新报价版本', exact: true }).click();
      await page.getByLabel('双方约定的新起租日').fill('2026-11-16');
      assert.equal(await page.locator('a[href="#bills?record=null"]').count(), 0);
      await page.getByLabel('本期协商应收（元）').first().fill('5199.01');
      await page.getByLabel('我已核对逐期协商金额').check();
      assert.equal(await page.getByLabel('客户确认截止时间（北京时间）').inputValue(), '');
      await page.getByLabel('客户确认截止时间（北京时间）').fill('2099-01-01T12:34');
      assert.equal(await page.getByLabel('本次是否涉及系统范围外额外赔付').inputValue(), '');
      await page.getByRole('button', { name: '保存新报价版本', exact: true }).click();
      assert.equal(report.writes.filter(write => write.path.endsWith('/quotes')).length, 0);
      await page.getByLabel('本次是否涉及系统范围外额外赔付').selectOption('true');
      await page.getByRole('button', { name: '保存新报价版本', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '额外赔付需人工财务处理' }).waitFor();
      assert.equal(await page.getByLabel('本期协商应收（元）').first().inputValue(), '5199.01');
      await page.getByLabel('本次是否涉及系统范围外额外赔付').selectOption('false');
      await page.getByRole('button', { name: '保存新报价版本', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '隔离测试：版本冲突' }).waitFor();
      await page.getByRole('button', { name: '保存新报价版本', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '隔离测试：版本冲突' }).waitFor();
      const writes = report.writes.filter(write => write.path.endsWith('/quotes'));
      assert.equal(writes.length, 3); assert.equal(writes[0].body.externalCompensationRequired, true); assert.equal(writes[1].body.externalCompensationRequired, false); assert.equal(writes[1].body.idempotencyKey, writes[2].body.idempotencyKey);
      assert.equal(writes[0].body.periods[0].amount, 519901); assert.equal(writes[0].body.revision, 4);
      assert.equal(writes[0].body.expiresAt, '2099-01-01T04:34:00.000Z');
      assert.equal('newEndDate' in writes[0].body, false); assert.equal('depositAmount' in writes[0].body, false);
      report.checks.push('quote: exact cents, unchanged retry key, real conflict shown without fabricated success');
      report.checks.push('external compensation: no default, explicit true kept draft after manual-finance rejection');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByLabel('双方约定的新起租日').scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, 'delay-mobile-form.png'), fullPage: false });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      report.checks.push('390px: quote form fits viewport');
      await page.getByRole('button', { name: '关闭面板' }).click();
      await page.goto(`${base}/#orders?record=qa-order`);
      await page.getByRole('button', { name: '发起延期草案' }).click();
      assert.equal(await page.getByRole('dialog').count(), 1);
      await page.getByLabel('双方协商延期原因').fill('QA双方协商延期');
      await page.getByLabel('我已核对上述业务对象和操作影响').check();
      await page.getByRole('button', { name: '建立延期草案', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '隔离测试：版本冲突' }).waitFor();
      const created = report.writes.find(write => write.path.endsWith('/delivery-delay-changes'));
      assert.equal(created.body.expectedOrderRevision, 3); assert.equal(created.body.priorTermsHash, 'qa-terms-hash');
      report.checks.push('order entry: one modal, authoritative context binding, no successful fixture writes');
      expiryMode = 'expired'; await page.goto(`${base}/#order-changes?record=qa-change`);
      await page.getByText(/未确认报价已过期/).waitFor();
      assert.equal(await page.getByRole('button', { name: '发布报价给客户', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '编制新报价版本', exact: true }).count(), 1);
      expiryMode = 'confirmed'; await page.reload();
      await page.getByText(/客户已经确认；后续签署、资金处理不受此报价期限影响/).waitFor();
      assert.equal(await page.getByRole('button', { name: '准备补充协议签署', exact: true }).count(), 1);
      report.checks.push('expiry: explicit Beijing time, no default, summary list, expired quote cannot publish; confirmed signing remains available');
    }
    await browserContext.close();
  }
  assert.deepEqual(report.pageErrors, []);
} finally { await browser.close(); await writeFile(resolve(output, 'delay-browser-fixtures.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ mode: report.mode, checks: report.checks.length, pageErrors: report.pageErrors.length }));
