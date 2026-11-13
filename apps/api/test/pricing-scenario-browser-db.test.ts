import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {projectRoot} from '../src/common/config';

const root='/admin/pricing-reference';
const artifacts=resolve(projectRoot,'.runtime/scenario-cost-v2/browser');

/** Real browser -> HTTP -> append-only local DB -> real pricing engine. */
test('scenario cards save v2 and group terms drive repeat marketing and bad debt without rewriting history',
 {skip:process.env.NODE_ENV!=='test',timeout:180000},async()=>{
  assert.equal(process.env.MVP_TEST_GUARD,'local-project-v1');
  const h=new JourneyHarness();let browser:any;
  try{
   await h.start();await mkdir(artifacts,{recursive:true});
   const model=await h.db.modelDefinition.create({data:{brand:'合成场景卡片',name:h.prefix,modelYear:2024,description:'本地隔离测试'}});
   const vehicle=async(label:string)=>h.db.vehicle.create({data:{title:h.prefix+label,brand:'合成场景卡片',model:h.prefix,modelDefinitionId:model.id,year:2024,mileageKm:10000,city:'上海',revision:0,assetProfile:{create:{purchaseAmount:20000000,purchaseDate:new Date('2024-01-01'),firstRegistrationDate:new Date('2024-02-01'),batteryOwnership:'OWNED',batteryCapacityKwh:75,createdBy:h.maker.id,updatedBy:h.maker.id}}}});
   const [one,two]=await Promise.all([vehicle('甲'),vehicle('乙')]);
   await h.post(root+'/curves',{...command(),payload:{name:h.prefix+'曲线',modelDefinitionId:model.id,year:2024,batteryOwnership:'OWNED',batteryCapacityKwh:75,configuration:'',mileageMinKm:0,mileageMaxKm:300000,condition:'正常',effectiveFrom:'2024-01-01',valuationDate:'2024-01-01',source:'MANUAL',sourceNotes:'合成测试',points:[{ageMonths:0,coefficient:1},{ageMonths:12,coefficient:.8},{ageMonths:24,coefficient:.6},{ageMonths:36,coefficient:.4}]}});

   const adminRoot=resolve(projectRoot,'apps/admin'),req=createRequire(resolve(adminRoot,'package.json'));
   const {build}=await (new Function('url','return import(url)'))(pathToFileURL(req.resolve('vite')).href);
   const {chromium,expect}=req('@playwright/test');
   const session={user:{id:h.maker.id,username:'scenario-local',role:'OPERATIONS',permissions:['pricing-reference.read','pricing-reference.write','products.write','vehicles.read','benefits.read']},csrfToken:h.maker.headers['X-CSRF-Token']};
   const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PricingReferencePage} from '/src/pricing-reference';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';import '/src/product.css';api.setSession(${JSON.stringify(session)});createRoot(document.getElementById('root')).render(<main style={{padding:16,minWidth:0}}><PricingReferencePage/></main>);`;
   const built=await build({configFile:false,root:adminRoot,base:'/scenario-static/',logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'scenario-entry',resolveId:(id:string)=>id==='virtual:scenario.tsx'?id:undefined,load:(id:string)=>id==='virtual:scenario.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:scenario.tsx'}}});
   const output=(Array.isArray(built)?built[0]:built).output as {fileName:string;code?:string;source?:string|Uint8Array}[];
   const adapter=h.app.getHttpAdapter(),stack=adapter.getInstance().router.stack,before=stack.length;
   for(const a of output)adapter.get('/scenario-static/'+a.fileName,(_req:any,res:any)=>res.type(a.fileName.endsWith('.js')?'text/javascript':'text/css').send(a.code??a.source));
   const styles=output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/scenario-static/${a.fileName}">`).join('');
   adapter.get('/scenario-qa',(_req:any,res:any)=>res.type('text/html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">${styles}</head><body><div id="root"></div><script type="module" src="/scenario-static/${output.find(a=>a.fileName.endsWith('.js'))!.fileName}"></script></body></html>`));
   stack.unshift(...stack.splice(before));process.env.ADMIN_ORIGIN=h.base;h.maker.headers.Origin=h.base;
   browser=await chromium.launch({channel:'chrome',headless:true});
   const context=await browser.newContext({viewport:{width:1600,height:1100},timezoneId:'Asia/Shanghai'});
   await context.addCookies([{name:'admin_session',value:h.maker.headers.Cookie.slice('admin_session='.length),url:h.base}]);
   const page=await context.newPage(),errors:string[]=[],external:string[]=[];
   page.on('pageerror',(error:Error)=>errors.push(error.message));
   await context.route('**/*',async(route:any)=>{if(new URL(route.request().url()).origin!==h.base){external.push(route.request().url());await route.abort();}else await route.continue();});
   await page.goto(h.base+'/scenario-qa');
   await page.getByRole('button',{name:'场景 / 曲线 / review',exact:true}).click();
   // Labels are the business inputs, not internal payload names.
   const values:Record<string,string>={
    '场景名称':h.prefix+'卡片场景','预定管理规模 N（辆）':'10','预计出租率 u（%）':'90',
    '产品期限 T（月）':'6','复购率 r（%）':'40','坏账率 d（%）':'10','每出租月预计里程（km）':'1000',
    '参考目标年化 ROA（%，可空）':'10','BaaS 缺覆盖月预算（元）':'0','保险缺覆盖年预算（元）':'0',
    '固定推广总预算 B（元）':'1200','折算周期 L（月）':'12','每新客订单成本 Cnew（元）':'500','每复购订单成本 Crepeat（元）':'50',
    '依据说明':'本地合成；固定推广不含每单获客费用'
   };
   for(const [label,value]of Object.entries(values))await page.getByLabel(label,{exact:true}).fill(value);
   await expect(page.getByText(/576/).first()).toBeVisible();
   await page.screenshot({path:resolve(artifacts,'scenario-desktop.png'),fullPage:true});
   const cards=await page.locator('.scenario-cards > .scenario-card').evaluateAll((nodes:Element[])=>nodes.map(n=>({left:n.getBoundingClientRect().left,top:n.getBoundingClientRect().top})));
   assert.equal(cards.length,3);assert.equal(new Set(cards.map((c:any)=>Math.round(c.top))).size,1);assert.equal(new Set(cards.map((c:any)=>Math.round(c.left))).size,3);
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:resolve(artifacts,'scenario-mobile.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.setViewportSize({width:1600,height:1100});
   const savedPromise=page.waitForResponse((r:any)=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api'+root+'/scenarios');
   await page.getByRole('button',{name:'保存新参数版本',exact:true}).click();
   const savedHttp=await savedPromise;assert.equal(savedHttp.status(),201);const scenario=await savedHttp.json();
   assert.equal(scenario.payload.costModelVersion,2);assert.equal(scenario.payload.productTermMonths,6);assert.equal(scenario.payload.repeatOrderRate,.4);assert.equal(scenario.payload.badDebtRate,.1);
   assert.equal(scenario.payload.marketing.newOrderCostCents,50000);assert.equal('monthlyManagementBudgetCents' in scenario.payload,false);
   const stored=await h.db.pricingReferenceParameter.findUniqueOrThrow({where:{id:scenario.id}});assert.deepEqual(stored.payload,scenario.payload);

   await page.getByRole('button',{name:'测算与选车',exact:true}).click();
   await expect(page.getByLabel('经营场景版本')).toContainText(scenario.payload.name);
   await page.getByLabel('经营场景版本').selectOption(scenario.id);
   await page.getByLabel('品牌',{exact:true}).fill('合成场景卡片');
   await page.getByLabel('车型',{exact:true}).fill(h.prefix);
   await page.getByRole('button',{name:'筛选车辆',exact:true}).click();
   await page.getByLabel('选择车辆 '+one.title,{exact:true}).check();
   await page.getByRole('button',{name:'按车型 / 年款 / 电池重新分组',exact:true}).click();
   await expect(page.getByLabel('租期（月）',{exact:true})).toHaveValue('6');
   await page.getByLabel('租期（月）',{exact:true}).fill('3');
   await expect(page.getByLabel('租期（月）',{exact:true})).toHaveValue('3');

   const group=(groupKey:string,id:string,months:number)=>({groupKey,vehicleIds:[id],draft:{configurationVersion:2,name:'合成'+groupKey,months,minimumTermMonths:3,baseFeeAmount:400000,mileageMonthlyFeeAmount:20000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,conditions:'本地隔离验收',swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:50000},vehicleIds:[id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]}});
   const input={scenarioVersionId:scenario.id,pricingDate:'2025-02-01',exitDate:'2026-02-01',groups:[group('short',one.id,3),group('long',two.id,12)],vehicleOverrides:[one,two].map(v=>({vehicleId:v.id,conditionConfirmed:true}))};
   const run=await h.post(root+'/runs',{...command(),...input}),frozen=structuredClone(run.snapshot);
   assert.equal(run.snapshot.result.calculableCount,2);
   for(const v of run.snapshot.result.vehicles){assert.equal(v.expectedGrossRevenueCents,4536000);assert.equal(v.badDebtLossCents,453600);assert.equal(v.collectibleRevenueCents,4082400);}
   const byId=(id:string)=>run.snapshot.input.vehicles.find((v:any)=>v.vehicleId===id);
   assert.equal(byId(one.id).productTermMonths,3);assert.equal(byId(two.id).productTermMonths,12);
   assert.equal(byId(one.id).productTermSource,'GROUP');
   const variableMarketing=(id:string)=>byId(id).costBreakdown.filter((c:any)=>c.category==='MARKETING'&&c.cycles!==null).reduce((sum:number,c:any)=>sum+c.amountCents,0);
   assert.equal(variableMarketing(one.id),115200);assert.equal(variableMarketing(two.id),28800);
   await page.reload();
   await page.getByRole('button',{name:'测算历史',exact:true}).click();
   await page.getByRole('button',{name:new RegExp(run.id)}).click();
   await expect(page.getByRole('columnheader',{name:'预计应收',exact:true})).toHaveCount(2);
   await expect(page.getByRole('columnheader',{name:'坏账损失',exact:true})).toHaveCount(2);
   await expect(page.getByRole('columnheader',{name:'预计实收',exact:true})).toHaveCount(2);
   const firstGroup=page.locator('.pricing-group-result').first();
   await firstGroup.getByText('曲线 / review / 成本',{exact:true}).click();
   await expect(firstGroup.getByText('预算期限 3 月 · 本组实际产品租期',{exact:true})).toBeVisible();
   await page.screenshot({path:resolve(artifacts,'scenario-results.png'),fullPage:true});
   const next=await h.post(root+'/scenarios',{...command(scenario.revision),lineageId:scenario.lineageId,payload:{...scenario.payload,badDebtRate:1}});
   const allBad=await h.post(root+'/preview',{...input,scenarioVersionId:next.id});
   assert.equal(allBad.result.calculableCount,2);for(const v of allBad.result.vehicles){assert.equal(v.collectibleRevenueCents,0);assert.equal(v.breakEvenBaseFeeCents,null);}
   assert.deepEqual((await h.get(root+'/runs/'+run.id)).snapshot,frozen);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(h.externalCalls+h.esignCalls+h.identityCalls+h.payment.providerCalls,0);
  }catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:resolve(artifacts,'scenario-failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{if(browser)await browser.close();await h.close();}
 });
