import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('partner list and detail distinguish pending vehicles from effective cooperation without exposing other owners',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',plugins:[{name:'inventory-partner',resolveId:id=>id==='virtual:inventory-partner'?id:undefined,load:id=>id==='virtual:inventory-partner'?`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PartnersPage} from '/src/partners';import '/src/style.css';api.setSession({user:{id:'ops',username:'合成运营',role:'OPERATIONS',permissions:[]},csrfToken:'synthetic'});createRoot(document.getElementById('root')).render(React.createElement(PartnersPage,{view:'partners'}));`:undefined}],define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},build:{write:false,minify:false,rolldownOptions:{input:'virtual:inventory-partner'}}});
 const output=(Array.isArray(result)?result[0]:result) as any,assets=new Map<string,any>(output.output.map((a:any)=>['/'+a.fileName,a])),script=output.output.find((a:any)=>a.type==='chunk').fileName,css=output.output.filter((a:any)=>a.fileName.endsWith('.css'));
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?a.code||a.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map((a:any)=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as any).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(5000);
   const vehicles=[{id:'live',plateNumber:'沪合成有效',vin:'SYNTHETIC-LIVE',model:'测试车型',status:'PUBLISHED'},{id:'draft',plateNumber:'沪合成待补',vin:'SYNTHETIC-DRAFT',model:'测试车型',status:'DRAFT'},{id:'other',plateNumber:'沪其他主体',vin:'SYNTHETIC-OTHER',model:'测试车型',status:'DRAFT'}];
   const partner:any={id:'p',name:'合成库存公司',revision:0,subjectType:'ENTERPRISE',status:'DRAFT',agreements:[],vehicleCount:1,pendingVehicleCount:1,agreementCount:1,vehicles:[{ownerId:'p',vehicleId:'live',active:true,vehicle:vehicles[0]}],pendingVehicles:[{ownerId:'p',vehicleId:'draft',active:false,status:'DRAFT',vehicle:vehicles[1],agreements:[{id:'draft-a',title:'库存资料待补协议',version:1,versionId:'v1'}]}],vehicleAssignments:[{ownerId:'q',vehicleId:'other',active:true}]};
   await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();assert.equal(req.method(),'GET');const p=u.pathname.slice(4);return route.fulfill({json:p==='/admin/partners'?[partner]:p==='/admin/partners/p'?partner:p==='/admin/vehicles'?{items:vehicles,total:3,page:1,pageSize:100}:p.endsWith('/company-admin')?{status:'UNSET',revision:0,current:null}:p.endsWith('/revenue')?{totals:{},groups:[],items:[],total:0,page:1,pageSize:20}:[]});});
   await page.goto(origin+'/#partners');await expect(page.getByRole('columnheader',{name:'待补协议车辆',exact:true})).toBeVisible();
   await page.goto(origin+'/#partners?record=p');const shell=page.locator('.record-workspace-shell');await shell.getByRole('tab',{name:'关联车辆',exact:true}).click();const panel=shell.getByRole('tabpanel',{name:'关联车辆'});
   const pending=panel.locator('section').filter({has:page.getByRole('heading',{name:'待补协议车辆',exact:true})});const active=panel.locator('section').filter({has:page.getByRole('heading',{name:'当前合作车辆',exact:true})});
   await expect(pending.locator('tbody tr')).toHaveCount(1);await expect(active.locator('tbody tr')).toHaveCount(1);await expect(pending).toContainText('沪合成待补');await expect(active).not.toContainText('沪合成待补');await expect(panel).not.toContainText('沪其他主体');await expect(pending).toContainText('尚未生效');await expect(shell).toContainText('待补协议车辆 1 辆');
   await expect(pending.getByRole('link',{name:'查看车辆'})).toHaveAttribute('href','#vehicles?record=draft');
   await page.screenshot({path:fileURLToPath(new URL(`../../../.runtime/ninda/vehicle-inventory-init-20261031/partner-draft/ui-${width}.png`,import.meta.url)),fullPage:true});await page.close();
  }
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
