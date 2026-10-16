import test from 'node:test';
import assert from 'node:assert/strict';
import { delayCreatePayload, delayQuotePayload, delayActionAllowed, delayActionPayload, delayContextSafe, delayDetailSafe, delayListItemSafe } from './delay.ts';
import { resources, actionAllowed } from './resources.ts';

test('delay creation binds server order version and terms without accepting new money or dates', () => {
  assert.deepEqual(delayCreatePayload({ orderRevision: 3, priorTermsHash: 'terms-hash' }, '双方协商延期', 'stable-create-key'), { expectedOrderRevision: 3, priorTermsHash: 'terms-hash', reason: '双方协商延期', idempotencyKey: 'stable-create-key' });
  assert.throws(() => delayCreatePayload({}, '双方协商延期', 'stable-create-key'));
  assert.throws(() => delayCreatePayload({ orderRevision: 3, priorTermsHash: 'terms-hash' }, '', 'stable-create-key'));
});

const draft = { expiresAt: '2099-01-01T12:34', externalCompensationRequired: 'false', newStartDate: '2026-11-16', periods: [{ sequence: 1, dueDate: '2026-11-15', amount: '5199.01', calculationBasis: '原订阅费沿用，本期延期不另收费' }], reason: '双方协商延期', settlementExplanation: '原款沿用至新服务期，差额原路补退', handoverArrangement: '上海约定地点按新日期交接', cancellationTerms: '再次延期须重新确认，未履行按约原路退费' };
test('delay quote sends exact cents, every period and explicit terms; dates and derived funds remain server owned', () => {
  const result = delayQuotePayload(4, [1], { ...draft, months: 1, carryAmount: 999999, newEndDate: '2099-01-01' }, 'stable-quote-key');
  assert.deepEqual(result, { ...draft, expiresAt: '2099-01-01T04:34:00.000Z', externalCompensationRequired: false, periods: [{ sequence: 1, dueDate: '2026-11-15', amount: 519901, calculationBasis: draft.periods[0].calculationBasis }], revision: 4, idempotencyKey: 'stable-quote-key' });
  assert.throws(() => delayQuotePayload(4, [1, 2], draft, 'stable-quote-key'));
  assert.throws(() => delayQuotePayload(4, [1], { ...draft, newStartDate: '2026-02-30' }, 'stable-quote-key'));
  assert.throws(() => delayQuotePayload(4, [1], { ...draft, periods: [{ ...draft.periods[0], amount: '-1' }] }, 'stable-quote-key'));
  assert.throws(() => delayQuotePayload(4, [1], { ...draft, settlementExplanation: '' }, 'stable-quote-key'));
});

test('delay actions require authoritative capability and distinct operational or finance role', () => {
  assert.equal(delayActionAllowed('review', { kind: 'DELIVERY_DELAY', canReview: true, quote: { createdBy: 'creator' } }, 'FINANCE', 'reviewer'), true);
  assert.equal(delayActionAllowed('review', { kind: 'DELIVERY_DELAY', canReview: true, quote: { createdBy: 'creator' } }, 'ADMIN', 'creator'), false);
  assert.equal(delayActionAllowed('prepare-finance', { kind: 'DELIVERY_DELAY', canPrepareFinance: true }, 'OPERATIONS', 'ops'), false);
  assert.equal(delayActionAllowed('apply', { kind: 'DELIVERY_DELAY', canApply: true }, 'FINANCE', 'finance'), false);
  assert.equal(delayActionAllowed('apply', { kind: 'DELIVERY_DELAY', canApply: true }, 'OPERATIONS', 'ops'), true);
  assert.equal(delayActionAllowed('apply', {}, 'ADMIN', 'admin'), false);
  assert.equal(delayActionAllowed('sign', { kind: 'DELIVERY_DELAY', canSign: true }, 'ADMIN', 'admin'), false);
  assert.equal(delayActionAllowed('cancel', { kind: 'DELIVERY_DELAY', canCancel: true }, 'SUPPORT', 'support'), false);
  assert.equal(delayActionAllowed('apply', { kind: 'VEHICLE_CHANGE', canApply: true }, 'OPERATIONS', 'ops'), false);
});

test('delay action retries retain request identity and discard arbitrary success overrides', () => {
  assert.deepEqual(delayActionPayload('review', 7, { decision: 'APPROVED', note: '已核对原实收与逐期调整', status: 'SIGNED', paid: true }, 'stable-action-key'), { revision: 7, idempotencyKey: 'stable-action-key', decision: 'APPROVED', note: '已核对原实收与逐期调整' });
  assert.deepEqual(delayActionPayload('apply', 8, { paid: true }, 'stable-apply-key'), { revision: 8, idempotencyKey: 'stable-apply-key' });
  assert.throws(() => delayActionPayload('apply', 8, {}, ''));
});

