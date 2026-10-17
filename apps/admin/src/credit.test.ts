import test from 'node:test';
import assert from 'node:assert/strict';
import { creditDeposit, creditReady, creditVerificationPayload, creditPlanInitial, creditDepositPreview, creditReviewMessage } from './credit.ts';
import { resources, actionAllowed } from './resources.ts';
import { serializeForm } from './form.ts';

const review = { applicationId: 'a1', creditRevision: 2, ruleVersion: 'ZHIMA_MANUAL_V1', status: 'VERIFIED', canConsent: false, canWithdraw: true, canVerify: true, canFinalize: true, depositMultiplier: 1, document: { id: 'doc1', type: 'credit-verification', version: 1, title: '信用核验说明', content: '经批准说明' }, consent: { id: 'consent1', status: 'ACCEPTED', documentId: 'doc1', version: 1, acceptedAt: '2026-10-16T00:00:00Z', withdrawnAt: null }, verification: { id: 'cv1', band: 'B700_749', verifiedBy: 'operator', verifiedAt: '2026-10-16T01:00:00Z', consentId: 'consent1' } };

test('credit deposits use approved bands and exact integer cents; manual bands cannot produce a plan', () => {
  assert.equal(creditDeposit(519900, 'GE750'), 0);
  assert.equal(creditDeposit(519900, 'B700_749'), 519900);
  assert.equal(creditDeposit(519900, 'B650_699'), 1039800);
  for (const band of ['LT650', 'UNVERIFIABLE', 'UNKNOWN']) assert.equal(creditDeposit(519900, band), undefined);
  assert.throws(() => creditDeposit(2147483647, 'B650_699'));
  assert.throws(() => creditDeposit(1.2, 'GE750'));
});

test('application actions require current application-specific consent and fail closed on missing review', () => {
  const application = { id: 'a1', status: 'IN_REVIEW', creditReview: review };
  const verify = { label: '录入信用核验档位', path: 'credit-verifications' }, finalize = { label: '发布最终方案', path: 'final-plan' };
  assert.equal(actionAllowed('applications', verify, application), true);
  assert.equal(actionAllowed('applications', finalize, application), true);
  for (const creditReview of [undefined, { ...review, applicationId: 'other' }, { ...review, consent: null }, { ...review, consent: { ...review.consent, status: 'WITHDRAWN' } }, { ...review, document: { ...review.document, version: 2 } }]) {
    assert.equal(creditReady(creditReview, 'a1', 'verify'), false);
    assert.equal(actionAllowed('applications', finalize, { ...application, creditReview }), false);
  }
  assert.equal(actionAllowed('applications', finalize, { ...application, creditReview: { ...review, status: 'MANUAL_REVIEW', canFinalize: false, verification: { ...review.verification, band: 'LT650' } } }), false);
});

test('credit verification accepts only a band and explicit presentation attestation with a stable request key', () => {
  const action = resources.find(resource => resource.key === 'applications')!.actions!.find(action => action.path === 'credit-verifications')!;
  assert.ok(action);
  assert.deepEqual(action.fields!.map(field => field.key), ['consentId', 'creditRevision', 'band', 'customerPresented']);
  const values = { consentId: 'consent1', creditRevision: '2', band: 'GE750', customerPresented: 'true', exactScore: '788', fileIds: 'screenshot', note: 'not allowed', verifiedBy: 'forged' };
  const body = serializeForm(action.fields!, values);
  assert.deepEqual(creditVerificationPayload(body, 'stable-key'), { consentId: 'consent1', creditRevision: 2, band: 'GE750', customerPresented: true, idempotencyKey: 'stable-key' });
  assert.throws(() => serializeForm(action.fields!, { ...values, customerPresented: 'false' }));
  assert.throws(() => creditVerificationPayload(body));
});

