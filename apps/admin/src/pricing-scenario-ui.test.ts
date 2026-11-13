import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('compact cost rows and readable parameter history preserve frozen save retries',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PricingReferencePage} from '/src/pricing-reference';import '/src/style.css';api.setSession({user:{id:'test',username:'test',role:'OPERATIONS',permissions:['pricing-reference.read','pricing-reference.write']},csrfToken:'synthetic'});function App(){const [show,setShow]=useState(true);return <main style={{maxWidth:1152,margin:'auto'}}><button onClick={()=>setShow(!show)}>切换测试页面</button>{show?<PricingReferencePage/>:<p>其他页面</p>}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'scenario-test',resolveId:id=>id==='virtual:scenario.tsx'?id:undefined,load:id=>id==='virtual:scenario.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:scenario.tsx'}}});
 const output=((Array.isArray(built)?built[0]:built) as {output:{fileName:string;code?:string;source?:string|Uint8Array}[]}).output;
 const assets=new Map(output.map(a=>['/'+a.fileName,a])),styles=output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${output.find(a=>a.fileName.endsWith('.js'))!.fileName}"></script></body></html>`;
 const server=createServer((req,res)=>{const asset=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:html);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(8000);const writes:any[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const scenario={id:'scenario-v2',lineageId:'scenario-lineage',version:2,revision:2,createdAt:'2026-11-13T01:00:00Z',createdBy:'synthetic-staff',payload:{costModelVersion:2,name:'版本展示验收',managementVehicleCount:10,occupancyRate:.9,productTermMonths:6,repeatOrderRate:.4,badDebtRate:.02,targetAnnualRoa:.1,expectedMonthlyMileageKm:1000,notes:'人工预算依据',baasMonthlyBudgetCents:72800,insuranceAnnualBudgetCents:null,vehicleCosts:[{id:'gps',label:'GPS',basis:'HOLDING_YEAR',amountCents:0,quantity:1},{id:'prep',label:'周期整备',basis:'PER_CYCLE',amountCents:null,quantity:2}],enterpriseCosts:[{id:'office',label:'办公室',basis:'MONTH',amountCents:300000,quantity:1}],marketing:{fixedBudgetCents:1200000,conversionMonths:12,coverageVehicleCount:null,newOrderCostCents:50000,repeatOrderCostCents:5000}}};
  const legacy={id:'scenario-v1',version:1,createdAt:'2026-11-12T01:00:00Z',payload:{name:'旧版场景',managementVehicleCount:10,monthlyManagementBudgetCents:200000,occupancyRate:.8,targetAnnualRoa:null,expectedMonthlyMileageKm:1000,variableCostPerOccupiedMonthCents:0,otherFixedMonthlyCostCents:null,disposalCostCents:0,oneTimeCostCents:0,notes:'历史总额保留'}};
  const curve={id:'curve',version:1,payload:{name:'验收残值曲线',modelDefinitionId:'model-1',year:2026,batteryOwnership:'BAAS',batteryCapacityKwh:75,configuration:'',mileageMinKm:0,mileageMaxKm:200000,condition:'正常车况',effectiveFrom:'2026-01-01',valuationDate:'2026-01-01',source:'MANUAL',sourceNotes:'人工评估依据',points:[{ageMonths:0,coefficient:1},{ageMonths:12,coefficient:.8},{ageMonths:24,coefficient:1e-16}]}};
  const review={id:'review',version:1,payload:{vehicleId:'vehicle-1',observedAt:'2026-11-01',effectiveAt:'2026-11-01T00:00:00Z',ageMonths:12,mileageKm:10000,valueCents:12000000,curveId:'curve',notes:'车况评估依据',withdrawn:false}};
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();if(req.method()==='GET'){const items=url.pathname.endsWith('/scenarios')?[scenario,legacy]:url.pathname.endsWith('/curves')?[curve]:url.pathname.endsWith('/reviews')?[review]:[];return route.fulfill({json:{items,total:items.length}});}assert.equal(url.pathname,'/api/admin/pricing-reference/scenarios');writes.push(req.postDataJSON());if(writes.length===1)return route.fulfill({status:503,json:{error:{code:'UNKNOWN',message:'合成未知响应'}}});return route.fulfill({status:201,json:{id:'saved-v2'}});});
  await page.goto(origin);await page.getByRole('button',{name:'场景 / 曲线 / review',exact:true}).click();
  for(const[label,value]of Object.entries({'场景名称':'冻结重试场景','预定管理规模 N（辆）':'10','预计出租率 u（%）':'90','产品期限 T（月）':'6','复购率 r（%）':'40','坏账率 d（%）':'0','每出租月预计里程（km）':'1000','固定推广总预算 B（元）':'0','折算周期 L（月）':'12','每新客订单成本 Cnew（元）':'500','每复购订单成本 Crepeat（元）':'50'}))await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('车辆成本模板',{exact:true}).selectOption('GPS');await page.getByRole('button',{name:'添加车辆成本',exact:true}).click();await page.getByLabel('车辆项目 1 单价（元）',{exact:true}).fill('0');
  await page.getByLabel('车辆成本模板',{exact:true}).selectOption('交付');await page.getByRole('button',{name:'添加车辆成本',exact:true}).click();await page.getByLabel('车辆项目 2 数量',{exact:true}).fill('2');
  const rowGeometry=await page.locator('.scenario-cost-row').evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,tops:[...row.querySelectorAll('input,select')].map(el=>Math.round(el.getBoundingClientRect().top))})));
  assert.equal(rowGeometry.length,2);for(const row of rowGeometry){assert.equal(new Set(row.tops).size,2,'Regular cost inputs must occupy two rows');assert.ok(row.height<=145,'Cost item should remain compact at real desktop content width');}
  const evidence=new URL('../../../.runtime/scenario-ui-compact/',import.meta.url);await mkdir(evidence,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('scenario-populated-desktop.png',evidence)),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('scenario-populated-mobile.png',evidence)),fullPage:true});await page.setViewportSize({width:1400,height:1000});
  await page.getByRole('button',{name:'保存新参数版本',exact:true}).click();await expect(page.getByRole('button',{name:'按原内容重试保存',exact:true})).toBeVisible();
  assert.equal(writes.length,1);assert.equal(writes[0].payload.vehicleCosts[0].amountCents,0);assert.equal(writes[0].payload.vehicleCosts[1].amountCents,null);
  await page.getByRole('button',{name:'切换测试页面',exact:true}).click();await expect(page.getByText('其他页面',{exact:true})).toBeVisible();await page.getByRole('button',{name:'切换测试页面',exact:true}).click();
  await expect(page.getByLabel('场景名称',{exact:true})).toHaveValue('冻结重试场景');await expect(page.getByLabel('车辆项目 1 单价（元）',{exact:true})).toHaveValue('0.00');await expect(page.getByLabel('车辆项目 1 单价（元）',{exact:true})).toBeDisabled();await expect(page.getByLabel('车辆项目 2 单价（元）',{exact:true})).toHaveValue('');await expect(page.getByLabel('车辆项目 2 数量',{exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'按原内容重试保存',exact:true}).click();await expect(page.getByText('已保存 saved-v2',{exact:true})).toBeVisible();assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);
  const history=page.getByText('查看全部不可变参数版本（2）',{exact:true}).locator('..');
  await history.locator(':scope > summary').click();
  await history.locator('summary').filter({hasText:'版本展示验收'}).click();
  await expect(history.getByText('人工预算依据',{exact:true})).toBeVisible();
  await expect(history).toContainText('GPS');await expect(history).toContainText('周期整备');
  await expect(history.locator('pre,code')).toHaveCount(0);
  await expect(history).not.toContainText('managementVehicleCount');
  await expect(history).not.toContainText('costModelVersion');
  await history.locator('summary').filter({hasText:'旧版场景'}).click();
  await expect(history.getByText('历史总额保留',{exact:true})).toBeVisible();
  await page.screenshot({path:fileURLToPath(new URL('versions-desktop.png',evidence)),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:fileURLToPath(new URL('versions-mobile.png',evidence)),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(el=>el.getBoundingClientRect().right>innerWidth&&!el.closest('.parameter-history-table-scroll')).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width})).slice(-15))));
  await page.setViewportSize({width:1400,height:1000});
  for(const [kind,title,note] of [['curves','验收残值曲线','人工评估依据'],['reviews','vehicle-1','车况评估依据']]){
   await page.getByLabel('参数类型',{exact:true}).selectOption(kind);
   const versions=page.getByText('查看全部不可变参数版本（1）',{exact:true}).locator('..');
   if(!await versions.evaluate(el=>(el as HTMLDetailsElement).open))await versions.locator(':scope > summary').click();
   await versions.locator('summary').filter({hasText:title}).click();
   await expect(versions.getByText(note,{exact:true})).toBeVisible();await expect(versions.locator('pre,code')).toHaveCount(0);
   if(kind==='curves'){await expect(versions.getByText('不限配置',{exact:true})).toBeVisible();await expect(versions.getByRole('cell',{name:'0.0000000000000001',exact:true})).toBeVisible();}
  }
  assert.equal(writes.length,2,'Reading versions must not write or recalculate');assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
