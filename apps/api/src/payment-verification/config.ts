import { ensure } from '../common/errors';
import { WechatPaymentGateway, wechatPaySettings } from '../integrations/wechat-payment';

export const VERIFICATION_PROVIDER = Symbol('VERIFICATION_PROVIDER');
export type VerificationProvider = { enabled: boolean; gateway: WechatPaymentGateway };
export function createVerificationProvider(env = process.env): VerificationProvider {
  const enabled = env.WECHAT_PAY_VERIFICATION_ENABLED === 'true';
  const notifyUrl = env.WECHAT_PAY_VERIFICATION_NOTIFY_URL || '';
  if (enabled) {
    let valid = false;
    try {
      const url = new URL(notifyUrl);
      valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && url.pathname === '/api/callbacks/wechat-pay-verification';
    } catch { /* Missing or invalid configuration stays unavailable. */ }
    ensure(valid, 503, 'VERIFICATION_CONFIG', '支付验收回调地址必须为独立HTTPS回调');
  }
  // A copy keeps ordinary bill payment disabled. No process-wide flags are changed.
  const settings = wechatPaySettings({ ...env, WECHAT_PAY_ENABLED: String(enabled), WECHAT_PAY_NOTIFY_URL: notifyUrl });
  if (enabled) ensure(settings.appId && settings.merchantId && settings.privateKey && settings.serial && Buffer.byteLength(settings.apiV3Key) === 32,
    503, 'VERIFICATION_CONFIG', '支付验收渠道配置不完整');
  return { enabled, gateway: new WechatPaymentGateway(settings) };
}
