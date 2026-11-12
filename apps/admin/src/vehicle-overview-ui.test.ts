import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';
let server:Server,browser:Browser,origin:string;
const evidence=process.env.VEHICLE_OVERVIEW_QA_DIR||fileURLToPath(new URL('../../../../overview-review/',import.meta.url));
before(async()=>{
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {VehicleWorkspace} from '/src/vehicle-workspace';import {VehicleAssetPanel} from '/src/asset-profile';import {VehicleMaintenancePanel} from '/src/vehicle-maintenance';import {RecordWorkspaceShell} from '/src/record-workspace-shell';import {api,ApiError} from '/src/core';import '/src/style.css';import '/src/domain-ui.css';import '/src/asset-workspace.css';import '/src/work-orders.css';
 api.setSession({user:{id:'staff',username:'synthetic',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic'});
 const vehicle={id:'vehicle-a',revision:7,title:'合成车辆 长名称整车信息',plateNumber:'沪A合成',vin:'TESTVIN0000000001',brand:'合成品牌',model:'合成长车型',modelYear:2025,year:2026,city:'上海',mileageKm:33000,batteryHealthPercent:92,registeredOwnerName:'普通投影不应重复的所有人',firstRegistrationDate:'2000-01-01',cooperationOwner:{id:'partner-a',name:'合成超长合作企业名称股份有限公司（运营资料核对专用）'},updatedAt:'2026-11-03T00:00:00Z'};
 function Fixture(){const[tick,setTick]=useState(0),[error,setError]=useState();return <><div className="fixture-controls"><button onClick={()=>{api.setSession({user:{id:'staff',role:'SUPPORT',username:'synthetic',permissions:['vehicles.read']},csrfToken:'new'});setTick(tick+1)}}>移除资产权限</button><button onClick={()=>setError(new ApiError('暂时失败',503,'NETWORK_ERROR'))}>详情503</button><button onClick={()=>setError(new ApiError('禁止访问',403,'FORBIDDEN'))}>详情403</button></div><div style={{height:'calc(100dvh - 40px)',padding:24,display:'flex'}}><RecordWorkspaceShell title="车辆详情" onBack={()=>{}}><VehicleWorkspace entity={vehicle} status="待租" actions={<button>编辑车辆</button>} detailError={error} onRefresh={()=>setTick(tick+1)} renderValues={()=>null} slots={{asset:<VehicleAssetPanel vehicle={vehicle} refreshKey={tick}/>,maintenance:<VehicleMaintenancePanel vehicleId="vehicle-a"/>}}/></RecordWorkspaceShell></div></>};createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`;
 const result=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('development'),'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'overview-fixture',resolveId:id=>id==='virtual:overview.tsx'?id:undefined,load:id=>id==='virtual:overview.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:overview.tsx'}}});
 const output=(Array.isArray(result)?result[0]:result) as {output:{type:string;code?:string;source?:string;fileName:string}[]},script=output.output.find(item=>item.type==='chunk')!.code!,css=output.output.filter(item=>item.fileName.endsWith('.css')).map(item=>item.source).join('\n');
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?script:`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><style>${css}</style><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function fixture(options={width:1440,height:900,scale:1}){
 const p=await browser.newPage({viewport:{width:options.width,height:options.height},deviceScaleFactor:options.scale});p.setDefaultTimeout(5000);
 const profile={vehicleId:'vehicle-a',vehicleRevision:7,revision:4,registered:true,batteryOwnership:'BAAS',batteryCapacityKwh:'75.000',registeredOwnerName:'合成登记证所有人',firstRegistrationDate:'2026-01-02',engineNumber:'SYNTHETIC-ENGINE',bodyColor:'合成白',initialMileageKm:0,purchaseAmount:0,purchaserName:'合成采购企业名称有限公司',purchaseDate:'2026-01-01',nextInspectionDate:'2028-01-02',notes:'合成资料；未登记项目应如实留空。'};
 await p.route('**/*',route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'synthetic loopback only');if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(req.method(),'GET');if(url.pathname==='/api/admin/vehicle-assets/vehicle-a')return route.fulfill({json:profile});if(url.pathname==='/api/admin/vehicle-maintenance/vehicle-a')return route.fulfill({json:{vehicleId:'vehicle-a',vehicleRevision:7,revision:2,registered:true,lastCompletedOn:'2026-01-01',lastMileageKm:10000,nextDueDate:'2027-01-01',nextDueMileageKm:50000,dueByDate:false,dueByMileage:false,readingKm:34000,readingAsOf:'2026-11-02T00:00:00Z',sourceWorkOrderId:null,reason:'合成提醒',updatedAt:null}});if(url.pathname==='/api/admin/baas-contracts')return route.fulfill({json:{items:[],total:0,page:1,pageSize:5}});return route.fulfill({json:{revision:0,vehicleRevision:7,items:[]}});});await p.goto(origin+'/#vehicles?record=vehicle-a&view=overview');return p;
}
test('overview places each vehicle fact once and links BaaS at its ownership value',async()=>{
 const p=await fixture();try{const content=p.getByRole('region',{name:'车辆概览内容'});await expect(p.getByText('合成登记证所有人',{exact:true})).toBeVisible();
  for(const name of ['身份登记','电池与使用','采购合作'])await expect(content.getByRole('heading',{name,exact:true})).toBeVisible();
  for(const value of ['TESTVIN0000000001','合成登记证所有人','SYNTHETIC-ENGINE','33,000 公里','92%','2026-01-02'])await expect(content.getByText(value,{exact:true})).toHaveCount(1);
  await expect(content.getByText('普通投影不应重复的所有人',{exact:true})).toHaveCount(0);await expect(content.getByText('¥0.00',{exact:true})).toHaveCount(1);await expect(content.getByText('0 公里',{exact:true})).toHaveCount(1);await expect(content.getByText('当前状态',{exact:true})).toHaveCount(0);
  const ownership=content.locator('dl > div').filter({has:p.locator('dt').getByText('电池归属',{exact:true})});await expect(ownership.getByRole('link',{name:/BaaS/i})).toBeVisible();await ownership.getByRole('link',{name:/BaaS/i}).click();await expect(p.getByRole('tab',{name:'电池 BaaS',exact:true})).toHaveAttribute('aria-selected','true');await expect(p).toHaveURL(/view=battery-baas/);
  await p.getByRole('tab',{name:'车辆概览',exact:true}).click();await expect(content.getByRole('link',{name:'合成超长合作企业名称股份有限公司（运营资料核对专用）'})).toHaveAttribute('href',/partners.*record=partner-a/);
  await p.getByRole('button',{name:'移除资产权限'}).click();await expect(p.getByText('合成登记证所有人',{exact:true})).toHaveCount(0);await expect(content.getByText('TESTVIN0000000001',{exact:true})).toBeVisible();await expect(content.getByRole('link')).toHaveCount(0);
 }finally{await p.close();}
});
test('75 percent equivalent and regular layouts fit main facts without truncating long labels',async()=>{
 for(const item of [{width:2560,height:1440,scale:.75,name:'1920x1080-75pct-equivalent'},{width:1440,height:900,scale:1,name:'1440x900'},{width:390,height:900,scale:1,name:'390x900'}]){const p=await fixture(item);try{await expect(p.getByRole('heading',{name:'采购合作',exact:true})).toBeVisible();const scroll=p.locator('[data-vehicle-scroll]');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(item.width>=1440)assert.ok(await scroll.evaluate(e=>e.scrollHeight<=e.clientHeight+2),'overview should fit its available workspace height');
  const clipped=await p.locator('.vehicle-overview dd').evaluateAll(nodes=>nodes.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent));assert.deepEqual(clipped,[]);
  await p.screenshot({path:evidence+`overview-${item.name}.png`,fullPage:true});
 }finally{await p.close();}}
});
test('compact asset editor preserves input on detail 503 and removes private facts on 403',async()=>{
 const p=await fixture();try{
  await p.getByRole('button',{name:'编辑资产资料',exact:true}).click();await p.getByLabel('资产备注',{exact:true}).fill('只在当前合成车辆暂存');
  await p.getByRole('button',{name:'详情503',exact:true}).click();await expect(p.getByLabel('资产备注',{exact:true})).toHaveValue('只在当前合成车辆暂存');await expect(p.getByRole('button',{name:'确认编辑资产资料',exact:true})).toBeDisabled();await expect(p.getByText('合成登记证所有人',{exact:true})).toBeVisible();
  await p.getByRole('button',{name:'详情403',exact:true}).click();await expect(p.getByLabel('资产备注',{exact:true})).toHaveCount(0);await expect(p.getByText('合成登记证所有人',{exact:true})).toHaveCount(0);await expect(p.getByText('TESTVIN0000000001',{exact:true})).toHaveCount(0);
 }finally{await p.close();}
});
