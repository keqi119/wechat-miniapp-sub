// All traffic stays in this synthetic local fixture; no live identity, SMS or provider actions.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname,target=resolve(root,path==='/owner/'?'owner.html':path.replace(/^\/owner\//,''));if(!target.startsWith(root+sep)){res.writeHead(404);res.end();return;}try{const data=await readFile(target);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(target)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);
 const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGMAAAAASUVORK5CYII=';
 const documents=['terms','privacy','owner-identity','owner-auto-sign','owner-rental-contract'].map((type,index)=>({id:type==='owner-auto-sign'?'notice-2':type==='owner-rental-contract'?'template-1':`doc-${index}`,type,version:2,title:type==='owner-rental-contract'?'合成主合同':'合成说明',content:type==='owner-rental-contract'?'完整合同样本正文，仅本地测试。':'合成说明正文。',contentHash:'a'.repeat(64)}));
 let complete=true,member='VERIFIED',realname='VERIFIED',cert='BOUND',canRefresh=true,execution=false,logged=true,delayImages=false,failedImages=false;
 let revision=1,representativeName='合成法人';
 let template={id:'template-1',version:2,hash:'a'.repeat(64),title:'合成主合同'};
 const oldScope={version:1,vehicleIds:['vehicle-legacy'],templateId:'template-1',templateVersion:2,templateHash:'a'.repeat(64),validFrom:'2026-01-01T00:00:00Z',validUntil:'2099-12-31T00:00:00Z',minMonthlyFeeAmount:1,maxMonthlyFeeAmount:2,minDepositAmount:0,maxDepositAmount:1,minMonths:1,maxMonths:12};
 const newScope={version:2,validFrom:'2026-01-01T00:00:00Z',validUntil:'2099-12-31T00:00:00Z',delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:['SUBSCRIPTION_WITH_FEES']};
 let authorities=[{id:'legacy-1',ownerId:'owner-1',sealId:'seal-1',scope:oldScope,scopeHash:'c'.repeat(64),status:'AUTHORIZED',enabled:false,revision:1},{id:'grant-2',ownerId:'owner-1',sealId:'seal-1',scope:newScope,scopeHash:'b'.repeat(64),status:'AUTHORIZED',enabled:false,revision:2}];
 const mutations=[],imageReads=[],pending=[];
 const options=()=>({scopeVersion:2,delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:[{id:'SUBSCRIPTION_WITH_FEES',label:'汽车订阅主合同及费用附件',template}],authorizationNotice:{id:'notice-2',version:2,hash:'a'.repeat(64)}});
 const detail=id=>({id,name:id==='owner-1'?'合成企业一':'合成企业二',creditCode:'QA0000000000000000',address:'本地测试',status:'VERIFIED',revision,memberStatus:member,realNameStatus:realname,certStatus:cert,certificationComplete:complete,readyForSigning:true,autoSigningEnabled:false,authorizationEntryEnabled:true,autoSigningExecutionEnabled:execution,seals:id==='owner-1'?[{id:'seal-1',status:'ACTIVE',checkedAt:'2026-10-21T00:00:00Z',imageHash:'a'.repeat(64)},{id:'seal-2',status:'DISCOVERED',checkedAt:'2026-10-21T00:00:00Z',imageHash:'b'.repeat(64)}]:[{id:'seal-other',status:'ACTIVE',checkedAt:'2026-10-21T00:00:00Z',imageHash:'c'.repeat(64)}],legalRepresentative:{name:representativeName,maskedMobile:'138****0000'},capabilities:{canStartVerification:true,canRefreshVerification:canRefresh,canSelectSeal:true,canRequestAuthority:true,canManageAuthority:true,canEnableAuthority:execution},blockers:[]});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)throw new Error('Unexpected external request');if(!url.pathname.startsWith('/owner/api/'))return route.continue();
  const path=url.pathname.slice('/owner/api'.length),body=route.request().postDataJSON(),json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(body!==null)mutations.push({path,body});
  if(path==='/config')return json({enabled:true});if(path==='/legal')return json({documents});
  if(path==='/auth/me')return logged?json({customer:{id:'customer-1',maskedMobile:'138****0000'},csrfToken:'local-only',expiresAt:'2099-01-01T00:00:00Z'}):json({error:{code:'SESSION_REQUIRED',message:'请登录'}},401);
  if(path==='/auth/logout'){logged=false;return json({success:true});}
  if(path==='/owners')return json(['owner-1','owner-2'].map(ownerId=>({ownerId,name:detail(ownerId).name,status:'VERIFIED',memberStatus:'VERIFIED'})));
  if(/^\/owners\/owner-[12]$/.test(path))return json(detail(path.split('/')[2]));
  if(path.endsWith('/authority-options'))return json(options());
  if(path.endsWith('/authorities'))return json(body===null?(path.includes('owner-1')?authorities:[]):{status:'PENDING'});
  if(path.endsWith('/image')){imageReads.push(path);if(delayImages)await new Promise(resolve=>pending.push(resolve));return failedImages?json({error:{code:'IMAGE_UNAVAILABLE',message:'合成图样暂不可用'}},503):json({imageType:'png',imageBase64:image});}
  if(path.endsWith('/switch')){const id=path.split('/')[4];authorities=authorities.map(a=>a.id===id?{...a,enabled:body.enabled,revision:a.revision+1}:a);return json(authorities.find(a=>a.id===id));}
  if(path.endsWith('/refresh'))return json({success:true});
  return json({error:{code:'UNEXPECTED_ROUTE',message:path}},404);
 });
 const open=async(name='合成企业一')=>{await page.getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();};
 const certification=()=>page.locator('.owner-section').filter({has:page.getByRole('heading',{name:'01 · 企业与法人认证'})});
 await page.goto(origin+'/owner/');await open();
 assert.equal(await certification().count(),1);assert.equal(await certification().getByRole('checkbox').count(),0);assert.equal(await certification().getByRole('button').count(),1);assert.equal(await certification().getByRole('button',{name:'重新核验企业与证书状态',exact:true}).isEnabled(),true);
 await page.getByRole('img',{name:'企业印章 1 图样',exact:true}).waitFor();await page.getByRole('img',{name:'企业印章 2 图样',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'查看图样',exact:true}).count(),0);assert.equal(imageReads.length,2);assert.equal(mutations.length,0);assert.equal(await page.getByRole('button',{name:'选用此印章'}).count(),1);
 await page.getByRole('tab',{name:'签约授权',exact:true}).click();await page.getByText('填写新的授权范围',{exact:true}).click();const form=page.locator('.scope-editor');
 assert.equal(await form.locator('input[type="datetime-local"]').count(),2);assert.equal(await form.getByRole('checkbox').count(),3);assert.doesNotMatch(await form.innerText(),/最低月费|最高押金|最少期数|授权车辆/);
 await form.getByRole('checkbox',{name:'上海宁达信息科技有限公司',exact:true}).check();await form.getByRole('checkbox',{name:'汽车订阅主合同及费用附件',exact:true}).check();
 await form.getByLabel('授权开始时间',{exact:true}).fill('2026-10-21T00:00');await form.getByLabel('授权截止时间',{exact:true}).fill('2099-12-31T00:00');
 await form.screenshot({path:fileURLToPath(new URL('../qa/owner-v2-scope-mobile.png',import.meta.url))});
 await page.getByRole('tab',{name:'企业与印章',exact:true}).click();await certification().screenshot({path:fileURLToPath(new URL('../qa/owner-v2-certification-mobile.png',import.meta.url))});
 await page.getByRole('tab',{name:'签约授权',exact:true}).click();await form.getByRole('button',{name:'阅读当前合同样本'}).click();assert.match(await page.getByRole('dialog').innerText(),/完整合同样本正文/);await page.getByRole('button',{name:'关闭文案'}).click();
 await form.getByRole('checkbox',{name:/我已核对上述完整授权范围/}).check();await form.getByRole('button',{name:/确认范围并前往授权/}).click();await page.getByText('授权请求已受理，请主动查询结果。平台用印不会自动启用。',{exact:true}).waitFor();
 const sent=mutations.find(item=>item.path==='/owners/owner-1/authorities').body;assert.deepEqual(Object.keys(sent.scope).sort(),['delegates','documentKinds','validFrom','validUntil','version']);assert.equal(sent.scope.version,2);assert.deepEqual(sent.scope.delegates,newScope.delegates);assert.deepEqual(sent.scope.documentKinds,newScope.documentKinds);
 await page.locator('.authority-history > summary').click();const legacy=page.locator('.authority-card').filter({hasText:'vehicle-legacy'});assert.match(await legacy.innerText(),/¥0\.01/);assert.match(await legacy.innerText(),/template-1/);
 execution=true;template={id:'template-2',version:3,hash:'e'.repeat(64),title:'新版合成主合同'};documents[4]={...documents[4],id:'template-2',version:3,contentHash:'e'.repeat(64),content:'新版本完整合同正文'};
 await page.getByRole('button',{name:'重新读取企业资料'}).click();assert.equal(await page.getByRole('button',{name:'确认上述范围并启用平台用印'}).count(),0);assert.equal(mutations.filter(item=>item.path.endsWith('/switch')).length,0);
 await page.getByRole('tab',{name:'企业与印章',exact:true}).click();complete=false;await page.getByRole('button',{name:'重新读取企业资料'}).click();await certification().getByRole('button',{name:'主动查询认证与证书状态'}).waitFor();assert.equal(await certification().getByRole('checkbox').count(),0);
 canRefresh=false;await page.getByRole('button',{name:'重新读取企业资料'}).click();await certification().getByRole('button',{name:/由法人本人办理认证/}).waitFor();assert.equal(await certification().getByRole('checkbox').count(),3);assert.equal(await certification().getByRole('button',{name:'主动查询认证与证书状态'}).count(),0);
 for(const checkbox of await certification().getByRole('checkbox').all())await checkbox.check();revision++;representativeName='已修订合成法人';await page.getByRole('button',{name:'重新读取企业资料'}).click();await page.getByText('法人 已修订合成法人 · 138****0000',{exact:true}).waitFor();for(const checkbox of await certification().getByRole('checkbox').all())assert.equal(await checkbox.isChecked(),false);canRefresh=true;
 for(const invalidCertificate of ['EXPIRED','UNBOUND']){cert=invalidCertificate;await page.getByRole('button',{name:'重新读取企业资料'}).click();await certification().getByRole('button',{name:/由法人本人办理认证/}).waitFor();assert.equal(await certification().getByRole('checkbox').count(),3);}
 member='INVITED';realname='NOT_STARTED';cert='UNKNOWN';await page.getByRole('button',{name:'重新读取企业资料'}).click();await certification().getByRole('button',{name:/由法人本人办理认证/}).waitFor();assert.equal(await certification().getByRole('checkbox').count(),3);
 complete=true;member='VERIFIED';realname='VERIFIED';cert='BOUND';await page.getByRole('button',{name:'返回我的企业',exact:false}).click();failedImages=true;await open();await page.getByRole('button',{name:'重新加载图样'}).first().waitFor();failedImages=false;await page.getByRole('button',{name:'重新加载图样'}).first().click();await page.getByRole('img',{name:'企业印章 1 图样',exact:true}).waitFor();
 await page.getByRole('button',{name:'返回我的企业',exact:false}).click();delayImages=true;await open();await page.waitForFunction(()=>document.querySelectorAll('.seal-placeholder').length===2);await page.getByRole('button',{name:'返回我的企业',exact:false}).click();delayImages=false;await open('合成企业二');for(const done of pending.splice(0))done();await page.getByRole('img',{name:'企业印章 1 图样',exact:true}).waitFor();assert.equal(await page.locator('.seal-card').count(),1);assert.equal(await page.getByRole('heading',{name:'合成企业二',exact:true}).count(),1);
 await page.getByRole('button',{name:'返回我的企业',exact:false}).click();delayImages=true;await open();await page.getByRole('button',{name:'退出登录',exact:true}).click();delayImages=false;for(const done of pending.splice(0))done();await page.getByRole('button',{name:'获取验证码',exact:true}).waitFor();assert.equal(await page.locator('.seal-card').count(),0);
 assert.equal(mutations.filter(item=>/\/(verification|seal)$/.test(item.path)).length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log(JSON.stringify({passed:true,mode:'synthetic-no-provider',checks:['three-field-v2-scope','explicit-current-delegate-and-kind','read-current-template','legacy-scope-preserved','v2-same-kind-template-update','manual-workspace-hides-automatic-enable','certification-complete-hidden','stale-certification-refresh-only','same-mobile-profile-revision-restores-consent','profile-refresh-resets-consent','invalid-certificate-restores-form','unverified-certification-form','automatic-multi-seal-read-only','seal-load-retry','seal-owner-switch-race','seal-logout-race','mobile-no-overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
