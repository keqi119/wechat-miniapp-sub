import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createCipheriv, verify } from 'node:crypto';
import { WechatPaymentGateway } from '../src/integrations/wechat-payment';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = 1800000000000;
const settings = { enabled: true, appId: 'wx-test', merchantId: 'merchant-test', serial: 'merchant-serial', privateKey, apiV3Key: 'a'.repeat(32), notifyUrl: 'https://mini-api.example.test/api/callbacks/wechat-pay', refundNotifyUrl: 'https://mini-api.example.test/api/callbacks/wechat-refund', verifier: (serial: string) => { if (serial !== 'PUB_KEY_ID_TEST') throw new Error('unknown serial'); return publicKey; } };
function signed(body: unknown, timestamp = String(now / 1000)) {
  const text = JSON.stringify(body), nonce = 'response-nonce';
  const signature = createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${text}\n`).sign(privateKey, 'base64');
  return { text, headers: { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-serial': 'PUB_KEY_ID_TEST', 'wechatpay-signature': signature } };
}
function event(data: unknown) {
  const nonce = '012345678901'; const cipher = createCipheriv('aes-256-gcm', Buffer.from(settings.apiV3Key), nonce); cipher.setAAD(Buffer.from('transaction'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]);
  return signed({ id: 'EV-test', event_type: 'TRANSACTION.SUCCESS', resource: { algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: 'transaction', ciphertext: encrypted.toString('base64') } });
}
test('prepay signs original miniapp AppID, integer cents and exact outgoing body', async () => {
  const gateway = new WechatPaymentGateway(settings, async (url, init) => {
    assert.equal(url, 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi');
    const body = JSON.parse(init!.body as string); assert.equal(body.appid, settings.appId); assert.equal(body.amount.total, 12500); assert.equal(body.payer.openid, 'openid');
    assert.match(String((init!.headers as any).Authorization), /^WECHATPAY2-SHA256-RSA2048 /);
    const response = signed({ prepay_id: 'prepay-test' }); return new Response(response.text, { headers: response.headers });
  }, () => now);
  const params = await gateway.create({ paymentId: 'pay1', amount: 12500, openId: 'openid', description: '月订阅费' });
  assert.equal(params.package, 'prepay_id=prepay-test');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${settings.appId}\n${params.timeStamp}\n${params.nonceStr}\n${params.package}\n`), publicKey, Buffer.from(params.paySign, 'base64')), true);
  await assert.rejects(gateway.create({ paymentId: 'pay2', amount: 1.2, openId: 'openid', description: 'bad' }));
});
test('callback verifies raw bytes, freshness, identity and currency before accepting', () => {
  const gateway = new WechatPaymentGateway(settings, fetch, () => now);
  const data = { appid: settings.appId, mchid: settings.merchantId, out_trade_no: 'pay1', transaction_id: 'txn1', trade_state: 'SUCCESS', amount: { total: 12000, payer_total: 11000, currency: 'CNY' } };
  const valid = event(data); const decoded = gateway.decodeNotification(valid.text, valid.headers);
  assert.equal(decoded.paymentId, 'pay1'); assert.equal(decoded.amount, 12000);
  assert.throws(() => gateway.decodeNotification(valid.text + ' ', valid.headers));
  assert.throws(() => gateway.decodeNotification(valid.text, { ...valid.headers, 'wechatpay-serial': 'UNKNOWN' }));
  const stale = signed(JSON.parse(valid.text), String(now / 1000 - 301)); assert.throws(() => gateway.decodeNotification(stale.text, stale.headers));
  const otherApp = event({ ...data, appid: 'other' }); assert.throws(() => gateway.decodeNotification(otherApp.text, otherApp.headers));
  const wrongCurrency = event({ ...data, amount: { total: 12000, currency: 'USD' } }); assert.throws(() => gateway.decodeNotification(wrongCurrency.text, wrongCurrency.headers));
});
test('unsigned provider responses cannot create usable payment parameters', async () => {
  const gateway = new WechatPaymentGateway(settings, async () => new Response('{"prepay_id":"forged"}'), () => now);
  await assert.rejects(gateway.create({ paymentId: 'pay1', amount: 1, openId: 'openid', description: 'test' }));
});
test('query checks provider payment ID, refund validates total and remains processing', async () => {
  let responseBody: any = { appid: settings.appId, mchid: settings.merchantId, out_trade_no: 'other', trade_state: 'SUCCESS', transaction_id: 'txn', amount: { total: 100, currency: 'CNY' } };
  const gateway = new WechatPaymentGateway(settings, async () => { const r = signed(responseBody); return new Response(r.text, { headers: r.headers }); }, () => now);
  await assert.rejects(gateway.query('pay1'));
  responseBody = { out_refund_no: 'refund1', out_trade_no: 'pay1', refund_id: 'provider-refund', status: 'PROCESSING', amount: { refund: 40, total: 100, currency: 'CNY' } };
  assert.equal((await gateway.refund({ refundId: 'refund1', paymentId: 'pay1', amount: 40, totalAmount: 100, reason: '用户退订' })).status, 'PROCESSING');
  await assert.rejects(gateway.refund({ refundId: 'refund1', paymentId: 'pay1', amount: 101, totalAmount: 100, reason: 'bad' }));
});
