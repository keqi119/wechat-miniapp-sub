import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {createServer,type ViteDevServer} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

let server:ViteDevServer,browser:Browser,origin:string;
const evidence=fileURLToPath(new URL('../../../.runtime/vehicle-partner-20261103/ui/',import.meta.url));
const owner={id:'owner-active',name:'合成有效合作商',source:'AGREEMENT'};
const first={id:'owner-first',name:'合成登记甲公司'},second={id:'owner-second',name:'合成登记乙公司'};
const cases=[
 {name:'active cooperation stays authoritative',id:'active',facts:{cooperationOwner:owner,cooperationRegistration:null},label:'合成有效合作商',note:null,candidates:[]},
 {name:'one registered owner without effective cooperation shows pending agreement',id:'pending',facts:{cooperationOwner:null,cooperationRegistration:{status:'PENDING_AGREEMENT',owners:[first]}},label:'合成登记甲公司',note:'协议待补',candidates:[]},
 {name:'conflicting registrations show every candidate without selecting the first',id:'conflict',facts:{cooperationOwner:null,cooperationRegistration:{status:'CONFLICT',owners:[first,second]}},label:'合作商待核对',note:null,candidates:[first.name,second.name]},
 {name:'effective cooperation wins while conflicting registration remains visible',id:'active-conflict',facts:{cooperationOwner:owner,cooperationRegistration:{status:'CONFLICT',owners:[first,second]}},label:'合成有效合作商',note:'资料关联待核对',candidates:[first.name,second.name]},
 {name:'no effective or registered cooperation is explicitly unregistered',id:'empty',facts:{cooperationOwner:null,cooperationRegistration:null},label:'未登记合作商',note:null,candidates:[]},
 {name:'legacy DTO with effective owner needs no registration field',id:'legacy-active',facts:{cooperationOwner:owner},label:'合成有效合作商',note:null,candidates:[]},
 {name:'legacy DTO with no effective owner does not infer a registered owner',id:'legacy-empty',facts:{cooperationOwner:null},label:'未登记合作商',note:null,candidates:[]},
] as const;
const vehicle=(row:typeof cases[number])=>({id:row.id,title:`合成车辆-${row.id}`,vin:'TESTVIN0000000001',plateNumber:'沪A合成',brand:'合成品牌',model:'合成车型',status:'DRAFT',revision:1,mileageKm:0,...row.facts});

before(async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from '/src/App';import {VehicleWorkspace} from '/src/vehicle-workspace';import {api} from '/src/core';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';
 const fixture=window.cooperationFixture;if(fixture.mode==='detail')api.setSession(fixture.session);
 createRoot(document.getElementById('root')).render(fixture.mode==='detail'?React.createElement(VehicleWorkspace,{entity:fixture.entity,status:'草稿',actions:null,onRefresh:()=>{},renderValues:()=>null}):React.createElement(App));`;
 server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',cacheDir:evidence+'vite-cache',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:0},plugins:[{
  name:'vehicle-cooperation-test',
  configureServer(s){s.middlewares.use('/cooperation.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/cooperation-entry.js"></script></body></html>');});},
  resolveId:id=>id==='/cooperation-entry.js'?'\0cooperation-entry':null,
  load:id=>id==='\0cooperation-entry'?entry:null,
 }]});
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();await server?.close();});

async function fixture(mode:'list'|'detail',entity:Record<string,unknown>,role='OPERATIONS'){
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[],violations:string[]=[];
 page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(60000);
 const session={user:{id:'local-cooperation-operator',username:'本地合成员工',role,permissions:['vehicles.read']},csrfToken:'synthetic-csrf'};
 await page.addInitScript(value=>{(window as any).cooperationFixture=value;},{mode,entity,session});
 page.on('pageerror',error=>{errors.push(error.message);console.error('Cooperation fixture browser error:',error.message);});
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){violations.push('external request');return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET'){violations.push('unexpected write');return route.fulfill({status:405,json:{error:{code:'READ_ONLY_FIXTURE'}}});}
  if(url.pathname==='/api/admin/auth/me')return route.fulfill({json:session});
  if(url.pathname==='/api/admin/vehicles')return route.fulfill({json:{page:1,pageSize:12,total:1,items:[entity]}});
  violations.push('unexpected API '+url.pathname);return route.fulfill({status:404,json:{error:{code:'UNEXPECTED_FIXTURE_ROUTE'}}});
 });
 await page.goto(origin+'/cooperation.html#vehicles');
 return {page,errors,violations};
}

for(const mode of ['list','detail'] as const){
 for(const row of cases){
  test(`${mode}: ${row.name}`,{timeout:90000},async()=>{
   const {page,errors,violations}=await fixture(mode,vehicle(row));
   try{
    const fact=mode==='list'
     ?page.getByRole('row').filter({has:page.getByRole('cell',{name:`合成车辆-${row.id}`,exact:true})}).getByRole('cell').nth(4)
     :page.locator('.ant-descriptions-row').filter({has:page.getByText('合作商',{exact:true})}).locator('.ant-descriptions-item-content');
    // Literal expectations catch the former null fallback and accidental first-candidate selection.
    const expected=[row.label,row.note,row.candidates.length?'登记候选：'+row.candidates.join('、'):null].filter(Boolean).join('');
    await expect(fact).toHaveText(expected);
    await expect(fact).not.toContainText('暂无有效合作商');
    if(row.id==='active-conflict')await page.screenshot({path:evidence+`${mode}-conflict.png`,fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
   }finally{await page.close();}
  });
 }
 for(const role of ['FINANCE','SUPPORT']){
  test(`${mode}: ${role} legacy projection does not acquire cooperation facts or candidates`,{timeout:90000},async()=>{
   const {page,errors,violations}=await fixture(mode,{id:'private-omitted',title:'合成原岗位车辆',status:'DRAFT'},role);
   try{
    await expect(page.getByText('合成原岗位车辆',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('合作商',{exact:true})).toHaveCount(0);
    await expect(page.getByText(/协议待补|资料关联待核对|合作商待核对|登记候选：|合成登记甲公司|合成登记乙公司/)).toHaveCount(0);
    assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
   }finally{await page.close();}
  });
 }
}
