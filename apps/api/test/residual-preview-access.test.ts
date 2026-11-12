import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as routes from '../src/auth/residual-preview-access';
import {Access} from '../src/auth/access';

test('only exact residual POST preview routes use read permission and leave every mutation to normal write authorization',()=>{
 const allow=routes.residualPreviewAllowed;
 for(const resource of ['residual-imports','residual-curves','residual-forecasts']){
  for(const role of ['ADMIN','OPERATIONS','FINANCE'])assert.equal(allow(role,`/admin/${resource}/preview`,'POST'),true);
  for(const role of ['SUPPORT','FIELD','UNKNOWN'])assert.equal(allow(role,`/admin/${resource}/preview`,'POST'),false);
  for(const suffix of ['', '/id','/id/preview','/preview/activate','/preview/files'])assert.equal(allow('FINANCE',`/admin/${resource}${suffix}`,'POST'),null);
  for(const method of ['GET','PATCH','DELETE','PUT'])assert.equal(allow('FINANCE',`/admin/${resource}/preview`,method),null);
 }
 for(const path of ['/admin/vehicle-valuations/preview','/admin/residual-observations/preview','/admin/vehicles/id/residual-preview','/customer/residual-curves/preview','/admin/residual-curves/preview/'])assert.equal(allow('FINANCE',path,'POST'),null);
});

test('Access grants finance calculation only after session, origin and CSRF, and still rejects all financial writes',async t=>{
 const old=process.env.ADMIN_ORIGIN;process.env.ADMIN_ORIGIN='http://localhost:3100';t.after(()=>{if(old===undefined)delete process.env.ADMIN_ORIGIN;else process.env.ADMIN_ORIGIN=old;});
 let active=true,authVersion=1;
 const access=new Access({adminSession:{findUnique:async()=>({expiresAt:new Date(Date.now()+60000),authVersion:1,csrfToken:'synthetic-csrf',admin:{id:'synthetic-finance',role:'FINANCE',active,authVersion}})}} as any);
 async function call(path='/api/admin/residual-curves/preview',patch:any={}){
  const request:any={path,method:'POST',cookies:{admin_session:'synthetic-cookie'},headers:{origin:'http://localhost:3100','x-csrf-token':'synthetic-csrf'},...patch};
  return access.canActivate({switchToHttp:()=>({getRequest:()=>request,getResponse:()=>({setHeader(){}})})} as any);
 }
 const code=(name:string)=>(e:any)=>e.getResponse?.().error?.code===name;
 assert.equal(await call(),true);
 await assert.rejects(call('/api/admin/residual-curves'),code('FORBIDDEN'));
 await assert.rejects(call('/api/admin/residual-curves/id/activate'),code('FORBIDDEN'));
 await assert.rejects(call(undefined,{headers:{origin:'http://localhost:3100'}}),code('CSRF_DENIED'));
 await assert.rejects(call(undefined,{headers:{origin:'https://untrusted.invalid','x-csrf-token':'synthetic-csrf'}}),code('ORIGIN_DENIED'));
 await assert.rejects(call(undefined,{cookies:{}}),code('UNAUTHENTICATED'));
 active=false;await assert.rejects(call(),code('SESSION_EXPIRED'));active=true;authVersion=2;await assert.rejects(call(),code('SESSION_EXPIRED'));
});
