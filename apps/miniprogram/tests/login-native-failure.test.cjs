const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createApi } = require('../src/services/api');
const config = require('../src/config');

const documents = ['terms', 'privacy'].map(type => ({ id: 'synthetic-' + type, type, version: 1, content: '合成协议' }));
const consents = documents.map(({ id, version }) => ({ documentId: id, version }));
const nativeFailure = { errMsg: 'login:fail synthetic-private-detail', code: 'synthetic-sensitive-code' };

function setup({ failLogin = false, authFailure } = {}) {
  const storage = new Map(), requests = [], nativeCalls = [], navigationTitles = [], legalNavigations = [];
  const platform = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    login: options => { nativeCalls.push('login'); failLogin ? options.fail(nativeFailure) : options.success({ code: 'synthetic-wx-code' }); },
    setNavigationBarTitle: options => navigationTitles.push(options.title),
  };
  const api = createApi(config, options => {
    const route = new URL(options.url).pathname.replace(/^\/api/, '');
    requests.push({ method: options.method, route, data: options.data });
    if (authFailure && ['/customer/auth/wechat', '/customer/auth/sms/login'].includes(route)) {
      options.success({ statusCode: authFailure.statusCode || 400, data: { error: authFailure, requestId: 'synthetic-request-id' } });
      return;
    }
    let data;
    if (route.startsWith('/public/legal/')) data = documents.find(doc => route.endsWith('/' + doc.type));
    else if (route === '/customer/auth/sms/request') data = { sent: true };
    else if (route === '/customer/auth/sms/login') data = { token: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'synthetic-customer', mobile: '13800000000' } };
    else if (route === '/customer/context') data = { customer: storage.get(config.storageKey).customer, consents };
    else if (route === '/customer/profile') data = { revision: 0, files: {}, readiness: { identityPolicy: 'MANUAL_REVIEW', readyForApplication: false, blockers: [] } };
    else if (route === '/customer/payment-verifications') data = { items: [] };
    else throw new Error('Unexpected synthetic request: ' + route);
    options.success({ statusCode: 200, data });
  }, platform);
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages/profile/index.js'), 'utf8'), {
    Page: value => { definition = value; },
    require: id => id.includes('handover-location') ? require('../src/utils/handover-location') : id === '../../services/index' ? api : id === '../../config' ? config : { go: url => legalNavigations.push(url) },
    wx: platform, setInterval: () => 1, clearInterval() {},
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  const choose = type => page.consent({ currentTarget: { dataset: { type } }, detail: { value: [type] } });
  return { page, api, storage, requests, nativeCalls, navigationTitles, legalNavigations, choose };
}

test('inline agreement readers remain separate from checkbox activation and do not grant consent', async () => {
  const env = setup(); await env.page.refresh();
  const compiler = require('miniprogram-compiler');
  const compiled = compiler.wxmlToJs(path.join(__dirname, '../src'), { wxmlList: ['pages/profile/index.wxml'], maxBuffer: 16 * 1024 * 1024 });
  const render = vm.runInNewContext('(function(global){' + compiled + '})({})', { window: {}, console })('pages/profile/index.wxml');
  const find = (tree, ancestors = []) => tree && typeof tree === 'object' ? [{ node: tree, ancestors }, ...(tree.children || []).flatMap(child => find(child, [...ancestors, tree]))] : [];
  const readers = find(render(env.page.data)).filter(({ node }) => node.attr?.bindtap === 'openLegal');
  assert.equal(readers.length, 2);
  for (const { node, ancestors } of readers) {
    assert.equal(ancestors.some(parent => parent.attr?.class?.includes('consent-row')), true);
    assert.equal(ancestors.some(parent => parent.tag === 'wx-label'), false);
    env.page.openLegal({ currentTarget: { dataset: { type: node.attr['data-type'] } } });
  }
  assert.equal(env.page.data.termsAccepted, false);
  assert.equal(env.page.data.privacyAccepted, false);
  assert.equal(env.legalNavigations.length, 2);
  assert.equal(env.requests.some(request => request.method === 'POST'), false);
});

