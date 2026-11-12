import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('../../../../.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/',import.meta.url)),origin='http://127.0.0.1:3103';
const browser=await chromium.launch({channel:'chrome',headless:true});
let version=1,logged=false,loginPosts=[],smsPosts=[],failDocs=false,noticesMissing=true;
const errors=[],doc=()=>['terms','privacy'].map(type=>({id:type+'-'+version,type,version,title:type==='terms'?'合成服务协议':'合成隐私政策',content:'仅用于合成本地组件验证'}));
const legal=()=>({mode:'ELECTRONIC_LEGAL',sessionBinding:'synthetic-binding',csrfToken:'synthetic-csrf',expiresAt:'2099-01-01T00:00:00Z',owners:[{ownerId:'p1'}],viewer:{maskedMobile:'138****0000'},readonlyAvailable:true});
const readonly=()=>({mode:'PARTNER_READONLY',csrfToken:'synthetic-csrf',expiresAt:'2099-01-01T00:00:00Z',scopes:[{ownerId:'p1',accessVersion:1}],viewer:{maskedMobile:'138****0000'}});
let mode='ELECTRONIC_LEGAL',previewMode='ELECTRONIC_LEGAL',noticeRequests=0,smsFailure='',smsCountdown=0;
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
await context.route('**/owner/api/**',async route=>{
 const path=new URL(route.request().url()).pathname.replace('/owner/api',''),body=route.request().method()==='POST'?route.request().postDataJSON():null;
 let status=200,data={};
 if(path==='/config')data={enabled:true,mode:'PARTNER_READONLY'};
 else if(path==='/legal'){status=failDocs?503:200;data=failDocs?{error:{message:'合成加载失败'}}:{documents:doc()};}
 else if(path==='/legal-signing'){noticeRequests++;data={documents:doc(),missingTypes:['owner-identity','owner-auto-sign']};}
 else if(path==='/auth/me'){status=logged?200:401;data=logged?(mode==='ELECTRONIC_LEGAL'?legal():readonly()):{error:{message:'请登录'}};}
 else if(path==='/auth/sms/request'){
  smsPosts.push(body);
  if(smsFailure){const status=smsFailure==='rate'?429:smsFailure==='provider'?503:403;await route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:'SYNTHETIC_UNSENT',message:'合成未发送：'+smsFailure}})});return;}
  data={accepted:true,challengeId:'a'.repeat(64),expiresInSeconds:300,resendAfterSeconds:smsCountdown};
 }
 else if(path==='/auth/invitation/preview')data={...(previewMode==='ELECTRONIC_LEGAL'?{mode:previewMode}:{}),previewToken:'b'.repeat(64),companyName:'合成企业甲',ownerId:'p1',maskedMobile:'138****0000',expiresAt:new Date(Date.now()+600000).toISOString()};
 else if(path==='/auth/invitation/confirm'){logged=true;mode='PARTNER_READONLY';data=readonly();}
 else if(path==='/auth/login'){loginPosts.push(body);logged=true;mode=body.purpose?'ELECTRONIC_LEGAL':'PARTNER_READONLY';data=mode==='ELECTRONIC_LEGAL'?legal():readonly();}
 else if(path==='/auth/logout'){logged=false;data={success:true};}
 else if(path==='/owners')data=[{ownerId:'p1',name:'合成企业甲',accessVersion:1,subjectType:'ENTERPRISE'}];
 else if(path==='/owners/p1')data={id:'p1',name:'合成企业甲',seals:[],legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:true},verificationDisplay:{message:'尚未核验'}};
 else if(path==='/owners/p1/electronic-documents')data={items:[],total:0};
 else if(path.endsWith('/authority-options'))data={scopeVersion:2,authorizationMethod:'PROVIDER_AUTO_GRANT',delegates:[],documentKinds:[],authorizationNotice:null};
 else if(path.endsWith('/authorities/list'))data={items:[]};
 else if(path.endsWith('/authorities'))data=[];
 else throw Error('Unexpected synthetic request '+path);
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify({data})});
});
try{
 await page.goto(origin+'/owner/?purpose=legal&invitationToken='+'i'.repeat(43));
 await page.getByRole('heading',{name:'进入企业服务'}).waitFor();assert.equal(new URL(page.url()).search,'');
 assert.equal(noticeRequests,0);assert.equal(await page.locator('header').count(),1);await page.getByLabel('登记手机号').fill('13800000000');
 assert.equal(await page.getByLabel('邀请码',{exact:true}).inputValue(),'i'.repeat(43));
 await page.getByRole('button',{name:'查看受邀公司'}).click();await page.getByRole('heading',{name:'合成企业甲'}).waitFor();
 await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal(smsPosts.at(-1).purpose,'ENTERPRISE_CENTER');assert.equal(smsPosts.at(-1).invitationToken,'i'.repeat(43));
 await page.getByRole('button',{name:'知道了',exact:true}).click().catch(()=>{});await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('同意登录服务协议及隐私政策').check();
 await page.screenshot({path:out+'task-11f-login-mobile.png',fullPage:true});
 version=2;await page.getByRole('button',{name:'确认绑定并进入'}).click();await page.getByText('协议版本已更新',{exact:false}).waitFor();assert.equal(loginPosts.length,0);assert.equal(await page.getByLabel('同意登录服务协议及隐私政策').isChecked(),false);
 await page.getByRole('button',{name:'知道了',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'知道了',exact:true}).click().catch(()=>{});await page.getByLabel('短信验证码').fill('123456');await page.getByRole('button',{name:'确认绑定并进入'}).click();
 await page.getByRole('heading',{name:'实名与签章',exact:true}).waitFor();assert.deepEqual(loginPosts.at(-1).consents,[{documentId:'terms-2',version:2},{documentId:'privacy-2',version:2}]);
 await page.screenshot({path:out+'task-11f-company-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'企业合作商 合成企业甲',exact:false}).click();await page.getByText('企业认证说明尚未发布',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'本人办理企业认证',exact:true}).isDisabled(),true);
 await page.screenshot({path:out+'task-11f-workspace-mobile.png',fullPage:true});
 assert.equal(await page.locator('header').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'切换至合作资料',exact:false}).click();await page.getByRole('heading',{name:'进入企业服务'}).waitFor();assert.equal(await page.getByRole('heading',{name:'实名与签章',exact:true}).count(),0);
 await page.getByRole('button',{name:'知道了',exact:true}).click().catch(()=>{});await page.getByRole('button',{name:'短信登录',exact:true}).click();await page.getByLabel('登记手机号').fill('13800000000');await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal('purpose' in smsPosts.at(-1),false);
 await page.getByRole('button',{name:'知道了',exact:true}).click().catch(()=>{});await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'登录企业服务'}).click();await page.getByRole('heading',{name:'我的公司'}).waitFor();
 // Review I1: a temporary readonly preference cannot override a validated legal invitation.
 await page.getByRole('button',{name:'绑定其他公司',exact:true}).click();await page.getByLabel('登记手机号').fill('13800000000');await page.getByLabel('邀请码',{exact:true}).fill('j'.repeat(43));await page.getByRole('button',{name:'查看受邀公司'}).click();
 await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal(smsPosts.at(-1).purpose,'ENTERPRISE_CENTER','I1: legal invitation must override temporary readonly request purpose');
 await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'确认绑定并进入'}).click();await page.getByRole('heading',{name:'实名与签章',exact:true}).waitFor();
 // Repeat after legal -> readonly -> logout, without a page navigation/reset.
 await page.getByRole('button',{name:'切换至合作资料',exact:false}).click();await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByRole('button',{name:'短信登录',exact:true}).click();await page.getByLabel('登记手机号').fill('13800000000');await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal('purpose' in smsPosts.at(-1),false);await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'登录企业服务'}).click();await page.getByRole('heading',{name:'我的公司'}).waitFor();
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('heading',{name:'进入企业服务'}).waitFor();
 await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByLabel('登记手机号').fill('13800000000');await page.getByLabel('邀请码',{exact:true}).fill('k'.repeat(24));await page.getByRole('button',{name:'查看受邀公司'}).click();await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal(smsPosts.at(-1).purpose,'ENTERPRISE_CENTER','I1 postlogout: legal invitation must use unified purpose');await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'确认绑定并进入'}).click();await page.getByRole('heading',{name:'实名与签章',exact:true}).waitFor();await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'知道了',exact:true}).click();
 failDocs=true;await page.reload();await page.getByRole('button',{name:'重新加载',exact:true}).waitFor();failDocs=false;await page.getByRole('button',{name:'知道了',exact:true}).click().catch(()=>{});await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.getByRole('heading',{name:'进入企业服务'}).waitFor();
 previewMode='PARTNER_READONLY';await page.getByLabel('登记手机号').fill('13800000000');await page.getByLabel('邀请码',{exact:true}).fill('r'.repeat(24));await page.getByRole('button',{name:'查看受邀公司'}).click();await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'确认绑定并进入'}).click();await page.getByRole('heading',{name:'我的公司'}).waitFor();
 // Latest user steering: every unsent response is visible, produces no countdown, and leaves no reusable client challenge.
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByRole('button',{name:'短信登录',exact:true}).click();await page.getByLabel('登记手机号').fill('13800000000');
 for(const cause of ['no-scope','rate','provider']){
  smsFailure=cause;const before=loginPosts.length;await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('合成未发送：'+cause,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/秒后重试/}).count(),0);await page.getByRole('button',{name:'知道了',exact:true}).click();assert.equal(await page.getByRole('button',{name:'获取验证码',exact:true}).isEnabled(),true);
  await page.getByLabel('短信验证码').fill('123456');await page.getByLabel('同意登录服务协议及隐私政策').check();await page.getByRole('button',{name:'登录企业服务'}).click();await page.getByText('请重新获取本次登录验证码。',{exact:true}).waitFor();assert.equal(loginPosts.length,before);await page.getByRole('button',{name:'知道了',exact:true}).click();
 }
 smsFailure='';smsCountdown=2;await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByRole('button',{name:/秒后重试/}).waitFor();await page.getByText('验证码已提交短信通道',{exact:false}).waitFor();await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByRole('button',{name:'获取验证码',exact:true}).waitFor({state:'visible'});
 smsFailure='provider';const beforeRetry=loginPosts.length;await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('合成未发送：provider',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/秒后重试/}).count(),0);await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByLabel('短信验证码').fill('123456');await page.getByRole('button',{name:'登录企业服务'}).click();await page.getByText('请重新获取本次登录验证码。',{exact:true}).waitFor();assert.equal(loginPosts.length,beforeRetry);await page.getByRole('button',{name:'知道了',exact:true}).click();
 // A legal invitation can expire/revoke after preview; its SMS rejection must also stay out of countdown.
 await page.getByRole('button',{name:'首次绑定',exact:true}).click();previewMode='ELECTRONIC_LEGAL';await page.getByLabel('邀请码',{exact:true}).fill('x'.repeat(43));await page.getByRole('button',{name:'查看受邀公司'}).click();smsFailure='invalid-invite';await page.getByRole('button',{name:'获取验证码',exact:true}).click();await page.getByText('合成未发送：invalid-invite',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/秒后重试/}).count(),0);assert.equal(smsPosts.at(-1).purpose,'ENTERPRISE_CENTER');
 assert.deepEqual(errors,[]);console.log('PASS real React mobile lifecycle: shared shell, invitation OTP, exact consents, version reset, missing operation notice, dual-mode switch and legal rebind including postlogout, unsent SMS without countdown or stale challenge, dispatch success countdown, logout, document retry, no overflow');
}finally{await context.close();await browser.close();}
