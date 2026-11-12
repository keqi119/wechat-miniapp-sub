import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('compact lists and non-modal workspaces preserve usable height, navigation and inputs',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const result=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'workspace-fixture',resolveId:id=>id==='virtual:workspace-fixture.tsx'?id:undefined,load:id=>id==='virtual:workspace-fixture.tsx'?`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {AdminTheme,InheritedAdminShell} from '/src/inherited-admin-shell';
 import {ResourceListLayout,ResourceListNavigationProvider} from '/src/resource-list-layout';
 import {RecordWorkspaceShell} from '/src/record-workspace-shell';
 import {Manager} from '/src/domain-ui';import {DetailFrame,Drawer} from '/src/ui';import {api} from '/src/core';
 import '/src/style.css';import '/src/seven-module.css';import '/src/domain-ui.css';import '/src/ninda-brand.css';
 api.setSession({user:{id:'operator',username:'local',role:'OPERATIONS',permissions:['*']},csrfToken:'local'});
 function Fixture(){const [modal,setModal]=React.useState(false), detail=location.search.includes('detail'),manager=location.search.includes('manager');return <AdminTheme><InheritedAdminShell navigation={[]} route="vehicles" userId="operator" userName="本地测试" roleLabel="运营" onNavigate={()=>{}} onLogout={()=>{}}>{manager?<Manager title="合成产品" description="本机布局测试" path="/admin/products" columns={[{key:'versions.0.name',label:'名称'}]}>{row=><p>{row.versions[0].name}</p>}</Manager>:detail?<RecordWorkspaceShell title="本地详情" subtitle="record-1" status="草稿" onBack={()=>{}} actions={<button className="button" onClick={()=>setModal(true)}>编辑资料</button>}><DetailFrame status="草稿" actions={<button className="button">正文操作</button>} onRefresh={()=>{}} tabs={[{key:'overview',label:'处理概览',content:<><label>备注<input aria-label="备注"/></label>{Array.from({length:30},(_,i)=><p key={i}>本地资料 {i}</p>)}</>},{key:'details',label:'详细资料',content:<p>详细资料内容</p>}]}/></RecordWorkspaceShell>:<ResourceListNavigationProvider navigation={<nav aria-label="模块导航"><a href="#vehicles">车辆档案</a><a href="#model-definitions">车型配置</a></nav>}><ResourceListLayout title="车辆档案" description="长说明应按需查看" actions={<button className="button primary">新增车辆</button>} toolbar={<input aria-label="搜索车辆"/>} pagination={<><span>共30条</span><button className="button">下一页</button></>}><div className="table-scroll"><table><thead><tr><th>车辆</th><th>状态</th></tr></thead><tbody>{Array.from({length:30},(_,i)=><tr key={i}><td>车辆 {i}</td><td>已发布</td></tr>)}</tbody></table></div></ResourceListLayout></ResourceListNavigationProvider>}</InheritedAdminShell>{modal?<Drawer title="编辑资料" onClose={()=>setModal(false)}><input aria-label="子表单"/></Drawer>:null}</AdminTheme>}
 createRoot(document.getElementById('root')).render(<Fixture/>);
 `:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:workspace-fixture.tsx'}}});
 const output=(Array.isArray(result)?result[0]:result) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]};
 const assets=new Map(output.output.map(item=>['/'+item.fileName,item])),script=output.output.find(item=>item.type==='chunk')!.fileName;
 const styles=output.output.filter(item=>item.fileName.endsWith('.css')).map(item=>`<link rel="stylesheet" href="/${item.fileName}">`).join('');
 const server=createServer((request,response)=>{const asset=assets.get(new URL(request.url!,'http://localhost').pathname);response.setHeader('Content-Type',asset?asset.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');response.end(asset?asset.code||asset.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 try{try{browser=await chromium.launch({headless:true});}catch(error){if(!(error instanceof Error)||!error.message.includes("Executable doesn't exist"))throw error;browser=await chromium.launch({channel:'chrome',headless:true});}
 const page=await browser.newPage();const records=Array.from({length:20},(_,i)=>({id:'product-'+i,revision:1,versions:[{id:'version-'+i,version:1,status:'PUBLISHED',name:'local '+i,months:12,monthlyFeeAmount:399900}]}));await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/api/admin/products'?{items:records,total:40}:path.startsWith('/api/admin/products/')?records.find(record=>path.endsWith('/'+record.id)):{items:[],total:0}});});
 for(const [width,height,min] of [[1440,900,550],[1366,768,420]]){
  await page.setViewportSize({width,height});await page.goto(origin+'/#vehicles');await expect(page.getByRole('button',{name:'新增车辆'})).toBeVisible();
  const list=await page.locator('.resource-list-content').boundingBox();assert.ok(list&&list.height-54>=min,`table body at ${height}: ${list?.height}`);
  assert.ok(await page.locator('.resource-list-heading').evaluate(e=>e.clientHeight<=48));
  await page.goto(origin+'/?detail#products?record=record-1');await expect(page.getByRole('heading',{name:'本地详情'})).toBeVisible();
  await expect(page.getByRole('tablist',{name:'详情分区'})).toHaveAttribute('aria-orientation','horizontal');
  assert.equal(await page.getByRole('dialog').count(),0);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
  const content=await page.locator('.detail-panel-scroll').boundingBox();assert.ok(content&&content.height>=(height===900?580:450),`detail body at ${height}: ${content?.height}`);
  await page.getByRole('textbox',{name:'备注',exact:true}).fill('输入保留');await page.getByRole('tab',{name:'详细资料',exact:true}).click();await page.getByRole('tab',{name:'处理概览',exact:true}).click();await expect(page.getByRole('textbox',{name:'备注',exact:true})).toHaveValue('输入保留');
  await page.getByRole('button',{name:'编辑资料',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'备注',exact:true})).toHaveValue('输入保留');
 }
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/#vehicles');await page.getByLabel('车辆档案办理说明').click();const help=await page.getByRole('note').boundingBox();assert.ok(help&&help.x>=0&&help.x+help.width<=390);await page.goto(origin+'/?detail#products?record=record-1');await expect(page.getByRole('tablist',{name:'详情分区'})).toBeVisible();await page.getByRole('tab',{name:'详细资料',exact:true}).click();await expect(page.getByText('详细资料内容')).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?manager#products?page=2');await page.getByRole('textbox',{name:'筛选当前页',exact:true}).fill('local');const table=page.locator('.resource-list-content .table-scroll');await table.evaluate(element=>element.scrollTop=300);await page.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>table.evaluate(element=>element.scrollTop)).toBeGreaterThanOrEqual(299);await page.getByRole('row').filter({hasText:'local 10'}).getByRole('button',{name:'查看办理'}).click();await expect(page.locator('.record-workspace-shell')).toBeVisible();await page.getByRole('button',{name:'返回列表',exact:true}).click();await expect(page.getByRole('textbox',{name:'筛选当前页',exact:true})).toHaveValue('local');await expect.poll(()=>table.evaluate(element=>element.scrollTop)).toBeGreaterThanOrEqual(299);assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('page'),'2');
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
