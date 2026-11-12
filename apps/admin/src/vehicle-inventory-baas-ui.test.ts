import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {build} from 'vite';
import {chromium,expect,type Browser,type Page} from '@playwright/test';

let browser:Browser,server:Server,origin:string;
const evidence=fileURLToPath(new URL('../../../.runtime/ninda/vehicle-inventory-init-20261031/baas-ui/',import.meta.url));
before(async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {BaasPage} from '/src/asset-baas';import {VehicleBaasSummary} from '/src/vehicle-insurance-baas';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';const session=role=>({user:{id:'synthetic-staff',username:'staff',role,permissions:['*']},csrfToken:'synthetic'});api.setSession(session('OPERATIONS'));function Test(){const[tick,setTick]=React.useState(0);window.changeRole=role=>{api.setSession(session(role));setTick(n=>n+1);};return React.createElement('main',{style:{maxWidth:1160,margin:'24px auto',padding:16}},location.pathname==='/summary'?React.createElement(VehicleBaasSummary,{vehicleId:'synthetic-v',refreshKey:tick}):React.createElement(BaasPage));}createRoot(document.getElementById('root')).render(React.createElement(Test));`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'inventory-baas-ui',resolveId:id=>id==='virtual:inventory-baas'?id:undefined,load:id=>id==='virtual:inventory-baas'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:inventory-baas'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;code?:string;source?:string}[]},script=output.output.find(i=>i.type==='chunk')!.code!,style=output.output.filter(i=>i.type==='asset').map(i=>i.source||'').join('\n');
 server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?script:`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><style>${style}</style><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function fixture(mode:'detail'|'list'|'create'|'summary'='detail',legacy=false){
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(5000);
 const contract:any={id:'synthetic-b',vehicleId:'synthetic-v',vehicle:{id:'synthetic-v',title:'合成验收车辆',plateNumber:'合成牌照',vin:'SYNTHETIC-VIN',registeredOwnerName:'合成车辆所有人'},revision:2,status:'DRAFT',provider:legacy?'合成出租方':null,contractNumber:'BAAS-synthetic',supplierContractNumber:'',batteryPackage:legacy?'75 kWh':null,batterySerialNumber:'',effectiveFrom:legacy?'2026-10-01':null,effectiveTo:legacy?'2027-10-01':null,billingCycle:legacy?'MONTHLY':null,rentalAmount:legacy?12345:null,paymentDayOfMonth:legacy?15:null,graceDays:0,invoiceRequired:false,taxIncluded:null,currency:'CNY',notes:'合成备注',previousContractId:null,firstCostPeriod:null,termsHash:'a'.repeat(64),files:[{id:'synthetic-file',name:'synthetic.pdf',mimeType:'application/pdf',size:1,sha256:'a'.repeat(64)}],supplierOrderNumber:null,batteryBrand:'合成品牌',lesseeName:'合成承租人',lesseeCreditCode:'A12345678901234567',lessorCollectionAccountInfo:'合成私密账户\n000012345678'};
 if(legacy)for(const key of ['supplierOrderNumber','batteryBrand','lesseeName','lesseeCreditCode','lessorCollectionAccountInfo'])delete contract[key];
 const state={contract,readStatus:200,writeStatus:200,failAfterWrite:false,finance:false,reads:[] as string[],writes:[] as {path:string;body:any}[]};
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);
  if(req.method()==='GET'){if(path==='/admin/baas-contracts/filter-options')return route.fulfill({json:{providers:[],brands:[],models:[],lessees:[]}});state.reads.push(path);if(path==='/admin/vehicles')return route.fulfill({json:{items:[contract.vehicle],total:1,page:1,pageSize:100}});if(path==='/admin/vehicle-assets/synthetic-v')return route.fulfill({json:{vehicleId:'synthetic-v',vehicle:contract.vehicle,vehicleRevision:8,registered:true,revision:3,batteryOwnership:'BAAS',firstRegistrationDate:null}});
   const response={...contract,vehicle:{...contract.vehicle}};if(state.finance)delete response.vehicle.registeredOwnerName;
   if(path==='/admin/baas-contracts'){delete response.lessorCollectionAccountInfo;return route.fulfill({json:{items:mode==='create'&&!state.writes.length?[]:[response],total:mode==='create'&&!state.writes.length?0:1,page:1,pageSize:Number(url.searchParams.get('pageSize'))}});}
   if(path==='/admin/baas-contracts/synthetic-b'){if(state.readStatus!==200)return route.fulfill({status:state.readStatus,json:{error:{code:'READ_FAILED',message:'合成详情读取失败'}}});return route.fulfill({json:response});}throw new Error('unexpected GET '+path);
  }
  assert.ok(req.method()==='PATCH'||req.method()==='POST');assert.ok(['/admin/baas-contracts','/admin/baas-contracts/synthetic-b'].includes(path),'initialization never activates or generates costs');const body=req.postDataJSON();state.writes.push({path,body});
  if(state.writeStatus!==200)return route.fulfill({status:state.writeStatus,json:{error:{code:'WRITE_FAILED',message:'合成办理失败'}}});Object.assign(contract,body,{revision:contract.revision+1});if(state.failAfterWrite)state.readStatus=500;return route.fulfill({json:contract});
 });await page.goto(origin+(mode==='summary'?'/summary':mode==='detail'?'/#baas-contracts?record=synthetic-b':'/#baas-contracts'));
 if(mode==='detail')await expect(page.getByRole('button',{name:'编辑草稿',exact:true})).toBeVisible();else if(mode==='summary')await expect(page.getByRole('heading',{name:'BAAS-synthetic',exact:true})).toBeVisible();else await expect(page.getByRole('button',{name:'新增BAAS合同',exact:true})).toBeVisible();return{page,state};
}
const edit=async(page:Page)=>page.getByRole('button',{name:'编辑草稿',exact:true}).click();
const save=async(page:Page)=>page.getByRole('button',{name:'保存草稿',exact:true}).click();
const fact=(page:Page,label:string)=>page.locator('.asset-facts > div').filter({has:page.locator('dt').getByText(label,{exact:true})}).locator('dd');

test('new empty draft saves with generated internal number, optional supplier order and long-term end without fabricated base terms',async()=>{
 const {page,state}=await fixture('create');try{
  await page.getByRole('button',{name:'新增BAAS合同',exact:true}).click();await page.getByLabel('关联车辆',{exact:true}).selectOption('synthetic-v');await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();
  await expect(page.getByLabel('付款周期',{exact:true})).toHaveValue('');await expect(page.getByLabel('合同结束日期',{exact:true})).toHaveValue('');await page.getByLabel('电池品牌',{exact:true}).fill('合成新品牌');
  const button=page.getByRole('button',{name:'保存草稿',exact:true}),rgb=(await button.evaluate(e=>getComputedStyle(e).backgroundColor)).match(/\d+/g)!.map(Number);assert.ok(rgb[2]>rgb[0]&&rgb[2]>rgb[1]);
  await save(page);await expect(page.getByRole('button',{name:'编辑草稿',exact:true})).toBeVisible();assert.equal(state.writes.length,1);const body=state.writes[0].body;
  assert.equal(Object.hasOwn(body,'contractNumber'),false);for(const key of ['provider','batteryPackage','effectiveFrom','effectiveTo','billingCycle','rentalAmount','paymentDayOfMonth','supplierOrderNumber'])assert.equal(body[key],null,key);assert.equal(body.vehicleRevision,8);assert.equal(body.assetRevision,3);assert.equal(body.batteryBrand,'合成新品牌');
  await expect(page.getByText(/^资料待补齐：/)).toBeVisible();await expect(page.getByRole('button',{name:'启用合同',exact:true})).toHaveCount(0);await expect(fact(page,'周期租金')).toHaveText('未登记');await expect(fact(page,'合同结束')).toHaveText('长期');
 }finally{await page.close();}
});

test('detail edits metadata as strings, retains read-only vehicle identity and retries successful save readback only by GET',async()=>{
 const {page,state}=await fixture();try{
  await expect(fact(page,'车辆所有人')).toHaveText('合成车辆所有人');await expect(fact(page,'VIN')).toHaveText('SYNTHETIC-VIN');await expect(fact(page,'出租方收款账户信息')).toHaveText('合成私密账户\n000012345678');await edit(page);
  await expect(page.getByLabel('每周期租金（元）',{exact:true})).toHaveValue('');await page.getByLabel('外部订单号',{exact:true}).fill('000012345678901234567890');await page.getByLabel('电池出租方',{exact:true}).fill('合成更新出租方');await page.getByLabel('电池规格',{exact:true}).fill('100 kWh');await page.getByLabel('每周期租金（元）',{exact:true}).fill('0.01');await page.getByLabel('出租方收款账户信息',{exact:true}).fill('合成新银行账户\n00000001234');
  await page.screenshot({path:evidence+'baas-draft-desktop.png',fullPage:true});await page.getByRole('button',{name:'保存草稿',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'baas-save-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:1000});await page.screenshot({path:evidence+'baas-draft-mobile.png',fullPage:true});await page.getByRole('button',{name:'保存草稿',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'baas-save-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  state.failAfterWrite=true;await save(page);await expect(page.getByRole('button',{name:'重新读取草稿结果',exact:true})).toBeEnabled();await expect(page.getByLabel('外部订单号',{exact:true})).toBeDisabled();assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.supplierOrderNumber,'000012345678901234567890');assert.equal(state.writes[0].body.rentalAmount,1);assert.equal(state.writes[0].body.effectiveTo,null);assert.equal(Object.hasOwn(state.writes[0].body,'registeredOwnerName'),false);
  state.readStatus=200;await page.getByRole('button',{name:'重新读取草稿结果',exact:true}).click();await expect(page.getByLabel('外部订单号',{exact:true})).toHaveCount(0);await expect(fact(page,'出租方收款账户信息')).toHaveText('合成新银行账户\n00000001234');assert.equal(state.writes.length,1);
 }finally{await page.close();}
});

test('unknown submission freezes metadata and idempotency body; 409 preserves inputs for new revision',async()=>{
 const {page,state}=await fixture();try{
  await edit(page);await page.getByLabel('外部订单号',{exact:true}).fill('000099');state.writeStatus=500;await save(page);await expect(page.getByRole('button',{name:'按原内容重试',exact:true})).toBeEnabled();await expect(page.getByLabel('外部订单号',{exact:true})).toBeDisabled();state.writeStatus=409;await page.getByRole('button',{name:'按原内容重试',exact:true}).click();await expect(page.getByRole('button',{name:'重新读取当前版本',exact:true})).toBeVisible();assert.deepEqual(state.writes[0].body,state.writes[1].body);await expect(page.getByLabel('外部订单号',{exact:true})).toHaveValue('000099');
  state.contract.revision=9;await page.getByRole('button',{name:'重新读取当前版本',exact:true}).click();await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();state.writeStatus=200;await save(page);await expect(page.getByLabel('外部订单号',{exact:true})).toHaveCount(0);assert.equal(state.writes[2].body.revision,9);assert.equal(state.writes[2].body.supplierOrderNumber,'000099');assert.notEqual(state.writes[2].body.idempotencyKey,state.writes[0].body.idempotencyKey);
 }finally{await page.close();}
});

test('lists and vehicle summary show null rent as unregistered, open end as long-term and never render private collection information',async()=>{
 for(const mode of ['list','summary'] as const){const {page,state}=await fixture(mode);try{
  await expect(page.getByText('长期',{exact:true})).toBeVisible();await expect(page.getByText(/¥0\.00/)).toHaveCount(0);await expect(page.getByText(/合成私密账户/)).toHaveCount(0);await expect(page.getByText('出租方收款账户信息',{exact:true})).toHaveCount(0);assert.equal(state.reads.includes('/admin/baas-contracts/synthetic-b'),false);assert.equal(state.writes.length,0);
 }finally{await page.close();}}
});

test('finance session cannot edit or see projected-away owner and discards pending metadata input',async()=>{
 const {page,state}=await fixture();try{await edit(page);await page.getByLabel('外部订单号',{exact:true}).fill('synthetic-unsaved');state.finance=true;await page.evaluate(()=>(window as any).changeRole('FINANCE'));await expect(page.getByRole('button',{name:'编辑草稿',exact:true})).toHaveCount(0);await expect(fact(page,'车辆所有人')).toHaveCount(0);await expect(page.getByLabel('外部订单号',{exact:true})).toHaveCount(0);await expect(page.getByText('synthetic-unsaved',{exact:true})).toHaveCount(0);assert.equal(state.writes.length,0);}finally{await page.close();}
});

test('older finite projections keep prior terms and omit unprovided new metadata until explicitly changed',async()=>{
 const {page,state}=await fixture('detail',true);try{
  await expect(fact(page,'合同结束')).toHaveText('2027-10-01');await expect(page.getByRole('button',{name:'启用合同',exact:true})).toBeVisible();await edit(page);await page.getByLabel('合同备注',{exact:true}).fill('仅更新合成备注');await save(page);await expect(page.getByLabel('合同备注',{exact:true})).toHaveCount(0);
  for(const key of ['supplierOrderNumber','batteryBrand','lesseeName','lesseeCreditCode','lessorCollectionAccountInfo'])assert.equal(Object.hasOwn(state.writes[0].body,key),false,key);assert.equal(state.writes[0].body.effectiveTo,'2027-10-01');assert.equal(state.writes[0].body.rentalAmount,12345);assert.equal(state.writes[0].body.contractNumber,'BAAS-synthetic');
  await edit(page);await page.getByLabel('外部订单号',{exact:true}).fill('synthetic');await page.getByLabel('外部订单号',{exact:true}).fill('');await page.getByLabel('合同结束日期',{exact:true}).fill('');await save(page);await expect(page.getByLabel('合同备注',{exact:true})).toHaveCount(0);assert.equal(state.writes[1].body.supplierOrderNumber,null);assert.equal(state.writes[1].body.effectiveTo,null);await expect(fact(page,'合同结束')).toHaveText('长期');await expect(page.getByRole('button',{name:'启用合同',exact:true})).toBeVisible();
 }finally{await page.close();}
});

test('invalid nonempty base terms and credit code cannot submit a draft',async()=>{
 const {page,state}=await fixture('detail',true);try{
  await edit(page);await page.getByLabel('每周期租金（元）',{exact:true}).fill('0');await save(page);await expect(page.getByRole('alert')).toBeVisible();assert.equal(state.writes.length,0);
  await page.getByLabel('每周期租金（元）',{exact:true}).fill('0.01');await page.getByLabel('承租人统一社会信用代码',{exact:true}).fill('a12345678901234567');await save(page);await expect(page.getByRole('alert')).toBeVisible();assert.equal(state.writes.length,0);
  await page.getByLabel('承租人统一社会信用代码',{exact:true}).fill('A12345678901234567');await save(page);await expect(page.getByLabel('合同备注',{exact:true})).toHaveCount(0);assert.equal(state.writes.length,1);assert.equal(state.writes[0].body.rentalAmount,1);
 }finally{await page.close();}
});
