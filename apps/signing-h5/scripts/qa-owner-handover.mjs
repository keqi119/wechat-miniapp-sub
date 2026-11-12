// Local synthetic QA only: every network request is restricted to this ephemeral server.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url))),qa=resolve(root,'../../../.runtime/ninda/platform-manual-handover-20261025');await mkdir(qa,{recursive:true});
const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname,target=resolve(root,path==='/owner/'?'owner.html':path.replace(/^\/owner\//,''));if(!target.startsWith(root+sep)){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(target)]||'application/octet-stream'});res.end(await readFile(target));}catch{res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(7000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const detail=id=>({id,name:id==='owner-1'?'合成宁达法人':'合成其他企业',creditCode:'QA0000000000000000',address:'本地测试',status:'VERIFIED',revision:1,memberStatus:'VERIFIED',realNameStatus:'VERIFIED',certStatus:'BOUND',certificationComplete:true,readyForSigning:true,autoSigningEnabled:false,authorizationEntryEnabled:false,autoSigningExecutionEnabled:false,authorizationMethod:'UNILATERAL_LETTER',seals:[],legalRepresentative:{name:'合成法人',maskedMobile:'138****0000'},capabilities:{canStartVerification:false,canRefreshVerification:true,canSelectSeal:false,canRequestAuthority:false,canManageAuthority:false,canEnableAuthority:false},blockers:[]});
 const contract={id:'shared-task',resourceId:'shared-document',kind:'SUBSCRIPTION',status:'PENDING',ownerMode:'MANUAL',createdAt:'2026-10-25T00:00:00Z',archivedAt:null,reviewedAt:'2026-10-25T00:00:00Z',parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'OWNER',status:'PENDING'}],orderId:'ORDER-QA-1',vehicleTitle:'测试订阅车辆',monthlyFeeAmount:1,depositAmount:0,months:12,documentHash:'a'.repeat(64),sourceSha256:'b'.repeat(64),sourceAvailable:true,signedAvailable:false,canSign:true,canQuery:true,blockers:[],body:'仅本地合成订阅合同正文'};
 const delivery={...contract,documentDomain:'PLATFORM_HANDOVER',kind:'HANDOVER',handoverType:'DELIVERY',vehicleTitle:'测试交车车辆',monthlyFeeAmount:null,depositAmount:null,months:null,parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'PLATFORM',status:'PENDING'}],body:'仅本地合成交车交接单正文'};
 const returned={...delivery,id:'return-task',resourceId:'return-document',handoverType:'RETURN',vehicleTitle:'测试还车车辆',status:'ARCHIVED',canSign:false,signedAvailable:true,parties:[{role:'CUSTOMER',status:'SIGNED'},{role:'PLATFORM',status:'SIGNED'}]};
 const waiting={...delivery,id:'waiting-task',vehicleTitle:'待客户车辆',canSign:false,parties:[{role:'CUSTOMER',status:'PENDING'},{role:'PLATFORM',status:'PENDING'}]};
 const handovers=[delivery,returned,waiting],requests=[],writes=[];let listError=false,list401=false,detailMismatch=false,delayList=false,releaseList,signMode='network';
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin,'no external provider calls');if(!url.pathname.startsWith('/owner/api/'))return route.continue();
  const path=url.pathname.slice('/owner/api'.length),body=route.request().postDataJSON(),json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});requests.push(path);if(body!==null)writes.push({path,body});
  if(path==='/config')return json({enabled:true});if(path==='/legal')return json({documents:[]});if(path==='/auth/me')return json({customer:{id:'customer-1',maskedMobile:'138****0000'},csrfToken:'local-only',expiresAt:'2099-01-01T00:00:00Z'});
  if(path==='/auth/logout')return json({});if(path==='/owners')return json(['owner-1','owner-2'].map(ownerId=>({ownerId,name:detail(ownerId).name,status:'VERIFIED',memberStatus:'VERIFIED'})));
  if(/^\/owners\/owner-[12]$/.test(path))return json(detail(path.split('/')[2]));if(path.endsWith('/authorities'))return json([]);if(path.endsWith('/authority-options'))return json({scopeVersion:2,authorizationMethod:'UNILATERAL_LETTER',delegates:[],documentKinds:[],authorizationNotice:null});
  if(path.endsWith('/contracts'))return json({items:path.includes('owner-1')?[contract]:[],signingMode:'MANUAL',manualSigningEnabled:true,automaticSigningEnabled:false});
  if(path.endsWith('/handovers')){
   if(delayList&&path.includes('owner-1'))await new Promise(resolve=>releaseList=resolve);
   if(list401)return json({error:{message:'合成会话已失效'}},401);
   if(listError)return json({error:{message:'合成交接单读取失败'}},503);
   return json({items:path.includes('owner-1')?handovers:[],signingMode:'MANUAL',manualSigningEnabled:path.includes('owner-1'),automaticSigningEnabled:false});
  }
  if(path==='/owners/owner-1/contracts/shared-task')return json(contract);
  const match=path.match(/^\/owners\/owner-1\/handovers\/(shared-task|return-task|waiting-task)(?:\/(sign|sync|files\/(?:source|signed)))?$/);
  if(match){
   const item=handovers.find(value=>value.id===match[1]);
   if(!match[2])return json(detailMismatch?contract:item);
   if(match[2].startsWith('files/'))return route.fulfill({contentType:'application/pdf',body:'%PDF-local-synthetic'});
   if(match[2]==='sync'){assert.deepEqual(body,{});return json({taskId:item.id,status:item.status});}
   assert.deepEqual(body,{accepted:true,documentHash:item.documentHash,sourceSha256:item.sourceSha256});assert.equal(route.request().headers()['x-csrf-token'],'local-only');
   if(signMode==='network')return route.abort('failed');
   if(signMode==='unsafe')return json({url:'javascript:alert(1)'});
   return json({url:origin+'/owner/provider-return-synthetic'});
  }
  return json({error:{message:`unexpected route: ${path}`}},404);
 });
 const closeFeedback=async()=>{await page.getByRole('dialog',{name:'操作反馈'}).getByRole('button',{name:'关闭反馈',exact:true}).click();};
 const open=async name=>{await page.getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();await page.getByRole('tab',{name:'业务合同',exact:true}).click();};
 await page.goto(origin+'/owner/');await open('合成宁达法人');
 const handover=page.locator('[data-contract-id="shared-task"][data-document-domain="PLATFORM_HANDOVER"]'),owner=page.locator('[data-contract-id="shared-task"][data-document-domain="OWNER_CONTRACT"]');
 await handover.waitFor();await owner.waitFor();assert.equal(await page.locator('.contract-card').count(),4);assert.equal(writes.length,0);
 await handover.getByText(/交车交接单/).waitFor();await handover.getByText('客户／宁达',{exact:true}).waitFor();assert.doesNotMatch(await handover.innerText(),/月费|押金|期数|待核实/);await page.locator('[data-contract-id="return-task"]').getByText(/还车交接单/).waitFor();assert.equal(await page.locator('[data-contract-id="waiting-task"]').getByRole('checkbox').count(),0);
 await handover.getByRole('button',{name:'查看交接单详情',exact:true}).click();const sign=handover.getByRole('button',{name:/确认本份交接单并前往签署/});await sign.waitFor();assert.equal(await sign.isDisabled(),true);
 assert.equal(await handover.getByRole('link',{name:'查看完整交接单 PDF',exact:true}).getAttribute('href'),'/owner/api/owners/owner-1/handovers/shared-task/files/source');
 await handover.getByRole('checkbox').check();await owner.getByRole('button',{name:'查看合同详情',exact:true}).click();assert.equal(await owner.getByRole('checkbox').isChecked(),false);assert.equal(await owner.getByRole('link',{name:'查看完整合同 PDF',exact:true}).getAttribute('href'),'/owner/api/owners/owner-1/contracts/shared-task/files/source');
 await handover.getByRole('button',{name:'查看交接单详情',exact:true}).click();assert.equal(await handover.getByRole('checkbox').isChecked(),false);
 await handover.getByRole('checkbox').check();delivery.sourceSha256='c'.repeat(64);await sign.click();await page.getByRole('dialog',{name:'操作反馈'}).getByRole('alert').waitFor();assert.equal(writes.length,0);assert.equal(await handover.getByRole('checkbox').isChecked(),false);await closeFeedback();
 await handover.getByRole('checkbox').check();await sign.click();await page.getByRole('dialog',{name:'操作反馈'}).getByRole('alert').filter({hasText:/网络连接失败/}).waitFor();assert.equal(writes.filter(write=>write.path.endsWith('/sign')).length,1);assert.equal(await sign.isDisabled(),true);assert.equal(await owner.getByRole('alert').count(),0);await closeFeedback();
 await handover.getByRole('button',{name:'查询签署结果',exact:true}).click();await page.getByRole('dialog',{name:'操作反馈'}).getByText(/查询不会发起签署或自动盖章/).waitFor();assert.equal(writes.filter(write=>write.path.endsWith('/sign')).length,1);assert.equal(await handover.getByRole('checkbox').isChecked(),false);await closeFeedback();
 signMode='unsafe';await handover.getByRole('checkbox').check();await sign.click();await page.getByRole('dialog',{name:'操作反馈'}).getByRole('alert').waitFor();assert.equal(new URL(page.url()).pathname,'/owner/');assert.equal(writes.filter(write=>write.path.endsWith('/sign')).length,2);await closeFeedback();
 await handover.getByRole('button',{name:'查询签署结果',exact:true}).click();await page.getByRole('dialog',{name:'操作反馈'}).getByText(/查询不会发起签署或自动盖章/).waitFor();await closeFeedback();
 detailMismatch=true;await handover.getByRole('checkbox').check();await sign.click();await page.getByRole('dialog',{name:'操作反馈'}).getByRole('alert').filter({hasText:/所属业务/}).waitFor();assert.equal(writes.filter(write=>write.path.endsWith('/sign')).length,2);detailMismatch=false;await closeFeedback();
 await page.getByRole('button',{name:'已完成 1',exact:true}).click();const archived=page.locator('[data-contract-id="return-task"]');await archived.getByRole('button',{name:'查看交接单详情',exact:true}).click();assert.equal(await archived.getByRole('link',{name:'下载签后交接单',exact:true}).getAttribute('href'),'/owner/api/owners/owner-1/handovers/return-task/files/signed');assert.equal(await archived.getByRole('checkbox').count(),0);
 await page.getByRole('button',{name:'全部 4',exact:true}).click();await handover.getByRole('button',{name:'查看交接单详情',exact:true}).click();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#panel-contracts').screenshot({path:resolve(qa,`h5-handover-mobile-${width}.png`)});}
 listError=true;await page.getByRole('button',{name:'刷新合同列表',exact:true}).click();await page.getByRole('alert').filter({hasText:/合成交接单读取失败/}).waitFor();await owner.waitFor();assert.equal(await owner.getByRole('button',{name:'查看合同详情',exact:true}).isEnabled(),true);listError=false;await closeFeedback();
 delayList=true;await page.getByRole('button',{name:'刷新合同列表',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.contracts-panel button.text-button')?.disabled);await page.getByRole('button',{name:/返回我的企业/}).click();await open('合成其他企业');await page.getByText('暂无已准备的业务合同',{exact:true}).waitFor();delayList=false;releaseList();await page.waitForTimeout(100);assert.equal(await page.locator('.contract-card').count(),0);
 await page.getByRole('button',{name:/返回我的企业/}).click();list401=true;await open('合成宁达法人');await page.getByRole('button',{name:'获取验证码',exact:true}).waitFor();assert.equal(await page.locator('.contract-card').count(),0);
 assert.equal(writes.some(write=>write.path.includes('/contracts/')&&write.path.endsWith('/sign')),false);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,mode:'synthetic-no-provider',checks:['colliding-task-domain-isolation','delivery-return-labels','no-handover-fee-placeholders','explicit-consent','PDF-hash-change-invalidates-consent','exact-handover-PDF-routes','network-uncertainty-blocks-repeat','same-task-resume-after-query','query-never-signs','unsafe-sign-URL-blocked','mismatched-detail-blocked','signed-PDF-and-filter','independent-list-errors','other-owner-disabled-empty','late-owner-response-isolated','handover-401-expires-session','320-and-390-no-overflow']}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
