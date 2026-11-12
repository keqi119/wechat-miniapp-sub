import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {NestFactory,APP_GUARD} from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {Db} from '../src/common/db';
import {Errors} from '../src/common/errors';
import {Access} from '../src/auth/access';
import {tokenHash} from '../src/auth/auth.service';
import {USAGE_CLOCK} from '../src/usage/rules';
import {OrderChangesService} from '../src/order-changes/service';
import {offlineSwapPreviewFixture,previewNow} from './offline-swap-preview-fixture';
import {OfflineSwapQuotePreviewController} from '../src/vehicle-changes/offline-quote-preview-controller';

test('real HTTP routes apply current staff/RBAC/CSRF/origin and strict preview binding without a database',async()=>{
 const f=offlineSwapPreviewFixture();
 const sessions=new Map([...f.staff].map(([id])=>[tokenHash('preview-'+id),{adminId:id,authVersion:1,csrfToken:'preview-csrf',expiresAt:new Date('2099-01-01')}]))
 const db:any={...f.tx,serial:async(fn:any)=>fn(f.tx),adminSession:{findUnique:async({where}:any)=>{const s=sessions.get(where.id);return s?{...s,admin:f.staff.get(s.adminId)}:null;}}};
 @Module({controllers:[OfflineSwapQuotePreviewController],providers:[{provide:Db,useValue:db},{provide:USAGE_CLOCK,useValue:()=>previewNow},OrderChangesService,{provide:APP_GUARD,useClass:Access}]}) class LocalModule{}
 const old=process.env.ADMIN_ORIGIN;process.env.ADMIN_ORIGIN='http://127.0.0.1:39999';
 const app=await NestFactory.create(LocalModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalFilters(new Errors());
 await app.listen(0,'127.0.0.1');
 try{
  const base=await app.getUrl(),path='/api/admin/order-changes/'+f.change.id+'/offline';
  const request=async(suffix:string,body?:any,actor='ops',options:{csrf?:string;origin?:string}={})=>{
   const response=await fetch(base+path+suffix,{method:body===undefined?'GET':'POST',headers:{cookie:'admin_session=preview-'+actor,'content-type':'application/json',origin:options.origin??process.env.ADMIN_ORIGIN!,'x-csrf-token':options.csrf??'preview-csrf'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json() as any};
  };
  let r=await request('/quote-preview',f.input);assert.equal(r.status,201,JSON.stringify(r.body));const preview=r.body;
  assert.equal((await request('/targets?page=3&pageSize=20&keyword=换入')).status,200);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);assert.equal(f.quotes.length,0);assert.equal(f.holds.length,0);
  for(const actor of ['finance','support','field']){assert.equal((await request('/quote-preview',f.input,actor)).status,403);assert.equal((await request('/targets',undefined,actor)).status,403);}
  assert.equal((await request('/quote-preview',f.input,'ops',{csrf:'wrong'})).body.error.code,'CSRF_DENIED');assert.equal((await request('/quote-preview',f.input,'ops',{origin:'https://untrusted.invalid'})).body.error.code,'ORIGIN_DENIED');
  assert.equal((await request('/quotes',{...f.input,idempotencyKey:'strict-route-once'})).status,400);
  assert.equal((await request('/quotes',{...f.input,idempotencyKey:'strict-route-once',previewHash:preview.previewHash,newMonthlyFeeAmount:1})).status,400);
  f.change.kind='DELIVERY_DELAY';assert.equal((await request('/quotes',{...f.input,idempotencyKey:'strict-kind-guard',previewHash:preview.previewHash})).body.error.code,'CHANGE_KIND');f.change.kind='VEHICLE_CHANGE';
  r=await request('/quotes',{...f.input,idempotencyKey:'strict-route-once',previewHash:preview.previewHash});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(f.quotes.length,1);assert.equal(f.holds.length,1);
  // The act command incremented Order itself, without falsely invalidating its own preview.
  const body={...f.input,idempotencyKey:'strict-route-once',previewHash:preview.previewHash};r=await request('/quotes',body);assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(f.quotes.length,1);
  f.staff.get('ops').active=false;assert.equal((await request('/quotes',body)).status,401);assert.equal(f.quotes.length,1);
 }finally{await app.close();if(old===undefined)delete process.env.ADMIN_ORIGIN;else process.env.ADMIN_ORIGIN=old;}
});
