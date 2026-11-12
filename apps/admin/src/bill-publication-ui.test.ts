import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('finance sees automatic publication plans across list, detail and order funds without manual rent actions',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'bill-publication-fixture',resolveId:id=>id==='virtual:bill-publication'?id:undefined,load:id=>id==='virtual:bill-publication'?`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';createRoot(document.getElementById('root')).render(React.createElement(App));`:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:bill-publication'}}});
 const output=(Array.isArray(result)?result[0]:result) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]};
 const assets=new Map(output.output.map(item=>['/'+item.fileName,item])),script=output.output.find(item=>item.type==='chunk')!.fileName,styles=output.output.filter(item=>item.fileName.endsWith('.css')).map(item=>`<link rel="stylesheet" href="/${item.fileName}">`).join('');
 const server=createServer((request,response)=>{const asset=assets.get(new URL(request.url!,'http://localhost').pathname);response.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');response.end(asset?asset.code||asset.source:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<div id="root"></div><script type="module" src="/${script}"></script>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 const base={orderId:'qa-order',customerId:'qa-customer',amount:499900,paidAmount:0,status:'DRAFT',dueDate:'2026-11-30T00:00:00.000Z',createdAt:'2026-10-29T00:00:00.000Z'};
 const bills=[
  {...base,id:'qa-rent',type:'SUBSCRIPTION',publication:{mode:'AUTOMATIC',scheduledDate:'2026-11-27',state:'SCHEDULED',message:'到期前 3 天自动发布，无需逐个操作。',blockers:[]}},
  {...base,id:'qa-deposit',type:'DEPOSIT',publication:{mode:'AUTOMATIC',scheduledDate:'2026-11-27',state:'BLOCKED',message:'线下合同资料尚未归档，完成审核后系统自动重试。',blockers:['OFFLINE_ARCHIVE_REQUIRED']}},
  {...base,id:'qa-waiting',type:'SUBSCRIPTION',publication:{mode:'AUTOMATIC',scheduledDate:'2026-10-28',state:'WAITING',message:'已到发布时间，等待下一次自动任务。',blockers:[]}},
  {...base,id:'qa-legacy',type:'SUBSCRIPTION'},
  {...base,id:'qa-extra',type:'EXTRA_FEE',status:'REVIEWED',createdBy:'another-finance',publication:{mode:'MANUAL',scheduledDate:null,state:'MANUAL',message:'费用账单需独立复核后发布。',blockers:[]}}
 ];
 try{
  try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}}),writes:string[]=[],pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
   await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();if(request.method()!=='GET')writes.push(url.pathname);
    const path=url.pathname.slice(4);let value:unknown;
    if(path==='/admin/auth/me')value={user:{id:'finance',username:'synthetic',role:'FINANCE',permissions:['bills.read','bills.write','orders.read']},csrfToken:'local'};
    else if(path==='/admin/bills')value={items:bills,total:bills.length,page:1,pageSize:12};
    else if(path.startsWith('/admin/bills/'))value=bills.find(b=>b.id===path.split('/').at(-1));
    else if(path==='/admin/orders')value={items:[{id:'qa-order',contractMode:'OFFLINE',status:'ACTIVE',revision:0}],total:1,page:1,pageSize:12};
    else if(path==='/admin/orders/qa-order')value={id:'qa-order',contractMode:'OFFLINE',status:'ACTIVE',revision:0,customerId:'qa-customer'};
    else if(path==='/admin/orders/qa-order/workspace')value={orderId:'qa-order',billing:bills,contracts:[],handovers:[],timeline:[],blockers:[],process:{version:1,orderId:'qa-order',orderRevision:0,currentStep:'IN_USE',steps:['APPLICATION','CONTRACT','PAYMENT','DELIVERY','IN_USE','RETURN','SETTLEMENT'].map(key=>({key,label:key,state:key==='IN_USE'?'CURRENT':'DONE',summary:'',checks:[],actions:[]})),blockers:[],attention:[],related:{archives:[],bills:bills.map(b=>({...b,payments:[]})),tasks:[],handovers:[],settlements:[]}}};
    else throw new Error(`Unexpected local API request: ${path}`);
    return route.fulfill({json:value});
   });
   await page.goto(origin+'/#bills');
   const rentRow=page.getByRole('row').filter({hasText:'qa-rent'});await expect(rentRow).toContainText('2026-11-27');await expect(rentRow).toContainText('自动发布');
   await expect(page.getByRole('row').filter({hasText:'qa-deposit'})).toContainText('线下合同资料尚未归档');
   for(const id of ['qa-rent','qa-deposit','qa-waiting','qa-legacy']){
    await page.getByRole('button',{name:id,exact:true}).click();const dialog=page.getByRole('dialog'),notice=dialog.getByRole('region',{name:'账单发布安排'});
    await expect(notice).toBeVisible();await expect(dialog.getByRole('button',{name:'发布账单',exact:true})).toHaveCount(0);
    if(id==='qa-deposit'){await expect(notice).toContainText('线下合同资料尚未归档');await expect(notice).not.toContainText('OFFLINE_ARCHIVE_REQUIRED');}
    else if(id==='qa-waiting')await expect(notice).toContainText('等待下一次自动任务');
    else if(id==='qa-legacy')await expect(notice).toContainText('计划待核对');
    else await expect(notice).toContainText('2026-11-27');
    if(id==='qa-rent'&&process.env.NINDA_BILL_QA_SCREENSHOT_ROOT)await page.screenshot({path:`${process.env.NINDA_BILL_QA_SCREENSHOT_ROOT}/bill-${width}.png`});
    await dialog.getByRole('button',{name:'关闭面板',exact:true}).click();
   }
   await page.getByRole('button',{name:'qa-extra',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'发布账单',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭面板',exact:true}).click();
   await page.goto(origin+'/#orders?record=qa-order&view=funds');const funds=page.getByRole('region',{name:'本单资金明细'});await expect(funds.getByRole('table',{name:'本单账单'})).toBeVisible();await expect(funds.locator('tbody tr')).toHaveCount(bills.length);
   for(const [index,id]of ['qa-rent','qa-deposit'].entries()){await funds.locator('tbody tr').nth(index).getByRole('button',{name:'查看本笔账单应付金额',exact:true}).click();const dialog=page.getByRole('dialog'),notice=dialog.getByRole('region',{name:'账单发布安排'});await expect(notice).toContainText(id==='qa-rent'?'2026-11-27':'线下合同资料尚未归档');await expect(dialog.getByRole('button',{name:'发布账单',exact:true})).toHaveCount(0);assert.equal(new URLSearchParams((await page.evaluate(()=>location.hash)).split('?')[1]).get('record'),id);await dialog.getByRole('button',{name:'返回本单办理',exact:true}).click();await expect(funds.getByRole('table')).toBeVisible();}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(pageErrors,[]);assert.deepEqual(writes,[]);await page.close();
  }
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
