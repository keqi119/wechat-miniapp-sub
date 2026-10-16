import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyToCents, can, ApiClient, ApiError, isPrivateField } from './core.ts';

test('decimal currency converts exactly to safe integer cents', () => {
  assert.equal(moneyToCents('0.29'), 29);
  assert.equal(moneyToCents('3980.50'), 398050);
  assert.equal(moneyToCents('0'), 0);
  for (const value of ['-1', '1.001', '1e3', 'NaN', '', '9007199254740992']) {
    assert.throws(() => moneyToCents(value));
  }
});
test('money outside the API signed-int range is rejected before submission', () => {
  assert.equal(moneyToCents('21474836.47'), 2147483647);
  assert.throws(() => moneyToCents('21474836.48'));
});
test('permissions fail closed and support server wildcard', () => {
  assert.equal(can([], 'vehicles.write'), false);
  assert.equal(can(['vehicles.read'], 'vehicles.write'), false);
  assert.equal(can(['*'], 'vehicles.write'), true);
});
test('unauthorized mutation never reaches the network', async () => {
  let calls = 0;
  const api = new ApiClient(async () => { calls++; return new Response('{}'); });
  api.setSession({ csrfToken: 'csrf', user: { id: '1', username: 'reader', permissions: [] } });
  await assert.rejects(api.request('/admin/vehicles', { method: 'POST', permission: 'vehicles.write', body: {} }), /权限/);
  assert.equal(calls, 0);
});
test('cookie credentials and CSRF accompany writes', async () => {
  let captured: RequestInit | undefined;
  const api = new ApiClient(async (_url, init) => { captured = init; return Response.json({ id: 'v1' }); });
  api.setSession({ csrfToken: 'csrf-value', user: { id: '1', username: 'ops', permissions: ['vehicles.write'] } });
  await api.request('/admin/vehicles', { method: 'POST', permission: 'vehicles.write', body: { title: '真实车辆' } });
  assert.equal(captured?.credentials, 'include');
  assert.equal(new Headers(captured?.headers).get('X-CSRF-Token'), 'csrf-value');
});
test('server conflict error retains message and request ID', async () => {
  const api = new ApiClient(async () => Response.json({ error: { code: 'VERSION_CONFLICT', message: '方案已更新' }, requestId: 'req-1' }, { status: 409 }));
  await assert.rejects(api.request('/admin/applications/1'), (error: unknown) => error instanceof ApiError && error.status === 409 && error.message === '方案已更新' && error.requestId === 'req-1');
});
test('session expiry clears memory and triggers reauthentication', async () => {
  let expired = false;
  const api = new ApiClient(async () => Response.json({ error: { code: 'UNAUTHORIZED', message: '登录已过期' } }, { status: 401 }));
  api.setSession({ csrfToken: 'x', user: { id: '1', username: 'a', permissions: ['*'] } });
  api.onExpired = () => { expired = true; };
  await assert.rejects(api.request('/admin/dashboard'));
  assert.equal(expired, true);
  assert.equal(api.session, null);
});
test('missing CSRF prevents writes even when a permission is available', async () => {
  let calls = 0;
  const api = new ApiClient(async () => { calls++; return Response.json({}); });
  api.setSession({ csrfToken: '', user: { id: '1', username: 'a', permissions: ['vehicles.write'] } });
  await assert.rejects(api.request('/admin/vehicles', { method: 'POST', permission: 'vehicles.write', body: {} }), /登录/);
  assert.equal(calls, 0);
});
test('non-JSON server responses never become fabricated success data', async () => {
  const api = new ApiClient(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
  await assert.rejects(api.request('/admin/vehicles'), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE' && error.status === 502);
});
test('network failures carry a useful offline message', async () => {
  const api = new ApiClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.request('/admin/vehicles'), /无法连接/);
});
test('custom API origin also controls authorized file links', () => {
  const api = new ApiClient(fetch, 'https://mini-api.subauto.keybox.cloud/api');
  assert.equal(api.fileUrl('file/one'), 'https://mini-api.subauto.keybox.cloud/api/admin/files/file%2Fone');
});
test('fetch is called without an incompatible ApiClient receiver', async () => {
  const api = new ApiClient(async function (this: unknown) { assert.equal(this, undefined); return Response.json({ status: 'ok' }); });
  assert.deepEqual(await api.request('/health'), { status: 'ok' });
});
test('anonymous initial session check does not claim that a session expired', async () => {
  let expired = false;
  const api = new ApiClient(async () => Response.json({ error: { code: 'UNAUTHENTICATED', message: '请登录后台' } }, { status: 401 }));
  api.onExpired = () => { expired = true; };
  await assert.rejects(api.request('/admin/auth/me'));
  assert.equal(expired, false);
});
test('detail rendering excludes encrypted identity and credentials while retaining business states', () => {
  for (const field of ['identityCiphertext', 'passwordHash', 'appSecret', 'privateKey', 'csrfToken', 'accessToken']) assert.equal(isPrivateField(field), true);
  for (const field of ['signatureStatus', 'realNameStatus', 'sourcePdfHash', 'planHash']) assert.equal(isPrivateField(field), false);
});

test('late old-account 401 cannot clear a newer login or notify its expiry', async () => {
  let finish!: (response: Response) => void, expired = 0;
  const api = new ApiClient(() => new Promise(resolve => { finish = resolve; }));
  const first = {csrfToken:'first',user:{id:'first',username:'first',permissions:['*']}};
  const second = {csrfToken:'second',user:{id:'second',username:'second',permissions:['*']}};
  api.setSession(first); api.onExpired = () => { expired++; };
  const pending = api.request('/admin/swap-credit-purchases');
  api.setSession(second); finish(Response.json({error:{code:'SESSION_EXPIRED',message:'旧会话失效'}},{status:401}));
  await assert.rejects(pending, (error: unknown) => error instanceof ApiError && error.code === 'SESSION_CHANGED');
  assert.equal(api.session, second); assert.equal(expired, 0);
});

test('late successful mutation cannot present success in a new account', async () => {
  let finish!: (response: Response) => void;
  const api = new ApiClient(() => new Promise(resolve => { finish = resolve; }));
  const session = {csrfToken:'first',user:{id:'first',username:'first',permissions:['*']}};
  api.setSession(session);
  const pending = api.request('/admin/refunds',{method:'POST',body:{}});
  api.setSession(null); api.setSession(session);
  finish(Response.json({id:'old-account-refund'}));
  await assert.rejects(pending, (error: unknown) => error instanceof ApiError && error.code === 'SESSION_CHANGED');
  assert.equal(api.session, session);
});

test('account change during delayed JSON parsing discards the old response', async () => {
  let finish!: (value: unknown) => void;
  const api = new ApiClient(async () => ({ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})}) as Response);
  api.setSession({csrfToken:'first',user:{id:'first',username:'first',permissions:['*']}});
  const pending = api.request('/admin/swap-credit-purchases');
  await Promise.resolve();
  api.setSession({csrfToken:'second',user:{id:'second',username:'second',permissions:['*']}});
  finish({items:[{id:'old-private-record'}]});
  await assert.rejects(pending, (error: unknown) => error instanceof ApiError && error.code === 'SESSION_CHANGED');
});
