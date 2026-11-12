const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module');
const source = path.resolve(__dirname, '../src'), config = require('../src/config');
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);
function setup(extra = {}) {
  let stored = { token: 'token-a', customer: { id: 'a' } };
  const redirects = [], navigations = [];
  const wx = { getStorageSync: () => stored, redirectTo: options => redirects.push(options.url), navigateTo: options => navigations.push(options.url), setNavigationBarTitle() {}, showToast() {}, showModal: options => options.success({ confirm: true }), stopPullDownRefresh() {} };
  const services = { getContext: () => ({ customer: stored?.customer, authenticated: !!stored?.token, profile: {} }),
    getAdvertisingCopy: async () => ({ version: 1, items: require('../src/utils/subscription-copy').subscriptionCopies }), ...extra };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(source, 'utils/page.js'), 'utf8'), { module, exports: module.exports, require: createRequire(path.join(source, 'utils/page.js')), wx });
  const utils = module.exports;
  function page(name) {
    const file = path.join(source, 'pages', name, 'index.js'), actualRequire = createRequire(file); let definition;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx, setTimeout, clearTimeout, clearInterval,
      require: id => id.includes('services') ? services : id === '../../utils/page' ? utils : actualRequire(id) });
    return { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  }
  return { utils, services, page, redirects, navigations, rotate(value) { stored = value; } };
}
const renderers = new Map();
function renderedText(name, data) {
  if (!renderers.has(name)) {
    const file = 'pages/' + name + '/index.wxml', code = require('miniprogram-compiler').wxmlToJs(source, { wxmlList: [file], maxBuffer: 16 * 1024 * 1024 });
    renderers.set(name, vm.runInNewContext('(function(global){' + code + '})({})', { window: {}, console })(file));
  }
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : (node.children || []).map(text).join('');
  return text(renderers.get(name)(data));
}
function plain(data = {}) { return { data: { loading: true, error: '', record: null, items: [], busy: false, ...data }, setData(value) { Object.assign(this.data, value); } }; }

for (const name of ['home','catalog']) for (const returnPath of ['navigateBack', 'switchTab']) test(returnPath + ' '+name+' onShow removes old public cards until revalidated and retains a valid unavailable vehicle', async () => {
  let reads = 0, held; const key=name==='home'?'vehicles':'items',response=rows=>({[key]:rows,brands:[],context:{}});
  const read=async()=>{reads++;return held?held.promise:response([{id:'withdrawn',name:'合成旧商品车辆',available:true}]);};
  const e=setup({getVehicles:read,getHome:read}),p=e.page(name);
  await p.refresh();assert.match(renderedText(name,p.data),/合成旧商品车辆/);
  held=deferred();p.onShow();await tick();
  assert.equal(reads,2);assert.equal(p.data.loading,true);assert.equal(p.data[key].length,0);
  assert.doesNotMatch(renderedText(name,p.data),/合成旧商品车辆/);
  p.openVehicle({currentTarget:{dataset:{id:'withdrawn'}}});assert.deepEqual(e.navigations,[]);
  held.resolve(response([{id:'current',name:'合成有效暂不可申请车辆',available:false}]));await tick();
  assert.match(renderedText(name,p.data),/合成有效暂不可申请车辆/);
  p.openVehicle({currentTarget:{dataset:{id:'withdrawn'}}});assert.deepEqual(e.navigations,[]);
  p.openVehicle({currentTarget:{dataset:{id:'current'}}});assert.deepEqual(e.navigations,['/pages/vehicle/index?vehicleId=current']);
});

for(const name of ['home','catalog'])test(name+' failed public revalidation cannot restore old cards or navigate by an old id',async()=>{
 const key=name==='home'?'vehicles':'items',response=rows=>({[key]:rows,brands:[],context:{}});let pending;
 const read=()=>pending?pending.promise:Promise.resolve(response([{id:'withdrawn',name:'合成旧商品车辆',available:true}]));
 const e=setup({getVehicles:read,getHome:read}),p=e.page(name);await p.refresh();pending=deferred();const refresh=p.refresh();
 pending.reject(Error('合成目录读取失败'));await refresh;
 assert.equal(p.data[key].length,0);assert.match(p.data.error,/目录读取失败/);assert.doesNotMatch(renderedText(name,p.data),/合成旧商品车辆/);
 p.openVehicle({currentTarget:{dataset:{id:'withdrawn'}}});assert.deepEqual(e.navigations,[]);
});

