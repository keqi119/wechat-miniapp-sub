import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerificationProvider } from '../src/payment-verification/config';

test('verification is disabled by default even when ordinary bill payment is enabled', async () => {
  const env = Object.freeze({ WECHAT_PAY_ENABLED: 'true', WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH: '/must-not-read-private-file' });
  const provider = createVerificationProvider(env);
  assert.equal(provider.enabled, false);
  await assert.rejects(() => provider.gateway.create({ paymentId: 'pv_test', amount: 1, openId: 'synthetic', description: 'test' }));
  assert.equal(env.WECHAT_PAY_ENABLED, 'true');
});

test('verification requires the exact independent HTTPS callback when enabled', () => {
  for (const url of ['', 'http://api.invalid/api/callbacks/wechat-pay-verification', 'https://api.invalid/api/callbacks/wechat-pay', 'https://api.invalid/api/callbacks/wechat-pay-verification?secret=x', 'https://user:pass@api.invalid/api/callbacks/wechat-pay-verification']) {
    assert.throws(() => createVerificationProvider({ WECHAT_PAY_VERIFICATION_ENABLED: 'true', WECHAT_PAY_VERIFICATION_NOTIFY_URL: url }), error => (error as any).getResponse().error.code === 'VERIFICATION_CONFIG');
  }
});

test('independent configuration does not mutate the disabled ordinary payment flag or callback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verification-config-')), path = join(dir, 'synthetic-key.pem');
  try {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    writeFileSync(path, privateKey);
    const env = Object.freeze({ WECHAT_PAY_ENABLED: 'false', WECHAT_PAY_NOTIFY_URL: 'https://api.invalid/api/callbacks/wechat-pay', WECHAT_PAY_VERIFICATION_ENABLED: 'true',
      WECHAT_PAY_VERIFICATION_NOTIFY_URL: 'https://api.invalid/api/callbacks/wechat-pay-verification', WECHAT_MINIPROGRAM_APP_ID: 'synthetic-app', WECHAT_PAY_MCH_ID: 'synthetic-mch',
      WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH: path, WECHAT_PAY_MERCHANT_SERIAL_NO: 'synthetic-serial', WECHAT_PAY_API_V3_KEY: 'k'.repeat(32) });
    assert.equal(createVerificationProvider(env).enabled, true);
    assert.equal(env.WECHAT_PAY_ENABLED, 'false'); assert.equal(env.WECHAT_PAY_NOTIFY_URL, 'https://api.invalid/api/callbacks/wechat-pay');
  } finally { unlinkSync(path); rmdirSync(dir); }
});
