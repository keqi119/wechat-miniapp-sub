import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

let browser:Browser,server:Server,origin:string;
before(async()=>{
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {VehicleProductSlots} from '/src/vehicle-product-slots';import {api} from '/src/core';import '/src/style.css';api.setSession({user:{id:'ops',username:'synthetic',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic'});function Fixture(){const[tick,setTick]=useState(0);return <><button onClick={()=>{api.setSession({user:{id:'ops',username:'synthetic',role:'FINANCE',permissions:['*']},csrfToken:'different'});setTick(tick+1)}}>撤回本次会话权限</button><VehicleProductSlots vehicleId="car"/></>};createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`;
 const result=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'process.env.NODE_ENV':JSON.stringify('development'),'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'unknown-goods',resolveId:id=>id==='virtual:unknown-goods.tsx'?id:undefined,load:id=>id==='virtual:unknown-goods.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:unknown-goods.tsx'}}});
 const output=(Array.isArray(result)?result[0]:result) as any,script=output.output.find((x:any)=>x.type==='chunk').code,css=output.output.filter((x:any)=>x.fileName.endsWith('.css')).map((x:any)=>x.source).join('\n');
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?script:`<html><head><meta charset="utf-8"></head><body><style>${css}</style><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as any).port}`;
 try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});
type Failure='network'|'500'|'invalid'|'empty'|'wrong-source'|'409'|'422'|'none';
async function setup(failure:Failure,{readbackFailure=false}={}){
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(3000);const writes:any[]=[],reads:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let value:any=null,failedRead=false;
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();const path=u.pathname.slice(4);
  if(req.method()!=='GET'){
   assert.equal(path,'/admin/goods');const body=req.postDataJSON();writes.push(body);assert.equal(req.headers()['x-csrf-token'],'synthetic');
   if(writes.length===1&&(failure==='409'||failure==='422'))return route.fulfill({status:Number(failure),json:{error:{code:failure==='409'?'REVISION_CONFLICT':'VALIDATION',message:'明确拒绝，合成测试'}}});
   value={id:'saved',vehicleId:'car',productVersionId:body.productVersionId,subscriptionPlanId:'plan',revision:0,status:'DRAFT',visible:body.visible,recommended:body.recommended,sortOrder:body.sortOrder,vehicle:{id:'car',title:'合成车辆'},productVersion:{id:body.productVersionId,version:1,name:body.productVersionId==='a'?'产品A':'产品B',status:'PUBLISHED'},plan:{id:'plan',name:'合成计划',months:12,monthlyFeeAmount:250000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'合成条件',benefits:[]}};
   if(writes.length===1){if(failure==='network')return route.abort('failed');if(failure==='500')return route.fulfill({status:500,json:{error:{code:'INTERNAL',message:'合成服务异常'}}});if(failure==='invalid')return route.fulfill({json:{}});if(failure==='empty')return route.fulfill({status:204});if(failure==='wrong-source')return route.fulfill({json:{...value,vehicleId:'other',vehicle:{id:'other',title:'错误车辆'}}});}
   return route.fulfill({json:value});
  }
  reads.push(path+u.search);
  if(path==='/admin/goods'){if(value&&readbackFailure&&!failedRead){failedRead=true;return route.fulfill({status:500,json:{error:{code:'INTERNAL',message:'合成回读失败'}}});}return route.fulfill({json:{items:value?[value]:[],total:value?1:0,page:Number(u.searchParams.get('page')),pageSize:Number(u.searchParams.get('pageSize'))}});}
  if(/^\/admin\/vehicles\/[^/]+\/photos$/.test(path))return route.fulfill({json:{vehicleId:path.split('/')[3],vehicleRevision:0,coverFileId:null,mediaFileIds:[],items:[]}});
  if(/^\/admin\/vehicles\/[^/]+\/inspections$/.test(path))return route.fulfill({json:{vehicleId:path.split('/')[3],items:[]}});
  if(path==='/admin/goods/saved')return route.fulfill({json:value});if(path==='/admin/vehicles/car')return route.fulfill({json:{id:'car',title:'合成车辆'}});
  if(path==='/admin/products')return route.fulfill({json:{items:[{id:'product-a',versions:[{id:'a',version:1,name:'产品A',status:'PUBLISHED'}]},{id:'product-b',versions:[{id:'b',version:1,name:'产品B',status:'PUBLISHED'}]}],total:2,page:1,pageSize:100}});
  throw Error('Unexpected route '+path);
 });
 await page.goto(origin);await page.getByRole('button',{name:'新增产品卡槽',exact:true}).click();await page.getByLabel('产品版本',{exact:true}).selectOption('a');return{page,writes,reads,errors};
}

test('lost create response freezes product/display inputs and all close paths, then retries the exact original command',async()=>{
 const f=await setup('network');try{
  await f.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(f.page.getByRole('alert')).toBeVisible();
  await expect(f.page.getByLabel('产品版本',{exact:true})).toBeDisabled();await expect(f.page.getByLabel('排序值',{exact:true})).toBeDisabled();await expect(f.page.getByRole('checkbox',{name:'允许在 App 展示（需对客商品已上架）',exact:true})).toBeDisabled();await expect(f.page.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
  await f.page.keyboard.press('Escape');await f.page.getByRole('button',{name:'关闭面板',exact:true}).click();await f.page.locator('.drawer-backdrop').dispatchEvent('mousedown');await expect(f.page.getByRole('dialog')).toBeVisible();assert.equal(f.writes.length,1);
  await f.page.getByRole('button',{name:'重试原请求',exact:true}).click();await expect(f.page.getByRole('article')).toHaveCount(1);assert.deepEqual(f.writes[1],f.writes[0]);assert.equal(f.writes[1].productVersionId,'a');assert.deepEqual(f.errors,[]);
 }finally{await f.page.close();}
});

test('5xx remains unknown and retries the exact original scheme create',async()=>{
 const f=await setup('500');try{await f.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(f.page.getByRole('button',{name:'重试原请求',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'重试原请求',exact:true}).click();await expect(f.page.getByRole('article')).toHaveCount(1);assert.deepEqual(f.writes[1],f.writes[0]);assert.deepEqual(f.errors,[]);}finally{await f.page.close();}
});
test('known 2xx scheme creates with missing mismatched or empty receipts recover only through scoped GET',async()=>{
 for(const failure of ['invalid','empty','wrong-source'] as const){const f=await setup(failure);try{await f.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(f.page.getByRole('button',{name:'重新读取方案结果',exact:true})).toBeVisible();await expect(f.page.getByLabel('产品版本',{exact:true})).toBeDisabled();await f.page.getByRole('button',{name:'重新读取方案结果',exact:true}).click();await expect(f.page.getByRole('article')).toHaveCount(1);assert.equal(f.writes.length,1);assert(f.reads.some(path=>path.includes('/admin/goods?')&&path.includes('vehicleId=car')));assert(f.reads.includes('/admin/goods/saved'));assert.deepEqual(f.errors,[]);}finally{await f.page.close();}}
});

test('explicit rejection keeps inputs: validation can be corrected, conflict requires refresh and is not an unknown mutation',async()=>{
 const invalid=await setup('422');try{await invalid.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(invalid.page.getByRole('alert')).toBeVisible();await expect(invalid.page.getByLabel('产品版本',{exact:true})).toBeEnabled();await invalid.page.getByLabel('产品版本',{exact:true}).selectOption('b');await invalid.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(invalid.page.getByRole('article')).toHaveCount(1);assert.notEqual(invalid.writes[0].idempotencyKey,invalid.writes[1].idempotencyKey);assert.equal(invalid.writes[1].productVersionId,'b');}finally{await invalid.page.close();}
 const conflict=await setup('409');try{await conflict.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(conflict.page.getByRole('alert')).toBeVisible();await expect(conflict.page.getByLabel('产品版本',{exact:true})).toHaveValue('a');await expect(conflict.page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(conflict.page.getByRole('button',{name:'重试原请求',exact:true})).toHaveCount(0);await conflict.page.getByRole('button',{name:'取消',exact:true}).click();await expect(conflict.page.getByRole('dialog')).toHaveCount(0);assert.equal(conflict.writes.length,1);}finally{await conflict.page.close();}
});

test('known success followed by failed list read only refreshes GET and does not repeat the create',async()=>{
 const f=await setup('none',{readbackFailure:true});try{await f.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(f.page.getByRole('alert')).toBeVisible();await expect(f.page.getByRole('dialog')).toHaveCount(0);await f.page.getByRole('button',{name:'刷新卡槽',exact:true}).click();await expect(f.page.getByRole('article')).toHaveCount(1);assert.equal(f.writes.length,1);assert.ok(f.reads.filter(p=>p.startsWith('/admin/goods?')).length>=3);}finally{await f.page.close();}
});

test('a changed staff session clears the uncertain private form and cannot retry its command',async()=>{
 const f=await setup('network');try{await f.page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(f.page.getByRole('alert')).toBeVisible();await f.page.getByRole('button',{name:'撤回本次会话权限'}).evaluate(button=>(button as HTMLButtonElement).click());await expect(f.page.getByRole('dialog')).toHaveCount(0);await expect(f.page.getByText('当前账号无权查看商品。')).toBeVisible();assert.equal(f.writes.length,1);}finally{await f.page.close();}
});
