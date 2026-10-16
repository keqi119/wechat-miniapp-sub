import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:3102',root=`${origin}/miniapp-sign/`,out=new URL('../qa/',import.meta.url);
await mkdir(out,{recursive:true});
const report={mode:'isolated-browser-fixtures-no-api-db-sms-provider',checks:[],errors:[],writes:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const readiness={readyForSigning:true,signingEligible:true,state:'SIGNING_ENABLED',realNameStatus:'VERIFIED',certBound:true,nextAction:'NONE'};
const session={customer:{id:'qa-customer',maskedMobile:'138****0000'},csrfToken:'qa-fixture-csrf',expiresAt:'2099-01-01T00:00:00Z'};
function record(kind='SUBSCRIPTION'){return{kind,id:`qa-${kind.toLowerCase()}`,title:kind==='AMENDMENT'?'QA 延期交车补充协议':kind==='HANDOVER'?'QA 交车事实确认单':'QA 汽车订阅合同',status:kind==='AMENDMENT'?'AWAITING_SIGNATURE':'PENDING',createdAt:'2026-10-16T00:00:00Z',orderId:'qa-order',canSign:true,canSync:true,sourceFileId:`qa-source-${kind}`,documentHash:'qa-local-fixture-hash',readiness,blockers:[],revision:kind==='AMENDMENT'?5:undefined,body:'QA 隔离浏览器资料：本正文不构成真实合同。'};}
async function scenario(options,run){
 let releaseSign;const heldSign=new Promise(resolve=>{releaseSign=resolve;});
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();let logged=options.logged??true;let detail=options.record??record();let legalReads=0;
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/miniapp-sign/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname.replace('/miniapp-sign/api','');
   if(options.offline){await route.abort('failed');return;}
   if(req.method()==='POST'){const body=req.postDataJSON();report.writes.push({path,body:{...body,...(body.mobile?{mobile:'[QA synthetic omitted]'}:{}),...(body.code?{code:'[QA synthetic omitted]'}:{}),...(body.name?{name:'[QA synthetic omitted]'}:{}),...(body.idCardNo?{idCardNo:'[QA synthetic omitted]'}:{})},csrf:!!req.headers()['x-csrf-token']});}
   let status=200,data={};
   if(path==='/config')data={mode:'SERVICE_ACCOUNT_H5',entryUrl:'https://app.subauto.keybox.cloud/miniapp-sign/',enabled:!options.disabled};
   else if(path==='/legal'){legalReads++;data={documents:[{id:'qa-terms',type:'terms',version:1,title:'QA 服务协议',content:'QA 合成协议正文'},{id:'qa-privacy',type:'privacy',version:options.stalePrivacy&&legalReads>1?2:1,title:'QA 隐私政策',content:'QA 隐私用途说明'}]};}
   else if(path==='/auth/me'){status=logged?200:401;data=logged?{...session,...(options.sessionExpires?{expiresAt:new Date(Date.now()+1500).toISOString()}:{})}:{message:'请先登录'};}
   else if(path==='/auth/sms/request'){status=201;data={accepted:true};}
   else if(path==='/auth/login'){logged=true;data=session;}
   else if(path==='/auth/logout'){logged=false;data={success:true};}
   else if(path==='/records')data={items:options.empty?[]:[detail]};
   else if(path.startsWith('/files/')){await route.fulfill({status:403,body:'QA不提供真实文件'});return;}
   else if(path==='/account/readiness')data=detail.readiness;
   else if(path==='/account/register'||path==='/account/refresh')data=detail.readiness;
   else if(path==='/account/verify'){status=409;data={message:'QA：未调用供应商，请稍后查询'};}
   else if(path.endsWith('/sign')){if(options.slowSign)await heldSign;status=options.expire?401:409;data={code:options.expire?'SESSION_EXPIRED':'QA_NOT_SENT',message:options.expire?'登录已过期':'QA：渠道状态待核验，未发起真实签署'};}
   else if(path.endsWith('/sync')){if(options.slowSync)await heldSign;data=detail;}
   else if(path.startsWith('/records/'))data=detail;
   else{status=404;data={message:'QA未知接口'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 try{await run(page,releaseSign);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}finally{releaseSign();await context.close();}
}
try{
 await scenario({logged:false},async page=>{
  await page.goto(root);await page.getByRole('heading',{name:'登录签约中心'}).waitFor({timeout:5000});
  await page.screenshot({path:new URL('login-mobile.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.getByLabel('手机号').fill('13800000000');await page.getByRole('button',{name:'获取验证码',exact:true}).click();
  await page.getByText('验证码请求已提交。若未收到，请稍后重试或联系平台。',{exact:true}).waitFor({timeout:1000});
  await page.getByLabel('短信验证码').fill('123456');await page.getByRole('main').getByRole('button',{name:'服务协议',exact:true}).click();await page.getByText('QA 合成协议正文',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭文案'}).click();
  await page.getByLabel('我已阅读并同意服务协议和隐私政策').check();await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'我的签约'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);report.checks.push('explicit SMS login and current legal versions, no browser storage');
 });
 for(const stalePrivacy of [false,true])await scenario({stalePrivacy,record:{...record(),canSign:false,readiness:{...readiness,readyForSigning:false,signingEligible:false,realNameStatus:'NOT_STARTED',certBound:false,state:'REALNAME_PENDING',nextAction:'START_REALNAME_VERIFICATION'}}},async page=>{
  await page.goto(root);await page.getByRole('button',{name:'查看实名准备 ↗'}).click();const dialog=page.getByRole('dialog');
  const consent=dialog.getByLabel('我已阅读实名用途及隐私政策，由本人发起核验');assert.equal(await consent.isChecked(),false);
  await dialog.getByLabel('真实姓名',{exact:true}).fill('合成验收');await dialog.getByLabel('身份证号码',{exact:true}).fill('110101199001010010');await consent.check();
  const before=report.writes.filter(w=>w.path==='/account/verify').length;await dialog.getByRole('button',{name:'前往实名认证',exact:true}).click();
  if(stalePrivacy){await dialog.getByText('隐私政策已更新，请重新阅读并确认实名用途。',{exact:true}).waitFor();assert.equal(report.writes.filter(w=>w.path==='/account/verify').length,before);assert.equal(await consent.isChecked(),false);}
  else{await dialog.getByText('QA：未调用供应商，请稍后查询',{exact:true}).waitFor();assert.deepEqual(report.writes.at(-1).body.consent,{accepted:true,documentId:'qa-privacy',version:1});}
  assert.equal(await dialog.getByLabel('身份证号码',{exact:true}).inputValue(),'');report.checks.push(stalePrivacy?'privacy changed after checkbox: no provider request; requires new independent consent':'verify independently accepts current privacy version; no sensitive persistence or auto-provider call');
 });
 await scenario({empty:true},async page=>{await page.goto(`${root}return/?result=success`);await page.getByText('暂无签约记录',{exact:true}).waitFor();await page.getByText(/我的 → 业务记录/).first().waitFor();assert.equal(await page.getByText('已签署',{exact:true}).count(),0);report.checks.push('empty return never trusts URL success');});
 await scenario({record:{...record(),canSign:false,readiness:{...readiness,readyForSigning:false,signingEligible:false,realNameStatus:'NOT_STARTED',certBound:false,state:'NOT_STARTED',nextAction:'REGISTER_PROVIDER_ACCOUNT'},blockers:['请先完成实名认证']}},async page=>{
  await page.goto(`${root}?kind=SUBSCRIPTION&id=qa-subscription`);await page.getByText('请先完成实名认证',{exact:true}).waitFor();await page.getByRole('button',{name:'查看实名准备'}).click();await page.getByRole('button',{name:'建立实名签约账户'}).waitFor();await page.screenshot({path:new URL('readiness-mobile.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});report.checks.push('not-ready blocks signature and explains explicit account action');
 });
 await scenario({slowSign:true},async(page,release)=>{await page.goto(`${root}?kind=SUBSCRIPTION&id=qa-subscription`);await page.getByLabel('我已阅读本次签署文件').check();await page.getByRole('button',{name:'前往签署',exact:true}).click();assert.equal(await page.getByRole('button',{name:'← 返回我的签约'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'查看实名准备'}).isDisabled(),true);release();await page.getByText('QA：渠道状态待核验，未发起真实签署',{exact:true}).waitFor();report.checks.push('slow sign locks resource navigation until outcome, no cross-record response overwrite');});
 await scenario({slowSync:true,sessionExpires:true},async(page,release)=>{
  await page.goto(`${root}?kind=SUBSCRIPTION&id=qa-subscription`);await page.getByRole('button',{name:'查询签署状态',exact:true}).click();await page.getByRole('heading',{name:'登录签约中心'}).waitFor();
  await page.getByLabel('手机号').fill('13800000000');await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('我已阅读并同意服务协议和隐私政策').check();await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'我的签约'}).waitFor();
  const response=page.waitForResponse(r=>r.url().endsWith('/sync'));release();await(await response).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('heading',{name:'我的签约',level:1}).count(),1);assert.equal(await page.getByRole('heading',{name:record().title,level:1}).count(),0);assert.equal(await page.getByText('已从服务端查询最新状态。',{exact:true}).count(),0);
  report.checks.push('late old-session sync after expiry and fresh login cannot reopen stale resource or claim success');
 });
 for(const kind of ['SUBSCRIPTION','AMENDMENT','HANDOVER'])await scenario({record:record(kind)},async page=>{
  await page.goto(`${root}?kind=${kind}&id=qa-${kind.toLowerCase()}`);await page.getByRole('heading',{name:record(kind).title}).waitFor();
  if(kind==='SUBSCRIPTION')await page.screenshot({path:new URL('contract-mobile.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.getByLabel('我已阅读本次签署文件').check();await page.getByRole('button',{name:'前往签署',exact:true}).click();await page.getByText('QA：渠道状态待核验，未发起真实签署',{exact:true}).waitFor();
  const write=report.writes.at(-1);assert.equal(write.path,`/records/${kind}/qa-${kind.toLowerCase()}/sign`);assert.deepEqual(write.body,kind==='AMENDMENT'?{revision:5}:{});assert.equal(write.csrf,true);
  await page.getByRole('button',{name:'查询签署状态',exact:true}).click();await page.getByText('已从服务端查询最新状态。',{exact:true}).waitFor();report.checks.push(`${kind}: correct owner resource route, CSRF, revision, unknown-write visible, explicit sync`);
 });
 await scenario({expire:true},async page=>{await page.goto(`${root}?kind=SUBSCRIPTION&id=qa-subscription`);await page.getByLabel('我已阅读本次签署文件').check();await page.getByRole('button',{name:'前往签署',exact:true}).click();await page.getByRole('heading',{name:'登录签约中心'}).waitFor();report.checks.push('session expiry clears sensitive detail and returns login');});
 await scenario({offline:true},async page=>{await page.goto(root);await page.getByText(/暂时无法连接签约服务/).waitFor();assert.equal(await page.getByText('暂无签约记录',{exact:true}).count(),0);report.checks.push('offline is error, never empty or mock data');});
 await scenario({disabled:true},async page=>{await page.goto(root);await page.getByRole('heading',{name:'签约入口暂未开放'}).waitFor();assert.equal(await page.getByRole('button',{name:'获取验证码'}).count(),0);report.checks.push('disabled config blocks login and provider actions');});
 assert.deepEqual(report.errors,[]);await writeFile(new URL('browser-fixtures.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,pageErrors:report.errors.length,mode:report.mode}));
}finally{await browser.close();}
