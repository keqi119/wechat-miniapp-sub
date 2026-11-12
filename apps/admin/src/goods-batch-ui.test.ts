import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('批量商品按适配范围全选、排除、处理中断重试原请求，且仅下架所选车辆',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'batch-entry',resolveId:id=>id==='virtual:batch'?id:undefined,load:id=>id==='virtual:batch'?`import React from 'react';import{createRoot}from'react-dom/client';import{GoodsBatch}from'/src/goods-batch';import{api}from'/src/core';api.setSession({user:{id:'staff',username:'test',role:'ADMIN',permissions:['*']},csrfToken:'csrf'});function App(){const[open,setOpen]=React.useState(true);return React.createElement('div',null,React.createElement('button',{onClick:()=>setOpen(true)},'打开'),open&&React.createElement(GoodsBatch,{onClose:()=>setOpen(false),onDone:()=>{}}))}createRoot(document.getElementById('root')).render(React.createElement(App));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:batch'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a]));
 const html=`<!doctype html><div id="root"></div><script type="module" src="/${output.output.find(a=>a.type==='chunk')!.fileName}"></script>`;
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?'text/javascript':'text/html');res.end(a?a.code||a.source:html);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage(),cars=[{id:'a',title:'车辆A',plateNumber:'甲',modelDefinitionId:'m1'},{id:'b',title:'车辆B',plateNumber:'乙',modelDefinitionId:'m2'},{id:'c',title:'车辆C',plateNumber:'丙',modelDefinitionId:'m2'},{id:'outside',title:'范围外',plateNumber:'丁',modelDefinitionId:'m3'}],version={id:'v1',productId:'p1',version:1,name:'生效产品',status:'PUBLISHED',vehicleIds:['a'],modelDefinitionIds:['m2']};
  let goods:any[]=[{id:'gb',vehicleId:'b',productVersionId:'v1',revision:2,status:'PUBLISHED',visible:true}],failed=false;const writes:{path:string;body:any}[]=[];
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin)throw new Error('unexpected origin');if(!url.pathname.startsWith('/api/'))return route.continue();let result:any={items:[],total:0,page:1,pageSize:100},status=200;const path=url.pathname.slice(4);
   if(req.method()==='GET'){const data=path==='/admin/vehicles'?cars:path==='/admin/products'?[{id:'p1',versions:[version,{...version,id:'v2',status:'DRAFT'}]}]:path==='/admin/goods'?goods:[];result={items:data,total:data.length,page:1,pageSize:100};}
   else {const body=req.postDataJSON();writes.push({path,body});assert.ok(body.idempotencyKey);
    if(path==='/admin/goods'){const row={id:'ga',vehicleId:body.vehicleId,productVersionId:body.productVersionId,revision:0,status:'DRAFT',visible:true};goods=[...goods,row];result=row;}
    else if(path==='/admin/goods/ga/publish'&&!failed){failed=true;status=503;result={error:{message:'网络异常'}};}
    else {const id=path.split('/')[3],row=goods.find(g=>g.id===id);assert.equal(body.revision,row.revision);row.revision++;row.status=path.endsWith('/publish')?'PUBLISHED':'WITHDRAWN';result=row;}
   }await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(origin);await page.getByLabel('生效产品版本').selectOption('v1');await expect(page.getByText('适用车辆 3 辆，已选 0 辆。按指定车辆和适用车型共同匹配。')).toBeVisible();
  await page.getByLabel('全选产品适用车辆').check();await page.getByLabel('选择车辆 丙').uncheck();await page.getByRole('button',{name:'批量上架所选方案'}).click();await expect(page.getByText('当前请求结果尚未确认',{exact:false})).toBeVisible();
  assert.equal(writes.length,2);assert.equal(writes[0].body.vehicleId,'a');await page.getByRole('button',{name:'重试原请求'}).click();await expect(page.getByText('甲：方案已上架')).toBeVisible();await expect(page.getByText('乙：未处理')).toBeVisible();assert.deepEqual(writes[1],writes[2]);assert.equal(writes.some(w=>w.body.vehicleId==='c'),false);
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'打开'}).click();await page.getByLabel('生效产品版本').selectOption('v1');await page.getByLabel('全选产品适用车辆').check();await page.getByLabel('选择车辆 甲').uncheck();await page.getByLabel('选择车辆 丙').uncheck();await page.getByRole('button',{name:'批量下架所选方案'}).click();await expect(page.getByText('乙：方案已下架')).toBeVisible();assert.equal(writes.at(-1)?.path,'/admin/goods/gb/withdraw');assert.equal(goods.find(g=>g.id==='ga').status,'PUBLISHED');
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
