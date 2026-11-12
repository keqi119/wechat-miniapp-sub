const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function setup(name) {
  let definition, fail = false, stops = 0, copyCalls = 0;
  let publication = require('../src/utils/subscription-copy').subscriptionCopies;
  const calls = [];
  global.wx = { getStorageSync: () => null, stopPullDownRefresh: () => { stops++; } };
  const service = {
    async getAdvertisingCopy() { copyCalls++; return { version: 2, items: publication }; },
    async getHome() {
      if (fail) throw new Error('本地测试网络失败');
      return { vehicles: [], context: {}, nextAction: null };
    },
    async getVehicles(params) {
      calls.push(params);
      if (fail) throw new Error('本地测试网络失败');
      return { items: [], brands: ['蔚来'] };
    },
  };
  const file = path.resolve(__dirname, '../src/pages/' + name + '/index.js');
  const pageRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; }, wx: global.wx,
    require: id => id === '../../services/index' ? service : pageRequire(id),
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  return { page, calls, fail: () => { fail = true; }, stops: () => stops, copyCalls: () => copyCalls,
    setPublication: title => { publication = publication.map(copy => ({ ...copy, title, lines: [...copy.lines] })); } };
}

for (const name of ['home', 'catalog']) {
  test(name + ' uses the newly published pool on entry and again after returning', async () => {
    const { page, setPublication, copyCalls } = setup(name);
    setPublication('后台，第一版。');
    await page.onShow();
    assert.equal(page.data.heroCopy.title, '后台，第一版。');
    const previousId = page.data.heroCopy.id;
    setPublication('后台，第二版。');
    await page.onShow();
    assert.equal(page.data.heroCopy.title, '后台，第二版。');
    assert.notEqual(page.data.heroCopy.id, previousId);
    assert.equal(copyCalls(), 2);
  });

  test(name + ' changes the complete copy on every show and refresh', async () => {
    const { page } = setup(name);
    assert.ok(page.data.heroCopy?.id, 'page needs a complete initial copy');
    const { subscriptionCopies } = require('../src/utils/subscription-copy');
    let previous = page.data.heroCopy.id;
    for (const method of ['onShow', 'refresh', 'onShow', 'refresh']) {
      await page[method]();
      assert.notEqual(page.data.heroCopy.id, previous);
      assert.deepEqual(page.data.heroCopy, subscriptionCopies.find(copy => copy.id === page.data.heroCopy.id));
      assert.equal(page.data.error, '');
      previous = page.data.heroCopy.id;
    }
  });

  test(name + ' enables pull refresh and stops the indicator after success or failure', async () => {
    const { page, fail, stops } = setup(name);
    const config = require('../src/pages/' + name + '/index.json');
    assert.equal(config.enablePullDownRefresh, true);
    assert.equal(typeof page.onPullDownRefresh, 'function');
    const initialId = page.data.heroCopy.id;
    await page.onPullDownRefresh();
    assert.notEqual(page.data.heroCopy.id, initialId);
    assert.equal(stops(), 1);
    fail();
    const previousId = page.data.heroCopy.id;
    await page.onPullDownRefresh();
    assert.notEqual(page.data.heroCopy.id, previousId);
    assert.equal(stops(), 2);
    assert.equal(page.data.loading, false);
    assert.equal(page.data.error, '本地测试网络失败');
    assert.deepEqual(Array.from(page.data[name === 'home' ? 'vehicles' : 'items']), []);
  });
}

test('catalog searches and filters preserve the copy and request parameters', async () => {
  const { page, calls, copyCalls } = setup('catalog');
  await page.onShow();
  assert.ok(page.data.heroCopy);
  const current = page.data.heroCopy;
  page.onQuery({ detail: { value: ' ET5 ' } });
  await page.search();
  assert.equal(page.data.heroCopy, current);
  assert.equal(calls.at(-1).query, 'ET5');
  await page.selectBrand({ currentTarget: { dataset: { brand: '蔚来' } } });
  assert.equal(page.data.heroCopy, current);
  assert.equal(calls.at(-1).brand, '蔚来');
  await page.clearFilters();
  assert.equal(page.data.heroCopy, current);
  assert.equal(calls.at(-1).brand, '');
  assert.equal(calls.at(-1).query, '');
  assert.equal(copyCalls(), 1, 'filtering does not fetch or replace advertising copy');
});

test('selector excludes the current group at both random boundaries', () => {
  const file = path.resolve(__dirname, '../src/utils/subscription-copy.js');
  assert.ok(fs.existsSync(file), 'shared subscription copy selector is required');
  for (const randomValue of [0, 0.9999999999999999]) {
    const context = { module: { exports: {} }, Math: { floor: Math.floor, random: () => randomValue } };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
    const { subscriptionCopies, nextSubscriptionCopy } = context.module.exports;
    assert.equal(subscriptionCopies.length, 12);
    assert.equal(new Set(subscriptionCopies.map(copy => copy.id)).size, 12);
    for (const copy of subscriptionCopies) {
      const selected = nextSubscriptionCopy(copy.id);
      assert.notEqual(selected.id, copy.id);
      assert.ok(subscriptionCopies.includes(selected), 'title and descriptions remain one group');
      assert.ok(copy.title.length <= 9, 'headline must fit the existing card');
      assert.equal(copy.lines.length, 2);
      assert.ok(copy.lines.every(line => line.length > 0));
      assert.ok(copy.catalogDescription.length > 0);
    }
    assert.ok(subscriptionCopies.includes(nextSubscriptionCopy('outdated-id')));
  }
});
