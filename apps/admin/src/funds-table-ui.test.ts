import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect} from '@playwright/test';

test('funds use a compact scoped table and amounts navigate to the corresponding record with a return target',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',plugins:[{name:'funds-fixture',resolveId:id=>id==='virtual:funds.tsx'?id:undefined,load:id=>id==='virtual:funds.tsx'?`
 import React from 'react';import{createRoot}from'react-dom/client';import{OrderFundsPanel}from'/src/order-record-panel';import{api}from'/src/core';import'/src/style.css';import'/src/domain-ui.css';
 api.setSession({user:{id:'operator',role:'ADMIN',permissions:['*']},csrfToken:'synthetic'});location.hash='#orders?record=o1&view=funds';
 const bills=Array.from({length:12},(_,i)=>({id:'b'+i,orderId:'o1',type:'SUBSCRIPTION',sequence:i+1,status:i===0?'PENDING':'DRAFT',amount:489900,paidAmount:0,receivedAmount:i===0?1:0,refundedAmount:i===0?1:0,netReceivedAmount:0,dueDate:'2027-10-30',payments:i===0?[{id:'p1',orderId:'o1',billId:'b0',status:'SUCCEEDED',amount:1,refundedAmount:1,netReceivedAmount:0,refunds:[{id:'r1',orderId:'o1',paymentId:'p1',status:'SUCCEEDED',amount:1}]}]:[]}));
 const p={orderId:'o1',related:{bills},steps:[],blockers:[],attention:[]};
 createRoot(document.getElementById('root')).render(<main style={{padding:20,maxWidth:'100%'}}><OrderFundsPanel orderId="o1" process={p} disabled={false} refreshKey={0} after={async()=>{}} renderValues={()=>null}/></main>);
 `:undefined}],build:{write:false,rollupOptions:{input:'virtual:funds.tsx',output:{entryFileNames:'fixture.js'}}}});
 const bundle=Array.isArray(result)?result[0]:result;if(!('output'in bundle))throw Error('bundle unavailable');const output=bundle.output;
 const css=output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const server=createServer((req,res)=>{const asset=output.find(a=>'/'+a.fileName===req.url);res.setHeader('Content-Type',asset?(asset.fileName.endsWith('.css')?'text/css':'text/javascript'):'text/html');res.end(asset?asset.type==='chunk'?asset.code:asset.source:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${css}<div id="root"></div><script type="module" src="/fixture.js"></script>`)});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{try{browser=await chromium.launch({headless:true})}catch{browser=await chromium.launch({channel:'chrome',headless:true})}const page=await browser.newPage({viewport:{width:1366,height:768}});const requests:string[]=[];await page.route('**/api/**',route=>{requests.push(route.request().method());return route.fulfill({json:{}})});await page.goto(`http://127.0.0.1:${(server.address()as any).port}`);
  await expect(page.getByRole('table',{name:'本单账单'})).toBeVisible();assert.equal(await page.getByRole('table').count(),1);assert.equal(await page.locator('tbody tr').count(),12);await expect(page.locator('tbody tr').first()).toContainText('待支付');await expect(page.getByRole('button',{name:'查看第 1 期账单实收金额'})).toContainText('0.01');
  await page.getByRole('button',{name:'查看第 1 期账单应付金额'}).click();let hash=await page.evaluate(()=>location.hash);assert.ok(hash.startsWith('#bills?'));assert.equal(new URLSearchParams(hash.split('?')[1]).get('record'),'b0');assert.equal(new URLSearchParams(hash.split('?')[1]).get('returnTo'),'#orders?record=o1&view=funds');
  await page.getByRole('tab',{name:/收款/}).click();await expect(page.getByRole('table',{name:'本单收款'})).toBeVisible();await page.getByRole('button',{name:'查看收款金额 p1'}).click();hash=await page.evaluate(()=>location.hash);assert.equal(new URLSearchParams(hash.split('?')[1]).get('record'),'p1');
  await page.getByRole('tab',{name:/退款/}).click();await expect(page.getByRole('table',{name:'本单退款'})).toBeVisible();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'查看退款金额 r1'}).click();assert.ok((await page.evaluate(()=>location.hash)).startsWith('#refunds?'));assert.deepEqual(requests,[]);
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
