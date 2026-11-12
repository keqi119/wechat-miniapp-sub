import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {partnerOrderFixture} from './partner-order-fixture.ts';

test('actual partner app distinguishes current/future, uses scoped read-only archives and discards late private responses',{timeout:90000},async()=>{
 const root=fileURLToPath(new URL('../..',import.meta.url)),out=fileURLToPath(new URL('../../../../tmp/admin-partner-renewal-workspace-baseline/browser/',import.meta.url));
 await mkdir(out,{recursive:true});const server=await createServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'test-strict-mode',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/owner/main.tsx'))return code.replace("import {createRoot}","import {StrictMode} from 'react';\nimport {createRoot}").replace('<FeedbackProvider>','<StrictMode><FeedbackProvider>').replace('</FeedbackProvider>','</FeedbackProvider></StrictMode>');}}]});
 await server.listen();const origin=`http://127.0.0.1:${(server.httpServer!.address() as any).port}`,browser=await chromium.launch({channel:'chrome',headless:true}),report:any={requests:[],screenshots:[],errors:[]};
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));let revoked=false,raceStatus=0,count=0,release:undefined|(()=>Promise<void>),failure=0;
   async function releaseHeld(){assert.ok(release);await release();}
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());assert.equal(u.hostname,'127.0.0.1','external request is forbidden');if(!u.pathname.startsWith('/owner/api/'))return route.continue();
    const path=u.pathname.slice('/owner/api'.length);report.requests.push({path,method:route.request().method()});assert.equal(route.request().method(),'GET','no business command or signing request');let body:any={},status=200;
    const order=partnerOrderFixture();
    if(path==='/config')body={enabled:true,mode:'PARTNER_READONLY'};
    else if(path==='/legal')body={documents:['terms','privacy'].map(type=>({id:type,type,version:1,title:type,content:'仅合成文案'}))};
    else if(path==='/auth/me')body={mode:'PARTNER_READONLY',viewer:{maskedMobile:'138****0000'},csrfToken:'synthetic',expiresAt:'2099-01-01',scopes:[{ownerId:'owner',accessVersion:3}]};
    else if(path==='/owners')body=[{ownerId:'owner',name:'合成合作商',subjectType:'ENTERPRISE',mode:'PARTNER_READONLY',accessVersion:3,vehicleCount:1}];
    else if(path==='/owners/owner')body={id:'owner',name:'合成合作商',mode:'PARTNER_READONLY',accessVersion:3,subjectType:'ENTERPRISE',companyAdmin:{maskedMobile:'138****0000'}};
    else if(path.endsWith('/agreements'))body={items:[]};
    else if(path.endsWith('/cooperation-vehicles'))body={items:[],total:0,page:1,pageSize:20,models:[],agreements:[]};
    else if(path.endsWith('/revenue'))body={totals:{receivedAmount:0,refundedAmount:0,netAmount:0,partnerAmount:0,platformAmount:0},groups:[],items:[],total:0,page:1,pageSize:20,incompleteCount:0};
    else if(path.endsWith('/workbench'))body={items:[order],total:1,page:1,pageSize:20};
    else if(path.endsWith('/workspace')){
     if(raceStatus&&++count===1){release=()=>route.fulfill({contentType:'application/json',body:JSON.stringify(order)});return;}
     if(raceStatus){status=raceStatus;revoked=status===403;body={error:{code:revoked?'PARTNER_ACCESS_DENIED':'NOT_FOUND',message:revoked?'查看权限已撤销':'订单不存在'}};}else if(failure){status=failure;body={error:{code:'TEMPORARY',message:'暂时无法读取'}};}else body=order;
    }
    else if(path.endsWith('/offline-archives/archive'))body={id:'archive',kind:'ORDER_AMENDMENT',status:'ARCHIVED',canRead:true,currentApprovedVersionId:'version',revision:1,versions:[{id:'version',version:1,status:'ARCHIVED',signedOn:'2026-10-31',contractNumber:'ND-RENEWAL',files:[]}]};
    else{status=404;body={error:{code:'NOT_FOUND',message:'合成未知路径'}};}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.goto(origin+'/owner.html#/owners/owner/overview');await page.getByRole('heading',{name:'合成合作商',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'订单',exact:true}).count(),1,'actual SimpleWorkspace must expose orders');
   await page.getByRole('button',{name:'订单',exact:true}).click();await page.getByRole('button',{name:/查看订单 order/}).click();
   await page.getByRole('heading',{name:'当前租期',exact:true}).waitFor();assert.match(await page.locator('[data-period=current]').innerText(),/100\.00/);assert.match(await page.locator('[data-period=future]').innerText(),/200\.00/);assert.match(await page.locator('[data-period=future]').innerText(),/未生效|待生效/);assert.match(await page.locator('[data-period=future]').innerText(),/0 公里/);
   assert.equal(await page.getByRole('button',{name:/签署|确认续期|付款|激活/}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const screenshot=`orders-${width}.png`;await page.screenshot({path:out+'/'+screenshot,fullPage:true});report.screenshots.push(screenshot);
   await page.getByRole('button',{name:'查看续期纸质资料',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'关闭',exact:true}).click();
   failure=500;await page.getByRole('button',{name:'重新读取订单',exact:true}).click();await page.getByText('暂时无法读取',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'查看续期纸质资料',exact:true}).count(),0);failure=0;
   await page.getByRole('button',{name:'返回订单列表',exact:true}).click();await page.getByRole('button',{name:/查看订单 order/}).waitFor();raceStatus=404;count=0;release=undefined;await page.getByRole('button',{name:/查看订单 order/}).click();
   await page.getByText('订单不存在',{exact:true}).waitFor();assert.ok(release);await releaseHeld();await page.waitForTimeout(100);assert.equal(await page.getByRole('heading',{name:'当前租期',exact:true}).count(),0);assert.equal(await page.locator('.partner-dialog').count(),0);
   await page.getByRole('button',{name:'返回订单列表',exact:true}).click();await page.getByRole('button',{name:/查看订单 order/}).waitFor();raceStatus=403;count=0;release=undefined;await page.getByRole('button',{name:/查看订单 order/}).click();
   await page.waitForFunction(()=>document.body.innerText.includes('我的公司'));assert.equal(revoked,true);assert.ok(release);await releaseHeld();await page.waitForTimeout(100);assert.equal(await page.getByRole('heading',{name:'当前租期',exact:true}).count(),0);assert.equal(await page.locator('.partner-dialog').count(),0);assert.match(await page.getByRole('dialog',{name:'操作反馈'}).innerText(),/查看授权已变化/);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);await context.close();
  }
  assert.deepEqual(report.errors,[]);await writeFile(out+'/report.json',JSON.stringify(report,null,2));
 }finally{await browser.close();await server.close();}
});
