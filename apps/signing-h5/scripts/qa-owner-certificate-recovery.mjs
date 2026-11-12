// Synthetic local API only: no SMS, identity or electronic-signature provider calls.
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
 let canRefresh=true,rechecked=false,errorCode='OWNER_CERT_INVALID',revision=1,createMode='not-started';const mutations=[],createdKeys=[];
 const documents=['terms','privacy','owner-identity','owner-auto-sign','owner-rental-contract','owner-authorization-letter'].map((type,index)=>({id:`doc-${index}`,type,version:3,title:'合成文案',content:'仅本地验收正文',contentHash:'a'.repeat(64)}));
 const template={id:'doc-4',version:3,hash:'a'.repeat(64),title:'合成主合同'};
 const detail=()=>({id:'owner-1',name:'合成已认证企业',creditCode:'QA0000000000000000',address:'本地测试',status:'VERIFIED',revision,memberStatus:'VERIFIED',realNameStatus:'VERIFIED',certStatus:'BOUND',certificationComplete:true,readyForSigning:true,autoSigningEnabled:false,authorizationEntryEnabled:true,autoSigningExecutionEnabled:false,authorizationMethod:'UNILATERAL_LETTER',seals:[{id:'seal-1',status:'ACTIVE',checkedAt:'2026-10-21T00:00:00Z',imageHash:'a'.repeat(64)}],legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:true,canRefreshVerification:canRefresh,canSelectSeal:true,canRequestAuthority:true,canManageAuthority:true,canEnableAuthority:false},blockers:[]});
 const authority={id:'letter-1',ownerId:'owner-1',sealId:'seal-1',method:'UNILATERAL_LETTER',scope:{version:2,validFrom:'2026-01-01T00:00:00Z',validUntil:'2099-01-01T00:00:00Z',delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:['SUBSCRIPTION_WITH_FEES']},scopeHash:'b'.repeat(64),status:'PENDING',enabled:false,revision:1,document:{state:'SIGNING',bodyHash:'b'.repeat(64),sourceAvailable:true,signedAvailable:false,technicalAuthorizationStatus:'UNCONFIRMED'}};
 let records=[authority];const attempts=new Map();
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin,'all traffic must stay in the local fixture');if(!url.pathname.startsWith('/owner/api/'))return route.continue();
  const path=url.pathname.slice('/owner/api'.length),body=route.request().postDataJSON(),json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});if(body!==null)mutations.push({path,body});
  if(path==='/config')return json({enabled:true});if(path==='/legal')return json({documents});
  if(path==='/auth/me')return json({customer:{id:'customer-1',maskedMobile:'138****0000'},csrfToken:'local-only',expiresAt:'2099-01-01T00:00:00Z'});
  if(path==='/owners')return json([{ownerId:'owner-1',name:detail().name,status:'VERIFIED',memberStatus:'VERIFIED'}]);
  if(path==='/owners/owner-1')return json(detail());
  if(path.endsWith('/authority-options'))return json({scopeVersion:2,authorizationMethod:'UNILATERAL_LETTER',delegates:authority.scope.delegates,documentKinds:[{id:'SUBSCRIPTION_WITH_FEES',label:'汽车订阅主合同及费用附件',template}],authorizationNotice:{id:'doc-3',version:3,hash:'a'.repeat(64)},authorizationLetterTemplate:{id:'doc-5',version:3,hash:'a'.repeat(64),title:'合成授权书'}});
  if(path.endsWith('/authorities')){
   if(body===null)return json(records);createdKeys.push(body.idempotencyKey);
   let record=attempts.get(body.idempotencyKey);if(!record){record={...authority,id:`created-${attempts.size+1}`,scope:body.scope};attempts.set(body.idempotencyKey,record);records.push(record);}
   if(createMode==='unknown')return route.abort('failed');
   if(record.status==='WITHDRAWN')return json({error:{code:'OWNER_LETTER_CLOSED',message:'本份授权书已撤回'}},409);
   if(createMode==='certificate-changed')return json({error:{code:'OWNER_CERT_CHANGED',message:'企业签署证书已变更，请重新核验'}},409);
   return json({...record});
  }
  if(path.endsWith('/revoke')){const id=path.split('/')[4];records=records.map(record=>record.id===id?{...record,status:'WITHDRAWN',document:{...record.document,withdrawnAt:'2026-10-21T00:00:00Z'}}:record);for(const [key,record] of attempts)if(record.id===id)attempts.set(key,records.find(record=>record.id===id));return json(records.find(record=>record.id===id));}
  if(path.endsWith('/image'))return json({imageType:'png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGMAAAAASUVORK5CYII='});
  if(path==='/owners/owner-1/authorities/letter-1/resume')return rechecked&&errorCode==='OWNER_CERT_INVALID'?json({}):json({error:{code:errorCode,message:errorCode==='OWNER_CERT_CHANGED'?'企业签署证书已变更，请重新核验':'企业签署证书暂不可用，请重新核验'}},409);
  if(path==='/owners/owner-1/refresh'){assert.equal(canRefresh,true);rechecked=true;return json(detail());}
  return json({error:{code:'UNEXPECTED_ROUTE',message:path}},404);
 });
 const closeFeedback=async()=>{await page.getByRole('dialog',{name:'操作反馈'}).getByRole('button',{name:'关闭反馈',exact:true}).click();};
 await page.goto(origin+'/owner/');await page.getByRole('button',{name:/合成已认证企业/}).click();
 const certification=page.locator('.owner-section').filter({has:page.getByRole('heading',{name:'01 · 企业与法人认证'})});
 await certification.getByRole('button',{name:'重新核验企业与证书状态',exact:true}).waitFor();
 assert.equal(await certification.getByRole('checkbox').count(),0);assert.equal(await certification.getByRole('button',{name:/由法人本人办理认证/}).count(),0);assert.equal(mutations.length,0);
 await page.getByRole('tab',{name:'签约授权',exact:true}).click();await page.getByRole('button',{name:'继续签署本份授权书',exact:true}).click();
 const recovery=page.getByRole('alert').filter({hasText:/企业签署证书/});
 await recovery.getByRole('button',{name:'重新核验证书',exact:true}).waitFor();
 assert.equal(mutations.length,1,'certificate error must not automatically refresh, consent or sign');
 await recovery.getByRole('button',{name:'重新核验证书',exact:true}).click();await page.getByText('已主动查询企业认证与证书状态。',{exact:true}).waitFor();await closeFeedback();
 await page.getByRole('tab',{name:'签约授权',exact:true}).click();await page.getByRole('button',{name:'继续签署本份授权书',exact:true}).click();await page.getByText('已读取本份授权书的签署入口，请核对原记录状态。',{exact:true}).waitFor();await closeFeedback();
 assert.deepEqual(mutations.map(item=>item.path),['/owners/owner-1/authorities/letter-1/resume','/owners/owner-1/refresh','/owners/owner-1/authorities/letter-1/resume']);assert.deepEqual(mutations[1].body,{});
 errorCode='OWNER_CERT_REFRESH_REQUIRED';rechecked=false;await page.getByRole('tab',{name:'签约授权',exact:true}).click();await page.getByRole('button',{name:'继续签署本份授权书',exact:true}).click();await recovery.getByRole('button',{name:'重新核验证书',exact:true}).waitFor();assert.equal(mutations.length,4,'stale local verification must wait for an explicit refresh');await closeFeedback();
 errorCode='OWNER_CERT_CHANGED';rechecked=false;await page.getByRole('tab',{name:'签约授权',exact:true}).click();await page.getByRole('button',{name:'继续签署本份授权书',exact:true}).click();await recovery.getByText(/原待签授权书不会自动换绑证书/).waitFor();assert.equal(mutations.length,5,'certificate change must not replace or rebind the old authorization');
 await recovery.getByRole('button',{name:'重新核验证书',exact:true}).click();await page.getByRole('status').filter({hasText:'此前检测到证书编号变更'}).getByText(/请撤回旧待签授权并重新确认授权范围/).waitFor();await closeFeedback();
 assert.equal(mutations.length,6,'refresh must not automatically withdraw or create an authorization');assert.equal(mutations[5].path,'/owners/owner-1/refresh');
 canRefresh=false;await page.getByRole('tab',{name:'签约授权',exact:true}).click();await page.getByRole('button',{name:'继续签署本份授权书',exact:true}).click();await recovery.getByText(/当前暂不能查询/).waitFor();
 assert.equal(await recovery.getByRole('button',{name:'重新核验证书',exact:true}).isDisabled(),true);await closeFeedback();await page.getByRole('tab',{name:'企业与印章',exact:true}).click();assert.equal(await certification.getByRole('button',{name:'重新核验企业与证书状态',exact:true}).isDisabled(),true);await page.getByRole('tab',{name:'签约授权',exact:true}).click();assert.equal(await certification.getByRole('checkbox').count(),0);
 assert.equal(mutations.filter(item=>item.path.endsWith('/refresh')).length,2);assert.equal(mutations.some(item=>/\/(verification|seal)$/.test(item.path)),false);
 canRefresh=true;await page.getByRole('button',{name:'重新读取企业资料',exact:true}).click();await page.getByText('已重新读取企业资料。',{exact:true}).waitFor();await closeFeedback();await page.getByText('填写新的授权范围',{exact:true}).click();const form=page.locator('.scope-editor');
 await form.getByRole('checkbox',{name:'上海宁达信息科技有限公司',exact:true}).check();await form.getByRole('checkbox',{name:'汽车订阅主合同及费用附件',exact:true}).check();await form.getByLabel('授权开始时间',{exact:true}).fill('2026-10-21T00:00');await form.getByLabel('授权截止时间',{exact:true}).fill('2099-12-31T00:00');
 const consent=form.getByRole('checkbox',{name:/我已核对上述完整授权范围/}),submit=form.getByRole('button',{name:/生成授权书并前往签署/});
 createMode='unknown';await consent.check();await submit.click();await page.getByRole('alert').filter({hasText:/网络连接失败/}).waitFor();assert.equal(createdKeys.length,1);await closeFeedback();
 revision++;await page.getByRole('button',{name:'重新读取企业资料',exact:true}).click();await page.getByText('已重新读取企业资料。',{exact:true}).waitFor();await closeFeedback();await page.locator('.authority-card').filter({has:page.locator('a[href*="/created-1/"]')}).waitFor();
 const card=id=>page.locator('.authority-card').filter({has:page.locator(`a[href*="/${id}/"]`)}),withdraw=async id=>{await card(id).getByRole('button',{name:'撤回并停用本地授权',exact:true}).click();await card(id).getByRole('button',{name:'确认撤回并停用',exact:true}).click();await card(id).getByRole('heading',{name:'本地授权已撤回',exact:true}).waitFor();await closeFeedback();};
 await withdraw('letter-1');createMode='certificate-changed';await consent.check();await submit.click();await page.getByRole('alert').filter({hasText:'企业签署证书已变更'}).waitFor();assert.equal(createdKeys.length,2);assert.equal(createdKeys[1],createdKeys[0],'unknown request, unrelated withdrawal and owner revision must retain the original key');await closeFeedback();
 await withdraw('created-1');createMode='success';await consent.check();await submit.click();await page.getByRole('dialog',{name:'操作反馈'}).getByText('上一份授权已撤回或关闭，请重新勾选确认后生成新授权书。',{exact:true}).waitFor();assert.equal(createdKeys.length,3);assert.equal(createdKeys[2],createdKeys[0],'closure is confirmed by retrying the exact original key');assert.equal(await consent.isChecked(),false);await closeFeedback();
 await submit.click();await page.getByRole('dialog',{name:'操作反馈'}).getByText('请明确确认本次完整授权范围及授权文案。',{exact:true}).waitFor();assert.equal(createdKeys.length,3,'closed result must not automatically resubmit or accept consent');await closeFeedback();
 await consent.check();await submit.click();await page.getByText('单方授权书请求已受理，请主动查询签署结果。自动用印尚未开放。',{exact:true}).waitFor();assert.equal(createdKeys.length,4);assert.notEqual(createdKeys[3],createdKeys[0]);assert.equal(attempts.size,2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log(JSON.stringify({passed:true,mode:'synthetic-no-provider',checks:['completed-certification-keeps-query-entry','no-consent-form-regression','certificate-error-direct-recovery','explicit-query-only','same-certificate-letter-retry','changed-certificate-no-rebinding','changed-certificate-guidance-after-refresh','capability-denied-disabled','uncertain-request-reuses-key','revision-and-unrelated-withdrawal-retain-key','confirmed-closed-requires-fresh-consent-and-key','mobile-no-overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
