import {listenForHttpTests} from './http-listener';
import { fixtureUsagePolicy } from './usage-fixtures';
import '../src/common/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { Db } from '../src/common/db';
import { tokenHash } from '../src/auth/auth.service';
import { BillingService } from '../src/billing/billing';
const origin='http://localhost:3100',csrf='usage-fixture';
let db:Db,app:any,base:string,now=new Date('2026-02-27T04:00:00Z');const cookies:Record<string,string>={};
const payment:any={create:async()=>({timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'fixture',package:'fixture',signType:'RSA',paySign:'fixture'}),query:async()=>{throw Error('no real channel');}};
async function req(path:string,body?:any,identity='ADMIN') {const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookies[identity]?{Cookie:cookies[identity],'X-CSRF-Token':csrf}:{Authorization:'Bearer '+identity})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json() as any};}
async function fixture(start='2026-01-31') {
  now=new Date('2026-02-27T04:00:00Z');const key=randomUUID();
  const customer=await db.customer.create({data:{mobile:key,openId:key,name:'合成用量测试'}});await db.customerSession.create({data:{id:tokenHash(key),customerId:customer.id,expiresAt:new Date(Date.now()+3600000)}});
  const vehicle=await db.vehicle.create({data:{brand:'测试',model:'T',title:'用量测试车',year:2026,city:'上海',mileageKm:12000,status:'RESERVED'}});
  const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'测试',months:3,monthlyFeeAmount:519900,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自费',benefits:[],conditions:'测试',active:true}});
  const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],requestHash:key,idempotencyKey:key,status:'FINAL_PLAN_CONFIRMED'}});
  const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,confirmedMileageKm:12000,status:'AWAITING_HANDOVER',finalPlanSnapshot:{months:3,startDate:start,firstDueDate:start,monthlyFeeAmount:519900,depositAmount:0,mileagePerMonthKm:1500,excessMileagePriceAmount:150,commercialTerms:{vehicleIdentification:'合成用量测试车辆'},usagePolicyVersion:'USAGE_V1',usagePolicy:fixtureUsagePolicy}}});
  await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:order.id}});await db.contract.create({data:{orderId:order.id,customerId:customer.id,documentHash:key,status:'SIGNED'}});await db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:1,amount:519900,paidAmount:519900,status:'PAID',dueDate:new Date(start)}});
  const h=await db.handover.create({data:{orderId:order.id,customerId:customer.id,type:'DELIVERY',readingKm:12000,fileIds:[],checklist:[],manifestHash:key,status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED',actualAt:new Date(start+'T04:00:00Z')} as any});
  const completed=await req(`/admin/handovers/${h.id}/complete`,{});assert.equal(completed.status,201,JSON.stringify(completed.data));return{order,customer,token:key};
}
async function account(f:any){const r=await req(`/customer/orders/${f.order.id}/usage-account`,undefined,f.token);assert.equal(r.status,200);return r.data;}
async function buy(f:any,index=0,key=randomUUID()) {const a=await account(f);return req(`/customer/orders/${f.order.id}/mileage-packs`,{productId:a.products[index].id,termsVersion:a.purchaseTerms.version,termsDocumentId:a.purchaseTerms.documentId,termsDocumentVersion:a.purchaseTerms.documentVersion,termsHash:a.purchaseTerms.hash,accepted:true,idempotencyKey:key},f.token);}
async function pay(f:any,billId:string) {const result=await req(`/customer/bills/${billId}/pay`,{idempotencyKey:randomUUID()},f.token);assert.equal(result.status,201);const billing=new BillingService(db,payment);await billing.settle(result.data.paymentId,{status:'SUCCEEDED',amount:(await db.bill.findUniqueOrThrow({where:{id:billId}})).amount,transactionId:'fixture-'+billId});return{billing,paymentId:result.data.paymentId};}
async function reading(f:any,period:any,readingKm:number,recordedAt='2026-02-28T01:00:00+08:00') {
  const file=await db.storedFile.create({data:{customerId:f.customer.id,name:'仪表.jpg',mimeType:'image/jpeg',size:10,sha256:randomUUID(),storagePath:'fixture',purpose:'mileage'}});
  return req(`/customer/usage-periods/${period.id}/readings`,{readingKm,recordedAt,fileIds:[file.id],idempotencyKey:randomUUID()},f.token);
}
async function approve(id:string){return req(`/admin/mileages/${id}/review`,{decision:'APPROVED',note:'人工确认月界原始仪表照片',boundaryConfirmed:true},'OPERATIONS');}
before(async()=>{assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));process.env.NODE_ENV='test';process.env.ADMIN_ORIGIN=origin;db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
  for(const [km,amount]of [[1000,80000],[2000,150000],[3000,200000]])await db.mileagePackProduct.upsert({where:{id:`mileage-${km}-v1`},update:{},create:{id:`mileage-${km}-v1`,version:1,km,amount}});
  const max=await db.legalDocument.aggregate({where:{type:'mileage-pack'},_max:{version:true}});await db.legalDocument.create({data:{type:'mileage-pack',version:(max._max.version||0)+1,title:'测试购买提示',content:'仅本订阅期有效；退订失效且不退款；争议人工处理。合成测试',status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'fixture'}});
  for(const role of ['ADMIN','OPERATIONS','FINANCE'] as const){const key=randomUUID(),a=await db.adminUser.create({data:{username:key,name:role,role,passwordHash:'fixture'}});await db.adminSession.create({data:{id:tokenHash(key),adminId:a.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});cookies[role]='admin_session='+key;}app=await createApp({db,payment,usageClock:()=>now} as any);base=await listenForHttpTests(app);});
after(async()=>{await app?.close();await db?.$disconnect();});
test('delivery initializes anchored subscription months and cannot proceed with signed date mismatch',async()=>{
  const f=await fixture(),a=await account(f);assert.deepEqual(a.periods.map((p:any)=>[p.startDate,p.endDate]),[['2026-01-31','2026-02-28'],['2026-02-28','2026-03-31'],['2026-03-31','2026-04-30']]);assert.equal(a.baseAllowanceKm,1500);assert.equal(a.excessPriceAmount,150);assert.equal(a.packBalanceKm,0);
});
test('purchase requires exact disclosed terms; only trusted payment grants once and no generic entitlement can grant kilometers',async()=>{
  const f=await fixture(),a=await account(f);assert.equal((await req(`/customer/orders/${f.order.id}/mileage-packs`,{productId:a.products[0].id,termsVersion:a.purchaseTerms.version,termsDocumentId:a.purchaseTerms.documentId,termsDocumentVersion:a.purchaseTerms.documentVersion,termsHash:'f'.repeat(64),accepted:true,idempotencyKey:randomUUID()},f.token)).status,409);
  const key=randomUUID(),results=await Promise.all([buy(f,0,key),buy(f,0,key)]);assert.equal(results[0].status,201);assert.equal(results[0].data.purchase.id,results[1].data.purchase.id);assert.equal((await account(f)).packBalanceKm,0);
  const paid=await pay(f,results[0].data.bill.id);await paid.billing.settle(paid.paymentId,{status:'SUCCEEDED',amount:80000,transactionId:'fixture-'+results[0].data.bill.id});assert.equal((await account(f)).packBalanceKm,1000);assert.equal((await account(f)).ledger.filter((l:any)=>l.type==='GRANT').length,1);
});
test('missing or wrong-date readings stop settlement; approval requires explicit boundary evidence; base then packs and 150 fen excess are immutable',async()=>{
  const f=await fixture();const b=await buy(f);await pay(f,b.data.bill.id);now=new Date('2026-02-28T04:00:00Z');let a=await account(f),p=a.periods[0];
  assert.equal((await req(`/admin/usage-periods/${p.id}/settle`,{revision:p.revision,idempotencyKey:randomUUID()},'FINANCE')).status,409);
  assert.equal((await reading(f,p,15000,'2026-02-27T12:00:00+08:00')).status,409);
  const r=await reading(f,p,15000);assert.equal(r.status,201);assert.equal((await req(`/admin/mileages/${r.data.id}/review`,{decision:'APPROVED',note:'缺少明确确认'},'OPERATIONS')).status,400);assert.equal((await approve(r.data.id)).status,201);
  p=(await account(f)).periods[0];const body={revision:p.revision,idempotencyKey:randomUUID()};const settled=await req(`/admin/usage-periods/${p.id}/settle`,body,'FINANCE');assert.equal(settled.status,201);assert.equal(settled.data.baseUsedKm,1500);assert.equal(settled.data.packUsedKm,1000);assert.equal(settled.data.excessKm,500);assert.equal(settled.data.excessAmount,75000);
  assert.equal((await req(`/admin/usage-periods/${p.id}/settle`,body,'FINANCE')).data.billId,settled.data.billId);
  const bill=await db.bill.findUniqueOrThrow({where:{id:settled.data.billId}});assert.equal(bill.type,'MILEAGE_EXCESS');assert.equal(bill.status,'DRAFT');assert.equal((await req(`/admin/bills/${bill.id}/publish`,{},'FINANCE')).status,409);
});
test('rejected evidence can be resubmitted and later months cannot absorb missing earlier monthly readings',async()=>{
  const f=await fixture();now=new Date('2026-03-31T04:00:00Z');const a=await account(f);let r=await reading(f,a.periods[0],13000);assert.equal((await req(`/admin/mileages/${r.data.id}/review`,{decision:'REJECTED',note:'仪表照片不清晰'},'OPERATIONS')).status,201);
  assert.equal((await account(f)).periods[0].canSubmit,true);r=await reading(f,a.periods[0],13000);assert.equal((await approve(r.data.id)).status,201);
  const later=await reading(f,a.periods[1],14500,'2026-03-31T01:00:00+08:00');assert.equal(later.status,201);assert.equal((await approve(later.data.id)).status,201);
  assert.equal((await req(`/admin/usage-periods/${a.periods[1].id}/settle`,{revision:(await account(f)).periods[1].revision,idempotencyKey:randomUUID()},'FINANCE')).status,409);
});
test('return freezes purchasing, preserves full last-month base, expires unused pack only after allocation and cannot debit deposit',async()=>{
  const f=await fixture();now=new Date('2026-02-14T04:00:00Z');const b=await buy(f,2);await pay(f,b.data.bill.id);now=new Date('2026-02-15T04:00:00Z');
  const h=await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'RETURN',vehicleId:f.order.vehicleId,assignmentId:(await db.order.findUniqueOrThrow({where:{id:f.order.id}})).currentAssignmentId,readingKm:13000,fileIds:[],checklist:[],manifestHash:randomUUID(),status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED',actualAt:now} as any});
  assert.equal((await req(`/admin/handovers/${h.id}/complete`,{})).status,201);let a=await account(f);assert.equal(a.orderStatus,'SETTLING');assert.equal(a.packStatus,'FROZEN');assert.equal(a.canPurchase,false);assert.equal((await buy(f)).status,409);
  let p=a.periods[0];assert.equal(p.status,'READY');p=(await account(f)).periods[0];const settled=await req(`/admin/usage-periods/${p.id}/settle`,{revision:p.revision,idempotencyKey:randomUUID()},'FINANCE');assert.equal(settled.data.baseUsedKm,1000);assert.equal(settled.data.excessKm,0);
  a=await account(f);const ret=await req(`/customer/return-settlements/${a.returnSettlement.id}`,undefined,f.token);assert.equal((await req(`/customer/return-settlements/${ret.data.id}/dispute`,{reason:'费用核对中',idempotencyKey:randomUUID()},f.token)).status,201);
  assert.equal((await req(`/admin/return-settlements/${ret.data.id}/complete`,{revision:ret.data.revision,idempotencyKey:randomUUID()},'FINANCE')).status,409);assert.equal(await db.depositEntry.count({where:{orderId:f.order.id}}),0);
});

test('admin overdue reading filter matches displayed status and excludes it from open months',async()=>{
 const f=await fixture();now=new Date('2026-02-28T04:00:00Z');const a=await account(f);
 const due=await req(`/admin/usage-periods?status=AWAITING_READING&keyword=${f.order.id}`);assert.ok(due.data.items.some((p:any)=>p.id===a.periods[0].id));
 const open=await req(`/admin/usage-periods?status=OPEN&keyword=${f.order.id}`);assert.equal(open.data.items.some((p:any)=>p.id===a.periods[0].id),false);
});
test('unused full pack refunds freeze consumption, partial refunds reject, and trusted replay retires quota once',async()=>{
 const f=await fixture(),b=await buy(f);const paid=await pay(f,b.data.bill.id);
 assert.equal((await req('/admin/refunds',{paymentId:paid.paymentId,amount:1,reason:'部分退款不应保留全部额度',idempotencyKey:randomUUID()},'FINANCE')).status,409);
 const request=await req('/admin/refunds',{paymentId:paid.paymentId,amount:80000,reason:'错误购买完整未使用包，例外全退',idempotencyKey:randomUUID()},'FINANCE');assert.equal(request.status,201);
 // The fixture deliberately has no refund gateway: approval persists the freeze even when the channel is unavailable.
 await req(`/admin/refunds/${request.data.id}/approve`,{});
 let a=await account(f);assert.equal(a.packs[0].status,'REFUND_PENDING');assert.equal(a.packBalanceKm,0);
 now=new Date('2026-02-28T04:00:00Z');const r=await reading(f,a.periods[0],14000);await approve(r.data.id);a=await account(f);
 const settled=await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE');assert.equal(settled.status,409);
 const event={status:'SUCCEEDED' as const,paymentId:paid.paymentId,amount:80000,totalAmount:80000,providerRefundId:'synthetic-refund-'+request.data.id};await paid.billing.settleRefund(request.data.id,event);await paid.billing.settleRefund(request.data.id,event);
 a=await account(f);assert.equal(a.packs[0].status,'REFUNDED');assert.equal(a.ledger.filter((l:any)=>l.type==='REFUND').length,1);
 const end=await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE');assert.equal(end.data.packUsedKm,0);assert.equal(end.data.excessKm,500);
});
test('base resets monthly while paid packs carry; settlement races cannot overspend or create duplicate fees',async()=>{
 const f=await fixture(),b=await buy(f,1);await pay(f,b.data.bill.id);now=new Date('2026-02-28T04:00:00Z');let a=await account(f),r=await reading(f,a.periods[0],13000);await approve(r.data.id);a=await account(f);
 await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE');assert.equal((await account(f)).packBalanceKm,2000);
 now=new Date('2026-03-31T04:00:00Z');a=await account(f);r=await reading(f,a.periods[1],17000,'2026-03-31T09:00:00+08:00');await approve(r.data.id);a=await account(f);
 const body={revision:a.periods[1].revision,idempotencyKey:randomUUID()};const results=await Promise.all([req(`/admin/usage-periods/${a.periods[1].id}/settle`,body,'FINANCE'),req(`/admin/usage-periods/${a.periods[1].id}/settle`,body,'FINANCE')]);assert.equal(results[0].status,201);assert.equal(results[1].data.billId,results[0].data.billId);assert.equal(results[0].data.baseUsedKm,1500);assert.equal(results[0].data.packUsedKm,2000);assert.equal(results[0].data.excessAmount,75000);assert.equal((await account(f)).packBalanceKm,0);assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS'}}),1);
 const payRow=await db.payment.findFirstOrThrow({where:{billId:b.data.bill.id}});assert.equal((await req('/admin/refunds',{paymentId:payRow.id,amount:150000,reason:'已消费不可直接全退',idempotencyKey:randomUUID()},'FINANCE')).status,409);
});
test('pending channel payment blocks month closure; late trusted payment after return is allocated only to prior use',async()=>{
 const f=await fixture(),b=await buy(f);const paymentResult=await req(`/customer/bills/${b.data.bill.id}/pay`,{idempotencyKey:randomUUID()},f.token);assert.equal(paymentResult.status,201);
 now=new Date('2026-02-28T04:00:00Z');let a=await account(f);const r=await reading(f,a.periods[0],14000);await approve(r.data.id);a=await account(f);assert.equal((await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE')).status,409);
 const h=await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'RETURN',vehicleId:f.order.vehicleId,assignmentId:(await db.order.findUniqueOrThrow({where:{id:f.order.id}})).currentAssignmentId,readingKm:14000,fileIds:[],checklist:[],manifestHash:randomUUID(),status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED',actualAt:now}});assert.equal((await req(`/admin/handovers/${h.id}/complete`,{})).status,201);
 const billing=new BillingService(db,payment);await billing.settle(paymentResult.data.paymentId,{status:'SUCCEEDED',amount:80000,transactionId:'late-'+b.data.bill.id});a=await account(f);assert.equal(a.packStatus,'FROZEN');assert.equal(a.packBalanceKm,1000);assert.equal(a.canPurchase,false);
 assert.equal(a.periods[1].status,'READY');a=await account(f);await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE');a=await account(f);await req(`/admin/usage-periods/${a.periods[1].id}/settle`,{revision:a.periods[1].revision,idempotencyKey:randomUUID()},'FINANCE');a=await account(f);assert.equal(a.packStatus,'EXPIRED');assert.equal(a.packBalanceKm,0);
});
test('return cannot complete before independent deposit refund and dispute resolution; future unused fees are voided',async()=>{
 const f=await fixture();now=new Date('2026-02-15T04:00:00Z');const deposit=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'DEPOSIT',sequence:0,amount:100,paidAmount:100,status:'PAID',dueDate:now}});const paid=await db.payment.create({data:{billId:deposit.id,customerId:f.customer.id,amount:100,status:'SUCCEEDED',idempotencyKey:randomUUID()}});const future=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'SUBSCRIPTION',sequence:2,amount:519900,status:'PENDING',dueDate:new Date('2026-02-28')}});
 const h=await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'RETURN',vehicleId:f.order.vehicleId,assignmentId:(await db.order.findUniqueOrThrow({where:{id:f.order.id}})).currentAssignmentId,readingKm:12100,fileIds:[],checklist:[],manifestHash:randomUUID(),status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED',actualAt:now}});await req(`/admin/handovers/${h.id}/complete`,{});let a=await account(f);assert.equal(a.periods[0].status,'READY');a=await account(f);await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE');let ret=(await req(`/admin/return-settlements/${a.returnSettlement.id}`,undefined,'FINANCE')).data;assert.equal(ret.depositRefundRequiredAmount,100);assert.equal(ret.canComplete,false);
 assert.equal((await req(`/customer/bills/${future.id}/pay`,{idempotencyKey:randomUUID()},f.token)).status,409);
 const refund=await db.refund.create({data:{paymentId:paid.id,customerId:f.customer.id,amount:100,reason:'无争议押金',requestedBy:'one',approvedBy:'two',status:'PROCESSING'}});await new BillingService(db,payment).settleRefund(refund.id,{status:'SUCCEEDED',paymentId:paid.id,amount:100,totalAmount:100,providerRefundId:'deposit-'+refund.id});
 await req(`/customer/return-settlements/${ret.id}/dispute`,{reason:'核对最终结算',idempotencyKey:randomUUID()},f.token);ret=(await req(`/admin/return-settlements/${ret.id}`,undefined,'FINANCE')).data;assert.equal(ret.canComplete,false);const resolved=await req(`/admin/return-settlements/${ret.id}/resolve`,{revision:ret.revision,resolutionNote:'已核对完整账单及押金退款',idempotencyKey:randomUUID()},'FINANCE');assert.equal(resolved.data.canComplete,true);const done=await req(`/admin/return-settlements/${ret.id}/complete`,{revision:resolved.data.revision,idempotencyKey:randomUUID()},'FINANCE');assert.equal(done.data.status,'COMPLETED');assert.equal((await db.bill.findUniqueOrThrow({where:{id:future.id}})).status,'VOID');assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'COMPLETED');
});
test('late return entry clears future unstarted pack quotes instead of trapping completion',async()=>{
 const f=await fixture();now=new Date('2026-02-28T04:00:00Z');const b=await buy(f);assert.equal(b.status,201);
 const h=await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'RETURN',vehicleId:f.order.vehicleId,assignmentId:(await db.order.findUniqueOrThrow({where:{id:f.order.id}})).currentAssignmentId,readingKm:12100,fileIds:[],checklist:[],manifestHash:randomUUID(),status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED',actualAt:new Date('2026-02-27T04:00:00Z')}});await req(`/admin/handovers/${h.id}/complete`,{});let a=await account(f);assert.equal(a.periods[0].status,'READY');a=await account(f);const s=await req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE');assert.equal(s.status,201);assert.equal((await db.bill.findUniqueOrThrow({where:{id:b.data.bill.id}})).status,'VOID');const ret=await req(`/admin/return-settlements/${a.returnSettlement.id}`,undefined,'FINANCE');assert.equal(ret.data.canComplete,true);
});
test('new periods cannot approve readings below confirmed delivery baseline, even before earlier month is reported',async()=>{
 const f=await fixture();now=new Date('2026-03-31T04:00:00Z');const a=await account(f),r=await reading(f,a.periods[1],10,'2026-03-31T12:00:00+08:00');
 assert.ok(r.status===409||(await approve(r.data.id)).status===409);
});
test('delivery mismatch is explicit and leaves signed contract, reservation and existing facts unchanged',async()=>{
 const f=await fixture(),h=await db.handover.findFirstOrThrow({where:{orderId:f.order.id,type:'DELIVERY'}});await db.handover.update({where:{id:h.id},data:{status:'CUSTOMER_CONFIRMED',actualAt:new Date('2026-02-01T04:00:00Z')}});await db.order.update({where:{id:f.order.id},data:{status:'AWAITING_HANDOVER'}});await db.vehicle.update({where:{id:f.order.vehicleId},data:{status:'RESERVED'}});
 const result=await req(`/admin/handovers/${h.id}/complete`,{});assert.equal(result.status,409);assert.equal(result.data.error.code,'DELIVERY_DATE_AMENDMENT_REQUIRED');assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'AWAITING_HANDOVER');
});
test('operators reopen only unsettled evidence with immutable history; settlement races preserve one outcome',async()=>{
 const f=await fixture();now=new Date('2026-02-28T04:00:00Z');let a=await account(f);const r=await reading(f,a.periods[0],14000);await approve(r.data.id);a=await account(f);let p=a.periods[0];
 const input={revision:p.revision,reason:'客户核对原始照片发现读数应为13900，保留旧记录重新补证',idempotencyKey:randomUUID()};
 assert.equal((await req(`/admin/usage-periods/${p.id}/request-evidence`,input,'FINANCE')).status,403);
 const changed=await req(`/admin/usage-periods/${p.id}/request-evidence`,input,'OPERATIONS');assert.equal(changed.status,201);assert.equal(changed.data.status,'AWAITING_READING');assert.equal((await db.mileage.findUniqueOrThrow({where:{id:r.data.id}})).status,'APPROVED');assert.equal((await req(`/admin/usage-periods/${p.id}/request-evidence`,input,'OPERATIONS')).status,201);
 const replacement=await reading(f,p,13900);assert.equal(replacement.status,201);await approve(replacement.data.id);p=(await account(f)).periods[0];
 const race=await Promise.all([req(`/admin/usage-periods/${p.id}/request-evidence`,{revision:p.revision,reason:'再次核对',idempotencyKey:randomUUID()},'OPERATIONS'),req(`/admin/usage-periods/${p.id}/settle`,{revision:p.revision,idempotencyKey:randomUUID()},'FINANCE')]);assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
 const final=(await account(f)).periods[0];assert.ok(['SETTLED','AWAITING_READING'].includes(final.status));if(final.status==='AWAITING_READING')assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS'}}),0);
});
test('corrected approved reading permits lower factual return while uncorrected current reading blocks preparing it',async()=>{
 const f=await fixture();now=new Date('2026-02-28T04:00:00Z');let a=await account(f);let r=await reading(f,a.periods[0],14000);await approve(r.data.id);a=await account(f);
 const handover={orderId:f.order.id,type:'RETURN',vehicleId:f.order.vehicleId,assignmentId:(await db.order.findUniqueOrThrow({where:{id:f.order.id}})).currentAssignmentId,readingKm:13900,actualAt:now.toISOString(),fileIds:[],checklist:[{label:'实际交接时间地点',value:'上海，实际照片见附件'}]};assert.equal((await req('/admin/handovers',handover)).status,409);
 await req(`/admin/usage-periods/${a.periods[0].id}/request-evidence`,{revision:a.periods[0].revision,reason:'重新核对原始仪表照片',idempotencyKey:randomUUID()},'OPERATIONS');r=await reading(f,a.periods[0],13900);await approve(r.data.id);
 const created=await req('/admin/handovers',handover);assert.equal(created.status,201);await db.handover.update({where:{id:created.data.id},data:{status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED'}});assert.equal((await req(`/admin/handovers/${created.data.id}/complete`,{})).status,201);assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:f.order.vehicleId}})).mileageKm,13900);
});
test('refund approval racing monthly consumption can never both refund and consume the same kilometers',async()=>{
 const f=await fixture(),b=await buy(f);const paid=await pay(f,b.data.bill.id);const refund=await req('/admin/refunds',{paymentId:paid.paymentId,amount:80000,reason:'异常完整包退款',idempotencyKey:randomUUID()},'FINANCE');now=new Date('2026-02-28T04:00:00Z');let a=await account(f);const r=await reading(f,a.periods[0],14000);await approve(r.data.id);a=await account(f);
 await Promise.all([req(`/admin/refunds/${refund.data.id}/approve`,{}),req(`/admin/usage-periods/${a.periods[0].id}/settle`,{revision:a.periods[0].revision,idempotencyKey:randomUUID()},'FINANCE')]);
 const pack=await db.mileagePurchase.findUniqueOrThrow({where:{id:b.data.purchase.id}}),ref=await db.refund.findUniqueOrThrow({where:{id:refund.data.id}});assert.ok((ref.status==='PROCESSING'&&pack.status==='REFUND_PENDING'&&pack.remainingKm===1000)||(ref.status==='PENDING_APPROVAL'&&pack.status==='ACTIVE'&&pack.remainingKm===500));
 if(ref.status==='PROCESSING'){await paid.billing.settleRefund(ref.id,{status:'FAILED',amount:80000,totalAmount:80000,paymentId:paid.paymentId});assert.equal((await account(f)).packBalanceKm,0);assert.equal((await db.mileagePurchase.findUniqueOrThrow({where:{id:pack.id}})).status,'REFUND_PENDING');}
});
