import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'vite';
import {chromium,expect,type Browser,type Page} from '@playwright/test';

test('qualification upload binds explicit document slots to the displayed customer and profile',async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const bundle=await build({root,configFile:false,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'qualification-upload-fixture',resolveId:id=>id==='virtual:qualification-upload.tsx'?id:undefined,load:id=>id==='virtual:qualification-upload.tsx'?`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {CustomerQualificationPanel,CustomerQualificationFromProfile} from '/src/customer-risk';
 import '/src/style.css';import '/src/domain-ui.css';
 const session={user:{id:'admin-a',username:'synthetic',role:'ADMIN',permissions:['*']},csrfToken:'synthetic'};api.setSession(session);
 function Fixture(){const[customer,setCustomer]=useState('customer-a'),[hash,setHash]=useState('old-hash'),[revision,setRevision]=useState(2),[refresh,setRefresh]=useState(0);return <><button onClick={()=>setCustomer('customer-b')}>切换客户</button><button onClick={()=>setHash('new-hash')}>资料更新</button><button onClick={()=>setRevision(3)}>资格更新</button><button onClick={()=>{api.setSession({...session,user:{...session.user,id:'admin-b'}});setRefresh(refresh+1);}}>切换会话</button>{location.search==='?reuse'?<CustomerQualificationFromProfile customerId={customer} evidence={{profileHash:hash,profileRevision:7,identityFileIds:['old-front','old-back'],drivingLicenseFileIds:['old-driver']}} after={()=>{}}/>:<CustomerQualificationPanel customerId={customer} controlled={{data:{customerId:customer,profileHash:hash,revision,items:[],current:{status:'PENDING'}},loading:false}} after={()=>setRefresh(refresh+1)}/>}</>};createRoot(document.getElementById('root')).render(<Fixture/>);
 `:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:qualification-upload.tsx'}}});
 const out=(Array.isArray(bundle)?bundle[0]:bundle) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]};
 const assets=new Map(out.output.map(f=>['/'+f.fileName,f])),script=out.output.find(f=>f.type==='chunk')!.fileName,styles=out.output.filter(f=>f.fileName.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/${f.fileName}">`).join('');
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://localhost').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?a.code||a.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;let browser:Browser|undefined;
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfCkAAAAASUVORK5CYII=','base64');
 const upload=(page:Page,label:string,name:string)=>page.getByLabel(label,{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:image});
 const validity=async(page:Page)=>{await page.getByLabel('身份证有效期类型',{exact:true}).selectOption('long-term');await page.getByLabel('驾驶证有效期类型',{exact:true}).selectOption('long-term');};
 const open=async(page:Page,query='')=>{await page.goto(origin+query);await page.getByRole('button',{name:'提交新资格资料',exact:true}).click();};
 try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
  await t.test('three customer-scoped uploads submit new classified documents, replacing a slot on reselection',async()=>{
   const page=await browser!.newPage(),uploads:string[]=[],writes:any[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();
    if(u.pathname==='/api/admin/customers/customer-a/qualification-files'){const body=route.request().postDataBuffer()!.toString();assert(body.includes('name="idempotencyKey"'));assert(!body.includes('name="purpose"'));uploads.push(body);return route.fulfill({json:{id:'upload-'+uploads.length,name:'uploaded.png',mimeType:'image/png',size:image.length,url:'/api/admin/files/upload-'+uploads.length}});}
    assert.equal(u.pathname,'/api/admin/customers/customer-a/qualifications');writes.push(route.request().postDataJSON());return route.fulfill({json:{id:'q3',revision:3,status:'SUBMITTED'}});
   });
   try{await open(page);await upload(page,'身份证人像面','front.png');await expect(page.getByRole('link',{name:'front.png'})).toHaveAttribute('href','/api/admin/files/upload-1');await upload(page,'身份证国徽面','back.png');await expect(page.getByRole('link',{name:'back.png'})).toBeVisible();await upload(page,'驾驶证','driver.png');await expect(page.getByRole('link',{name:'driver.png'})).toBeVisible();await upload(page,'身份证人像面','front-new.png');await expect(page.getByRole('link',{name:'front.png',exact:true})).toHaveCount(0);await validity(page);
    const qa=resolve(root,'../../.runtime/qualification-upload-fix-20261110/screenshots');await mkdir(qa,{recursive:true});for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(qa,`qualification-form-${width}.png`),fullPage:true});}
    await page.getByRole('button',{name:'确认提交新资格资料',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);assert.equal(uploads.length,4);assert.deepEqual(writes[0].documents,{identityFrontFileId:'upload-4',identityBackFileId:'upload-2',drivingLicenseFileId:'upload-3'});assert.deepEqual(writes[0].identityFileIds,['upload-4','upload-2']);assert.deepEqual(writes[0].drivingLicenseFileIds,['upload-3']);assert.equal(writes[0].profileHash,'old-hash');assert.equal(writes[0].revision,2);assert.equal(writes[0].verificationSource,'MANUAL');assert.equal(writes[0].identityLongTerm,true);assert.equal(writes[0].drivingLicenseLongTerm,true);assert(writes[0].idempotencyKey);await expect(page.getByRole('status')).toContainText('已完成');assert.deepEqual(errors,[]);}finally{await page.close();}
  });
  await t.test('missing documents and upload errors prevent submission while preserving expiry input',async()=>{
   const page=await browser!.newPage();let writes=0;
   await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();if(u.pathname.endsWith('/qualification-files'))return route.fulfill({status:503,json:{error:{message:'上传暂不可用'}}});writes++;return route.fulfill({json:{}});});
   try{await open(page);await validity(page);await page.getByRole('button',{name:'确认提交新资格资料',exact:true}).click();assert.equal(writes,0);await upload(page,'身份证人像面','front.png');await expect(page.getByRole('alert')).toContainText('上传暂不可用');await expect(page.getByLabel('身份证有效期类型',{exact:true})).toHaveValue('long-term');await page.getByRole('button',{name:'确认提交新资格资料',exact:true}).click();assert.equal(writes,0);}finally{await page.close();}
  });
  for(const action of ['切换客户','资料更新','资格更新','切换会话'])await t.test(`${action} discards old drafts and ignores a late upload`,async()=>{
   const page=await browser!.newPage();let finish:(()=>Promise<void>)|undefined,writes=0;
   await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();if(u.pathname.endsWith('/qualification-files')){finish=()=>route.fulfill({json:{id:'late-file',name:'late.png',mimeType:'image/png',size:image.length}}).catch(()=>{});return;}writes++;return route.fulfill({json:{}});});
   try{await open(page);await validity(page);await upload(page,'身份证人像面','late.png');await expect.poll(()=>!!finish).toBe(true);await expect(page.getByRole('button',{name:'确认提交新资格资料',exact:true})).toBeDisabled();await page.getByRole('button',{name:action,exact:true}).click();await finish!();await expect(page.getByRole('button',{name:'确认提交新资格资料',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'提交新资格资料',exact:true}).click();await expect(page.getByRole('link',{name:'late.png'})).toHaveCount(0);await expect(page.getByLabel('身份证有效期类型',{exact:true})).toHaveValue('fixed');assert.equal(writes,0);}finally{await page.close();}
  });
  await t.test('a rejected submit retains uploaded files and retries the same unchanged command key',async()=>{
   const page=await browser!.newPage(),writes:any[]=[];let uploads=0;
   await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();if(u.pathname.endsWith('/qualification-files'))return route.fulfill({json:{id:'retry-file-'+ ++uploads}});writes.push(route.request().postDataJSON());return writes.length===1?route.fulfill({status:409,json:{error:{code:'REVISION_CONFLICT',message:'请核对当前资料'}}}):route.fulfill({json:{id:'q3'}});});
   try{await open(page);for(const [label,name] of [['身份证人像面','front.png'],['身份证国徽面','back.png'],['驾驶证','driver.png']]){await upload(page,label,name);await expect(page.getByRole('link',{name})).toBeVisible();}await validity(page);await page.getByRole('button',{name:'确认提交新资格资料',exact:true}).click();await expect(page.getByRole('alert')).toContainText('请核对当前资料');await expect(page.getByLabel('身份证有效期类型',{exact:true})).toHaveValue('long-term');await expect(page.getByRole('link',{name:'front.png'})).toBeVisible();await page.getByRole('button',{name:'确认提交新资格资料',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);assert.deepEqual(writes[0],writes[1]);assert.equal(uploads,3);}finally{await page.close();}
  });
  await t.test('reuse form preserves current file IDs and offers no upload or removal controls',async()=>{
   const page=await browser!.newPage(),writes:any[]=[];
   await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);if(!u.pathname.startsWith('/api/'))return route.continue();if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{id:'q3'}});}return route.fulfill({json:{profileHash:'old-hash',revision:2,items:[]}});});
   try{await page.goto(origin+'?reuse');await page.getByRole('button',{name:'沿用已上传证件提交资格资料',exact:true}).click();await expect(page.locator('input[type=file]')).toHaveCount(0);await expect(page.getByRole('button',{name:'移除选择'})).toHaveCount(0);await validity(page);await page.getByRole('button',{name:'确认沿用已上传证件提交资格资料',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);assert.deepEqual(writes[0].identityFileIds,['old-front','old-back']);assert.deepEqual(writes[0].drivingLicenseFileIds,['old-driver']);assert(!('documents' in writes[0]));}finally{await page.close();}
  });
 }finally{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));}
});
