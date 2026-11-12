import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerClient,OwnerApiError} from './client.ts';
test('portal permits scoped published reads and exact authentication writes',async()=>{
 const requests:{url:unknown;init?:RequestInit}[]=[];const api=new OwnerClient(async(url,init)=>{requests.push({url,init});return new Response('{"data":{"success":true}}');});
 for(const path of ['/config','/legal','/auth/me','/owners','/owners/p1','/owners/p1/workbench?page=1&pageSize=20','/owners/p1/orders/o1/workspace','/owners/p1/revenue-rules','/owners/p1/settlements'])assert.deepEqual(await api.request(path),{success:true});
 await api.request('/auth/sms/request',{mobile:'13800000000'});await api.request('/auth/login',{challengeId:'challenge-1'});api.setCsrf('memory-csrf');await api.request('/auth/logout',{});
 assert.equal(requests.at(-1)?.init?.method,'POST');assert.equal(new Headers(requests.at(-1)?.init?.headers).get('X-CSRF-Token'),'memory-csrf');assert.ok(requests.every(r=>r.init?.credentials==='same-origin'&&r.init.cache==='no-store'&&!new Headers(r.init.headers).has('Authorization')));
});
test('old signing, authority, feedback and account writes fail before transport',async()=>{
 let calls=0;const api=new OwnerClient(async()=>{calls++;return new Response('{}');});api.setCsrf('csrf');
 for(const path of ['/owners/claim','/owners/p1/verification','/owners/p1/refresh','/owners/p1/seal','/owners/p1/authorities','/owners/p1/authorities/a1/resume','/owners/p1/contracts/t1/sign','/owners/p1/handovers/t1/sync','/owners/p1/offline-archives/a1/feedback','/owners/p1/settlements/s1/feedback','/owners/p1/account'])await assert.rejects(api.request(path,{}),(e:unknown)=>e instanceof OwnerApiError&&e.code==='PARTNER_READ_ONLY');
 for(const path of ['/owners/p1/authorities','/owners/p1/contracts','/owners/p1/authority-options','/owners/p1/seals/s1/image','/owners/p1/contracts/t1/files/signed','/../admin','/owners/p1%2fadmin','/owners/p1/settlements?status=DRAFT','/owners/p1/workbench?pageSize=101','/owners/p1/vehicles?page=1&page=2'])await assert.rejects(api.request(path));
 await assert.rejects(api.request('/auth/logout'));await assert.rejects(api.request('/auth/logout',{anything:true}));await assert.rejects(api.request('/owners/p1',{}));assert.equal(calls,0);
});
test('published archive files are scoped and reject HTML',async()=>{
 const path='/owners/p1/offline-archives/a1/versions/v1/files/f1';const api=new OwnerClient(async()=>new Response('%PDF synthetic',{headers:{'Content-Type':'application/pdf'}}));assert.equal(await(await api.request<Blob>(path)).text(),'%PDF synthetic');const html=new OwnerClient(async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}));await assert.rejects(html.request(path),/文件响应异常/);
});
test('new session invalidates successful late responses',async()=>{
 let release!:(r:Response)=>void;const api=new OwnerClient(async()=>new Promise<Response>(resolve=>{release=resolve;}));api.setCsrf('old');const pending=api.request('/owners/p1');api.clear();api.setCsrf('new');release(new Response('{"data":{"name":"old private data"}}'));await assert.rejects(pending,(e:unknown)=>e instanceof OwnerApiError&&e.code==='STALE_RESPONSE');
});
test('access denial invalidates pending reads and notifies the active view',async()=>{
 let release!:(r:Response)=>void;const notices:number[]=[];const api=new OwnerClient(async url=>String(url).endsWith('/vehicles')?new Promise<Response>(resolve=>{release=resolve;}):new Response('{"error":{"code":"PARTNER_ACCESS_REVOKED","message":"授权已失效"}}',{status:403}));api.onAccessDenied(status=>notices.push(status));api.setCsrf('csrf');const pending=api.request('/owners/p1/vehicles');await assert.rejects(api.request('/owners/p1'));assert.deepEqual(notices,[403]);release(new Response('{"data":{"items":[{"name":"revoked"}]}}'));await assert.rejects(pending,/已变化/);
});
test('late denial cannot clear a fresh login or notify its view',async()=>{
 let release!:(r:Response)=>void;let count=0;const api=new OwnerClient(async()=>++count===1?new Promise<Response>(r=>{release=r;}):new Response('{}'));const notices:number[]=[];api.onAccessDenied(s=>notices.push(s));api.setCsrf('old');const old=api.request('/owners');api.clear();api.setCsrf('fresh');release(new Response('{}',{status:401}));await assert.rejects(old);assert.deepEqual(notices,[]);await api.request('/auth/logout',{});
});
