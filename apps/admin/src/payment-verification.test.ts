import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAllowed, detailFor, resources, resourceAccessible, verificationReviewNotice } from './resources.ts';
import { serializeForm } from './form.ts';

test('payment verification is ADMIN-only and its authorization cannot set amount or create a subscription', () => {
  const resource = resources.find(item => item.key === 'payment-verifications')!;
  assert.ok(resource);
  assert.equal(resource.adminOnly, true);
  assert.equal(resource.create, true);
  assert.equal(resource.edit, undefined);
  assert.deepEqual(resource.actions!.map(action => action.path), ['close']);
  assert.deepEqual(resource.fields!.map(field => field.key), ['customerId', 'authorizationNote']);
  assert.deepEqual(serializeForm(resource.fields!, { customerId: 'customer-1', authorizationNote: '指定客户一次微信支付验收', amount: '5199', orderId: 'injected' }), { customerId: 'customer-1', authorizationNote: '指定客户一次微信支付验收' });
  assert.equal(resourceAccessible(resource, ['payment-verifications.read'], 'ADMIN'), true);
  for (const role of ['OPERATIONS', 'FINANCE', 'SUPPORT', undefined]) assert.equal(resourceAccessible(resource, ['*'], role), false);
  assert.equal(resourceAccessible(resource, [], 'ADMIN'), false);
});

test('payment verification close fails closed for paid, terminal or uncertain creation states', () => {
  const action = { label: '查询并关闭未付验收', path: 'close' };
  for (const status of ['AUTHORIZED', 'PENDING']) {
    assert.equal(actionAllowed('payment-verifications', action, { id: 'v1', status, canClose: true }), true);
    assert.equal(actionAllowed('payment-verifications', action, { id: 'v1', status }), false);
  }
  for (const status of ['CREATING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CLOSED', 'UNKNOWN']) assert.equal(actionAllowed('payment-verifications', action, { id: 'v1', status }), false);
  assert.equal(actionAllowed('payment-verifications', action, { id: 'v1', status: 'PENDING', canClose: false }), false);
  assert.equal(actionAllowed('payment-verifications', action, { id: 'v1', status: 'CREATING', canClose: true }), true);
  assert.equal(actionAllowed('payment-verifications', action, { id: 'v1', status: 'SUCCEEDED', canClose: true }), false);
});

test('payment verification details show fixed money, authorization and trusted result only', () => {
  assert.deepEqual(detailFor('payment-verifications', { id: 'v1', title: '微信支付验收', amount: 1, currency: 'CNY', status: 'SUCCEEDED', customerId: 'c1', authorizationNote: '指定客户验收', expiresAt: '2026-10-17T00:00:00Z', createdAt: '2026-10-16T00:00:00Z', paidAt: '2026-10-16T01:00:00Z', canPay: false, openId: 'must-not-show', prepayId: 'must-not-show', paymentParams: { paySign: 'must-not-show' } }), { id: 'v1', title: '微信支付验收', amount: 1, currency: 'CNY', status: 'SUCCEEDED', customerId: 'c1', authorizationNote: '指定客户验收', expiresAt: '2026-10-17T00:00:00Z', createdAt: '2026-10-16T00:00:00Z', paidAt: '2026-10-16T01:00:00Z' });
});

test('expired uncertain payment prominently requires manual review and retains the server warning', () => {
  const statusMessage = '授权已到期，渠道暂未查到交易；需人工核对，不能据此认定未扣款或再次授权。';
  const entity = { id: 'v1', status: 'EXPIRED', manualReviewRequired: true, statusMessage };
  assert.deepEqual(verificationReviewNotice(entity), { title: '需人工核对', message: statusMessage });
  assert.deepEqual(detailFor('payment-verifications', entity), entity);
  assert.equal(verificationReviewNotice({ ...entity, manualReviewRequired: false }), undefined);
  assert.match(verificationReviewNotice({ ...entity, statusMessage: '' })!.message, /不能据此认定未扣款或再次授权/);
});
