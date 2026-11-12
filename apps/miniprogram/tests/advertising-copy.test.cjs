const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const { subscriptionCopies, nextSubscriptionCopy } = require('../src/utils/subscription-copy');

const payload = (version = 2, title = '新文案，已发布。') => ({
  version, contentHash: String(version).repeat(64), publishedAt: '2026-11-10T01:00:00.000Z',
  items: subscriptionCopies.map(copy => ({ ...copy, lines: [...copy.lines], title })),
});
function client(request) {
  let reads = 0;
  const api = createApi(config, request, { getStorageSync() { reads++; return null; } });
  return { api, storageReads: () => reads };
}

test('advertising reads are anonymous, use a 4s timeout and preserve published text', async () => {
  const calls = [], expected = payload();
  const { api, storageReads } = client(options => { calls.push(options); options.success({ statusCode: 200, data: expected }); });
  assert.equal(typeof api.getAdvertisingCopy, 'function');
  const result = await api.getAdvertisingCopy();
  assert.deepEqual(result, expected);
  assert.equal(calls[0].url, config.apiBase + '/api/public/advertising-copy');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].timeout, 4000);
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(storageReads(), 0);
});

test('failed advertising reads preserve the last validated publication or the original approved bundle', async () => {
  let online = false;
  const { api } = client(options => online ? options.success({ statusCode: 200, data: payload() }) : options.fail({}));
  assert.equal(typeof api.getAdvertisingCopy, 'function');
  const initial = await api.getAdvertisingCopy();
  assert.equal(initial.version, 0);
  assert.deepEqual(initial.items, subscriptionCopies);
  online = true;
  await api.getAdvertisingCopy();
  online = false;
  const retained = await api.getAdvertisingCopy();
  assert.equal(retained.version, 2);
  assert.equal(retained.items[0].title, '新文案，已发布。');
});

test('an older delayed publication and changed hash for the same version cannot replace the latest snapshot', async () => {
  const calls = [];
  const { api } = client(options => calls.push(options));
  assert.equal(typeof api.getAdvertisingCopy, 'function');
  const old = api.getAdvertisingCopy(), latest = api.getAdvertisingCopy();
  calls[1].success({ statusCode: 200, data: payload(3, '最新，第三版。') });
  assert.equal((await latest).version, 3);
  calls[0].success({ statusCode: 200, data: payload(2, '旧的，第二版。') });
  assert.equal((await old).items[0].title, '最新，第三版。');
  const changed = api.getAdvertisingCopy();
  calls[2].success({ statusCode: 200, data: { ...payload(3, '同版，异常文字。'), contentHash: 'a'.repeat(64) } });
  assert.equal((await changed).items[0].title, '最新，第三版。');
});

test('malformed, oversized, reordered or draft-bearing responses do not poison the approved snapshot', async () => {
  let response = payload();
  const { api } = client(options => options.success({ statusCode: 200, data: response }));
  assert.equal(typeof api.getAdvertisingCopy, 'function');
  await api.getAdvertisingCopy();
  const invalid = [];
  let value = payload(3); value.items.pop(); invalid.push(value);
  value = payload(3); [value.items[0], value.items[1]] = [value.items[1], value.items[0]]; invalid.push(value);
  value = payload(3); value.items[0].title = '一二三四五六七八九十'; invalid.push(value);
  value = payload(3); value.items[0].lines[0] = '第一行\n冒入的第二行'; invalid.push(value);
  value = payload(3); value.items[0].catalogDescription = 'a'.repeat(41); invalid.push(value);
  value = payload(3); value.items[0].draft = true; invalid.push(value);
  value = payload(3); value.items[0].title = '<b>标题</b>'; invalid.push(value);
  value = payload(3); value.draft = { items: value.items }; invalid.push(value);
  value = payload(3); value.version = 3.5; invalid.push(value);
  value = payload(3); value.contentHash = 'wrong'; invalid.push(value);
  value = payload(3); value.publishedAt = 'not-a-date'; invalid.push(value);
  for (const malformed of invalid) {
    response = malformed;
    assert.equal((await api.getAdvertisingCopy()).version, 2);
  }
});

test('an unresponsive advertising transport times out without blocking page content forever', { timeout: 7000 }, async () => {
  const { api } = client(() => {});
  assert.equal(typeof api.getAdvertisingCopy, 'function');
  assert.equal((await api.getAdvertisingCopy()).version, 0);
});

test('rotation consumes the published pool rather than substituting bundled copy', () => {
  const published = payload().items;
  const next = nextSubscriptionCopy(published[0].id, published);
  assert.equal(next.title, '新文案，已发布。');
  assert.notEqual(next.id, published[0].id);
});

test('the public advertising reader module is included as native source', () => {
  assert.ok(fs.existsSync(path.resolve(__dirname, '../src/services/advertising-copy.js')));
});
