import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const dist=fileURLToPath(new URL('../dist/',import.meta.url)),output=new URL('../qa/',import.meta.url);
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const relative=['/miniapp-sign/','/miniapp-sign/return/'].includes(path)?'index.html':/^\/miniapp-sign\/assets\/[A-Za-z0-9_.-]+$/.test(path)?path.replace('/miniapp-sign/',''):null;
 if(!relative){res.writeHead(404);res.end();return;}
 try{const data=await readFile(join(dist,relative));res.writeHead(200,{'Content-Type':relative.endsWith('.html')?'text/html; charset=utf-8':relative.endsWith('.css')?'text/css':'text/javascript','Content-Security-Policy':csp,'Referrer-Policy':'no-referrer'});res.end(data);}catch{res.writeHead(404);res.end();}
});await new Promise(resolve=>server.listen(3103,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[],requests=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
 page.on('request',request=>requests.push(new URL(request.url()).hostname));
 await page.route('**/miniapp-sign/api/**',async route=>{const path=new URL(route.request().url()).pathname;assert.equal(route.request().method(),'GET');const data=path.endsWith('/config')?{enabled:true}:path.endsWith('/legal')?{documents:[]}:path.endsWith('/auth/me')?{customer:{id:'qa-local',maskedMobile:'138****0000'},csrfToken:'qa-only',expiresAt:'2099-01-01T00:00:00Z'}:{items:[]};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 for(const path of ['/miniapp-sign/','/miniapp-sign/return/']){await page.goto(`http://127.0.0.1:3103${path}`);await page.getByText('暂无签约记录',{exact:true}).waitFor();await page.getByRole('contentinfo').getByRole('button',{name:'服务协议',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('style,[style]').count(),0);await page.getByRole('button',{name:'关闭文案'}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.goto('http://127.0.0.1:3103/miniapp-sign/');await page.getByRole('heading',{name:'我的签约'}).waitFor();await page.screenshot({path:fileURLToPath(new URL('center-desktop.png',output)),fullPage:true});
 assert.deepEqual(errors,[]);assert.ok(requests.every(host=>host==='127.0.0.1'));
 const report={mode:'local-built-bundle-with-strict-csp-and-isolated-api-fixtures',paths:['/miniapp-sign/','/miniapp-sign/return/'],inlineStyles:0,externalRequests:0,pageOrCspErrors:errors};await writeFile(new URL('production-bundle.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
