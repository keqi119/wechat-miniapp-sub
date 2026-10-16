import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeForm, fieldsForAction, mutationPayload } from './form.ts';
import { actionAllowed, resources } from './resources.ts';

test('form currency and files become contract DTO values, never display strings', () => {
  const result = serializeForm([{ key: 'monthlyFeeAmount', label: '月费', type: 'money', required: true }, { key: 'mediaFileIds', label: '附件', type: 'files' }, { key: 'months', label: '月份', type: 'number', min: 1, max: 120 }], { monthlyFeeAmount: '2999.29', mediaFileIds: 'file1\nfile2\n', months: '12', injected: 'ignored' });
  assert.deepEqual(result, { monthlyFeeAmount: 299929, mediaFileIds: ['file1', 'file2'], months: 12 });
});
test('required notes and invalid integers are rejected before network writes', () => {
  assert.throws(() => serializeForm([{ key: 'note', label: '原因', required: true }], { note: '   ' }));
  assert.throws(() => serializeForm([{ key: 'months', label: '期限', type: 'number', min: 1 }], { months: '1.2' }));
});
test('vehicle edit can clear a cover while empty passwords are omitted', () => {
  assert.deepEqual(serializeForm([{ key: 'coverFileId', label: '封面', type: 'files' }, { key: 'password', label: '密码', type: 'password' }], { coverFileId: '', password: '' }), { coverFileId: null });
});
test('handover checklist cannot submit incomplete inspection evidence', () => {
  const fields = [{ key: 'checklist', label: '清单', type: 'checklist' as const, required: true }];
  assert.throws(() => serializeForm(fields, { checklist: '[]' }));
  assert.throws(() => serializeForm(fields, { checklist: '[{"label":"外观","value":" "}]' }));
  assert.deepEqual(serializeForm(fields, { checklist: '[{"label":"外观","value":"无新增划痕"}]' }), { checklist: [{ label: '外观', value: '无新增划痕' }] });
});
test('service form presents only valid next statuses', () => {
  const action = resources.find(r => r.key === 'services')!.actions!.find(a => a.path === 'status')!;
  assert.deepEqual(fieldsForAction('services', action, { id: 's1', status: 'ASSIGNED' })[0].options?.map(([key]) => key), ['IN_PROGRESS', 'CANCELLED']);
  assert.deepEqual(fieldsForAction('services', action, { id: 's1', status: 'IN_PROGRESS' })[0].options?.map(([key]) => key), ['COMPLETED']);
});
test('completed workflows and published financial records expose no invalid action', () => {
  assert.equal(actionAllowed('bills', { label: '发布', path: 'publish' }, { id: 'b1', status: 'PAID' }), false);
  assert.equal(actionAllowed('applications', { label: '方案', path: 'final-plan' }, { id: 'a1', status: 'FINAL_PLAN_CONFIRMED' }), false);
  assert.equal(actionAllowed('vehicles', { label: '上架', path: 'publish' }, { id: 'v1', status: 'UNPUBLISHED', reservedOrderId: 'o1' }), false);
});
test('refund creation and its retry preserve the supplied idempotency key', () => {
  const body = { paymentId: 'p1', amount: 100, reason: 'QA' };
  assert.deepEqual(mutationPayload('refunds', 'create', body, 'stable-request-key'), { ...body, idempotencyKey: 'stable-request-key' });
  assert.deepEqual(mutationPayload('refunds', 'create', body, 'stable-request-key'), { ...body, idempotencyKey: 'stable-request-key' });
  assert.throws(() => mutationPayload('refunds', 'create', body));
  assert.deepEqual(mutationPayload('refunds', 'action', {}), {});
});
test('seal evidence is a single uploaded file identifier', () => {
  assert.deepEqual(serializeForm([{ key: 'evidenceFileId', label: '授权证明', type: 'files', required: true }], { evidenceFileId: 'evidence-file-1' }), { evidenceFileId: 'evidence-file-1' });
});
test('approval actions are hidden for requester and expired or processed plans', () => {
  const action = { label: '复核通过', path: 'approve' };
  const draft = { id: 'a1', status: 'PENDING', requesterId: 'requester', expiresAt: '2099-01-01T00:00:00.000Z' };
  assert.equal(actionAllowed('esign-approvals', action, draft, 'requester'), false);
  assert.equal(actionAllowed('esign-approvals', action, draft, 'reviewer'), true);
  assert.equal(actionAllowed('esign-approvals', action, { ...draft, status: 'APPROVED' }, 'reviewer'), false);
  assert.equal(actionAllowed('esign-approvals', action, { ...draft, expiresAt: '2000-01-01T00:00:00Z' }, 'reviewer'), false);
});
test('manual bills preserve idempotency and require independent review before publication', () => {
  assert.equal(mutationPayload('bills', 'create', { amount: 120 }, 'bill-stable-key').idempotencyKey, 'bill-stable-key');
  const bill = { id: 'b1', type: 'EXTRA_FEE', status: 'DRAFT', createdBy: 'creator' };
  assert.equal(actionAllowed('bills', { label: '发布', path: 'publish' }, bill, 'reviewer'), false);
  assert.equal(actionAllowed('bills', { label: '审核', path: 'review' }, bill, 'creator'), false);
  assert.equal(actionAllowed('bills', { label: '审核', path: 'review' }, bill, 'reviewer'), true);
  assert.equal(actionAllowed('bills', { label: '发布', path: 'publish' }, { ...bill, status: 'REVIEWED' }, 'reviewer'), true);
});
test('handover revision applies only to an unresolved customer objection', () => {
  assert.equal(actionAllowed('handovers', { label: '修订', path: 'revise' }, { id: 'h1', status: 'OBJECTION_SUBMITTED' }), true);
  assert.equal(actionAllowed('handovers', { label: '修订', path: 'revise' }, { id: 'h1', status: 'SUPERSEDED' }), false);
});
test('handover submission requires all seven approved facts exactly once', () => {
  const facts = ['actualTimeAndPlace', 'batteryLevel', 'accessoriesChecklist', 'conditionChecklist', 'openItems', 'resolutionPlan', 'staffName'].map(label => ({ label, value: 'QA 明确的验收事实' }));
  const fields = [{ key: 'checklist', label: '交接事实', type: 'checklist' as const, requireFacts: true, required: true }];
  assert.deepEqual(serializeForm(fields, { checklist: JSON.stringify(facts) }).checklist, facts);
  assert.throws(() => serializeForm(fields, { checklist: JSON.stringify(facts.slice(0, 6)) }));
  assert.throws(() => serializeForm(fields, { checklist: JSON.stringify([...facts, facts[0]]) }));
});
test('a separate reviewer can reject a pending plan even after expiry but cannot self-reject', () => {
  const draft = { id: 'a1', status: 'PENDING', requesterId: 'requester', expiresAt: '2000-01-01T00:00:00Z' };
  assert.equal(actionAllowed('esign-approvals', { label: '拒绝', path: 'reject' }, draft, 'reviewer'), true);
  assert.equal(actionAllowed('esign-approvals', { label: '拒绝', path: 'reject' }, draft, 'requester'), false);
});

