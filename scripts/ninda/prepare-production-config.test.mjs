import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'prepare-production-config.mjs');
function fixture(t, providers = {}) {
  const work = mkdtempSync(join(here, '.config-test-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  mkdirSync(join(work, '.runtime/ninda'), { recursive: true });
  writeFileSync(join(work, '.runtime/ninda/providers.env'), Object.entries(providers).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n'));
  return work;
}
const run = (cwd, release = '20261019-test') => spawnSync(process.execPath, [script, `--release=${release}`], { cwd, encoding: 'utf8' });
const read = work => parseEnv(readFileSync(join(work, '.runtime/ninda/production/.env.production'), 'utf8'));

test('rebuild config selects manual documents despite provider and prior online identity settings',t=>{
  const work=fixture(t,{CUSTOMER_IDENTITY_POLICY:'PROVIDER_REQUIRED',CUSTOMER_IDENTITY_ENABLED:'true'});
  assert.equal(run(work,'20261031-rebuild').status,0);
  assert.equal(read(work).CUSTOMER_IDENTITY_POLICY,'MANUAL_REVIEW');
  const target=join(work,'.runtime/ninda/production/.env.production');
  writeFileSync(target,readFileSync(target,'utf8').replace(/CUSTOMER_IDENTITY_POLICY=.*\n/,'CUSTOMER_IDENTITY_POLICY="PROVIDER_REQUIRED"\n'));
  assert.equal(run(work,'20261031-rebuild-repeat').status,0);
  assert.equal(read(work).CUSTOMER_IDENTITY_POLICY,'MANUAL_REVIEW');
});

test('MVP output fixes offline mode and retains the private staff command key without enabling new signatures', t => {
  const work=fixture(t,{ESIGN_NEW_REQUESTS_ENABLED:'true',NEW_ORDER_CONTRACT_MODE:'ESIGN',STAFF_COMMAND_DIGEST_KEY:'untrusted-provider-input'});
  const result=run(work);assert.equal(result.status,0,result.stderr);const first=read(work);
  assert.equal(first.MVP_V2_ENABLED,'true');assert.equal(first.NEW_ORDER_CONTRACT_MODE,'OFFLINE');assert.equal(first.ESIGN_NEW_REQUESTS_ENABLED,'false');
  assert.match(first.STAFF_COMMAND_DIGEST_KEY,/^[a-f0-9]{64}$/);assert.equal(first.STAFF_COMMAND_DIGEST_KEY_VERSION,'1');assert.match(first.CONTRACT_CJK_FONT_PATH,/NotoSansCJK-Regular\.ttc$/);
  assert.ok(!(result.stdout+result.stderr).includes(first.STAFF_COMMAND_DIGEST_KEY));
  assert.equal(run(work,'20261027-mvp-repeat').status,0);assert.equal(read(work).STAFF_COMMAND_DIGEST_KEY,first.STAFF_COMMAND_DIGEST_KEY);
});

test('new environment ignores old credentials and unrelated provider fields without printing secrets', t => {
  const work = fixture(t, { WECHAT_MINIPROGRAM_APP_SECRET: 'new-miniapp-secret', FADADA_APP_SECRET: 'retained-fadada-secret', DATABASE_URL: 'postgresql://old-secret@old.invalid/old', SESSION_SECRET: 'provider-session-secret', UNKNOWN_PROVIDER_TOKEN: 'unknown-secret' });
  mkdirSync(join(work, '.runtime/production'), { recursive: true });
  writeFileSync(join(work, '.runtime/production/.env.production'), 'POSTGRES_PASSWORD=old-production-password\nJWT_SECRET=old-jwt-secret\nWECHAT_PAY_ENABLED=true');
  const result = run(work); assert.equal(result.status, 0, result.stderr);
  const env = read(work);
  assert.equal(env.WECHAT_MINIPROGRAM_APP_SECRET, 'new-miniapp-secret');
  assert.equal(env.FADADA_APP_SECRET, 'retained-fadada-secret');
  assert.match(env.DATABASE_URL, /^postgresql:\/\/ninda_prod:[a-f0-9]{64}@db:5432\/ninda_prod\?connection_limit=12$/);
  assert.notEqual(env.POSTGRES_PASSWORD, 'old-production-password');
  assert.notEqual(env.SESSION_SECRET, 'provider-session-secret');
  assert.equal(env.UNKNOWN_PROVIDER_TOKEN, undefined);
  for (const secret of ['new-miniapp-secret', 'retained-fadada-secret', 'old-secret', 'old-production-password', env.POSTGRES_PASSWORD, env.JWT_SECRET]) assert.ok(!(result.stdout + result.stderr).includes(secret));
});

test('new output fixes all company identities and callback destinations', t => {
  const work = fixture(t, { FADADA_SIGN_NOTIFY_URL: 'https://old.invalid/callback', PLATFORM_API_ORIGIN: 'https://old.invalid', H5_SIGNING_ORIGIN: 'https://old.invalid' });
  assert.equal(run(work).status, 0);
  const env = read(work);
  assert.equal(env.WECHAT_MINIPROGRAM_APP_ID, 'wxb5115e5a5f70f1b1');
  assert.equal(env.WECHAT_OFFICIAL_ACCOUNT_APP_ID, 'wx556ac6833f4c4d30');
  assert.equal(env.WECHAT_PAY_MCH_ID, '1749304222');
  assert.equal(env.PLATFORM_LEGAL_ENTITY_NAME, '上海宁达信息科技有限公司');
  assert.equal(env.PLATFORM_API_ORIGIN, 'https://api.evsub.ndacar.com');
  assert.equal(env.ADMIN_ORIGIN, 'https://admin.evsub.ndacar.com');
  assert.equal(env.H5_SIGNING_ORIGIN, 'https://sign.evsub.ndacar.com');
  assert.equal(env.WECHAT_PAY_NOTIFY_URL, 'https://api.evsub.ndacar.com/api/callbacks/wechat-pay');
  assert.equal(env.WECHAT_PAY_REFUND_NOTIFY_URL, 'https://api.evsub.ndacar.com/api/callbacks/wechat-refund');
  assert.equal(env.WECHAT_PAY_VERIFICATION_NOTIFY_URL, 'https://api.evsub.ndacar.com/api/callbacks/wechat-pay-verification');
  assert.equal(env.FADADA_SIGN_NOTIFY_URL, 'https://api.evsub.ndacar.com/api/callbacks/fadada-sign');
  assert.equal(env.FADADA_VERIFY_NOTIFY_URL, 'https://api.evsub.ndacar.com/api/callbacks/fadada-identity');
  assert.equal(env.FADADA_SIGN_RETURN_URL, 'https://api.evsub.ndacar.com/api/public/esign-return');
  assert.equal(env.FADADA_VERIFY_RETURN_URL, 'https://api.evsub.ndacar.com/api/public/esign-return');
});

test('provider input cannot enable payments, identity, signing, SMS or acceptance scope', t => {
  const names = ['WECHAT_PAY_ENABLED','WECHAT_PAY_VERIFICATION_ENABLED','PORTAL_SMS_ENABLED','FADADA_ENABLED','FADADA_ACCOUNT_REGISTER_ENABLED','FADADA_REALNAME_VERIFY_ENABLED','FADADA_SIGNING_ENABLED','MINIAPP_SIGNING_ENABLED','MINIAPP_FACE_BRIDGE_ENABLED','H5_SIGNING_ENABLED','TECHNICAL_ACCEPTANCE_SIGNING_ENABLED','OWNER_ONBOARDING_ENABLED','OWNER_CONTRACTS_ENABLED','OWNER_AUTO_SIGNING_ENABLED','OWNER_WORKSPACE_ENABLED','SWAP_CREDIT_PURCHASE_ENABLED','HANDOVER_LOCATION_MAP_ENABLED'];
  const work = fixture(t, { ...Object.fromEntries(names.map(n => [n,'true'])), ORDER_ACCEPTANCE_SCOPE_JSON:'{"enabled":true}', HANDOVER_LOCATION_POLICY_JSON:'{"old":true}' });
  assert.equal(run(work).status, 0);
  const env = read(work);
  for (const name of names) assert.equal(env[name], 'false', name);
  assert.equal(env.ORDER_ACCEPTANCE_SCOPE_JSON, '');
  assert.equal(env.HANDOVER_LOCATION_POLICY_JSON, '');
});

test('invitation notification template stays separate from login SMS and provider input cannot enable reserved sending', t => {
  const work = fixture(t, {
    ALIYUN_SMS_LOGIN_TEMPLATE_CODE: 'SMS_SYNTHETIC_LOGIN', ALIYUN_SMS_TEMPLATE_CODE_VARIABLE: 'code',
    ALIYUN_SMS_OWNER_INVITATION_TEMPLATE_CODE: 'SMS_SYNTHETIC_INVITATION', ALIYUN_SMS_OWNER_INVITATION_CODE_VARIABLE: 'invitation',
    OWNER_INVITATION_SMS_ENABLED: 'true',
  });
  const result = run(work); assert.equal(result.status, 0, result.stderr);
  const env = read(work);
  assert.equal(env.ALIYUN_SMS_OWNER_INVITATION_TEMPLATE_CODE, 'SMS_SYNTHETIC_INVITATION');
  assert.equal(env.ALIYUN_SMS_OWNER_INVITATION_CODE_VARIABLE, 'invitation');
  assert.equal(env.ALIYUN_SMS_LOGIN_TEMPLATE_CODE, 'SMS_SYNTHETIC_LOGIN');
  assert.equal(env.ALIYUN_SMS_TEMPLATE_CODE_VARIABLE, 'code');
  assert.equal(env.OWNER_INVITATION_SMS_ENABLED, 'false');
  assert.equal(env.PORTAL_SMS_ENABLED, 'false');
});

test('rerun preserves independent credentials and backup key while advancing release', t => {
  const work = fixture(t, { WECHAT_MINIPROGRAM_APP_SECRET: 'mini-secret' });
  assert.equal(run(work).status, 0);
  const first = read(work), backup = readFileSync(join(work, '.runtime/ninda/production/secrets/backup.key'), 'utf8');
  assert.equal(run(work, '20261019-next').status, 0);
  const next = read(work);
  for (const key of ['POSTGRES_PASSWORD','JWT_SECRET','SESSION_SECRET','BOOTSTRAP_ADMIN_USERNAME','BOOTSTRAP_ADMIN_PASSWORD','ESIGN_IDENTITY_ENCRYPTION_KEY']) assert.equal(next[key], first[key], key);
  assert.equal(readFileSync(join(work, '.runtime/ninda/production/secrets/backup.key'), 'utf8'), backup);
  assert.equal(Buffer.from(next.ESIGN_IDENTITY_ENCRYPTION_KEY, 'base64').length, 32);
  assert.equal(next.API_IMAGE, 'ninda-api:20261019-next');
  assert.equal(next.BUILD_VERSION, '20261019-next');
});

test('mismatched supplied miniapp or merchant identity is rejected before output is written', t => {
  for (const [key,value] of [['WECHAT_MINIPROGRAM_APP_ID','wxa7089edf4a34a7f5'],['WECHAT_PAY_MCH_ID','old-merchant'],['WECHAT_OFFICIAL_ACCOUNT_APP_ID','old-account']]) {
    const work = fixture(t, { [key]: value });
    const result = run(work); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /NINDA_CONFIG_IDENTITY_MISMATCH_/);
    assert.ok(!existsSync(join(work, '.runtime/ninda/production/.env.production')));
    assert.ok(!(result.stdout + result.stderr).includes(value));
  }
});

test('payment secrets require explicit new merchant identity and are copied only into its private directory', t => {
  const work = fixture(t);
  const key = join(work, 'new-pay-private.pem'); writeFileSync(key, 'private-test-key');
  writeFileSync(join(work, '.runtime/ninda/providers.env'), `WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH=${JSON.stringify(key)}\n`);
  assert.notEqual(run(work).status, 0);
  writeFileSync(join(work, '.runtime/ninda/providers.env'), `WECHAT_PAY_MCH_ID="1749304222"\nWECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH=${JSON.stringify(key)}\n`);
  assert.equal(run(work).status, 0);
  const env = read(work);
  assert.match(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH, /^\/run\/ninda-secrets\/payment-[a-f0-9]{64}\.pem$/);
  assert.equal(readFileSync(join(work, '.runtime/ninda/production/secrets', basename(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH)), 'utf8'), 'private-test-key');
  assert.equal(env.WECHAT_PAY_ENABLED, 'false');
});

test('rotating the same source filename preserves both old and new immutable payment files for rollback', t => {
  const work = fixture(t);
  const key = join(work, 'merchant.pem');
  writeFileSync(join(work, '.runtime/ninda/providers.env'), `WECHAT_PAY_MCH_ID="1749304222"\nWECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH=${JSON.stringify(key)}\n`);
  writeFileSync(key, 'synthetic-payment-key-A');
  const initialResult = run(work, 'release-a'); assert.equal(initialResult.status, 0, initialResult.stderr);
  const initial = read(work);
  writeFileSync(key, 'synthetic-payment-key-B');
  const nextResult = run(work, 'release-b'); assert.equal(nextResult.status, 0, nextResult.stderr);
  const next = read(work);
  assert.notEqual(next.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH, initial.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH);
  const secretFile = env => join(work, '.runtime/ninda/production/secrets', basename(env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH));
  assert.equal(readFileSync(secretFile(initial), 'utf8'), 'synthetic-payment-key-A');
  assert.equal(readFileSync(secretFile(next), 'utf8'), 'synthetic-payment-key-B');
  assert.equal(run(work, 'release-b-rerun').status, 0);
  assert.equal(read(work).WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH, next.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH);
  const output = initialResult.stdout + initialResult.stderr + nextResult.stdout + nextResult.stderr;
  for (const secret of ['synthetic-payment-key-A', 'synthetic-payment-key-B', basename(initial.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH), basename(next.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH)]) assert.ok(!output.includes(secret));
});

test('an altered stored payment file is rejected without overwriting it or advancing configuration', t => {
  const work = fixture(t), key = join(work, 'merchant.pem');
  writeFileSync(key, 'synthetic-payment-key');
  writeFileSync(join(work, '.runtime/ninda/providers.env'), `WECHAT_PAY_MCH_ID="1749304222"\nWECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH=${JSON.stringify(key)}\n`);
  assert.equal(run(work, 'release-a').status, 0);
  const initial = readFileSync(join(work, '.runtime/ninda/production/.env.production'), 'utf8');
  const stored = join(work, '.runtime/ninda/production/secrets', basename(read(work).WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH));
  writeFileSync(stored, 'unexpectedly-altered-file');
  const result = run(work, 'release-b');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NINDA_CONFIG_SECRET_INTEGRITY_FAILED/);
  assert.equal(readFileSync(stored, 'utf8'), 'unexpectedly-altered-file');
  assert.equal(readFileSync(join(work, '.runtime/ninda/production/.env.production'), 'utf8'), initial);
});
