import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('process next actions open existing version forms and a committed command is not resubmitted after readback failure',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const built=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'process-fixture',resolveId:id=>id==='virtual:process-fixture'?id:undefined,load:id=>id==='virtual:process-fixture'?`
 import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {ProductsPage} from '/src/products';import {InsurancePage} from '/src/insurance';
 import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';
 api.setSession({user:{id:'staff',role:'ADMIN',username:'synthetic',permissions:['*']},csrfToken:'synthetic'});
 function Fixture(){const[hash,setHash]=React.useState(location.hash);React.useEffect(()=>{const update=()=>setHash(location.hash);addEventListener('hashchange',update);addEventListener('process-location',update);return()=>{removeEventListener('hashchange',update);removeEventListener('process-location',update);};},[]);return location.search.includes('insurance')?React.createElement(InsurancePage):React.createElement(ProductsPage,{warehouse:hash.split('?')[0]==='#product-warehouse'});}createRoot(document.getElementById('root')).render(React.createElement(Fixture));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:process-fixture'}}});
 const output=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(x=>['/'+x.fileName,x])),entry=output.output.find(x=>x.type==='chunk')!.fileName,styles=output.output.filter(x=>x.fileName.endsWith('.css')).map(x=>`<link rel="stylesheet" href="/${x.fileName}">`).join('');
 const server=createServer((req,res)=>{const asset=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let browser:Browser|undefined;const errors:string[]=[],writes:{path:string;body:any}[]=[];let failRead=false,failInsuranceRead=false,rejectWrite=false;
 const product={id:'p',revision:1,versions:[{id:'v2',version:2,revision:1,status:'DRAFT',configurationVersion:2,baseFeeAmount:300000,mileageMonthlyFeeAmount:99900,mileagePerMonthKm:2300,excessMileagePriceAmount:125,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:62000},name:'合成产品',months:12,monthlyFeeAmount:399900,energyDescription:'电池租金已含',conditions:'合成条款',vehicleIds:['car'],modelDefinitionIds:[],items:[]},{id:'v1',version:1,status:'PUBLISHED',name:'既有产品'}]};
 const insurance={id:'i',revision:1,files:[{fileId:'f',name:'合成保单.pdf',mimeType:'application/pdf',size:120,uploadedBy:'other'}],policyNumber:'LOCAL',insurer:'合成保险',policyType:'COMMERCIAL',insuredParty:'原被保险人',startAt:'2026-10-01T00:00:00Z',endAt:'2027-10-01T00:00:00Z',vehicles:[{id:'car',title:'合成车辆'}],versions:[{id:'iv',version:1,revision:1,status:'DRAFT',changeKind:'ORIGINAL',vehicleIds:['car'],fileIds:['f'],requirementVersionIds:[],coverageItems:[]},{id:'old-insurance',version:0,revision:0,status:'APPROVED',coverageItems:[],fileIds:[]}]};
 try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
  for(const width of [1440,390]){
   const baseWrites=writes.length,page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);
    if(req.method()!=='GET'){const multipart=req.headers()['content-type']?.includes('multipart/form-data'),body=multipart?JSON.parse(req.postDataBuffer()!.toString('utf8').match(/name="input"\r\n\r\n([^\r]+)/)![1]):req.postDataJSON();writes.push({path,body});if(path.includes('/registrations')){failInsuranceRead=true;return route.fulfill({json:{id:'i'}});}failRead=true;if(rejectWrite){rejectWrite=false;product.versions[0].revision=Number(product.versions[0].revision)+1;return route.fulfill({status:409,json:{error:{code:'REVISION_CONFLICT',message:'合成版本冲突'}}});}return route.fulfill({json:{id:'v2'}});}
    if(path==='/admin/products/p'){if(failRead){failRead=false;return route.fulfill({status:503,json:{error:{message:'合成读回失败'}}});}return route.fulfill({json:product});}
    if(path==='/admin/products')return route.fulfill({json:{items:[product],total:1}});
    if(path==='/admin/insurance-policies/i'){if(failInsuranceRead){failInsuranceRead=false;return route.fulfill({status:503,json:{error:{message:'合成保单读取失败'}}});}return route.fulfill({json:insurance});}
    if(path==='/admin/insurance-policies')return route.fulfill({json:{items:[insurance],total:1}});
    return route.fulfill({json:{items:path==='/admin/vehicles'?[{id:'car',title:'合成车辆'}]:[],total:path==='/admin/vehicles'?1:0}});
   });
   await page.goto(origin+'/#product-warehouse?record=p');const dialog=page.locator('.record-workspace-shell'),guide=dialog.getByRole('region',{name:'产品版本进度'});
   await expect(guide).toContainText('第 1 版仍按当前状态使用');
   const section=async(name:string)=>{await expect(dialog.getByRole('tab',{name,exact:true})).toBeVisible();await dialog.getByRole('tab',{name,exact:true}).click();};
   await section('详细资料');await dialog.getByRole('combobox',{name:'查看版本'}).selectOption('v1');await section('处理概览');await guide.getByRole('button',{name:'编辑当前草稿',exact:true}).click();
   const form=page.locator('.product-workbench-form');await expect(page.getByRole('heading',{name:'编辑产品草稿',exact:true})).toBeVisible();await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('合成产品');await form.getByRole('textbox',{name:'产品名称',exact:true}).fill('合成产品修改');
   failRead=true;await page.getByRole('button',{name:'刷新产品资料',exact:true}).click();await expect(page.getByRole('alert')).toContainText('合成读回失败');await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('合成产品修改');await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(form.getByRole('link',{name:'取消并返回仓库',exact:true})).toHaveAttribute('aria-disabled','false');
   await page.getByRole('button',{name:'刷新产品资料',exact:true}).click();await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();
   rejectWrite=true;await form.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(form.getByRole('alert')).toContainText('合成版本冲突');await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('合成产品修改');await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toHaveCount(0);await expect(form.getByRole('button',{name:'重新读取当前版本',exact:true})).toBeEnabled();
   await form.getByRole('button',{name:'重新读取当前版本',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'合成读回失败'}).first()).toBeVisible();await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toHaveCount(0);await expect(form.getByRole('textbox',{name:'产品名称',exact:true})).toHaveValue('合成产品修改');
   await form.getByRole('button',{name:'重新读取当前版本',exact:true}).click();await expect(form.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();await form.getByRole('button',{name:'保存草稿',exact:true}).click();
   await expect(form.getByText('保存已返回成功，仅核对读取结果，不重复提交。',{exact:true})).toBeVisible();assert.equal(writes.length,baseWrites+2);assert.equal(writes.at(-1)!.path,'/admin/products/p/versions/v2');assert.equal(writes.at(-1)!.body.revision,width===1440?2:3);
   await form.getByRole('button',{name:'重新读取草稿结果',exact:true}).click();await expect(dialog).toBeVisible();await expect(form).toHaveCount(0);assert.equal(writes.length,baseWrites+2,'Successful PATCH recovery must only GET the existing product');
   await page.goto(origin+'/?insurance#insurance?record=i');await expect(page.getByRole('heading',{name:'基本保险信息 未核验',exact:true})).toBeVisible();await page.getByRole('button',{name:'修改保险信息',exact:true}).click();
   const insuranceForm=page.locator('.insurance-registration');await expect(insuranceForm.getByLabel('保单号',{exact:true})).toHaveValue('LOCAL');await insuranceForm.getByRole('textbox',{name:'被保险人',exact:true}).fill('保留输入');
   await insuranceForm.getByLabel('修改说明',{exact:true}).fill('真实核对被保险人后更正');await insuranceForm.getByRole('checkbox',{name:'已核对车辆、保险有效期与所附保单原件',exact:true}).check();await insuranceForm.getByRole('button',{name:'保存修改',exact:true}).click();
   await expect(insuranceForm.getByText('登记请求已返回成功，仅核对读取结果，不重复提交。',{exact:true})).toBeVisible();await expect(insuranceForm.getByRole('textbox',{name:'被保险人',exact:true})).toHaveValue('保留输入');await expect(insuranceForm.getByRole('textbox',{name:'被保险人',exact:true})).toBeDisabled();await expect(insuranceForm.getByRole('button',{name:'取消',exact:true})).toBeDisabled();await expect(insuranceForm.getByLabel('保单与批单文件')).toBeDisabled();
   assert.equal(writes.length,baseWrites+3);assert.equal(writes.at(-1)!.path,'/admin/insurance-policies/i/registrations');assert.equal(writes.at(-1)!.body.insuredParty,'保留输入');assert.equal(writes.at(-1)!.body.revision,1);assert.equal(writes.at(-1)!.body.versionId,'iv');assert.equal(writes.at(-1)!.body.versionRevision,1);await insuranceForm.getByRole('button',{name:'重新读取登记结果',exact:true}).click();await expect(insuranceForm).toHaveCount(0);assert.equal(writes.length,baseWrites+3,'A committed insurance registration only GET-recovers');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.close();
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
