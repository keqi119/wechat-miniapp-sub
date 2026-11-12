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

test('refund acceptance and native abnormal are distinct; only query missing refund authorizes recovery',async()=>{
 const responseBody={out_refund_no:'refund9b',out_trade_no:'pay9b',refund_id:'provider9b',status:'ABNORMAL',create_time:new Date(now-60000).toISOString(),amount:{refund:40,total:100,currency:'CNY'}};
 const gateway=new WechatPaymentGateway(settings,async()=>{const r=signed(responseBody);return new Response(r.text,{headers:r.headers});},()=>now);
 const result:any=await gateway.queryRefund('refund9b');
 assert.equal(result.nativeStatus,'ABNORMAL');assert.equal(result.acceptedAt,responseBody.create_time);assert.equal(result.evidenceSource,'QUERY');
 const missing=new WechatPaymentGateway(settings,async()=>{const r=signed({code:'RESOURCE_NOT_EXISTS'});return new Response(r.text,{status:404,headers:r.headers});},()=>now);
 await assert.rejects(missing.queryRefund('refund9b'),(e:any)=>e.getResponse().error.code==='REFUND_NOT_FOUND');
 await assert.rejects(missing.refund({refundId:'refund9b',paymentId:'pay9b',amount:40,totalAmount:100,reason:'test'}),(e:any)=>e.getResponse().error.code==='REFUND_ORIGINAL_ORDER_NOT_FOUND');
});

test('native SUCCESS to merchant or unknown destination is not customer receipt and callback time is not acceptance',async()=>{
 const base:any={out_refund_no:'refund9b',out_trade_no:'pay9b',refund_id:'provider9b',status:'SUCCESS',success_time:new Date(now-5000).toISOString(),create_time:new Date(now-60000).toISOString(),amount:{refund:40,total:100,currency:'CNY'},channel:'ORIGINAL',user_received_account:'商户基本账户商户结算银行账户'};
 let body=base;const gateway=new WechatPaymentGateway(settings,async()=>{const r=signed(body);return new Response(r.text,{headers:r.headers});},()=>now);
 const merchant:any=await gateway.queryRefund('refund9b');assert.equal(merchant.status,'PROCESSING');assert.equal(merchant.receiptDestination,'MERCHANT');assert.equal(merchant.nativeStatus,'SUCCESS');
 body={...base,user_received_account:undefined};assert.equal((await gateway.queryRefund('refund9b') as any).receiptDestination,'UNKNOWN');
 body={...base,user_received_account:'招商银行信用卡'};assert.equal((await gateway.queryRefund('refund9b')).status,'SUCCEEDED');
 const nonce='012345678901',cipher=createCipheriv('aes-256-gcm',Buffer.from(settings.apiV3Key),nonce);cipher.setAAD(Buffer.from('refund'));
 const data={...body,status:undefined,refund_status:'SUCCESS',mchid:settings.merchantId,create_time:undefined};const encrypted=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final(),cipher.getAuthTag()]);
 const r=signed({id:'notify9b',event_type:'REFUND.SUCCESS',create_time:new Date(now).toISOString(),resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:'refund',ciphertext:encrypted.toString('base64')}});const callback:any=gateway.decodeNotification(r.text,r.headers);assert.equal(callback.acceptedAt,undefined);assert.equal(callback.evidenceSource,'CALLBACK');
});

test('signed customer-account rejection remains distinct from generic provider errors',async()=>{
 const gateway=new WechatPaymentGateway(settings,async()=>{const r=signed({code:'USER_ACCOUNT_ABNORMAL'});return new Response(r.text,{status:400,headers:r.headers});},()=>now);
 await assert.rejects(gateway.refund({refundId:'refund9b',paymentId:'pay9b',amount:40,totalAmount:100,reason:'test'}),(e:any)=>e.getResponse().error.code==='REFUND_USER_ACCOUNT_ABNORMAL');
});
