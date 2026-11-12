import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {createServer,type ViteDevServer} from 'vite';
import {publicationReadyFixture} from './vehicle-publication.test-support.ts';
import {chromium,expect,type Browser} from '@playwright/test';

let server:ViteDevServer,browser:Browser,origin:string;
const evidence=fileURLToPath(new URL('../../../.runtime/vehicle-publish-20261103/ui-review/',import.meta.url));
before(async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';createRoot(document.getElementById('root')).render(React.createElement(App));`;
 server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',cacheDir:evidence+'vite-cache',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0},plugins:[{name:'vehicle-publish-test',configureServer(s){s.middlewares.use('/publish.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/publish-entry.js"></script></body></html>');});},resolveId:id=>id==='/publish-entry.js'?'\0publish-entry':null,load:id=>id==='\0publish-entry'?entry:null}]});
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;browser=await chromium.launch({channel:'chrome',headless:true});await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();await server?.close();});

async function fixture(options:{status?:string;disclosure?:string;code?:string;visible?:boolean}={}){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.setDefaultNavigationTimeout(60000);
 const errors:string[]=[],violations:string[]=[],writes:{path:string;body:any}[]=[];let detailReads=0;
 const entity={id:'car',title:'合成激活车辆',vin:'TESTVIN0000000001',plateNumber:'沪A合成',brand:'合成品牌',model:'合成车型',year:2024,city:'上海',status:options.status??'DRAFT',revision:1,mileageKm:1000,conditionDisclosure:options.disclosure??'',reservedOrderId:null,catalogPublished:false};
 const session={user:{id:'publish-test',username:'本地合成员工',role:'OPERATIONS',permissions:['vehicles.read','vehicles.write','goods.read']},csrfToken:'synthetic-csrf'};
 const good={id:'good',revision:1,status:'PUBLISHED',visible:options.visible??true,recommended:false,sortOrder:0,vehicleId:'car',productVersionId:'version',subscriptionPlanId:'plan',source:'EXPLICIT',vehicle:{id:'car',title:entity.title,status:entity.status,catalogPublished:false},appDisplay:{state:'NOT_VISIBLE',visible:false,available:false,reasons:[{code:'CATALOG_NOT_PUBLISHED',message:'商品尚未上架'}],checkedAt:'2026-11-05T00:00:00Z'},productVersion:{id:'version',version:1,name:'合成已发布订阅产品',status:'PUBLISHED'},plan:{id:'plan',name:'合成套餐',months:12,monthlyFeeAmount:439900,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'客户自付',conditions:'合成条款',benefits:[]}};
 await page.addInitScript(()=>{(window as any).publishToastHistory=[];new MutationObserver(()=>{const text=document.querySelector('.toast')?.textContent;if(text)(window as any).publishToastHistory.push(text);}).observe(document,{childList:true,subtree:true,characterData:true});});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){violations.push('external request');return route.abort();}if(!url.pathname.startsWith('/api/'))return route.continue();
  const path=url.pathname.slice(4);
  if(request.method()==='GET'){
   if(path==='/admin/auth/me')return route.fulfill({json:session});
   if(path==='/admin/vehicles/filter-options')return route.fulfill({json:{items:[],total:0,page:1,pageSize:100,ageAsOf:'2026-11-05'}});
   if(path==='/admin/vehicles')return route.fulfill({json:{items:[entity],total:1,page:1,pageSize:12}});
   if(path==='/admin/vehicles/car'){detailReads++;return route.fulfill({json:entity});}
   if(path==='/admin/goods')return route.fulfill({json:{items:[good],total:1,page:1,pageSize:20}});
   if(path==='/admin/vehicles/car/publish-readiness'){const result=publicationReadyFixture('car',entity.revision);if(!entity.conditionDisclosure.trim()){result.ready=false;result.checks[6]={...result.checks[6],passed:false,messages:['请完善基础车况判断'] as string[]};}return route.fulfill({json:result});}
   if(path==='/admin/vehicles/car/catalog/readiness'){const result=publicationReadyFixture('car',entity.revision);if(!entity.conditionDisclosure.trim()){result.ready=false;result.checks[6]={...result.checks[6],passed:false,messages:['请完善基础车况判断'] as string[]};}const activated=entity.status==='PUBLISHED';return route.fulfill({json:{...result,catalogPublished:false,vehicleActivated:activated,publishedPlanCount:1,ready:result.ready&&activated,blockers:activated?[]:[{code:'VEHICLE_NOT_ACTIVATED',message:'车辆未激活'}]}});}
   if(path==='/admin/vehicles/car/photos')return route.fulfill({json:{vehicleId:'car',vehicleRevision:entity.revision,coverFileId:null,mediaFileIds:[],items:[]}});
   if(path==='/admin/vehicles/car/inspections')return route.fulfill({json:{vehicleId:'car',items:[]}});
   if(path==='/admin/goods/good/app-preview')return route.fulfill({json:{listingId:'good',listingRevision:good.revision,vehicleId:'car',vehicleRevision:entity.revision,mode:'DRAFT_PREVIEW',materials:{title:entity.title,description:'合成说明',conditionDisclosure:entity.conditionDisclosure},appDisplay:good.appDisplay,vehicle:{id:'car',name:entity.title,brand:entity.brand,city:entity.city,tagline:'合成说明',registrationText:'2024年上牌',mileageText:'1000km',bodyType:entity.model,rangeText:'',statusText:'暂不可申请',available:false,coverFileId:null,mediaFileIds:[]},selectedPlan:{id:'plan',listingId:'good',productVersionId:'version',title:good.productVersion.name,monthlyFeeAmount:good.plan.monthlyFeeAmount,monthlyFeeText:'¥4399.00',termMonths:12,mileageText:'每月1500公里',energyText:'客户自付',notes:'合成条款',excessMileagePriceAmount:150,depositText:'审核后确认',benefits:[],benefitDetails:[],available:false},report:{summary:'车况披露',items:[],notice:'以实际交付为准'}}});

  }
  if(request.method()==='POST'&&path==='/admin/vehicles/car/publish'){
   const body=request.postDataJSON();writes.push({path,body});assert.equal(request.headers()['x-csrf-token'],'synthetic-csrf');assert.ok(body.idempotencyKey);
   const code=options.code??'ACTIVATION_REQUIREMENTS';if(code==='SUCCESS'){entity.status='PUBLISHED';entity.revision=2;return route.fulfill({json:entity});}if(['REVISION_CONFLICT','VERSION_CONFLICT'].includes(code))entity.revision=2;
   return route.fulfill({status:409,json:{error:{code,message:code==='ACTIVATION_REQUIREMENTS'?'请先补齐车辆基本信息':code==='VEHICLE_RESERVED'?'车辆已被占用':'车辆资料已变化，请刷新后核对'},requestId:'synthetic-publish-request'}});
  }
  violations.push(request.method()+' '+path);return route.fulfill({status:404,json:{error:{code:'UNEXPECTED_FIXTURE_ROUTE'}}});
 });
 await page.goto(origin+'/publish.html#vehicles?record=car&view=listing');await expect(page.getByRole('article',{name:'合成已发布订阅产品'})).toBeVisible();
 return{page,entity,errors,violations,writes,detailReads:()=>detailReads};
}

