import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('BaaS active and voided file links construct known private paths with production API base exactly once',async()=>{
 const apiBase='https://api.evsub.ndacar.com/api';
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {BaasFiles} from '/src/baas-files';api.setSession({user:{id:'finance',role:'FINANCE',permissions:['baas-contracts.read']},csrfToken:'local'});const files=[{id:'active',name:'有效合同.pdf',state:'ACTIVE',size:10,url:'/api/admin/baas-contracts/contract/files/active'},{id:'voided',name:'作废合同.pdf',state:'VOIDED',size:10,url:'https://untrusted.invalid/file',voidReason:'旧版'}];createRoot(document.getElementById('root')).render(React.createElement(BaasFiles,{id:'contract',revision:1,files,writable:false,after:async()=>{}}));`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify(apiBase)},plugins:[{name:'baas-file-link-fixture',resolveId:id=>id==='virtual:baas-file-link-fixture'?id:undefined,load:id=>id==='virtual:baas-file-link-fixture'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:baas-file-link-fixture'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;code?:string}[]},script=output.output.find(item=>item.type==='chunk')!.code!;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?script:'<html><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(cause){if(!(cause instanceof Error)||!cause.message.includes("Executable doesn't exist"))throw cause;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage();await page.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});await page.goto(origin);
  await expect(page.getByRole('link',{name:'有效合同.pdf',exact:true})).toHaveAttribute('href',apiBase+'/admin/baas-contracts/contract/files/active');
  await expect(page.getByRole('link',{name:'作废合同.pdf',exact:true})).toHaveAttribute('href',apiBase+'/admin/baas-contracts/contract/files/voided/history');
  assert.equal(await page.locator('a[href*="/api/api/"]').count(),0);assert.equal(await page.locator('a[href*="untrusted.invalid"]').count(),0);
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
