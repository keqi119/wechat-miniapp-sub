const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sourceRoot = path.resolve(process.env.MINIAPP_SOURCE_ROOT || process.env.MINIAPP_SOURCE_DIR || path.join(__dirname, '../src'));
const { contractRecord, phases } = require('./fixtures/customer-contract-page.cjs');
async function setup(record = contractRecord()) {
  let definition, current = record, queryFailure;
  const calls = [], dialogs = [], files = [], navigations = [];
  const platform = { showModal(value) { dialogs.push(value); value.success?.({ confirm: true }); }, showToast(value) { dialogs.push(value); }, setNavigationBarTitle() {} };
  const services = {
    renewalSessionStamp: () => "same-test-customer-session",
    async getRecord(type, id) { calls.push(['get', type, id]); return structuredClone(current); },
    async getSignStatus(id, kind) { calls.push(['query', id, kind]); if (queryFailure) throw queryFailure; current = contractRecord('WAITING_OWNER'); return { status: 'PENDING' }; },
    async performAction(type, id, action) { calls.push(['action', type, id, action]); return { message: '请在签署页自行核对。' }; },
    async openPrivateFile(id) { files.push(id); },
  };
  const helpers = { ...require(path.join(sourceRoot, 'utils/page')), confirm: async (title, content) => { dialogs.push({ title, content }); return true; }, go: url => navigations.push(url), toastError: error => dialogs.push({ content: error.message }) };
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'pages/record/index.js'), 'utf8'), { Page: value => definition = value, wx: platform, require: name => name.includes('/services/') ? services : name.includes('/utils/page') ? helpers : require(path.resolve(sourceRoot, 'pages/record', name)) });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  page.setData({ type: 'contracts', id: record.id }); await page.reload();
  return { page, calls, dialogs, files, navigations, set: value => current = value, failQuery: () => queryFailure = Error('查询超时，请核对原交易') };
}
const event = action => ({ currentTarget: { dataset: { action } } });
test('all known contract phases use dedicated projection without querying during load', async () => {
  for (const [phase, text] of Object.entries(phases)) {
    const env = await setup(contractRecord(phase));
    assert.equal(env.page.data.contract?.available, true, phase);
    assert.equal(env.page.data.contract.phaseText, text);
    assert.equal(env.page.data.contract.summaryRows[0].value, '¥0.01');
    assert.equal(env.page.data.contract.summaryRows[1].value, '¥0.00');
    assert.equal(env.calls.length, 1);
  }
});
test('numeric and missing template versions retain valid projection and never invent a version', async () => {
  for (const version of [3, null]) {
    const env = await setup(contractRecord('ARCHIVED', { templateVersion: version }));
    assert.equal(env.page.data.contract?.available, true);
    assert.equal(env.page.data.contract.templateVersion, version === null ? '' : String(version));
  }
});
test('customer trusted SIGNED and waiting-owner phases never grant re-sign even with contradictory capabilities', async () => {
  for (const phase of ['WAITING_OWNER', 'VERIFYING', 'ARCHIVING', 'ARCHIVED', 'REJECTED', 'EXPIRED', 'CANCELLED']) {
    const env = await setup(contractRecord(phase, { canSign: true, primaryAction: { id: 'sign', label: '错误重签' } }));
    assert.notEqual(env.page.data.contract?.primaryAction?.id, 'sign');
    await env.page.act(event('sign'));
    assert.equal(env.calls.some(call => call[0] === 'action'), false);
  }
  const record = contractRecord(); record.contractDetail.parties[0].status = 'SIGNED';
  const env = await setup(record); await env.page.contractAction(event('sign'));
  assert.equal(env.calls.some(call => call[0] === 'action'), false);
});
test('missing, unknown, mismatched or malformed contract DTO closes all generic signing and file actions', async () => {
  for (const alter of [r => delete r.contractDetail, r => r.contractDetail.version = 2, r => r.contractDetail.phase = 'NEW_PHASE', r => r.contractDetail.kind = 'UNKNOWN_KIND', r => { r.status = 'UNKNOWN'; r.contractDetail.status = 'UNKNOWN'; }, r => r.contractDetail.contractId = 'other', r => r.contractDetail.status = 'DRAFT', r => r.contractDetail.progress = [null], r => r.contractDetail.primaryAction = { id: 'pay', label: '错误支付' }]) {
    const record = contractRecord(); alter(record); const env = await setup(record);
    assert.equal(env.page.data.contract?.available, false);
    await env.page.act(event('sign')); await env.page.openDocument({ currentTarget: { dataset: { id: 'forged-file' } } });
    assert.equal(env.calls.some(call => call[0] === 'action'), false); assert.equal(env.files.length, 0);
  }
});
test('explicit query awaits original signing result then rereads projection and preserves persistent phase', async () => {
  const env = await setup(contractRecord('VERIFYING')); await env.page.contractAction(event('query'));
  assert.deepEqual(env.calls.map(call => call[0]), ['get', 'query', 'get']);
  assert.deepEqual(env.calls[1], ['query', 'offline-contract', 'contract']);
  assert.equal(env.page.data.contract.phase, 'WAITING_OWNER'); assert.equal(env.page.data.message, '');
  assert.ok(env.dialogs.at(-1)?.content); assert.equal(env.page.data.busy, false);
});
test('query failure rereads saved projection and gives floating feedback without changing business phase', async () => {
  const env = await setup(contractRecord('VERIFYING')); env.failQuery(); await env.page.refreshContract();
  assert.deepEqual(env.calls.map(call => call[0]), ['get', 'query', 'get']);
  assert.equal(env.page.data.contract.phase, 'VERIFYING'); assert.equal(env.page.data.message, '');
  assert.match(env.dialogs.at(-1)?.content || '', /查询超时/);
});
test('legacy platform refresh never reaches the old query path that can dispatch signing', async () => {
  const record = contractRecord('VERIFYING'); record.contractDetail.parties[1].role = 'PLATFORM';
  const env = await setup(record); await env.page.refreshContract();
  assert.deepEqual(env.calls.map(call => call[0]), ['get', 'get']);
  assert.equal(env.page.data.contract.canQuery, false);
});
test('sign and protected files use only validated contract actions and documents', async () => {
  const env = await setup(); await env.page.contractAction(event('sign'));
  assert.deepEqual(env.calls.filter(call => call[0] === 'action'), [['action', 'contracts', 'offline-contract', 'sign']]);
  await env.page.openContractDocument({ currentTarget: { dataset: { id: 'offline-source' } } });
  await env.page.openContractDocument({ currentTarget: { dataset: { id: 'forged-file' } } });
  assert.deepEqual(env.files, ['offline-source']); assert.equal(env.page.data.message, '');
});
test('amendment remains in the original change flow and non-contract record keeps generic action', async () => {
  const env = await setup(contractRecord('READY_TO_SIGN', { kind: 'AMENDMENT' }));
  await env.page.contractAction(event('sign')); assert.equal(env.calls.some(call => call[0] === 'action'), false);
  env.page.openOrderChanges(); assert.deepEqual(env.navigations, ['/pages/records/index?type=orderchanges']);
  env.set({ id: 'bill1', status: 'PENDING', actions: [{ id: 'pay', label: '支付' }] }); env.page.setData({ type: 'bills', id: 'bill1' }); await env.page.reload();
  assert.equal(env.page.data.contract, null); await env.page.act(event('pay'));
  assert.equal(env.calls.some(call => call[0] === 'action' && call[1] === 'bills'), true);
});
if (process.env.MINIAPP_CONTRACT_DTO_FIXTURE) test('actual server-produced synthetic DTOs retain phase, fees and action capabilities', async () => {
  const fixture = JSON.parse(fs.readFileSync(process.env.MINIAPP_CONTRACT_DTO_FIXTURE, 'utf8'));
  assert.equal(fixture.synthetic, true);
  for (const record of Object.values(fixture.records || { record: fixture.record })) {
    const env = await setup(record);
    assert.equal(env.page.data.contract.available, true);
    assert.equal(env.page.data.contract.phase, record.contractDetail.phase);
    assert.deepEqual(JSON.parse(JSON.stringify(env.page.data.contract.summaryRows)), record.contractDetail.summaryRows);
    assert.equal(env.page.data.contract.canSign, record.contractDetail.canSign);
    assert.equal(env.page.data.contract.canQuery, record.contractDetail.canQuery);
    assert.equal(env.calls.length, 1);
  }
});
module.exports = { setup };