test('account page and native navigation titles follow login, successful authentication and expired session', async () => {
  const env = setup();
  const compiler = require('miniprogram-compiler');
  const compiled = compiler.wxmlToJs(path.join(__dirname, '../src'), { wxmlList: ['pages/profile/index.wxml'], maxBuffer: 16 * 1024 * 1024 });
  const render = vm.runInNewContext('(function(global){' + compiled + '})({})', { window: {}, console })('pages/profile/index.wxml');
  const visibleText = tree => typeof tree === 'string' ? tree : (tree?.children || []).map(visibleText).join(' ');
  await env.page.refresh();
  assert.equal(env.navigationTitles.at(-1), '登录账户');
  assert.match(visibleText(render(env.page.data)), /登录账户/);
  assert.doesNotMatch(visibleText(render(env.page.data)), /个人资料|完善资料|实名/);
  await env.api.loginSms('13800000000', '123456', consents);
  await env.page.refresh();
  assert.equal(env.navigationTitles.at(-1), '个人资料');
  assert.match(visibleText(render(env.page.data)), /个人资料/);
  env.storage.clear(); await env.page.refresh();
  assert.equal(env.navigationTitles.at(-1), '登录账户');
  assert.doesNotMatch(visibleText(render(env.page.data)), /个人资料|完善资料|实名/);
});

test('a hidden account page cannot overwrite the agreement navigation title after a late refresh', async () => {
  const env = setup(); await env.page.refresh();
  await env.api.loginSms('13800000000', '123456', consents);
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  env.api.refreshContext = () => { started(); return pending; };
  const refresh = env.page.refresh(); await ready;
  env.page.onHide();
  const titlesBefore = env.navigationTitles.length;
  finish({ authenticated: true, profile: {}, consents }); await refresh;
  assert.equal(env.navigationTitles.length, titlesBefore);
  await env.page.onShow();
  assert.equal(env.navigationTitles.at(-1), '个人资料');
  assert.ok(env.navigationTitles.length > titlesBefore);
});

test('login methods switch exclusively and preserve entered values, consent and cooldown', async () => {
  const env = setup();
  await env.page.refresh();
  assert.equal(env.page.data.loginMethod, 'wechat');
  const compiler = require('miniprogram-compiler');
  const compiled = compiler.wxmlToJs(path.join(__dirname, '../src'), { wxmlList: ['pages/profile/index.wxml'], maxBuffer: 16 * 1024 * 1024 });
  const render = vm.runInNewContext('(function(global){' + compiled + '})({})', { window: {}, console })('pages/profile/index.wxml');
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : [];
  const visibleInputs = () => nodes(render(env.page.data)).filter(node => node.tag === 'wx-input');
  const quickActions = () => nodes(render(env.page.data)).filter(node => node.attr?.openType === 'getPhoneNumber');
  const smsActions = () => nodes(render(env.page.data)).filter(node => node.attr?.bindtap === 'smsLogin');
  assert.equal(visibleInputs().length, 0);
  assert.equal(quickActions().length, 1);assert.equal(smsActions().length, 0);
  const before = env.requests.length;
  env.page.selectLoginMethod({currentTarget:{dataset:{method:'sms'}}});
  assert.equal(env.page.data.loginMethod, 'sms');
  assert.equal(quickActions().length, 0);assert.equal(smsActions().length, 1);
  assert.deepEqual(visibleInputs().map(node => node.attr['data-field']), ['mobile', 'code']);
  env.choose('terms'); env.choose('privacy');
  env.page.setData({ mobile: '13800000000', code: '123456', cooldown: 42 });
  env.page.selectLoginMethod({currentTarget:{dataset:{method:'wechat'}}});
  assert.equal(visibleInputs().length, 0);
  assert.equal(quickActions().length, 1);assert.equal(smsActions().length, 0);
  env.page.selectLoginMethod({currentTarget:{dataset:{method:'sms'}}});
  await env.page.refresh();
  assert.equal(env.page.data.loginMethod, 'sms');
  assert.equal(env.page.data.mobile, '13800000000');
  assert.equal(env.page.data.code, '123456');
  assert.equal(env.page.data.cooldown, 42);
  assert.equal(env.page.data.termsAccepted, true);
  assert.equal(env.page.data.privacyAccepted, true);
  assert.equal(env.requests.slice(before).some(request => request.method === 'POST'), false);
  assert.equal(env.nativeCalls.length, 0);
});

