import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
// Uses the actual built dist. Every non-static request is intercepted locally.
// No account, database, SMS, provider or production request is made.
const localOrigin=process.argv[3]||'http://127.0.0.1:3104';
const expected=new URL(process.argv[2]||'https://mini-api.subauto.keybox.cloud/api',localOrigin).href;
const dist=fileURLToPath(new URL(process.argv[4]||'../dist/',import.meta.url));
const output=new URL('../qa/',import.meta.url);await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname;const relative=path==='/'?'index.html':/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)?path.slice(1):null;if(!relative){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'Content-Type':relative.endsWith('.html')?'text/html; charset=utf-8':relative.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(join(dist,relative)));}catch{res.end();}});
await new Promise(resolve=>server.listen(3104,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});
const observed=[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.__apiRequests=[];const original=window.fetch;window.fetch=(input,init)=>{window.__apiRequests.push({url:new URL(String(input),location.href).href,method:init?.method||'GET',credentials:init?.credentials});return original(input,init);};});
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin===localOrigin&&!url.pathname.startsWith('/api/'))return route.continue();observed.push({url:url.href,method:request.method()});const headers={'Access-Control-Allow-Origin':localOrigin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-CSRF-Token'};if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});if(url.pathname.endsWith('/admin/auth/me')||url.pathname.endsWith('/admin/auth/login')){if(url.origin==='http://127.0.0.1:3104')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html>QA static index fallback, no real API</html>'});return route.fulfill({status:401,headers,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_CREDENTIALS',message:'QA isolated login rejection'}})});}return route.fulfill({status:404,headers,contentType:'application/json',body:'{}'});});
 await page.goto(localOrigin+'/');await page.getByRole('button',{name:'进入工作台'}).waitFor();
 await page.getByLabel('工作账号').fill('qa-build-fixture');await page.getByLabel('登录密码',{exact:true}).fill('QA-local-fixture-not-a-real-password');const loginResponse=page.waitForResponse(response=>response.url().endsWith('/admin/auth/login'));await page.getByRole('button',{name:'进入工作台'}).click();
 await loginResponse;
 const requests=await page.evaluate(()=>window.__apiRequests);
 await writeFile(new URL('api-target.json',output),JSON.stringify({mode:'actual-built-bundle-intercepted-network-no-real-login',expectedBase:expected,requests,observed,pageErrors:errors},null,2));
 assert.ok(requests.some(request=>request.url===`${expected}/admin/auth/me`),'initial session request must target the approved API origin');
 assert.ok(requests.some(request=>request.url===`${expected}/admin/auth/login`),'login request must target the approved API origin');
 assert.ok(requests.every(request=>request.url.startsWith(expected+'/')&&request.credentials==='include'));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({expectedBase:expected,requests:requests.map(r=>({url:r.url,credentials:r.credentials})),pageErrors:errors.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
