import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('customer resource list and detail display real-name facts separately from qualification review',async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {ResourcePage} from '/src/App';import {resources} from '/src/resources';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';const role=new URLSearchParams(location.search).get('role')||'ADMIN';api.setSession({user:{id:'local-reviewer',username:'synthetic',role,permissions:['customers.read','customers.write']},csrfToken:'synthetic'});createRoot(document.getElementById('root')).render(<ResourcePage resource={resources.find(r=>r.key==='customers')} permissions={api.session.user.permissions} notify={()=>{}}/>);`;
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'identity-entry',resolveId:id=>id==='virtual:identity.tsx'?id:undefined,load:id=>id==='virtual:identity.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:identity.tsx'}}});
 const out=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(out.output.map(a=>['/'+a.fileName,a])),script=out.output.find(a=>a.type==='chunk')!.fileName,styles=out.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://local').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?a.code||a.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 const identity={status:'VERIFIED',verified:true,locked:true,name:'合成认证姓名',maskedIdCardNo:'110***********1234',verifiedAt:'2026-11-10T00:00:00Z',providerAccountId:'not-public',rawIdCardNo:'110101199001011234'};
 const customer={id:'customer-a',name:'合成填报姓名',mobile:'13800000000',drivingYears:3,createdAt:'2026-10-31',identity};
 try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
  for(const role of ['ADMIN','OPERATIONS','SUPPORT','FINANCE','FIELD'])await t.test(`${role} receives only its permitted real-name display`,async()=>{
   const page=await browser!.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();assert.equal(route.request().method(),'GET');if(u.pathname==='/api/admin/customers')return route.fulfill({json:{items:[customer,{...customer,id:'customer-b',name:'缺少核验资料',identity:undefined}],total:2,page:1,pageSize:12}});if(u.pathname==='/api/admin/customers/customer-a')return route.fulfill({json:customer});if(u.pathname.endsWith('/source'))return route.fulfill({json:{customerId:'customer-a',sourceChannel:null,sourceRevision:0}});if(u.pathname.endsWith('/qualifications'))return route.fulfill({json:{customerId:'customer-a',profileHash:'a'.repeat(64),revision:0,current:{status:'PENDING'},items:[]}});assert.fail('Unexpected request '+u.pathname);});
   try{await page.goto(origin+'?role='+role+'#customers');await expect(page.getByRole('button',{name:'合成填报姓名',exact:true})).toBeVisible();const authorized=['ADMIN','OPERATIONS'].includes(role);
    await expect(page.getByRole('columnheader',{name:'实名认证',exact:true})).toHaveCount(authorized?1:0);await expect(page.getByRole('columnheader',{name:'认证姓名',exact:true})).toHaveCount(authorized?1:0);
    if(authorized){await expect(page.getByRole('row').filter({hasText:'合成填报姓名'})).toContainText('已实名');await expect(page.getByRole('row').filter({hasText:'缺少核验资料'})).toContainText('待核实');}else await expect(page.getByText('合成认证姓名',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'合成填报姓名',exact:true}).click();const panel=page.getByRole('region',{name:'客户实名认证',exact:true});await expect(panel).toHaveCount(authorized?1:0);
    if(authorized){await expect(panel).toContainText('已实名');await expect(panel).toContainText('合成认证姓名');await expect(panel).toContainText('110***********1234');await expect(panel).toContainText('2026');await expect(page.getByText('身份与驾驶资格审核',{exact:true})).toBeVisible();if(role==='ADMIN'){const qa=resolve(root,'../../.runtime/qualification-upload-fix-20261110/screenshots');await mkdir(qa,{recursive:true});await page.screenshot({path:resolve(qa,'customer-identity-desktop.png'),fullPage:true});}}
    await page.getByRole('tab',{name:'详细资料',exact:true}).click();await expect(page.getByText('not-public',{exact:true})).toHaveCount(0);await expect(page.getByText('110101199001011234',{exact:true})).toHaveCount(0);assert.deepEqual(errors,[]);
   }finally{await page.close();}
  });
 }finally{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));}
});
