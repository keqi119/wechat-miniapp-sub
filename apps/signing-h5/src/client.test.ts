import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, ApiError } from './client.ts';
test('GET always uses isolated same-origin cookie, not old portal or bearer', async () => {
  let observed: any;
  const api = new Client(async (url, init) => { observed = {url, init}; return new Response('{"items":[]}',{status:200,headers:{'Content-Type':'application/json'}}); });
  assert.deepEqual(await api.request('/records'), {items:[]});
  assert.equal(observed.url, '/miniapp-sign/api/records'); assert.equal(observed.init.credentials,'same-origin');
  assert.equal(observed.init.cache,'no-store'); assert.ok(observed.init.signal instanceof AbortSignal);
  assert.equal(new Headers(observed.init.headers).has('Authorization'), false);
});
test('POST sends in-memory CSRF; logout/expiry can clear it without localStorage', async () => {
  const headers: Headers[]=[]; const api = new Client(async (_url, init) => { headers.push(new Headers(init?.headers)); return new Response('{}'); });
  api.setCsrf('qa-csrf'); await api.request('/account/refresh',{}); api.clear(); await api.request('/auth/login',{});
  assert.equal(headers[0].get('X-CSRF-Token'),'qa-csrf'); assert.equal(headers[1].has('X-CSRF-Token'),false);
});
test('server Chinese error and code are preserved, never successful empty fallback', async () => {
  const api = new Client(async()=>new Response('{"code":"NOT_READY","message":"等待运营复核"}',{status:409}));
  await assert.rejects(api.request('/records'), (e:unknown)=>e instanceof ApiError && e.status===409&&e.code==='NOT_READY'&&e.message==='等待运营复核');
});
test('real API nested error envelope keeps SMS/provider rejection reason', async () => {
  const api=new Client(async()=>new Response('{"error":{"code":"SMS_UNAVAILABLE","message":"短信登录尚未配置完成"},"requestId":"qa-request"}',{status:503}));
  await assert.rejects(api.request('/auth/sms/request',{mobile:'13800000000'}),(e:unknown)=>e instanceof ApiError&&e.code==='SMS_UNAVAILABLE'&&e.message==='短信登录尚未配置完成');
});
test('offline, unexpected HTML, 401 and private cache are handled distinctly', async () => {
  const offline = new Client(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(offline.request('/records'), /暂时无法连接/);
  const html = new Client(async()=>new Response('<html>old portal</html>'));
  await assert.rejects(html.request('/records'), /响应格式/);
  const expired = new Client(async()=>new Response('{}',{status:401}));
  await assert.rejects(expired.request('/records'), (e:unknown)=>e instanceof ApiError&&e.status===401);
});
test('API client rejects absolute, traversal and old system paths', async () => {
  let requests=0; const api=new Client(async()=>{requests++;return new Response('{}');});
  for(const path of ['https://other.invalid/','//other.invalid','/../portal','/records/../../admin','/portal/auth/login']) await assert.rejects(api.request(path));
  assert.equal(requests,0);
});
