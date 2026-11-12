// Synthetic browser verification only: all API traffic is fulfilled locally; no SMS/provider calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const target=resolve(root,path==='/owner/'?'owner.html':path.replace(/^\/owner\//,''));
 if(!target.startsWith(root+sep)){res.writeHead(404);res.end();return;}
 try{const data=await readFile(target);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(target)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);
 const documents=['terms','privacy','owner-identity','owner-auto-sign','owner-rental-contract'].map((type,index)=>({id:type==='owner-rental-contract'?'template-1':`doc-${index}`,type,version:2,title:type==='owner-rental-contract'?'合成车辆租赁合同':'合成说明',content:type==='owner-rental-contract'?'完整模板正文：合成租赁条款，仅本地测试。':'合成说明正文。',contentHash:'a'.repeat(64)}));
 const scope={version:1,vehicleIds:['vehicle-1'],templateId:'template-1',templateVersion:2,templateHash:'a'.repeat(64),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z',minMonthlyFeeAmount:1,maxMonthlyFeeAmount:20002,minDepositAmount:0,maxDepositAmount:100000,minMonths:1,maxMonths:12};
 let authority={id:'authority-1',ownerId:'owner-1',sealId:'seal-1',scope,scopeHash:'b'.repeat(64),status:'AUTHORIZED',enabled:false,revision:3,checkedAt:'2026-10-21T00:00:00Z',createdAt:'2026-10-21T00:00:00Z'};
 let execution=true,conflict=false,template={id:'template-1',version:2,hash:'a'.repeat(64),title:'合成车辆租赁合同'};const mutations=[];
 const detail=()=>({id:'owner-1',name:'合成企业',creditCode:'QA0000000000000000',address:'本地测试',status:'VERIFIED',revision:1,memberStatus:'VERIFIED',realNameStatus:'VERIFIED',certStatus:'BOUND',certificationComplete:true,readyForSigning:true,autoSigningEnabled:authority.enabled,authorizationEntryEnabled:true,autoSigningExecutionEnabled:execution,seals:[{id:'seal-1',status:'ACTIVE',checkedAt:'2026-10-21T00:00:00Z',imageHash:'a'.repeat(64)}],legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:true,canRefreshVerification:true,canSelectSeal:true,canRequestAuthority:true,canManageAuthority:true,canEnableAuthority:execution},blockers:[]});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)throw new Error('Unexpected external browser request');
  if(!url.pathname.startsWith('/owner/api/'))return route.continue();
  const path=url.pathname.slice('/owner/api'.length),body=route.request().postDataJSON();
  const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(body!==null)mutations.push({path,body});
  if(path==='/config')return json({enabled:true});
  if(path==='/legal')return json({documents});
  if(path==='/auth/me')return json({customer:{id:'customer-1',maskedMobile:'138****0000'},csrfToken:'local-only',expiresAt:'2099-01-01T00:00:00Z'});
  if(path==='/owners')return json([{ownerId:'owner-1',name:'合成企业',status:'VERIFIED',memberStatus:'VERIFIED'}]);
  if(path==='/owners/owner-1')return json(detail());
  if(path==='/owners/owner-1/authorities')return json(body===null?[authority]:{status:'PENDING'});
  if(path==='/owners/owner-1/authority-options')return json({vehicles:[{vehicleId:'vehicle-1',vehicle:{title:'合成 ET5T'}}],template});
  if(path==='/owners/owner-1/seals/seal-1/image')return json({imageType:'png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGMAAAAASUVORK5CYII='});
  if(path==='/owners/owner-1/authorities/authority-1/switch'){
   if(conflict){conflict=false;authority={...authority,revision:authority.revision+1,scopeHash:'c'.repeat(64),scope:{...scope,maxMonthlyFeeAmount:30003}};return json({error:{code:'OWNER_AUTH_CHANGED',message:'授权版本已变化，请重新读取'}},409);}
   authority={...authority,enabled:body.enabled,revision:authority.revision+1};return json(authority);
  }
  if(path==='/owners/owner-1/authorities/authority-1/refresh'){authority={...authority,revision:authority.revision+1};return json(authority);}
  if(path==='/owners/owner-1/authorities/authority-1/revoke'){authority={...authority,enabled:false,status:'REVOKING',revision:authority.revision+1};return json(authority);}
  return json({error:{code:'UNEXPECTED_ROUTE',message:path}},404);
 });
 const switches=()=>mutations.filter(r=>r.path.endsWith('/switch'));
 await page.goto(origin+'/owner/');await page.getByRole('button',{name:/合成企业/}).click();
 const enable=page.getByRole('button',{name:'确认上述范围并启用平台用印'});
 const consent=page.getByRole('checkbox',{name:/我已核对这份已保存授权/});
 await enable.waitFor();await page.getByRole('img',{name:'企业印章 1 图样',exact:true}).waitFor();const certPanel=page.locator('.owner-section').filter({has:page.getByRole('heading',{name:'01 · 企业与法人认证'})});assert.equal(await certPanel.getByRole('checkbox').count(),0);assert.equal(await certPanel.getByRole('button').count(),0);assert.equal(await page.getByRole('button',{name:'查看图样',exact:true}).count(),0);assert.equal(await enable.isDisabled(),true);assert.equal(await consent.isChecked(),false);assert.equal(switches().length,0);
 await page.getByText('填写新的授权范围',{exact:true}).click();await page.getByRole('button',{name:'阅读完整合同模板'}).click();
 assert.match(await page.getByRole('dialog').innerText(),/完整模板正文/);await page.getByRole('button',{name:'关闭文案'}).click();
 assert.match(await page.locator('.scope-editor').innerText(),/template-1/);
 const card=page.locator('.authority-card');assert.match(await card.innerText(),/vehicle-1/);assert.match(await card.innerText(),/合成车辆租赁合同/);assert.match(await card.innerText(),/¥0\.01/);
 await card.getByRole('button',{name:'查看本次授权印章图样'}).click();await card.getByRole('img',{name:'本次授权印章图样'}).waitFor();assert.equal(switches().length,0);
 await consent.check();await page.getByRole('button',{name:'查询授权状态'}).click();assert.equal(await consent.isChecked(),false);assert.equal(await enable.isDisabled(),true);assert.equal(switches().length,0);
 await consent.check();conflict=true;await enable.click();await page.getByRole('alert').filter({hasText:/授权版本/}).waitFor();
 assert.equal(switches().length,1);assert.deepEqual(switches()[0].body,{enabled:true,revision:4,scopeHash:'b'.repeat(64)});
 assert.equal(await consent.isChecked(),false);assert.equal(await enable.isDisabled(),true);assert.match(await card.innerText(),/¥300\.03/);
 await consent.check();await enable.click();await page.getByRole('button',{name:'停用平台用印'}).waitFor();assert.equal(switches().length,2);assert.deepEqual(switches()[1].body,{enabled:true,revision:5,scopeHash:'c'.repeat(64)});
 await page.getByRole('button',{name:'停用平台用印'}).click();await enable.waitFor();assert.equal(switches().at(-1).body.enabled,false);
 await consent.check();await page.getByRole('button',{name:'返回我的企业',exact:false}).click();await page.getByRole('button',{name:/合成企业/}).click();assert.equal(await consent.isChecked(),false);assert.equal(switches().length,3);
 documents[4]={...documents[4],version:3,contentHash:'e'.repeat(64)};await page.reload();await page.getByRole('button',{name:/合成企业/}).click();await page.getByText('当前合同模板与这份授权不一致或未加载，请阅读当前完整模板并重新办理授权。',{exact:true}).waitFor();assert.equal(await enable.isDisabled(),true);assert.equal(await consent.isDisabled(),true);assert.equal(switches().length,3);
 documents[4]={...documents[4],version:2,contentHash:'a'.repeat(64)};await page.reload();await page.getByRole('button',{name:/合成企业/}).click();
 execution=false;await page.getByRole('button',{name:'重新读取企业资料'}).click();await page.getByText('授权可办理，自动用印尚未开放',{exact:true}).waitFor();assert.equal(await enable.count(),0);assert.equal(await consent.count(),0);assert.equal(await page.getByText('填写新的授权范围',{exact:true}).count(),1);
 await page.getByText('填写新的授权范围',{exact:true}).click();await page.getByRole('checkbox',{name:'合成 ET5T',exact:true}).check();
 for(const [name,value]of [['授权开始时间','2026-10-21T00:00'],['授权截止时间','2099-12-31T00:00'],['最低月费（元）','0.01'],['最高月费（元）','200.02'],['最低押金（元）','0'],['最高押金（元）','1000'],['最少期数（月）','1'],['最多期数（月）','12']])await page.getByLabel(name,{exact:true}).fill(value);
 await page.getByRole('checkbox',{name:/我已核对上述完整授权范围/}).check();await page.getByRole('button',{name:/确认范围并前往授权/}).click();await page.getByText('授权请求已受理，请主动查询结果。平台用印不会自动启用。',{exact:true}).waitFor();
 const requested=mutations.find(r=>r.path==='/owners/owner-1/authorities');assert.equal(requested.body.scope.minMonthlyFeeAmount,1);assert.equal(requested.body.scope.templateHash,'a'.repeat(64));assert.equal(switches().length,3);
 await page.getByRole('checkbox',{name:/我已核对上述完整授权范围/}).check();
 template={id:'template-2',version:3,hash:'f'.repeat(64),title:'更新后的合成合同'};documents[4]={...documents[4],id:'template-2',version:3,contentHash:'f'.repeat(64),title:'更新后的合成合同',content:'新版本完整模板正文：仅本地测试。'};
 await page.getByRole('button',{name:'重新读取企业资料'}).click();await page.locator('.scope-editor').getByText('模板 ID：template-2',{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:/我已核对上述完整授权范围/}).isChecked(),false);
 await page.getByRole('button',{name:'阅读完整合同模板'}).click();assert.match(await page.getByRole('dialog').innerText(),/新版本完整模板正文/);await page.getByRole('button',{name:'关闭文案'}).click();assert.equal(switches().length,3);
 await page.getByRole('button',{name:'撤销供应商授权'}).click();await page.getByRole('button',{name:'确认撤销并继续'}).click();await page.getByText('撤销待确认',{exact:true}).waitFor();
 assert.equal(mutations.filter(r=>r.path.endsWith('/revoke')).length,1);assert.equal(switches().filter(r=>r.body.enabled).length,2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log(JSON.stringify({passed:true,mode:'synthetic-no-provider',checks:['legacy-options-completed-certification-direct-seal','explicit-enable-only','full-template-read-and-id','saved-scope-and-seal','refresh-resets-consent','conflict-reloads-without-retry','disable','return-resets-consent','old-template-blocked','authorization-request-with-execution-off','live-template-refresh-restores-form','revoke','mobile-no-overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