for(const code of ['ACTIVATION_REQUIREMENTS','VEHICLE_RESERVED']){
 test(`business refusal ${code} shows the request error without a false record-updated receipt`,{timeout:90000},async()=>{
  const f=await fixture({code});try{
   await f.page.getByRole('button',{name:'激活车辆',exact:true}).click();const form=f.page.locator('.record-form');await form.getByRole('checkbox').check();const before=f.detailReads();await form.getByRole('button',{name:'激活车辆',exact:true}).click();
   await expect(form.getByRole('alert')).toContainText(code==='ACTIVATION_REQUIREMENTS'?'请先补齐车辆基本信息':'车辆已被占用');await expect(form.getByRole('alert')).toContainText('synthetic-publish-request');
   await expect.poll(f.detailReads).toBeGreaterThan(before);await expect(form.getByRole('checkbox')).toBeChecked();assert.deepEqual(await f.page.evaluate(()=>(window as any).publishToastHistory),[],'business refusal must never render a success-style toast, even one that later expires');
   assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.revision,1);assert.equal(f.entity.status,'DRAFT');assert.deepEqual(f.errors,[]);assert.deepEqual(f.violations,[]);
  }finally{await f.page.close();}
 });
}
for(const code of ['REVISION_CONFLICT','VERSION_CONFLICT']){
 test(`real ${code} still refreshes and preserves confirmation with the new revision`,{timeout:90000},async()=>{
  const f=await fixture({code,disclosure:'本地合成披露'});try{
   await f.page.getByRole('button',{name:'激活车辆',exact:true}).click();const form=f.page.locator('.record-form');await form.getByRole('checkbox').check();const before=f.detailReads();await form.getByRole('button',{name:'激活车辆',exact:true}).click();await expect.poll(f.detailReads).toBeGreaterThan(before);
   await expect(form.getByRole('checkbox')).toBeChecked();await expect(f.page.locator('.toast')).toContainText('记录已更新，输入已保留');await expect(form.getByRole('button',{name:'激活车辆',exact:true})).toBeEnabled();await form.getByRole('button',{name:'激活车辆',exact:true}).click();
   await expect.poll(()=>f.writes.length).toBe(2);assert.equal(f.writes[1].body.revision,2);assert.notEqual(f.writes[0].body.idempotencyKey,f.writes[1].body.idempotencyKey);assert.deepEqual(f.errors,[]);assert.deepEqual(f.violations,[]);
  }finally{await f.page.close();}
 });
}
for(const status of ['DRAFT','UNPUBLISHED']){
 test(`${status} vehicle does not claim actual App visibility from its published product setting`,{timeout:90000},async()=>{
  const f=await fixture({status,disclosure:status==='DRAFT'?'   ':'本地合成披露'});try{
   const card=f.page.getByRole('article',{name:'合成已发布订阅产品'});await expect(card.getByText('方案已上架',{exact:true})).toBeVisible();await expect(card).toContainText('展示设置');await expect(card).toContainText('允许展示');await expect(card).not.toContainText('对客可见');await expect(card).toContainText('车辆未激活，当前不在App展示');
   const condition=f.page.locator('[data-publish-check=\"CONDITION\"]');if(status==='DRAFT')await expect(condition).toContainText('待补全');else await expect(condition).toContainText('已完成');
   assert.equal(f.writes.length,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.violations,[]);if(status==='DRAFT')await f.page.screenshot({path:evidence+'draft-published-product.png',fullPage:true});
  }finally{await f.page.close();}
 });
}
for(const visible of [true,false]){
 test(`published vehicle preserves ${visible?'allowed':'hidden'} product display setting without a false missing-disclosure warning`,{timeout:90000},async()=>{
  const f=await fixture({status:'PUBLISHED',disclosure:'本地合成披露',visible});try{
   const card=f.page.getByRole('article',{name:'合成已发布订阅产品'});await expect(card).toContainText(visible?'允许展示':'隐藏');await expect(card).not.toContainText('车辆未激活');await expect(f.page.getByText('车况披露未填写，请点击“编辑车辆”补充真实车况后再上架。',{exact:true})).toHaveCount(0);assert.equal(f.writes.length,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.violations,[]);
  }finally{await f.page.close();}
 });
}
test('successful vehicle publication clears the cached product notice without remounting or manually refreshing slots',{timeout:90000},async()=>{
 const f=await fixture({code:'SUCCESS',disclosure:'本地合成披露'});try{
  const card=f.page.getByRole('article',{name:'合成已发布订阅产品'});await expect(card).toContainText('车辆未激活');await f.page.getByRole('button',{name:'激活车辆',exact:true}).click();const form=f.page.locator('.record-form');await form.getByRole('checkbox').check();await form.getByRole('button',{name:'激活车辆',exact:true}).click();
  await expect(form).toHaveCount(0);await expect(f.page.getByRole('button',{name:'停用车辆',exact:true})).toBeVisible();await expect(card).not.toContainText('车辆未激活');await expect(card.getByText('方案已上架',{exact:true})).toBeVisible();await expect(f.page.getByRole('region',{name:'商品上架控制',exact:true})).toContainText('商品未上架');assert.equal(f.writes.length,1);assert.deepEqual(f.errors,[]);assert.deepEqual(f.violations,[]);
 }finally{await f.page.close();}
});
