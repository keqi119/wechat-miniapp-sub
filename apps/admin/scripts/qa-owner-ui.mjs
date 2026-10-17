import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4173',out=new URL('../qa/owner/',import.meta.url);await mkdir(out,{recursive:true});
const owner={id:'owner1',name:'合成车主企业有限公司',creditCode:'SYNTHETIC000000001',address:'合成地址',contactPhone:'021-55550000',status:'VERIFIED',revision:1,readyForSigning:true,autoSigningEnabled:false,members:[{customerId:'synthetic-manager',status:'VERIFIED'}]};
const task={id:'task1',resourceId:'synthetic-contract',sourceFileId:'source1',sourceSha256:'a'.repeat(64),documentHash:'b'.repeat(64),status:'PREPARED',ownerMode:'UNSELECTED',reviewedAt:null,parties:[{role:'OWNER',status:'PENDING'},{role:'CUSTOMER',status:'PENDING'}]};
const report={scope:'Built UI, synthetic intercepted HTTP only; no database/provider requests',checks:[],errors:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const role of ['OPERATIONS','FINANCE','SUPPORT']){
 const context=await browser.newContext({viewport:{width:role==='OPERATIONS'?390:1360,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
 const writes=[];await context.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname.replace('/api','');let data;
  if(req.method()!=='GET'){writes.push({path,body:req.postDataJSON()});data=path.endsWith('/invitations')?{token:'synthetic-invitation-token'}:{id:'synthetic'};}
  else if(path==='/admin/auth/me')data={user:{id:'qa',name:'合成操作员',role,permissions:['*']},csrfToken:'synthetic'};
  else if(path==='/admin/vehicle-owners')data=[owner];else if(path==='/admin/vehicle-owners/owner1')data=owner;
  else if(path.endsWith('/pending-contracts'))data=[];else if(path.endsWith('/contracts'))data=[task];else if(path==='/admin/vehicle-owners/owner1/vehicles')data=[];
  else if(path==='/admin/files/source1')return route.fulfill({contentType:'application/pdf',body:'%PDF-1.7 synthetic QA'});
  else data={items:[],total:0,page:1,pageSize:100};await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(base+'/#vehicle-owners');if(role!=='OPERATIONS'){await page.getByText('当前账号无权访问此模块',{exact:true}).waitFor();report.checks.push(role+' denied');}
 else{await page.getByLabel('选择企业').selectOption('owner1');await page.getByRole('heading',{name:owner.name,exact:true}).waitFor();const review=page.getByRole('button',{name:'确认本份 PDF 复核',exact:true});assert.equal(await review.isDisabled(),true);assert.equal(await page.getByRole('checkbox').isChecked(),false);
  await page.getByLabel('本人手机号',{exact:true}).fill('13800000000');await page.getByRole('button',{name:'生成本人邀请',exact:true}).click();await page.getByLabel('企业邀请编号').waitFor();assert.deepEqual(writes[0],{path:'/admin/vehicle-owners/owner1/invitations',body:{mobile:'13800000000'}});
  assert.equal(await page.getByRole('button',{name:/开启自动|替企业签署/}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:new URL('operations-mobile.png',out).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});report.checks.push('OPS mobile: invitation, unchecked vehicle attestation, PDF review disabled before opening, no administrator auto-enable');
 }await context.close();
}assert.deepEqual(report.errors,[]);await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser.close();}
