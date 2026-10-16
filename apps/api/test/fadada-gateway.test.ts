import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { accountReadiness, encryptIdentity, decryptIdentity, verifiedCallback, assertSignerResult, assertApprovedText } from '../src/esign/fadada/fadada-safety';
import { buildFadadaMsgDigest } from '../src/esign/fadada/fadada-digest';
const code = (expected: string) => (error: any) => error.getResponse?.().error?.code === expected;
const ready = { providerCustomerId: 'provider-person', registrationStatus: 'REGISTERED', realNameStatus: 'VERIFIED', verificationSource: 'QUERY', verifiedAt: new Date(), certStatus: 'BOUND', certSerialNo: 'certificate-1', checkedAt: new Date(),identityCiphertext:'synthetic-ciphertext',verifiedIdentityHash:createHash('sha256').update('synthetic-ciphertext').digest('hex'),verifiedSerialNo:'verified-serial',verificationTransactionNo:'verification-transaction' };
test('readiness requires provider-backed name AND cert evidence, manual imported flags never unlock signing', () => {
  assert.equal(accountReadiness(ready).readyForSigning, true);
  assert.equal(accountReadiness({ ...ready, verificationSource: 'MANUAL' }).readyForSigning, false);
  assert.equal(accountReadiness({ ...ready, certSerialNo: null }).readyForSigning, false);
  assert.equal(accountReadiness({ ...ready, checkedAt: new Date('2020-01-01') }).readyForSigning, false);
});
test('identity ciphertext is customer-bound, authenticated, and cannot work without server key', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptIdentity({ idCardNo: '110101199001010000', name: '合成测试' }, 'customer-1', key);
  assert.equal(encrypted.includes('110101'), false);
  assert.deepEqual(decryptIdentity(encrypted, 'customer-1', key), { idCardNo: '110101199001010000', name: '合成测试' });
  assert.throws(() => decryptIdentity(encrypted, 'customer-2', key));
  assert.throws(() => encryptIdentity({}, 'customer-1', ''), code('IDENTITY_KEY_MISSING'));
});
test('callback uses pinned digest scheme, rejects duplicate fields and binds transaction identity', () => {
  const payload = { transaction_id: 'TX123', contract_id: 'CON123', timestamp: '20261016123000', result_code: '3000' };
  const digest = buildFadadaMsgDigest({ appId: 'fixture-app', appSecret: 'fixture-secret', timestamp: payload.timestamp, businessParams: payload, explicitSortString: payload.transaction_id });
  const verified = verifiedCallback({ ...payload, msg_digest: digest }, { appId: 'fixture-app', appSecret: 'fixture-secret' });
  assert.equal(verified.transactionId, 'TX123');
  assert.throws(() => verifiedCallback({ ...payload, transaction_id: 'OTHER', msg_digest: digest }, { appId: 'fixture-app', appSecret: 'fixture-secret' }), code('CALLBACK_SIGNATURE'));
  assert.throws(() => verifiedCallback('transaction_id=A&transaction_id=B', { appId: 'a', appSecret: 'b' }), code('CALLBACK_FIELDS'));
});
test('caller-provided signer status and echoed IDs cannot settle either party without live query binding', () => {
  const expected = { contractId: 'envelope', customerId: 'person', transactionId: 'transaction' };
  const signed = { status: 'SIGNED', providerContractId: 'envelope', providerCustomerId: 'person', providerTransactionId: 'transaction' };
  assert.throws(() => assertSignerResult(signed, expected), code('PROVIDER_IDENTITY_MISMATCH'));
  assert.throws(() => assertSignerResult({ ...signed, providerCustomerId: 'other-person' }, expected), code('PROVIDER_IDENTITY_MISMATCH'));
  assert.throws(() => assertSignerResult({ status: 'SIGNED' }, expected), code('PROVIDER_IDENTITY_MISMATCH'));
});
test('draft, unconfirmed and unresolved legal body cannot become a real signing PDF', () => {
  const document = { status: 'PUBLISHED', confirmedBy: 'reviewer', confirmedAt: new Date(), content: '已批准正式条款' };
  assert.doesNotThrow(() => assertApprovedText(document));
  assert.throws(() => assertApprovedText({ ...document, status: 'DRAFT' }), code('LEGAL_NOT_APPROVED'));
  assert.throws(() => assertApprovedText({ ...document, confirmedBy: null }), code('LEGAL_NOT_APPROVED'));
  assert.throws(() => assertApprovedText({ ...document, content: '主体 {{运营主体}} 待补' }), code('LEGAL_PLACEHOLDERS'));
});
