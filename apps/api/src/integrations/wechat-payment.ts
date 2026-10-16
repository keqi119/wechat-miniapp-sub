import { createDecipheriv, createSign, createVerify, randomBytes, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PaymentGateway } from '../common/gateways';
import { ensure, fail } from '../common/errors';

export interface WechatPaySettings {
  enabled: boolean; appId: string; merchantId: string; serial: string; privateKey: string; apiV3Key: string;
  notifyUrl: string; refundNotifyUrl: string; verifier(serial: string): string;
}
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const sign = (message: string, key: string) => createSign('RSA-SHA256').update(message).sign(key, 'base64');
const cents = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const identifier = (value: string) => ensure(/^[a-zA-Z0-9_-]{1,32}$/.test(value), 400, 'PAYMENT_ID_INVALID', '支付单号无效');
function boundedText(value: string, limit: number) { let result = ''; for (const char of value) { if (Buffer.byteLength(result + char) > limit) break; result += char; } return result; }

export class WechatPaymentGateway extends PaymentGateway {
  constructor(private settings: WechatPaySettings, private transport: Fetch = fetch, private clock = Date.now) { super(); }
  private configured() { ensure(this.settings.enabled && this.settings.appId && this.settings.merchantId && this.settings.privateKey && this.settings.serial, 503, 'PAYMENT_UNAVAILABLE', '微信支付尚未配置完成'); }
  private verify(body: string, headers: Record<string, string | string[] | undefined>) {
    const header = (name: string) => { const value = headers[name]; ensure(typeof value === 'string' && value.length > 0, 400, 'PAYMENT_SIGNATURE_INVALID', '微信支付验签失败'); return value; };
    const timestamp = header('wechatpay-timestamp'), nonce = header('wechatpay-nonce'), signature = header('wechatpay-signature'), serial = header('wechatpay-serial');
    ensure(/^\d{10}$/.test(timestamp) && Math.abs(this.clock() / 1000 - Number(timestamp)) <= 300, 400, 'PAYMENT_SIGNATURE_EXPIRED', '微信支付通知已过期');
    ensure(!signature.startsWith('WECHATPAY/SIGNTEST/'), 400, 'PAYMENT_SIGNATURE_INVALID', '微信支付验签失败');
    let valid = false;
    try { valid = createVerify('RSA-SHA256').update(`${timestamp}\n${nonce}\n${body}\n`).verify(this.settings.verifier(serial), signature, 'base64'); } catch { /* Reject unrecognized certificates and malformed signatures. */ }
    ensure(valid, 400, 'PAYMENT_SIGNATURE_INVALID', '微信支付验签失败');
  }
  private async request(method: string, path: string, data?: unknown) {
    this.configured();
    const body = data === undefined ? '' : JSON.stringify(data), timestamp = Math.floor(this.clock() / 1000).toString(), nonce = randomBytes(16).toString('hex');
    const signature = sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`, this.settings.privateKey);
    const Authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.settings.merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.settings.serial}"`;
    let response: Response;
    try { response = await this.transport(`https://api.mch.weixin.qq.com${path}`, { method, headers: { Authorization, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'chundian-independent-platform' }, ...(body ? { body } : {}), signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { return fail(503, 'PAYMENT_NETWORK_ERROR', '支付服务暂时无法连接，请稍后查询支付状态'); }
    const raw = await response.text();
    this.verify(raw, Object.fromEntries(response.headers.entries()));
    let result: any = {}; try { result = raw ? JSON.parse(raw) : {}; } catch { fail(502, 'PAYMENT_RESPONSE_INVALID', '支付服务响应无效'); }
    if (!response.ok) {
      if (result.code === 'ORDER_NOT_EXIST') fail(404, 'PAYMENT_ORDER_NOT_EXIST', '渠道尚未查到该支付单，请用原支付单重试');
      if (result.code === 'ORDERCLOSED') fail(409, 'PAYMENT_ALREADY_CLOSED', '渠道支付单已经关闭');
      if (result.code === 'RESOURCE_NOT_EXISTS' && path.startsWith('/v3/refund/')) fail(404, 'REFUND_NOT_FOUND', '渠道尚未查到该退款单');
      fail(502, 'PAYMENT_PROVIDER_ERROR', `微信支付暂未受理（${/^[A-Z_]{1,60}$/.test(result.code) ? result.code : response.status}），请查询状态后重试`);
    }
    return result;
  }
  async create(input: { paymentId: string; amount: number; openId: string; description: string; expiresAt?: string }) {
    identifier(input.paymentId); ensure(cents(input.amount) && input.openId, 400, 'PAYMENT_INVALID', '支付金额或微信身份无效');
    ensure(/^https:\/\//.test(this.settings.notifyUrl), 503, 'PAYMENT_NOTIFY_INVALID', '支付回调地址未配置');
    if (input.expiresAt) ensure(Number.isFinite(Date.parse(input.expiresAt)) && Date.parse(input.expiresAt) > this.clock(), 400, 'PAYMENT_EXPIRED', '支付授权已过期');
    const result = await this.request('POST', '/v3/pay/transactions/jsapi', { appid: this.settings.appId, mchid: this.settings.merchantId, out_trade_no: input.paymentId, description: boundedText(input.description, 127), notify_url: this.settings.notifyUrl, ...(input.expiresAt ? { time_expire: input.expiresAt } : {}), amount: { total: input.amount, currency: 'CNY' }, payer: { openid: input.openId } });
    ensure(typeof result.prepay_id === 'string' && result.prepay_id.length > 0, 502, 'PAYMENT_PREPAY_MISSING', '微信支付未返回支付凭据');
    const timeStamp = Math.floor(this.clock() / 1000).toString(), nonceStr = randomBytes(16).toString('hex'), packageValue = `prepay_id=${result.prepay_id}`;
    return { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign: sign(`${this.settings.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, this.settings.privateKey) };
  }
  private transaction(data: any, expectedId?: string) {
    ensure(data.appid === this.settings.appId && data.mchid === this.settings.merchantId, 400, 'PAYMENT_IDENTITY_MISMATCH', '支付主体不匹配');
    ensure(typeof data.out_trade_no === 'string' && (!expectedId || data.out_trade_no === expectedId), 400, 'PAYMENT_ORDER_MISMATCH', '支付单号不匹配');
    ensure(cents(data.amount?.total) && data.amount.currency === 'CNY', 400, 'PAYMENT_AMOUNT_INVALID', '支付金额无效');
    const status = ({ SUCCESS: 'SUCCEEDED', REFUND: 'SUCCEEDED', NOTPAY: 'PENDING', USERPAYING: 'PENDING', CLOSED: 'CLOSED', REVOKED: 'CLOSED', PAYERROR: 'FAILED' } as const)[data.trade_state as string as 'SUCCESS'];
    ensure(status, 502, 'PAYMENT_STATE_INVALID', '支付状态暂无法识别');
    ensure(status !== 'SUCCEEDED' || typeof data.transaction_id === 'string', 400, 'PAYMENT_TRANSACTION_MISSING', '支付凭据缺失');
    return { paymentId: data.out_trade_no as string, status: status as 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED', transactionId: data.transaction_id as string | undefined, amount: data.amount.total as number, payerOpenId: data.payer?.openid as string | undefined };
  }
  async query(paymentId: string) { identifier(paymentId); return this.transaction(await this.request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(paymentId)}?mchid=${encodeURIComponent(this.settings.merchantId)}`), paymentId); }
  async close(paymentId: string) { identifier(paymentId); await this.request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(paymentId)}/close`, { mchid: this.settings.merchantId }); }
  private refundResult(data: any, expectedId: string, fromNotification = false) {
    ensure(data.out_refund_no === expectedId && typeof data.refund_id === 'string', 400, 'REFUND_ID_MISMATCH', '退款单号不匹配');
    // The official refund notification omits currency; query/create responses include it.
    const currencyValid = data.amount?.currency === 'CNY' || (fromNotification && data.amount?.currency === undefined);
    ensure(cents(data.amount?.refund) && cents(data.amount?.total) && data.amount.refund <= data.amount.total && currencyValid, 400, 'REFUND_AMOUNT_INVALID', '退款金额无效');
    const states: Record<string, 'SUCCEEDED' | 'PROCESSING' | 'FAILED'> = { SUCCESS: 'SUCCEEDED', PROCESSING: 'PROCESSING', CLOSED: 'FAILED', ABNORMAL: 'PROCESSING' };
    ensure(states[data.status], 502, 'REFUND_STATE_INVALID', '退款状态暂无法识别');
    return { status: states[data.status]!, providerRefundId: data.refund_id as string, refundId: expectedId, paymentId: data.out_trade_no as string, amount: data.amount.refund as number, totalAmount: data.amount.total as number };
  }
  async refund(input: { refundId: string; paymentId: string; amount: number; totalAmount: number; reason: string }) {
    identifier(input.refundId); identifier(input.paymentId); ensure(cents(input.amount) && cents(input.totalAmount) && input.amount <= input.totalAmount, 400, 'REFUND_AMOUNT_INVALID', '退款金额无效');
    const result = this.refundResult(await this.request('POST', '/v3/refund/domestic/refunds', { out_trade_no: input.paymentId, out_refund_no: input.refundId, reason: boundedText(input.reason, 80), notify_url: this.settings.refundNotifyUrl, amount: { refund: input.amount, total: input.totalAmount, currency: 'CNY' } }), input.refundId);
    ensure(result.paymentId === input.paymentId && result.amount === input.amount && result.totalAmount === input.totalAmount, 400, 'REFUND_MISMATCH', '退款信息不匹配'); return result;
  }
  async queryRefund(refundId: string) { identifier(refundId); return this.refundResult(await this.request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(refundId)}`), refundId); }
  decodeNotification(raw: string, headers: Record<string, string | string[] | undefined>) {
    this.configured(); this.verify(raw, headers);
    const event = JSON.parse(raw); ensure(event.id && event.resource?.algorithm === 'AEAD_AES_256_GCM', 400, 'PAYMENT_RESOURCE_INVALID', '支付通知格式无效');
    const resource = event.resource, encrypted = Buffer.from(resource.ciphertext, 'base64');
    ensure(Buffer.byteLength(this.settings.apiV3Key) === 32 && encrypted.length >= 16, 400, 'PAYMENT_RESOURCE_INVALID', '支付通知格式无效');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.settings.apiV3Key), resource.nonce);
    decipher.setAAD(Buffer.from(resource.associated_data || '')); decipher.setAuthTag(encrypted.subarray(-16));
    const data = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
    if (String(event.event_type).startsWith('REFUND.')) {
      ensure(data.mchid === this.settings.merchantId, 400, 'PAYMENT_IDENTITY_MISMATCH', '支付主体不匹配');
      return { kind: 'refund' as const, eventId: String(event.id), ...this.refundResult({ ...data, status: data.refund_status }, data.out_refund_no, true) };
    }
    ensure(event.event_type === 'TRANSACTION.SUCCESS' && data.trade_state === 'SUCCESS', 400, 'PAYMENT_EVENT_INVALID', '支付通知类型无效');
    return { kind: 'payment' as const, eventId: String(event.id), ...this.transaction(data) };
  }
}

