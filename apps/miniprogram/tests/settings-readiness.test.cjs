const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createApi } = require('../src/services/api'), config = require('../src/config');
const docs = ['terms', 'privacy'].map(type => ({ id: type, type, version: 1, content: '合成已发布协议' }));
const session = (id = 'a', token = 'token-' + id) => ({ token, expiresAt: '2099-01-01T00:00:00Z', customer: { id, name: '合成客户' } });
const tick = () => new Promise(setImmediate);
let render;
function tree(data) {
  if (!render) {
    const root = path.resolve(__dirname, '../src'), file = 'pages/profile/index.wxml';
    const compiled = require('miniprogram-compiler').wxmlToJs(root, { wxmlList: [file], maxBuffer: 16 * 1024 * 1024 });
    render = vm.runInNewContext('(function(global){' + compiled + '})({})', { window: {}, console })(file);
  }
  return render(data);
}
function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(nodes)]; }
function text(node) { return typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : (node.children || []).map(text).join(''); }
function identityCard(data) { return nodes(tree(data)).find(node => node.tag === 'wx-view' && node.attr?.class?.split(' ').includes('personal-card')); }
function identityStatus(data){return text(nodes(identityCard(data)).find(node=>node.attr?.class?.split(' ').some(value=>['identity-status','identity-verified'].includes(value)))).replace(/^✓\s*/,'');}
function setup({ authenticated = true, readiness = { realNameStatus: 'NOT_STARTED', certBound: false, readyForSigning: false }, intercept } = {}) {
  const storage = new Map(authenticated ? [[config.storageKey, session()]] : []), calls = [], nativeCalls = [];
  const platform = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) };
  const api = createApi(config, options => {
    const route = new URL(options.url).pathname.replace(/^\/api/, ''); calls.push({ route, method: options.method });
    if (intercept?.(route, options)) return;
    let data;
    if (route.startsWith('/public/legal/')) data = docs.find(doc => route.endsWith('/' + doc.type));
    else if (route === '/customer/profile') data = {revision:0,name:'合成客户',mobile:'13800000000',drivingYears:0,files:{legacy:[]},readiness:{readyForApplication:false,blockers:[]}};
      else if(route==='/public/identity-config') data={mode:'MINIAPP_WEBVIEW',enabled:false,signProviderConfigured:false,providerHosts:[],returnUrl:'https://api.evsub.ndacar.com/api/public/esign-return'};
      else if(route==='/customer/virtual-acceptance/capabilities') return options.success({statusCode:403,data:{error:{code:'FORBIDDEN'}}});
      else if (route === '/customer/context') data = { customer: storage.get(config.storageKey).customer, consents: docs.map(doc => ({ documentId: doc.id, version: doc.version })) };
    else if (route === '/customer/payment-verifications' || route === '/customer/technical-acceptances') data = { items: [] };
    else if (route === '/customer/identity/readiness') data = readiness;
    else if (route === '/public/signing-config') return options.success({ statusCode: 503, data: { error: { message: '签署配置不可用' } } });
    else { nativeCalls.push(route); return options.success({ statusCode: 500, data: {} }); }
    options.success({ statusCode: 200, data });
  }, platform);
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages/profile/index.js'), 'utf8'), {
    Page: value => { definition = value; }, require: id => id.includes('handover-location') ? require('../src/utils/handover-location') : id.includes('services') ? api : id.includes('config') ? config : { toastError() {}, confirm: async () => true, go: value => nativeCalls.push(value) }, wx: platform, clearInterval,
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  return { p, api, calls, storage, nativeCalls };
}

for (const [status, expected] of [['NOT_STARTED', '未核验'], ['STARTING', '核验中'], ['PENDING', '核验中'], ['VERIFIED', '已实名'], ['FAILED', '核验失败'], ['EXPIRED', '已过期'], ['UNKNOWN', '状态待确认'], ['FUTURE_STATUS', '状态待确认'], [undefined, '状态待确认'], [null, '状态待确认'], [['VERIFIED'], '状态待确认'], ['toString', '状态待确认']]) {
  test('actual API and WXML show only real-name status ' + (Array.isArray(status) ? 'malformed array' : String(status)), async () => {
    const e = setup({ readiness: status === null ? null : { verified: status === 'VERIFIED', realNameStatus: status, certBound: true, readyForSigning: true } });
    await e.p.refresh();
    assert.equal(identityStatus(e.p.data), expected);
    assert.equal(e.calls.filter(call => call.route === '/customer/identity/readiness').length, 1);
    assert.ok(e.calls.every(call => call.method === 'GET'));
    assert.equal(e.calls.some(call => /signing-config|technical-acceptances/.test(call.route)), false);
    assert.doesNotMatch(text(tree(e.p.data)), /历史资料|签署|证书|法大大/);
    assert.deepEqual(e.nativeCalls, []);
  });
}

test('pending read displays loading, failure is distinct from unverified, and retry is GET-only', async () => {
  let held, fail = true;
  const e = setup({ intercept: (route, options) => { if (route === '/customer/identity/readiness' && fail) { held = options; return true; } } });
  const read = e.p.refresh(); await tick();
  assert.equal(identityStatus(e.p.data), '加载中');
  held.success({ statusCode: 503, data: { error: { message: '不应暴露的内部错误详情' } } }); await read;
  assert.equal(identityStatus(e.p.data), '获取失败');
  assert.doesNotMatch(text(tree(e.p.data)), /未核验|内部错误/);
  const retry = nodes(identityCard(e.p.data)).find(node => node.tag === 'wx-button' && node.attr.bindtap === 'refreshIdentity');
  assert.ok(retry?.attr.bindtap);
  fail = false; await e.p[retry.attr.bindtap]();
  assert.equal(identityStatus(e.p.data), '未核验');
  assert.equal(e.calls.filter(call => call.route === '/customer/identity/readiness').length, 2);
  assert.ok(e.calls.every(call => call.method === 'GET'));
});

