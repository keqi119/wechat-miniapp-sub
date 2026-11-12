const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.resolve(__dirname, '../src/utils/tab-navigation.js');

function setup() {
  assert.ok(fs.existsSync(modulePath), 'Directional main-tab navigation must be implemented');
  const { createTabNavigation } = require(modulePath);
  const calls = [], notices = [], pages = [];
  let time = 1000;
  const nav = createTabNavigation({
    switchTab: options => calls.push(options),
    showToast: options => notices.push(options),
    now: () => time,
  });
  function page(index) {
    const value = { data: {}, setData(patch) { Object.assign(this.data, patch); } };
    pages[index] = value;
    return value;
  }
  nav.onShow(page(0), 0);
  const arrive = (index, call = calls.at(-1), successFirst = false) => {
    if (successFirst) call.success();
    const target = pages[index] || page(index);
    nav.onShow(target, index);
    if (!successFirst) call.success();
    return target;
  };
  return { nav, calls, notices, pages, page, arrive, advance(ms) { time += ms; }, close() { pages.forEach(p => nav.onHide(p)); } };
}

test('a failed in-flight switch still fulfills the latest queued destination', () => {
  const env=setup();
  try {
    env.nav.request(1); const first=env.calls[0];
    env.nav.request(2); env.nav.request(3);
    first.fail({errMsg:'switchTab:fail'});
    assert.equal(env.calls.length,2);
    assert.equal(env.calls[1].url,'/pages/mine/index');
    assert.equal(env.nav.snapshot().selected,3);
    assert.equal(env.notices.length,0);
    env.arrive(3,env.calls[1]);
    first.success(); first.fail();
    assert.equal(env.nav.snapshot().active,3);
    assert.equal(env.nav.snapshot().selected,3);
    assert.equal(env.nav.snapshot().pending,false);
  } finally { env.close(); }
});

test('a queued return to the current page survives failure without a redundant route or error', () => {
  const env=setup();
  try {
    env.nav.request(1); const first=env.calls[0];
    env.nav.request(0); first.fail(); first.success();
    assert.equal(env.calls.length,1);
    assert.equal(env.nav.snapshot().selected,0);
    assert.equal(env.nav.snapshot().pending,false);
    assert.equal(env.notices.length,0);
    env.nav.request(2); env.arrive(2);
    assert.equal(env.nav.snapshot().active,2);
  } finally { env.close(); }
});

test('failure of the queued destination is reported once and remains retryable despite late callbacks', () => {
  const env=setup();
  try {
    env.nav.request(1); const first=env.calls[0];
    env.nav.request(3); first.fail();
    assert.equal(env.calls.length,2);
    const latest=env.calls[1]; latest.fail(); first.success(); first.fail();
    assert.equal(env.notices.length,1);
    assert.equal(env.nav.snapshot().active,0);
    assert.equal(env.nav.snapshot().selected,0);
    env.nav.request(3); env.arrive(3);
    latest.success(); latest.fail();
    assert.equal(env.nav.snapshot().selected,3);
    assert.equal(env.notices.length,1);
  } finally { env.close(); }
});

test('main navigation reaches the four real routes with direction matching the selected position', () => {
  const env = setup();
  try {
    for (const [index,url,motion] of [
      [1,'/pages/catalog/index','main-tab-from-right'],
      [3,'/pages/mine/index','main-tab-from-right'],
      [2,'/pages/use/index','main-tab-from-left'],
      [0,'/pages/home/index','main-tab-from-left'],
    ]) {
      env.nav.request(index);
      assert.equal(env.calls.at(-1).url,url);
      assert.equal(env.nav.snapshot().selected,index);
      const target=env.arrive(index);
      assert.equal(target.data.mainTabMotion,motion);
      assert.equal(env.nav.snapshot().active,index);
      assert.equal(env.nav.snapshot().pending,false);
    }
  } finally { env.close(); }
});

