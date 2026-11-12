import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {build} from 'vite';
import {chromium,expect} from '@playwright/test';

test('agreement percentage accepts a unit suffix without changing precision or range rules',async()=>{
 const {partnerPercentageToBps}=await import('./partner-simple-model.ts');
 for(const [value,want] of [['80%',8000],[' 80 ％ ',8000],['62.35%',6235],['0%',0],['100%',10000]] as const)assert.equal(partnerPercentageToBps(value),want);
 for(const value of ['%','80%%','%80','80%20','100.01%','0.001%','-1%','1e2%'])assert.throws(()=>partnerPercentageToBps(value));
});

test('agreement save provides visible failure feedback and submits percent input from the actual drawer',async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'agreement-save-fixture',resolveId:id=>id==='virtual:agreement-save'?id:undefined,load:id=>id==='virtual:agreement-save'?`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {PartnersPage} from '/src/partners';import '/src/style.css';import '/src/ninda-brand.css';import '/src/domain-ui.css';api.setSession({user:{id:'operator',username:'synthetic',role:'OPERATIONS',permissions:[],partnerCapabilities:[]},csrfToken:'synthetic'});createRoot(document.getElementById('root')).render(React.createElement(PartnersPage,{view:'partners'}));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:agreement-save'}}});
 const output=(Array.isArray(result)?result[0]:result) as any,assets=new Map<string,any>(output.output.map((item:any)=>['/'+item.fileName,item])),script=output.output.find((item:any)=>item.type==='chunk').fileName,styles=output.output.filter((item:any)=>item.fileName.endsWith('.css')).map((item:any)=>`<link rel="stylesheet" href="/${item.fileName}">`).join('');
 const server=createServer((request,response)=>{const asset=assets.get(new URL(request.url!,'http://localhost').pathname);response.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');response.end(asset?asset.code||asset.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [1440,390])for(const scenario of ['validation','server','percent','display','upload'])await t.test(`${scenario} at ${width}px`,async()=>{
   const page=await browser.newPage({viewport:{width,height:905}}),writes:any[]=[],partner:any={id:'owner',name:'合成合作公司',subjectType:'ENTERPRISE',status:'DRAFT',revision:0,agreementCount:0,vehicleCount:0,agreements:[],vehicles:[],vehicleAssignments:[]};
   if(scenario==='display'){const version={id:'version',title:Buffer.from('产证新1.1.jpg','utf8').toString('latin1'),displayTitle:'产证新1.1.jpg',version:1,status:'ACTIVE',fileIds:['file'],vehicleIds:['v1'],partnerRateBps:8000};partner.agreements=[{id:'agreement',revision:1,status:'ACTIVE',currentVersion:version,latestVersion:version,versions:[version],files:[{id:'file',name:'产证新1.1.jpg'}]}];partner.agreementCount=1;partner.vehicleCount=1;}
   let finishUpload:(()=>void)|undefined;
   try{
    await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);
     if(request.method()!=='GET'){
      if(path==='/admin/files'){if(scenario==='upload')await new Promise<void>(resolve=>{finishUpload=resolve;});return route.fulfill({json:{id:'file',name:'合成合作协议.jpg'}});}
      assert.equal(path,'/admin/partners/owner/agreements');writes.push(request.postDataJSON());
      return route.fulfill(scenario==='server'?{status:400,json:{error:{code:'FILE_PURPOSE_INVALID',message:'请重新选择有效的协议文件'},requestId:'synthetic-validation'}}:{json:{id:'saved'}});
     }
     return route.fulfill({json:path==='/admin/partners/owner/company-admin'?{revision:0,status:'UNSET',current:null}:path==='/admin/partners/owner/revenue'?{totals:{receivedAmount:0,refundedAmount:0,netAmount:0,partnerAmount:0,platformAmount:0},groups:[],items:[],total:0,page:1,pageSize:20,incompleteCount:0}:path==='/admin/partners/owner'?partner:path==='/admin/partners'?[partner]:path==='/admin/vehicles'?{items:[{id:'v1',plateNumber:'沪合成001',model:'ET5T'},{id:'v2',plateNumber:'沪合成002',model:'ET5'},{id:'v3',plateNumber:'沪合成003',model:'ET5T'}],total:3}:[]});
    });
    await page.goto(origin+'/#partners');await page.getByRole('button',{name:'查看办理',exact:true}).click();const dialog=page.locator('.record-workspace-shell');await expect(dialog.getByRole('tab',{name:'合作协议',exact:true})).toBeVisible();await dialog.getByRole('tab',{name:'合作协议',exact:true}).click();
    if(scenario==='display'){
     await expect(dialog.getByRole('heading',{name:'产证新1.1.jpg',exact:true})).toBeVisible();await expect(dialog.getByRole('link',{name:'产证新1.1.jpg',exact:true})).toBeVisible();
     await dialog.getByRole('button',{name:'编辑协议',exact:true}).click();await dialog.locator('.simple-agreement-editor summary').click();await expect(dialog.getByLabel('协议名称（选填）')).toHaveValue('产证新1.1.jpg');
     assert.equal(writes.length,0);return;
    }
    await dialog.getByRole('button',{name:'登记合作协议',exact:true}).click();const ratio=dialog.getByLabel('合作商分润比例（%）');await ratio.fill(scenario==='validation'?'101':scenario==='percent'?'80%':'80');
    await dialog.getByLabel('协议文件').setInputFiles({name:'合成合作协议.jpg',mimeType:'image/jpeg',buffer:Buffer.from('synthetic-image')});await dialog.getByRole('checkbox',{name:/沪合成001/}).check();
    if(scenario==='upload'){await expect.poll(()=>!!finishUpload).toBe(true);finishUpload!();await expect(dialog.getByRole('link',{name:'合成合作协议.jpg'})).toBeVisible();await expect(dialog.getByRole('checkbox',{name:/沪合成001/})).toBeChecked();}
    // Match the user's position: editor heading at the top of the inner scroll,
    // with the save buttons already visible because their footer is sticky.
    await dialog.locator('.detail-panel-scroll').evaluate(element=>{const heading=element.querySelector('.simple-agreement-editor h4')!;element.scrollTop+=heading.getBoundingClientRect().top-element.getBoundingClientRect().top-12;});
    await dialog.getByRole('button',{name:'保存有效协议',exact:true}).click();
    if(scenario==='percent'||scenario==='upload'){
     await expect.poll(()=>writes.length).toBe(1);assert.equal(writes[0].partnerRateBps,8000);assert.equal(writes[0].status,'ACTIVE');assert.deepEqual(writes[0].vehicleIds,['v1']);assert.deepEqual(writes[0].fileIds,['file']);await expect(ratio).toHaveCount(0);
    }else{
     const alert=dialog.getByRole('alert');await expect(alert).toContainText(scenario==='validation'?'100%':'协议文件');
     if(process.env.PARTNER_SAVE_QA_DIR){await mkdir(process.env.PARTNER_SAVE_QA_DIR,{recursive:true});await page.screenshot({path:join(process.env.PARTNER_SAVE_QA_DIR,`${scenario}-${width}.png`),fullPage:true});}
     await expect(alert).toBeInViewport({ratio:1});
     const bounds=await alert.boundingBox();assert(bounds);assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[role="alert"]')!==null,{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}),true,'failure feedback must not be covered by the sticky save buttons');
     await expect(ratio).toHaveValue(scenario==='validation'?'101':'80');await expect(dialog.getByRole('checkbox',{name:/沪合成001/})).toBeChecked();assert.equal(writes.length,scenario==='validation'?0:1);
    }
   }finally{await page.close();}
  });
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
