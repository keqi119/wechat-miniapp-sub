import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { normalizeSmsConfig } from './provider-sms-config.mjs';
const require = createRequire(resolve('apps/api/package.json'));
const { parse } = require('dotenv');
const source = 'D:/Projects/auto-subscription-platform';
const common = parse(readFileSync(`${source}/.env`));
const sms = normalizeSmsConfig(common);
const fadada = parse(readFileSync(`${source}/.env.fadada.production.local`));
const bytes = readFileSync('D:/工作资料/晓浪科技/纯电主义-微信小程序-key.txt');
const text = bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8');
const appId = JSON.parse(readFileSync('reference/miniprogram-mock/project.config.json', 'utf8')).appid;
if (!text.includes(appId)) throw new Error('Miniapp credential AppID mismatch');
const secrets = [...new Set(text.match(/\b[a-fA-F0-9]{32}\b/g) || [])];
if (secrets.length !== 1) throw new Error('Miniapp secret is ambiguous');
const result = { WECHAT_MINIPROGRAM_APP_ID: appId, WECHAT_MINIPROGRAM_APP_SECRET: secrets[0], PORTAL_SMS_ENABLED: 'false', WECHAT_PAY_ENABLED: 'false', FADADA_ENABLED: 'false', ESIGN_PROVIDER: 'fadada', FADADA_AUTO_SIGN_ENABLED: 'false' };
Object.assign(result, sms);
for (const key of ['FADADA_ENV', 'FADADA_BASE_URL', 'FADADA_API_VERSION', 'FADADA_REQUEST_TIMEOUT_MS', 'FADADA_APP_ID', 'FADADA_APP_SECRET', 'FADADA_PLATFORM_CUSTOMER_ID', 'FADADA_PLATFORM_SIGNATURE_ID', 'FADADA_AUTH_PERSON_CUSTOMER_ID', 'FADADA_PERSON_VERIFY_WAY', 'FADADA_VERIFY_PAGE_MODIFY', 'FADADA_VERIFY_OPTION', 'FADADA_SIGN_URL_VALIDITY_MINUTES', 'FADADA_SIGN_URL_QUANTITY']) if (fadada[key]) result[key] = fadada[key];
if (process.argv.includes('--server-payment')) {
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-i', 'C:/Users/keqi_119/.ssh/subauto_staging_codex', 'root@139.196.227.195'];
  const remoteRead = path => execFileSync('ssh', [...args, `cat -- '${path.replace(/'/g, "'\\''")}'`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  const remote = parse(remoteRead('/opt/subscription-saas/.env.production.images'));
  for (const key of ['WECHAT_PAY_MCH_ID', 'WECHAT_PAY_MERCHANT_SERIAL_NO', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_PUBLIC_KEY_ID']) if (remote[key]) result[key] = remote[key];
  mkdirSync('.runtime/provider-secrets', { recursive: true });
  for (const key of ['WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH', 'WECHAT_PAY_PLATFORM_CERT_PATH', 'WECHAT_PAY_PUBLIC_KEY_PATH']) {
    if (!remote[key]) continue;
    if (!remote[key].startsWith('/') || /[\r\n\0]/.test(remote[key])) throw new Error('Unexpected credential path');
    const target = resolve(`.runtime/provider-secrets/${key.toLowerCase()}.pem`);
    const content = remoteRead(remote[key]);
    if (!content.toString().includes('-----BEGIN ')) throw new Error('Unexpected PEM format');
    writeFileSync(target, content, { mode: 0o600 }); result[key] = target.replaceAll('\\', '/');
  }
  result.WECHAT_PAY_NOTIFY_URL = 'https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay';
  result.WECHAT_PAY_REFUND_NOTIFY_URL = 'https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-refund';
}
writeFileSync('.env.providers.local', Object.entries(result).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify({ output: '.env.providers.local (gitignored)', fields: Object.keys(result).length, miniappMatched: true, providerEffectsEnabled: false, personalTestDataCopied: false }) + '\n');
