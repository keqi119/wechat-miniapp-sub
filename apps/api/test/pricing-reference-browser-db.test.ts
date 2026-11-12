import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {projectRoot} from '../src/common/config';

const root='/admin/pricing-reference';

// All business requests go through the real app and dedicated local test DB.
// Only the initial staff session and synthetic business inputs are fixtures.
test('pricing browser uses real API and DB for frozen reference, dirty inputs, review and scoped draft',
 {skip:process.env.NODE_ENV!=='test',timeout:180000},async()=>{
  assert.equal(process.env.MVP_TEST_GUARD,'local-project-v1','Use scripts/run-mvp-api-tests.mjs');
  const h=new JourneyHarness();
  let browser:any;
  try{
   await h.start();
   const model=await h.db.modelDefinition.create({data:{brand:'合成浏览器验收',name:h.prefix,modelYear:2024,description:'仅本地合成，不用于真实交易'}});
   const vehicle=async(label:string,purchaseAmount:number)=>h.db.vehicle.create({data:{title:h.prefix+'-'+label,brand:'合成浏览器验收',model:h.prefix,modelDefinitionId:model.id,year:2025,mileageKm:10000,city:'上海',revision:0,assetProfile:{create:{purchaseAmount,purchaseDate:new Date('2024-01-01'),firstRegistrationDate:new Date('2024-02-01'),batteryOwnership:'OWNED',batteryCapacityKwh:75,createdBy:h.maker.id,updatedBy:h.maker.id}}}});
   const [one,two,outside]=await Promise.all([vehicle('浏览器一',20000000),vehicle('浏览器二',10000000),vehicle('未选车辆',20000000)]);
   const scenario=await h.post(root+'/scenarios',{...command(),payload:{name:h.prefix+' 浏览器经营场景',managementVehicleCount:10,monthlyManagementBudgetCents:1200000,occupancyRate:0.8,targetAnnualRoa:0.1,expectedMonthlyMileageKm:1000,variableCostPerOccupiedMonthCents:5000,otherFixedMonthlyCostCents:0,disposalCostCents:0,oneTimeCostCents:0,notes:'本地合成；管理预算已包含全部管理成本'}});
   const curve=await h.post(root+'/curves',{...command(),payload:{name:h.prefix+' 浏览器曲线',modelDefinitionId:model.id,year:2024,batteryOwnership:'OWNED',batteryCapacityKwh:75,configuration:'',mileageMinKm:0,mileageMaxKm:300000,condition:'正常车况',effectiveFrom:'2024-01-01',valuationDate:'2024-01-01',source:'MANUAL',sourceNotes:'本地合成估值假设',points:[{ageMonths:0,coefficient:1},{ageMonths:12,coefficient:0.8},{ageMonths:24,coefficient:0.6},{ageMonths:36,coefficient:0.4}]}});

   // Never persist the bundle: it contains an ephemeral synthetic CSRF token.
   const adminRoot=resolve(projectRoot,'apps/admin'),adminRequire=createRequire(resolve(adminRoot,'package.json'));
   const {build}=await (new Function('url','return import(url)'))(pathToFileURL(adminRequire.resolve('vite')).href);
   const {chromium,expect}=adminRequire('@playwright/test');
   const session={user:{id:h.maker.id,username:'synthetic-browser',role:'OPERATIONS',permissions:['pricing-reference.read','pricing-reference.write','products.write','vehicles.read','benefits.read']},csrfToken:h.maker.headers['X-CSRF-Token']};
   const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PricingReferencePage} from '/src/pricing-reference';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';import '/src/product.css';api.setSession(${JSON.stringify(session)});createRoot(document.getElementById('root')).render(<main style={{padding:16,minWidth:0}}><PricingReferencePage/></main>);`;
   const built=await build({configFile:false,root:adminRoot,base:'/pricing-browser-static/',logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'pricing-browser-entry',resolveId:(id:string)=>id==='virtual:pricing-browser.tsx'?id:undefined,load:(id:string)=>id==='virtual:pricing-browser.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:pricing-browser.tsx'}}});
   const output=(Array.isArray(built)?built[0]:built).output as {fileName:string;code?:string;source?:string|Uint8Array}[];
   const adapter=h.app.getHttpAdapter(),stack=adapter.getInstance().router.stack;
   const existingLayers=stack.length;
   for(const asset of output)adapter.get('/pricing-browser-static/'+asset.fileName,(_req:any,res:any)=>{res.type(asset.fileName.endsWith('.js')?'text/javascript':asset.fileName.endsWith('.css')?'text/css':'application/octet-stream').send(asset.code??asset.source);});
   const js=output.find(a=>a.fileName.endsWith('.js'))!;
   const styles=output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/pricing-browser-static/${a.fileName}">`).join('');
   adapter.get('/pricing-qa',(_req:any,res:any)=>res.type('text/html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">${styles}</head><body><div id="root"></div><script type="module" src="/pricing-browser-static/${js.fileName}"></script></body></html>`));
   // JourneyHarness has already installed Nest's terminal 404 middleware.
   // Put only these exact static test routes before it; API layers stay intact.
   stack.unshift(...stack.splice(existingLayers));
   process.env.ADMIN_ORIGIN=h.base;
   h.maker.headers.Origin=h.base;
   browser=await chromium.launch({channel:'chrome',headless:true});
   const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
   await context.addCookies([{name:'admin_session',value:h.maker.headers.Cookie.slice('admin_session='.length),url:h.base}]);
   const page=await context.newPage(),errors:string[]=[],external:string[]=[],apiFailures:string[]=[],writes:string[]=[];
   page.on('pageerror',(error:Error)=>errors.push(error.message));
   page.on('console',(message:any)=>{if(message.type()==='error')errors.push(message.text());});
   page.on('response',(response:any)=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')&&response.status()>=400)apiFailures.push(response.status()+' '+url.pathname);});
   await context.route('**/*',async(route:any)=>{const url=new URL(route.request().url());if(url.origin!==h.base){external.push(url.origin);await route.abort();return;}if(route.request().method()==='POST')writes.push(url.pathname);await route.continue();});
   const artifacts=resolve(projectRoot,'.runtime/pricing-reference');await mkdir(artifacts,{recursive:true});
   const waitPost=(path:string)=>page.waitForResponse((response:any)=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api'+path);
   await page.goto(h.base+'/pricing-qa');
   await expect(page.getByRole('heading',{name:'产品定价参考',exact:true})).toBeVisible();
   await expect(page.getByLabel('经营场景版本')).toContainText(scenario.payload.name);
   await page.getByLabel('经营场景版本').selectOption(scenario.id);
   await page.getByLabel('定价日期',{exact:true}).fill('2025-02-01');
   await page.getByLabel('预计车辆退出日期').fill('2026-02-01');
   await page.getByLabel('品牌',{exact:true}).fill('合成浏览器验收');
   await page.getByLabel('车型',{exact:true}).fill(h.prefix);
   await page.getByRole('button',{name:'筛选车辆',exact:true}).click();
   await page.getByLabel('选择车辆 '+one.title,{exact:true}).check();
   await page.getByLabel('选择车辆 '+two.title,{exact:true}).check();
   await page.getByRole('button',{name:'按车型 / 年款 / 电池重新分组'}).click();
   await expect(page.getByLabel('产品名称',{exact:true})).toBeVisible();
   await page.getByLabel('产品名称',{exact:true}).fill(h.prefix+' 浏览器分组产品');
   await page.getByRole('checkbox',{name:'已核对',exact:true}).check();
   await page.getByLabel('客户电池租赁费用',{exact:true}).selectOption('NOT_APPLICABLE');
   for(const [label,value] of [['基础使用费（元/月）','4000'],['里程包月费（元）','200'],['每月包含里程（km）','1500'],['超里程单价（元/km）','1.50'],['额外换车单次服务费（元）','500'],['适用条件','本地合成浏览器验收，不用于真实交易']])await page.getByLabel(label,{exact:true}).fill(value);
   for(const car of [one,two]){
    const detail=page.locator('details').filter({has:page.locator('summary').filter({hasText:car.title})});
    await detail.locator('summary').click();
    await detail.getByLabel('保险缺覆盖月预算（元）',{exact:true}).fill('100');
    await detail.getByLabel('预算 / 配置确认依据',{exact:true}).fill('本地合成正常车况与未来保险预算');
    await detail.getByLabel('已核对车况与曲线适用条件',{exact:true}).check();
    await detail.getByLabel('明确选用曲线版本').selectOption(curve.id);
   }
   const createResponse=waitPost(root+'/runs');
   await page.getByRole('button',{name:'生成新的冻结测算记录',exact:true}).click();
   const response=await createResponse;assert.equal(response.status(),201);
   const run=await response.json(),frozen=structuredClone(run.snapshot);
   await expect(page.getByText('输入与本记录一致，可采用分组草稿。',{exact:true})).toBeVisible();
   await expect(page.getByText(/已选 2 辆 · 可测算 2 辆/)).toBeVisible();
   assert.equal(run.snapshot.result.calculableCount,2);
   assert.equal(run.snapshot.result.vehicles.find((v:any)=>v.vehicleId===one.id).currentValueCents,16000000);
   assert.equal(run.snapshot.result.groups[0].baseFeeCapCents,280000);
   const groupKey=run.snapshot.groups[0].groupKey;
   await page.screenshot({path:resolve(artifacts,'browser-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:resolve(artifacts,'browser-narrow.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Narrow viewport must contain page overflow');
   await page.setViewportSize({width:1440,height:1100});
   await page.getByLabel('基础使用费（元/月）',{exact:true}).fill('4100');
   await expect(page.getByText('输入已变化，原参考仅供查看；请生成新记录。',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'仅将此组保存为独立产品草稿',exact:true})).toBeDisabled();

   // Exercise datetime-local conversion and the real versioned parameter write.
   await page.getByRole('button',{name:'场景 / 曲线 / review',exact:true}).click();
   await page.getByLabel('参数类型').selectOption('reviews');
   for(const [label,value] of [['车辆 ID',one.id],['估值对应日期','2025-02-01'],['生效时间','2025-02-01T09:30'],['估值车龄（月）','12'],['估值里程 km','10000'],['车辆资产估值（元，处置费另计）','170000'],['所用曲线版本 ID（可空）',curve.id],['估值 / 修正 / 撤回依据','本地合成浏览器 review，只影响后续新测算']])await page.getByLabel(label,{exact:true}).fill(value);
   const reviewResponse=waitPost(root+'/reviews');
   await page.getByRole('button',{name:'保存新参数版本',exact:true}).click();
   const reviewHttp=await reviewResponse;assert.equal(reviewHttp.status(),201);
   const review=await reviewHttp.json();
   assert.equal(review.payload.valueCents,17000000);
   assert.equal(review.payload.effectiveAt,'2025-02-01T01:30:00.000Z');
   const savedReview=await h.db.pricingReferenceParameter.findUniqueOrThrow({where:{id:review.id}});
   assert.equal(savedReview.kind,'REVIEW');assert.equal((savedReview.payload as any).vehicleId,one.id);

   // A real delayed history GET must not override edits made while it was in flight.
   const historyUrl=h.base+'/api'+root+'/runs/'+run.id;
   let releaseHistory!:()=>void,historySeen!:()=>void;
   const heldHistory=new Promise<void>(resolve=>{releaseHistory=resolve;}),seenHistory=new Promise<void>(resolve=>{historySeen=resolve;});
   const delayHistory=async(route:any)=>{historySeen();await heldHistory;await route.continue();};
   await page.route(historyUrl,delayHistory);
   await page.getByRole('button',{name:'测算历史',exact:true}).click();
   const lateHistory=page.waitForResponse((r:any)=>r.url()===historyUrl&&r.request().method()==='GET');
   await page.getByRole('button',{name:new RegExp(run.id)}).click();await seenHistory;
   await page.getByRole('button',{name:'测算与选车',exact:true}).click();
   await page.getByLabel('基础使用费（元/月）',{exact:true}).fill('4200');
   releaseHistory();assert.equal((await lateHistory).status(),200);
   await expect(page.getByRole('heading',{name:'历史冻结记录 · '+run.id,exact:true})).toHaveCount(0);
   await expect(page.getByRole('button',{name:'仅将此组保存为独立产品草稿',exact:true})).toBeDisabled();
   await page.unroute(historyUrl,delayHistory);

   const writesBeforeHistory=writes.length;
   await page.getByRole('button',{name:'测算历史',exact:true}).click();
   await page.getByRole('button',{name:new RegExp(run.id)}).click();
   await expect(page.getByRole('heading',{name:'历史冻结记录 · '+run.id,exact:true})).toBeVisible();
   assert.equal(writes.length,writesBeforeHistory,'Opening history must not recompute or write');
   assert.deepEqual((await h.get(root+'/runs/'+run.id)).snapshot,frozen);
   await expect(page.getByRole('button',{name:'仅将此组保存为独立产品草稿',exact:true})).toBeEnabled();
   const adoptResponse=waitPost(root+'/runs/'+run.id+'/groups/'+encodeURIComponent(groupKey)+'/drafts');
   await page.getByRole('button',{name:'仅将此组保存为独立产品草稿',exact:true}).click();
   const adoptedHttp=await adoptResponse;assert.equal(adoptedHttp.status(),201);
   const adopted=await adoptedHttp.json();
   await expect(page.getByRole('link',{name:'查看产品草稿',exact:true})).toBeVisible();
   const product=await h.db.productVersion.findUniqueOrThrow({where:{id:adopted.productVersionId}});
   assert.equal(product.status,'DRAFT');assert.equal(product.baseFeeAmount,400000,'Historical adoption uses the frozen price');
   assert.deepEqual([...product.vehicleIds].sort(),[one.id,two.id].sort());
   assert.deepEqual(product.modelDefinitionIds,[]);assert(!product.vehicleIds.includes(outside.id));
   assert.equal(await h.db.vehicleListing.count({where:{productVersionId:product.id}}),0);
   assert.equal(await h.db.pricingReferenceAdoption.count({where:{runId:run.id,groupKey}}),1);
   assert.equal(await h.db.pricingReferenceRun.count({where:{createdBy:h.maker.id}}),1);
   assert.deepEqual((await h.get(root+'/runs/'+run.id)).snapshot,frozen);
   assert.deepEqual(apiFailures,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   assert.equal(h.externalCalls+h.esignCalls+h.identityCalls+h.payment.providerCalls,0);
  }catch(error){
   const page=browser?.contexts()[0]?.pages()[0];
   if(page){await mkdir(resolve(projectRoot,'.runtime/pricing-reference'),{recursive:true});await page.screenshot({path:resolve(projectRoot,'.runtime/pricing-reference/browser-failure.png'),fullPage:true}).catch(()=>{});}
   throw error;
  }finally{if(browser)await browser.close();await h.close();}
 });
