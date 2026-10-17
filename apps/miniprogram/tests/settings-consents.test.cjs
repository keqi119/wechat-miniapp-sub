const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const initialDocs = () => [
  { id: 'terms-1', type: 'terms', version: 1, content: '合成用户协议' },
  { id: 'privacy-2', type: 'privacy', version: 2, content: '合成隐私政策' },
];
function setup() {
  let definition, docs = initialDocs(), customerId = null, token = null;
  const calls = [], links = [], notices = [];
  const context = () => ({ authenticated: !!customerId, customer: customerId ? { id: customerId } : null, profile: { name: '合成客户' }, consents: [] });
  const services = {
    getContext: context, getLoginDocuments: async () => docs, refreshContext: async () => context(),
    getTechnicalAcceptances: async () => [], getPaymentVerifications: async () => [],
    getESignReadiness: async () => ({ realNameStatus: 'UNKNOWN' }), getSigningConfig: async () => ({}),
    loginWechat: async (...args) => { calls.push(['wechat', ...args]); },
    requestSms: async (...args) => { calls.push(['sms-send', ...args]); },
    loginSms: async (...args) => { calls.push(['sms-login', ...args]); },
    acceptConsents: async (...args) => { calls.push(['accept', ...args]); },
    logout: async () => { customerId = null; token = null; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages/settings/index.js'), 'utf8'), {
    Page: value => { definition = value; },
    require: id => id.includes('services') ? services : id.includes('config') ? { storageKey: 'session' } : { toastError: e => notices.push(e.message), go: url => links.push(url), confirm: async () => true },
    wx: { getStorageSync: () => token ? { token } : null }, setInterval: () => 1, clearInterval() {},
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  const choose = (type, checked = true) => p.consent({ currentTarget: { dataset: { type } }, detail: { value: checked ? [type] : [] } });
  return { p, services, calls, links, notices, choose, setDocs(value) { docs = value; }, setSession(id, value) { customerId = id; token = value; } };
}

test('terms and privacy start unchecked and either one alone blocks every new-consent action', async () => {
  for (const type of ['terms', 'privacy']) {
    const env = setup(); await env.p.refresh();
    assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
    env.choose(type); env.p.setData({ accepted: true }); // old combined checkbox cannot authorize anything
    assert.throws(() => env.p.consentSnapshot(), /分别/);
    await env.p.phoneLogin({ detail: { code: 'synthetic-phone-code' } });
    await env.p.sendSms(); await env.p.smsLogin(); await env.p.acceptCurrentConsents();
    assert.equal(env.calls.length, 0);
  }
});

test('two independent choices submit exact current versions, and withdrawing either immediately blocks submission', async () => {
  const env = setup(); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
  const expected = initialDocs().map(d => ({ documentId: d.id, version: d.version }));
  assert.deepEqual(structuredClone(env.p.consentSnapshot()), expected);
  await env.p.phoneLogin({ detail: { code: 'synthetic-code' } });
  assert.deepEqual(structuredClone(env.calls[0]), ['wechat', 'synthetic-code', expected]);
  env.choose('terms', false); await env.p.smsLogin(); assert.equal(env.calls.length, 1);
  env.choose('terms'); await env.p.smsLogin();
  assert.deepEqual(structuredClone(env.calls[1]), ['sms-login', '', '', expected]);
  env.choose('privacy', false); assert.throws(() => env.p.consentSnapshot());
});

test('opening links never opts in, returning to the same documents preserves deliberate choices, changed text clears them', async () => {
  const env = setup(); await env.p.refresh();
  env.p.openLegal({ currentTarget: { dataset: { type: 'terms' } } });
  assert.equal(env.links[0], '/pages/legal/index?type=terms');
  assert.equal(env.p.data.termsAccepted, false);
  env.choose('terms'); env.p.onHide(); await env.p.refresh();
  assert.equal(env.p.data.termsAccepted, true); assert.equal(env.p.data.privacyAccepted, false);
  env.choose('privacy'); env.setDocs(initialDocs().map(d => d.type === 'terms' ? { ...d, content: '发生变化的正文' } : d));
  await env.p.refresh(); assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
});

test('published version changes require both fresh choices even if only one agreement was replaced', async () => {
  const env = setup(); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
  env.setDocs(initialDocs().map(d => d.type === 'terms' ? { ...d, id: 'terms-2', version: 2 } : d));
  await env.p.refresh(); assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
  await env.p.acceptCurrentConsents(); assert.equal(env.calls.length, 0);
});

test('account changes, token rotations and logout cannot inherit another session choices', async () => {
  for (const next of [['b', 'token-b'], ['a', 'new-token'], [null, null]]) {
    const env = setup(); env.setSession('a', 'token-a'); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
    env.setSession(...next); await env.p.refresh();
    assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
    assert.throws(() => env.p.consentSnapshot());
  }
});

test('unavailable or still-loading documents invalidate old selection and never send SMS', async () => {
  const env = setup(); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
  let reject; env.services.getLoginDocuments = () => new Promise((_, r) => { reject = r; });
  const refresh = env.p.refresh(); await new Promise(setImmediate);
  await env.p.sendSms(); assert.equal(env.calls.length, 0);
  reject(new Error('无法读取当前协议')); await refresh;
  assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
  env.choose('terms'); env.choose('privacy'); await env.p.phoneLogin({ detail: { code: 'synthetic-code' } });
  assert.equal(env.calls.length, 0);
});

test('only the selected agreement changes, busy and unknown events cannot change any consent', async () => {
  const env = setup(); await env.p.refresh(); env.choose('terms');
  assert.equal(env.p.data.termsAccepted, true); assert.equal(env.p.data.privacyAccepted, false);
  env.choose('identityAccepted'); assert.equal(env.p.data.identityAccepted, false);
  env.p.setData({ busy: true }); env.choose('privacy'); env.choose('terms', false);
  assert.equal(env.p.data.termsAccepted, true); assert.equal(env.p.data.privacyAccepted, false);
});

test('an old document request cannot re-enable consent after a different session refresh', async () => {
  const env = setup(); env.setSession('a', 'token-a'); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
  let resolve; env.services.getLoginDocuments = () => new Promise(r => { resolve = r; });
  const old = env.p.refresh(); await new Promise(setImmediate);
  env.setSession('b', 'token-b'); env.services.getLoginDocuments = async () => initialDocs(); await env.p.refresh();
  resolve(initialDocs()); await old;
  assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
});

test('a session change without page refresh cannot submit or reselect with the previous account documents', async () => {
  for (const next of [['b', 'token-b'], ['a', 'new-token'], [null, null]]) {
    const env = setup(); env.setSession('a', 'token-a'); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
    env.setSession(...next);
    await env.p.acceptCurrentConsents(); await env.p.sendSms();
    assert.equal(env.calls.length, 0);
    assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
    env.choose('terms'); env.choose('privacy'); assert.throws(() => env.p.consentSnapshot());
  }
});

test('401 after documents load clears old choices and document readiness without erasing a newer session response', async () => {
  const env = setup(); env.setSession('a', 'token-a'); await env.p.refresh(); env.choose('terms'); env.choose('privacy');
  env.services.refreshContext = async () => { env.setSession(null, null); throw new Error('会话已失效'); };
  await env.p.refresh();
  assert.equal(env.p.data.termsAccepted, false); assert.equal(env.p.data.privacyAccepted, false);
  assert.equal(env.p.data.legalDocumentsReady, false);
  assert.equal(env.p.data.authenticated, false);
  await env.p.phoneLogin({ detail: { code: 'synthetic-code' } }); assert.equal(env.calls.length, 0);
});
