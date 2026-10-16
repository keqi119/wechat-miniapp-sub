const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/services/api');
const config = require('../src/config');
const terms = { version: 'MILEAGE_PACK_V1', documentId:'mileage-terms-1',documentVersion:1,hash: 'a'.repeat(64), content: '本订阅期有效，基础额度优先使用；包余额逐月结转，可抵当月未结算超里程，已结算月份不追溯。退订失效，不退未使用费用；争议人工处理。' };
const products = [{ id:'mp1000',version:1,km:1000,amount:80000 },{ id:'mp2000',version:1,km:2000,amount:150000 },{ id:'mp3000',version:1,km:3000,amount:200000 }];
const period = (extra={}) => ({id:'up1',sequence:1,startDate:'2026-09-16',endDate:'2026-10-16',effectiveEndDate:'2026-10-16',status:'AWAITING_READING',revision:1,startReadingKm:1000,endReadingKm:null,usedKm:null,baseUsedKm:null,packUsedKm:null,excessKm:null,excessAmount:null,billId:null,canSubmit:true,reviewNote:'请补月界仪表照片',...extra});
const account = (extra={}) => ({orderId:'o1',orderStatus:'ACTIVE',policyVersion:'USAGE_V1',startedOn:'2026-09-16',returnedOn:null,baseAllowanceKm:1500,excessPriceAmount:150,packBalanceKm:0,packStatus:'ACTIVE',periods:[period()],packs:[],ledger:[],products,purchaseTerms:terms,canPurchase:true,returnSettlement:null,...extra});
function setup(extra={}) {
  const storage=new Map([[config.storageKey,{token:'synthetic-token',expiresAt:'2099-01-01T00:00:00Z',customer:{id:'c1'}}]]),calls=[],navigations=[],toasts=[];
  let usage=extra.usage||account(),failure=extra.failure,settlement=extra.settlement||{id:'rs1',orderId:'o1',status:'READINGS_REQUIRED',revision:1,returnedOn:'2026-10-16',unsettledPeriodIds:['up1'],bills:[],disputeReason:null,resolutionNote:null,canDispute:true};
  const wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),showToast:value=>toasts.push(value.title),showModal:value=>value.success({confirm:true}),setNavigationBarTitle(){},navigateTo:value=>navigations.push(value.url),switchTab(){},makePhoneCall(){},requestPayment(){throw new Error('Usage purchase must never invoke native payment');},chooseMedia:value=>value.success({tempFiles:[{tempFilePath:'/local/odometer.jpg',size:100}]}),uploadFile:value=>value.success({statusCode:201,data:JSON.stringify({id:'file1',name:'仪表.jpg',url:'/api/customer/files/file1',mimeType:'image/jpeg',size:100})}),request(value){
    calls.push(value);const route=value.url.replace(/^https:\/\/[^/]+\/api/,'');if(failure?.route===route)return value.success({statusCode:failure.status,data:{error:{code:'STATE_CONFLICT',message:'合成接口不可用或状态冲突'}}});
    let data;
    if(route==='/customer/dashboard')data={subscription:{id:'o1',orderId:'o1',vehicleName:'合成车型'}};
    else if(route==='/customer/records/entitlements')data={items:[],total:0};
    else if(route==='/customer/records/orders/o1')data={id:'o1',title:'合成订单',statusText:'结算中',details:[],timeline:[],documents:[],actions:[]};
    else if(route==='/customer/orders/o1/usage-account')data=usage;
    else if(route==='/customer/orders/o1/mileage-packs')data={purchase:{id:'purchase1',status:'PENDING_PAYMENT',billId:'bill1',km:1000,amount:80000},bill:{id:'bill1',amount:80000,status:'PUBLISHED'}};
    else if(route==='/customer/usage-periods/up1/readings')data={id:'reading1',status:'SUBMITTED',periodId:'up1'};
    else if(route==='/customer/return-settlements/rs1')data=settlement;
    else if(route==='/customer/return-settlements/rs1/dispute'){settlement={...settlement,status:'DISPUTED',disputeReason:value.data.reason,canDispute:false};data=settlement;}
    else throw new Error('Unexpected route '+route);
    value.success({statusCode:200,data});
  }};
  return {api:createApi(config,value=>wx.request(value),wx),wx,calls,storage,navigations,toasts,setUsage:value=>{usage=value;},setFailure:value=>{failure=value;}};
}
function page(env,name,options={}){global.wx=env.wx;let definition;global.Page=value=>{definition=value;};for(const file of ['../src/services/index','../src/pages/'+name+'/index'])delete require.cache[require.resolve(file)];require('../src/pages/'+name+'/index');const p={...definition,data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}};p.onLoad?.(options);return p;}
const purchaseInput={productId:'mp1000',termsVersion:terms.version,termsDocumentId:terms.documentId,termsDocumentVersion:terms.documentVersion,termsHash:terms.hash,accepted:true};
const readingInput={orderId:'o1',periodId:'up1',readingKm:2600,recordedAt:'2026-10-16T00:30:00Z',fileIds:['file1']};
test('usage account is authenticated, scoped, preserves unreviewed nulls and never invents credited pack balance',async()=>{
  const env=setup();const value=await env.api.getUsageAccount('o1');assert.equal(value.packBalanceKm,0);assert.equal(value.periods[0].excessAmount,null);assert.match(value.periods[0].statusText,/待.*读数|待.*申报/);assert.equal(value.products[0].amountText,'¥800.00');env.setUsage(account({orderId:'other'}));await assert.rejects(env.api.getUsageAccount('o1'),{code:'RESPONSE'});env.storage.clear();await assert.rejects(env.api.getUsageAccount('o1'),{code:'AUTH_REQUIRED'});
});
test('pack purchase requires fresh exact terms and fixed approved product amount and only creates an ordinary bill',async()=>{
  const env=setup();const result=await env.api.createMileagePack('o1',{...purchaseInput,amount:1,km:999999});assert.equal(result.bill.id,'bill1');assert.equal(result.purchase.status,'PENDING_PAYMENT');assert.equal((await env.api.getUsageAccount('o1')).packBalanceKm,0);const post=env.calls.find(call=>call.method==='POST');assert.deepEqual(Object.keys(post.data).sort(),['accepted','idempotencyKey','productId','termsHash','termsVersion','termsDocumentId','termsDocumentVersion'].sort());assert.equal(post.data.termsDocumentId,terms.documentId);assert.equal(post.data.termsDocumentVersion,1);assert.equal(post.data.accepted,true);assert.ok(post.url.endsWith('/orders/o1/mileage-packs'));assert.equal(env.calls.some(call=>call.url.includes('payment-verifications')),false);
});
test('unchecked, stale or unavailable pack policy and frozen or terminated subscriptions cannot create bills',async()=>{
  const unchecked=setup();await assert.rejects(unchecked.api.createMileagePack('o1',{...purchaseInput,accepted:false}));assert.equal(unchecked.calls.some(call=>call.method==='POST'),false);
  for(const usage of [account({purchaseTerms:null}),account({purchaseTerms:{...terms,hash:'b'.repeat(64)}}),account({purchaseTerms:{...terms,documentId:'new-document'}}),account({purchaseTerms:{...terms,documentVersion:2}}),account({purchaseTerms:{...terms,content:''}}),account({canPurchase:false}),account({packStatus:'FROZEN'}),account({packStatus:'EXPIRED',orderStatus:'COMPLETED'}),account({products:[{...products[0],amount:1}]})]){const env=setup({usage});await assert.rejects(env.api.createMileagePack('o1',purchaseInput));assert.equal(env.calls.some(call=>call.method==='POST'),false);}
});
test('unknown pack create result retries with same key and never grants local mileage',async()=>{
  const env=setup({failure:{route:'/customer/orders/o1/mileage-packs',status:500}});await assert.rejects(env.api.createMileagePack('o1',purchaseInput));env.setFailure(null);await env.api.createMileagePack('o1',purchaseInput);const posts=env.calls.filter(call=>call.method==='POST');assert.equal(posts[0].data.idempotencyKey,posts[1].data.idempotencyKey);
});
test('monthly reading binds the server period, photo and actual China boundary date rather than cumulative cross-month estimates',async()=>{
  const env=setup();const result=await env.api.submitUsageReading(readingInput);assert.equal(result.id,'reading1');const post=env.calls.find(call=>call.method==='POST');assert.ok(post.url.endsWith('/usage-periods/up1/readings'));assert.equal(post.data.recordedAt,readingInput.recordedAt);assert.deepEqual(post.data.fileIds,['file1']);assert.equal(post.data.usedKm,undefined);assert.equal(post.data.orderId,undefined);
});
test('missing photos, wrong month, regressing reading, settled month or an unknown period fail closed',async()=>{
  for(const input of [{...readingInput,fileIds:[]},{...readingInput,recordedAt:'2026-10-15T15:59:00Z'},{...readingInput,readingKm:999},{...readingInput,periodId:'other'}]){const env=setup();await assert.rejects(env.api.submitUsageReading(input));assert.equal(env.calls.some(call=>call.method==='POST'),false);}
  for(const status of ['REVIEW_PENDING','SETTLED','CANCELLED']){const env=setup({usage:account({periods:[period({status,canSubmit:false})]})});await assert.rejects(env.api.submitUsageReading(readingInput));assert.equal(env.calls.some(call=>call.method==='POST'),false);}
});
test('return settlement exposes unsettled evidence and unpaid bills; dispute never settles or deducts a deposit',async()=>{
  const env=setup();const value=await env.api.getReturnSettlement('rs1','o1');assert.equal(value.status,'READINGS_REQUIRED');const result=await env.api.disputeReturnSettlement('rs1',{orderId:'o1',reason:'仪表证据尚需核对'});assert.equal(result.status,'DISPUTED');const post=env.calls.find(call=>call.method==='POST');assert.equal(post.data.reason,'仪表证据尚需核对');assert.equal(post.data.amount,undefined);assert.equal(env.calls.some(call=>/\/complete|\/cancel|\/refund/.test(call.url)),false);
});
test('entitlement page defaults pack consent unchecked and directs a created package bill to normal bill details',async()=>{
  const env=setup();const p=page(env,'records',{type:'entitlements',orderId:'o1'});await p.reload();assert.equal(p.data.purchaseAccepted,false);assert.equal(p.data.usage.packBalanceKm,0);await p.buyMileagePack();assert.equal(env.calls.some(call=>call.method==='POST'),false);p.selectMileageProduct({detail:{value:'mp1000'}});p.onPurchaseAccepted({detail:{value:['purchase']}});await p.buyMileagePack();assert.equal(p.data.purchase.bill.id,'bill1');assert.equal(p.data.usage.packBalanceKm,0);p.openPurchaseBill();assert.equal(env.navigations.at(-1),'/pages/record/index?type=bills&id=bill1');
});
test('changing package or reloading a new policy clears the separate checkbox and prevents concurrent purchases',async()=>{
  const env=setup();const p=page(env,'records',{type:'entitlements',orderId:'o1'});await p.reload();p.selectMileageProduct({detail:{value:'mp1000'}});p.onPurchaseAccepted({detail:{value:['purchase']}});p.selectMileageProduct({detail:{value:'mp2000'}});assert.equal(p.data.purchaseAccepted,false);p.selectMileageProduct({detail:{value:'mp1000'}});p.onPurchaseAccepted({detail:{value:['purchase']}});await Promise.all([p.buyMileagePack(),p.buyMileagePack()]);assert.equal(env.calls.filter(call=>call.method==='POST').length,1);assert.equal(p.data.purchaseAccepted,false);
});
test('month form requires explicit period and actual photo datetime; changing period clears prior photos and reading',async()=>{
  const env=setup({usage:account({periods:[period(),period({id:'up2',sequence:2,endDate:'2026-11-16',effectiveEndDate:'2026-11-16'})]})});const p=page(env,'mileage',{orderId:'o1'});await p.reload();assert.equal(p.data.periodId,'');p.selectUsagePeriod({detail:{value:'up1'}});p.setData({reading:'2600',recordedDate:'2026-10-16',recordedTime:'08:30'});await p.chooseAttachments();await p.submit();assert.equal(p.data.submitted.id,'reading1');assert.equal(env.calls.find(call=>call.method==='POST').data.recordedAt,'2026-10-16T00:30:00.000Z');p.selectUsagePeriod({detail:{value:'up2'}});assert.deepEqual(p.data.attachments,[]);assert.equal(p.data.reading,'');assert.equal(p.data.submitted,null);
});
test('missing monthly evidence remains awaiting supplement and usage failures never fall back to legacy mileage submission',async()=>{
  const env=setup({failure:{route:'/customer/orders/o1/usage-account',status:503}});const p=page(env,'mileage',{orderId:'o1'});await p.reload();await p.submit();assert.equal(p.data.usage,null);assert.ok(p.data.error);assert.equal(env.calls.some(call=>call.method==='POST'),false);assert.equal(env.calls.some(call=>call.url.endsWith('/customer/mileages')),false);
});
test('an ended or settling order remains reachable for usage and return settlement without an active dashboard subscription',async()=>{
  const env=setup();const p=page(env,'record',{type:'orders',id:'o1'});await p.reload();p.openOrderUsage();assert.equal(env.navigations.at(-1),'/pages/records/index?type=entitlements&orderId=o1');
});
test('return settlement preserves the actual deposit still due for refund and rejects a different order or completed dispute',async()=>{
  const detail={id:'rs1',orderId:'o1',status:'PENDING_PAYMENT',revision:1,returnedOn:'2026-10-16',unsettledPeriodIds:[],bills:[{id:'deposit1',type:'DEPOSIT',amount:519900,paidAmount:519900,status:'PAID',dueDate:'2026-10-16',description:'押金'}],depositRefundRequiredAmount:519900,canDispute:true};
  const env=setup({settlement:detail});const result=await env.api.getReturnSettlement('rs1','o1');assert.equal(result.depositRefundRequiredAmount,519900);assert.equal(result.depositRefundRequiredText,'¥5,199.00');await assert.rejects(env.api.getReturnSettlement('rs1','other'),{code:'RESPONSE'});
  const done=setup({settlement:{...detail,status:'COMPLETED',canDispute:false,depositRefundRequiredAmount:0}});await assert.rejects(done.api.disputeReturnSettlement('rs1',{orderId:'o1',reason:'测试'}));assert.equal(done.calls.some(call=>call.method==='POST'),false);
});
test('a due month can collect its real boundary evidence before a prior month has settled without inventing a start reading',async()=>{
  const env=setup({usage:account({periods:[period({startReadingKm:null})]})});const value=await env.api.getUsageAccount('o1');assert.equal(value.periods[0].canSubmit,true);assert.equal(value.periods[0].startReadingKm,null);assert.equal((await env.api.submitUsageReading(readingInput)).id,'reading1');
});
test('refund-pending and refunded packs stay unavailable while refund ledger and balance remain server authoritative',async()=>{
  for(const status of ['REFUND_PENDING','REFUNDED']){const env=setup({usage:account({packBalanceKm:0,packs:[{id:'pack1',km:1000,amount:80000,status,billId:'bill1',remainingKm:status==='REFUND_PENDING'?1000:0}],ledger:[{id:'ledger1',type:'REFUND',deltaKm:-1000,createdAt:'2026-10-16T08:00:00Z'}]})});const result=await env.api.getUsageAccount('o1');assert.equal(result.packBalanceKm,0);assert.match(result.packs[0].statusText,/退款/);assert.match(result.packs[0].availabilityText,/不可消费|不可用/);assert.equal(result.ledger[0].typeText,'退款收回');assert.equal(env.calls.some(call=>call.method==='POST'),false);}
  const unknown=setup({usage:account({packs:[{id:'pack1',km:1000,amount:80000,status:'REFUND_UNKNOWN',billId:'bill1',remainingKm:1000}]})});await assert.rejects(unknown.api.getUsageAccount('o1'),{code:'RESPONSE'});
});
test('subscription month ranges mark the exclusive month boundary and distinguish actual return-day cutoff',async()=>{
  const env=setup();const normal=(await env.api.getUsageAccount('o1')).periods[0];assert.match(normal.periodText,/末日不含/);assert.equal(normal.endDate,'2026-10-16');assert.equal(normal.boundaryDateText,'2026.10.16');env.setUsage(account({periods:[period({effectiveEndDate:'2026-10-10'})]}));const tail=(await env.api.getUsageAccount('o1')).periods[0];assert.match(tail.periodText,/归还日/);assert.doesNotMatch(tail.periodText,/末日不含/);assert.equal(tail.effectiveEndDate,'2026-10-10');
});
test('return on the original last month boundary remains an actual-time cutoff even when effectiveEndDate equals endDate',async()=>{
  const env=setup({usage:account({orderStatus:'SETTLING',returnedOn:'2026-10-16',packStatus:'FROZEN',periods:[period(),period({id:'future',sequence:2,startDate:'2026-10-16',endDate:'2026-11-16',effectiveEndDate:'2026-11-16',status:'CANCELLED',canSubmit:false})]})});const result=await env.api.getUsageAccount('o1');assert.match(result.periods[0].periodText,/归还日，以实际还车时刻截止/);assert.doesNotMatch(result.periods[0].periodText,/末日不含/);assert.equal(result.periods[0].effectiveEndDate,'2026-10-16');
});