test('same-task renewal requires expired approval and affirmative server eligibility', () => {
  const action = { label: '同一签署任务重新授权', path: 'renew' };
  const entity = { id: 'a1', kind: 'HANDOVER', sealId: 'original-seal', status: 'APPROVED', requesterId: 'requester', expiresAt: '2000-01-01T00:00:00Z', renewalEligibility: { eligible: true, reason: 'ELIGIBLE', taskId: 'task1' } };
  assert.equal(actionAllowed('esign-approvals', action, entity, 'requester'), true);
  assert.equal(actionAllowed('esign-approvals', action, { ...entity, renewalEligibility: { eligible: false, reason: 'BUSY' } }, 'requester'), false);
  assert.equal(actionAllowed('esign-approvals', action, { ...entity, renewalEligibility: undefined }, 'requester'), false);
  assert.equal(actionAllowed('esign-approvals', action, { ...entity, status: 'PENDING' }, 'requester'), false);
  assert.equal(actionAllowed('esign-approvals', action, { ...entity, expiresAt: '2099-01-01T00:00:00Z' }, 'requester'), false);
  const configured = resources.find(r => r.key === 'esign-approvals')!.actions!.find(a => a.path === 'renew')!;
  assert.deepEqual(fieldsForAction('esign-approvals', configured, entity)[0].sourceFilters, { status: 'ACTIVE', kind: 'HANDOVER', sealId: 'original-seal' });
  assert.deepEqual(serializeForm(fieldsForAction('esign-approvals', configured, entity), { policyId: 'active-policy', injectedTaskId: 'different' }), { policyId: 'active-policy' });
});
