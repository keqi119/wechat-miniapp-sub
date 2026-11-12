import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('partner details show only their effective vehicles while cross-partner replacement remains explicit',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',plugins:[{name:'partner-scope',resolveId:id=>id==='virtual:partner-scope'?id:undefined,load:id=>id==='virtual:partner-scope'?`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PartnersPage} from '/src/partners';import '/src/style.css';api.setSession({user:{id:'ops',username:'合成运营',role:'OPERATIONS',permissions:[]},csrfToken:'synthetic'});createRoot(document.getElementById('root')).render(React.createElement(PartnersPage,{view:'partners'}));`:undefined}],define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},build:{write:false,minify:false,rolldownOptions:{input:'virtual:partner-scope'}}});
 const output=(Array.isArray(result)?result[0]:result) as any,assets=new Map<string,any>(output.output.map((a:any)=>['/'+a.fileName,a])),script=output.output.find((a:any)=>a.type==='chunk').fileName;
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?'text/javascript':'text/html');res.end(a?a.code||a.source:`<!doctype html><html><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as any).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  const vehicles=[1,2,3].map(n=>({id:`v${n}`,plateNumber:`沪合成00${n}`,vin:`SYNTHETIC00000000${n}`,model:`合成车型${n}`,status:'PUBLISHED'}));
  const assignments=vehicles.map((v,n)=>({vehicleId:v.id,ownerId:`p${n+1}`,ownerName:`合成合作商${n+1}`,agreementId:`a${n+1}`,agreementTitle:'合成协议',revision:3,active:true}));
  const partners=[1,2,3,4].map(n=>({id:`p${n}`,name:`合成合作商${n}`,revision:0,subjectType:'ENTERPRISE',status:'DRAFT',agreements:[],vehicleAssignments:assignments,vehicleCount:n===4?0:1,agreementCount:n===4?0:1,vehicles:n===4?[]:[{...assignments[n-1],vehicle:vehicles[n-1]}]}));
  await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();assert.equal(req.method(),'GET','scope browsing must not mutate');const p=u.pathname.slice(4);const value=p==='/admin/partners'?partners:p==='/admin/vehicles'?{items:vehicles,total:3,page:1,pageSize:100}:p.endsWith('/company-admin')?{status:'UNSET',revision:0,current:null}:p.endsWith('/revenue')?{totals:{},groups:[],items:[],total:0,page:1,pageSize:20}:partners.find(row=>p===`/admin/partners/${row.id}`)||[];return route.fulfill({json:value});});
  for(const n of [1,2,3,4]){
   await page.goto(origin+`/#partners?record=p${n}&tab=vehicles`);
   const shell=page.locator('.record-workspace-shell');await shell.getByRole('tab',{name:'关联车辆',exact:true}).click();
   const panel=shell.getByRole('tabpanel',{name:'关联车辆'});
   if(n===4){await expect(panel.getByText('暂无当前合作车辆，请在合作协议中关联车辆。')).toBeVisible();await expect(panel.locator('tbody tr')).toHaveCount(0);}
   else{await expect(panel.locator('tbody tr')).toHaveCount(1);await expect(panel.locator('tbody')).toContainText(`沪合成00${n}`);for(const other of [1,2,3].filter(v=>v!==n))await expect(panel).not.toContainText(`沪合成00${other}`);}
  }
  await page.goto(origin+'/#partners?record=p1');const shell=page.locator('.record-workspace-shell');await shell.getByRole('tab',{name:'合作协议',exact:true}).click();await shell.getByRole('button',{name:'登记合作协议',exact:true}).click();await shell.getByRole('checkbox',{name:/沪合成002/}).check();await expect(shell.getByText(/合成合作商2/)).toBeVisible();await expect(shell.getByRole('checkbox',{name:/确认/})).toHaveCount(1);
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
