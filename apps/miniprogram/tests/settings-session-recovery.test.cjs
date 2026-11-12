const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const documents = ['terms', 'privacy'].map(type => ({ id: 'synthetic-' + type, type, version: 1, content: '合成协议正文' }));
const validSession = (id = 'old') => ({ token: 'synthetic-token-' + id, expiresAt: '2099-01-01T00:00:00Z', customer: { id, name: '合成客户-' + id } });
function setup({ authenticated = true, expiredRoute, intercept } = {}) {
  const storage = new Map(), calls = [], nativeCalls = [], notices = [];
  if (authenticated) storage.set(config.storageKey, validSession());
  const platform = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    login: options => { nativeCalls.push('login'); options.success({ code: 'synthetic-wx-code' }); },
  };
  const api = createApi(config, options => {
    const route = new URL(options.url).pathname.replace(/^\/api/, '');
    calls.push({ method: options.method, route });
    if (intercept?.(route, options)) return;
    queueMicrotask(() => {
      if (route === expiredRoute) return options.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED', message: '登录已过期' } } });
      let data;
      if (route.startsWith('/public/legal/')) data = documents.find(d => route.endsWith('/' + d.type));
      else if (route === '/customer/technical-acceptances' || route === '/customer/payment-verifications') data = { items: [] };
      else if (route === '/customer/profile') data = {revision:0,name:'合成客户',mobile:'13800000000',drivingYears:0,files:{legacy:[]},readiness:{readyForApplication:false,blockers:[]}};
      else if(route==='/public/identity-config') data={mode:'MINIAPP_WEBVIEW',enabled:false,signProviderConfigured:false,providerHosts:[],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
      else if(route==='/customer/virtual-acceptance/capabilities') return options.success({statusCode:403,data:{error:{code:'FORBIDDEN'}}});
      else if (route === '/customer/context') data = { customer: storage.get(config.storageKey).customer, consents: documents.map(d => ({ documentId: d.id, version: d.version })) };
      else if (route === '/customer/identity/readiness') data = { realNameStatus: 'UNKNOWN', certBound: false, readyForSigning: false };
      else if (route === '/public/signing-config') data = { mode: 'MINIAPP_WEBVIEW', newOrderContractMode: 'ESIGN', newEsignRequestsEnabled: true, enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com','realnameverify16.fadada.com'], returnUrl: 'https://api.evsub.ndacar.com/api/public/esign-return' };
      else if (route === '/customer/auth/wechat' || route === '/customer/auth/sms/login') data = validSession('new');
      else throw new Error('Unexpected synthetic request: ' + route);
      options.success({ statusCode: 200, data });
    });
  }, platform);
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages/profile/index.js'), 'utf8'), {
    Page: value => { definition = value; },
    require: id => id.includes('handover-location') ? require('../src/utils/handover-location') : id === '../../services/index' ? api : id === '../../config' ? config : { toastError: error => notices.push(error.message), confirm: async () => false, go() {} },
    wx: platform, setInterval, clearInterval,
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  const choose = type => page.consent({ currentTarget: { dataset: { type } }, detail: { value: [type] } });
  return { page, api, calls, storage, nativeCalls, notices, choose };
}

for (const expiredRoute of ['/customer/context', '/customer/profile', '/customer/identity/readiness']) {
  test('real API 401 at ' + expiredRoute + ' restores anonymous login and freshly read public agreements', async () => {
    const env = setup({ expiredRoute });
    env.page.setData({ termsAccepted: true, privacyAccepted: true });
    await env.page.refresh();
    assert.equal(env.api.getContext().authenticated, false);
    assert.equal(env.page.data.authenticated, false);
    assert.equal(env.page.data.profile, null);
    assert.equal(env.page.data.legalDocumentsReady, true);
    assert.equal(env.page.data.legalDocuments.length, 2);
    assert.equal(env.page.data.termsAccepted, false);
    assert.equal(env.page.data.privacyAccepted, false);
    assert.throws(() => env.page.consentSnapshot(), /分别/);
    env.choose('terms'); env.choose('privacy');
    assert.deepEqual(structuredClone(env.page.consentSnapshot()), documents.map(d => ({ documentId: d.id, version: d.version })));
    assert.equal(env.calls.filter(c => c.route === expiredRoute).length, 1, 'must not replay authenticated requests');
    assert.ok(env.calls.every(c => c.method === 'GET'));
    assert.deepEqual(env.nativeCalls, []);
  });
}

test('clean anonymous entry and explicit synthetic re-login keep independent agreements and never start signing', async () => {
  const env = setup({ authenticated: false });
  await env.page.refresh();
  assert.equal(env.page.data.authenticated, false);
  assert.equal(env.page.data.legalDocumentsReady, true);
  assert.ok(env.calls.every(c => c.route.startsWith('/public/legal/')));
  env.choose('terms'); await env.page.phoneLogin({ detail: { code: 'synthetic-phone-code' } });
  assert.equal(env.calls.some(c => c.method === 'POST'), false);
  env.choose('privacy'); await env.page.phoneLogin({ detail: { code: 'synthetic-phone-code' } });
  assert.equal(env.page.data.authenticated, true);
  assert.equal(env.api.getContext().customer.id, 'new');
  assert.equal(env.page.data.message, '已登录。');
  assert.deepEqual(env.calls.filter(c => c.method === 'POST'), [{ method: 'POST', route: '/customer/auth/wechat' }]);
  assert.deepEqual(env.nativeCalls, ['login']);
});

test('late old-session 401 cannot clear or repaint a newer successfully refreshed account', async () => {
  let held;
  const env = setup({ intercept: (route, options) => {
    if (!held && route === '/customer/identity/readiness') { held = options; return true; }
  } });
  const oldRefresh = env.page.refresh(); await new Promise(setImmediate);
  env.storage.set(config.storageKey, validSession('replacement'));
  await env.page.refresh();
  const snapshot = structuredClone(env.page.data), requestCount = env.calls.length;
  held.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED' } } });
  await oldRefresh;
  assert.equal(env.api.getContext().customer.id, 'replacement');
  assert.deepEqual(structuredClone(env.page.data), snapshot);
  assert.equal(env.calls.length, requestCount);
});

test('unloaded page does not restart legal loading or repaint after delayed session expiry', async () => {
  let held;
  const env = setup({ intercept: (route, options) => {
    if (route === '/customer/identity/readiness') { held = options; return true; }
  } });
  const refresh = env.page.refresh(); await new Promise(setImmediate);
  env.page.onUnload(); const snapshot = structuredClone(env.page.data), requestCount = env.calls.length;
  held.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED' } } });
  await refresh;
  assert.deepEqual(structuredClone(env.page.data), snapshot);
  assert.equal(env.calls.length, requestCount);
});

for (const mode of ['wechat', 'sms']) {
  test(mode + ' login cannot claim success after the returned session is rejected by its first read', async () => {
    const env = setup({ authenticated: false, expiredRoute: '/customer/identity/readiness' });
    await env.page.refresh(); env.choose('terms'); env.choose('privacy');
    if (mode === 'wechat') await env.page.phoneLogin({ detail: { code: 'synthetic-phone-code' } });
    else { env.page.setData({ mobile: '13800000000', code: '123456' }); await env.page.smsLogin(); }
    assert.equal(env.api.getContext().authenticated, false);
    assert.equal(env.page.data.authenticated, false);
    assert.equal(env.page.data.legalDocumentsReady, true);
    assert.equal(env.page.data.message, '');
    assert.equal(env.calls.filter(c => c.method === 'POST').length, 1);
  });
}

test('failed public agreements after session recovery stay unavailable without repeatedly retrying', async () => {
  const env = setup({ expiredRoute: '/customer/identity/readiness', intercept: (route, options) => {
    if (route.startsWith('/public/legal/') && !env.api.getContext().authenticated) {
      queueMicrotask(() => options.success({ statusCode: 503, data: { error: { code: 'LEGAL_UNAVAILABLE', message: '合成协议暂不可用' } } }));
      return true;
    }
  } });
  await env.page.refresh();
  assert.equal(env.page.data.authenticated, false);
  assert.equal(env.page.data.legalDocumentsReady, false);
  assert.match(env.page.data.error, /协议暂不可用/);
  assert.equal(env.calls.filter(c => c.route === '/customer/identity/readiness').length, 1);
  assert.equal(env.calls.filter(c => c.route.startsWith('/public/legal/')).length, 4);
  assert.deepEqual(env.nativeCalls, []);
});