for(const name of ['home','catalog'])test(name+' older directory response cannot repopulate a newer empty catalog',async()=>{
 const key=name==='home'?'vehicles':'items',response=rows=>({[key]:rows,brands:[],context:{}}),pending=[];
 const read=()=>new Promise(resolve=>pending.push(resolve)),e=setup({getVehicles:read,getHome:read}),p=e.page(name);
 const old=p.refresh(),latest=p.refresh();pending[1](response([]));await latest;
 pending[0](response([{id:'withdrawn',name:'合成旧商品车辆',available:true}]));await old;
 assert.equal(p.data[key].length,0);assert.doesNotMatch(renderedText(name,p.data),/合成旧商品车辆/);
 p.openVehicle({currentTarget:{dataset:{id:'withdrawn'}}});assert.deepEqual(e.navigations,[]);
});

test('first load blocks, repeated explicit reload still reads, and latest business actions stay busy during refresh', async () => {
  const e = setup(), p = plain(), first = deferred(); const initial = e.utils.load(p, () => first.promise);
  assert.equal(p.data.loading, true); first.resolve({ record: { id: 'one' } }); await initial;
  const second = deferred(), read = e.utils.load(p, () => second.promise);
  assert.equal(p.data.loading, false); assert.equal(p.data.record.id, 'one'); assert.equal(p.data.busy, true);
  second.resolve({ record: { id: 'two' } }); await read;
  assert.equal(p.data.record.id, 'two'); assert.equal(p.data.busy, false);
});

test('load never releases a pre-existing business busy state', async () => {
  const e = setup(), p = plain(); await e.utils.load(p, async () => ({ record: { id: 'one' } }));
  p.data.busy = true; await e.utils.load(p, async () => ({ record: { id: 'two' } })); assert.equal(p.data.busy, true);
});

test('real sign onLoad then foreground onShow releases its own superseded read lease after status settles', async () => {
  const initial = deferred(); let configs = 0, initialRead;
  const e = setup({ getSigningTask: () => ({ title: '合成历史流程', status: 'PENDING', url: '' }), getSigningConfig: () => ++configs === 1 ? initial.promise : Promise.resolve({ enabled: true, signProviderConfigured: true }), getSigningBusinessContext: async () => ({ offline: false }), getSignStatus: async () => ({ status: 'PENDING' }) }), p = e.page('sign');
  const reload = p.reload; p.reload = function () { return initialRead = reload.call(this); };
  p.onLoad({ kind: 'contract', id: 'synthetic' }); assert.equal(p.data.busy, true);
  await p.onShow(); assert.equal(p.data.status, 'PENDING');
  initial.resolve({ enabled: true, signProviderConfigured: true }); assert.equal(await initialRead, null);
  assert.equal(p.data.busy, false, 'foreground invalidation must not strand the read-owned guard');
});

test('an obsolete refresh cannot release the current read busy lease or return stale data to callers', async () => {
  const e = setup(), p = plain(), old = deferred(), next = deferred(); await e.utils.load(p, async () => ({ record: { id: 'initial' } }));
  const a = e.utils.load(p, () => old.promise), b = e.utils.load(p, () => next.promise);
  old.resolve({ record: { id: 'old' } }); assert.equal(await a, null); assert.equal(p.data.busy, true); assert.equal(p.data.record.id, 'initial');
  next.resolve({ record: { id: 'latest' } }); await b; assert.equal(p.data.busy, false); assert.equal(p.data.record.id, 'latest');
});

test('same-customer token rotation clears prior private content and expanded state before another first load', async () => {
  const e = setup(), p = plain({ usage: null, swap: null, settlement: null, purchase: null, contract: null, showOrderTerms: false });
  await e.utils.load(p, async () => ({ record: { id: 'old' }, usage: {}, swap: {}, settlement: {}, purchase: {}, contract: {}, showOrderTerms: true }));
  e.rotate({ token: 'new-token', customer: { id: 'a' } }); const pending = deferred(), read = e.utils.load(p, () => pending.promise);
  assert.equal(p.data.loading, true); for (const key of ['record', 'usage', 'swap', 'settlement', 'purchase', 'contract']) assert.equal(p.data[key], null, key);
  assert.equal(p.data.showOrderTerms, false); pending.resolve({ record: { id: 'new' } }); await read;
});

