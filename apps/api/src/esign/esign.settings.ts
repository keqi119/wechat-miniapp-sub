import { loadFadadaConfig } from './fadada/fadada.config';
import type { FadadaConfig } from './fadada/fadada.types';
import { ensure } from '../common/errors';
import {approvedPlatformCallback,approvedPlatformReturn,platformCallback,miniappReturnUrl} from '../common/platform-origins';
export const ESIGN_SETTINGS=Symbol('ESIGN_SETTINGS');
export interface FadadaSettings extends FadadaConfig { identityEncryptionKey: string; cjkFontPath?: string; signingEnabled: boolean; }
export function fadadaSettings(env: NodeJS.ProcessEnv = process.env): FadadaSettings {
  // Missing legacy credentials must not prevent an OFFLINE installation from booting.
  const complete = ['FADADA_BASE_URL','FADADA_APP_ID','FADADA_APP_SECRET'].every(key=>Boolean(env[key]?.trim()));
  const enabled = env.FADADA_ENABLED === 'true' && complete;
  const base = enabled ? loadFadadaConfig({ get: <T extends string>(key: string) => env[key] as T | undefined }) : { enabled: false, accountRegisterEnabled: false, realNameVerifyEnabled: false, fullSigningSmokeEnabled: false, appId: '', appSecret: '', baseUrl: '', env: 'sandbox' as const, apiVersion: '2.0', requestTimeoutMs: 15000, signUrlQuantity: 1, signUrlValidityMinutes: 30 };
  if (enabled) { const url = new URL(base.baseUrl); ensure(url.protocol === 'https:' && /(^|\.)fadada\.com$/.test(url.hostname) && !url.username && !url.password, 503, 'FADADA_CONFIG', '法大大接口地址未经核验'); }
  const signNotifyUrl=approvedPlatformCallback(env.FADADA_SIGN_NOTIFY_URL??platformCallback('fadada-sign',env),'fadada-sign',env);
  const verifyNotifyUrl=approvedPlatformCallback(env.FADADA_VERIFY_NOTIFY_URL??platformCallback('fadada-identity',env),'fadada-identity',env);
  const signReturnUrl=approvedPlatformReturn(env.FADADA_SIGN_RETURN_URL??miniappReturnUrl(env),env);
  const verifyReturnUrl=approvedPlatformReturn(env.FADADA_VERIFY_RETURN_URL??miniappReturnUrl(env),env);
  return { ...base, identityEncryptionKey: env.ESIGN_IDENTITY_ENCRYPTION_KEY || '', cjkFontPath: env.FADADA_CJK_FONT_PATH, signingEnabled: env.FADADA_SIGNING_ENABLED === 'true', signNotifyUrl, verifyNotifyUrl, platformCustomerId: env.FADADA_PLATFORM_CUSTOMER_ID, platformSignatureId: env.FADADA_PLATFORM_SIGNATURE_ID, signReturnUrl, verifyReturnUrl };
}
