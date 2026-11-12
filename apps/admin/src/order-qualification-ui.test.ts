import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect} from '@playwright/test';
test('order qualification shows the specific reason and posts a scoped human confirmation',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const built=await build({configFile:false,root,logLevel:'silent',plugins:[{name:'fixture',resolveId:id=>id==='virtual:fixture.tsx'?id:undefined,load:id=>id==='virtual:fixture.tsx'?`
 import React from 'react';import{createRoot}from'react-dom/client';import{OrderQualificationPanel}from'/src/order-qualification';import{api}from'/src/core';import'/src/style.css';import'/src/domain-ui.css';
 api.setSession({user:{id:'operator',role:'ADMIN',permissions:['*']},csrfToken:'synthetic'});
 createRoot(document.getElementById('root')).render(<OrderQualificationPanel orderId="o1" after={()=>{}}/>);`:undefined}],build:{write:false,rollupOptions:{input:'virtual:fixture.tsx',output:{entryFileNames:'fixture.js'}}}});
 const bundle=Array.isArray(built)?built[0]:built;if(!('output'in bundle))throw Error('bundle unavailable');const output=bundle.output;
 const css=output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const server=createServer((req,res)=>{const asset=output.find(a=>'/'+a.fileName===req.url);res.setHeader('Content-Type',asset?(asset.fileName.endsWith('.css')?'text/css':'text/javascript'):'text/html');res.end(asset?asset.type==='chunk'?asset.code:asset.source:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${css}<div id="root"></div><script type="module" src="/fixture.js"></script>`)});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({channel:'chrome',headless:true})}const page=await browser.newPage({viewport:{width:1366,height:768}});let phase='changed';const posts:any[]=[];
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()==='POST'){posts.push({path,body:req.postDataJSON()});phase='done';return route.fulfill({json:{id:'confirmed'}})}
  if(path.endsWith('/qualification-continuity'))return route.fulfill({json:{orderId:'o1',customerId:'c1',revision:4,ready:phase==='done',canConfirm:phase==='reviewed',qualificationId:'q2',qualificationRevision:2,profileHash:'a'.repeat(64),originalScopeHash:'b'.repeat(64),messages:phase==='changed'?['请核对当前驾驶证并提交审核']:[],confirmation:phase==='done'?{reason:'已核对同一承租人'}:null}});
  if(path.endsWith('/qualifications'))return route.fulfill({json:{customerId:'c1',revision:phase==='changed'?1:2,profileHash:'a'.repeat(64),current:{status:phase==='changed'?'RECHECK_REQUIRED':'APPROVED',recheckReasons:phase==='changed'?[{code:'DRIVING_DOCUMENT_CHANGED',message:'驾驶证附件内容已更新，请核对新资料并提交审核'}]:[]},items:[{id:phase==='changed'?'q1':'q2',revision:phase==='changed'?1:2,status:'APPROVED',identityFileIds:[],drivingLicenseFileIds:[],identityExpiresAt:'2030-02-25',drivingLicenseLongTerm:true}]}});
  return route.fulfill({status:503,json:{error:{message:'合成资料未加载'}}});
 });
 await page.goto(`http://127.0.0.1:${(server.address()as any).port}`);
 await expect(page.getByText('驾驶证附件内容已更新，请核对新资料并提交审核')).toBeVisible();await expect(page.getByRole('button',{name:'核对本单更新证件',exact:true})).toHaveCount(0);
 phase='reviewed';await page.getByRole('button',{name:'刷新本单资格'}).click();await page.getByRole('button',{name:'核对本单更新证件',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('textbox',{name:'核对说明'}).fill('已核对原签约资料与当前驾驶证，仍为同一承租人');await page.getByRole('button',{name:'保存本单核对'}).click();
 await expect(page.getByText('本单资格已满足')).toBeVisible();assert.equal(posts.length,1);assert.equal(posts[0].path,'/api/admin/orders/o1/qualification-continuity');assert.equal(posts[0].body.qualificationId,'q2');assert.equal(posts[0].body.revision,4);assert.equal(posts[0].body.originalScopeHash,'b'.repeat(64));assert.equal(posts[0].body.sameCustomerConfirmed,true);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
