import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';

// This generator deliberately has no legacy input path or arbitrary object spread.
const output = resolve('.runtime/ninda/production');
const input = resolve('.runtime/ninda/providers.env');
const config = `${output}/.env.production`;
const identities = {
  WECHAT_MINIPROGRAM_APP_ID: 'wxb5115e5a5f70f1b1',
  WECHAT_OFFICIAL_ACCOUNT_APP_ID: 'wx556ac6833f4c4d30',
  WECHAT_PAY_MCH_ID: '1749304222',
};
const providerKeys = [
  'WECHAT_MINIPROGRAM_APP_SECRET', 'WECHAT_OFFICIAL_ACCOUNT_APP_SECRET',
  'ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME',
  'ALIYUN_SMS_LOGIN_TEMPLATE_CODE', 'ALIYUN_SMS_TEMPLATE_CODE_VARIABLE',
  'ALIYUN_SMS_OWNER_INVITATION_TEMPLATE_CODE', 'ALIYUN_SMS_OWNER_INVITATION_CODE_VARIABLE',
  'WECHAT_PAY_MERCHANT_SERIAL_NO', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_PUBLIC_KEY_ID',
  'FADADA_ENV', 'FADADA_BASE_URL', 'FADADA_API_VERSION', 'FADADA_APP_ID', 'FADADA_APP_SECRET',
  'FADADA_PLATFORM_CUSTOMER_ID', 'FADADA_PLATFORM_SIGNATURE_ID', 'FADADA_REQUEST_TIMEOUT_MS',
  'FADADA_SIGN_URL_QUANTITY', 'FADADA_SIGN_URL_VALIDITY_MINUTES',
];
const paymentFiles = ['WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH', 'WECHAT_PAY_PLATFORM_CERT_PATH', 'WECHAT_PAY_PUBLIC_KEY_PATH'];
const switches = [
  'PORTAL_SMS_ENABLED', 'OWNER_INVITATION_SMS_ENABLED', 'WECHAT_PAY_ENABLED', 'WECHAT_PAY_VERIFICATION_ENABLED',
  'FADADA_ENABLED', 'FADADA_ACCOUNT_REGISTER_ENABLED', 'FADADA_REALNAME_VERIFY_ENABLED', 'FADADA_SIGNING_ENABLED',
  'MINIAPP_SIGNING_ENABLED', 'MINIAPP_FACE_BRIDGE_ENABLED', 'H5_SIGNING_ENABLED',
  'TECHNICAL_ACCEPTANCE_SIGNING_ENABLED', 'OWNER_ONBOARDING_ENABLED', 'OWNER_CONTRACTS_ENABLED',
  'OWNER_AUTO_SIGNING_ENABLED', 'OWNER_WORKSPACE_ENABLED', 'SWAP_CREDIT_PURCHASE_ENABLED', 'HANDOVER_LOCATION_MAP_ENABLED',
  'OWNER_LEGAL_H5_ENABLED', 'OWNER_LEGAL_H5_ONLY',
];
function stop(code) { const error = new Error(code); error.safeCode = code; throw error; }
function readEnv(path) {
  const text = readFileSync(path, 'utf8');
  const values = parseEnv(text);
  // Accept JSON-quoted one-line values, including Windows paths, without expanding variables.
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(".*")\s*$/);
    if (match) { try { values[match[1]] = JSON.parse(match[2]); } catch { stop('NINDA_CONFIG_INVALID_QUOTING'); } }
  }
  return values;
}
function main() {
  const release = process.argv.find(arg => arg.startsWith('--release='))?.slice(10);
  if (!release || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(release)) stop('NINDA_CONFIG_RELEASE_REQUIRED');
  const providers = readEnv(input);
  const prior = existsSync(config) ? readEnv(config) : {};
  for (const [name, expected] of Object.entries(identities)) {
    if ((providers[name] && providers[name] !== expected) || (prior[name] && prior[name] !== expected)) stop(`NINDA_CONFIG_IDENTITY_MISMATCH_${name}`);
  }
  if (providers.WECHAT_PAY_PLATFORM_CERT_PATHS?.trim()) stop('NINDA_CONFIG_SINGLE_PAYMENT_CERT_FILE_REQUIRED');
  if ([...paymentFiles, 'WECHAT_PAY_MERCHANT_SERIAL_NO', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_PUBLIC_KEY_ID'].some(key => providers[key]) && providers.WECHAT_PAY_MCH_ID !== identities.WECHAT_PAY_MCH_ID) stop('NINDA_CONFIG_EXPLICIT_NEW_MERCHANT_REQUIRED');
  if (prior.POSTGRES_DB && prior.POSTGRES_DB !== 'ninda_prod') stop('NINDA_CONFIG_DATABASE_IDENTITY_MISMATCH');
  const random = () => randomBytes(32).toString('hex');
  const password = prior.POSTGRES_PASSWORD || random();
  if (!/^[a-f0-9]{64}$/.test(password)) stop('NINDA_CONFIG_DATABASE_PASSWORD_INVALID');
  const identityKey = prior.ESIGN_IDENTITY_ENCRYPTION_KEY || randomBytes(32).toString('base64');
  if (Buffer.from(identityKey, 'base64').length !== 32) stop('NINDA_CONFIG_IDENTITY_KEY_INVALID');
  const staffDigestKey=prior.STAFF_COMMAND_DIGEST_KEY||random();
  if(Buffer.byteLength(staffDigestKey)<32)stop('NINDA_CONFIG_STAFF_KEY_INVALID');
  if(prior.STAFF_COMMAND_DIGEST_KEYS_JSON){try{const keys=JSON.parse(prior.STAFF_COMMAND_DIGEST_KEYS_JSON);if(!keys||typeof keys!=='object'||Array.isArray(keys)||Object.values(keys).some(v=>typeof v!=='string'||Buffer.byteLength(v)<32))stop('NINDA_CONFIG_STAFF_KEY_INVALID');}catch{stop('NINDA_CONFIG_STAFF_KEY_INVALID');}}
  const api = 'https://api.evsub.ndacar.com';
  const env = {
    NODE_ENV: 'production', APP_ENV: 'production', HOST: '0.0.0.0', PORT: '3101',
    PLATFORM_LEGAL_ENTITY_NAME: '上海宁达信息科技有限公司',
    MVP_V2_ENABLED:'true', NEW_ORDER_CONTRACT_MODE:'OFFLINE', ESIGN_NEW_REQUESTS_ENABLED:'false',
    CUSTOMER_IDENTITY_POLICY:'MANUAL_REVIEW',
    STAFF_COMMAND_DIGEST_KEY:staffDigestKey, STAFF_COMMAND_DIGEST_KEY_VERSION:prior.STAFF_COMMAND_DIGEST_KEY_VERSION||'1',
    STAFF_COMMAND_DIGEST_KEYS_JSON:prior.STAFF_COMMAND_DIGEST_KEYS_JSON||'',
    BUILD_VERSION: release, API_IMAGE: `ninda-api:${release}`,
    PLATFORM_API_ORIGIN: api, ADMIN_ORIGIN: 'https://admin.evsub.ndacar.com', H5_SIGNING_ORIGIN: 'https://sign.evsub.ndacar.com',
    POSTGRES_USER: 'ninda_prod', POSTGRES_DB: 'ninda_prod', POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://ninda_prod:${password}@db:5432/ninda_prod?connection_limit=12`,
    JWT_SECRET: prior.JWT_SECRET || random(), SESSION_SECRET: prior.SESSION_SECRET || random(),
    BOOTSTRAP_ADMIN_USERNAME: prior.BOOTSTRAP_ADMIN_USERNAME || 'admin',
    BOOTSTRAP_ADMIN_PASSWORD: prior.BOOTSTRAP_ADMIN_PASSWORD || random(),
    ESIGN_IDENTITY_ENCRYPTION_KEY: identityKey,
    UPLOAD_DIR: '/app/uploads', FADADA_CJK_FONT_PATH: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    CONTRACT_CJK_FONT_PATH:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    ...identities,
    WECHAT_PAY_NOTIFY_URL: `${api}/api/callbacks/wechat-pay`,
    WECHAT_PAY_REFUND_NOTIFY_URL: `${api}/api/callbacks/wechat-refund`,
    WECHAT_PAY_VERIFICATION_NOTIFY_URL: `${api}/api/callbacks/wechat-pay-verification`,
    FADADA_SIGN_NOTIFY_URL: `${api}/api/callbacks/fadada-sign`,
    FADADA_VERIFY_NOTIFY_URL: `${api}/api/callbacks/fadada-identity`,
    FADADA_SIGN_RETURN_URL: `${api}/api/public/esign-return`,
    FADADA_VERIFY_RETURN_URL: `${api}/api/public/esign-return`,
    MINIAPP_SIGNING_PROVIDER_HOSTS: prior.MINIAPP_SIGNING_PROVIDER_HOSTS || '',
    H5_SIGNING_PROVIDER_HOSTS: prior.H5_SIGNING_PROVIDER_HOSTS || 'textapi.fadada.com,realnameverify.fadada.com',
    ORDER_ACCEPTANCE_SCOPE_JSON: prior.ORDER_ACCEPTANCE_SCOPE_JSON || '',
    HANDOVER_LOCATION_POLICY_JSON: prior.HANDOVER_LOCATION_POLICY_JSON || '',
  };
  for (const key of providerKeys) env[key] = providers[key] ?? '';
  for (const key of switches) {
    if (prior[key] && !['true','false'].includes(prior[key])) stop('NINDA_CONFIG_INVALID_FEATURE_SWITCH');
    env[key] = prior[key] || 'false';
  }
  const files = paymentFiles.filter(key => providers[key]).map(key => {
    const source = resolve(providers[key]);
    if (!existsSync(source)) stop('NINDA_CONFIG_PAYMENT_FILE_MISSING');
    const bytes = readFileSync(source);
    const name = `payment-${createHash('sha256').update(bytes).digest('hex')}.pem`;
    const target = `${output}/secrets/${name}`;
    if (existsSync(target) && !readFileSync(target).equals(bytes)) stop('NINDA_CONFIG_SECRET_INTEGRITY_FAILED');
    return { key, bytes, name, target };
  });
  // Validate everything before writing. Secret contents and values never reach stdout/stderr.
  mkdirSync(`${output}/secrets`, { recursive: true, mode: 0o700 });
  for (const file of files) {
    // A changed input always gets another filename. Never overwrite rollback material.
    try { writeFileSync(file.target, file.bytes, { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!readFileSync(file.target).equals(file.bytes)) stop('NINDA_CONFIG_SECRET_INTEGRITY_FAILED');
    }
    env[file.key] = `/run/ninda-secrets/${file.name}`;
  }
  const backup = `${output}/secrets/backup.key`;
  if (!existsSync(backup)) writeFileSync(backup, random(), { mode: 0o600, flag: 'wx' });
  const temporary = `${config}.tmp`;
  writeFileSync(temporary, Object.entries(env).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600); renameSync(temporary, config);
  console.log(JSON.stringify({ config: '.runtime/ninda/production/.env.production', secrets: '.runtime/ninda/production/secrets', credentialsReused: !!prior.POSTGRES_PASSWORD, valuesPrinted: false }));
}
try { main(); } catch (error) { console.error(error.safeCode || 'NINDA_CONFIG_IO_ERROR'); process.exitCode = 1; }
