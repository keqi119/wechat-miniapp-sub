import '../src/common/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';

test('saved drafts stay private and a real published revision reaches both native page controllers and templates',async()=>{
 const db=new Db(),source=resolve(__dirname,'../../miniprogram/src'),miniRequire=createRequire(resolve(source,'services/api.js'));
 const original=await db.advertisingCopySet.findUniqueOrThrow({where:{id:'discovery'}});
 let app:any,actorId:string|undefined;
 try{
  const actor=await db.adminUser.create({data:{username:randomUUID(),name:'广告词客户端合成验收',role:'OPERATIONS',passwordHash:'synthetic-not-used'}});actorId=actor.id;
  const token=randomUUID(),csrf=randomUUID();
  await db.adminSession.create({data:{id:tokenHash(token),adminId:actor.id,authVersion:actor.authVersion,csrfToken:csrf,expiresAt:new Date(Date.now()+600000)}});
  app=await createApp({db});const base=await listenForHttpTests(app),origin=process.env.ADMIN_ORIGIN?.split(',')[0]||'http://localhost:3100';
  async function admin(path='',method='GET',body?:unknown){const response=await fetch(base+'/api/admin/advertising-copy'+path,{method,headers:{Origin:origin,Cookie:'admin_session='+token,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert(response.ok,await response.clone().text());return response.json() as Promise<any>;}
  const platform={getStorageSync:()=>null},calls:string[]=[];
  const client=miniRequire('./api.js').createApi({apiBase:'https://ads-e2e.invalid',storageKey:'synthetic-ads'},(options:any)=>{
   const pathname=new URL(options.url).pathname;assert.equal(pathname,'/api/public/advertising-copy');assert.equal(options.header.Authorization,undefined);calls.push(pathname);
   fetch(base+pathname).then(async response=>options.success({statusCode:response.status,data:await response.json()})).catch(options.fail);
  },platform);
  const initial=await client.getAdvertisingCopy(),detail=await admin();
  const items=detail.draft.items.map((copy:any)=>({...copy,title:'后台发布文案。',lines:['这组内容来自已发布版本。','草稿不会提前出现在小程序。'],catalogDescription:'后台已发布，选车页同步读取。'}));
  const saved=await admin('/draft','PATCH',{revision:detail.revision,items,idempotencyKey:randomUUID()});
  assert.deepEqual((await client.getAdvertisingCopy()).items,initial.items);
  const published=await admin('/publish','POST',{revision:saved.revision,draftHash:saved.draftHash,idempotencyKey:randomUUID()});
  assert.equal((await client.getAdvertisingCopy()).version,published.version);
  (globalThis as any).wx=platform;
  const services={...client,getHome:async()=>({vehicles:[],context:{}}),getVehicles:async()=>({items:[],brands:[]})};
  for(const name of ['home','catalog']){
   const file=resolve(source,'pages',name,'index.js'),pageRequire=createRequire(file);let definition:any;
   vm.runInNewContext(readFileSync(file,'utf8'),{Page:(value:any)=>{definition=value;},wx:platform,setTimeout,clearTimeout,clearInterval,require:(id:string)=>id==='../../services/index'?services:pageRequire(id)});
   const page={...definition,data:structuredClone(definition.data),setData(value:any){Object.assign(this.data,value);}};
   await page.onShow();assert.equal(page.data.error,'');assert.equal(page.data.heroCopy.title,'后台发布文案。');
   const wxml='pages/'+name+'/index.wxml',compiler=miniRequire('miniprogram-compiler');
   const generated=vm.runInNewContext('(function(global){'+compiler.wxmlToJs(source,{wxmlList:[wxml],maxBuffer:16*1024*1024})+'})({})',{window:{},console});
   const tree=generated(wxml)(page.data),text=(node:any):string=>typeof node==='string'?node:!node||typeof node!=='object'?'':(node.children||[]).map(text).join('');
   assert.match(text(tree),/后台发布文案。/);assert.doesNotMatch(text(tree),/选一台，刚刚好。/);
  }
  assert.equal(calls.length,5);
 }finally{
  await db.advertisingCopySet.update({where:{id:'discovery'},data:original});
  if(actorId){await db.advertisingCopyPublication.deleteMany({where:{publishedBy:actorId}});await db.productCommand.deleteMany({where:{actorId}});await db.auditLog.deleteMany({where:{actorId}});await db.adminSession.deleteMany({where:{adminId:actorId}});await db.adminUser.delete({where:{id:actorId}});}
  await app?.close();await db.$disconnect();delete (globalThis as any).wx;
 }
});
