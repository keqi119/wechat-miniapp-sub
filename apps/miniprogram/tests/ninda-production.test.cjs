const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { build } = require('../scripts/build.cjs');
const { createApi } = require('../src/services/api');
const { signingConfig, providerUrl } = require('../src/services/native-signing-policy');
const ARTIFACTS = path.resolve(__dirname, '../.artifacts');
const sha = value => createHash('sha256').update(value).digest('hex');

function fixture(t, name) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const root = fs.mkdtempSync(path.join(ARTIFACTS, name));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(ARTIFACTS) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

test('Ninda production package sends public catalogue requests to its own API with the new AppID', async t => {
  const output = fixture(t, 'ninda-package-');
  build({ destination: output });
  const config = require(path.join(output, 'src/config.js'));
  const project = JSON.parse(fs.readFileSync(path.join(output, 'project.config.json')));
  let requestUrl;
  const api = createApi(config, request => {
    requestUrl = request.url;
    request.success({ statusCode: 200, data: { items: [], total: 0, page: 1, pageSize: 50 } });
  }, { getStorageSync: () => null });
  await api.getVehicles();
  assert.equal(requestUrl, 'https://api.evsub.ndacar.com/api/public/vehicles');
  assert.equal(project.appid, 'wxb5115e5a5f70f1b1');
  assert.equal(project.setting.urlCheck, true);
  assert.equal(fs.existsSync(path.join(output, 'src/pages/owner/index.wxml')), false);
  const settings = fs.readFileSync(path.join(output, 'src/pages/profile/index.wxml'), 'utf8');
  assert.ok(settings.includes('实名认证'));
  assert.ok(settings.includes('identityStatusText'));
  assert.ok(settings.includes('bindtap="verifyIdentity"'));assert.ok(settings.includes('identityAccepted'));
  assert.ok(!settings.includes('企业车主'));
});

test('production build rejects a source still targeting the previous company API', t => {
  const root = fixture(t, 'ninda-old-api-');
  const source = path.join(root, 'source');
  fs.cpSync(path.resolve(__dirname, '../src'), source, { recursive: true });
  fs.writeFileSync(path.join(source, 'config.js'), "module.exports={mode:'api',apiBase:'https://mini-api.subauto.keybox.cloud'};\n");
  assert.throws(() => build({ source, destination: path.join(root, 'output') }), /approved independent HTTPS API/);
});

test('production build rejects the superseded Ninda API outside the subscription subdomain', t => {
  const root = fixture(t, 'ninda-superseded-api-');
  const source = path.join(root, 'source');
  fs.cpSync(path.resolve(__dirname, '../src'), source, { recursive: true });
  fs.writeFileSync(path.join(source, 'config.js'), "module.exports={mode:'api',apiBase:'https://api.ndacar.com'};\n");
  assert.throws(() => build({ source, destination: path.join(root, 'output') }), /approved independent HTTPS API/);
});

test('native signing accepts the Ninda return and refuses the old company return while retaining Fadada host checks', () => {
  const config = { mode: 'MINIAPP_WEBVIEW', newOrderContractMode: 'ESIGN', newEsignRequestsEnabled: true, enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com', 'realnameverify16.fadada.com'], returnUrl: 'https://api.evsub.ndacar.com/api/public/esign-return' };
  const approved = signingConfig(config);
  assert.equal(providerUrl(config.returnUrl, approved, true), config.returnUrl);
  assert.equal(providerUrl('https://textapi17.fadada.com/api2/sign?opaque=a%2Bb', approved), 'https://textapi17.fadada.com/api2/sign?opaque=a%2Bb');
  for (const returnUrl of ['https://mini-api.subauto.keybox.cloud/api/public/esign-return', 'https://api.ndacar.com/api/public/esign-return']) assert.throws(() => signingConfig({ ...config, returnUrl }), { code: 'SIGN_CONFIG' });
  assert.throws(() => providerUrl('https://textapi.fadada.com/api2/sign', approved), { code: 'SIGN_URL' });
});

test('upload package verifier accepts the Ninda AppID and rejects an otherwise intact old-AppID package', async t => {
  const workspace = fixture(t, 'ninda-verifier-');
  const project = path.join(workspace, 'apps/miniprogram/.artifacts/production');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/app.js'), 'App({});');
  fs.writeFileSync(path.join(project, 'FILE-MANIFEST.json'), JSON.stringify({ files: [{ path: 'src/app.js', sha256: sha('App({});') }] }));
  const config = { appid: 'wxb5115e5a5f70f1b1', compileType: 'miniprogram', miniprogramRoot: 'src/', setting: { urlCheck: true } };
  fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify(config));
  const { verifyMiniappPackage } = await import(pathToFileURL((fs.existsSync(path.resolve(__dirname, '../../../scripts/verify-miniapp-package.mjs')) ? path.resolve(__dirname, '../../../scripts/verify-miniapp-package.mjs') : path.resolve(__dirname, '../../workspace/scripts/verify-miniapp-package.mjs'))).href);
  assert.equal(verifyMiniappPackage({ workspace }).files, 1);
  fs.writeFileSync(path.join(project, 'project.config.json'), JSON.stringify({ ...config, appid: 'wxa7089edf4a34a7f5' }));
  assert.throws(() => verifyMiniappPackage({ workspace }), /Unexpected miniapp configuration/);
});