for (const swallowed of [false, true]) test('401 clears derived private state even when a page swallows an optional failure: ' + swallowed, async () => {
  const e = setup(), p = plain({ usage: null, swap: null, settlement: null, purchase: null, contract: null });
  await e.utils.load(p, async () => ({ record: { id: 'old' }, usage: {}, swap: {}, settlement: {}, purchase: {}, contract: {} }));
  const result = await e.utils.load(p, async () => { e.rotate(null); if (!swallowed) throw Object.assign(new Error('登录失效'), { statusCode: 401 }); return { record: { id: 'must-not-return' } }; });
  assert.equal(result, null); assert.equal(p.data.authRequired, true); assert.equal(p.data.busy, false);
  for (const key of ['record', 'usage', 'swap', 'settlement', 'purchase', 'contract']) assert.equal(p.data[key], null, key);
});

test('late prior-session 401 cannot clear the new account or release its active refresh', async () => {
  const e = setup(), p = plain(), old = deferred(), next = deferred(); await e.utils.load(p, async () => ({ record: { id: 'a' } }));
  const a = e.utils.load(p, () => old.promise); e.rotate({ token: 'b', customer: { id: 'b' } }); const b = e.utils.load(p, () => next.promise);
  old.reject(Object.assign(new Error('old expired'), { statusCode: 401 })); assert.equal(await a, null); assert.equal(p.data.busy, true); assert.equal(p.data.authRequired, false);
  next.resolve({ record: { id: 'b' } }); await b; assert.equal(p.data.record.id, 'b');
});

test('unloaded page neither repaints nor returns a delayed successful result', async () => {
  const e = setup(), p = plain(), pending = deferred(), read = e.utils.load(p, () => pending.promise);
  p._disposed = true; const snapshot = structuredClone(p.data); pending.resolve({ record: { id: 'late' } });
  assert.equal(await read, null); assert.deepEqual(structuredClone(p.data), snapshot);
});

test('application detail keeps expanded content on return but invalidates consent and applies fresh plan state', async () => {
  let pending;
  const e = setup({ getApplication: async () => pending ? pending.promise : { id: 'a', status: 'AWAITING_CONFIRMATION' }, getCreditReview: async () => ({ document: { id: 'd' } }) }), p = e.page('application-detail'); p.applicationId = 'a';
  await p.refresh(); p.setData({ showPlanDetails: true, showCreditDetails: true, showLessorDetails: true, showRejectForm: true, planRead: true, ownerSharingAccepted: true, creditAccepted: true });
  pending = deferred(); const read = p.refresh();
  assert.equal(p.data.showPlanDetails, true); assert.equal(p.data.showCreditDetails, true); assert.equal(p.data.showLessorDetails, true); assert.equal(p.data.showRejectForm, true); assert.ok(p.data.creditReview);
  assert.equal(p.data.planRead, false); assert.equal(p.data.ownerSharingAccepted, false); assert.equal(p.data.creditAccepted, false);
  pending.resolve({ id: 'a', status: 'REJECTED' }); await read; assert.equal(p.data.application.status, 'REJECTED'); assert.equal(p.data.busy, false);
});

test('entitlements return keeps usage and settlement sections until latest eligibility replaces them', async () => {
  let pending;
  const e = setup({ getRecords: async () => [], getUsageAccount: async () => pending ? pending.promise : { products: [{ id: 'pack' }], canPurchase: true, returnSettlement: { id: 's' } }, getSwapAccount: async () => ({ contractMode: 'OFFLINE' }), getReturnSettlement: async () => ({ id: 's' }) }), p = e.page('records'); p.setData({ type: 'entitlements' }); p.orderId = 'o';
  await p.reload(); p.setData({ purchaseAccepted: true, swapPurchaseAccepted: true }); pending = deferred(); const read = p.reload();
  assert.ok(p.data.usage); assert.ok(p.data.swap); assert.equal(p.data.settlement.id, 's'); assert.equal(p.data.loading, false); assert.equal(p.data.purchaseAccepted, false);
  pending.resolve({ products: [], canPurchase: false }); await read; assert.equal(p.data.usage.canPurchase, false); assert.equal(p.data.settlement, null);
});

