import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'vite';
import {chromium,expect,type Browser,type Page,type Route} from '@playwright/test';

type FixtureRecord={id:string;name:string;revision:number;identity:{verified:boolean}};
type FixtureState={record:FixtureRecord;holdDetail:boolean;pending:Route[];writes:{path:string;body:Record<string,unknown>}[];errors:string[]};

test('Manager keeps record toolbar available across tabs and preserves command read guards',async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),evidence=resolve(root,'../../.runtime/partner-identity-progress-20261110/manager-toolbar');
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{Manager,Command,DetailSection}from'/src/domain-ui';import{api}from'/src/core';import'/src/style.css';import'/src/ninda-brand.css';import'/src/seven-module.css';import'/src/domain-ui.css';
 api.setSession({user:{id:'synthetic-toolbar-operator',username:'local-test',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic-only'});
 const progress=row=>row.identity?.verified?'已认证':'待认证';
 const columns=[{key:'name',label:'名称'},{key:'identityProgress',label:'认证进度',value:progress,render:row=><span aria-label={'表格状态 '+progress(row)}>{progress(row)} · 仅列表标记</span>}];
 const plain=new URLSearchParams(location.search).has('plain');
 const toolbar=(row,reload)=><Command label="修改资料" submitLabel="保存修改" presentation="drawer" path={'/admin/toolbar-records/'+row.id+'/profile'} revision={row.revision} initial={{name:row.name}} fields={[{key:'name',label:'记录名称',required:true}]} after={reload}/>;
 createRoot(document.getElementById('root')).render(<main style={{height:'100vh',padding:16,boxSizing:'border-box'}}><Manager title="合成记录" description="仅本机测试" path="/admin/toolbar-records" columns={columns} detailToolbar={plain?undefined:toolbar}>{row=><><p>当前详细资料：{row.name}</p><DetailSection sectionKey="evidence" label="材料记录"><p>本记录的合成材料</p></DetailSection></>}</Manager></main>);`;
 const bundle=await build({root,configFile:false,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'manager-toolbar-fixture',resolveId:id=>id==='virtual:manager-toolbar.tsx'?id:undefined,load:id=>id==='virtual:manager-toolbar.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:manager-toolbar.tsx'}}});
 const output=(Array.isArray(bundle)?bundle[0]:bundle) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]};
 const assets=new Map(output.output.map(file=>['/'+file.fileName,file])),script=output.output.find(file=>file.type==='chunk')!.fileName,styles=output.output.filter(file=>file.fileName.endsWith('.css')).map(file=>`<link rel="stylesheet" href="/${file.fileName}">`).join('');
 const server=createServer((req,res)=>{const asset=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(asset?asset.code||asset.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await mkdir(evidence,{recursive:true});
 let browser:Browser|undefined;
 const metrics:unknown[]=[];
 async function fixture(width=1440){
  const page=await browser!.newPage({viewport:{width,height:900}});page.setDefaultTimeout(4000);
  const state:FixtureState={record:{id:'record-a',name:'合成甲',revision:7,identity:{verified:true}},holdDetail:false,pending:[],writes:[],errors:[]};
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'Browser tests must remain on loopback');
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const path=url.pathname.slice(4);
   if(path==='/admin/toolbar-records'&&request.method()==='GET')return route.fulfill({json:{items:[state.record,{id:'record-b',name:'合成乙',revision:1,identity:{verified:false}}],total:2}});
   if(path==='/admin/toolbar-records/record-a'&&request.method()==='GET'){
    if(state.holdDetail){state.pending.push(route);return;}
    return route.fulfill({json:state.record});
   }
   if(path==='/admin/toolbar-records/record-a/profile'&&request.method()==='POST'){
    const body=request.postDataJSON();state.writes.push({path,body});state.record={...state.record,name:body.name,revision:state.record.revision+1};
    return route.fulfill({json:{id:state.record.id,revision:state.record.revision}});
   }
   assert.fail('Unexpected synthetic request '+request.method()+' '+path);
  });
  return {page,state};
 }
 const openDetail=async(page:Page,query='')=>{await page.goto(origin+'/'+query+'#partners?record=record-a&view=details');await expect(page.getByRole('tab',{name:'详细资料',exact:true})).toHaveAttribute('aria-selected','true');};
 try{
  try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
  for(const width of [1440,390])await t.test(`${width}px toolbar remains in record navigation, edits in a drawer, and preserves the current tab`,async()=>{
   const {page,state}=await fixture(width);
   try{
    await openDetail(page);
    const nav=page.getByRole('navigation',{name:'本记录分区',exact:true}),tabs=page.getByRole('tablist',{name:'详情分区',exact:true}),trigger=nav.getByRole('button',{name:'修改资料',exact:true});
    await expect(trigger).toBeVisible({timeout:3000});
    assert.equal(await trigger.evaluate(element=>!!element.closest('[role=tablist]')),false,'Record actions are not tabs');
    const buttonBox=await trigger.boundingBox(),tabBox=await tabs.boundingBox(),navBox=await nav.boundingBox(),headerBox=await page.locator('.record-workspace-header').boundingBox();
    assert(buttonBox&&tabBox&&navBox&&headerBox);
    assert(navBox.y>=headerBox.y+headerBox.height-1,'Record toolbar stays below the header refresh row');
    if(width>=1000){
     assert(Math.abs(buttonBox.y+buttonBox.height/2-(tabBox.y+tabBox.height/2))<=5,'Toolbar and tabs share one desktop row');
     assert(buttonBox.x>=tabBox.x+tabBox.width-1,'Toolbar is to the right of the tablist');
     assert(buttonBox.x+buttonBox.width>=navBox.x+navBox.width-24,'Toolbar is aligned to the navigation right edge');
    }
    assert(buttonBox.x>=0&&buttonBox.x+buttonBox.width<=width,'Toolbar remains within the viewport');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Record navigation must not overflow horizontally');
    for(const label of ['处理概览','材料记录','详细资料']){await page.getByRole('tab',{name:label,exact:true}).click();await expect(trigger).toBeVisible();}
    await trigger.click();
    const drawer=page.getByRole('dialog',{name:'修改资料',exact:true});await expect(drawer).toBeVisible();
    await expect(page.getByRole('tab',{name:'详细资料',exact:true})).toHaveAttribute('aria-selected','true');
    assert.equal(new URL(page.url()).hash.includes('view=details'),true,'Opening the command must not redirect to overview');
    await expect(page.getByRole('tabpanel',{name:'处理概览',exact:true})).toBeHidden();
    await expect(drawer.getByLabel('记录名称',{exact:true})).toHaveValue('合成甲');
    await drawer.getByLabel('记录名称',{exact:true}).fill('已修改合成记录');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Editing drawer must not overflow at narrow width');
    await page.screenshot({path:resolve(evidence,`drawer-${width}.png`)});
    await drawer.getByRole('button',{name:'保存修改',exact:true}).click();
    await expect(drawer).toHaveCount(0);await expect.poll(()=>state.writes.length).toBe(1);
    assert.equal(state.writes[0].body.revision,7);assert.equal(state.writes[0].body.name,'已修改合成记录');assert.equal(typeof state.writes[0].body.idempotencyKey,'string');
    await expect(page.getByRole('tabpanel',{name:'详细资料',exact:true})).toContainText('已修改合成记录');
    await expect(page.getByRole('tab',{name:'详细资料',exact:true})).toHaveAttribute('aria-selected','true');await expect(trigger).toBeEnabled();
    await page.screenshot({path:resolve(evidence,`toolbar-${width}.png`)});metrics.push({width,buttonBox,tabBox,navBox,headerBox});assert.deepEqual(state.errors,[]);
   }finally{await page.close();}
  });
  await t.test('a pending or failed detail refresh disables both an open toolbar drawer and later command attempts until a successful reread',async()=>{
   const {page,state}=await fixture();
   try{
    await openDetail(page);const trigger=page.getByRole('navigation',{name:'本记录分区'}).getByRole('button',{name:'修改资料',exact:true});await expect(trigger).toBeVisible({timeout:3000});await trigger.click();
    const drawer=page.getByRole('dialog',{name:'修改资料',exact:true}),input=drawer.getByLabel('记录名称',{exact:true});await input.fill('尚未提交的输入');
    state.holdDetail=true;
    // An independent detail refresh can finish while a drawer is open; invoke the real header handler without closing it.
    await page.getByRole('button',{name:'刷新详情',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
    await expect.poll(()=>state.pending.length).toBe(1);await expect(input).toBeDisabled();await expect(drawer.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();await expect(trigger).toBeDisabled();
    await drawer.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(state.writes.length,0);
    state.holdDetail=false;await state.pending.shift()!.fulfill({status:503,json:{error:{code:'READ_UNAVAILABLE',message:'本次详情读取失败'}}});
    await expect(page.getByRole('alert')).toContainText('本次详情读取失败');await expect(input).toHaveValue('尚未提交的输入');await expect(input).toBeDisabled();await expect(drawer.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
    await drawer.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(state.writes.length,0);
    await drawer.getByRole('button',{name:'取消',exact:true}).click();await expect(trigger).toBeDisabled();
    state.record={...state.record,name:'重新读取的记录',revision:9};await page.getByRole('button',{name:'刷新详情',exact:true}).click();await expect(trigger).toBeEnabled();await trigger.click();
    await expect(page.getByRole('dialog').getByLabel('记录名称',{exact:true})).toHaveValue('重新读取的记录');await page.getByRole('dialog').getByRole('button',{name:'保存修改',exact:true}).click();
    await expect.poll(()=>state.writes.length).toBe(1);assert.equal(state.writes[0].body.revision,9);assert.equal(state.writes[0].body.name,'重新读取的记录');assert.deepEqual(state.errors,[]);
   }finally{for(const route of state.pending)await route.abort().catch(()=>{});await page.close();}
  });
  await t.test('computed column values drive filtering and summary while render is confined to table cells',async()=>{
   const {page,state}=await fixture();
   try{
    await page.goto(origin+'/#partners');await expect(page.getByRole('row').filter({hasText:'合成甲'})).toContainText('已认证 · 仅列表标记');await expect(page.getByRole('row').filter({hasText:'合成乙'})).toContainText('待认证 · 仅列表标记');
    await page.getByLabel('筛选当前页',{exact:true}).fill('已认证');await expect(page.getByRole('button',{name:'查看办理',exact:true})).toHaveCount(1);await expect(page.getByRole('row').filter({hasText:'合成乙'})).toHaveCount(0);
    await page.getByRole('button',{name:'查看办理',exact:true}).click();const overview=page.getByRole('tabpanel',{name:'处理概览',exact:true});await expect(overview).toBeVisible();
    const fact=overview.locator('.domain-facts > div').filter({has:page.locator('dt',{hasText:'认证进度'})});await expect(fact.locator('dd')).toHaveText('已认证');await expect(overview).not.toContainText('仅列表标记');assert.deepEqual(state.errors,[]);
   }finally{await page.close();}
  });
  await t.test('records without a toolbar retain the existing tab-only navigation',async()=>{
   const {page,state}=await fixture(390);
   try{
    await openDetail(page,'?plain');const nav=page.getByRole('navigation',{name:'本记录分区',exact:true});await expect(nav.getByRole('button',{name:'修改资料',exact:true})).toHaveCount(0);await expect(nav.getByRole('tab')).toHaveCount(3);
    assert.equal(await nav.evaluate(element=>getComputedStyle(element).display),'block','Do not apply the toolbar flex layout to existing modules');
    await page.getByRole('tab',{name:'材料记录',exact:true}).click();await expect(page.getByRole('tabpanel',{name:'材料记录',exact:true})).toContainText('本记录的合成材料');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(state.errors,[]);
   }finally{await page.close();}
  });
  await writeFile(resolve(evidence,'layout-metrics.json'),JSON.stringify({synthetic:true,productionRequests:0,metrics},null,2)+'\n');
 }finally{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));}
});
