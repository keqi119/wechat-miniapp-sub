import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationProgress, applicationActionReceipt } from './application-progress.ts';

const hash = 'a'.repeat(64);
function fixture() {
  return {
    application: { id: 'app-1', customerId: 'customer-1', status: 'IN_REVIEW', revision: 2, finalPlan: { id: 'plan-2', revision: 2, contractMode: 'OFFLINE', reviewStatus: 'DRAFT', commercialHash: hash, creditRevision: 3, creditVerificationId: 'credit-3', creditRuleVersion: 'ZHIMA_MANUAL_V1', creditBand: 'B700_749' } },
    credit: { applicationId: 'app-1', creditRevision: 3, ruleVersion: 'ZHIMA_MANUAL_V1', status: 'VERIFIED', verificationCurrent: true, consentRequirementsMet: true, verification: { id: 'credit-3', band: 'B700_749', consentId: 'consent-3', verifiedBy: 'operator-1', verifiedAt: '2026-10-29' }, document: { id: 'doc-1', type: 'credit-verification', version: 1, title: '说明', content: '说明' }, consent: { id: 'consent-3', status: 'ACCEPTED', documentId: 'doc-1', version: 1 }, canConsent: true, canWithdraw: true, canVerify: true, canFinalize: true, depositMultiplier: 1 },
    qualification: { customerId: 'customer-1', revision: 0, current: { status: 'PENDING' }, items: [] as Record<string, unknown>[] },
    risk: { applicationId: 'app-1', current: { status: 'PENDING' }, review: null as Record<string, unknown> | null },
    loadState: 'ready' as 'ready' | 'loading' | 'error', actorId: 'operator-1',
  };
}
function approvedQualification(value: ReturnType<typeof fixture>) {
  value.qualification = { customerId: 'customer-1', revision: 1, current: { status: 'APPROVED' }, items: [{ id: 'qualification-1', status: 'APPROVED', submittedBy: 'submitter', reviewedBy: 'reviewer' }] };
  return value;
}
const task = (result: ReturnType<typeof applicationProgress>, key: string) => result.tasks.find(item => item.key === key);

test('actual reported case identifies qualification as the blocker, not repeated acceptance or invalid credit', () => {
  const result = applicationProgress(fixture());
  assert.equal(result.current.key, 'preparation');
  assert.equal(result.next?.target, 'profile');
  assert.equal(result.showAccept, false);
  assert.equal(result.planCurrent, true);
  assert.equal(task(result, 'credit')?.state, 'done');
  assert.equal(task(result, 'plan')?.state, 'done');
  assert.deepEqual(result.blockers.map(item => item.key), ['qualification']);
  assert.match(result.current.description, /资格/);
  assert.equal(result.stages.find(item => item.key === 'risk')?.state, 'pending');
});

test('qualification and credit are parallel; valid credit permits a candidate before qualification approval', () => {
  const input = fixture(); delete (input.application as any).finalPlan; delete (input as any).risk;
  const result = applicationProgress(input);
  assert.equal(result.canGeneratePlan, true);
  assert.equal(task(result, 'plan')?.target, 'plan');
  assert.match(task(result, 'plan')!.description, /不必等待|可先/);
  assert.deepEqual(result.blockers.map(item => item.key), ['qualification', 'plan']);
});

test('acceptance remains a separate first stage and cannot be mistaken for approval', () => {
  const input = fixture(); input.application.status = 'SUBMITTED'; input.credit.canFinalize = false;
  const result = applicationProgress(input);
  assert.equal(result.current.key, 'acceptance'); assert.equal(result.showAccept, true);
  assert.equal(result.next?.target, 'accept'); assert.equal(result.canGeneratePlan, false);
});

test('every stale or missing candidate credit binding requires regeneration', () => {
  for (const key of ['revision', 'creditRevision', 'creditVerificationId', 'creditRuleVersion', 'creditBand']) {
    const input = approvedQualification(fixture());
    (input.application.finalPlan as any)[key] = key.endsWith('Revision') || key === 'revision' ? 1 : 'old';
    const result = applicationProgress(input);
    assert.equal(result.planCurrent, false, key); assert.equal(result.next?.target, 'plan', key);
    assert.equal(task(result, 'plan')?.state, 'blocked', key);
  }
  const input = approvedQualification(fixture()); delete (input.application.finalPlan as any).creditRevision;
  assert.equal(applicationProgress(input).planCurrent, false);
});

test('withdrawn or stale credit never counts as done and cannot enable candidate generation', () => {
  const input = approvedQualification(fixture()); input.credit.verificationCurrent = false; input.credit.status = 'CONSENT_REQUIRED'; input.credit.canFinalize = false;
  const result = applicationProgress(input);
  assert.equal(result.next?.target, 'credit'); assert.equal(result.canGeneratePlan, false);
  assert.notEqual(task(result, 'credit')?.state, 'done'); assert.equal(result.planCurrent, false);
});

test('historical qualification approval is not current approval', () => {
  const input = approvedQualification(fixture()); input.qualification.current.status = 'RECHECK_REQUIRED';
  const result = applicationProgress(input);
  assert.equal(result.current.key, 'preparation'); assert.equal(result.next?.target, 'profile');
  assert.match(task(result, 'qualification')!.description, /重新/);
  assert.notEqual(task(result, 'qualification')?.state, 'done');
});

test('submitted qualification clearly states the separate reviewer dependency', () => {
  const input = fixture(); input.qualification.current.status = 'SUBMITTED'; input.qualification.items = [{ id: 'q-1', submittedBy: input.actorId }];
  const result = applicationProgress(input);
  assert.match(task(result, 'qualification')!.description, /其他|另一|独立/);
  assert.equal(result.next?.target, 'profile');
});

