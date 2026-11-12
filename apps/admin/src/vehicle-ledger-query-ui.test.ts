import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';

test('real App vehicle ledger omits empty status while filters, search, pagination and another list remain usable',{timeout:120000},async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{App}from'/src/App.tsx';import'/src/style.css';import'/src/ninda-brand.css';import'/src/seven-module.css';import'/src/domain-ui.css';createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`;
 const server=await createServer({configFile:false,root,logLevel:'error',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0},plugins:[{
  name:'vehicle-ledger-query-test',
  configureServer(s){s.middlewares.use('/ledger-query.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/ledger-query-entry.js"></script></body></html>');});},
  resolveId:id=>id==='/ledger-query-entry.js'?'\0ledger-query-entry':null,
  load:id=>id==='\0ledger-query-entry'?entry:null
 }]});
 t.after(()=>server.close());await server.listen();
 const origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(60000);
 const reads:{path:string;query:URLSearchParams}[]=[],errors:string[]=[],violations:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){violations.push('external request');return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET'){violations.push('unexpected write');return route.fulfill({status:405,json:{error:{code:'READ_ONLY_FIXTURE'}}});}
  const path=url.pathname.slice(4),query=url.searchParams;reads.push({path,query});
  if(path==='/admin/auth/me')return route.fulfill({json:{user:{id:'local-ledger-operator',username:'本地回归运营',role:'OPERATIONS',permissions:['vehicles.read','model-definitions.read']},csrfToken:'local-synthetic-csrf'}});
  if(path==='/admin/vehicles/filter-options')return route.fulfill({json:{items:[{id:'local-owner',name:'本地合成合作商'}],total:1,page:1,pageSize:100,ageAsOf:'2026-11-05'}});
  if(path==='/admin/vehicles'){
   // Match the actual enum.optional contract: absence is valid; status= is not.
   if(query.has('status')&&!['DRAFT','PUBLISHED','UNPUBLISHED','RESERVED','IN_USE'].includes(query.get('status')!))return route.fulfill({status:400,json:{error:{code:'VALIDATION_ERROR',message:'status must be an allowed enum value when present'}}});
   const number=Number(query.get('page')),pageSize=Number(query.get('pageSize')),empty=query.get('keyword')==='NO-MATCH';
   return route.fulfill({json:{page:number,pageSize,total:empty?0:30,items:empty?[]:[{id:`vehicle-${number}`,vin:`LOCAL00000000000${number}`,plateNumber:`测试${number}号`,title:`车辆台账第${number}页`,brand:'本地合成车',modelYear:2026,firstRegistrationDate:'2026-01-01',registeredOwnerName:'本地合成所有人',cooperationOwner:{id:'local-owner',name:'本地合成合作商'},city:'本地',mileageKm:100,status:query.get('status')||'DRAFT',createdAt:'2026-10-31T00:00:00Z'}]}});
  }
  if(path==='/admin/model-definitions')return route.fulfill({json:{page:Number(query.get('page')),pageSize:Number(query.get('pageSize')),total:1,items:[{id:'model-local',brand:'本地车型品牌',name:'本地车型资料',modelYear:2026,bodyType:'SUV',createdAt:'2026-10-31T00:00:00Z'}]}});
  violations.push('unexpected API '+path);return route.fulfill({status:404,json:{error:{code:'UNEXPECTED_FIXTURE_ROUTE'}}});
 });
 const vehicleResponse=()=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/vehicles',{timeout:60000});
 const first=vehicleResponse();await page.goto(origin+'/ledger-query.html#vehicles');const firstResponse=await first;
 const initial=reads.find(row=>row.path==='/admin/vehicles')!;
 assert.equal(initial.query.has('status'),false,'the default real App request must omit optional status, not send status=');
 assert.equal(firstResponse.status(),200);
 assert.equal(initial.query.get('page'),'1');assert.equal(initial.query.get('pageSize'),'12');assert.equal(initial.query.get('keyword'),'');
 await expect(page.getByRole('cell',{name:'车辆台账第1页',exact:true})).toBeVisible();

 const filter=page.getByRole('combobox',{name:'筛选业务状态'});
 let response=vehicleResponse();await filter.selectOption('PUBLISHED');assert.equal((await response).status(),200);
 await expect(filter).toHaveValue('PUBLISHED');
 let last=reads.filter(row=>row.path==='/admin/vehicles').at(-1)!;
 assert.equal(last.query.get('status'),'PUBLISHED');assert.equal(last.query.get('page'),'1');

 response=vehicleResponse();await page.getByRole('button',{name:'下一页',exact:true}).click();assert.equal((await response).status(),200);
 await expect(page.getByRole('cell',{name:'车辆台账第2页',exact:true})).toBeVisible();
 last=reads.filter(row=>row.path==='/admin/vehicles').at(-1)!;
 assert.equal(last.query.get('page'),'2');assert.equal(last.query.get('status'),'PUBLISHED');

 await page.getByRole('textbox',{name:'搜索车辆管理',exact:true}).fill('  VIN-SEARCH  ');
 response=vehicleResponse();await page.getByRole('button',{name:'执行搜索',exact:true}).click();assert.equal((await response).status(),200);
 await expect(page.getByRole('cell',{name:'车辆台账第1页',exact:true})).toBeVisible();
 last=reads.filter(row=>row.path==='/admin/vehicles').at(-1)!;
 assert.equal(last.query.get('page'),'1');assert.equal(last.query.get('keyword'),'VIN-SEARCH');assert.equal(last.query.get('status'),'PUBLISHED');

 response=vehicleResponse();await filter.selectOption('');assert.equal((await response).status(),200);
 last=reads.filter(row=>row.path==='/admin/vehicles').at(-1)!;
 assert.equal(last.query.has('status'),false);assert.equal(last.query.get('keyword'),'VIN-SEARCH');
 await expect(filter).toHaveValue('');
 await page.getByRole('textbox',{name:'搜索车辆管理',exact:true}).fill('NO-MATCH');
 response=vehicleResponse();await page.getByRole('button',{name:'执行搜索',exact:true}).click();assert.equal((await response).status(),200);
 await expect(page.getByRole('button',{name:'清除筛选',exact:true})).toBeVisible();
 response=vehicleResponse();await page.getByRole('button',{name:'清除筛选',exact:true}).click();assert.equal((await response).status(),200);
 await expect(page.getByRole('cell',{name:'车辆台账第1页',exact:true})).toBeVisible();
 last=reads.filter(row=>row.path==='/admin/vehicles').at(-1)!;
 assert.equal(last.query.has('status'),false);assert.equal(last.query.get('keyword'),'');assert.equal(last.query.get('page'),'1');

 await page.evaluate(()=>{window.location.hash='model-definitions';});
 await expect(page.getByRole('cell',{name:'本地车型资料',exact:true})).toBeVisible();
 const models=reads.filter(row=>row.path==='/admin/model-definitions').at(-1)!;
 assert.equal(models.query.get('page'),'1');assert.equal(models.query.get('pageSize'),'12');assert.equal(models.query.get('keyword'),'');
 const output=fileURLToPath(new URL('../../../.runtime/ninda/vehicle-ledger-query-hotfix-20261031/code/',import.meta.url));
 await mkdir(output,{recursive:true});await writeFile(output+'captured-vehicle-queries.json',JSON.stringify({version:1,source:'Actual App browser requests against a local synthetic HTTP boundary',queries:reads.filter(row=>row.path==='/admin/vehicles').map(row=>row.path+'?'+row.query.toString())},null,2)+'\n');
 assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
});
