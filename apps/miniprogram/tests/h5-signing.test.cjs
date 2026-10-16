const { test } = require('node:test'), assert = require('node:assert/strict');
const { createApi } = require('../src/services/api'), config = require('../src/config');
const entryUrl = 'https://app.subauto.keybox.cloud/miniapp-sign/';
function setup(extra = {}) {
  let signing = extra.config || { mode: 'SERVICE_ACCOUNT_H5', entryUrl, enabled: true }, status = extra.status || { status: 'PENDING' }, failStatus = false;
  const storage = new Map([[config.storageKey, { token: 'synthetic-secret', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1', mobile: '00000000000' } }]]), calls = [], navigations = [], copied = [];
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast() {}, showModal: v => v.success({ confirm: true }), navigateTo: v => { navigations.push(v.url); v.success?.({}); }, navigateBack() {}, setClipboardData: v => { copied.push(v.data); v.success?.({}); }, getClipboardData() { throw Error('Must not read clipboard'); }, navigateToMiniProgram() { throw Error('No native external launch'); }, request(v) {
    calls.push(v); const route = v.url.replace(/^https:\/\/[^/]+\/api/, '');
    if (failStatus && route !== '/public/signing-config') return failStatus === 'NETWORK' ? v.fail({}) : v.success({ statusCode: failStatus, data: { error: { message: '合成错误，结果未核实' } } });
    let data;
    if (route === '/public/signing-config') data = signing;
    else if (route === '/customer/esign/readiness') data = { readyForSigning: status.status === 'VERIFIED', realNameStatus: status.status === 'VERIFIED' ? 'VERIFIED' : 'NOT_STARTED' };
    else if (route.endsWith('/sign-status')) data = status;
    else if (route === '/customer/order-changes/r1' || route === '/customer/order-changes/r1/sync') data = { id: 'r1', orderId: 'o1', kind: 'DELIVERY_DELAY', status: 'AWAITING_SIGNATURE', revision: 7, quote: null, contract: { id: 'am1', status: status.status, signedFileId: status.signedFileId || null }, finance: { obligations: [], refunds: [], blockers: [] }, blockers: [], canSync: true };
    else throw Error('Disallowed native route ' + route);
    v.success({ statusCode: 200, data });
  } };
  return { wx, calls, storage, navigations, copied, api: createApi(config, v => wx.request(v), wx), setConfig: v => { signing = v; }, setStatus: v => { status = v; }, fail: (code = 'NETWORK') => { failStatus = code; } };
}
function page(env, options, name = 'sign') { global.wx = env.wx; let definition; global.Page = v => { definition = v; }; for (const file of ['../src/services/index', '../src/pages/' + name + '/index']) delete require.cache[require.resolve(file)]; require('../src/pages/' + name + '/index'); const p = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } }; p.onLoad?.(options); return p; }
test('contract and handover starts only open a local H5 guide without supplier URL or business POST', async () => {
  for (const [type, kind] of [['contracts', 'contract'], ['handovers', 'handover']]) { const env = setup(); const result = await env.api.performAction(type, 'r1', 'sign'); assert.equal(result.status, 'H5_GUIDANCE'); assert.equal(env.navigations.at(-1), '/pages/sign/index?kind=' + kind + '&id=r1'); assert.equal(env.calls.some(v => v.method !== 'GET'), false); assert.equal(env.copied.length, 0); assert.deepEqual(env.storage.get(config.storageKey + ':pending'), { kind, id: 'r1' }); }
});
test('identity entry collects no native identity and never registers or starts verification', async () => {
  const env = setup(); await env.api.startESignVerification(); assert.equal(env.navigations.at(-1), '/pages/sign/index?kind=identity&id=c1'); assert.equal(env.calls.some(v => v.method === 'POST'), false); assert.equal(env.api.registerESign, undefined); assert.equal(env.api.openSigningMiniProgram, undefined);
});
test('clipboard copy is explicit and contains exactly the public fixed URL with no customer identifiers', async () => {
  const env = setup(); const p = page(env, { kind: 'contract', id: 'r1' }); await p.reload(); await p.onShow(); assert.equal(env.copied.length, 0); await p.copyEntry(); assert.deepEqual(env.copied, [entryUrl]); assert.equal(p.data.status, 'PENDING'); assert.doesNotMatch(env.copied[0], /token|mobile|idCard|r1|c1/); assert.equal(env.calls.some(v => v.url.includes('app.subauto')), false);
});
test('disabled or changed public config blocks copy and never falls back to a hardcoded enabled entry', async () => {
  const env = setup({ config: { mode: 'SERVICE_ACCOUNT_H5', entryUrl, enabled: false } }); const p = page(env, { kind: 'contract', id: 'r1' }); await p.reload(); await p.copyEntry(); assert.equal(env.copied.length, 0); assert.equal(p.data.signing.enabled, false);
  env.setConfig({ mode: 'SERVICE_ACCOUNT_H5', entryUrl, enabled: true }); await p.reload(); env.setConfig({ mode: 'SERVICE_ACCOUNT_H5', entryUrl, enabled: false }); await p.copyEntry(); assert.equal(env.copied.length, 0);
});
test('wrong origin/path/mode or URL credentials/query are rejected rather than copied', async () => {
  for (const data of [{ mode: 'WEBVIEW', entryUrl, enabled: true }, { mode: 'SERVICE_ACCOUNT_H5', entryUrl: entryUrl + '?token=x', enabled: true }, { mode: 'SERVICE_ACCOUNT_H5', entryUrl: 'https://app.subauto.keybox.cloud/portal/', enabled: true }, { mode: 'SERVICE_ACCOUNT_H5', entryUrl: 'https://app.subauto.keybox.cloud.evil.test/miniapp-sign/', enabled: true }, { mode: 'SERVICE_ACCOUNT_H5', entryUrl: 'https://u:p@app.subauto.keybox.cloud/miniapp-sign/', enabled: true }]) { const env = setup({ config: data }); await assert.rejects(env.api.copySigningEntry('contract', 'r1')); assert.equal(env.copied.length, 0); }
});
test('identity status uses GET readiness only and contract/handover use their correct status routes', async () => {
  for (const [kind, id, suffix] of [['identity', 'c1', '/customer/esign/readiness'], ['contract', 'r1', '/customer/contracts/r1/sign-status'], ['handover', 'r1', '/customer/handovers/r1/sign-status']]) { const env = setup(); const result = await env.api.getSignStatus(id, kind); assert.equal(result.status, 'PENDING'); assert.ok(env.calls.at(-1).url.endsWith(suffix)); assert.equal(env.calls.at(-1).method, 'GET'); }
});
test('onShow never treats return or missing archive as signed; only trusted server completion changes status', async () => {
  const env = setup(); const p = page(env, { kind: 'contract', id: 'r1' }); await p.reload(); await p.onShow(); assert.equal(p.data.status, 'PENDING'); env.setStatus({ status: 'SIGNED' }); await p.refreshStatus(); assert.notEqual(p.data.status, 'SIGNED'); env.setStatus({ status: 'SIGNED', signedFileId: 'archive1' }); await p.refreshStatus(); assert.equal(p.data.status, 'SIGNED'); env.fail(); await p.refreshStatus(); assert.equal(p.data.status, 'UNKNOWN'); assert.ok(p.data.statusError);
});
test('unknown kind or identity belonging to another session fails without silently querying a main contract', async () => {
  const env = setup(); await assert.rejects(env.api.getSignStatus('r1', 'wrong')); await assert.rejects(env.api.getSigningGuidance('identity', 'other-customer')); assert.equal(env.calls.length, 0); const p = page(env, { kind: 'wrong', id: 'r1' }); await p.reload(); await p.onShow(); assert.ok(p.data.error); assert.equal(env.calls.length, 0);
});
test('legacy external signing URLs are purged and resumed context contains only kind/id', async () => {
  const env = setup(); env.storage.set(config.storageKey + ':pending', { kind: 'contract', id: 'r1', task: { url: 'https://supplier.invalid/private?name=synthetic' } }); env.api.purgeLegacySigningCache(); assert.equal(env.storage.has(config.storageKey + ':pending'), false); env.storage.set(config.storageKey + ':pending', { kind: 'handover', id: 'r1' }); await env.api.resumeSigning(); assert.ok(env.calls.at(-1).url.endsWith('/handovers/r1/sign-status')); assert.equal(env.calls.some(v => v.url.includes('supplier.invalid')), false);
});
test('all three document kinds onShow read the correct server result and 403/409/network errors never keep success', async () => {
  for (const kind of ['contract', 'handover', 'order-change']) { const env = setup({ status: { status: 'SIGNED', signedFileId: 'archive1' } }); const p = page(env, { kind, id: 'r1' }); await p.reload(); await p.onShow(); assert.equal(p.data.status, 'SIGNED'); if (kind === 'order-change') { const sync = env.calls.find(v => v.url.endsWith('/order-changes/r1/sync')); assert.equal(sync.method, 'POST'); assert.equal(sync.data.revision, 7); } for (const code of [403, 409, 'NETWORK']) { env.fail(code); await p.refreshStatus(); assert.equal(p.data.status, 'UNKNOWN'); assert.ok(p.data.statusError); } assert.equal(env.calls.some(v => /\/(sign|verify|register)$/.test(v.url)), false); }
});
test('settings removes native identity fields and uses H5 guidance and GET-only identity readback', async () => {
  const env = setup(); const p = page(env, {}, 'settings'); assert.equal(p.data.idCardNo, undefined); assert.equal(p.data.identityName, undefined); p.input({ currentTarget: { dataset: { field: 'idCardNo' } }, detail: { value: 'synthetic-identity' } }); assert.equal(p.data.idCardNo, undefined); await p.verifyIdentity(); await p.refreshIdentity(); assert.equal(env.calls.some(v => v.method === 'POST'), false); assert.ok(env.navigations.at(-1).includes('kind=identity')); assert.equal(env.calls.at(-1).method, 'GET');
});
test('app foreground resume queries only cached business context and copying cannot reenter', async () => {
  const env = setup(); const p = page(env, { kind: 'handover', id: 'r1' }); await p.reload(); await Promise.all([p.copyEntry(), p.copyEntry()]); assert.equal(env.copied.length, 1); env.storage.set(config.storageKey + ':pending', { kind: 'handover', id: 'r1' }); let app; global.App = v => { app = v; }; delete require.cache[require.resolve('../src/app')]; require('../src/app'); app.onLaunch(); await app.onShow(); assert.ok(env.calls.at(-1).url.endsWith('/handovers/r1/sign-status')); assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