test('login method cannot change during login and resets when the account session changes', async () => {
  const env = setup();
  await env.page.refresh();
  const choose=method=>env.page.selectLoginMethod({currentTarget:{dataset:{method}}});
  env.page.setData({ busy: true }); choose('sms');
  assert.equal(env.page.data.loginMethod, 'wechat');
  env.page.setData({ busy: false }); choose('invalid');assert.equal(env.page.data.loginMethod,'wechat');choose('sms');
  env.page.setData({ busy: true }); choose('wechat');
  assert.equal(env.page.data.loginMethod, 'sms');
  env.page.setData({ busy: false }); env.choose('terms'); env.choose('privacy');
  await env.api.loginSms('13800000000', '123456', consents);
  await env.page.refresh();
  assert.equal(env.page.data.authenticated, true);
  assert.equal(env.page.data.loginMethod, 'wechat');
  choose('sms');
  assert.equal(env.page.data.loginMethod, 'wechat');
});

test('one explicit login checkbox grants both current document versions and can revoke both',async()=>{
 const env=setup();await env.page.refresh();
 const compiled=require('miniprogram-compiler').wxmlToJs(path.join(__dirname,'../src'),{wxmlList:['pages/profile/index.wxml'],maxBuffer:16*1024*1024});
 const render=vm.runInNewContext('(function(global){'+compiled+'})({})',{window:{},console})('pages/profile/index.wxml');
 const nodes=t=>t&&typeof t==='object'?[t,...(t.children||[]).flatMap(nodes)]:[];
 const boxes=nodes(render(env.page.data)).filter(n=>n.tag==='wx-checkbox');assert.equal(boxes.length,1);
 assert.equal(env.page.data.termsAccepted,false);assert.equal(env.page.data.privacyAccepted,false);
 env.page.loginConsent({detail:{value:['agreements']}});assert.equal(env.page.data.termsAccepted,true);assert.equal(env.page.data.privacyAccepted,true);
 assert.deepEqual(JSON.parse(JSON.stringify(env.page.consentSnapshot())),consents);
 env.page.selectLoginMethod({currentTarget:{dataset:{method:'sms'}}});assert.equal(env.page.data.termsAccepted,true);assert.equal(env.page.data.privacyAccepted,true);
 env.page.loginConsent({detail:{value:[]}});assert.equal(env.page.data.termsAccepted,false);assert.equal(env.page.data.privacyAccepted,false);assert.throws(()=>env.page.consentSnapshot());
 env.page.setData({legalDocumentsReady:false});env.page.loginConsent({detail:{value:['agreements']}});assert.equal(env.page.data.termsAccepted,false);assert.equal(env.page.data.privacyAccepted,false);
 assert.equal(env.requests.some(r=>r.method==='POST'),false);
});

