import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';
const apiPackage=new URL('../../api/package.json',import.meta.url),apiRequire=createRequire(apiPackage),oldTsconfig=process.env.TSX_TSCONFIG_PATH;
process.env.TSX_TSCONFIG_PATH=fileURLToPath(new URL('../../api/tsconfig.json',import.meta.url));
const scoped=apiRequire('tsx/cjs/api').register({namespace:'contract-party-schema'}),{metadataSchema}=scoped.require('./src/offline-documents/schemas.ts',apiPackage);
scoped.unregister();if(oldTsconfig===undefined)delete process.env.TSX_TSCONFIG_PATH;else process.env.TSX_TSCONFIG_PATH=oldTsconfig;
let browser:Browser,server:Server,origin:string;
before(async()=>{
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ArchiveDetail}from'/src/contract-center';import{api}from'/src/core';import'/src/style.css';import'/src/domain-ui.css';api.setSession({user:{id:'operator',username:'synthetic',role:'OPERATIONS',permissions:['*']},csrfToken:'synthetic'});function Fixture(){const[row,setRow]=React.useState();const reload=async()=>setRow(await api.request('/admin/offline-archives/archive'));React.useEffect(()=>{void reload();},[]);return React.createElement('main',{style:{padding:20,maxWidth:1100,margin:'0 auto'}},row?React.createElement(ArchiveDetail,{row,reload}):'loading');}createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
 const built=await build({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'party-note',resolveId:id=>id==='virtual:party-note'?id:undefined,load:id=>id==='virtual:party-note'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:party-note'}}});
 const result=(Array.isArray(built)?built[0]:built) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(result.output.map(v=>['/'+v.fileName,v]));
 const html=`<!doctype html><html><head><meta charset="utf-8">${result.output.filter(v=>v.fileName.endsWith('.css')).map(v=>`<link rel="stylesheet" href="/${v.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${result.output.find(v=>v.type==='chunk')!.fileName}"></script></body></html>`;
 server=createServer((req,res)=>{const a=assets.get(req.url!);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?a.code||a.source:html);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
async function fixture(rejectFirst=false){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);const writes:any[]=[],schemaFailures:any[]=[],errors:string[]=[];let reads=0;
 const party={role:'CUSTOMER',partyId:'customer',name:'合成签署方',subjectType:'INDIVIDUAL',phone:'13800000000'},row:any={id:'archive',kind:'RENTAL',orderId:'synthetic-order',revision:7,versions:[{id:'version',version:1,status:'DRAFT',templateId:'template',templateVersion:1,files:[],requiredSigners:['CUSTOMER'],partiesSnapshot:[party]}]};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);
  if(req.method()==='GET'&&path==='/admin/offline-archives/archive'){reads++;return route.fulfill({json:row});}
  assert.equal(req.method(),'PATCH');assert.equal(path,'/admin/offline-archives/archive/versions/version');assert.equal(req.headers()['x-csrf-token'],'synthetic');const body=req.postDataJSON();writes.push(body);const parsed=metadataSchema.safeParse(body);
  if(!parsed.success){const details=parsed.error.issues.map((i:any)=>({path:i.path,message:i.message}));schemaFailures.push(details);return route.fulfill({status:400,json:{error:{code:'VALIDATION',message:'请求参数无效',details},requestId:'synthetic-validation'}});}
  if(rejectFirst&&writes.length===1)return route.fulfill({status:400,json:{error:{code:'VALIDATION',message:'合成服务拒绝'},requestId:'synthetic-rejection'}});
  Object.assign(row.versions[0].partiesSnapshot[0],parsed.data.partyDetails.parties[0]);row.revision++;return route.fulfill({json:{id:'version',revision:row.revision,status:'DRAFT'}});
 });await page.goto(origin);await page.getByRole('button',{name:'补齐主体法定信息',exact:true}).click();const form=page.locator('form');await form.getByLabel('客户身份证号',{exact:true}).fill('110101199001010011');await form.getByRole('checkbox').check();return{page,form,writes,schemaFailures,errors,reads:()=>reads};
}
for(const note of ['同意','已核对'])test(`short ${note.length}-character verification note stays editable and never sends PATCH`,async()=>{
 const f=await fixture();try{await f.form.getByLabel('核对资料及说明',{exact:true}).fill(note);await f.form.getByRole('button',{name:'确认补齐主体法定信息',exact:true}).click();await expect(f.form.getByRole('alert')).toBeVisible();assert.equal(f.writes.length,0,'short note must be rejected before PATCH; server schema failures: '+JSON.stringify(f.schemaFailures));await expect(f.form.getByRole('alert')).toContainText('核对资料及说明须填写4～500字');await expect(f.form.getByLabel('核对资料及说明',{exact:true})).toHaveValue(note);await expect(f.form.getByLabel('客户身份证号',{exact:true})).toHaveValue('110101199001010011');await expect(f.form.getByRole('checkbox')).toBeChecked();assert.equal(f.reads(),1);
 await expect(f.form.getByText('填写4～500字，首尾空格不计。',{exact:true})).toBeVisible();if(note==='同意'){await mkdir(fileURLToPath(new URL('../../../../reports/',import.meta.url)),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../../../../reports/contract-party-note-1440.png',import.meta.url))});}
 await f.form.getByLabel('核对资料及说明',{exact:true}).fill('  原件核对  ');await f.form.getByRole('button',{name:'确认补齐主体法定信息',exact:true}).click();await expect(f.form).toHaveCount(0);assert.equal(f.writes.length,1);const body=f.writes[0];assert.equal(metadataSchema.safeParse(body).success,true);assert.deepEqual(body.partyDetails,{verified:true,verificationNote:'原件核对',parties:[{role:'CUSTOMER',partyId:'customer',identityNumber:'110101199001010011',phone:'13800000000'}]});assert.equal(body.revision,7);assert.match(body.idempotencyKey,/^[0-9a-f-]{36}$/i);assert.equal(f.reads(),2);assert.deepEqual(f.errors,[]);
 }finally{await f.page.close();}
});
test('server rejection preserves verified fields and permits correction without changing archive CAS',async()=>{
 const f=await fixture(true);try{await f.form.getByLabel('核对资料及说明',{exact:true}).fill('已核对原件');await f.form.getByRole('button',{name:'确认补齐主体法定信息',exact:true}).click();await expect(f.form.getByRole('alert')).toContainText('合成服务拒绝');await expect(f.form.getByLabel('核对资料及说明',{exact:true})).toHaveValue('已核对原件');await expect(f.form.getByRole('checkbox')).toBeChecked();await f.form.getByLabel('核对资料及说明',{exact:true}).fill('再次核对原件');await f.form.getByRole('button',{name:'确认补齐主体法定信息',exact:true}).click();await expect(f.form).toHaveCount(0);assert.equal(f.writes.length,2);assert.equal(f.writes[0].revision,7);assert.equal(f.writes[1].revision,7);assert.notEqual(f.writes[0].idempotencyKey,f.writes[1].idempotencyKey);assert.deepEqual(f.errors,[]);
 }finally{await f.page.close();}
});
