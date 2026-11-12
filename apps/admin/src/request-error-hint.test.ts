import test from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorHint } from './request-error-hint.ts';

test('owner readiness failures do not masquerade as concurrent edits', () => {
  const hint = requestErrorHint({ status: 409, code: 'OWNER_NOT_READY' });
  assert.match(hint!, /法人本人/);
  assert.match(hint!, /企业与印章/);
  assert.doesNotMatch(hint!, /记录已经发生变化/);
});

test('actual revision conflicts retain the refresh instruction', () => {
  for (const code of ['REVISION_CONFLICT', 'VERSION_CONFLICT']) {
    assert.match(requestErrorHint({ status: 409, code })!, /关闭表单并刷新详情/);
  }
});

test('unrelated conflicts and non-API errors do not receive invented diagnoses', () => {
  for (const code of ['STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CONFLICT', 'CREDIT_REVIEW_REQUIRED', 'OWNER_CERT_NOT_READY']) {
    assert.equal(requestErrorHint({ status: 409, code }), undefined);
  }
  assert.equal(requestErrorHint({ status: 503, code: 'REVISION_CONFLICT' }), undefined);
});