test('clicking the active destination updates only the local tap feedback, without reloading the page', () => {
  const env=setup();
  try {
    env.nav.request(0,{x:.2,y:.7});
    assert.equal(env.calls.length,0);
    assert.equal(env.pages[0].data.mainTabMotion,'');
    const first=env.nav.snapshot().feedback;
    assert.equal(first.index,0); assert.equal(first.x,.2); assert.equal(first.y,.7);
    env.nav.request(0);
    assert.ok(env.nav.snapshot().feedback.id>first.id);
    assert.equal(env.calls.length,0);
  } finally { env.close(); }
});

test('rapid taps serialize native switches and keep only the latest queued destination', () => {
  const env=setup();
  try {
    env.nav.request(1); const first=env.calls[0];
    env.nav.request(2); env.nav.request(3);
    assert.equal(env.calls.length,1);
    env.arrive(1,first);
    assert.equal(env.calls.length,2);
    assert.equal(env.calls[1].url,'/pages/mine/index');
    env.arrive(3);
    assert.equal(env.nav.snapshot().active,3);
    assert.equal(env.nav.snapshot().selected,3);
    assert.equal(env.nav.snapshot().pending,false);
  } finally { env.close(); }
});

test('a failed route restores the actual selected tab, gives feedback and permits retry', () => {
  const env=setup();
  try {
    env.nav.request(2); env.calls[0].fail();
    assert.equal(env.nav.snapshot().active,0);
    assert.equal(env.nav.snapshot().selected,0);
    assert.equal(env.nav.snapshot().pending,false);
    assert.equal(env.notices.length,1);
    env.nav.request(2); assert.equal(env.calls.length,2);
    env.arrive(2);
    assert.equal(env.nav.snapshot().active,2);
  } finally { env.close(); }
});

test('the SDK may report success before onShow without losing direction or starting a second route early', () => {
  const env=setup();
  try {
    env.nav.request(3); env.nav.request(1);
    env.calls[0].success();
    assert.equal(env.calls.length,1);
    const mine=env.page(3); env.nav.onShow(mine,3);
    assert.equal(mine.data.mainTabMotion,'main-tab-from-right');
    assert.equal(env.calls.length,2);
    const catalog=env.arrive(1,env.calls[1],true);
    assert.equal(catalog.data.mainTabMotion,'main-tab-from-left');
  } finally { env.close(); }
});

test('external navigation or returning from a detail synchronizes the selected page without replaying motion', () => {
  const env=setup();
  try {
    const mine=env.page(3); env.nav.onShow(mine,3);
    assert.equal(env.nav.snapshot().selected,3);
    assert.equal(mine.data.mainTabMotion,'');
    env.nav.request(0); const old=env.calls[0];
    const use=env.page(2); env.nav.onShow(use,2);
    old.success(); old.fail();
    assert.equal(env.nav.snapshot().selected,2);
    assert.equal(use.data.mainTabMotion,'');
    assert.equal(env.notices.length,0);
  } finally { env.close(); }
});

test('late callbacks cannot overwrite a later successful navigation', () => {
  const env=setup();
  try {
    env.nav.request(1); const first=env.calls[0]; env.arrive(1,first);
    env.nav.request(3); env.arrive(3);
    first.success(); first.fail();
    assert.equal(env.nav.snapshot().active,3);
    assert.equal(env.nav.snapshot().selected,3);
    assert.equal(env.notices.length,0);
  } finally { env.close(); }
});

test('invalid destinations and malformed tap coordinates cannot navigate outside the four tabs', () => {
  const env=setup();
  try {
    for (const value of [-1,4,NaN,'1','/pages/profile/index',null]) env.nav.request(value);
    assert.equal(env.calls.length,0);
    env.nav.request(0,{x:999,y:NaN});
    assert.equal(env.nav.snapshot().feedback.x,.5);
    assert.equal(env.nav.snapshot().feedback.y,.5);
  } finally { env.close(); }
});

test('only live custom tab components receive state and expired feedback is not replayed on return', () => {
  const env=setup(), seen=[];
  try {
    const unsubscribe=env.nav.subscribe(state=>seen.push(state.selected));
    env.nav.request(1); env.arrive(1);
    assert.equal(seen.at(-1),1);
    unsubscribe(); const length=seen.length;
    env.nav.request(3); env.arrive(3);
    assert.equal(seen.length,length);
    env.advance(181);
    assert.equal(env.nav.snapshot().feedback,null);
  } finally { env.close(); }
});
