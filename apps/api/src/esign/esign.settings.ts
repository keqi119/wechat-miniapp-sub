import { loadFadadaConfig } from './fadada/fadada.config';
import type { FadadaConfig } from './fadada/fadada.types';
import { ensure } from '../common/errors';
export interface FadadaSettings extends FadadaConfig { identityEncryptionKey: string; cjkFontPath?: string; signingEnabled: boolean; }
export function fadadaSettings(env: NodeJS.ProcessEnv = process.env): FadadaSettings {
  const enabled = env.FADADA_ENABLED === 'true';
  const base = enabled ? loadFadadaConfig({ get: <T extends string>(key: string) => env[key] as T | undefined }) : { enabled: false, accountRegisterEnabled: false, realNameVerifyEnabled: false, fullSigningSmokeEnabled: false, appId: '', appSecret: '', baseUrl: '', env: 'sandbox' as const, apiVersion: '2.0', requestTimeoutMs: 15000, signUrlQuantity: 1, signUrlValidityMinutes: 30 };
  if (enabled) { const url = new URL(base.baseUrl); ensure(url.protocol === 'https:' && /(^|\.)fadada\.com$/.test(url.hostname) && !url.username && !url.password, 503, 'FADADA_CONFIG', '法大大接口地址未经核验'); }
  return { ...base, identityEncryptionKey: env.ESIGN_IDENTITY_ENCRYPTION_KEY || '', cjkFontPath: env.FADADA_CJK_FONT_PATH, signingEnabled: env.FADADA_SIGNING_ENABLED === 'true', signNotifyUrl: env.FADADA_SIGN_NOTIFY_URL || 'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign', verifyNotifyUrl: env.FADADA_VERIFY_NOTIFY_URL || 'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-identity', platformCustomerId: env.FADADA_PLATFORM_CUSTOMER_ID, platformSignatureId: env.FADADA_PLATFORM_SIGNATURE_ID, signReturnUrl: env.FADADA_SIGN_RETURN_URL || 'https://mini-api.subauto.keybox.cloud/api/public/esign-return', verifyReturnUrl: env.FADADA_VERIFY_RETURN_URL || 'https://mini-api.subauto.keybox.cloud/api/public/esign-return' };
}
