import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'vite';
import {chromium,expect,type Browser} from '@playwright/test';

test('partner list and electronic workspace expose evidence and preserve global profile editing',async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {api} from '/src/core';import {SimplePartnersPage} from '/src/partner-simple';import '/src/style.css';import '/src/ninda-brand.css';import '/src/seven-module.css';import '/src/domain-ui.css';api.setSession({user:{id:'synthetic-admin',username:'synthetic',role:new URLSearchParams(location.search).get('role')||'OPERATIONS',permissions:['*'],partnerCapabilities:['partner.accounts.read']},csrfToken:'synthetic'});createRoot(document.getElementById('root')).render(<SimplePartnersPage/>);`;
 const result=await build({configFile:false,root,logLevel:'silent',define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')},plugins:[{name:'partner-progress-fixture',resolveId:id=>id==='virtual:partner-progress.tsx'?id:undefined,load:id=>id==='virtual:partner-progress.tsx'?entry:undefined}],build:{write:false,minify:false,rolldownOptions:{input:'virtual:partner-progress.tsx'}}});
 const output=(Array.isArray(result)?result[0]:result) as {output:{type:string;fileName:string;code?:string;source?:string|Uint8Array}[]},assets=new Map(output.output.map(a=>['/'+a.fileName,a])),script=output.output.find(a=>a.type==='chunk')!.fileName,styles=output.output.filter(a=>a.fileName.endsWith('.css')).map(a=>`<link rel="stylesheet" href="/${a.fileName}">`).join('');
 const server=createServer((req,res)=>{const a=assets.get(new URL(req.url!,'http://local').pathname);res.setHeader('Content-Type',a?a.fileName.endsWith('.css')?'text/css':'text/javascript':'text/html');res.end(a?a.code||a.source:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script type="module" src="/${script}"></script></body></html>`);});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let browser:Browser|undefined;
 const verified={applicable:true,identity:{state:'COMPLETED',complete:true,label:'已认证',companyName:'合成认证企业',creditCode:'91310000SYNTHETIC00',legalName:'合成法人',verifiedAt:'2026-11-10T00:00:00Z'},certification:{state:'VERIFIED',label:'已核验'},seal:{state:'READY',label:'已选用，已核验',selected:true,selectedAt:'2026-11-10T00:01:00Z',checkedAt:'2026-11-10T00:02:00Z'},checkedAt:'2026-11-10T00:02:00Z'};
 const basic={id:'partner-a',name:'合成登记企业',subjectType:'ENTERPRISE',creditCode:'',address:'合成地址',contactPhone:'',revision:3,status:'VERIFIED',enterpriseVerification:verified,allowedActions:{editProfile:true,electronicCooperation:true},agreements:[],vehicles:[],vehicleAssignments:[],agreementCount:0,vehicleCount:0,pendingVehicleCount:0};
 const qa=resolve(root,'../../.runtime/partner-identity-workflow-20261110/screenshots');await mkdir(qa,{recursive:true});
 try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(!(e instanceof Error)||!e.message.includes("Executable doesn't exist"))throw e;browser=await chromium.launch({channel:'chrome',headless:true});}
  for(const scenario of (process.env.NINDA_PARTNER_SCENARIO?[process.env.NINDA_PARTNER_SCENARIO]:['verified','refresh','missing','individual','disabled','legal-updated','restricted']))await t.test(scenario,async()=>{
   let owner:any=scenario==='refresh'?{...basic,enterpriseVerification:{...verified,certification:{state:'REFRESH_REQUIRED'},seal:{...verified.seal,state:'REFRESH_REQUIRED'}}}:scenario==='missing'?{...basic,enterpriseVerification:undefined}:scenario==='individual'?{...basic,subjectType:'INDIVIDUAL',enterpriseVerification:{...verified,applicable:false,identity:{state:'NOT_APPLICABLE',complete:false}}}:scenario==='disabled'?{...basic,allowedActions:{editProfile:true,electronicCooperation:false}}:basic;
   const page=await browser!.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(7000);const errors:string[]=[],writes:string[]=[],requests:string[]=[];let failDetail=false;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'No external network in synthetic UI test');if(!url.pathname.startsWith('/api/'))return route.continue();const path=url.pathname.slice(4);requests.push(path);if(req.method()!=='GET'){writes.push(path);if(scenario==='legal-updated'&&path==='/admin/files')return route.fulfill({json:{id:'synthetic-evidence',name:'synthetic.png',mimeType:'image/png',size:8}});if(scenario==='legal-updated'&&path==='/admin/vehicle-owners/partner-a/legal-representative'){const body=req.postDataJSON();assert.equal(body.revision,2);assert.equal(body.evidenceFileId,'synthetic-evidence');assert.ok(body.idempotencyKey);owner={...owner,revision:4,enterpriseVerification:{...verified,identity:{...verified.identity,state:'REAUTH_REQUIRED',complete:false}}};return route.fulfill({json:{id:'synthetic-legal',revision:3}});}return route.fulfill({status:400,json:{error:{message:'本地核验禁止业务写入'}}});}if(path==='/admin/partners')return route.fulfill({json:{items:[owner],total:1}});if(path==='/admin/partners/partner-a')return route.fulfill(failDetail?{status:503,json:{error:{message:'合成详情读取失败'}}}:{json:owner});if(path==='/admin/vehicle-owners/partner-a')return route.fulfill({json:{id:owner.id,legalRepresentative:{name:'合成登记法人',maskedMobile:'138****0000',revision:2},realNameStatus:'VERIFIED',readyForSigning:true}});if(path.endsWith('/company-admin'))return route.fulfill({json:{revision:1,status:'UNSET'}});if(path.startsWith('/admin/electronic-documents/authorities/'))return route.fulfill({json:{items:[]}});if(path.startsWith('/admin/partner-settlements/accounts/'))return route.fulfill({json:[]});if(path.endsWith('/revenue'))return route.fulfill({json:{items:[],total:0,groups:[],totals:{receivedAmount:0,refundedAmount:0,netAmount:0,partnerAmount:0,platformAmount:0},incompleteCount:0}});return route.fulfill({json:{items:[],total:0}});});
   try{
    await page.goto(origin+(scenario==='restricted'?'?role=SUPPORT':'')+'#partners');
    if(scenario==='restricted'){await expect(page.getByRole('heading',{name:'当前岗位无合作商管理权限'})).toBeVisible();assert.equal(requests.length,0);return;}
    await expect(page.getByRole('columnheader',{name:'企业实名认证',exact:true})).toBeVisible();
    const list=page.getByRole('row').filter({hasText:'合成登记企业'});await expect(list).toContainText(scenario==='missing'?'待核实':scenario==='individual'?'不适用':'已认证');
    if(['verified','refresh','disabled','legal-updated'].includes(scenario))await expect(list).toContainText('合成认证企业');
    await list.getByRole('button',{name:'查看办理'}).click();
    const workspace=page.locator('.record-workspace-shell');await expect(workspace).toBeVisible();
    const identity=workspace.getByRole('region',{name:'企业实名认证',exact:true}).filter({visible:true});
    await expect(identity).toBeVisible();
    if(['verified','refresh','disabled'].includes(scenario)){await expect(identity).toContainText('合成认证企业');await expect(identity).toContainText('合成法人');await expect(identity).toContainText('91310000SYNTHETIC00');}
    if(scenario==='verified'){
     for(const label of ['处理概览','详细资料','电子签约资料','合作协议','关联车辆','公司管理员','分润统计']){
      await workspace.getByRole('tab',{name:label,exact:true}).click();
      const toolbar=workspace.getByRole('navigation',{name:'本记录分区'});await expect(toolbar.getByRole('button',{name:'更新主体资料',exact:true})).toBeVisible();
     }
     await workspace.getByRole('button',{name:'更新主体资料',exact:true}).click();
     const drawer=page.getByRole('dialog',{name:'更新主体资料',exact:true});await expect(drawer).toBeVisible();await expect(drawer.getByLabel('合作商名称',{exact:true})).toHaveValue(basic.name);await drawer.getByRole('button',{name:'取消',exact:true}).click();await expect(workspace.getByRole('tab',{name:'分润统计',exact:true})).toHaveAttribute('aria-selected','true');
    }
    await workspace.getByRole('tab',{name:'电子签约资料',exact:true}).click();
    const flow=workspace.getByRole('region',{name:'电子签约办理进度',exact:true});await expect(flow).toBeVisible();await expect(flow.locator('ol > li')).toHaveCount(4);
    if(scenario==='legal-updated'){
     await workspace.getByText('法人登记与认证入口',{exact:true}).click();await workspace.getByRole('button',{name:'维护登记法人本人',exact:true}).click();
     await workspace.getByLabel('营业执照原始凭据',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
     await expect(workspace.getByRole('link',{name:'synthetic.png',exact:true})).toBeVisible();
     await workspace.getByLabel('法人本人姓名',{exact:true}).fill('合成新法人');await workspace.getByLabel('法人本人手机号',{exact:true}).fill('13800000001');await workspace.locator('.partner-legal-entry').getByRole('checkbox',{name:'已核对',exact:true}).check();await workspace.getByRole('button',{name:'确认维护登记法人本人',exact:true}).click();
     await expect(flow).toContainText('需重新认证');await expect(flow.getByText('认证已完成',{exact:true})).toHaveCount(0);assert.deepEqual(writes,['/admin/files','/admin/vehicle-owners/partner-a/legal-representative']);
    }
    if(scenario==='verified'){await expect(flow).toContainText('认证已完成');await expect(flow).toContainText('印章已选');await expect(flow).toContainText('待登记合作条款');await expect(flow).toContainText('可选');await page.screenshot({path:resolve(qa,'partner-electronic-verified-desktop.png'),fullPage:true});}
    if(scenario==='refresh'){await expect(flow).toContainText('认证已完成');await expect(flow).toContainText('已选用，待更新核验');await expect(flow.getByRole('region',{name:'当前办理提示'})).toContainText('法人本人');}
    if(scenario==='missing'){await expect(flow).toContainText('待核实');await expect(flow.getByText('认证已完成',{exact:true})).toHaveCount(0);await expect(workspace.getByRole('region',{name:'企业实名认证',exact:true}).filter({visible:true})).not.toContainText('合成认证企业');}
    if(scenario==='individual'){await expect(flow).toContainText('不适用');await expect(flow).toContainText('企业模板不适用于个人主体');}
    if(scenario==='disabled')await expect(flow.getByRole('region',{name:'当前办理提示'})).toContainText('尚未开放');
    if(scenario==='verified'){
     await page.setViewportSize({width:390,height:844});await expect(workspace.getByRole('button',{name:'更新主体资料',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve(qa,'partner-electronic-mobile.png'),fullPage:true});
     failDetail=true;await workspace.getByRole('button',{name:'刷新详情',exact:true}).click();await expect(page.getByText('合成详情读取失败',{exact:true})).toBeVisible();await expect(workspace.getByRole('button',{name:'更新主体资料',exact:true})).toBeDisabled();
    }
    if(scenario!=='legal-updated')assert.deepEqual(writes,[],'Opening forms and browsing progress must not invite, sign, bind or save');assert.deepEqual(errors,[]);
   }finally{await page.close();}
  });
 }finally{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));}
});