test('final plan binds current verification and previews deposit without submitting an editable override', () => {
  const entity = { id: 'a1', revision: 3, finalPlan: { depositAmount: 999, creditVerificationId: 'stale', monthlyFeeAmount: 519900 } };
  const initial = creditPlanInitial(entity, review);
  assert.equal(initial.creditVerificationId, 'cv1'); assert.equal(initial.creditBand, 'B700_749'); assert.equal(initial.creditRevision, 2);
  const fields = resources.find(resource => resource.key === 'applications')!.actions!.find(action => action.path === 'final-plan')!.fields!;
  const deposit = fields.find(field => field.key === 'depositAmount')!;
  assert.equal(deposit.readOnly, true); assert.equal(deposit.submit, false);
  assert.equal(creditDepositPreview({ monthlyFeeAmount: '5199.00' }, initial), '5199.00');
  assert.equal(creditDepositPreview({ monthlyFeeAmount: '2999.29' }, { ...initial, creditBand: 'B650_699' }), '5998.58');
  assert.deepEqual(serializeForm(fields.filter(field => ['depositAmount', 'creditVerificationId'].includes(field.key)), { depositAmount: '9999', creditVerificationId: 'cv1' }), { creditVerificationId: 'cv1' });
});

test('declining authorization never implies a low score and current privacy consent has its own wait state', () => {
  const declined = creditReviewMessage({ ...review, status: 'MANUAL_REVIEW', canVerify: false, canFinalize: false, verification: null, consent: { ...review.consent, status: 'DECLINED' } });
  assert.match(declined, /暂不授权/); assert.doesNotMatch(declined, /低于650/);
  assert.match(creditReviewMessage({ ...review, consentRequirementsMet: false, canVerify: false, canFinalize: false }), /当前用户协议与隐私政策/);
});

test('acceptance mode is offered only to the matching application and defaults to ordinary pricing', async () => {
  const { fieldsForAction } = await import('./form.ts');
  const offer = { mode: 'V1_ONE_FEN', monthlyFeeAmount: 1, depositAmount: 1, months: 12, startDate: '2026-10-17', firstDueDate: '2026-10-17', reference: 'test-reference', description: '本单验收报价' };
  const scoped = { ...review, acceptancePricing: offer };
  const entity = { id: 'a1', revision: 0, creditReview: scoped };
  const action = resources.find(r => r.key === 'applications')!.actions!.find(a => a.path === 'final-plan')!;
  const fields = fieldsForAction('applications', action, entity);
  assert.ok(fields.find(f => f.key === 'pricingMode')?.options?.some(o => o[0] === 'V1_ONE_FEN'));
  assert.equal(creditPlanInitial(entity, scoped).pricingMode, 'STANDARD');
  for (const creditReview of [review, { ...scoped, applicationId: 'other' }, { ...scoped, acceptancePricing: { ...offer, depositAmount: 2 } }]) assert.ok(!fieldsForAction('applications', action, { ...entity, creditReview }).some(f => f.key === 'pricingMode'));
  const old = { ...entity, creditReview: review, finalPlan: { acceptancePricing: { ruleVersion: 'V1_ONE_FEN' } } };
  assert.equal(creditPlanInitial(old, review).pricingMode, 'V1_ONE_FEN');
  assert.deepEqual(fieldsForAction('applications', action, old).find(f => f.key === 'pricingMode')?.options, [['STANDARD', '按信用档位计算押金']]);
  assert.deepEqual(serializeForm(fields.filter(f => ['pricingMode', 'depositAmount'].includes(f.key)), { pricingMode: 'V1_ONE_FEN', depositAmount: '9999', acceptancePricing: 'forged' }), { pricingMode: 'V1_ONE_FEN' });
});

test('scoped acceptance preview shows one fen without changing the real credit tier', () => {
  const offer = { mode: 'V1_ONE_FEN', monthlyFeeAmount: 1, depositAmount: 1, months: 12, startDate: '2026-10-17', firstDueDate: '2026-10-17', reference: 'test-reference', description: '本单验收报价' };
  const initial = creditPlanInitial({ id: 'a1' }, { ...review, acceptancePricing: offer, verification: { ...review.verification!, band: 'GE750' } });
  assert.equal(initial.creditBand, 'GE750');
  assert.equal(creditDepositPreview({ monthlyFeeAmount: '0.01', pricingMode: 'V1_ONE_FEN' }, initial), '0.01');
  assert.equal(creditDepositPreview({ monthlyFeeAmount: '0.01', pricingMode: 'STANDARD' }, initial), '0.00');
  assert.match(creditDepositPreview({ monthlyFeeAmount: '0.01', pricingMode: 'V1_ONE_FEN' }, { ...initial, acceptancePricingScope: undefined }), /未授权/);
});
