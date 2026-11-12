const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const src = path.resolve(__dirname, '../src');
const session = id => ({ token: 'synthetic-' + id, expiresAt: '2099-01-01T00:00:00Z', customer: { id, name: '客户-' + id, mobile: '13800000000' } });
let render;
function tree(data) {
  if (!render) {
    const compiled = require('miniprogram-compiler').wxmlToJs(src, { wxmlList: ['pages/mine/index.wxml'], maxBuffer: 16 * 1024 * 1024 });
    render = vm.runInNewContext('(function(global){' + compiled + '})({})', { window: {}, console })('pages/mine/index.wxml');
  }
  return render(data);
}
const nodes = value => value && typeof value === 'object' ? [value, ...(value.children || []).flatMap(nodes)] : [];
const text = value => typeof value === 'string' ? value : (value?.children || []).map(text).join('');
function anonymousView(page) {
  const view = tree(page.data), buttons = nodes(view).filter(node => node.tag === 'wx-button');
  assert.equal(buttons.filter(button => text(button) === '登录账户').length, 1);
  assert.doesNotMatch(text(view), /个人资料|我的申请|我的订阅与订单|合同文件|支付记录|客户-/);
  assert.equal(buttons.some(button => ['open', 'openRecords', 'openApplication'].includes(button.attr?.bindtap)), false);
}
function setup({ account = null } = {}) {
  const storage = new Map(), calls = [], navigations = [], held = [];
  if (account) storage.set(config.storageKey, session(account));
  const control = { hold: null, fail: null };
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    navigateTo: value => navigations.push(value.url), switchTab: value => navigations.push(value.url), showToast() {},
  };
  const api = createApi(config, options => {
    const route = new URL(options.url).pathname.replace(/^\/api/, '');
    const id = options.header.Authorization.replace('Bearer synthetic-', '');
    const result = route === '/customer/context' ? { customer: session(id).customer, consents: [] }
      : route === '/customer/dashboard' ? { application: { id: 'application-' + id, status: 'SUBMITTED', statusText: '审核中' }, subscription: null }
      : null;
    assert.ok(result, 'unexpected request: ' + route);
    calls.push({ route, id });
    const reply = (statusCode = 200) => options.success({ statusCode, data: statusCode === 200 ? result : { error: { code: statusCode === 401 ? 'SESSION_EXPIRED' : 'UNAVAILABLE', message: statusCode === 401 ? '登录已过期' : '暂时无法加载' } } });
    if (control.hold === route) { held.push({ route, id, reply }); return; }
    queueMicrotask(() => reply(control.fail === route ? 401 : 200));
  }, wx);
  const helperModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(src, 'utils/page.js'), 'utf8'), { module: helperModule, require: () => config, wx });
  let definition;
  const navigation = require('../src/utils/tab-navigation').createTabNavigation({ switchTab: wx.switchTab, showToast: wx.showToast });
  vm.runInNewContext(fs.readFileSync(path.join(src, 'pages/mine/index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx,
    require: id => id === '../../services/index' ? api : id === '../../config' ? config : id === '../../utils/tab-navigation' ? { navigation } : helperModule.exports,
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  return { page, api, storage, calls, navigations, control, held, switchTo(id) { if (id) storage.set(config.storageKey, session(id)); else storage.delete(config.storageKey); } };
}
const tick = () => new Promise(setImmediate);

test('anonymous mine shows one login action without private menus or protected requests', async () => {
  const env = setup();
  await env.page.reload();
  anonymousView(env.page);
  assert.deepEqual(env.calls, []);
  env.page.openLogin();
  assert.deepEqual(env.navigations, ['/pages/profile/index']);
});

test('authenticated mine keeps personal profile and account-owned application and records', async () => {
  const env = setup({ account: 'a' });
  await env.page.reload();
  const view = tree(env.page.data);
  assert.equal(nodes(view).filter(node => node.attr?.bindtap === 'open' && node.attr?.['data-url'] === '/pages/profile/index').length, 1);
  assert.match(text(view), /客户-a/);
  assert.equal(nodes(view).some(node => node.attr?.bindtap === 'openLogin'), false);
  env.page.openApplication();
  assert.deepEqual(env.navigations, ['/pages/application-detail/index?id=application-a']);
});

test('authenticated dashboard failure retains personal profile access without showing stale business menus', async () => {
  const env = setup({ account: 'a' });
  await env.page.reload();
  env.control.hold = '/customer/dashboard';
  const pending = env.page.reload(); await tick();
  env.held[0].reply(503); await pending;
  const view = tree(env.page.data), buttons = nodes(view).filter(node => node.tag === 'wx-button');
  assert.equal(nodes(view).filter(node => node.attr?.bindtap === 'open' && node.attr?.['data-url'] === '/pages/profile/index').length, 1);
  assert.equal(buttons.some(button => button.attr?.bindtap === 'openLogin'), false);
  assert.equal(buttons.some(button => ['openRecords', 'openApplication'].includes(button.attr?.bindtap)), false);
  env.page.open({ currentTarget: { dataset: { url: '/pages/profile/index' } } });
  assert.deepEqual(env.navigations, ['/pages/profile/index']);
});

test('returning after logout clears the previous customer and skips all protected requests', async () => {
  const env = setup({ account: 'a' });
  await env.page.reload();
  env.switchTo(null);
  const before = env.calls.length;
  await env.page.reload();
  anonymousView(env.page);
  assert.equal(env.page.data.profile?.name, undefined);
  assert.equal(env.page.data.application, null);
  assert.equal(env.calls.length, before);
});

test('locally expired session enters anonymous mine without requesting a dashboard', async () => {
  const env = setup({ account: 'a' });
  env.storage.set(config.storageKey, { ...session('a'), expiresAt: '2000-01-01T00:00:00Z' });
  await env.page.reload();
  anonymousView(env.page);
  assert.deepEqual(env.calls, []);
});

for (const route of ['/customer/context', '/customer/dashboard']) {
  test('401 at ' + route + ' clears visible private data and restores login', async () => {
    const env = setup({ account: 'a' });
    await env.page.reload();
    env.control.fail = route;
    await env.page.reload();
    anonymousView(env.page);
    assert.equal(env.page.data.profile?.name, undefined);
    assert.equal(env.page.data.application, null);
    assert.equal(env.api.getContext().authenticated, false);
  });
}

for (const status of [200, 401]) {
  test('late old-account dashboard ' + status + ' cannot repaint a newer account', async () => {
    const env = setup({ account: 'a' });
    env.control.hold = '/customer/dashboard';
    const old = env.page.reload(); await tick();
    env.switchTo('b'); env.control.hold = null;
    await env.page.reload();
    const snapshot = structuredClone(env.page.data), count = env.calls.length;
    env.held[0].reply(status); await old;
    assert.deepEqual(structuredClone(env.page.data), snapshot);
    assert.equal(env.calls.length, count);
    assert.equal(env.page.data.profile.name, '客户-b');
    assert.equal(env.page.data.application.id, 'application-b');
  });
}

test('logout during a pending dashboard cannot restore the former account', async () => {
  const env = setup({ account: 'a' });
  await env.page.reload();
  env.control.hold = '/customer/dashboard';
  const pending = env.page.reload(); await tick();
  env.switchTo(null);
  env.held[0].reply(); await pending;
  anonymousView(env.page);
  assert.equal(env.page.data.profile?.name, undefined);
  assert.equal(env.page.data.application, null);
});

test('account change while context is pending does not request a mixed-account dashboard', async () => {
  const env = setup({ account: 'a' });
  env.control.hold = '/customer/context';
  const pending = env.page.reload(); await tick();
  env.switchTo('b'); env.held[0].reply(); await pending;
  assert.equal(env.calls.some(call => call.route === '/customer/dashboard'), false);
  assert.doesNotMatch(text(tree(env.page.data)), /客户-a|application-a/);
});

test('unloaded mine ignores a late private response', async () => {
  const env = setup({ account: 'a' });
  env.control.hold = '/customer/dashboard';
  const pending = env.page.reload(); await tick();
  env.page.onUnload?.();
  const snapshot = structuredClone(env.page.data);
  env.held[0].reply(); await pending;
  assert.deepEqual(structuredClone(env.page.data), snapshot);
});
