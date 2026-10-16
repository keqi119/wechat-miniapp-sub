const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const docs = [{ id: 'terms', type: 'terms', version: 1, content: '合成协议' }, { id: 'privacy', type: 'privacy', version: 2, content: '合成隐私' }];
const verified = { realNameStatus: 'VERIFIED', certBound: true, readyForSigning: true };
const pending = { realNameStatus: 'PENDING', certBound: false, readyForSigning: false };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
function setup(extra = {}) {
  let token = 'token-a', customer = 'a', submitted = 0, definition;
  const context = () => ({ authenticated: !!customer, customer: customer ? { id: customer } : null, profile: { name: customer }, consents: docs.map(d => ({ documentId: d.id, version: d.version })) });
  const services = { getContext: context, getLoginDocuments: async () => docs, refreshContext: async () => context(), getPaymentVerifications: async () => [], getESignReadiness: async () => pending, refreshESignReadiness: async () => verified, getSigningConfig: async () => ({ enabled: true, signProviderConfigured: true }), startESignVerification: async () => { submitted++; }, ...extra };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages/settings/index.js'), 'utf8'), { Page: value => { definition = value; }, require: id => id.includes('services') ? services : id.includes('config') ? { storageKey: 'session' } : { toastError() {}, confirm: async () => true, go() {} }, wx: { getStorageSync: () => ({ token }) }, clearInterval() {} });
  const p = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  return { p, services, submitted: () => submitted, switchSession(id, nextToken) { customer = id; token = nextToken; } };
}
test('server VERIFIED explicitly completes real name while certificate readiness remains independent and personal inputs are cleared', async () => {
  const { p } = setup({ getESignReadiness: async () => ({ ...verified, certBound: false, readyForSigning: false }) });
  p.setData({ identityName: '合成姓名', idCardNo: 'synthetic', identityAccepted: true }); await p.refresh();
  assert.equal(p.data.identityVerified, true); assert.equal(p.data.identityStatusText, '已完成实名核验'); assert.match(p.data.certificateStatusText, /尚待核验/); assert.equal(p.data.idCardNo, ''); assert.equal(p.data.identityAccepted, false);
});
test('verified customer cannot submit another identity even through a stale event handler', async () => {
  const env = setup({ getESignReadiness: async () => verified }); await env.p.refresh();
  env.p.setData({ identityAccepted: true, identityName: '合成姓名', idCardNo: 'synthetic' }); await env.p.verifyIdentity(); assert.equal(env.submitted(), 0);
});
test('late onShow readiness cannot overwrite a newer explicit authoritative verification result', async () => {
  const old = deferred(), env = setup({ getESignReadiness: () => old.promise });
  const refresh = env.p.refresh(); await new Promise(setImmediate); await env.p.refreshIdentity(); old.resolve(pending); await refresh;
  assert.equal(env.p.data.readiness.realNameStatus, 'VERIFIED'); assert.equal(env.p.data.identityStatusText, '已完成实名核验');
});
test('onShow during explicit verification does not launch another stale readiness read or lose the verified result', async () => {
  const result = deferred(); let reads = 0; const { p } = setup({ refreshESignReadiness: () => result.promise, getESignReadiness: async () => { reads++; return pending; } });
  const query = p.refreshIdentity(); await p.refresh(); result.resolve(verified); await query;
  assert.equal(reads, 0); assert.equal(p.data.identityVerified, true); assert.match(p.data.certificateStatusText, /已就绪/);
});
test('readiness and error responses from an old customer or rotated token cannot update the new page session', async () => {
  for (const next of [['b', 'token-b'], ['a', 'token-new'], [null, null]]) {
    const old = deferred(), env = setup({ refreshESignReadiness: () => old.promise }); const query = env.p.refreshIdentity();
    env.switchSession(...next); const snapshot = structuredClone(env.p.data); old.resolve(verified); await query;
    assert.deepEqual(env.p.data, snapshot);
  }
});
test('unloaded settings ignores delayed identity and full-page responses', async () => {
  for (const action of ['refreshIdentity', 'refresh']) {
    const old = deferred(), env = setup(action === 'refresh' ? { getLoginDocuments: () => old.promise } : { refreshESignReadiness: () => old.promise });
    const query = env.p[action](); env.p.onUnload(); const snapshot = structuredClone(env.p.data); old.resolve(action === 'refresh' ? docs : verified); await query;
    assert.deepEqual(env.p.data, snapshot);
  }
});
test('a stale full-page refresh cannot overwrite a newer session profile or readiness', async () => {
  const old = deferred(), env = setup({ refreshContext: () => old.promise }); const first = env.p.refresh(); await new Promise(setImmediate);
  env.switchSession('b', 'token-b'); env.services.refreshContext = async () => env.services.getContext(); env.services.getESignReadiness = async () => verified; await env.p.refresh();
  old.resolve({ authenticated: true, customer: { id: 'a' }, profile: { name: 'a' }, consents: [] }); await first;
  assert.equal(env.p.data.profile.name, 'b'); assert.equal(env.p.data.identityVerified, true);
});
test('an old passive readiness error cannot replace a newer explicit verified success message', async () => {
  const old = deferred(), env = setup({ getESignReadiness: () => old.promise }); const refresh = env.p.refresh(); await new Promise(setImmediate);
  await env.p.refreshIdentity(); old.reject(new Error('旧请求失败')); await refresh;
  assert.equal(env.p.data.error, ''); assert.match(env.p.data.message, /已完成实名核验/);
});
