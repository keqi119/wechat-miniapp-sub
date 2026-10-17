const { test } = require('node:test'), assert = require('node:assert/strict');
const { createApi } = require('../src/services/api'), config = require('../src/config');
const nativeConfig = { mode: 'MINIAPP_WEBVIEW', enabled: true, signProviderConfigured: true, providerHosts: ['textapi17.fadada.com', 'realnameverify16.fadada.com'], returnUrl: 'https://mini-api.subauto.keybox.cloud/api/public/esign-return', faceBridgeConfigured: false, faceBridgeAllowlist: [] };
const privacy = { id: 'privacy1', type: 'privacy', version: 2, title: '合成隐私政策', content: '合成当前实名信息处理说明' };
const identity = { name: '合成客户', idCardNo: '110101199001010000', consent: { accepted: true, documentId: privacy.id, version: privacy.version } };
function setup(extra = {}) {
  let signing = extra.config || nativeConfig, status = extra.status || { status: 'PENDING' }, failure = null;
  const calls = [], navigations = [], storage = new Map([[config.storageKey, { token: 'synthetic', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' } }]]);
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast() {}, navigateBack() {}, navigateTo: v => { navigations.push(v.url); v.success?.({}); }, setClipboardData() { throw Error('No H5 clipboard fallback'); }, navigateToMiniProgram() { throw Error('Missing face allowlist must never navigate'); }, request(v) {
    calls.push(v); const route = v.url.replace(/^https:\/\/[^/]+\/api/, '');
    if (extra.intercept?.(route, v)) return;
    if (failure) return v.success({ statusCode: failure, data: { error: { code: 'STATE_CONFLICT', message: '合成失败' } } });
    let data;
    if (route === '/public/signing-config') data = signing;
    else if (route === '/public/legal/privacy') data = privacy;
    else if (route === '/customer/esign/register') data = { registrationStatus: 'REGISTERED' };
    else if (route === '/customer/auth/logout') data = { success: true };
    else if (route === '/customer/esign/verify') data = extra.verify || { status: 'PENDING', url: 'https://realnameverify16.fadada.com/current?opaque=synthetic' };
    else if (route === '/customer/esign/readiness' || route === '/customer/esign/refresh') data = { readyForSigning: status.status === 'VERIFIED', certBound: status.status === 'VERIFIED' };
    else if (route.endsWith('/sign')) data = extra.sign || { taskId: 'task1', status: 'PENDING', url: 'https://textapi17.fadada.com/api2/sign?opaque=synthetic' };
    else if (route.endsWith('/sign-status')) data = status;
    else if (extra.route) data = extra.route(route, v);
    else throw Error('Unexpected route ' + route);
    v.success({ statusCode: 200, data });
  } };
  return { api: createApi(config, v => wx.request(v), wx), calls, navigations, storage, wx, configure: v => { signing = v; }, status: v => { status = v; }, fail: v => { failure = v; } };
}
function page(env, name = 'sign', options = { kind: 'contract', id: 'ct1' }) {
  global.wx = env.wx; let definition; global.Page = v => { definition = v; };
  const servicePath = require.resolve('../src/services/index'); require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: env.api };
  for (const file of ['../src/' + (name === 'middle' ? 'pagesFace/pages/middle/middle' : 'pages/' + name + '/index')]) { try { delete require.cache[require.resolve(file)]; } catch {} }
  require('../src/' + (name === 'middle' ? 'pagesFace/pages/middle/middle' : 'pages/' + name + '/index'));
  const p = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } }; p.onLoad?.(options); return p;
}
test('encoded owner navigation opens the same cached task and reads its authoritative status', async () => {
  for (const kind of ['owner-identity', 'owner-authority', 'owner-revoke', 'owner-contract']) {
    const providerHost = kind === 'owner-identity' ? 'realnameverify16.fadada.com' : 'textapi17.fadada.com';
    const env = setup({ route: (route, request) => {
      if (request.method === 'POST') return { id: 'grant', url: 'https://' + providerHost + '/synthetic' };
      if (route === '/customer/owners/enterprise') return { readyForSigning: false };
      if (route.endsWith('/authorities')) return [{ id: 'grant', status: 'PENDING' }];
      if (route.endsWith('/contracts/document')) return { status: 'READY' };
      throw Error('Unexpected owner route ' + route);
    } });
    const recordId = kind === 'owner-contract' ? 'document' : kind === 'owner-revoke' ? 'grant' : null;
    await env.api.startOwnerSigning(kind, 'enterprise', recordId, {});
    // WeChat passes the encoded query value to onLoad, as observed in DevTools.
    const options = Object.fromEntries(env.navigations[0].split('?')[1].split('&').map(pair => pair.split('=')));
    const p = page(env, 'sign', options); await p.reload(); await p.onShow();
    assert.equal(p.data.status, 'PENDING', kind + ': ' + p.data.statusError);
    assert.equal(p.id, 'enterprise:' + (recordId || (kind === 'owner-authority' ? 'grant' : 'new')));
    assert.match(p.data.url, new RegExp('^https://' + providerHost.replaceAll('.', '\\.')));
    assert.equal(env.calls.filter(v => v.method === 'POST').length, 1);
    assert.equal(p.data.statusError, '');
  }
});
test('raw owner context remains supported and malformed encoded context fails closed', async () => {
  const env = setup({ route: () => ({ readyForSigning: false }) });
  const raw = page(env, 'sign', { kind: 'owner-identity', id: 'enterprise:new' }); await raw.reload(); await raw.onShow();
  assert.equal(raw.id, 'enterprise:new'); assert.equal(raw.data.status, 'PENDING');
  const count = env.calls.length;
  for (const id of ['enterprise%ZZnew', { invalid: true }]) {
    const p = page(env, 'sign', { kind: 'owner-identity', id }); await p.reload(); await p.onShow();
    assert.equal(p.id, ''); assert.equal(p.data.url, ''); assert.ok(p.data.error);
  }
  assert.equal(env.calls.length, count);
});
test('explicit native contract and handover starts POST the correct routes then keep supplier URL only in memory', async () => {
  for (const [type, kind, id] of [['contracts', 'contract', 'ct1'], ['handovers', 'handover', 'h1']]) { const env = setup(); const result = await env.api.performAction(type, id, 'sign'); assert.equal(result.status, 'PENDING'); const post = env.calls.find(v => v.method === 'POST'); assert.ok(post.url.endsWith('/customer/' + type + '/' + id + '/sign')); assert.ok(env.navigations[0].startsWith('/pages/sign/index?kind=' + kind)); assert.match(env.api.getSigningTask(kind, id).url, /^https:\/\/textapi17/); const saved = JSON.stringify([...env.storage.values()]); assert.equal(saved.includes('opaque='), false); assert.equal(saved.includes('task1'), false); }
});
test('disabled, missing provider config or wrong mode stops before any supplier side effect and has no clipboard fallback', async () => {
  for (const value of [{ ...nativeConfig, enabled: false }, { ...nativeConfig, signProviderConfigured: false }, { ...nativeConfig, providerHosts: [] }, { mode: 'SERVICE_ACCOUNT_H5', enabled: true, entryUrl: 'https://app.subauto.keybox.cloud/miniapp-sign/' }]) { const env = setup({ config: value }); await assert.rejects(env.api.performAction('contracts', 'ct1', 'sign')); await assert.rejects(env.api.startESignVerification(identity)); assert.equal(env.calls.some(v => v.method === 'POST'), false); assert.equal(env.navigations.length, 0); }
});
test('realname requires a separate current privacy choice before register/verify and never persists identity or short URL', async () => {
  const env = setup(); for (const input of [{ ...identity, consent: undefined }, { ...identity, consent: { ...identity.consent, accepted: false } }, { ...identity, consent: { ...identity.consent, version: 1 } }]) await assert.rejects(env.api.startESignVerification(input)); assert.equal(env.calls.some(v => v.method === 'POST'), false); await env.api.startESignVerification(identity); assert.deepEqual(env.calls.filter(v => v.method === 'POST').map(v => v.url.split('/').pop()), ['register', 'verify']); assert.deepEqual(env.calls.at(-1).data, identity); const saved = JSON.stringify([...env.storage.values()]); assert.equal(saved.includes(identity.idCardNo), false); assert.equal(saved.includes('realnameverify16'), false);
});
test('readiness is GET-only on readback and certificate refresh is a separate explicit POST gated by native config', async () => {
  const env = setup(); await env.api.getESignReadiness(); assert.equal(env.calls.at(-1).method, 'GET'); await env.api.refreshESignReadiness(); assert.ok(env.calls.some(v => v.method === 'POST' && v.url.endsWith('/esign/refresh'))); env.configure({ ...nativeConfig, enabled: false }); const count = env.calls.filter(v => v.method === 'POST').length; await assert.rejects(env.api.refreshESignReadiness()); assert.equal(env.calls.filter(v => v.method === 'POST').length, count); await env.api.getSignStatus('c1', 'identity'); assert.equal(env.calls.at(-1).method, 'GET');
});
test('unapproved URL, pending without entry, unknown kind and other customer identity are rejected without unsafe navigation', async () => {
  for (const result of [{ taskId: 'task1', status: 'PENDING' }, { taskId: 'task1', status: 'PENDING', url: 'https://evil.test/sign' }, { taskId: 'task1', status: 'PENDING', url: 'https://textapi17.fadada.com:443/sign' }]) { const env = setup({ sign: result }); await assert.rejects(env.api.performAction('contracts', 'ct1', 'sign')); assert.equal(env.navigations.length, 0); }
  const env = setup(); assert.throws(() => env.api.getSigningTask('other', 'ct1')); assert.throws(() => env.api.getSigningTask('identity', 'other')); assert.equal(env.calls.length, 0);
});
test('legacy sensitive cache is purged, cold recovery reads server status only and logout clears in-memory URL', async () => {
  const env = setup(); env.storage.set(config.storageKey + ':pending', { kind: 'contract', id: 'ct1', task: { url: 'https://old.test/private' } }); env.api.purgeLegacySigningCache(); assert.equal(env.storage.has(config.storageKey + ':pending'), false); await env.api.performAction('contracts', 'ct1', 'sign'); const count = env.calls.filter(v => v.method === 'POST').length; await env.api.resumeSigning(); assert.equal(env.calls.filter(v => v.method === 'POST').length, count); await env.api.logout(); assert.throws(() => env.api.getSigningTask('contract', 'ct1')); assert.equal(env.storage.has(config.storageKey + ':pending'), false);
});
test('missing trusted face configuration refuses the official middle route without ever using untrusted appId/callback', async () => {
  const env = setup(); await env.api.performAction('contracts', 'ct1', 'sign'); assert.throws(() => env.api.prepareFaceBridge({ bizToken: 'synthetic', miniProgramAppId: 'wx0123456789abcdef', miniProgramPath: 'pages/face/index', miniProgramCallBackUrl: encodeURIComponent('https://textapi17.fadada.com/other') }), { code: 'FACE_CONTEXT' });
});
test('webview page opens the current in-memory URL and ignores forged message completion, clearing entry only after archived server SIGNED', async () => {
  const env = setup(); await env.api.performAction('contracts', 'ct1', 'sign'); const p = page(env); await p.reload(); assert.match(p.data.url, /^https:\/\/textapi17/); await p.onWebMessage({ detail: { data: [{ status: 'SIGNED', signedFileId: 'forged' }] } }); assert.equal(p.data.status, 'PENDING'); assert.ok(p.data.url); env.status({ status: 'SIGNED' }); await p.refreshStatus(); assert.equal(p.data.status, 'UNKNOWN'); env.status({ status: 'SIGNED', signedFileId: 'archive1' }); await p.refreshStatus(); assert.equal(p.data.status, 'SIGNED'); assert.equal(p.data.url, ''); env.fail(409); await p.refreshStatus(); assert.equal(p.data.status, 'UNKNOWN');
});
test('cold signing page never automatically creates a task; arbitrary reload callback and wrong kind are refused', async () => {
  const env = setup(), p = page(env); await p.reload(); await p.onShow(); assert.equal(p.data.url, ''); assert.equal(env.calls.some(v => v.method === 'POST'), false); const other = page(env, 'sign', { kind: 'unknown', id: 'ct1' }); await other.reload(); assert.ok(other.data.error); const count = env.calls.length; await other.onShow(); assert.equal(env.calls.length, count);
  await env.api.performAction('contracts', 'ct1', 'sign'); assert.throws(() => env.api.reloadSigningPage('contract', 'ct1', 'https://textapi17.fadada.com/other'), { code: 'SIGN_RETURN' });
});
test('middle page is explicitly unavailable without trusted flow and never accepts injected four parameters', async () => {
  const env = setup(); await env.api.performAction('contracts', 'ct1', 'sign'); const p = page(env, 'middle', { bizToken: 'synthetic', miniProgramAppId: 'wx0123456789abcdef', miniProgramPath: 'pages/face/index', miniProgramCallBackUrl: encodeURIComponent('https://evil.test/') }); assert.equal(p.data.ready, false); assert.match(p.data.error, /尚未核实|已过期/); await p.startFace(); assert.equal(env.calls.filter(v => v.method === 'POST').length, 1);
});
test('settings starts with empty identity and separate unchecked consent, then submits the displayed privacy version only on click', async () => {
  const env = setup(), p = page(env, 'settings', {}); assert.equal(p.data.identityName, ''); assert.equal(p.data.idCardNo, ''); assert.equal(p.data.identityAccepted, false); p.setData({ authenticated: true, consentCurrent: true, legalDocuments: [privacy], identityName: identity.name, idCardNo: identity.idCardNo }); await p.verifyIdentity(); assert.equal(env.calls.some(v => v.method === 'POST'), false); p.onIdentityConsent({ detail: { value: ['identity'] } }); await p.verifyIdentity(); assert.equal(env.calls.filter(v => v.method === 'POST').length, 2); assert.equal(p.data.idCardNo, ''); assert.equal(p.data.identityName, ''); assert.equal(p.data.identityAccepted, false);
});
test('all three native kinds query their own authoritative status and 403/409/5xx never leave an old signed label', async () => {
  const raw = { id: 'dc1', orderId: 'o1', kind: 'DELIVERY_DELAY', status: 'AWAITING_SIGNATURE', revision: 8, reason: '合成延期', quote: { id: 'q1', revision: 1, commercialHash: 'a'.repeat(64), newStartDate: '2026-11-16', newEndDate: '2026-12-15', months: 1, expiresAt: '2099-01-01T00:00:00Z', periods: [{ sequence: 1, startDate: '2026-11-16', endDate: '2026-12-16', dueDate: '2026-11-10', amount: 519900, originalAmount: 519900, netPaidAmount: 0, carryAmount: 0, chargeAmount: 519900, refundAmount: 0, calculationBasis: '合成明确金额' }], reason: '合成协商', settlementExplanation: '合成核对', handoverArrangement: '合成预约', cancellationTerms: '合成处理', document: { id: 'legal1', type: 'delivery-delay-amendment', version: 1, hash: 'b'.repeat(64), content: '合成已填完整条款' } }, contract: { id: 'am1', status: 'PENDING', signedFileId: null }, finance: { obligations: [], refunds: [], blockers: [] }, canSign: true, canSync: true, blockers: [] };
  for (const [kind, id] of [['contract', 'ct1'], ['handover', 'h1'], ['order-change', 'dc1']]) { const env = setup({ route: route => route === '/customer/order-changes/dc1' || route.endsWith('/sync') ? raw : undefined }); if (kind === 'order-change') await env.api.signOrderChange(id, { revision: 8 }); else await env.api.performAction(kind === 'contract' ? 'contracts' : 'handovers', id, 'sign'); const p = page(env, 'sign', { kind, id }); await p.reload(); await p.onShow(); assert.equal(p.data.status, 'PENDING'); const q = env.calls.find(v => v.url.endsWith(kind === 'order-change' ? '/dc1/sync' : '/' + id + '/sign-status')); assert.ok(q); if (kind === 'order-change') assert.equal(q.data.revision, 8); for (const code of [403, 409, 503]) { p.setData({ status: 'SIGNED' }); env.fail(code); await p.onShow(); assert.equal(p.data.status, 'UNKNOWN'); } }
});
test('foreground and cold memory recovery never auto-register, refresh certificates or re-create a signing task', async () => {
  const env = setup(); await env.api.performAction('contracts', 'ct1', 'sign'); const servicePath = require.resolve('../src/services/index'); require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: env.api }; let app; global.App = v => { app = v; }; delete require.cache[require.resolve('../src/app')]; require('../src/app'); const instance = { ...app }; instance.onLaunch(); const posts = env.calls.filter(v => v.method === 'POST').length; await instance.onShow(); assert.equal(env.calls.filter(v => v.method === 'POST').length, posts); assert.ok(env.calls.at(-1).url.endsWith('/contracts/ct1/sign-status'));
  const second = createApi(config, v => env.wx.request(v), env.wx); assert.equal(second.getSigningTask('contract', 'ct1').url, ''); await second.resumeSigning(); assert.equal(env.calls.filter(v => v.method === 'POST').length, posts);
});
test('ephemeral signing URL expires locally and session ownership changes cannot recover the prior customer entry', async () => {
  const env = setup(); await env.api.performAction('contracts', 'ct1', 'sign'); const originalNow = Date.now; try { Date.now = () => originalNow() + 11 * 60000; assert.equal(env.api.getSigningTask('contract', 'ct1').url, ''); } finally { Date.now = originalNow; } await env.api.performAction('contracts', 'ct1', 'sign'); const s = env.storage.get(config.storageKey); env.storage.set(config.storageKey, { ...s, customer: { id: 'other' } }); assert.equal(env.api.getSigningTask('contract', 'ct1').url, '');
});
test('late sign or verify replies cannot bind an old customer URL after logout, customer change or same-customer token rotation', async () => {
  for (const kind of ['contract', 'identity']) for (const next of [{ id: 'other' }, { id: 'c1' }, null]) {
    let delayed; const env = setup({ intercept: (route, v) => { if (route.endsWith(kind === 'identity' ? '/verify' : '/sign')) { delayed = v; return true; } } });
    const pending = kind === 'identity' ? env.api.startESignVerification(identity) : env.api.performAction('contracts', 'ct1', 'sign'); const rejected = assert.rejects(pending, e => ['SESSION_CHANGED', 'SIGN_SESSION_CHANGED'].includes(e.code)); await new Promise(setImmediate); assert.ok(delayed);
    env.api.clearSigningState(); if (!next) env.storage.delete(config.storageKey); else env.storage.set(config.storageKey, { token: 'rotated-token', expiresAt: '2099-01-01T00:00:00Z', customer: next });
    delayed.success({ statusCode: 200, data: { taskId: 'old-task', status: 'PENDING', url: kind === 'identity' ? 'https://realnameverify16.fadada.com/old' : 'https://textapi17.fadada.com/old' } }); await rejected; assert.equal(env.navigations.length, 0); assert.equal(env.storage.has(config.storageKey + ':pending'), false);
  }
});
test('a session switch during public configuration cannot submit the old identity to the new account', async () => {
  let delayed; const env = setup({ intercept: (route, v) => { if (route === '/public/signing-config') { delayed = v; return true; } } }); const pending = env.api.startESignVerification(identity); const rejected = assert.rejects(pending, { code: 'SIGN_SESSION_CHANGED' }); await new Promise(setImmediate); env.storage.set(config.storageKey, { token: 'new-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'other' } }); delayed.success({ statusCode: 200, data: nativeConfig }); await rejected; assert.equal(env.calls.some(v => v.method === 'POST'), false);
});
test('an old cleared request cannot release the busy lease of a replacement request', async () => {
  const waiting = []; const env = setup({ intercept: (route, v) => { if (route.endsWith('/sign')) { waiting.push(v); return true; } } }); const first = env.api.performAction('contracts', 'ct1', 'sign'); const rejected = assert.rejects(first); await new Promise(setImmediate); env.api.clearSigningState(); env.storage.set(config.storageKey, { token: 'new-token', expiresAt: '2099-01-01T00:00:00Z', customer: { id: 'c1' } }); const second = env.api.performAction('contracts', 'ct1', 'sign'); await new Promise(setImmediate); waiting[0].success({ statusCode: 200, data: { taskId: 'old', status: 'PENDING', url: 'https://textapi17.fadada.com/old' } }); await rejected; await assert.rejects(env.api.performAction('contracts', 'ct1', 'sign'), { code: 'SIGN_BUSY' }); assert.equal(waiting.length, 2); waiting[1].success({ statusCode: 200, data: { taskId: 'new', status: 'PENDING', url: 'https://textapi17.fadada.com/new' } }); await second; assert.equal(env.api.getSigningTask('contract', 'ct1').taskId, 'new');
});
test('late entry reload cannot resurrect a short URL after authoritative signed status', async () => {
  let deferConfig = false; const waiting = []; const env = setup({ intercept: (route, v) => { if (deferConfig && route === '/public/signing-config') { waiting.push(v); return true; } } }); await env.api.performAction('contracts', 'ct1', 'sign'); deferConfig = true; const p = page(env); const reload = p.reload(); await new Promise(setImmediate); env.status({ status: 'SIGNED', signedFileId: 'archive1' }); await p.refreshStatus(); assert.equal(p.data.url, ''); for (const v of waiting) v.success({ statusCode: 200, data: nativeConfig }); await reload; assert.equal(p.data.url, ''); assert.equal(p.data.status, 'SIGNED');
});
test('a reload begun during a pending status query cannot overwrite its eventual verified result', async () => {
  let delay = false; const waiting = []; const env = setup({ intercept: (route, v) => { if (delay && (route === '/public/signing-config' || route.endsWith('/sign-status'))) { waiting.push({ route, v }); return true; } } }); await env.api.performAction('contracts', 'ct1', 'sign'); const p = page(env); await p.reload(); delay = true; const query = p.refreshStatus(); const reload = p.reload(); await new Promise(setImmediate); waiting.find(v => v.route.endsWith('/sign-status')).v.success({ statusCode: 200, data: { status: 'SIGNED', signedFileId: 'archive1' } }); await query; waiting.find(v => v.route === '/public/signing-config').v.success({ statusCode: 200, data: nativeConfig }); await reload; assert.equal(p.data.status, 'SIGNED'); assert.equal(p.data.url, '');
});
test('unloaded signing page ignores both delayed configuration and authoritative status responses', async () => {
  const waiting = []; const env = setup({ intercept: (route, v) => { if (route === '/public/signing-config' || route.endsWith('/sign-status')) { waiting.push({ route, v }); return true; } } }); const p = page(env); const query = p.refreshStatus(); await new Promise(setImmediate); p.onUnload?.(); const snapshot = structuredClone(p.data); for (const { route, v } of waiting) v.success({ statusCode: 200, data: route.endsWith('/sign-status') ? { status: 'SIGNED', signedFileId: 'archive1' } : nativeConfig }); await query; await new Promise(setImmediate); assert.deepEqual(p.data, snapshot);
});
module.exports = { setup, page, nativeConfig, privacy, identity };
