import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

let browser:Browser,server:Server,origin:string;
before(async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),entry=`import React from 'react';import{createRoot}from'react-dom/client';import{RenewalPage}from'/src/renewal-ui';import{api}from'/src/core';import'/src/style.css';import'/src/domain-ui.css';api.setSession({user:{id:'reviewer',role:'ADMIN',permissions:['order-changes.read','order-changes.write']},csrfToken:'synthetic'});createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(RenewalPage)));`;
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'cancellation-status',resolveId:id=>id==='virtual:cancellation-status'?id:undefined,load:id=>id==='virtual:cancellation-status'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:cancellation-status'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a])),html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${output.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${output.output.find(a=>a.type==='chunk')!.fileName}"></script></body></html>`;
 server=createServer((req,res)=>{const asset=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:html);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;browser=await chromium.launch({channel:'chrome',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});

for(const state of ['OPEN','COMPLETED','NONE','INVALID'] as const)test(`real list and detail cancellation display ${state} without issuing commands`,async()=>{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),writes:string[]=[],errors:string[]=[],cancellation=state==='NONE'?null:state==='INVALID'?{id:'case',status:'OPEN'}:{id:'case',status:state,completedAt:state==='COMPLETED'?'2026-10-31T10:00:00.000Z':null,signatureEvidenceFileIds:['private-file'],mutualAgreementNote:'private-note'};
 const row={id:'renewal-local',kind:'SUBSCRIPTION_EXTENSION',orderId:'order-local',status:'AWAITING_FINANCE',revision:4,cancellation,canPrepareFinance:true,canSchedule:true,canActivate:true,createdAt:'2026-10-31T00:00:00.000Z',blockers:[]};page.on('pageerror',e=>errors.push(e.message));
 try{await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();if(req.method()!=='GET'){writes.push(url.pathname);throw Error('Unexpected write');}if(url.pathname==='/api/admin/order-renewals')return route.fulfill({json:{items:[row],total:1,page:1,pageSize:12}});if(url.pathname==='/api/admin/order-renewals/renewal-local')return route.fulfill({json:row});throw Error('Unexpected read '+url.pathname);});
  await page.goto(origin+'/#order-renewals?record=renewal-local');const dialog=page.getByRole('dialog',{name:'续期办理'});
  if(state==='INVALID'){await expect(page.getByText('续期取消状态不完整，请重新读取核对',{exact:true})).toHaveCount(2);await expect(page.getByRole('button',{name:'renewal-local',exact:true})).toHaveCount(0);await expect(dialog.getByRole('heading',{name:'待核清续期款项',exact:true})).toHaveCount(0);}
  else{const label=state==='OPEN'?'取消处理中':state==='COMPLETED'?'续期已取消':'待核清续期款项';await expect(dialog.getByRole('heading',{name:label,exact:true})).toBeVisible();await expect(page.locator('tbody tr').getByText(label,{exact:true})).toBeVisible();for(const name of ['准备新增账单','核款并排期','激活续期']){const button=dialog.getByRole('button',{name,exact:true});if(state==='NONE')await expect(button).toBeVisible();else await expect(button).toHaveCount(0);}if(state==='OPEN'||state==='COMPLETED')await expect(dialog.getByText('草案已保存，请编制报价版本后交独立财务复核。',{exact:true})).toHaveCount(0);if(state==='COMPLETED')await expect(dialog.getByText('本次未来续期已取消，原报价、协议和收退款记录保留为历史。',{exact:true})).toBeVisible();}
  await expect(page.getByText('private-note',{exact:true})).toHaveCount(0);await expect(page.getByText('private-file',{exact:true})).toHaveCount(0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  if(state==='OPEN'){const out=fileURLToPath(new URL('../../../tmp/admin-renewal-cancellation-status-ui-baseline/browser/',import.meta.url));await mkdir(out,{recursive:true});await page.screenshot({path:out+'open-1440.png',fullPage:true});}
 }finally{await page.close();}
});
