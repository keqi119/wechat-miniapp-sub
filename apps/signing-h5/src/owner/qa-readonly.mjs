import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const origin='http://127.0.0.1:3103',root=origin+'/owner/',out=fileURLToPath(new URL('../../../../.runtime/ninda/partner-operations-20261028/h5-evidence/',import.meta.url));
await mkdir(out,{recursive:true});
const report={mode:'SYNTHETIC_LOCAL_BROWSER_NO_API_DB_SMS_PROVIDER',checks:[],errors:[],requests:[]};
const documents=[{id:'terms-1',type:'terms',version:1,title:'合成服务协议',content:'合成测试服务协议正文'},{id:'privacy-1',type:'privacy',version:1,title:'合成隐私政策',content:'合成测试隐私政策正文'}];
const owners=[{ownerId:'p1',name:'合成甲合作商',subjectType:'ENTERPRISE',status:'ACTIVE',admissionStatus:'DRAFT',accessVersion:1},{ownerId:'p2',name:'合成乙合作商',subjectType:'INDIVIDUAL',status:'ACTIVE',admissionStatus:'APPROVED',accessVersion:3}];
const archive={id:'a1',kind:'OWNER_COOPERATION',status:'ARCHIVED',canRead:true,currentApprovedVersionId:'v1',revision:1};
const order={orderId:'o1',mode:'ESIGN',stage:'ACTIVE',stageText:'用车中',vehicleTitle:'合成电动车',contracts:[{...archive,kind:'RENTAL'}],billing:[{id:'bill1',status:'PAID',amount:10001,paidAmount:10001,dueDate:'2026-10-28'}],handovers:[],parties:[{role:'OWNER',name:'合成甲合作商'}],nextAction:{code:'SIGN',label:'不应显示的旧签署动作',enabled:true},capabilities:{canFeedback:false,canReadArchive:true}};
const browser=await chromium.launch({channel:'chrome',headless:true});
async function scenario(options,run){
 const context=await browser.newContext({viewport:options.desktop?{width:1280,height:900}:{width:390,height:844}});
 const page=await context.newPage();page.setDefaultTimeout(7000);let logged=options.logged!==false,revoked=false,releaseVehicle;const held=new Promise(r=>{releaseVehicle=r;});let heldRequested=false;
 page.on('pageerror',e=>report.errors.push(e.message));
 const session=()=>({mode:'PARTNER_READONLY',viewer:{maskedMobile:'138****0000'},scopes:owners.filter(o=>!revoked||o.ownerId==='p2').map(o=>({ownerId:o.ownerId,accessVersion:o.accessVersion})),csrfToken:'synthetic-csrf',expiresAt:options.expiring?new Date(Date.now()+2000).toISOString():'2099-01-01T00:00:00Z'});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(['data:','blob:','about:','chrome-extension:'].includes(url.protocol))return route.continue();if(url.origin!==origin){report.errors.push('Unexpected external request '+url.origin);return route.abort();}
  if(!url.pathname.startsWith('/owner/api/'))return route.continue();
  const path=url.pathname.replace('/owner/api','');report.requests.push({method:req.method(),path,body:req.method()==='POST'?req.postDataJSON():undefined});
  let status=200,data={};
  if(path==='/config')data={enabled:true,mode:'PARTNER_READONLY'};
  else if(path==='/legal')data={documents};
  else if(path==='/auth/me'){status=logged?200:401;data=logged?session():{error:{code:'SESSION_EXPIRED',message:'请登录'}};}
  else if(path==='/auth/sms/request')data={accepted:true,challengeId:'synthetic-challenge-1',expiresInSeconds:300,resendAfterSeconds:1};
  else if(path==='/auth/login'){assert.equal(req.postDataJSON().challengeId,'synthetic-challenge-1');assert.equal('invitationToken' in req.postDataJSON(),false);logged=true;data=session();}
  else if(path==='/auth/logout'){assert.equal(req.headers()['x-csrf-token'],'synthetic-csrf');assert.deepEqual(req.postDataJSON(),{});logged=false;data={success:true};}
  else if(req.method()!=='GET'){report.errors.push('Unexpected business write '+path);status=403;data={error:{code:'PARTNER_READ_ONLY',message:'仅供查看'}};}
  else if(path==='/owners')data=owners.filter(o=>!revoked||o.ownerId==='p2');
  else if(revoked&&path.startsWith('/owners/p1/')){status=403;data={error:{code:'PARTNER_ACCESS_REVOKED',message:'查看授权已失效'}};}
  else if(/^\/owners\/p[12]$/.test(path)){const owner=owners.find(o=>path.endsWith(o.ownerId));data={...owner,id:owner.ownerId,mode:'PARTNER_READONLY',executionMode:'ESIGN',address:'合成测试地址',platformContactPhone:'400-000-0000'};}
  else if(path.endsWith('/workbench'))data={items:[order],total:1};
  else if(path.endsWith('/orders/o1/workspace'))data=order;
  else if(path.endsWith('/vehicles')){if(options.slowVehicle&&path.includes('/p1/')){heldRequested=true;await held;}data={items:[{id:'vehicle1',title:'合成甲旧车辆',brand:'合成',model:'测试',status:'PUBLISHED',statusText:'可订阅'}],total:1};}
  else if(path.endsWith('/policies'))data={items:[],total:0};
  else if(path.endsWith('/offline-archives'))data={items:[archive],total:1};
  else if(path.endsWith('/offline-archives/a1'))data={...archive,versions:[{id:'v1',version:1,status:'ARCHIVED',signedOn:'2026-10-28',contractNumber:'SYNTHETIC',files:[{id:'f1',name:'合成已发布文件.pdf',mimeType:'application/pdf',size:20,position:1}]},{id:'draft',version:2,status:'DRAFT',files:[]}]};
  else if(path.endsWith('/files/f1'))return route.fulfill({status:200,contentType:'application/pdf',body:'%PDF-1.4 synthetic local fixture'});
  else if(path.endsWith('/revenue-rules'))data=[{id:'r1',version:1,vehicleIds:['vehicle1'],validFrom:'2026-10-28',validUntil:'2031-10-27',terms:{method:'RATE',rateBps:2000,basis:'双方约定的已收租金',deductions:'按协议',refundRule:'按协议',cycle:'按月',expenseResponsibility:'按协议'}}];
  else if(path.endsWith('/settlements'))data=[{id:'s1',status:'PAYMENT_RECORDED',periodStart:'2026-10-01',periodEnd:'2026-11-01',payableAmount:10001,explanation:'合成已复核结算'},{id:'secret',status:'DRAFT',payableAmount:99999999}];
  else if(path.endsWith('/settlements/s1'))data={id:'s1',status:'PAYMENT_RECORDED',periodStart:'2026-10-01',periodEnd:'2026-11-01',payableAmount:10001,explanation:'合成已复核结算',lines:[],account:{bankName:'合成银行',accountNumber:'********1234'},feedback:[{id:'feedback1',status:'OPEN',message:'历史待处理问题'}]};
  else{status=404;data={error:{code:'NOT_FOUND',message:'合成未知接口'}};report.errors.push('Unexpected path '+path);}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify({data})});
 });
 const check=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('textarea,input[type=file]').count(),0);assert.equal(await page.getByRole('button',{name:/^(签署|同步|提交|反馈|领取|认证|用印)/}).count(),0);};
 try{await run(page,{revoke:()=>{revoked=true;},releaseVehicle,heldRequested:()=>heldRequested});await check();assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);}finally{releaseVehicle();await context.close();}
}
try{
 await scenario({logged:false},async page=>{
  await page.goto(root+'?invitationToken=legacy');await page.getByRole('heading',{name:'登录我的合作'}).waitFor();
  assert.equal(await page.getByText(/邀请码|小程序注册/).count(),0);await page.screenshot({path:out+'/login-mobile.png',fullPage:true});
  await page.getByLabel('登记手机号',{exact:true}).fill('13800000000');await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText(/验证码请求已受理/).waitFor();await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByLabel('短信验证码',{exact:false}).fill('123456');await page.getByLabel('同意登录服务协议及隐私政策',{exact:true}).check();await page.getByRole('button',{name:'登录合作商中心'}).click();await page.getByRole('heading',{name:'我的合作',exact:true}).waitFor();
  await page.getByRole('button',{name:/合成甲合作商/}).click();await page.getByRole('heading',{name:'合作资料',exact:true}).waitFor();assert.deepEqual(await page.getByRole('navigation',{name:'合作商工作台'}).getByRole('button').allTextContents(),['合作概览','车辆','订单','分润结算']);await page.getByRole('link',{name:'电话联系平台运营'}).waitFor();await page.screenshot({path:out+'/overview-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'查看已发布资料'}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('option').count(),1);await page.getByRole('button',{name:'查看 1. 合成已发布文件.pdf'}).click();await page.getByRole('link',{name:'下载 合成已发布文件.pdf'}).waitFor();await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'订单',exact:true}).click();await page.getByRole('button',{name:/合成电动车/}).click();await page.getByRole('heading',{name:'账单进度'}).waitFor();assert.equal(await page.getByText('不应显示的旧签署动作').count(),0);await page.reload();await page.getByRole('heading',{name:'账单进度'}).waitFor();assert.ok(page.url().endsWith('#/owners/p1/orders/o1'));
  await page.getByRole('button',{name:'分润结算',exact:true}).click();await page.getByRole('heading',{name:'对账结算'}).waitFor();await page.getByRole('button',{name:/2026-10-01 至 2026-11-01/}).click();await page.getByText('历史待处理问题',{exact:false}).waitFor();assert.equal(await page.getByText('DO_NOT_DISPLAY_FULL_ACCOUNT').count(),0);assert.equal(await page.getByText(/999,999/).count(),0);await page.screenshot({path:out+'/settlement-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'退出登录'}).click();await page.getByRole('heading',{name:'登录我的合作'}).waitFor();report.checks.push('challenge login, no invitation, four readonly tabs, phone contact, published files, current order return, approved settlement and masked account, logout CSRF');
 });
 await scenario({desktop:true},async page=>{await page.goto(root);await page.getByRole('button',{name:/合成乙合作商/}).click();await page.getByRole('heading',{name:'合作资料',exact:true}).waitFor();await page.screenshot({path:out+'/overview-desktop.png',fullPage:true});report.checks.push('desktop responsive cooperation overview');});
 await scenario({slowVehicle:true},async(page,state)=>{
  await page.goto(root);await page.getByRole('button',{name:/合成甲合作商/}).click();await page.getByRole('heading',{name:'合作资料',exact:true}).waitFor();await page.getByRole('button',{name:'车辆',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('正在读取车辆'));
  await page.getByRole('button',{name:'‹ 切换合作主体',exact:true}).click();await page.getByRole('button',{name:/合成乙合作商/}).click();await page.getByRole('heading',{name:'合作资料',exact:true}).waitFor();state.releaseVehicle();await page.getByRole('heading',{name:'合成乙合作商',exact:true}).waitFor();assert.equal(await page.getByText('合成甲旧车辆').count(),0);report.checks.push('late response from previous owner never populates selected owner');
 });
 await scenario({},async(page,state)=>{
  await page.goto(root);await page.getByRole('button',{name:/合成甲合作商/}).click();await page.getByRole('heading',{name:'合作资料',exact:true}).waitFor();state.revoke();await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('heading',{name:'我的合作',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/合成甲合作商/}).count(),0);await page.getByRole('button',{name:/合成乙合作商/}).waitFor();assert.equal(await page.getByRole('heading',{name:'合作资料',exact:true}).count(),0);if(await page.getByRole('button',{name:'知道了',exact:true}).count())await page.getByRole('button',{name:'知道了',exact:true}).click();await page.screenshot({path:out+'/revoked-scope-mobile.png',fullPage:true});report.checks.push('revoked A removed immediately, independent B scope remains available');
 });
 await scenario({expiring:true},async page=>{
  await page.goto(root);await page.getByRole('button',{name:/合成甲合作商/}).click();await page.getByRole('heading',{name:'合作资料',exact:true}).waitFor();await page.getByRole('button',{name:'查看已发布资料'}).click();await page.getByRole('dialog',{name:'合作协议',exact:true}).waitFor();await page.getByRole('heading',{name:'登录我的合作'}).waitFor();assert.equal(await page.getByRole('dialog',{name:'合作协议',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'合成甲合作商',exact:true}).count(),0);report.checks.push('session expiry unmounts private archive and removes owner data before login');
 });
 assert.deepEqual(report.errors,[]);assert.ok(report.requests.filter(r=>r.method==='POST').every(r=>['/auth/sms/request','/auth/login','/auth/logout'].includes(r.path)));report.passed=true;console.log(JSON.stringify({checks:report.checks,errors:report.errors,requestCount:report.requests.length},null,2));
}finally{await writeFile(out+'/qa-report.json',JSON.stringify(report,null,2));await browser.close();}






