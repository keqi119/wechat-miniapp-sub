import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const generator = join(repo, 'scripts/prepare-production-config.mjs');
const apiModules = join(repo, 'apps/api/node_modules');
const require = createRequire(join(repo, 'apps/api/package.json'));
const { parse } = require('dotenv');
const tempParent = join(repo, '.runtime');
const tempPrefix = 'config-guard-test-';
const serialize = values => Object.entries(values)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';

// The real generator runs with a fresh cwd. All input, output, and cleanup paths
// stay within this test's mkdtemp directory; no real provider/production env is read.
function fixture(t) {
  mkdirSync(tempParent, { recursive: true });
  const cwd = mkdtempSync(join(tempParent, tempPrefix));
  t.after(() => {
    assert.equal(dirname(cwd), tempParent, 'cleanup must stay under the test temp parent');
    assert.ok(basename(cwd).startsWith(tempPrefix), 'cleanup must target this test directory');
    rmSync(cwd, { recursive: true, force: true });
  });
  const output = join(cwd, '.runtime/production/.env.production');
  const secrets = join(cwd, '.runtime/production/secrets');
  return {
    cwd,
    run(providers = {}, prior) {
      writeFileSync(join(cwd, '.env.providers.local'), serialize(providers));
      const before = prior === undefined ? null : serialize(prior);
      if (before !== null) {
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, before);
      }
      const result = spawnSync(process.execPath, [generator, '--release=test-isolated'], {
        cwd,
        encoding: 'utf8',
        timeout: 15_000,
        // Resolve the installed parser without copying dependencies into the fixture.
        env: { ...process.env, NODE_PATH: apiModules, NODE_OPTIONS: '' },
      });
      assert.ifError(result.error);
      return {
        result, before, output, secrets,
        env: existsSync(output) ? parse(readFileSync(output)) : null,
      };
    },
  };
}

function assertRejectedWithoutWrites(run, variable) {
  assert.notEqual(run.result.status, 0, 'unsupported input must fail');
  assert.match(run.result.stderr, new RegExp(variable), 'error must identify the invalid input');
  assert.equal(existsSync(run.secrets), false, 'must not create secrets before validation');
  if (run.before === null) assert.equal(existsSync(run.output), false, 'must not generate config');
  else assert.equal(readFileSync(run.output, 'utf8'), run.before, 'must preserve prior config exactly');
}

function assertSucceeded(run) {
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.ok(run.env, 'must generate config');
  return run.env;
}

test('rejects multiple certificate paths before writing new production output', t => {
  const run = fixture(t).run({ WECHAT_PAY_PLATFORM_CERT_PATHS: 'first.pem;second.pem' });
  assertRejectedWithoutWrites(run, 'WECHAT_PAY_PLATFORM_CERT_PATHS');
});

test('rejects a nonempty certificate list without changing prior production output', t => {
  const run = fixture(t).run({ WECHAT_PAY_PLATFORM_CERT_PATHS: 'first.pem' }, { BUILD_VERSION: 'preserve' });
  assertRejectedWithoutWrites(run, 'WECHAT_PAY_PLATFORM_CERT_PATHS');
});

test('does not emit the obsolete auto-sign switch supplied by a provider', t => {
  const env = assertSucceeded(fixture(t).run({ FADADA_AUTO_SIGN_ENABLED: 'true' }));
  assert.equal(Object.hasOwn(env, 'FADADA_AUTO_SIGN_ENABLED'), false);
});

test('preserves the existing identity key despite an empty provider value', t => {
  const key = Buffer.alloc(32, 3).toString('base64');
  const env = assertSucceeded(fixture(t).run(
    { ESIGN_IDENTITY_ENCRYPTION_KEY: '' }, { ESIGN_IDENTITY_ENCRYPTION_KEY: key },
  ));
  assert.equal(env.ESIGN_IDENTITY_ENCRYPTION_KEY, key);
});