test('delay safe projections retain only operational facts and never supplier or identity data', () => {
  assert.deepEqual(delayContextSafe({ orderId: 'o1', orderRevision: 2, canCreate: false, blockers: ['未知付款待核对'], openId: 'private' }), { orderId: 'o1', orderRevision: 2, canCreate: false, blockers: ['未知付款待核对'] });
  const entity = delayDetailSafe({ id: 'c1', status: 'AWAITING_SIGNATURE', contract: { id: 'd1', status: 'PENDING', clientParameters: { paySign: 'private' } }, quote: { id: 'q1', commercialHash: 'h1', periods: [{ sequence: 1, amount: 100, openId: 'private' }] }, identityCiphertext: 'private' });
  assert.deepEqual(entity, { id: 'c1', status: 'AWAITING_SIGNATURE', contract: { id: 'd1', status: 'PENDING' }, quote: { id: 'q1', commercialHash: 'h1', periods: [{ sequence: 1, amount: 100 }] } });
});

test('amendment contracts cannot use old subscription actions and have their own signing policy kind', () => {
  for (const path of ['send', 'prepare-signature', 'status']) assert.equal(actionAllowed('contracts', { path, label: path }, { id: 'contract1', kind: 'AMENDMENT', status: 'DRAFT' }), false);
  assert.ok(resources.find(resource => resource.key === 'order-changes'));
  assert.ok(resources.find(resource => resource.key === 'signature-policies')!.fields!.find(field => field.key === 'kind')!.options!.some(([key]) => key === 'AMENDMENT'));
});

test('published delay quote preserves exact approved legal text and accepts explicit zero fee periods', () => {
  const document = { id: 'approved-document', type: 'delivery-delay-amendment', version: 1, hash: 'approved-hash', bodyHash: 'approved-hash', templateHash: 'template-hash', content: '已批准且与客户确认同版的补充协议全文' };
  assert.deepEqual((delayDetailSafe({ id: 'change', quote: { document: { ...document, providerPayload: 'private' } } }).quote as Record<string, unknown>).document, document);
  assert.equal((delayQuotePayload(2, [1], { ...draft, periods: [{ ...draft.periods[0], amount: '0', calculationBasis: '双方约定整期免租，原款按清单原路退款' }] }, 'stable-zero-key').periods[0]).amount, 0);
  assert.ok(resources.find(resource => resource.key === 'legal-documents')!.fields!.find(field => field.key === 'type')!.options!.some(([key]) => key === 'delivery-delay-amendment'));
  assert.deepEqual(delayDetailSafe({ id: 'change', history: [{ id: 'q1', revision: 1, status: 'SUPERSEDED', commercialHash: 'history-hash' }] }).history, [{ id: 'q1', revision: 1, status: 'SUPERSEDED', commercialHash: 'history-hash' }]);
});

test('external compensation requires a deliberate answer, never a default false or silent waiver', () => {
  assert.throws(() => delayQuotePayload(2, [1], { ...draft, externalCompensationRequired: '' }, 'stable-comp-key'));
  assert.equal(delayQuotePayload(2, [1], { ...draft, externalCompensationRequired: 'true' }, 'stable-comp-key').externalCompensationRequired, true);
  assert.equal(delayQuotePayload(2, [1], { ...draft, externalCompensationRequired: 'false' }, 'stable-comp-key').externalCompensationRequired, false);
});

test('quote expiry is explicit future Beijing time without a day cap and does not expire confirmed signing', () => {
  assert.throws(() => delayQuotePayload(2, [1], { ...draft, expiresAt: '' }, 'expiry-request-key'));
  assert.throws(() => delayQuotePayload(2, [1], { ...draft, expiresAt: '2000-01-01T12:34' }, 'expiry-request-key'));
  assert.equal(delayQuotePayload(2, [1], draft, 'expiry-request-key').expiresAt, '2099-01-01T04:34:00.000Z');
  assert.equal(delayActionAllowed('publish', { kind: 'DELIVERY_DELAY', canPublish: true, quote: { expiresAt: '2000-01-01T04:34:00Z' } }, 'OPERATIONS', 'ops'), false);
  assert.equal(delayActionAllowed('publish', { kind: 'DELIVERY_DELAY', canPublish: true, quote: { expiresAt: '2099-01-01T04:34:00Z' } }, 'OPERATIONS', 'ops'), true);
  assert.equal(delayActionAllowed('prepare-signature', { kind: 'DELIVERY_DELAY', canPrepareSignature: true, quote: { confirmedAt: '2026-10-16T00:00:00Z', expiresAt: '2000-01-01T04:34:00Z' } }, 'OPERATIONS', 'ops'), true);
  const summary = { id: 'q1', expiresAt: '2099-01-01T04:34:00Z', commercialHash: 'q-hash' };
  assert.deepEqual(delayListItemSafe({ id: 'c1', quoteSummary: { ...summary, content: 'private' }, quote: { document: { content: 'private' } }, canPublish: true }), { id: 'c1', quoteSummary: summary });
  assert.equal((delayDetailSafe({ id: 'c1', quote: { expiresAt: summary.expiresAt } }).quote as Record<string, unknown>).expiresAt, summary.expiresAt);
});
