import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('policy archive shows nine business columns and all insured vehicles',async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {InsurancePage} from '/src/insurance';api.setSession({user:{id:'operator',username:'operator',role:'OPERATIONS',permissions:['*']},csrfToken:'local'});createRoot(document.getElementById('root')).render(React.createElement(InsurancePage));`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'insurance-registration',resolveId:id=>id==='virtual:insurance-registration'?id:undefined,load:id=>id==='virtual:insurance-registration'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:insurance-registration'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array;isEntry?:boolean}[]};
 const chunk=output.output.find(item=>item.type==='chunk'&&item.isEntry)!;
 const html=`<html><head>${output.output.filter(item=>item.fileName.endsWith('.css')).map(item=>`<link rel="stylesheet" href="/${item.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${chunk.fileName}"></script></body></html>`;
 const server=createServer((req,res)=>{const asset=output.output.find(item=>'/'+item.fileName===req.url);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code??asset.source:html);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const vehicles=[{id:'car-a',plateNumber:'沪A00001',vin:'VIN_A',title:'甲车型'},{id:'car-b',plateNumber:'沪B00002',vin:'VIN_B',title:'乙车型'}];
 const policy={id:'policy',revision:3,policyNumber:'POLICY001',insurer:'实际保险机构',insuredParty:'实际被保险人',policyType:'COMMERCIAL',currentVersionId:'version',currentStatus:'ACTIVE',startAt:'2026-01-01T00:00:00.000Z',endAt:'2027-01-01T00:00:00.000Z',vehicles,versions:[{id:'version',version:1,revision:0,status:'REGISTERED',vehicleIds:['car-a','car-b'],fileIds:['original'],registeredBy:'operator',changeReason:'首次登记'}],files:[{fileId:'original',name:'原保单.pdf',mimeType:'application/pdf',size:100}]};
 let browser:Browser|undefined;
 try{try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage();page.setDefaultTimeout(4000);
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(request.method(),'GET');if(url.pathname==='/api/admin/insurance-policies')return route.fulfill({json:{items:[policy],total:1,page:1,pageSize:12}});if(url.pathname==='/api/admin/vehicles')return route.fulfill({json:{items:vehicles,total:2,page:1,pageSize:100}});throw Error('Unexpected request '+url.pathname);});
  await page.goto(origin+'/#insurance');
  for(const label of ['车牌号','VIN码','车型','保单类型','保单号','保险有效期','保险机构','被保险人','当前状态'])await expect(page.getByRole('columnheader',{name:label,exact:true})).toBeVisible();
  for(const value of ['沪A00001','沪B00002','VIN_A','VIN_B','甲车型','乙车型','实际被保险人'])await expect(page.getByRole('cell').filter({hasText:value})).toBeVisible();
  await expect(page.getByRole('button',{name:'登记保单草稿',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'登记保单',exact:true})).toBeEnabled();
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
