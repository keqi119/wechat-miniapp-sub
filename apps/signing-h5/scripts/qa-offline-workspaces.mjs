// Only local browser fixtures. No real API, database, SMS, payment or signing provider.
import {chromium} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{createServer}=require('../../miniprogram/scripts/preview.cjs');
const out=new URL('./qa-offline-output/',import.meta.url);await mkdir(out,{recursive:true});
const report={scope:'local synthetic browser fixtures; no real users or external services',checks:[],requests:[],errors:[]};
const archive={id:'qa-archive',kind:'RENTAL',status:'ARCHIVED',currentApprovedVersionId:'qa-version',canRead:true,revision:1,versions:[{id:'qa-version',version:1,status:'ARCHIVED',signedOn:'2026-10-26',contractNumber:'QA-ONLY',files:[{id:'qa-file',name:'合成资料.png',mimeType:'image/png',position:1,size:100}]}]};
const workspace={orderId:'qa-order',mode:'OFFLINE',stage:'AWAITING_CONTRACT_REVIEW',stageText:'待线下合同审核',vehicleTitle:'合成车辆 · 宁达订阅',nextAction:{code:'VIEW_ARCHIVE',label:'请核对本单合同资料',enabled:true},parties:[{role:'OWNER',name:'合成个人车主'},{role:'PLATFORM',name:'上海宁达信息科技有限公司'},{role:'CUSTOMER',name:'合成客户'}],contracts:[archive],billing:[{id:'qa-bill',status:'PENDING',amount:299900,paidAmount:0,dueDate:'2026-11-01'}],handovers:[{id:'qa-handover',type:'DELIVERY',status:'CUSTOMER_CONFIRMED'}],capabilities:{canPay:false,canReadArchive:true,canFeedback:true}};
const policies=[{policyId:'qa-policy',versionId:'qa-policy-v1',insurer:'合成保险公司',policyNumberLast4:'0001',status:'ACTIVE',statusText:'保障有效',startAt:'2026-01-01',endAt:'2026-12-31',coverage:[{code:'LIABILITY',label:'第三者责任保障'}],vehicleIds:['qa-vehicle']}];
const benefit={id:'qa-benefit',orderId:'qa-order',title:'上门维保',description:'按约定预约保养服务',provider:'平台服务商',conditions:'提前预约，受理后核对次数',kind:'COUNT',status:'ACTIVE',totalQuantity:3,reservedQuantity:1,usedQuantity:1,availableQuantity:1,unit:'次'};
const settlement={id:'qa-settlement',status:'PAYMENT_RECORDED',periodStart:'2026-10-01',periodEnd:'2026-10-31',payableAmount:250000,explanation:'按合成协议人工核对',lines:[{id:'qa-line',orderId:'qa-order',payableAmount:250000,category:'RENT',explanation:'本期租赁结算'}],account:{accountName:'合成车主',bankName:'合成银行',maskedNumber:'****0001'},feedback:[]};
const server=createServer();await new Promise(resolve=>server.listen(18945,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const localOrigin='http://127.0.0.1:4310';
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.preview-runtime-error').count(),0);}
async function shot(page,name){await noOverflow(page);await page.screenshot({path:fileURLToPath(new URL(name,out)),fullPage:!(await page.locator('[role=dialog],.archive-mask').count())});}
try{
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));let expired=false,conflict=false,empty=false;
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('External request blocked: '+url.origin);if(!url.pathname.startsWith('/owner/api/'))return route.continue();
   const p=url.pathname.slice('/owner/api'.length),method=route.request().method();report.requests.push({path:p,method});let data={},status=200;
   if(p==='/config')data={mode:'OWNER_LEGAL_H5',enabled:true};
   else if(p==='/legal')data={documents:['terms','privacy','owner-identity'].map(type=>({id:'qa-'+type,type,version:1,title:'合成说明',content:'合成文案'}))};
   else if(p==='/auth/me')data={customer:{id:'qa-person',maskedMobile:'138****0000'},csrfToken:'qa-csrf-only',expiresAt:'2099-01-01T00:00:00Z'};
   else if(p==='/auth/logout')data={success:true};
   else if(expired){status=401;data={message:'合成会话已过期'};}
   else if(p==='/owners')data=[{ownerId:'qa-owner',name:'合成个人车主',subjectType:'INDIVIDUAL',executionMode:'OFFLINE',admissionStatus:'APPROVED'},{ownerId:'qa-enterprise',name:'合成企业合作商',subjectType:'ENTERPRISE',executionMode:'OFFLINE',admissionStatus:'APPROVED'}];
   else if(/^\/owners\/qa-(owner|enterprise)$/.test(p)){const individual=p.endsWith('owner');data={id:individual?'qa-owner':'qa-enterprise',name:individual?'合成个人车主':'合成企业合作商',subjectType:individual?'INDIVIDUAL':'ENTERPRISE',identityRelationship:individual?'SELF':'ENTERPRISE_REPRESENTATIVE',executionMode:'OFFLINE',admissionStatus:'APPROVED',revision:1,address:'合成地址',contactPhone:'138****0000',creditCode:individual?null:'QA0000000000000000',capabilities:{},blockers:[]};}
   else if(p.endsWith('/workbench'))data={items:empty?[]:[workspace],total:empty?0:1,page:1,pageSize:20};
   else if(p.endsWith('/workspace'))data=workspace;
   else if(p.endsWith('/vehicles'))data={items:[{id:'qa-vehicle',title:'合成车辆',brand:'合成品牌',model:'车型A',plateNumber:'合成0001',status:'RESERVED',statusText:'订单占用'}],total:1};
   else if(p.endsWith('/policies'))data={items:policies,total:1};
   else if(p.endsWith('/offline-archives'))data={items:[{...archive,kind:'OWNER_COOPERATION'}],total:1};
   else if(p.endsWith('/offline-archives/qa-archive'))data=archive;
   else if(p.endsWith('/revenue-rules'))data=[{id:'qa-rule',version:1,validFrom:'2026-01-01',validUntil:'2026-12-31',terms:{method:'RATE',rateBps:8000,basis:'实际到账租金',deductions:'按约定核对服务费',refundRule:'退款按实际冲减',cycle:'每月对账',expenseResponsibility:'按合作协议'}}];
   else if(p.endsWith('/settlements'))data=[settlement];
   else if(p.endsWith('/settlements/qa-settlement'))data=settlement;
   else if(p.endsWith('/feedback')){const body=route.request().postDataJSON();assert.ok(body.idempotencyKey);if(p.includes('offline-archives'))assert.equal(body.versionId,'qa-version');if(conflict){status=409;data={message:'资料版本已变化，请重新核对'};conflict=false;}else data={id:'qa-feedback',status:'OPEN'};}
   else{status=404;data={message:'合成未知接口 '+p};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(localOrigin+'/owner/');await page.getByRole('button',{name:/合成个人车主/}).click();await page.getByRole('heading',{name:'当前待办'}).waitFor();await shot(page,`owner-workbench-${width}.png`);
  await page.getByRole('button',{name:/查看订单/}).click();await page.getByRole('heading',{name:'合同与交还车资料'}).waitFor();assert.equal(await page.getByRole('button',{name:/签署|印章|提现/}).count(),0);await shot(page,`owner-order-${width}.png`);
  await page.getByRole('button',{name:'查看资料 / 反馈'}).click();await page.getByLabel('资料有疑问').fill('请核对第三页车辆信息');conflict=true;await page.getByRole('button',{name:'提交问题',exact:true}).click();await page.getByLabel('资料版本').waitFor();await page.getByRole('button',{name:'提交问题',exact:true}).click();await page.getByText(/问题已提交，平台将核对/).waitFor();await shot(page,`owner-archive-${width}.png`);await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'车辆',exact:true}).click();await page.getByRole('heading',{name:'合作车辆'}).waitFor();await shot(page,`owner-vehicles-${width}.png`);
  await page.getByRole('button',{name:'我的合作',exact:true}).click();await page.getByRole('heading',{name:'对账结算'}).waitFor();await page.getByRole('button',{name:/已登记实付，待核对/}).click();await page.getByLabel('核对意见').fill('请核对本期租金明细');await page.getByRole('button',{name:'提交核对意见'}).click();await page.getByText('问题已提交，请等待平台核对。').waitFor();await shot(page,`owner-cooperation-${width}.png`);
  await page.getByRole('button',{name:'‹ 切换合作主体'}).click();await page.getByRole('button',{name:/合成企业合作商/}).click();await page.getByRole('button',{name:'我的合作',exact:true}).click();await page.getByText('企业代表 / 经办人',{exact:true}).waitFor();await shot(page,`owner-enterprise-${width}.png`);
  empty=true;await page.getByRole('button',{name:'订单',exact:true}).click();await page.getByRole('heading',{name:'暂无订单记录'}).waitFor();expired=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('heading',{name:'登录我的合作'}).waitFor();assert.equal(await page.getByRole('heading',{name:'合成企业合作商'}).count(),0);await shot(page,`owner-expired-${width}.png`);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  report.checks.push(`H5 ${width}: individual/company relationship, four tabs, no electronic sign or withdrawal, version feedback with 409 retry, manual settlement, empty state, 401 clears private UI`);await context.close();
 }
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/bundle.js',async route=>{const response=await route.fetch();let source=await response.text();const fixtures={workspace,archive,benefit,insurance:{orderId:'qa-order',coverage:{ready:true,statusText:'保障已核对',blockers:[]},policies}};source+='\nwindow.__preview.modules["services/index.js"]=function(require,module){const f='+JSON.stringify(fixtures)+';module.exports={getOrderWorkspace:async()=>f.workspace,getRecord:async()=>({id:"qa-order",orderDetail:{vehicle:{title:"合成车辆"},summaryRows:[{label:"月费",value:"¥2,999.00"},{label:"押金",value:"¥6,000.00"}]}}),getOrderEntitlements:async()=>[f.benefit],getOrderInsurance:async()=>f.insurance,getOfflineArchive:async()=>f.archive,feedbackOfflineArchive:async()=>({status:"OPEN"}),idempotencyKey:()=>"qa-idempotency-key",getContext:()=>({profile:{mobile:"13800000000"}}),resumePayment:async()=>null,resumeSigning:async()=>null,purgeLegacySigningCache:()=>{}};};';await route.fulfill({response,body:source});});
  await page.goto('http://127.0.0.1:18945/phone#/pages/order-detail/index?id=qa-order');await page.getByText('待线下合同审核',{exact:true}).waitFor();await page.getByText('上门维保',{exact:true}).waitFor();assert.equal(await page.getByText('支付',{exact:true}).count(),0);await shot(page,`mini-order-${width}.png`);
  await page.getByText('查看资料 / 反馈',{exact:true}).click();await page.getByText('资料有疑问',{exact:true}).waitFor();await shot(page,`mini-archive-${width}.png`);await page.getByText('关闭',{exact:true}).click();await page.getByText('申请服务',{exact:true}).click();await page.locator('#preview-page').getByText('权益服务',{exact:true}).waitFor();await shot(page,`mini-benefit-${width}.png`);
  report.checks.push(`Miniapp ${width}: real compiled WXML/WXSS with Page JS, synthetic service module only in browser fixture; payment blocked, paper archive, benefit entry; no overflow`);await context.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,errors:report.errors.length,out:fileURLToPath(out)}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