export function wechatPaySettings(env = process.env): WechatPaySettings {
  const enabled = env.WECHAT_PAY_ENABLED === 'true';
  const read = (path?: string) => path ? readFileSync(path, 'utf8') : '';
  return { enabled, appId: env.WECHAT_MINIPROGRAM_APP_ID || '', merchantId: env.WECHAT_PAY_MCH_ID || '', serial: env.WECHAT_PAY_MERCHANT_SERIAL_NO || '', privateKey: enabled ? read(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH) : '', apiV3Key: env.WECHAT_PAY_API_V3_KEY || '', notifyUrl: env.WECHAT_PAY_NOTIFY_URL || '', refundNotifyUrl: env.WECHAT_PAY_REFUND_NOTIFY_URL || '', verifier(serial) {
    if (serial.startsWith('PUB_KEY_ID_')) { ensure(serial === env.WECHAT_PAY_PUBLIC_KEY_ID && env.WECHAT_PAY_PUBLIC_KEY_PATH, 400, 'PAYMENT_KEY_UNKNOWN', '支付验签公钥未配置'); return read(env.WECHAT_PAY_PUBLIC_KEY_PATH); }
    const certPaths = (env.WECHAT_PAY_PLATFORM_CERT_PATHS || env.WECHAT_PAY_PLATFORM_CERT_PATH || '').split(';').filter(Boolean);
    for (const path of certPaths) {
      const certificates = read(path).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
      for (const pem of certificates) {
        const cert = new X509Certificate(pem);
        if (cert.serialNumber.toUpperCase() === serial.toUpperCase()) { ensure(Date.now() >= Date.parse(cert.validFrom) && Date.now() <= Date.parse(cert.validTo), 400, 'PAYMENT_CERT_EXPIRED', '支付验签证书已过期'); return pem; }
      }
    }
    return fail(400, 'PAYMENT_CERT_UNKNOWN', '支付验签证书未配置');
  } };
}
