import test from 'node:test';
import assert from 'node:assert/strict';
import { resources, actionAllowed, resourceWritable, resourceActionWritable, detailFor } from './resources.ts';
import { fieldsForAction, serializeForm, mutationPayload } from './form.ts';
import { creditPlanInitial } from './credit.ts';
import { parseShanghaiDateTime, shanghaiDateTime, usageStatusLabel, usageLedgerLabel } from './usage.ts';

test('usage and return settlement use server capabilities, never editable amounts or pack balances', () => {
  for (const key of ['usage-periods', 'return-settlements']) {
    const resource = resources.find(resource => resource.key === key)!;
    assert.ok(resource); assert.equal(resource.create, undefined); assert.equal(resource.edit, undefined);
    assert.ok(resource.actions!.every(action => (action.fields ?? []).every(field => !/amount|balance|paid|pack/i.test(field.key))));
    assert.equal(resourceWritable(resource, ['*'], 'SUPPORT'), false);
    assert.equal(resourceWritable(resource, ['*'], 'OPERATIONS'), key === 'usage-periods');
    assert.equal(resourceWritable(resource, [`${key}.write`], 'FINANCE'), true);
  }
  assert.equal(actionAllowed('usage-periods', { label: '结算', path: 'settle' }, { id: 'p1', status: 'READY', canSettle: true }), true);
  for (const entity of [{ id: 'p1', status: 'READY' }, { id: 'p1', status: 'AWAITING_READING', canSettle: true }, { id: 'p1', status: 'SETTLED', canSettle: true }]) assert.equal(actionAllowed('usage-periods', { label: '结算', path: 'settle' }, entity), false);
  assert.equal(actionAllowed('return-settlements', { label: '解除挂起', path: 'resolve' }, { id: 'r1', status: 'DISPUTED', canResolve: true }), true);
  assert.equal(actionAllowed('return-settlements', { label: '完成结算', path: 'complete' }, { id: 'r1', status: 'DISPUTED', canComplete: true }), false);
  assert.equal(actionAllowed('return-settlements', { label: '完成结算', path: 'complete' }, { id: 'r1', status: 'PENDING_PAYMENT', canComplete: true }), true);
});

test('usage settlement retries preserve request identity and require explicit revision', () => {
  const action = resources.find(resource => resource.key === 'usage-periods')!.actions!.find(action => action.path === 'settle')!;
  const body = serializeForm(action.fields!, { revision: '4', amount: '150', packBalanceKm: '9999' });
  assert.deepEqual(body, { revision: 4 });
  assert.deepEqual(mutationPayload('usage-periods', 'action', body, 'stable-usage-key'), { revision: 4, idempotencyKey: 'stable-usage-key' });
  assert.throws(() => mutationPayload('usage-periods', 'action', body));
  assert.deepEqual(mutationPayload('return-settlements', 'action', { revision: 2, resolutionNote: '核对真实争议材料后解除挂起' }, 'stable-return-key'), { revision: 2, resolutionNote: '核对真实争议材料后解除挂起', idempotencyKey: 'stable-return-key' });
});

test('monthly reading approval requires staff confirmation of actual boundary evidence; legacy reading is unaffected', () => {
  const action = resources.find(resource => resource.key === 'mileages')!.actions!.find(action => action.fixed?.decision === 'APPROVED')!;
  const monthly = fieldsForAction('mileages', action, { id: 'm1', periodId: 'p1', status: 'SUBMITTED' });
  assert.ok(monthly.some(field => field.key === 'boundaryConfirmed' && field.type === 'attestation'));
  assert.throws(() => serializeForm(monthly, { note: '核对本月照片', boundaryConfirmed: 'false' }));
  assert.deepEqual(serializeForm(monthly, { note: '核对本月照片', boundaryConfirmed: 'true' }), { note: '核对本月照片', boundaryConfirmed: true });
  assert.ok(!fieldsForAction('mileages', action, { id: 'old', status: 'SUBMITTED' }).some(field => field.key === 'boundaryConfirmed'));
});

test('actual handover time is explicit Shanghai time serialized to ISO, without browser timezone assumptions', () => {
  assert.equal(parseShanghaiDateTime('2026-10-16T09:30'), '2026-10-16T01:30:00.000Z');
  assert.equal(shanghaiDateTime('2026-10-16T01:30:00.000Z'), '2026-10-16T09:30');
  assert.throws(() => parseShanghaiDateTime('2026-02-30T09:00'));
  const field = resources.find(resource => resource.key === 'handovers')!.fields!.find(field => field.key === 'actualAt')!;
  assert.ok(field?.required); assert.equal(field.type, 'datetime-local');
  assert.deepEqual(serializeForm([field], { actualAt: '2026-10-16T09:30' }), { actualAt: '2026-10-16T01:30:00.000Z' });
});

