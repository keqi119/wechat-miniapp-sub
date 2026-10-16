import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { IdentityGateway } from '../common/gateways';
import { Db } from '../common/db';
import { ensure, fail } from '../common/errors';
import { mobile as mobileSchema } from '../common/data';
import { sendAliyunCode } from './aliyun-sms';
import type { Fetch } from './wechat-payment';

export interface IdentitySettings { appId: string; secret: string; smsEnabled: boolean; smsHashSecret: string }
export function identitySettings(env = process.env): IdentitySettings { return { appId: env.WECHAT_MINIPROGRAM_APP_ID || '', secret: env.WECHAT_MINIPROGRAM_APP_SECRET || '', smsEnabled: env.PORTAL_SMS_ENABLED === 'true', smsHashSecret: env.SESSION_SECRET || '' }; }
export class RealIdentityGateway extends IdentityGateway {
  private cachedToken?: { value: string; expires: number };
  private tokenRequest?: Promise<string>;
  constructor(private db: Db, private settings: IdentitySettings, private transport: Fetch = fetch, private sendCode = sendAliyunCode, private clock = Date.now) { super(); }
  private async call(url: string, data?: unknown): Promise<any> {
    let response: Response;
    try { response = await this.transport(url, { ...(data ? { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' }); }
    catch { return fail(503, 'WECHAT_UNAVAILABLE', '微信服务暂时无法连接'); }
    let result: any; try { result = await response.json(); } catch { return fail(502, 'WECHAT_INVALID_RESPONSE', '微信服务响应无效'); }
    ensure(response.ok && (!result.errcode || result.errcode === 0), 400, 'WECHAT_AUTH_FAILED', '微信授权未成功，请重新授权'); return result;
  }
  private configured() { ensure(this.settings.appId && this.settings.secret, 503, 'WECHAT_UNAVAILABLE', '微信登录尚未配置完成'); }
  private async openId(code: string) {
    this.configured(); ensure(code.length > 0 && code.length <= 256, 400, 'WECHAT_CODE_INVALID', '微信登录凭证无效');
    const query = new URLSearchParams({ appid: this.settings.appId, secret: this.settings.secret, js_code: code, grant_type: 'authorization_code' });
    const data = await this.call(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
    ensure(typeof data.openid === 'string' && data.openid.length > 0, 400, 'WECHAT_AUTH_FAILED', '微信身份校验未成功'); return data.openid as string;
  }
  private async accessToken() {
    this.configured(); if (this.cachedToken && this.cachedToken.expires > this.clock()) return this.cachedToken.value;
    if (!this.tokenRequest) this.tokenRequest = (async () => { const data = await this.call('https://api.weixin.qq.com/cgi-bin/stable_token', { grant_type: 'client_credential', appid: this.settings.appId, secret: this.settings.secret }); ensure(typeof data.access_token === 'string' && Number.isFinite(data.expires_in) && data.expires_in > 120, 502, 'WECHAT_TOKEN_INVALID', '微信授权服务响应无效'); this.cachedToken = { value: data.access_token, expires: this.clock() + (data.expires_in - 120) * 1000 }; return this.cachedToken.value; })().finally(() => { this.tokenRequest = undefined; });
    return this.tokenRequest;
  }
  async wechat(input: { loginCode: string; phoneCode: string }) {
    ensure(input.phoneCode.length > 0 && input.phoneCode.length <= 256, 400, 'WECHAT_CODE_INVALID', '微信手机号凭证无效');
    const openId = await this.openId(input.loginCode), accessToken = await this.accessToken();
    const result = await this.call(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`, { code: input.phoneCode });
    ensure(result.phone_info?.watermark?.appid === this.settings.appId && String(result.phone_info?.countryCode) === '86', 400, 'WECHAT_PHONE_INVALID', '微信手机号授权信息无效');
    return { openId, mobile: mobileSchema.parse(result.phone_info.purePhoneNumber) };
  }
  private smsConfigured() { ensure(this.settings.smsEnabled && this.settings.smsHashSecret.length >= 32, 503, 'SMS_UNAVAILABLE', '短信登录尚未配置完成'); }
  private codeHash(id: string, code: string) { return createHmac('sha256', this.settings.smsHashSecret).update(`${id}:${code}`).digest('hex'); }
  async requestSms(mobile: string) {
    this.smsConfigured(); mobileSchema.parse(mobile);
    const code = randomInt(0, 1000000).toString().padStart(6, '0'), id = randomUUID(), now = new Date(this.clock());
    await this.db.serial(async tx => {
      const last = await tx.smsChallenge.findFirst({ where: { mobile }, orderBy: { sentAt: 'desc' } });
      ensure(!last || now.getTime() - last.sentAt.getTime() >= 60000, 429, 'SMS_RATE_LIMITED', '请一分钟后再获取验证码');
      const daily = await tx.smsChallenge.count({ where: { mobile, sentAt: { gt: new Date(this.clock() - 86400000) } } });
      const hourly = await tx.smsChallenge.count({ where: { sentAt: { gt: new Date(this.clock() - 3600000) } } });
      ensure(daily < 10 && hourly < 100, 429, 'SMS_RATE_LIMITED', '短信请求过于频繁，请稍后再试');
      await tx.smsChallenge.updateMany({ where: { mobile, status: 'SENT' }, data: { status: 'REPLACED' } });
      await tx.smsChallenge.create({ data: { id, mobile, codeHash: this.codeHash(id, code), status: 'SENDING', sentAt: now, expiresAt: new Date(this.clock() + 300000) } });
    });
    try { await this.sendCode(mobile, code); await this.db.smsChallenge.update({ where: { id }, data: { status: 'SENT' } }); }
    catch { await this.db.smsChallenge.update({ where: { id }, data: { status: 'FAILED' } }); fail(503, 'SMS_SEND_FAILED', '短信未发送成功，请稍后再试'); }
  }
  async verifySms(input: { mobile: string; code: string; loginCode?: string }) {
    this.smsConfigured(); mobileSchema.parse(input.mobile); ensure(/^\d{6}$/.test(input.code), 400, 'SMS_CODE_INVALID', '验证码无效或已过期');
    // Commit failed-attempt counters before returning an error; throwing inside would roll them back.
    const accepted = await this.db.serial(async tx => {
      const row = await tx.smsChallenge.findFirst({ where: { mobile: input.mobile }, orderBy: { sentAt: 'desc' } });
      if (!row || row.status !== 'SENT' || row.consumedAt || row.expiresAt.getTime() <= this.clock() || row.attempts >= 5) return false;
      const actual = Buffer.from(this.codeHash(row.id, input.code), 'hex'), expected = Buffer.from(row.codeHash, 'hex');
      const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
      await tx.smsChallenge.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, ...(valid ? { status: 'CONSUMED', consumedAt: new Date(this.clock()) } : {}) } }); return valid;
    });
    ensure(accepted, 400, 'SMS_CODE_INVALID', '验证码无效或已过期');
    return { mobile: input.mobile, ...(input.loginCode ? { openId: await this.openId(input.loginCode) } : {}) };
  }
}
