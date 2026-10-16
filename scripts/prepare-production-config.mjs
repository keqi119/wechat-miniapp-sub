import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require = createRequire(resolve('apps/api/package.json'));
const { parse } = require('dotenv');
const path = '.runtime/production/.env.production';
const prior = existsSync(path) ? parse(readFileSync(path)) : {};
const release = process.argv.find(arg => arg.startsWith('--release='))?.slice('--release='.length);
if (release && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(release)) throw new Error('Invalid release ID');
const providers = parse(readFileSync('.env.providers.local'));
if (providers.WECHAT_PAY_PLATFORM_CERT_PATHS?.trim()) {
  throw new Error('WECHAT_PAY_PLATFORM_CERT_PATHS is unsupported for production; combine certificates into one PEM collection and use WECHAT_PAY_PLATFORM_CERT_PATH');
}
delete providers.FADADA_AUTO_SIGN_ENABLED;
const fontPath = providers.FADADA_CJK_FONT_PATH;
if (fontPath?.trim() && (!fontPath.startsWith('/') || fontPath.includes('\\') || /^[a-zA-Z]:/.test(fontPath))) {
  throw new Error('FADADA_CJK_FONT_PATH must be an absolute Linux container path');
}
if (!fontPath?.trim()) delete providers.FADADA_CJK_FONT_PATH;
const random = () => randomBytes(32).toString('hex');
const password = prior.POSTGRES_PASSWORD || random();
const identityKey = prior.ESIGN_IDENTITY_ENCRYPTION_KEY;
const normalizedIdentityKey = identityKey && /^[a-f0-9]{64}$/.test(identityKey)
  ? Buffer.from(identityKey, 'hex').toString('base64') : identityKey;
if (normalizedIdentityKey && Buffer.from(normalizedIdentityKey, 'base64').length !== 32) throw new Error('Existing identity encryption key is invalid');
const env = {
  NODE_ENV: 'production', APP_ENV: 'production', PORT: '3101',
  API_BASE_URL: 'https://mini-api.subauto.keybox.cloud/api',
  ADMIN_ORIGIN: 'https://mini-admin.subauto.keybox.cloud',
  CORS_ORIGIN: 'https://mini-admin.subauto.keybox.cloud',
  POSTGRES_USER: 'chundian_prod', POSTGRES_DB: 'chundian_prod', POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://chundian_prod:${password}@db:5432/chundian_prod?connection_limit=8`,
  JWT_SECRET: prior.JWT_SECRET || random(), SESSION_SECRET: prior.SESSION_SECRET || random(),
  BOOTSTRAP_ADMIN_USERNAME: prior.BOOTSTRAP_ADMIN_USERNAME || 'admin',
  BOOTSTRAP_ADMIN_PASSWORD: prior.BOOTSTRAP_ADMIN_PASSWORD || random(),
  API_IMAGE: release ? `chundian-api:${release}` : prior.API_IMAGE || 'chundian-api:20261016',
  BUILD_VERSION: release || prior.BUILD_VERSION || '0.1.0',
  ...providers,
  ESIGN_IDENTITY_ENCRYPTION_KEY: normalizedIdentityKey || randomBytes(32).toString('base64'),
  HOST: '0.0.0.0',
  PORTAL_SMS_ENABLED: prior.PORTAL_SMS_ENABLED || 'false',
  WECHAT_PAY_ENABLED: prior.WECHAT_PAY_ENABLED || 'false',
  WECHAT_PAY_VERIFICATION_ENABLED: prior.WECHAT_PAY_VERIFICATION_ENABLED || 'false',
  WECHAT_PAY_VERIFICATION_NOTIFY_URL: 'https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay-verification',
  FADADA_ENABLED: prior.FADADA_ENABLED || 'false',
  FADADA_SIGNING_ENABLED: prior.FADADA_SIGNING_ENABLED || 'false',
  FADADA_ACCOUNT_REGISTER_ENABLED: prior.FADADA_ACCOUNT_REGISTER_ENABLED || 'false',
  FADADA_REALNAME_VERIFY_ENABLED: prior.FADADA_REALNAME_VERIFY_ENABLED || 'false',
  FADADA_SIGN_NOTIFY_URL: 'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign',
  FADADA_VERIFY_NOTIFY_URL: 'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-identity',
};
mkdirSync('.runtime/production/secrets', { recursive: true });
for (const key of ['WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH', 'WECHAT_PAY_PLATFORM_CERT_PATH', 'WECHAT_PAY_PUBLIC_KEY_PATH']) {
  if (!providers[key]) continue;
  const name = basename(providers[key]);
  copyFileSync(providers[key], `.runtime/production/secrets/${name}`);
  env[key] = `/run/chundian-secrets/${name}`;
}
const backupKey = '.runtime/production/secrets/backup.key';
if (!existsSync(backupKey)) writeFileSync(backupKey, random(), { mode: 0o600 });
writeFileSync(path, Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
console.log(JSON.stringify({ config: path, secrets: '.runtime/production/secrets', credentialsReused: !!prior.POSTGRES_PASSWORD, valuesPrinted: false }));