test('mileage keeps selected form mounted during return then clears old input when its revision changes', async () => {
  let pending; const period = { id: 'p', revision: 1, canSubmit: true, segmented: false, segments: [], effectiveEndDate: '2026-11-01' };
  const e = setup({ getDashboard: async () => ({ subscription: { id: 'o' } }), getUsageAccount: async () => pending ? pending.promise : { periods: [period] } }), p = e.page('mileage'); p.orderId = 'o'; p.requestedPeriodId = 'p';
  await p.reload(); p.setData({ reading: '123', attachments: [{ id: 'file' }] }); pending = deferred(); const read = p.reload();
  assert.equal(p.data.selectedPeriod.id, 'p'); assert.equal(p.data.reading, '123'); assert.ok(p.data.usage);
  pending.resolve({ periods: [{ ...period, revision: 2 }] }); await read; assert.equal(p.data.reading, ''); assert.equal(p.data.attachments.length, 0);
});

test('mileage account change clears the previous submission receipt even when both accounts have no selected period', async () => {
  const e = setup({ getDashboard: async () => ({ subscription: { id: 'o' } }), getUsageAccount: async () => ({ periods: [] }) }), p = e.page('mileage');
  await p.reload(); p.setData({ submitted: { id: 'old-private-receipt' } });
  e.rotate({ token: 'token-b', customer: { id: 'b' } }); await p.reload();
  assert.equal(p.data.submitted, null);
});

test('record return preserves expanded order terms while awaiting the current record', async () => {
  let pending; const e = setup({ getRecord: async () => pending ? pending.promise : { id: 'o', status: 'ACTIVE' } }), p = e.page('record'); p.setData({ type: 'orders', id: 'o' });
  await p.reload(); p.setData({ showOrderTerms: true }); pending = deferred(); const read = p.reload();
  assert.equal(p.data.showOrderTerms, true); assert.ok(p.data.order); assert.equal(p.data.loading, false);
  pending.resolve({ id: 'o', status: 'CLOSED' }); await read; assert.equal(p.data.record.status, 'CLOSED');
});

test('actual record action is blocked during a background read and its own busy guard survives a concurrent failed refresh', async () => {
  let nextRead = null, actions = 0; const action = deferred(), record = { id: 'r', actions: [{ id: 'acknowledge', label: '合成确认' }] };
  const e = setup({ getRecord: async () => nextRead ? nextRead.promise : record, performAction: async () => { actions++; return action.promise; } }), p = e.page('record'); p.setData({ type: 'notifications', id: 'r' });
  await p.reload(); nextRead = deferred(); const background = p.reload();
  await p.act({ currentTarget: { dataset: { action: 'acknowledge' } } }); assert.equal(actions, 0);
  nextRead.resolve(record); await background; nextRead = null;
  const submitting = p.act({ currentTarget: { dataset: { action: 'acknowledge' } } }); await tick(); assert.equal(actions, 1); assert.equal(p.data.busy, true);
  nextRead = deferred(); const refresh = p.reload(); nextRead.reject(new Error('暂不可读')); await refresh;
  assert.equal(p.data.busy, true, 'only the actual action may release its guard');
  nextRead = null; action.resolve({ record, message: '合成结果' }); await submitting; assert.equal(p.data.busy, false);
});

test('actual record onUnload prevents a pending reload from repainting the departed page', async () => {
  const pending = deferred(), e = setup({ getRecord: () => pending.promise }), p = e.page('record'); p.setData({ type: 'notifications', id: 'r' });
  const read = p.reload(); p.onUnload(); const snapshot = structuredClone(p.data); pending.resolve({ id: 'r', title: '迟到内容' });
  assert.equal(await read, null); assert.deepEqual(structuredClone(p.data), snapshot);
});

for (const invalidation of ['unload', 'session', 'newer-read']) test('late OFFLINE record does not redirect after ' + invalidation, async () => {
  let pending = deferred(); const e = setup({ getRecord: () => pending.promise }), p = e.page('record'); p.setData({ type: 'orders', id: 'o' });
  const old = pending, read = p.reload();
  if (invalidation === 'unload') p.onUnload();
  else if (invalidation === 'session') e.rotate({ token: 'b', customer: { id: 'b' } });
  else { pending = deferred(); const latest = p.reload(); pending.resolve({ id: 'o', status: 'ACTIVE' }); await latest; }
  old.resolve({ id: 'o', contractMode: 'OFFLINE' }); assert.equal(await read, null); assert.deepEqual(e.redirects, []);
});

test('current OFFLINE record still redirects to its own order detail after the response is accepted', async () => {
  const e = setup({ getRecord: async () => ({ id: 'o', contractMode: 'OFFLINE' }) }), p = e.page('record'); p.setData({ type: 'orders', id: 'o' });
  await p.reload(); assert.deepEqual(e.redirects, ['/pages/order-detail/index?id=o']); assert.equal(p.data.record, null);
});