test('prepared branches converge to risk review, not customer confirmation', () => {
  const result = applicationProgress(approvedQualification(fixture()));
  assert.equal(result.current.key, 'risk'); assert.equal(result.next?.target, 'risk');
  assert.equal(result.stages.find(item => item.key === 'preparation')?.state, 'done');
  assert.equal(result.stages.find(item => item.key === 'confirmation')?.state, 'pending');
});

test('only the current approved risk and approved candidate allow waiting for customer confirmation', () => {
  const input = approvedQualification(fixture()); input.application.status = 'AWAITING_CONFIRMATION'; input.application.finalPlan.reviewStatus = 'APPROVED';
  input.risk = { applicationId: 'app-1', current: { status: 'APPROVED' }, review: { id: 'risk-1', decision: 'APPROVED', planRevision: 2, commercialHash: hash, qualificationId: 'qualification-1' } };
  const result = applicationProgress(input);
  assert.equal(result.current.key, 'confirmation'); assert.equal(result.next?.target, 'customer');
  assert.match(result.next!.description, /客户本人/);
  input.risk.review!.planRevision = 1;
  assert.notEqual(applicationProgress(input).current.key, 'confirmation');
});

test('invalidated prior risk cannot remain confirmed-ready', () => {
  const input = approvedQualification(fixture()); input.application.status = 'AWAITING_CONFIRMATION'; input.application.finalPlan.reviewStatus = 'APPROVED'; input.risk.current.status = 'RECHECK_REQUIRED';
  input.risk.review = { id: 'risk-old', decision: 'APPROVED', planRevision: 2, commercialHash: hash };
  const result = applicationProgress(input);
  assert.equal(result.current.key, 'risk'); assert.equal(result.next?.target, 'risk');
  assert.match(result.blockers.find(item => item.key === 'risk')!.description, /重新/);
});

test('loading, errors, unknown statuses and mismatched scope fail closed', () => {
  for (const loadState of ['loading', 'error'] as const) {
    const input = approvedQualification(fixture()); input.loadState = loadState;
    const result = applicationProgress(input);
    assert.equal(result.canGeneratePlan, false); assert.equal(result.next?.target, 'refresh');
    assert.equal(result.completed.length, 0); assert(result.stages.every(stage => stage.state === 'unknown'));
  }
  for (const field of ['credit', 'qualification', 'risk'] as const) {
    const input = approvedQualification(fixture());
    if (field === 'qualification') input.qualification.customerId = 'other'; else input[field].applicationId = 'other';
    const result = applicationProgress(input); assert.equal(result.next?.target, 'refresh', field); assert.equal(result.canGeneratePlan, false, field);
  }
  const input = fixture(); input.qualification.current.status = 'NEW_UNKNOWN_STATUS';
  assert.equal(applicationProgress(input).next?.target, 'refresh');
  delete (input as any).credit;
  assert.equal(applicationProgress(input).canGeneratePlan, false);
});

test('customer supplement, rejection and cancellation have explicit dispositions', () => {
  const needsInfo = fixture(); needsInfo.application.status = 'NEEDS_INFO'; (needsInfo.application as any).note = '补充驾驶证有效期';
  const supplement = applicationProgress(needsInfo); assert.equal(supplement.showAccept, true); assert.match(supplement.current.description, /补充驾驶证/);
  for (const status of ['CANCELLED', 'REJECTED']) {
    const input = fixture(); input.application.status = status; (input.application as any).note = '已登记原因';
    const result = applicationProgress(input); assert.equal(result.terminal, status === 'CANCELLED' ? 'cancelled' : 'rejected');
    assert.equal(result.next, undefined); assert.equal(result.canGeneratePlan, false); assert.equal(result.showAccept, false);
    assert.match(result.current.description, /已登记原因/);
  }
});

test('formal order is only shown for a confirmed application and its linked order', () => {
  const input = fixture(); input.application.status = 'FINAL_PLAN_CONFIRMED';
  (input.application as any).order = { id: 'order-1', applicationId: input.application.id, status: 'AWAITING_CONTRACT_REVIEW' };
  const result = applicationProgress(input); assert.equal(result.current.key, 'order'); assert.equal(result.next?.target, 'order');
  assert.equal(result.terminal, 'confirmed'); assert.equal(result.canGeneratePlan, false);
  delete (input.application as any).order;
  const incomplete = applicationProgress(input); assert.equal(incomplete.next?.target, 'refresh'); assert.equal(incomplete.terminal, null);
});

test('action receipts distinguish acceptance, candidate generation, credit and real risk approval', () => {
  assert.match(applicationActionReceipt('accept').description, /受理不代表审核通过|继续/);
  assert.match(applicationActionReceipt('plan').description, /风险审核/);
  assert.match(applicationActionReceipt('credit').description, /候选|重新/);
  const approval = applicationActionReceipt('risk-approve'); assert.match(approval.description, /客户.*确认/); assert.doesNotMatch(approval.description, /已通知|已发送/);
  assert.equal(approval.nextTarget, 'customer');
  assert.match(applicationActionReceipt('unknown').description, /刷新/);
});
test('electronic initial candidate retains current credit and risk path',()=>{
 const value=approvedQualification(fixture());value.application.finalPlan.contractMode='ELECTRONIC';const result=applicationProgress(value);assert.equal(result.planCurrent,true);assert.equal(result.canGeneratePlan,true);assert.equal(result.current.key,'risk');
});