test('normalizes the prior hex identity key instead of taking a provider replacement', t => {
  const env = assertSucceeded(fixture(t).run(
    { ESIGN_IDENTITY_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') },
    { ESIGN_IDENTITY_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('hex') },
  ));
  assert.equal(env.ESIGN_IDENTITY_ENCRYPTION_KEY, Buffer.alloc(32, 4).toString('base64'));
});

test('generates an independent identity key, fixes the host, and omits an empty font', t => {
  const env = assertSucceeded(fixture(t).run({
    ESIGN_IDENTITY_ENCRYPTION_KEY: '', HOST: '127.0.0.1', FADADA_CJK_FONT_PATH: '',
  }));
  assert.equal(Buffer.from(env.ESIGN_IDENTITY_ENCRYPTION_KEY, 'base64').length, 32);
  assert.equal(env.HOST, '0.0.0.0');
  assert.equal(Object.hasOwn(env, 'FADADA_CJK_FONT_PATH'), false);
});

for (const font of ['C:/Fonts/font.ttc', 'C:\\Fonts\\font.ttc', 'relative/font.ttc', '/usr\\fonts/font.ttc']) {
  test(`rejects non-container font path ${font} before writing`, t => {
    assertRejectedWithoutWrites(fixture(t).run({ FADADA_CJK_FONT_PATH: font }), 'FADADA_CJK_FONT_PATH');
  });
}

test('accepts an absolute container font and a whitespace-only certificate list', t => {
  const env = assertSucceeded(fixture(t).run({
    FADADA_CJK_FONT_PATH: '/usr/share/fonts/test.ttc',
    WECHAT_PAY_PLATFORM_CERT_PATHS: '  ', FADADA_AUTO_SIGN_ENABLED: 'false',
  }));
  assert.equal(env.FADADA_CJK_FONT_PATH, '/usr/share/fonts/test.ttc');
  assert.equal(Object.hasOwn(env, 'FADADA_AUTO_SIGN_ENABLED'), false);
});

test('copies a single PEM collection and retains previously enabled business switches', t => {
  const isolated = fixture(t);
  const pem = join(isolated.cwd, 'collection.pem');
  writeFileSync(pem, 'SYNTHETIC PEM COLLECTION');
  const run = isolated.run({ WECHAT_PAY_PLATFORM_CERT_PATH: pem }, {
    FADADA_SIGNING_ENABLED: 'true', WECHAT_PAY_ENABLED: 'true',
  });
  const env = assertSucceeded(run);
  assert.equal(env.WECHAT_PAY_PLATFORM_CERT_PATH, '/run/chundian-secrets/collection.pem');
  assert.equal(readFileSync(join(run.secrets, 'collection.pem'), 'utf8'), 'SYNTHETIC PEM COLLECTION');
  assert.equal(env.FADADA_SIGNING_ENABLED, 'true');
  assert.equal(env.WECHAT_PAY_ENABLED, 'true');
});

test('payment verification remains disabled by default despite provider input', t => {
  const env = assertSucceeded(fixture(t).run({
    WECHAT_PAY_VERIFICATION_ENABLED: 'true',
    WECHAT_PAY_VERIFICATION_NOTIFY_URL: 'https://wrong.example/callback',
  }));
  assert.equal(env.WECHAT_PAY_VERIFICATION_ENABLED, 'false');
  assert.equal(env.WECHAT_PAY_VERIFICATION_NOTIFY_URL, 'https://mini-api.subauto.keybox.cloud/api/callbacks/wechat-pay-verification');
  assert.equal(env.WECHAT_PAY_ENABLED, 'false');
});

test('preserves explicitly enabled verification without enabling ordinary payments', t => {
  const env = assertSucceeded(fixture(t).run({}, {
    WECHAT_PAY_VERIFICATION_ENABLED: 'true', WECHAT_PAY_ENABLED: 'false',
  }));
  assert.equal(env.WECHAT_PAY_VERIFICATION_ENABLED, 'true');
  assert.equal(env.WECHAT_PAY_ENABLED, 'false');
});
