import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {build} from 'vite';
import {chromium,expect,type Browser,type Page} from '@playwright/test';

let browser:Browser,server:Server,origin:string;
const evidence=process.env.VEHICLE_OVERVIEW_QA_DIR||fileURLToPath(new URL('../../../.runtime/ninda/vehicle-inventory-init-20261031/asset-ui/',import.meta.url));
before(async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {VehicleAssetPanel} from '/src/asset-profile';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';const session=role=>({user:{id:'synthetic-staff',username:'staff',role,permissions:['vehicle-assets.read','vehicle-assets.write']},csrfToken:'synthetic'});api.setSession(session('OPERATIONS'));function Test(){const[tick,setTick]=React.useState(0);window.changeRole=role=>{api.setSession(session(role));setTick(n=>n+1);};return React.createElement('main',{style:{maxWidth:1160,margin:'24px auto',padding:16}},React.createElement('h1',null,'车辆资料 · 合成验收车辆'),React.createElement(VehicleAssetPanel,{vehicle:{id:'synthetic-vehicle',title:'合成验收车辆',mileageKm:45678,year:2026,modelDefinition:{modelYear:2025}},refreshKey:tick}));}createRoot(document.getElementById('root')).render(React.createElement(Test));`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'inventory-profile-ui',resolveId:id=>id==='virtual:inventory-profile'?id:undefined,load:id=>id==='virtual:inventory-profile'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:inventory-profile'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;code?:string;source?:string}[]},script=output.output.find(i=>i.type==='chunk')!.code!,style=output.output.filter(i=>i.type==='asset').map(i=>i.source||'').join('\n');
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?script:`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><style>${style}</style><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
 await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function fixture(omitInventory=false){
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(5000);
 const state={readStatus:200,writeStatus:200,failAfterWrite:false,finance:false,reads:0,writes:[] as Record<string,unknown>[],profile:{vehicleId:'synthetic-vehicle',vehicle:{id:'synthetic-vehicle',title:'合成验收车辆'},vehicleRevision:8,registered:true,revision:3,batteryOwnership:'OWNED',batteryCapacityKwh:'75.5',registeredOwnerName:'合成登记主体',firstRegistrationDate:'2025-06-07',notes:'合成资产备注',engineNumber:'SYNTHETIC-ENGINE',bodyColor:'合成蓝',initialMileageKm:1234,purchaseAmount:12345678,purchaserName:'合成购车主体',purchaseDate:'2024-02-29',nextInspectionDate:'2027-10-01'}};
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(url.pathname,'/api/admin/vehicle-assets/synthetic-vehicle');
  if(request.method()==='GET'){state.reads++;if(state.readStatus!==200)return route.fulfill({status:state.readStatus,json:{error:{code:'READ_FAILED',message:'合成详情读取失败'}}});const response:Record<string,unknown>={...state.profile};if(omitInventory)for(const key of ['engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName','purchaseDate','nextInspectionDate'])delete response[key];if(state.finance){delete response.purchaserName;delete response.registeredOwnerName;delete response.notes;}return route.fulfill({json:response});}
  assert.equal(request.method(),'PATCH');const body=request.postDataJSON();state.writes.push(body);if(state.writeStatus!==200)return route.fulfill({status:state.writeStatus,json:{error:{code:'WRITE_FAILED',message:'合成办理失败'}}});Object.assign(state.profile,body,{revision:state.profile.revision+1});if(state.failAfterWrite)state.readStatus=500;return route.fulfill({json:state.profile});
 });
 await page.goto(origin);await expect(page.getByText('合成资产备注',{exact:true})).toBeVisible();return{page,state};
}
const edit=async(page:Page)=>page.getByRole('button',{name:'编辑资产资料',exact:true}).click();
const save=async(page:Page)=>page.getByRole('button',{name:'确认编辑资产资料',exact:true}).click();
const fact=(page:Page,label:string)=>page.locator('.asset-facts > div').filter({has:page.locator('dt').getByText(label,{exact:true})}).locator('dd');

test('inventory details group identity, procurement and dates; one editor saves exact cents and independent initial mileage',async()=>{
 const {page,state}=await fixture();try{
  for(const title of ['车辆身份','采购资料','里程与日期'])await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(fact(page,'初始里程')).toHaveText('1234 km');await expect(fact(page,'购车人')).toHaveText('合成购车主体');
  await expect(fact(page,'实际采购金额')).toHaveText('¥123,456.78');await expect(fact(page,'发动机号')).toHaveText('SYNTHETIC-ENGINE');
  await expect(page.getByRole('button',{name:'编辑资产资料',exact:true})).toHaveCount(1);await edit(page);
  await expect(page.getByLabel('实际采购金额（元）',{exact:true})).toHaveValue('123456.78');await expect(page.getByLabel('初始里程（km）',{exact:true})).toHaveValue('1234');
  await page.getByLabel('发动机号',{exact:true}).fill('SYNTHETIC-UPDATED');await page.getByLabel('车身颜色',{exact:true}).fill('合成白');await page.getByLabel('购车人',{exact:true}).fill('合成新购车主体');
  await page.getByLabel('实际采购金额（元）',{exact:true}).fill('0.01');await page.getByLabel('初始里程（km）',{exact:true}).fill('0');await page.getByLabel('采购日期',{exact:true}).fill('2026-10-01');await page.getByLabel('下次年检日期',{exact:true}).fill('2028-10-01');
  const confirm=page.getByRole('button',{name:'确认编辑资产资料',exact:true});await expect(confirm).toHaveClass(/primary/);const color=await confirm.evaluate(e=>getComputedStyle(e).backgroundColor);assert.match(color,/rgb/);const rgb=color.match(/\d+/g)!.map(Number);assert.ok(rgb[2]>rgb[0]&&rgb[2]>rgb[1],'final confirmation remains blue');
  await page.screenshot({path:evidence+'inventory-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:1000});await page.screenshot({path:evidence+'inventory-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await save(page);await expect(page.getByText('编辑资产资料已完成并回读。',{exact:true})).toBeVisible();assert.equal(state.writes.length,1);
  const body=state.writes[0];assert.deepEqual(Object.fromEntries(['engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName','purchaseDate','nextInspectionDate','revision','vehicleRevision'].map(key=>[key,body[key]])),{engineNumber:'SYNTHETIC-UPDATED',bodyColor:'合成白',initialMileageKm:0,purchaseAmount:1,purchaserName:'合成新购车主体',purchaseDate:'2026-10-01',nextInspectionDate:'2028-10-01',revision:3,vehicleRevision:8});assert.equal(Object.hasOwn(body,'mileageKm'),false);assert.equal(Object.hasOwn(body,'purchaseYuan'),false);assert.equal(Object.hasOwn(body,'basisAmount'),false);
  await expect(fact(page,'初始里程')).toHaveText('0 km');await expect(fact(page,'实际采购金额')).toHaveText('¥0.01');await edit(page);await expect(page.getByLabel('实际采购金额（元）',{exact:true})).toHaveValue('0.01');
 }finally{await page.close();}
});
test('blank inventory controls explicitly clear facts and show unregistered; invalid integer and amount submit nothing',async()=>{
 const {page,state}=await fixture();try{
  await edit(page);await page.getByLabel('初始里程（km）',{exact:true}).fill('-1');await save(page);await expect(page.getByRole('alert')).toBeVisible();assert.equal(state.writes.length,0);
  await page.getByLabel('初始里程（km）',{exact:true}).fill('0');await page.getByLabel('实际采购金额（元）',{exact:true}).fill('1.001');await save(page);await expect(page.getByRole('alert')).toBeVisible();assert.equal(state.writes.length,0);
  for(const label of ['发动机号','车身颜色','初始里程（km）','实际采购金额（元）','购车人','采购日期','下次年检日期'])await page.getByLabel(label,{exact:true}).fill('');await save(page);await expect(page.getByText('编辑资产资料已完成并回读。',{exact:true})).toBeVisible();
  for(const key of ['engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName','purchaseDate','nextInspectionDate'])assert.equal(state.writes[0][key],null,key);
  for(const label of ['发动机号','车身颜色','初始里程','实际采购金额','购车人','采购日期','下次年检日期'])await expect(fact(page,label)).toHaveText('未登记');
 }finally{await page.close();}
});
test('conflicts preserve new field input; successful PATCH plus failed GET only retries reading',async()=>{
 const {page,state}=await fixture();try{
  await edit(page);await page.getByLabel('购车人',{exact:true}).fill('合成冲突保留主体');await page.getByLabel('实际采购金额（元）',{exact:true}).fill('777.77');state.writeStatus=409;await save(page);await expect(page.getByRole('button',{name:'重新读取并核对当前版本',exact:true})).toBeVisible();await expect(page.getByLabel('购车人',{exact:true})).toHaveValue('合成冲突保留主体');
  state.profile.revision=9;state.profile.vehicleRevision=12;await page.getByRole('button',{name:'重新读取并核对当前版本',exact:true}).click();await expect(page.getByRole('button',{name:'确认编辑资产资料',exact:true})).toBeEnabled();await expect(page.getByLabel('实际采购金额（元）',{exact:true})).toHaveValue('777.77');
  state.writeStatus=200;state.failAfterWrite=true;await save(page);await expect(page.getByRole('button',{name:'重新读取结果',exact:true})).toBeEnabled();await expect(page.getByLabel('购车人',{exact:true})).toBeDisabled();assert.equal(state.writes.length,2);assert.equal(state.writes[1].revision,9);assert.equal(state.writes[1].vehicleRevision,12);assert.equal(state.writes[1].purchaseAmount,77777);
  state.readStatus=200;await page.getByRole('button',{name:'重新读取结果',exact:true}).click();await expect(fact(page,'购车人')).toHaveText('合成冲突保留主体');assert.equal(state.writes.length,2);
 }finally{await page.close();}
});
test('role changes discard pending private input; FINANCE sees only permitted facts and ADMIN can edit',async()=>{
 const {page,state}=await fixture();try{
  await edit(page);await page.getByLabel('购车人',{exact:true}).fill('合成私有未存输入');state.finance=true;await page.evaluate(()=>(window as any).changeRole('FINANCE'));
  await expect(page.getByText('当前岗位仅可查看资产事实。',{exact:true})).toBeVisible();await expect(page.getByText('购车人',{exact:true})).toHaveCount(0);await expect(page.getByText('合成购车主体',{exact:true})).toHaveCount(0);await expect(page.getByLabel('购车人',{exact:true})).toHaveCount(0);await expect(page.getByText('车辆所有人（登记证）',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'编辑资产资料',exact:true})).toHaveCount(0);
  await expect(fact(page,'实际采购金额')).toHaveText('¥123,456.78');await expect(fact(page,'发动机号')).toHaveText('SYNTHETIC-ENGINE');await expect(fact(page,'下次年检日期')).toHaveText('2027-10-01');assert.equal(state.writes.length,0);
  state.finance=false;await page.evaluate(()=>(window as any).changeRole('ADMIN'));await edit(page);await expect(page.getByLabel('购车人',{exact:true})).toHaveValue('合成购车主体');
 }finally{await page.close();}
});
test('editing an older projection preserves absent inventory facts until the corresponding control is deliberately changed',async()=>{
 const {page,state}=await fixture(true);try{
  await edit(page);await page.getByLabel('资产备注',{exact:true}).fill('仅更新合成备注');await save(page);await expect(page.getByText('编辑资产资料已完成并回读。',{exact:true})).toBeVisible();
  for(const key of ['engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName','purchaseDate','nextInspectionDate'])assert.equal(Object.hasOwn(state.writes[0],key),false,key+' must stay omitted');
  await edit(page);await page.getByLabel('购车人',{exact:true}).fill('合成后清除');await page.getByLabel('购车人',{exact:true}).fill('');await save(page);await expect(page.getByText('编辑资产资料已完成并回读。',{exact:true})).toBeVisible();assert.equal(state.writes[1].purchaserName,null);
 }finally{await page.close();}
});
