const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = () => require('../src/services/native-signing-policy');
const config = { mode: 'MINIAPP_WEBVIEW', enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com', 'realnameverify16.fadada.com'], returnUrl: 'https://mini-api.subauto.keybox.cloud/api/public/esign-return' };
const bridge = () => ({ flowId: 'synthetic-flow', expiresAt: new Date(Date.now() + 300000).toISOString(), appId: 'wx0123456789abcdef', path: 'pages/face/index', callbackUrl: 'https://realnameverify16.fadada.com/current?opaque=synthetic' });
const args = b => Object.fromEntries(Object.entries({ bizToken: 'synthetic-biz-token', miniProgramAppId: b.appId, miniProgramPath: b.path, miniProgramCallBackUrl: b.callbackUrl }).map(([key, value]) => [key, encodeURIComponent(value)]));
test('native config accepts only explicit enabled mode, approved provider hosts and fixed return with no implicit H5 fallback', () => {
  assert.equal(policy().signingConfig(config).enabled, true);
  assert.equal(policy().signingConfig({ ...config, enabled: false }).enabled, false);
  for (const raw of [{ ...config, mode: 'SERVICE_ACCOUNT_H5' }, { ...config, enabled: 'true' }, { ...config, providerHosts: ['evil.test'] }, { ...config, returnUrl: config.returnUrl + '?status=SIGNED' }]) assert.throws(() => policy().signingConfig(raw));
});
test('provider URLs preserve opaque query but reject old hosts, host confusion, credentials, explicit ports, whitespace and fragments', () => {
  const url = 'https://textapi17.fadada.com/api2/sign?opaque=a%2Bb%2F%3D'; assert.equal(policy().providerUrl(url, config), url);
  for (const bad of ['https://textapi.fadada.com/api2/sign', 'https://textapi17.fadada.com.evil.test/sign', 'https://user@textapi17.fadada.com/sign', 'https://textapi17.fadada.com:443/sign', 'https://textapi17.fadada.com:8443/sign', 'http://textapi17.fadada.com/sign', 'https://textapi17.fadada.com/sign#status=SIGNED', 'https://textapi17.fadada.com\\@evil.test/sign', 'https://textapi17.fadada.com/sign\n']) assert.throws(() => policy().providerUrl(bad, config));
});
test('bridge uses exact server-authorized flow appId, path, callback and TTL, never untrusted four-parameter authority', () => {
  const b = bridge(), parsed = policy().bridgeArguments(args(b), b, config); assert.equal(parsed.appId, b.appId); assert.equal(parsed.path, b.path + '?bizToken=synthetic-biz-token'); assert.equal(parsed.callbackUrl, b.callbackUrl); assert.equal(parsed.status, undefined);
  for (const options of [{ ...args(b), miniProgramAppId: 'wx1111111111111111' }, { ...args(b), miniProgramPath: encodeURIComponent('pages/other/index') }, { ...args(b), miniProgramCallBackUrl: encodeURIComponent('https://realnameverify16.fadada.com/other') }, { ...args(b), bizToken: '%E0%A4%A' }]) assert.throws(() => policy().bridgeArguments(options, b, config));
  assert.throws(() => policy().bridgeArguments(args(b), null, config)); assert.throws(() => policy().bridgeArguments(args(b), { ...b, expiresAt: '2020-01-01T00:00:00Z' }, config));
});
test('face return requires initiated current flow, scene1038 and expected referrer; faceResult can never mark verified or signed', () => {
  const b = bridge(), entry = { scene: 1038, referrerInfo: { appId: b.appId, extraData: { faceResult: 'SIGNED' } } };
  assert.deepEqual(policy().faceReturn(entry, b, true, config), { reloadUrl: b.callbackUrl, flowId: b.flowId });
  assert.throws(() => policy().faceReturn(entry, b, false, config)); assert.throws(() => policy().faceReturn({ ...entry, scene: 1001 }, b, true, config)); assert.throws(() => policy().faceReturn({ scene: 1038 }, b, true, config)); assert.throws(() => policy().faceReturn({ ...entry, referrerInfo: { appId: 'wx1111111111111111' } }, b, true, config));
});