test('anonymous settings never reads identity and cannot retry through a stale event', async () => {
  const e = setup({ authenticated: false }); await e.p.refresh(); await e.p.refreshIdentity();
  assert.equal(identityCard(e.p.data), undefined);
  assert.ok(e.calls.every(call => call.route.startsWith('/public/legal/')));
});

test('personal card preserves versioned legal links and two separate consent choices only when needed', async () => {
  const e = setup(); await e.p.refresh();
  const agreed = nodes(tree(e.p.data));
  assert.equal(agreed.filter(node => node.tag === 'wx-checkbox').length, 0);
  assert.equal(agreed.filter(node => node.tag === 'wx-button' && node.attr.bindtap === 'openLegal').length, 2);
  e.p.setData({ consentCurrent: false });
  const pending = nodes(tree(e.p.data)), choices = pending.filter(node => node.tag === 'wx-checkbox');
  assert.deepEqual(choices.map(node => node.attr.value), ['terms', 'privacy']);
  assert.ok(choices.every(node => node.attr.checked === false));
  assert.equal(pending.find(node => node.tag === 'wx-button' && node.attr.bindtap === 'acceptCurrentConsents').attr.disabled, true);
});

test('old test payment data cannot restore removed controls or change the two normal cards', async () => {
  const e = setup(); await e.p.refresh();
  assert.equal(nodes(tree(e.p.data)).some(node => node.attr?.bindtap === 'payVerification'), false);
  e.p.setData({ paymentVerifications: [{ id: 'synthetic-payment', title: '合成验收', canStart: true, payText: '支付 0.01 元', statusText: '待付款' }] });
  const all = nodes(tree(e.p.data)), buttons = all.filter(node => node.tag === 'wx-button');
  assert.equal(all.filter(node => node.tag === 'wx-view' && node.attr?.class?.split(' ').includes('card')).length, 2);
  assert.equal(buttons.some(node => node.attr.bindtap === 'payVerification'), false);
  assert.equal(buttons.some(node => node.attr.bindtap === 'queryVerification'), false);
  assert.equal(e.calls.some(call => /payment-verifications|technical-acceptances|virtual-acceptance/.test(call.route)), false);
  const accountActions = all.find(node => node.attr?.class === 'profile-footer');
  assert.equal(nodes(accountActions).filter(node => node.tag === 'wx-button').at(-1).attr.bindtap, 'logout');
  assert.ok(e.calls.every(call => call.method === 'GET'));
});

for (const outcome of ['VERIFIED', 'ERROR']) test('older ' + outcome + ' identity reply cannot overwrite a newer same-session refresh', async () => {
  let held;
  const e = setup({ intercept: (route, options) => { if (route === '/customer/identity/readiness' && !held) { held = options; return true; } } });
  const old = e.p.refresh(); await tick(); await e.p.refreshIdentity();
  const snapshot = structuredClone(e.p.data);
  assert.ok(held, 'ordinary settings must read identity without a signing capability request');
  held.success({ statusCode: outcome === 'ERROR' ? 503 : 200, data: { verified:true, realNameStatus: 'VERIFIED' } }); await old;
  assert.deepEqual(structuredClone(e.p.data), snapshot);
  assert.equal(identityStatus(e.p.data), '未核验');
});

for (const replacement of [session('b'), session('a', 'rotated')]) test('late identity reply cannot repaint replacement session ' + replacement.token, async () => {
  let held;
  const e = setup({ intercept: (route, options) => { if (route === '/customer/identity/readiness' && !held) { held = options; return true; } } });
  const old = e.p.refresh(); await tick(); e.storage.set(config.storageKey, replacement); await e.p.refresh();
  const snapshot = structuredClone(e.p.data), count = e.calls.length;
  assert.ok(held, 'ordinary settings must read identity without a signing capability request');
  held.success({ statusCode: 200, data: { verified:true, realNameStatus: 'VERIFIED' } }); await old;
  assert.deepEqual(structuredClone(e.p.data), snapshot); assert.equal(e.calls.length, count);
});

test('unloaded page ignores identity success without repaint or new requests', async () => {
  let held;
  const e = setup({ intercept: (route, options) => { if (route === '/customer/identity/readiness') { held = options; return true; } } });
  const read = e.p.refresh(); await tick(); e.p.onUnload(); const snapshot = structuredClone(e.p.data), count = e.calls.length;
  assert.ok(held, 'ordinary settings must read identity without a signing capability request');
  held.success({ statusCode: 200, data: { verified:true, realNameStatus: 'VERIFIED' } }); await read;
  assert.deepEqual(structuredClone(e.p.data), snapshot); assert.equal(e.calls.length, count);
});

test('retry expiry restores login and clears previously shown identity instead of restarting the private GET', async () => {
  let expire = false;
  const e = setup({ readiness: { verified:true, realNameStatus: 'VERIFIED' }, intercept: (route, options) => {
    if (route === '/customer/identity/readiness' && expire) { options.success({ statusCode: 401, data: { error: { code: 'SESSION_EXPIRED' } } }); return true; }
  } });
  await e.p.refresh(); expire = true; await e.p.refreshIdentity();
  assert.equal(e.p.data.authenticated, false); assert.equal(e.p.data.profile, null); assert.equal(e.p.data.legalDocumentsReady, true);
  assert.equal(identityCard(e.p.data), undefined);
  assert.equal(e.calls.filter(call => call.route === '/customer/identity/readiness').length, 2);
  assert.ok(e.calls.every(call => call.method === 'GET'));
});
