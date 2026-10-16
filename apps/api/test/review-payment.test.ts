import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createSign, generateKeyPairSync } from 'node:crypto';
import { WechatPaymentGateway } from '../src/integrations/wechat-payment';

// Official mini-program refund notification schema:
// https://pay.wechatpay.cn/doc/v3/merchant/4012791906
// Unlike refund query/create responses, amount does not contain currency.
test('official refund callback without currency settles after RSA and AES-GCM verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const now = Date.now(), timestamp = String(Math.floor(now / 1000)), apiV3Key = 'r'.repeat(32);
  const plain = { mchid: 'test-merchant', transaction_id: 'provider-payment', out_trade_no: 'payment1', refund_id: 'provider-refund', out_refund_no: 'refund1', refund_status: 'SUCCESS', success_time: '2026-10-16T12:00:00+08:00', user_received_account: '测试银行卡', amount: { total: 999, refund: 999, payer_total: 999, payer_refund: 999 } };
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), '012345678901'); cipher.setAAD(Buffer.from('refund'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plain)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  const raw = JSON.stringify({ id: 'review-refund-event', event_type: 'REFUND.SUCCESS', resource_type: 'encrypt-resource', resource: { algorithm: 'AEAD_AES_256_GCM', original_type: 'refund', associated_data: 'refund', nonce: '012345678901', ciphertext } });
  const signature = createSign('RSA-SHA256').update(`${timestamp}\nreview-nonce\n${raw}\n`).sign(privateKey, 'base64');
  const gateway = new WechatPaymentGateway({ enabled: true, appId: 'test-app', merchantId: 'test-merchant', serial: 'merchant-serial', privateKey, apiV3Key, notifyUrl: 'https://test.invalid/pay', refundNotifyUrl: 'https://test.invalid/refund', verifier: () => publicKey }, async () => { throw new Error('network is forbidden in review test'); }, () => now);
  const event = gateway.decodeNotification(raw, { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': 'review-nonce', 'wechatpay-signature': signature, 'wechatpay-serial': 'platform-serial' });
  assert.equal(event.kind, 'refund');
  assert.equal(event.status, 'SUCCEEDED');
  assert.equal(event.amount, 999);
  assert.equal(event.paymentId, 'payment1');
});
