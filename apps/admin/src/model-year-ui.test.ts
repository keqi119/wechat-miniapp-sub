import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('actual model editor preserves null, sends protected updates, refreshes conflicts and feeds the true model year to products',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'model-entry',resolveId:id=>id==='virtual:model'?id:undefined,load:id=>id==='virtual:model'?`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:model'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a]));
 const html=`<!doctype html><html><head>${output.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${output.output.find(a=>a.type==='chunk')!.fileName}"></script></body></html>`;
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':a.fileName.endsWith('.png')?'image/png':'text/javascript':'text/html');res.end(a?a.code||a.source:html);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),writes:any[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let model:any={id:'model',brand:'合成',name:'年款车型',modelYear:null,revision:0,bodyType:'SUV',description:'车型原资料'},conflict=true,unknownOutcome=true,allowed=true;
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);let json:any={items:[],total:0},status=200;
   if(path==='/admin/auth/me')json={user:{id:'staff',username:'local',role:allowed?'OPERATIONS':'SUPPORT',permissions:['*']},csrfToken:'synthetic'};
   else if(req.method()!=='GET'){const body=req.postDataJSON();writes.push({path,body});assert.ok(body.idempotencyKey);assert.equal(req.headers()['x-csrf-token'],'synthetic');
    if(req.method()==='PATCH'&&conflict){conflict=false;model={...model,revision:1,modelYear:2023};status=409;json={error:{code:'REVISION_CONFLICT',message:'车型已变更，请核对'}};}
    else if(req.method()==='PATCH'&&unknownOutcome){unknownOutcome=false;status=503;json={error:{code:'TEMPORARY',message:'合成未知结果'}};}
    else{assert.equal(body.revision,req.method()==='POST'?0:model.revision);model={...model,...body,revision:req.method()==='POST'?0:model.revision+1};json=model;}
   }else if(path==='/admin/model-definitions')json={items:[model],total:1,page:1,pageSize:100};else if(path==='/admin/model-definitions/model')json=model;else if(path==='/admin/vehicles')json={items:[{id:'car',title:'车辆2026上牌',year:2026,modelDefinitionId:model.id}],total:1};
   await route.fulfill({status,json});
  });
  await page.goto(origin+'/#model-definitions?record=model');await page.getByRole('button',{name:'编辑车型',exact:true}).click();const year=page.getByLabel('车型年款',{exact:true});await expect(year).toHaveValue('');await year.fill('2024');await page.getByRole('button',{name:'保存资料',exact:true}).click();await expect(page.getByText('车型已变更，请核对',{exact:true})).toBeVisible();await expect(year).toHaveValue('2024');assert.equal(writes[0].body.revision,0);assert.equal(writes[0].body.modelYear,2024);
  await expect(page.getByRole('button',{name:'保存资料',exact:true})).toBeEnabled();await page.getByRole('button',{name:'保存资料',exact:true}).click();await expect(page.getByText('合成未知结果',{exact:true})).toBeVisible();assert.equal(writes[1].body.revision,1);assert.notEqual(writes[0].body.idempotencyKey,writes[1].body.idempotencyKey);await page.getByRole('button',{name:'保存资料',exact:true}).click();await expect(year).toHaveCount(0);assert.deepEqual(writes[1],writes[2]);assert.equal(model.modelYear,2024);
  await page.goto(origin+'/#products');await expect(page.getByRole('heading',{name:'产品工作台',exact:true})).toBeVisible();await expect(page.locator('.product-workbench-form')).toBeVisible();await expect(page.getByLabel('合成 年款车型 · 2024款',{exact:true})).toBeVisible();await expect(page.getByText(/2026款/)).toHaveCount(0);
  await page.goto(origin+'/#model-definitions?record=model');await page.getByRole('button',{name:'编辑车型',exact:true}).click();await expect(page.getByLabel('车型年款',{exact:true})).toHaveValue('2024');await page.getByLabel('车型年款',{exact:true}).fill('');await page.getByRole('button',{name:'保存资料',exact:true}).click();await expect(page.getByLabel('车型年款',{exact:true})).toHaveCount(0);assert.equal(writes.at(-1).body.modelYear,null);assert.equal(model.modelYear,null);
  await page.goto(origin+'/#products');await expect(page.getByRole('heading',{name:'产品工作台',exact:true})).toBeVisible();await expect(page.locator('.product-workbench-form')).toBeVisible();await expect(page.getByLabel('合成 年款车型 · 年款未登记',{exact:true})).toBeVisible();await expect(page.getByText(/2026款/)).toHaveCount(0);
  allowed=false;await page.goto(origin+'/?denied#model-definitions');await expect(page.getByRole('heading',{name:'当前账号无权访问此模块'})).toBeVisible();assert.deepEqual(errors,[]);assert.ok(writes.every(write=>write.path==='/admin/model-definitions/model'));
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
