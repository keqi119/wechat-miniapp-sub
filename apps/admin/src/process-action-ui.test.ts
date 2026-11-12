import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('process actions activate their own button and task anchor while respecting disabled controls and local targets',async()=>{
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ProcessGuide}from'/src/process-guide';import'/src/style.css';
 function Fixture(){const[count,setCount]=React.useState(0);const section=(key,target,enabled=true)=>React.createElement('section',{'data-process-scope':true,key},React.createElement(ProcessGuide,{title:key,process:{currentStep:'edit',steps:[{key:'edit',label:'编辑',state:'CURRENT',summary:'当前真实动作'}],primaryAction:{key,label:'办理 '+key,kind:'OPEN_FORM',enabled,target:{section:key}}}}),target);return React.createElement(React.Fragment,null,
 section('self-button',React.createElement('button',{'data-process-action':'self-button',onClick:()=>setCount(n=>n+1)},'目标按钮')),
 section('self-anchor',React.createElement('a',{'data-process-action':'self-anchor',href:'#products?record=p&view=edit&versionId=v'},'目标草稿')),
 section('disabled-button',React.createElement('button',{'data-process-action':'disabled-button',disabled:true,onClick:()=>setCount(n=>n+100)},'禁用按钮')),
 section('aria-button',React.createElement('button',{'data-process-action':'aria-button','aria-disabled':'true',onClick:()=>setCount(n=>n+100)},'无权限按钮')),
 section('aria-anchor',React.createElement('a',{'data-process-action':'aria-anchor','aria-disabled':'true',href:'#unexpected'},'无权限链接')),
 section('disabled-anchor',React.createElement('a',{'data-process-action':'disabled-anchor',disabled:true,href:'#unexpected'},'禁用链接')),
 section('external-anchor',React.createElement('a',{'data-process-action':'external-anchor',href:'https://example.invalid/unrequested'},'外部链接')),
 section('disabled-action',React.createElement('button',{'data-process-action':'disabled-action',onClick:()=>setCount(n=>n+100)},'动作已禁用'),false),
 React.createElement('output',{'aria-label':'已执行按钮次数'},String(count)));}createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'direct-process-action',resolveId:id=>id==='virtual:direct-action'?id:undefined,load:id=>id==='virtual:direct-action'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:direct-action'}}});
 const out=((Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array;isEntry?:boolean}[]}).output;
 const html=`<!doctype html><html><head>${out.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${out.find(a=>a.type==='chunk'&&a.isEntry)!.fileName}"></script></body></html>`;
 const server=createServer((req,res)=>{const asset=out.find(a=>'/'+a.fileName===new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:html);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let browser:Browser|undefined;
 try{try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage();const errors:string[]=[],remote:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){remote.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(origin+'/#start');await page.getByRole('button',{name:'办理 self-button',exact:true}).click();await expect(page.getByLabel('已执行按钮次数',{exact:true})).toHaveText('1');
  await page.getByRole('button',{name:'办理 self-anchor',exact:true}).click();await expect(page).toHaveURL(origin+'/#products?record=p&view=edit&versionId=v');
  const current=page.url();for(const name of ['disabled-button','aria-button','aria-anchor','disabled-anchor','external-anchor']){await page.getByRole('button',{name:'办理 '+name,exact:true}).click();await page.waitForTimeout(40);assert.equal(page.url(),current);await expect(page.getByLabel('已执行按钮次数',{exact:true})).toHaveText('1');}
  await expect(page.getByRole('button',{name:'办理 disabled-action',exact:true})).toBeDisabled();assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