test('fixed usage rule reaches new final-plan fields and mileage bills retain independent finance review', () => {
  const fields = resources.find(resource => resource.key === 'applications')!.actions!.find(action => action.path === 'final-plan')!.fields!;
  assert.equal(fields.find(field => field.key === 'mileagePerMonthKm')!.readOnly, true);
  assert.equal(fields.find(field => field.key === 'excessMileagePriceAmount')!.readOnly, true);
  assert.equal(fields.find(field => field.key === 'months')!.min, 12);
  const initial = creditPlanInitial({ id: 'a1', finalPlan: { mileagePerMonthKm: 9000, excessMileagePriceAmount: 999 } });
  assert.equal(initial.mileagePerMonthKm, 1500); assert.equal(initial.excessMileagePriceAmount, 150);
  const bill = { id: 'b1', status: 'DRAFT', type: 'MILEAGE_EXCESS', createdBy: 'settler' };
  assert.equal(actionAllowed('bills', { label: '审核', path: 'review' }, bill, 'settler'), false);
  assert.equal(actionAllowed('bills', { label: '审核', path: 'review' }, bill, 'reviewer'), true);
  assert.equal(actionAllowed('bills', { label: '发布', path: 'publish' }, bill, 'reviewer'), false);
  assert.equal(usageStatusLabel('usage-periods', 'OPEN'), '本期进行中');
});

test('usage detail projection excludes internal account and gateway payloads', () => {
  assert.deepEqual(detailFor('usage-periods', { id: 'p1', orderId: 'o1', status: 'SETTLED', excessAmount: 150, canSettle: true, account: { order: { finalPlanSnapshot: { creditBand: 'GE750' } } }, clientParameters: { paySign: 'private' } }), { id: 'p1', orderId: 'o1', status: 'SETTLED', excessAmount: 150 });
  assert.deepEqual(detailFor('usage-periods', { id: 'p2', status: 'READY', usedKm: 0, baseUsedKm: 0, packUsedKm: 0, excessKm: 0, excessAmount: 0 }), { id: 'p2', status: 'READY' });
});

test('refund-frozen mileage packs never imply that the balance is spendable', () => {
  assert.equal(usageStatusLabel('packs', 'REFUND_PENDING'), '退款核验中，权益冻结');
  assert.equal(usageStatusLabel('packs', 'REFUNDED'), '已退款并收回权益');
  assert.equal(usageLedgerLabel('REFUND'), '退款收回');
});

test('unsettled reading correction requires operations role, current revision, reason and affirmative capability', () => {
  const resource = resources.find(resource => resource.key === 'usage-periods')!;
  const action = resource.actions!.find(action => action.path === 'request-evidence')!;
  const settle = resource.actions!.find(action => action.path === 'settle')!;
  assert.ok(action);
  assert.equal(resourceActionWritable(resource, action, ['usage-periods.write'], 'OPERATIONS'), true);
  assert.equal(resourceActionWritable(resource, action, ['*'], 'FINANCE'), false);
  assert.equal(resourceActionWritable(resource, settle, ['*'], 'OPERATIONS'), false);
  assert.equal(resourceActionWritable(resource, settle, ['*'], 'FINANCE'), true);
  for (const status of ['READY', 'REVIEW_PENDING']) assert.equal(actionAllowed(resource.key, action, { id: 'p1', status, canRequestEvidence: true }), true);
  assert.equal(actionAllowed(resource.key, action, { id: 'p1', status: 'READY' }), false);
  assert.equal(actionAllowed(resource.key, action, { id: 'p1', status: 'SETTLED', canRequestEvidence: true }), false);
  assert.throws(() => serializeForm(action.fields!, { revision: '3', reason: '' }));
  assert.deepEqual(mutationPayload(resource.key, 'action', serializeForm(action.fields!, { revision: '3', reason: '原照片无法确认月界，要求重新提交原始证据' }), 'stable-evidence-key'), { revision: 3, reason: '原照片无法确认月界，要求重新提交原始证据', idempotencyKey: 'stable-evidence-key' });
});
