import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

let browser:Browser,server:Server,origin:string;
before(async()=>{
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ResourcePage}from'/src/App';import{resources}from'/src/resources';import{api}from'/src/core';import'/src/style.css';import'/src/ninda-brand.css';const role=new URLSearchParams(location.search).get('role')||'OPERATIONS';api.setSession({user:{id:'local-ledger',username:'本地合成台账',role,permissions:['vehicles.read']},csrfToken:'local-synthetic'});createRoot(document.getElementById('root')).render(<React.StrictMode><ResourcePage resource={resources.find(x=>x.key==='vehicles')} permissions={['vehicles.read']} notify={()=>{}}/></React.StrictMode>);`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'vehicle-battery-ui',resolveId:id=>id==='virtual:vehicle-battery.tsx'?id:undefined,load:id=>id==='virtual:vehicle-battery.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:vehicle-battery.tsx'}}});
 const out=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},script=out.output.find(x=>x.type==='chunk')!.code!,css=out.output.filter(x=>x.fileName.endsWith('.css')).map(x=>x.source).join('\n');
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?script:`<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/entry.js"></script></html>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;browser=await chromium.launch({channel:'chrome',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});
const items=[
 {id:'v1',vin:'LOCAL-VIN-1',title:'本地车辆 74.5',batteryCapacityKwh:'74.5',batteryOwnership:'OWNED',status:'DRAFT'},
 {id:'v2',vin:'LOCAL-VIN-2',title:'本地车辆 BaaS',batteryCapacityKwh:'100.00',batteryOwnership:'BAAS',status:'PUBLISHED'},
 {id:'v3',vin:'LOCAL-VIN-3',title:'车型含100kWh但未登记电池',batteryCapacityKwh:null,batteryOwnership:'UNKNOWN',status:'UNPUBLISHED'},
 {id:'v4',vin:'LOCAL-VIN-4',title:'本地待核对',batteryCapacityKwh:'72e2',batteryOwnership:'UNRECOGNIZED',status:'RESERVED'},
 {id:'v5',vin:'LOCAL-VIN-5',title:'本地用车中',status:'IN_USE'}
].map(row=>({...row,plateNumber:'本地车牌',brand:'本地合成品牌',registeredOwnerName:'合成所有人',modelYear:2026,firstRegistrationDate:'2026-01-01',city:'本地',mileageKm:100,createdAt:'2026-10-31T00:00:00Z'}));
async function fixture(role:string){
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors:string[]=[],writes:string[]=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'){writes.push(req.method()+' '+url.pathname);return route.fulfill({status:405,json:{error:{code:'READ_ONLY'}}});}return route.fulfill({json:{page:1,pageSize:12,total:items.length,items}});});
 await page.goto(origin+'/?role='+role+'#vehicles');await expect(page.getByRole('cell',{name:'本地车辆 74.5',exact:true})).toBeVisible();return{context,page,errors,writes};
}
test('actual vehicle ledger shows precise registered battery facts and current vehicle states to administrators and operators',async()=>{
 for(const role of ['ADMIN','OPERATIONS']){const{context,page,errors,writes}=await fixture(role);try{
  await expect(page.getByRole('columnheader',{name:'电池容量',exact:true})).toBeVisible();await expect(page.getByRole('columnheader',{name:'电池方式',exact:true})).toBeVisible();
  const row=(vin:string)=>page.getByRole('row').filter({has:page.getByRole('button',{name:vin,exact:true})});
  await expect(row('LOCAL-VIN-1').getByRole('cell',{name:'74.5 kWh',exact:true})).toBeVisible();await expect(row('LOCAL-VIN-1').getByRole('cell',{name:'电池买断',exact:true})).toBeVisible();
  await expect(row('LOCAL-VIN-2').getByRole('cell',{name:'100.00 kWh',exact:true})).toBeVisible();await expect(row('LOCAL-VIN-2').getByRole('cell',{name:'BaaS / 电池租用',exact:true})).toBeVisible();
  for(const vin of ['LOCAL-VIN-3','LOCAL-VIN-4','LOCAL-VIN-5'])await expect(row(vin).getByRole('cell',{name:'未登记',exact:true})).toHaveCount(2);
  for(const [i,label]of ['草稿','已上架','未上架','已预留','用车中'].entries())await expect(row('LOCAL-VIN-'+(i+1)).locator('.status')).toHaveText(label);
  await expect(row('LOCAL-VIN-2').locator('.status')).toHaveClass('status green');await expect(row('LOCAL-VIN-3').locator('.status')).toHaveClass('status neutral');
  const filter=page.getByRole('combobox',{name:'筛选业务状态'});await expect(filter.locator('option[value="PUBLISHED"]')).toHaveText('已上架');await expect(filter.locator('option')).toHaveCount(6);
  for(const name of ['车辆','品牌','车型年款','首次登记日期'])await expect(page.getByRole('columnheader',{name,exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  if(role==='OPERATIONS'){const dir=fileURLToPath(new URL('../../../../reports/ui/',import.meta.url));await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'vehicle-ledger-battery-1440.png',fullPage:true});}
 }finally{await context.close();}}
});
test('other and unknown roles cannot expose admin battery columns even if a response includes their fields',async()=>{
 for(const role of ['FINANCE','SUPPORT','FUTURE_ROLE']){const{context,page,errors,writes}=await fixture(role);try{await expect(page.getByRole('columnheader',{name:'电池容量',exact:true})).toHaveCount(0);await expect(page.getByRole('columnheader',{name:'电池方式',exact:true})).toHaveCount(0);await expect(page.getByRole('cell',{name:'74.5 kWh',exact:true})).toHaveCount(0);await expect(page.getByRole('cell',{name:'电池买断',exact:true})).toHaveCount(0);await expect(page.getByRole('columnheader',{name:'车辆',exact:true})).toBeVisible();assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);}finally{await context.close();}}
});
