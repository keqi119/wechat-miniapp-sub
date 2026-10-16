import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ensure, fail } from '../common/errors';
import type { Fetch } from './wechat-payment';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// ACS3-HMAC-SHA256: https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
export function signAliyunRequest(input: { host: string; action: string; version: string; parameters: Record<string, string>; keyId: string; keySecret: string; securityToken?: string; date?: string; nonce?: string }) {
  const query = Object.entries(input.parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
  const headers: Record<string, string> = { host: input.host, 'x-acs-action': input.action, 'x-acs-content-sha256': hash(''), 'x-acs-date': input.date || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), 'x-acs-signature-nonce': input.nonce || randomUUID(), 'x-acs-version': input.version };
  if (input.securityToken) headers['x-acs-security-token'] = input.securityToken;
  const names = Object.keys(headers).sort(), signedHeaders = names.join(';');
  const canonical = ['POST', '/', query, names.map(name => `${name}:${headers[name]}\n`).join(''), signedHeaders, hash('')].join('\n');
  const signature = createHmac('sha256', input.keySecret).update(`ACS3-HMAC-SHA256\n${hash(canonical)}`).digest('hex');
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${input.keyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { url: `https://${input.host}/?${query}`, headers };
}
export async function sendAliyunCode(mobile: string, code: string, env = process.env, transport: Fetch = fetch) {
  const keys = ['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_LOGIN_TEMPLATE_CODE'];
  ensure(keys.every(key => env[key]?.trim()), 503, 'SMS_UNAVAILABLE', '短信服务尚未配置完成');
  const request = signAliyunRequest({ host: 'dysmsapi.aliyuncs.com', action: 'SendSms', version: '2017-05-25', keyId: env.ALIYUN_SMS_ACCESS_KEY_ID!, keySecret: env.ALIYUN_SMS_ACCESS_KEY_SECRET!, parameters: { PhoneNumbers: mobile, SignName: env.ALIYUN_SMS_SIGN_NAME!, TemplateCode: env.ALIYUN_SMS_LOGIN_TEMPLATE_CODE!, TemplateParam: JSON.stringify({ [env.ALIYUN_SMS_TEMPLATE_CODE_VARIABLE || 'code']: code }) } });
  try {
    const response = await transport(request.url, { method: 'POST', headers: request.headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
    const data: any = await response.json();
    ensure(response.ok && data.Code === 'OK', 503, 'SMS_SEND_FAILED', '短信发送未成功，请稍后重试');
  } catch { fail(503, 'SMS_SEND_FAILED', '短信发送未成功，请稍后重试'); }
}
