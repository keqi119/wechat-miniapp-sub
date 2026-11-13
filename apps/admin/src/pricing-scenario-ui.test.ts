import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('v2 unknown save restores named cost lines after navigation and retries the exact frozen request',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PricingReferencePage} from '/src/pricing-reference';import '/src/style.css';api.setSession({user:{id:'test',username:'test',role:'OPERATIONS',permissions:['pricing-reference.read','pricing-reference.write']},csrfToken:'synthetic'});function App(){const [show,setShow]=useState(true);return <main><button onClick={()=>setShow(!show)}>切换测试页面</button>{show?<PricingReferencePage/>:<p>其他页面</p>}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'scenario-test',resolveId:id=>id==='virtual:scenario.tsx'?id:undefined,load:id=>id==='virtual:scenario.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:scenario.tsx'}}});
 const output=((Array.isArray(built)?built[0]:built) as {output:{fileName:string;code?:string;source?:string|Uint8Array}[]}).output;
 const assets=new Map(output.map(a=>['/'+a.fileName,a])),styles=output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${output.find(a=>a.fileName.endsWith('.js'))!.fileName}"></script></body></html>`;
 const server=createServer((req,res)=>{const asset=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:html);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(8000);const writes:any[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();if(req.method()==='GET')return route.fulfill({json:{items:[],total:0}});assert.equal(url.pathname,'/api/admin/pricing-reference/scenarios');writes.push(req.postDataJSON());if(writes.length===1)return route.fulfill({status:503,json:{error:{code:'UNKNOWN',message:'合成未知响应'}}});return route.fulfill({status:201,json:{id:'saved-v2'}});});
  await page.goto(origin);await page.getByRole('button',{name:'场景 / 曲线 / review',exact:true}).click();
  for(const[label,value]of Object.entries({'场景名称':'冻结重试场景','预定管理规模 N（辆）':'10','预计出租率 u（%）':'90','产品期限 T（月）':'6','复购率 r（%）':'40','坏账率 d（%）':'0','每出租月预计里程（km）':'1000','固定推广总预算 B（元）':'0','折算周期 L（月）':'12','每新客订单成本 Cnew（元）':'500','每复购订单成本 Crepeat（元）':'50'}))await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('车辆成本模板',{exact:true}).selectOption('GPS');await page.getByRole('button',{name:'添加车辆成本',exact:true}).click();await page.getByLabel('车辆项目 1 单价（元）',{exact:true}).fill('0');
  await page.getByLabel('车辆成本模板',{exact:true}).selectOption('交付');await page.getByRole('button',{name:'添加车辆成本',exact:true}).click();await page.getByLabel('车辆项目 2 数量',{exact:true}).fill('2');
  const evidence=new URL('../../../.runtime/scenario-cost-v2/',import.meta.url);await mkdir(evidence,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('scenario-populated-desktop.png',evidence)),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('scenario-populated-mobile.png',evidence)),fullPage:true});await page.setViewportSize({width:1400,height:1000});
  await page.getByRole('button',{name:'保存新参数版本',exact:true}).click();await expect(page.getByRole('button',{name:'按原内容重试保存',exact:true})).toBeVisible();
  assert.equal(writes.length,1);assert.equal(writes[0].payload.vehicleCosts[0].amountCents,0);assert.equal(writes[0].payload.vehicleCosts[1].amountCents,null);
  await page.getByRole('button',{name:'切换测试页面',exact:true}).click();await expect(page.getByText('其他页面',{exact:true})).toBeVisible();await page.getByRole('button',{name:'切换测试页面',exact:true}).click();
  await expect(page.getByLabel('场景名称',{exact:true})).toHaveValue('冻结重试场景');await expect(page.getByLabel('车辆项目 1 单价（元）',{exact:true})).toHaveValue('0.00');await expect(page.getByLabel('车辆项目 1 单价（元）',{exact:true})).toBeDisabled();await expect(page.getByLabel('车辆项目 2 单价（元）',{exact:true})).toHaveValue('');await expect(page.getByLabel('车辆项目 2 数量',{exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'按原内容重试保存',exact:true}).click();await expect(page.getByText('已保存 saved-v2',{exact:true})).toBeVisible();assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
