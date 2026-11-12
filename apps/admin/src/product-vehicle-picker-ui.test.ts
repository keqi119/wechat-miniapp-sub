import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect} from '@playwright/test';

test('vehicle picker filters the server, selects all pages atomically, and keeps selections outside the filter',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'picker-entry',resolveId:id=>id==='virtual:picker.tsx'?id:undefined,load:id=>id==='virtual:picker.tsx'?`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {ProductVehiclePicker} from '/src/product-vehicle-picker';import '/src/style.css';api.setSession({user:{id:'staff',role:'OPERATIONS',permissions:['vehicles.read']},csrfToken:'synthetic'});function Test(){const [ids,setIds]=React.useState(['outside']);const [epoch,setEpoch]=React.useState(0);return <><button onClick={()=>{api.setSession({...api.session,csrfToken:'renewed'});setEpoch(epoch+1)}}>更新同账号会话</button><ProductVehiclePicker value={ids} onChange={setIds} disabled={false}/><output aria-label="selected-ids">{JSON.stringify(ids)}</output></>}createRoot(document.getElementById('root')).render(<Test/>);`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:picker.tsx'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a]));
 const js=output.output.find(a=>a.fileName.endsWith('.js'))!,styles=output.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const server=createServer((req,res)=>{const asset=assets.get(req.url||'');if(asset){res.setHeader('Content-Type',req.url?.endsWith('.js')?'text/javascript':'text/css');res.end(asset.code||asset.source);}else{res.setHeader('Content-Type','text/html');res.end(`<html><head>${styles}</head><body style="padding:24px;background:white"><div id="root"></div><script type="module" src="/${js.fileName}"></script></body></html>`);}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port,origin=`http://127.0.0.1:${port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),calls:URL[]=[];let failAll=false;const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();assert.equal(route.request().method(),'GET');assert.equal(url.pathname,'/api/admin/vehicles');assert.equal(url.searchParams.get('view'),'product-selection');calls.push(url);
   const p=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('pageSize')),filtered=url.searchParams.get('brand')==='蔚来',total=filtered?121:122;
   if(failAll&&size===100&&p===2)return route.fulfill({status:503,json:{error:{message:'车辆服务暂不可用'}}});
   const items=Array.from({length:Math.min(size,Math.max(0,total-(p-1)*size))},(_,i)=>{const n=(p-1)*size+i;return{id:filtered?'v'+n:n===0?'outside':'v'+(n-1),title:filtered?'车辆'+n:n===0?'其他车辆':'车辆'+(n-1),registeredOwnerName:filtered?'登记人甲':'登记人乙',brand:'蔚来',model:'ET5',modelYear:2024,ageMonths:25,mileageKm:30000,batteryOwnership:n===0?'UNKNOWN':n===1?'OWNED':'BAAS',batteryCapacityKwh:n===0?null:'75.5',plateNumber:'沪A'+n,vin:'TEST'+n};});
   return route.fulfill({json:{items,total,page:p,pageSize:size,ageAsOf:'2026-10-31'}});
  });
  await page.goto(origin);await expect(page.getByRole('status').first()).toContainText('匹配 122 辆');await expect(page.getByLabel('选择车辆 其他车辆')).toBeChecked();
  await expect(page.getByRole('columnheader',{name:'电池方式',exact:true})).toBeVisible();await expect(page.getByRole('columnheader',{name:'电池规格',exact:true})).toBeVisible();await expect(page.getByRole('row').filter({has:page.getByLabel('选择车辆 车辆0',{exact:true})}).getByText('电池买断',{exact:true})).toBeVisible();
  await page.getByLabel('电池买断/BaaS',{exact:true}).selectOption('BAAS');await page.getByLabel('电池规格（kWh）',{exact:true}).fill('75.5');await page.getByLabel('品牌',{exact:true}).fill('蔚来');await page.getByRole('button',{name:'筛选车辆',exact:true}).click();await expect(page.getByRole('status').first()).toContainText('匹配 121 辆');
  await page.getByRole('button',{name:'下一页车辆'}).click();await expect(page.getByLabel('选择车辆 车辆20')).toBeVisible();await page.getByLabel('选择车辆 车辆20').check();await expect(page.getByLabel('selected-ids')).toHaveText('["outside","v20"]');
  failAll=true;await page.getByRole('button',{name:'全选筛选结果'}).click();await expect(page.getByText('车辆服务暂不可用',{exact:true})).toBeVisible();await expect(page.getByLabel('selected-ids')).toHaveText('["outside","v20"]');
  assert.equal(calls.at(-1)!.searchParams.get('batteryOwnership'),'BAAS');assert.equal(calls.at(-1)!.searchParams.get('batteryCapacityKwh'),'75.5');
  failAll=false;await page.getByRole('button',{name:'全选筛选结果'}).click();await expect.poll(async()=>JSON.parse((await page.getByLabel('selected-ids').textContent())! ).length).toBe(122);assert.ok(calls.some(url=>url.searchParams.get('page')==='2'&&url.searchParams.get('pageSize')==='100'));
  await page.getByRole('button',{name:'取消选择筛选结果'}).click();await expect(page.getByLabel('selected-ids')).toHaveText('["outside"]');
  await page.getByRole('button',{name:'重置筛选'}).click();await expect(page.getByRole('status').first()).toContainText('匹配 122 辆');assert.equal(calls.at(-1)!.searchParams.has('batteryOwnership'),false);assert.equal(calls.at(-1)!.searchParams.has('batteryCapacityKwh'),false);await expect(page.getByLabel('电池买断/BaaS',{exact:true})).toHaveValue('');await expect(page.getByLabel('电池规格（kWh）',{exact:true})).toHaveValue('');await expect(page.getByLabel('selected-ids')).toHaveText('["outside"]');
  const beforeSessionReads=calls.length;await page.getByRole('button',{name:'更新同账号会话'}).click();await expect(page.getByLabel('selected-ids')).toHaveText('[]');await expect(page.getByLabel('选择车辆 其他车辆')).toBeVisible();assert.ok(calls.length>beforeSessionReads);await page.getByLabel('最小车龄（月）').fill('30');await page.getByLabel('最大车龄（月）').fill('12');const count=calls.length;await page.getByRole('button',{name:'筛选车辆',exact:true}).click();await expect(page.getByText('范围最小值不能大于最大值')).toBeVisible();assert.equal(calls.length,count);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


