// Isolated fixture: never sends requests to SMS, production, or the signature provider.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url))); 
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://local').pathname,target=resolve(root,path==='/owner/'?'owner.html':path.replace(/^\/owner\//,''));if(!target.startsWith(root+sep)){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(target)]||'application/octet-stream');res.end(await readFile(target));}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);
 let logged=false,refresh=0,readFailure=false,delayRead=false,releaseRead,projection='REFRESH_REQUIRED';
 const display=()=>({state:projection,label:projection==='READY'?'已核验':'待更新核验',message:'企业曾通过认证，核验记录需要更新。',certification:{state:projection==='READY'?'VERIFIED':'REFRESH_REQUIRED',label:projection==='READY'?'证书已核验':'待更新核验',message:'仅需重新查询，不能据此判断证书失效。'},seal:{state:projection==='READY'?'READY':'REFRESH_REQUIRED',label:projection==='READY'?'已选用并核验':'已选用，待更新核验',message:'原印章选择保留。'},checkedAt:'2026-10-21T17:51:36Z'});
 const detail=id=>({id,name:`合成企业${id}`,status:'VERIFIED',memberStatus:'VERIFIED',realNameStatus:'VERIFIED',certStatus:'BOUND',creditCode:'QA',address:'测试地址',revision:1,certificationComplete:projection==='READY',readyForSigning:projection==='READY',verificationDisplay:display(),seals:[{id:'seal-1',status:'ACTIVE',checkedAt:'2026-10-21T17:51:36Z',imageHash:'a'.repeat(64)}],legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:true,canRefreshVerification:true,canSelectSeal:false,canRequestAuthority:false,canManageAuthority:false,canEnableAuthority:false},blockers:projection==='READY'?[]:['企业核验记录需要更新，请重新核验企业与证书状态。','已选用印章，请更新核验。']});
 await page.route('**/*',async route=>{const url=new URL(route.request().url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/owner/api/'))return route.continue();const path=url.pathname.slice(10),json=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
 if(path==='/config')return json({enabled:true});if(path==='/legal')return json({documents:['terms','privacy','owner-identity'].map(type=>({id:type,type,version:1,title:type,content:'合成文案'}))});
 if(path==='/auth/me')return logged?json({customer:{id:'customer',maskedMobile:'138****0000'},csrfToken:'fixture',expiresAt:'2099-01-01T00:00:00Z'}):json({error:{code:'SESSION_REQUIRED',message:'请登录'}},401);
 if(path==='/auth/sms/request')return json({});if(path==='/auth/login'){logged=true;return json({customer:{id:'customer',maskedMobile:'138****0000'},csrfToken:'fixture',expiresAt:'2099-01-01T00:00:00Z'});}
 if(path==='/auth/logout'){logged=false;return json({});}
 if(path==='/owners')return json(['1','2'].map(ownerId=>({ownerId,name:detail(ownerId).name,status:'VERIFIED',memberStatus:'VERIFIED',verificationDisplay:display()})));
 if(/^\/owners\/[12]$/.test(path)){if(delayRead)await new Promise(done=>releaseRead=done);return readFailure?json({error:{code:'OWNER_CERT_REFRESH_REQUIRED',message:'请更新企业证书核验记录。'}},409):json(detail(path.split('/')[2]));}
 if(path.endsWith('/authorities'))return json([]);if(path.endsWith('/image'))return json({imageType:'png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGMAAAAASUVORK5CYII='});
 if(path.endsWith('/refresh')){refresh++;readFailure=false;projection='READY';return json(detail('1'));}
 if(path.endsWith('/contracts')||path.endsWith('/handovers'))return json({items:[],manualSigningEnabled:true});
 return json({error:{code:'UNEXPECTED_ROUTE',message:path}},404);
 });
 const dialog=page.getByRole('dialog',{name:'操作反馈'}),close=async()=>{await dialog.getByRole('button',{name:'关闭反馈',exact:true}).click();await dialog.waitFor({state:'hidden'});};
 await page.goto(origin+'/owner/');
 // Local validation must re-open even when the user repeats the same invalid action.
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'获取验证码',exact:true}).click();await dialog.getByText('请输入正确的 11 位法人手机号。',{exact:true}).waitFor();assert.equal(await page.locator('main > .notice').count(),0);await close();}
 await page.getByLabel('法人手机号',{exact:true}).fill('13800000000');await page.getByRole('button',{name:'获取验证码',exact:true}).click();await dialog.getByText(/验证码请求已受理/).waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('modal-open')),false);
 await page.getByPlaceholder('6 位验证码').fill('123456');await page.getByRole('checkbox').check();await page.getByRole('button',{name:/登录企业车主中心/}).click();await page.getByRole('heading',{name:'我的企业',exact:true}).waitFor();
 await page.getByRole('button',{name:/合成企业1/}).click();await page.getByRole('heading',{name:'合成企业1',exact:true}).waitFor();assert.equal(await page.locator('.detail-heading .tag').innerText(),'待更新核验');assert.equal(await page.locator('.seal-card .tag').innerText(),'已选用，待更新核验');assert.equal(await page.locator('.seal-card .tag.done').count(),0);assert.equal(await page.getByText('已核验',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/由法人本人办理认证/}).count(),0);await page.screenshot({path:resolve(root,'../qa/owner-readiness-stale-390.png'),fullPage:true});
 // A delayed response may arrive while a legal document is open: only the top dialog handles keys.
 delayRead=true;readFailure=true;await page.getByRole('button',{name:'重新读取企业资料',exact:true}).click();await page.locator('.footer').getByRole('button',{name:'服务协议',exact:true}).click();await page.getByRole('dialog',{name:'服务协议'}).waitFor();delayRead=false;releaseRead();await dialog.waitFor();assert.equal(await page.getByRole('dialog').count(),2);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('modal-open')),true);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 // Same backend error, dismissal, focus restore, then retry; recovery button stays in the dialog.
 readFailure=true;const read=page.getByRole('button',{name:'重新读取企业资料',exact:true});await read.click();await dialog.getByText('请更新企业证书核验记录。',{exact:false}).waitFor();for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(root,`../qa/owner-feedback-dialog-${width}.png`)});}await close();assert.equal(await read.evaluate(el=>document.activeElement===el),true);await read.click();await dialog.getByText('请更新企业证书核验记录。',{exact:false}).waitFor();await dialog.getByRole('button',{name:'重新核验证书',exact:true}).click();await dialog.getByText('已主动查询企业认证与证书状态。',{exact:true}).waitFor();assert.equal(refresh,1);await close();assert.equal(await page.locator('.detail-heading .tag').innerText(),'已核验');
 await page.getByRole('button',{name:'重新读取企业资料',exact:true}).click();await dialog.getByText('已重新读取企业资料。',{exact:true}).waitFor();await page.locator('#tab-authority').evaluate(el=>el.click());await dialog.waitFor({state:'hidden'});await page.getByRole('tab',{name:'企业与印章',exact:true}).click();assert.equal(await dialog.count(),0);
 await page.getByRole('button',{name:/返回我的企业/}).click();await page.getByRole('button',{name:/合成企业2/}).click();assert.equal(await dialog.count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log(JSON.stringify({passed:true,checks:['repeat-validation-dialog','sms-dialog','escape-scroll-restore','stale-status-consistent','selected-seal-not-missing','backend-error-repeat','focus-restore','certificate-recovery','tab-and-owner-isolation','no-top-feedback','mobile-layout']}));
}finally{await browser.close();await new Promise(done=>server.close(done));}



