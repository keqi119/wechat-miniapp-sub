import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';
import {publicationReadyFixture,publicationGalleryFixture,publicationPhoto} from './vehicle-publication.test-support.ts';

test('actual goods workspace creates drafts, explicitly publishes, handles conflicts, and preserves read boundaries',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'process.env.NODE_ENV':JSON.stringify('development')},plugins:[{name:'goods-entry',resolveId:id=>id==='virtual:goods'?id:undefined,load:id=>id==='virtual:goods'?`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:goods'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a]));
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${output.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${output.output.find(a=>a.type==='chunk')!.fileName}"></script></body></html>`;
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':a.fileName.endsWith('.png')?'image/png':'text/javascript':'text/html');res.end(a?a.code||a.source:html);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{
  try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  const page=await browser.newPage({viewport:{width:1440,height:900}}),requests:string[]=[],mutations:{path:string;body:any}[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let role='OPERATIONS',permissions=['goods.read','goods.write','vehicles.read','products.read','plans.read','plans.write'],conflict=true;
  const vehicle={id:'car-1',title:'本地合成车辆',vin:'LTEST000000000001',plateNumber:'沪QA0001',status:'PUBLISHED'};
  const version={id:'version-2',productId:'product-1',version:2,name:'城市订阅',status:'PUBLISHED'};
  const plan={id:'plan-1',name:'城市订阅',months:12,monthlyFeeAmount:123456,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电自付',conditions:'本地合成条款',benefits:['合同期内换车一次']};
  let goods={id:'good-1',vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id,revision:0,status:'DRAFT',visible:true,recommended:false,sortOrder:0,source:'EXPLICIT',vehicle,productVersion:version,plan};
  const projectedGoods=()=>{const visible=goods.status==='PUBLISHED'&&goods.visible&&vehicle.status==='PUBLISHED';return{...goods,appDisplay:{visible,available:visible,state:visible?'VISIBLE_AVAILABLE':'NOT_VISIBLE',reasons:visible?[]:[{code:!goods.visible?'DISPLAY_DISABLED':'GOODS_NOT_PUBLISHED',message:!goods.visible?'已设置隐藏':'商品未发布'}],checkedAt:'2026-11-05T00:00:00Z'}};};
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'Only loopback synthetic data');if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);requests.push(path+url.search);let json:unknown={items:[],total:0,page:1,pageSize:12},status=200;
   if(path==='/admin/auth/me')json={user:{id:'staff',username:'local',role,permissions},csrfToken:'local'};
   else if(req.method()!=='GET'){
    const body=req.postDataJSON();mutations.push({path,body});assert.ok(body.idempotencyKey);assert.equal(req.headers()['x-csrf-token'],'local');
    if(path==='/admin/goods'){assert.equal(body.revision,0);assert.equal(body.productVersionId,version.id);assert.equal(body.status,undefined);goods={...goods,revision:1};json=projectedGoods();}
    else if(path.endsWith('/publish')&&conflict){conflict=false;goods={...goods,revision:2};status=409;json={error:{code:'REVISION_CONFLICT',message:'商品已被其他同事更新，请重新核对'}};}
    else {assert.equal(body.revision,goods.revision);goods={...goods,...(req.method()==='PATCH'?{visible:body.visible,recommended:body.recommended,sortOrder:body.sortOrder}:{}),revision:goods.revision+1,status:path.endsWith('/publish')?'PUBLISHED':path.endsWith('/withdraw')?'WITHDRAWN':goods.status};json=projectedGoods();}
   }else if(path==='/admin/goods')json={items:[projectedGoods()],total:1,page:1,pageSize:12};
   else if(path==='/admin/goods/good-1')json=projectedGoods();
   else if(path==='/admin/goods/good-1/publish-readiness')json=publicationReadyFixture(vehicle.id,0,goods);
   else if(/^\/admin\/vehicles\/[^/]+\/photos\/publication-photo$/.test(path))return route.fulfill({contentType:'image/png',body:publicationPhoto});
   else if(/^\/admin\/vehicles\/[^/]+\/photos$/.test(path))json=publicationGalleryFixture(path.split('/')[3],0);
   else if(/^\/admin\/vehicles\/[^/]+\/inspections$/.test(path))json={vehicleId:path.split('/')[3],items:[]};
   else if(path==='/admin/vehicles')json={items:[vehicle],total:1,page:1,pageSize:100};
   else if(path==='/admin/products')json={items:[{id:'product-1',versions:[{...version,id:'draft-v',version:3,status:'DRAFT',name:'不可选草稿'},version,{...version,id:'retired-v',version:1,status:'RETIRED',name:'不可选停用'}]}],total:1,page:1,pageSize:100};
   else if(path==='/admin/plans')json={items:[plan],total:1,page:1,pageSize:12};
   else if(path==='/admin/plans/plan-1')json=plan;
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
  });
  await page.goto(origin+'/#goods');await expect(page.getByRole('heading',{name:'车辆基本套餐',exact:true})).toBeVisible();
  await expect(page.getByText('¥1,234.56',{exact:true}).first()).toBeVisible();assert.equal(requests.some(p=>p.startsWith('/admin/products')||p.startsWith('/admin/vehicles')),false);
  await page.getByRole('button',{name:'新增商品',exact:true}).click();await page.getByLabel('车辆', {exact:true}).selectOption(vehicle.id);await page.getByLabel('产品版本',{exact:true}).selectOption(version.id);
  assert.equal(await page.getByLabel('产品版本',{exact:true}).locator('option').filter({hasText:'不可选'}).count(),0);
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('heading',{name:'商品详情',exact:true})).toBeVisible();assert.equal(mutations.length,1);assert.equal(goods.status,'DRAFT');
  await page.getByRole('button',{name:'上架产品方案',exact:true}).click();await page.getByRole('button',{name:'确认上架产品方案',exact:true}).click();await expect(page.getByText('商品已被其他同事更新，请重新核对')).toBeVisible();
  assert.equal(mutations.filter(m=>m.path.endsWith('/publish')).length,1);await page.getByRole('button',{name:'刷新详情',exact:true}).click();
  await page.getByRole('button',{name:'上架产品方案',exact:true}).click();await page.getByRole('button',{name:'确认上架产品方案',exact:true}).click();await expect(page.getByText('方案已上架',{exact:true}).first()).toBeVisible();
  assert.notEqual(mutations[1].body.idempotencyKey,mutations[2].body.idempotencyKey);await expect(page.getByText('App 可查看、可申请',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'调整展示',exact:true}).click();await page.getByLabel('允许在 App 展示（需对客商品已上架）',{exact:true}).uncheck();await page.getByLabel('排序值',{exact:true}).fill('12');await page.getByRole('button',{name:'保存展示设置',exact:true}).click();
  const edit=mutations.find(m=>m.path==='/admin/goods/good-1')!;assert.equal(edit.body.vehicleId,undefined);assert.equal(edit.body.productVersionId,undefined);assert.equal(edit.body.monthlyFeeAmount,undefined);assert.equal(edit.body.source,undefined);assert.equal(edit.body.visible,false);
  await page.getByRole('button',{name:'下架产品方案',exact:true}).click();await page.getByLabel('操作说明',{exact:true}).fill('本地核对下架');await page.getByRole('button',{name:'确认下架产品方案',exact:true}).click();await expect(page.getByText('方案已下架',{exact:true}).first()).toBeVisible();
  requests.length=0;await page.goto(origin+'/?legacy#plans');await expect(page.getByRole('heading',{name:'兼容套餐入口已停用',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新增套餐',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'编辑套餐',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'启用套餐',exact:true})).toHaveCount(0);assert.equal(requests.some(p=>p.startsWith('/admin/plans')),false);
  permissions=['goods.read'];requests.length=0;await page.goto(origin+'/?readonly#goods');await expect(page.getByRole('heading',{name:'车辆基本套餐',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新增商品',exact:true})).toHaveCount(0);assert.equal(requests.some(p=>p.startsWith('/admin/products')||p.startsWith('/admin/vehicles')),false);
  const shots=fileURLToPath(new URL('../../../../reports/ui/',import.meta.url));await mkdir(shots,{recursive:true});await page.screenshot({path:shots+'goods-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect(page.locator('.inherited-admin-sider-inner')).toHaveAttribute('aria-hidden','true');await expect.poll(async()=>{const box=await page.locator('.inherited-admin-sider').boundingBox();return box?box.x+box.width:0;}).toBeLessThanOrEqual(0.5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:shots+'goods-mobile.png',fullPage:true});
  for(const deniedRole of ['FINANCE','SUPPORT','OPERATIONS']){role=deniedRole;permissions=deniedRole==='OPERATIONS'?['products.read']:['*'];requests.length=0;await page.goto(origin+'/?denied='+role+'#goods');await expect(page.getByRole('heading',{name:'当前账号无权访问此模块'})).toBeVisible();assert.equal(requests.some(p=>p.startsWith('/admin/goods')),false);}
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
