import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { normalizeSmsConfig } from '../provider-sms-config.mjs';
const { parse } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('dotenv');

test('repairs the actual dotenv-to-JSON import boundary without reading private files', () => {
  const parsed = parse('ALIYUN_SMS_ACCESS_KEY_ID=“syntheticAccessKey”\nALIYUN_SMS_ACCESS_KEY_SECRET=“syntheticSecret”\nALIYUN_SMS_SIGN_NAME=“纯电主义”\nALIYUN_SMS_LOGIN_TEMPLATE_CODE=“SMS_508385053”\n');
  assert.equal(parsed.ALIYUN_SMS_ACCESS_KEY_ID, '“syntheticAccessKey”');
  const normalized = normalizeSmsConfig(parsed);
  const serialized = Object.entries(normalized).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
  assert.deepEqual(parse(serialized), {
    ALIYUN_SMS_ACCESS_KEY_ID: 'syntheticAccessKey', ALIYUN_SMS_ACCESS_KEY_SECRET: 'syntheticSecret',
    ALIYUN_SMS_SIGN_NAME: '纯电主义', ALIYUN_SMS_LOGIN_TEMPLATE_CODE: 'SMS_508385053',
  });
});

test('removes paired Chinese quote wrappers from all four production SMS fields', () => {
  assert.deepEqual(normalizeSmsConfig({
    ALIYUN_SMS_ACCESS_KEY_ID: '  “syntheticAccessKey”  ',
    ALIYUN_SMS_ACCESS_KEY_SECRET: '“syntheticSecret”',
    ALIYUN_SMS_SIGN_NAME: '“纯电主义”',
    ALIYUN_SMS_LOGIN_TEMPLATE_CODE: '“SMS_508385053”',
  }), {
    ALIYUN_SMS_ACCESS_KEY_ID: 'syntheticAccessKey',
    ALIYUN_SMS_ACCESS_KEY_SECRET: 'syntheticSecret',
    ALIYUN_SMS_SIGN_NAME: '纯电主义',
    ALIYUN_SMS_LOGIN_TEMPLATE_CODE: 'SMS_508385053',
  });
});

test('removes paired Chinese single quotes and surrounding whitespace', () => {
  assert.deepEqual(normalizeSmsConfig({ ALIYUN_SMS_TEMPLATE_CODE_VARIABLE: '  ‘code_2’ \t' }), {
    ALIYUN_SMS_TEMPLATE_CODE_VARIABLE: 'code_2',
  });
});

test('preserves legitimate Chinese sign names and their internal characters', () => {
  const sign = '晓浪 科技（纯电“主义”平台）';
  assert.equal(normalizeSmsConfig({ ALIYUN_SMS_SIGN_NAME: sign }).ALIYUN_SMS_SIGN_NAME, sign);
});

test('does not impose a fixed access-key length or rewrite ASCII punctuation', () => {
  assert.deepEqual(normalizeSmsConfig({ ALIYUN_SMS_ACCESS_KEY_ID: 'A', ALIYUN_SMS_ACCESS_KEY_SECRET: 'a+/=_-!9' }), {
    ALIYUN_SMS_ACCESS_KEY_ID: 'A', ALIYUN_SMS_ACCESS_KEY_SECRET: 'a+/=_-!9',
  });
});

test('rejects unmatched or mismatched outer quotes instead of partially repairing them', () => {
  for (const value of ['“private-marker', 'private-marker”', '“private-marker’', '‘private-marker”', '"private-marker"']) {
    assert.throws(() => normalizeSmsConfig({ ALIYUN_SMS_SIGN_NAME: value }), /^Error: Invalid SMS configuration: ALIYUN_SMS_SIGN_NAME$/);
  }
});

test('rejects non-ASCII, whitespace, and quotes in access credentials', () => {
  for (const field of ['ALIYUN_SMS_ACCESS_KEY_ID', 'ALIYUN_SMS_ACCESS_KEY_SECRET']) {
    for (const value of ['synthetic 秘密', 'synthetic secret', 'synthetic\nsecret', 'synthetic"secret', "synthetic'secret", 'synthetic“secret', 'synthetic\x7fsecret']) {
      assert.throws(() => normalizeSmsConfig({ [field]: value }), { message: `Invalid SMS configuration: ${field}` });
    }
  }
});

test('requires SMS followed by underscore and digits for template codes', () => {
  for (const value of ['SMS_test', 'sms_508385053', 'SMS_', 'SMS_123 456', 'SMS_１２３']) {
    assert.throws(() => normalizeSmsConfig({ ALIYUN_SMS_LOGIN_TEMPLATE_CODE: value }), { message: 'Invalid SMS configuration: ALIYUN_SMS_LOGIN_TEMPLATE_CODE' });
  }
});

test('requires an identifier for a supplied template variable', () => {
  for (const value of ['2code', 'code-name', 'code name', '${code}', '验证码']) {
    assert.throws(() => normalizeSmsConfig({ ALIYUN_SMS_TEMPLATE_CODE_VARIABLE: value }), { message: 'Invalid SMS configuration: ALIYUN_SMS_TEMPLATE_CODE_VARIABLE' });
  }
});

test('rejects supplied empty values and sign-name control characters', () => {
  for (const value of ['', '  ', '“”', '‘ ’', '品牌\n名称']) {
    assert.throws(() => normalizeSmsConfig({ ALIYUN_SMS_SIGN_NAME: value }), { message: 'Invalid SMS configuration: ALIYUN_SMS_SIGN_NAME' });
  }
});

test('error messages and stacks contain the field name but never the invalid value', () => {
  const secret = 'synthetic-private-marker with spaces';
  let error;
  try { normalizeSmsConfig({ ALIYUN_SMS_ACCESS_KEY_SECRET: secret }); } catch (caught) { error = caught; }
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'Invalid SMS configuration: ALIYUN_SMS_ACCESS_KEY_SECRET');
  assert.equal(error.stack.includes(secret), false);
  assert.equal(Object.hasOwn(error, 'cause'), false);
});

test('does not mutate input or copy unrelated provider credentials', () => {
  const input = Object.freeze({ ALIYUN_SMS_SIGN_NAME: '“纯电主义”', FADADA_APP_SECRET: 'unrelated-private-marker' });
  assert.deepEqual(normalizeSmsConfig(input), { ALIYUN_SMS_SIGN_NAME: '纯电主义' });
  assert.equal(input.ALIYUN_SMS_SIGN_NAME, '“纯电主义”');
  assert.deepEqual(normalizeSmsConfig({}), {});
});
