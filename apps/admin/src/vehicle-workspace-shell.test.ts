import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

let browser:Browser,server:Server,origin:string;
const evidence=fileURLToPath(new URL('../../../../media-ui-review/screenshots/',import.meta.url));
const vehicle={id:'vehicle-shell',revision:7,status:'UNPUBLISHED',title:'合成车辆 长名称整车信息',plateNumber:'沪A合成',vin:'TESTVIN0000000001',brand:'合成品牌',model:'合成长车型',modelYear:2025,year:2026,city:'上海',mileageKm:33000,batteryHealthPercent:92,conditionDisclosure:'合成查验事实，非生产车辆',description:'真实后台外壳布局验收专用合成记录',registeredOwnerName:'普通投影不应重复的所有人',cooperationOwner:{id:'partner-shell',name:'合成超长合作企业名称股份有限公司（运营资料核对专用）'},updatedAt:'2026-11-03T00:00:00Z'};
const profile={vehicleId:vehicle.id,vehicleRevision:7,revision:4,registered:true,batteryOwnership:'BAAS',batteryCapacityKwh:'75.000',registeredOwnerName:'合成登记证所有人',firstRegistrationDate:'2026-01-02',engineNumber:'SYNTHETIC-ENGINE',bodyColor:'合成白',initialMileageKm:0,purchaseAmount:0,purchaserName:'合成采购企业名称有限公司',purchaseDate:'2026-01-01',nextInspectionDate:'2028-01-02',notes:'合成资料；未登记项目应如实留空。'};
before(async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'vehicle-shell-fixture',resolveId:id=>id==='virtual:vehicle-shell.tsx'?id:undefined,load:id=>id==='virtual:vehicle-shell.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:vehicle-shell.tsx'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a]));
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${output.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${output.output.find(a=>a.type==='chunk')!.fileName}"></script></body></html>`;
 server=createServer((req,res)=>{const asset=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':asset.fileName.endsWith('.png')?'image/png':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:html);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});

test('real App sidebar, header and vehicle workspace fit all ten tabs and overview facts at desktop sizes',async()=>{
 for(const scenario of [{name:'app-shell-1920x1080-75pct-equivalent',width:2560,height:1440,scale:.75},{name:'app-shell-1440x900',width:1440,height:900,scale:1}]){
  const page=await browser.newPage({viewport:{width:scenario.width,height:scenario.height},deviceScaleFactor:scenario.scale});page.setDefaultTimeout(6000);const errors:string[]=[],unexpected:string[]=[],requests:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'only local synthetic fixtures');if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(req.method(),'GET','layout verification is read-only');const path=url.pathname.slice(4);requests.push(path);let json:unknown;
    if(path==='/admin/auth/me')json={user:{id:'layout-staff',username:'synthetic',name:'合成运营人员',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic'};
    else if(path==='/admin/vehicles')json={items:[vehicle],total:1,page:1,pageSize:12};
    else if(path==='/admin/vehicles/'+vehicle.id)json=vehicle;
    else if(path==='/admin/vehicle-assets/'+vehicle.id)json=profile;
    else if(path==='/admin/vehicle-maintenance/'+vehicle.id)json={vehicleId:vehicle.id,vehicleRevision:7,revision:2,registered:true,lastCompletedOn:'2026-01-01',lastMileageKm:10000,nextDueDate:'2027-01-01',nextDueMileageKm:50000,dueByDate:false,dueByMileage:false,readingKm:34000,readingAsOf:'2026-11-02T00:00:00Z',sourceWorkOrderId:null,reason:'合成提醒',updatedAt:null};
    else if(path==='/admin/baas-contracts')json={items:[],total:0,page:1,pageSize:5};
    else{unexpected.push(path);return route.fulfill({status:404,json:{error:{message:'Unexpected synthetic route '+path}}});}
    return route.fulfill({json});
   });
   await page.goto(origin+'/#vehicles?record='+vehicle.id+'&view=overview');
   await expect(page.locator('.inherited-admin-sider')).toBeVisible();await expect(page.locator('.inherited-admin-header')).toBeVisible();await expect(page.getByRole('region',{name:'车辆工作台'})).toBeVisible();await expect(page.getByText('合成登记证所有人',{exact:true})).toBeVisible();
   const content=page.getByRole('region',{name:'车辆概览内容'}),tabs=page.locator('.vehicle-workspace-tabs').getByRole('tab');await expect(tabs).toHaveCount(10);
   for(const label of ['身份登记','电池与使用','采购合作'])await expect(content.getByRole('heading',{name:label,exact:true})).toBeVisible();
   for(const value of ['TESTVIN0000000001','合成登记证所有人','SYNTHETIC-ENGINE','33,000 公里','92%','2026-01-02','¥0.00','0 公里'])await expect(content.getByText(value,{exact:true})).toHaveCount(1);
   const metrics=await page.evaluate(()=>{const scroll=document.querySelector('[data-vehicle-scroll]')!,nav=document.querySelector('.vehicle-workspace-tabs .ant-tabs-nav-wrap')!,bounds=scroll.getBoundingClientRect(),tabBoxes=Array.from(document.querySelectorAll('.vehicle-workspace-tabs [role="tab"]')).map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}),facts=Array.from(document.querySelectorAll('.vehicle-overview dd')).map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,clipped:e.scrollWidth>e.clientWidth+2};});return{viewport:{width:innerWidth,height:innerHeight},pageOverflow:document.documentElement.scrollWidth>innerWidth,scroll:{height:scroll.clientHeight,contentHeight:scroll.scrollHeight,bottom:bounds.bottom,top:bounds.top},nav:{width:nav.clientWidth,contentWidth:nav.scrollWidth},tabBoxes,facts};});
   await page.screenshot({path:evidence+scenario.name+'.png'});await writeFile(evidence+scenario.name+'.json',JSON.stringify({scenario,metrics,requests,errors,unexpected},null,2));
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.equal(metrics.pageOverflow,false,'real App must not overflow the document');assert.ok(metrics.nav.contentWidth<=metrics.nav.width+2,'all ten tabs fit without horizontal scrolling');assert.equal(new Set(metrics.tabBoxes.map(x=>Math.round(x.y))).size,1);
   assert.deepEqual(metrics.facts.filter(x=>x.clipped).map(x=>x.text),[],'long company values wrap without truncation');assert.deepEqual(metrics.facts.filter(x=>x.bottom>metrics.scroll.bottom+2||x.y<metrics.scroll.top-2).map(x=>x.text),[],'all primary overview facts are visible without scrolling');assert.ok(metrics.scroll.bottom<=scenario.height+2,'workspace scroll stays within real App viewport');assert.ok(requests.includes('/admin/vehicle-assets/'+vehicle.id),'uses the actual authorized asset projection');
  }finally{await page.close();}
 }
});
