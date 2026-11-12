const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const { paidAccount, purchase, input } = require('./fixtures/paid-swap.cjs');
const { renderPage } = require('./helpers/wxml-view.cjs');

function setup(options = {}) {
  let current = options.account || paidAccount({ contractMode: 'OFFLINE',canRequest:false,canPurchase:false,blockers:['本单暂不满足换车条件'],purchaseBlockers:['新购买暂不可办理'] });
  const calls = [], navigations = [], dialogs = [];
  const storage = new Map([[config.storageKey, { token: 'synthetic', customer: { id: 'c1' }, expiresAt: '2099-01-01T00:00:00Z' }]]);
  const wx = { getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: k => storage.delete(k), setNavigationBarTitle() {}, showToast() {}, showModal(v) { dialogs.push(v); v.success({ confirm: true }); } };
  const api = createApi(config, v => {
    const route = new URL(v.url).pathname.replace(/^\/api/, ''); calls.push({ route, method: v.method, data: v.data });
    let data;
    if (route.endsWith('/swap-account')) data = current;
    else if (route.endsWith('/usage-account')) return v.success({ statusCode: 503, data: { error: { message: '合成里程台账暂不可用' } } });
    else if (route === '/customer/dashboard') data = { subscription: { id: 'o1', orderId: 'o1', status: 'ACTIVE', vehicleName: '合成车辆', contractMode: options.dashboardMode || 'OFFLINE', ...options.subscription } };
    else if (route === '/customer/records/entitlements') data = { items: [], total: 0 };
    else if (route === '/customer/swap-credit-purchases/sp1') data = purchase();
    else if (route.endsWith('/vehicle-changes')) data = { id: 'vc-new', kind: 'VEHICLE_CHANGE' };
    else if (route.endsWith('/swap-credits')) data = { purchase: purchase(), bill: purchase().bill };
    else throw Error('Unexpected synthetic route ' + route);
    v.success({ statusCode: 200, data });
  }, wx);
  function page(name, options = {}) {
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages', name, 'index.js'), 'utf8'), { Page: value => definition = value, wx, require: name => name.includes('/services/') ? api : name.includes('/config') ? config : {
      load: async (page, work) => { page.setData({ loading: true, error: '' }); try { const result = await work(); page.setData({ ...result, loading: false }); return result; } catch (error) { page.setData({ loading: false, error: error.message }); return null; } },
      go: url => navigations.push(url), toastError() {}, confirm: async (title, content) => { dialogs.push({ title, content }); return true; },
    } });
    const result = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } }; result.onLoad?.(options); return result;
  }
  return { api, page, calls, navigations, dialogs, setAccount(value) { current = value; } };
}

test('OFFLINE swap DTO retains its mode and honors the current server refusal of new requests and purchases', async () => {
  const env = setup();
  const account = await env.api.getSwapAccount('o1');
  assert.equal(account.contractMode, 'OFFLINE');
  assert.equal(account.canRequest, false); assert.equal(account.canPurchase, false);
  await assert.rejects(env.api.requestVehicleChange('o1', { reason: '合成换车需求' }), { code: 'SWAP_UNAVAILABLE' });
  await assert.rejects(env.api.createSwapCredit('o1', input()), { code: 'SWAP_PURCHASE_UNAVAILABLE' });
  assert.equal(env.calls.some(v => v.method === 'POST'), false);
});

test('unknown swap mode fails closed, while omitted historical mode remains ESIGN', async () => {
  const env = setup({ account: paidAccount() });
  const legacy = await env.api.getSwapAccount('o1');
  assert.equal(legacy.contractMode, 'ESIGN'); assert.equal(legacy.canRequest, true); assert.equal(legacy.canPurchase, true);
  env.setAccount(paidAccount({ contractMode: 'UNKNOWN' }));
  await assert.rejects(env.api.getSwapAccount('o1'), { code: 'RESPONSE' });
});