for (const mode of ['wechat', 'sms']) {
  test(mode + ' native login failure becomes a safe error without requesting or storing a customer session', async () => {
    const env = setup({ failLogin: true });
    const action = mode === 'wechat' ? env.api.loginWechat('synthetic-phone-code', consents) : env.api.loginSms('13800000000', '123456', consents);
    await assert.rejects(action, failure => {
      assert.ok(failure instanceof Error);
      assert.equal(failure.code, 'WECHAT_LOGIN');
      assert.match(failure.message, /登录.*重试/);
      assert.doesNotMatch(failure.message, /微信|腾讯|WeChat/i);
      assert.doesNotMatch(failure.message + JSON.stringify(failure), /synthetic-private-detail|synthetic-sensitive-code/);
      return true;
    });
    assert.deepEqual(env.nativeCalls, ['login']);
    assert.equal(env.requests.length, 0);
    assert.equal(env.storage.size, 0);
  });

  test(mode + ' page shows native login failure and unlocks retry controls', async () => {
    const env = setup({ failLogin: true });
    await env.page.refresh(); env.choose('terms'); env.choose('privacy');
    env.page.setData({ mobile: '13800000000', code: '123456' });
    if (mode === 'wechat') await env.page.phoneLogin({ detail: { code: 'synthetic-phone-code' } });
    else await env.page.smsLogin();
    assert.equal(env.page.data.feedback?.kind, 'error');
    assert.match(env.page.data.feedback.message, /登录.*重试/);
    assert.doesNotMatch(env.page.data.feedback.message, /微信|腾讯|WeChat/i);
    assert.doesNotMatch(env.page.data.feedback.message, /synthetic-private-detail|synthetic-sensitive-code/);
    assert.equal(env.page.data.busy, false);
    assert.equal(env.page.data.authenticated, false);
    assert.equal(env.api.getContext().authenticated, false);
    assert.equal(env.requests.some(request => request.route.startsWith('/customer/auth/')), false);
    assert.equal(env.storage.size, 0);
  });
}

for (const mode of ['wechat', 'sms']) {
  test(mode + ' provider failures use neutral login feedback while preserving rejection and diagnostics', async () => {
    for (const code of ['WECHAT_UNAVAILABLE', 'WECHAT_INVALID_RESPONSE', 'WECHAT_AUTH_FAILED', 'WECHAT_CODE_INVALID', 'WECHAT_TOKEN_INVALID', 'WECHAT_PHONE_INVALID', 'IDENTITY_CONFLICT']) {
      const env = setup({ authFailure: { code, message: '微信授权未成功，请重新授权', statusCode: 503 } });
      const action = mode === 'wechat' ? env.api.loginWechat('synthetic-phone-code', consents) : env.api.loginSms('13800000000', '123456', consents);
      await assert.rejects(action, failure => {
        assert.ok(failure instanceof Error);
        assert.ok(failure.message.length > 0);
        assert.doesNotMatch(failure.message, /微信|腾讯|WeChat/i);
        assert.equal(failure.code, code);
        assert.equal(failure.statusCode, 503);
        assert.equal(failure.requestId, 'synthetic-request-id');
        return true;
      });
      assert.equal(env.storage.size, 0);
      assert.equal(env.requests.length, 1);
    }
  });
}

test('SMS verification errors retain their actionable message', async () => {
  const env = setup({ authFailure: { code: 'SMS_CODE_INVALID', message: '验证码无效或已过期' } });
  await assert.rejects(env.api.loginSms('13800000000', '123456', consents), failure => failure.code === 'SMS_CODE_INVALID' && failure.message === '验证码无效或已过期');
  assert.equal(env.storage.size, 0);
});

test('phone authorization without a code leaves SMS login usable with explicit consents and OpenID exchange', async () => {
  const env = setup();
  await env.page.refresh(); env.choose('terms'); env.choose('privacy');
  await env.page.phoneLogin({ detail: { errMsg: 'getPhoneNumber:fail synthetic-denial' } });
  assert.match(env.page.data.feedback.message, /短信验证码登录/);
  assert.equal(env.page.data.busy, false);
  assert.equal(env.requests.some(request => request.method === 'POST'), false);
  assert.deepEqual(env.nativeCalls, []);
  env.page.setData({ mobile: '13800000000', code: '123456' });
  await env.page.sendSms(); await env.page.smsLogin();
  assert.equal(env.page.data.authenticated, true);
  assert.equal(env.page.data.busy, false);
  assert.equal(env.page.data.message, '已登录。');
  assert.deepEqual(env.nativeCalls, ['login']);
  const auth = env.requests.filter(request => request.route.startsWith('/customer/auth/'));
  assert.deepEqual(auth.map(request => request.route), ['/customer/auth/sms/request', '/customer/auth/sms/login']);
  assert.deepEqual(auth[1].data, { mobile: '13800000000', code: '123456', loginCode: 'synthetic-wx-code', consents });
  assert.equal(env.storage.get(config.storageKey).customer.id, 'synthetic-customer');
});
