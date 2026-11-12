import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const base=process.env.ADMIN_QA_ORIGIN||'http://127.0.0.1:4314';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const out=new URL('../../../.runtime/ninda/application-flow-20261029/browser/',import.meta.url);
await mkdir(out,{recursive:true});
const report={mode:'localhost synthetic interception; no real business writes',checks:[],writes:[],errors:[],external:[]};
const hash='a'.repeat(64);
const browser=await chromium.launch({channel:'chrome',headless:true});
async function scenario(name,options,run){
 const context=await browser.newContext({viewport:{width:options.width||1440,height:960}}),page=await context.newPage();page.setDefaultTimeout(15000);
 const app={id:'qa-app',customerId:'qa-customer',vehicleId:'qa-vehicle',status:options.status||'IN_REVIEW',revision:2,creditRevision:3,profile:{name:'合成客户'},vehicle:{title:'合成车辆'},finalPlan:{id:'qa-plan',revision:2,contractMode:'OFFLINE',reviewStatus:'DRAFT',creditRevision:3,creditRuleVersion:'ZHIMA_MANUAL_V1',creditVerificationId:'qa-credit',creditBand:'B700_749',commercialHash:hash,monthlyFeeAmount:399900,depositAmount:399900}};
 const credit={applicationId:app.id,creditRevision:3,ruleVersion:'ZHIMA_MANUAL_V1',status:'VERIFIED',verificationCurrent:true,consentRequirementsMet:true,canFinalize:true,canVerify:true,document:{id:'qa-doc',version:1,type:'credit-verification',title:'合成信用说明',content:'仅供本地验收'},consent:{id:'qa-consent',status:'ACCEPTED',documentId:'qa-doc',version:1},verification:{id:'qa-credit',consentId:'qa-consent',band:'B700_749',verifiedBy:'qa-admin'}};
 const q={customerId:app.customerId,profileHash:hash,revision:options.qualified?1:0,current:{status:options.qualified?'APPROVED':'PENDING'},items:options.qualified?[{id:'qa-q',revision:1,status:'APPROVED',submittedBy:'qa-other',identityLongTerm:true,drivingLicenseLongTerm:false,identityExpiresAt:null,drivingLicenseExpiresAt:'2040-12-30T16:00:00Z',identityFileIds:['front','back'],drivingLicenseFileIds:['license']}]:[]};
 const risk={applicationId:app.id,current:{status:'PENDING'},review:null};
 const file=id=>({id,name:id+'.jpg',mimeType:'image/jpeg',size:10,url:`/api/admin/applications/qa-app/customer-profile/files/${id}`});
 const dossier={customerId:app.customerId,source:'CURRENT_SUPPLEMENT',snapshot:null,capturedAt:null,currentProfile:{revision:1,profileHash:hash,name:'合成客户',mobile:'13000000000',drivingYears:5,readiness:{profileComplete:true,realNameVerified:true,readyForApplication:true,missingFields:[],blockers:[]}},files:{snapshot:null,current:{identityFront:file('front'),identityBack:file('back'),drivingLicense:file('license'),legacy:[]}},identity:{snapshot:null,current:{verified:true,verifiedAt:'2026-10-28T00:00:00Z'}},qualificationStatus:{status:q.current.status,revision:q.revision,valid:!!options.qualified}};
 let failQualification=!!options.failQualification,afterWriteFail=!!options.afterWriteFail;
 page.on('pageerror',error=>report.errors.push(error.message));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==new URL(base).origin){report.external.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const path=url.pathname.slice(4);
  if(req.method()!=='GET'){
   assert.equal(req.method(),'POST');const body=req.postDataJSON();report.writes.push({scenario:name,path,body});
   if(!path.endsWith('/review'))assert.ok(body.idempotencyKey.length>=8);
   if(path==='/admin/customers/qa-customer/qualifications'){
    assert.equal(body.identityLongTerm,true);assert.equal(body.identityExpiresAt,null);assert.equal(body.drivingLicenseLongTerm,false);assert.equal(body.drivingLicenseExpiresAt,'2042-10-31');
    assert.ok(!('identityValidity' in body));assert.deepEqual(body.identityFileIds,['front','back']);
    q.current.status='SUBMITTED';q.revision=1;q.items=[{...body,id:'qa-q',revision:1,status:'SUBMITTED',submittedBy:'qa-admin'}];
    dossier.qualificationStatus={status:'SUBMITTED',revision:1,valid:false};
    if(afterWriteFail)failQualification=true;
    return route.fulfill({json:q.items[0]});
   }
   if(path==='/admin/applications/qa-app/risk-reviews'){
    assert.equal(body.decision,'APPROVED');assert.equal(body.qualificationId,'qa-q');
    app.status='AWAITING_CONFIRMATION';app.finalPlan.reviewStatus='APPROVED';risk.current.status='APPROVED';risk.review={id:'qa-risk',decision:'APPROVED',planRevision:2,commercialHash:hash,qualificationId:'qa-q'};
    return route.fulfill({json:risk});
   }
   if(path==='/admin/applications/qa-app/review'){
    assert.equal(body.decision,'IN_REVIEW');app.status='IN_REVIEW';return route.fulfill({json:{...app,finalPlan:null}});
   }
   throw new Error('Unexpected synthetic write '+path);
  }
  let data={items:[],total:0,page:1,pageSize:20};
  if(path==='/admin/auth/me')data={user:{id:'qa-admin',username:'synthetic',name:'合成验收',role:'ADMIN',permissions:['*']},csrfToken:'synthetic'};
  else if(path==='/public/config')data={mvpV2Enabled:true};
  else if(path==='/admin/applications')data={...data,items:[app],total:1};
  else if(path==='/admin/applications/qa-app')data=app;
  else if(path.endsWith('/credit-review'))data=credit;
  else if(path.endsWith('/risk-reviews'))data=risk;
  else if(path==='/admin/customers/qa-customer/qualifications'){
   if(failQualification)return route.fulfill({status:503,json:{error:{code:'SYNTHETIC_READ_FAILURE',message:'合成资格读取暂不可用'}}});data=q;
  }
  else if(path.endsWith('/customer-profile'))data=dossier;
  else if(path.includes('/files/'))throw new Error('QA must not fetch document images');
  return route.fulfill({json:data});
 });
 try{
  await page.goto(`${base}/#applications?record=qa-app`);
  await expect(page.getByRole('region',{name:'申请办理进度'})).toBeVisible();
  await run(page,{allowReads:()=>{failQualification=false;afterWriteFail=false;},failReads:()=>{failQualification=true;}});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page horizontal overflow');
  for(const drawer of await page.locator('.drawer').all())assert.equal(await drawer.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'no drawer horizontal overflow');
  await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});report.checks.push(name);
 }catch(error){await page.screenshot({path:fileURLToPath(new URL(name+'-failed.png',out))});await writeFile(new URL(name+'-failed.html',out),await page.content());throw error;}
 finally{await context.close();}
}
const flow=page=>page.getByRole('region',{name:'申请办理进度'});
async function fillLongTerm(page){
 await expect(flow(page)).toContainText('尚未提交客户身份');
 assert.equal(await page.getByRole('button',{name:'受理审核',exact:true}).count(),0);
 await page.getByRole('region',{name:'下一步操作'}).getByRole('button').click();
 await expect(page.getByRole('tab',{name:'客户资料',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'沿用已上传证件提交资格资料',exact:true}).click();
 await expect(page.getByLabel('身份证有效期至',{exact:true})).toHaveAttribute('type','date');
 await expect(page.getByLabel('驾驶证有效期至',{exact:true})).toHaveAttribute('type','date');
 assert.equal(await page.locator('input[type="datetime-local"]').count(),0);
 await page.getByLabel('身份证有效期类型',{exact:true}).selectOption('long-term');
 assert.equal(await page.getByLabel('身份证有效期至',{exact:true}).count(),0);
 await page.getByLabel('驾驶证有效期至',{exact:true}).fill('2042-10-31');
 await page.screenshot({path:fileURLToPath(new URL(`validity-form-${page.viewportSize().width}.png`,out))});
}
async function submitLongTerm(page){
 await fillLongTerm(page);
 await page.getByRole('button',{name:'确认沿用已上传证件提交资格资料',exact:true}).click();
 await expect(flow(page)).toContainText('资格资料已提交');
}
try{
 await scenario('qualification-long-term-and-date',{width:1440},async page=>{await submitLongTerm(page);await expect(flow(page)).toContainText('请由其他具备权限的人员独立审核');await page.getByRole('tab',{name:'客户资料',exact:true}).click();await expect(page.getByRole('region',{name:'客户资格办理'})).toContainText('长期');await page.getByRole('tab',{name:'处理概览',exact:true}).click();});
 await scenario('risk-approved-awaiting-customer',{qualified:true},async page=>{
  await expect(flow(page)).toContainText('等待本单风控审核');await page.getByRole('region',{name:'下一步操作'}).getByRole('button').click();
  await page.getByRole('tabpanel',{name:'方案风控',exact:true}).getByRole('button',{name:'审核本次候选方案',exact:true}).click();
  await page.getByLabel('审核结论',{exact:true}).selectOption('APPROVED');for(const box of await page.getByRole('tabpanel',{name:'方案风控',exact:true}).getByRole('checkbox').all())await box.check();
  await page.getByRole('button',{name:'确认审核本次候选方案',exact:true}).click();await expect(flow(page)).toContainText('等待客户确认方案');await expect(flow(page)).toContainText('本单风险审核已通过');await expect(flow(page)).not.toContainText('已通知');
 });
 await scenario('committed-but-refresh-failed',{afterWriteFail:true,width:390},async(page,state)=>{await submitLongTerm(page);await expect(flow(page)).toContainText('操作已提交，最新进度暂未读到');state.allowReads();await page.getByRole('button',{name:'刷新详情',exact:true}).click();await expect(flow(page)).toContainText('请由其他具备权限的人员独立审核');});
 await scenario('read-failure-and-retry',{failQualification:true},async(page,state)=>{await expect(flow(page)).toContainText('申请进度待核对');await expect(flow(page)).not.toContainText('尚未提交客户身份');state.allowReads();await flow(page).getByRole('button',{name:'重新连接',exact:true}).click();await expect(flow(page)).toContainText('尚未提交客户身份');});
 await scenario('receive-refreshes-raw-application',{status:'SUBMITTED'},async page=>{
  await expect(flow(page)).toContainText('等待受理');await page.getByRole('region',{name:'下一步操作'}).getByRole('button').click();
  await page.locator('.record-form textarea').fill('合成受理备注');
  await page.locator('.record-form').getByRole('button',{name:'受理审核',exact:true}).click();
  await expect(flow(page)).toContainText('申请已受理');await expect(flow(page)).toContainText('第 2 版候选');
 });
 await scenario('supplement-can-resume',{status:'NEEDS_INFO'},async page=>{await expect(flow(page)).toContainText('等待补充资料');await expect(page.getByRole('button',{name:'继续审核',exact:true})).toBeVisible();});
 await scenario('qualification-draft-survives-refresh',{},async(page,state)=>{
  await fillLongTerm(page);state.failReads();await page.getByRole('button',{name:'刷新详情',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'客户资料',exact:true})).toContainText('合成资格读取暂不可用');
  await expect(page.getByLabel('身份证有效期类型',{exact:true})).toHaveValue('long-term');
  await expect(page.getByLabel('驾驶证有效期至',{exact:true})).toHaveValue('2042-10-31');
  await expect(page.getByRole('button',{name:'确认沿用已上传证件提交资格资料',exact:true})).toBeDisabled();
  state.allowReads();await page.getByRole('button',{name:'刷新详情',exact:true}).click();
  await expect(page.getByRole('button',{name:'确认沿用已上传证件提交资格资料',exact:true})).toBeEnabled();
  await expect(page.getByLabel('驾驶证有效期至',{exact:true})).toHaveValue('2042-10-31');
 });
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.checks.length,checks:report.checks,syntheticWrites:report.writes.length}));
}finally{await browser.close();}