test('OFFLINE use page permits reading the real swap account while keeping existing order and service links', async () => {
  const env = setup(); const page = env.page('use'); await page.reload();
  const view = renderPage('use', page.data);
  assert.match(view, /换车次数与申请/); assert.match(view, /查看本订单/); assert.match(view, /道路救援/); assert.match(view, /权益、里程包与月结算/);
  page.openSwapAccount(); page.openVehicleChange(); assert.deepEqual(env.navigations, ['/pages/records/index?type=entitlements&orderId=o1','/pages/records/index?type=entitlements&orderId=o1']);
  page.openSubscription(); assert.equal(env.navigations.at(-1), '/pages/order-detail/index?id=o1');assert.equal(env.calls.some(v=>v.method==='POST'),false);
});

test('ESIGN use page retains swap entry and existing change navigation', async () => {
  const env = setup({ dashboardMode: 'ESIGN', subscription: { activeChangeId: 'vc1' } }); const page = env.page('use'); await page.reload();
  assert.match(renderPage('use', page.data), /换车次数与申请/);
  page.openVehicleChange(); page.openSwapAccount();
  assert.deepEqual(env.navigations, ['/pages/record/index?type=orderchanges&id=vc1', '/pages/records/index?type=entitlements&orderId=o1']);
});

test('OFFLINE entitlement deep link hides server-denied actions and refreshes stale local flags before writing', async () => {
  const env = setup(); const page = env.page('records', { type: 'entitlements', orderId: 'o1' }); await page.reload();
  assert.equal(page.data.swap.contractMode, 'OFFLINE'); assert.ok(page.data.usageError);
  const view = renderPage('records', page.data);
  assert.doesNotMatch(view, /免费可用|免费换车次数与本订阅|固定800元|创建800元|提交换车申请|本订阅付费换车次数/);
  assert.match(view, /本单暂不满足换车条件/);
  page.setData({ swap: { ...page.data.swap, canRequest: true, canPurchase: true }, swapReason: '合成原因', swapPurchaseAccepted: true });
  await page.requestSwap(); await page.buySwapCredit();
  assert.equal(env.calls.some(v => v.method === 'POST'), false);
});

test('current OFFLINE order also suppresses legacy DTO promises on dashboard-based entitlement entry', async () => {
  const env = setup({ account: paidAccount({ contractMode: 'ESIGN' }) }); const page = env.page('records', { type: 'entitlements' }); await page.reload();
  assert.doesNotMatch(renderPage('records', page.data), /免费可用|固定800元|提交换车申请/);
  page.setData({ swapReason: '合成原因', swapPurchaseAccepted: true }); await page.requestSwap(); await page.buySwapCredit();
  assert.equal(env.dialogs.length, 0); assert.equal(env.calls.some(v => v.method === 'POST'), false);
});

test('history remains readable for ESIGN and OFFLINE without opening a new purchase', async () => {
  for (const mode of ['ESIGN', 'OFFLINE']) {
    const env = setup({ account: paidAccount({ contractMode: mode,...(mode==='OFFLINE'?{canRequest:false,canPurchase:false}:{}), purchases: [purchase()], reservations: [{ id: 'r1', changeId: 'vc1', source: 'FREE', cycleSequence: 1, status: 'CONSUMED' }], ledger: [{ id: 'l1', type: 'CONSUME', source: 'FREE', cycleSequence: 1, changeId: 'vc1', recordedAt: '2026-10-16T01:00:00Z' }] }) });
    const page = env.page('records', { type: 'entitlements', orderId: 'o1' }); await page.reload();
    const view = renderPage('records', page.data);
    assert.match(view, /购买 sp1/); assert.match(view, /查看对应换车流程/); assert.match(view, /服务端次数流水/);
    if (mode === 'ESIGN') { assert.match(view, /免费可用/); assert.match(view, /选择目标车型加购/);assert.doesNotMatch(view,/创建800元/); }
    else assert.doesNotMatch(view, /固定800元|创建800元|提交换车申请/);
    await page.querySwapPurchase({ currentTarget: { dataset: { id: 'sp1' } } });
    page.openSwapPurchaseBill({ currentTarget: { dataset: { id: 'bill1' } } }); page.openSwapChange({ currentTarget: { dataset: { id: 'vc1' } } });
    assert.deepEqual(env.navigations, ['/pages/record/index?type=bills&id=bill1', '/pages/record/index?type=orderchanges&id=vc1']);
    assert.equal(env.calls.some(v => v.method === 'POST'), false);
  }
});
