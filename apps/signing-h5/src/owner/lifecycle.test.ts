import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnerClient } from './client.ts';
import { OwnerLifecycle } from './lifecycle.ts';

const session={mode:'PARTNER_READONLY',viewer:{maskedMobile:'138****0000'},scopes:[{ownerId:'p1',accessVersion:2}],csrfToken:'synthetic',expiresAt:'2099-01-01T00:00:00Z'};
test('bootstrap and return read config/legal/session/list only, never invoke verification or authority',async()=>{
 const seen:string[]=[];const api=new OwnerClient(async(url,init)=>{
  const path=String(url).replace('/owner/api','');seen.push(`${init?.method} ${path}`);
  const value=path==='/config'?{enabled:true,mode:'PARTNER_READONLY'}:path==='/legal'?{documents:[]}:path==='/auth/me'?session:[];
  return new Response(JSON.stringify({data:value}));
 });
 const lifecycle=new OwnerLifecycle(api);const state=await lifecycle.bootstrap();
 assert.equal(state.session?.viewer.maskedMobile,'138****0000');
 assert.deepEqual(seen,['GET /config','GET /legal','GET /auth/me','GET /owners']);
});
test('disabled config makes no session or business requests',async()=>{
 const seen:string[]=[];const lifecycle=new OwnerLifecycle(new OwnerClient(async(url)=>{seen.push(String(url));return new Response('{"data":{"enabled":false}}');}));
 assert.equal((await lifecycle.bootstrap()).config.enabled,false);assert.deepEqual(seen,['/owner/api/config']);
});
test('old session completion after expiry and login cannot populate fresh session state',async()=>{
 const lifecycle=new OwnerLifecycle(new OwnerClient());const old=lifecycle.ticket();lifecycle.clear();
 assert.equal(lifecycle.current(old),false);assert.equal(lifecycle.current(lifecycle.ticket()),true);
});
test('malformed session expiry never grants a visible authenticated state or reads enterprises',async()=>{
 const seen:string[]=[];const lifecycle=new OwnerLifecycle(new OwnerClient(async(url)=>{
  const path=String(url).replace('/owner/api','');seen.push(path);
  return new Response(JSON.stringify(path==='/config'?{enabled:true,mode:'PARTNER_READONLY'}:path==='/legal'?{documents:[]}:path==='/auth/me'?{...session,expiresAt:'invalid'}:[]));
 }));
 assert.equal((await lifecycle.bootstrap()).session,null);assert.equal(seen.includes('/owners'),false);
});

test('legacy Customer sessions cannot become portal viewers',async()=>{
 const lifecycle=new OwnerLifecycle(new OwnerClient(async url=>new Response(JSON.stringify(String(url).endsWith('/config')?{enabled:true,mode:'PARTNER_READONLY'}:String(url).endsWith('/legal')?{documents:[]}:String(url).endsWith('/auth/me')?{customer:{id:'old'},csrfToken:'old',expiresAt:'2099-01-01'}:[]))));
 assert.equal((await lifecycle.bootstrap()).session,null);
});
test('a list cannot add a new owner or revive a revoked access version',async()=>{
 const lifecycle=new OwnerLifecycle(new OwnerClient(async url=>new Response(JSON.stringify(String(url).endsWith('/config')?{enabled:true,mode:'PARTNER_READONLY'}:String(url).endsWith('/legal')?{documents:[]}:String(url).endsWith('/auth/me')?session:[{ownerId:'p1',accessVersion:1},{ownerId:'p2',accessVersion:2}]))));
 assert.deepEqual((await lifecycle.bootstrap()).owners,[]);
});

test('enterprise restore accepts explicit legal session without readonly scopes and scopes company list',async()=>{
 const legal={mode:'ELECTRONIC_LEGAL',sessionBinding:'binding',viewer:{maskedMobile:'138****0000'},owners:[{ownerId:'p1'}],csrfToken:'legal-csrf',expiresAt:'2099-01-01T00:00:00Z'};
 const lifecycle=new OwnerLifecycle(new OwnerClient(async url=>new Response(JSON.stringify(String(url).endsWith('/config')?{enabled:true,mode:'PARTNER_READONLY'}:String(url).endsWith('/legal')?{documents:[]}:String(url).endsWith('/auth/me')?legal:[{ownerId:'p1',name:'Synthetic company'},{ownerId:'unrelated'}]))));
 const result=await lifecycle.bootstrap();assert.equal(result.session?.mode,'ELECTRONIC_LEGAL');assert.deepEqual(result.owners.map(o=>o.ownerId),['p1']);
});
