import {listenForHttpTests} from './http-listener';
import { seedUsageLegal } from './usage-fixtures';
import '../src/common/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/common/db';
import { createApp } from '../src/app';
import { tokenHash } from '../src/auth/auth.service';
const origin = 'http://localhost:3100', csrf = 'credit-test-csrf';
let db: Db, server: any, base: string, doc: any;
const cookies: Record<string,string> = {};
const terms = Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(k=>[k,'测试明确条款']));
async function req(path: string, body?: any, identity = 'ADMIN') {
  const r = await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookies[identity]?{Cookie:cookies[identity],'X-CSRF-Token':csrf}:{Authorization:'Bearer '+identity})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,data:await r.json() as any};
}
async function fixture() {
  const id=randomUUID(), c=await db.customer.create({data:{mobile:id,name:'合成信用测试'}});
  await db.customerSession.create({data:{id:tokenHash(id),customerId:c.id,expiresAt:new Date(Date.now()+3600000)}});
  for(const type of ['terms','privacy']){const d=await db.legalDocument.findFirstOrThrow({where:{type,status:'PUBLISHED'},orderBy:{version:'desc'}});await db.customerConsent.create({data:{customerId:c.id,documentId:d.id,type,version:d.version,source:'TEST'}});}
  const v=await db.vehicle.create({data:{brand:'测试',model:'T',title:'测试车辆',year:2026,city:'上海',mileageKm:12000,status:'PUBLISHED'}});
  const p=await db.subscriptionPlan.create({data:{vehicleId:v.id,name:'测试',months:12,monthlyFeeAmount:519900,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自费',benefits:[],conditions:'测试',active:true}});
  const a=await db.application.create({data:{customerId:c.id,vehicleId:v.id,subscriptionPlanId:p.id,profile:{},consents:[],idempotencyKey:id,requestHash:id,status:'IN_REVIEW'}});
  return {id:a.id,token:id,customerId:c.id};
}
async function consent(f:any,decision='ACCEPT',key=randomUUID()) {return req(`/customer/applications/${f.id}/credit-consent`,{documentId:doc.id,version:doc.version,decision,idempotencyKey:key},f.token);}
async function verify(f:any,band='GE750',extra:any={}) {
  const c=(await req(`/admin/applications/${f.id}/credit-review`)).data;
  return req(`/admin/applications/${f.id}/credit-verifications`,{consentId:c.consent?.id,creditRevision:c.creditRevision,band,customerPresented:true,idempotencyKey:randomUUID(),...extra});
}
async function plan(f:any,extra:any={},identity='ADMIN') {
  const credit=(await req(`/admin/applications/${f.id}/credit-review`)).data;
  const a=await db.application.findUniqueOrThrow({where:{id:f.id}});
  return req(`/admin/applications/${f.id}/final-plan`,{creditVerificationId:credit.verification?.id||'unverified-test-id',revision:a.revision,commercialTerms:terms,monthlyFeeAmount:519900,months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自费',benefits:[],conditions:'测试',startDate:'2026-11-01',firstDueDate:'2026-11-01',...extra},identity);
}
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test')); process.env.NODE_ENV='test';process.env.ADMIN_ORIGIN=origin;
  db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});await seedUsageLegal(db);
  for(const type of ['terms','privacy']){const max=await db.legalDocument.aggregate({where:{type},_max:{version:true}});await db.legalDocument.create({data:{type,version:(max._max.version||0)+1,title:type,content:'合成测试协议',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});}
  for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT'] as const){const id=randomUUID();const a=await db.adminUser.create({data:{username:id,name:role,role,passwordHash:'fixture'}});await db.adminSession.create({data:{id:tokenHash(id),adminId:a.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});cookies[role]='admin_session='+id;}
  const max=await db.legalDocument.aggregate({where:{type:'credit-verification'},_max:{version:true}});
  doc=await db.legalDocument.create({data:{type:'credit-verification',version:(max._max.version||0)+1,title:'人工核验说明',content:'合成测试，不记录精确分或截图',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
  server=await createApp({db});base=await listenForHttpTests(server);
});
after(async()=>{await server?.close();await db?.$disconnect();});
test('application-specific explicit consent is private, decline is not approval, and arbitrary evidence is rejected',async()=>{
  const f=await fixture(),other=await fixture();
  assert.equal((await req(`/customer/applications/${f.id}/credit-review`,undefined,other.token)).status,404);
  const initial=await req(`/customer/applications/${f.id}/credit-review`,undefined,f.token);assert.equal(initial.status,200);assert.equal(initial.data.canFinalize,false);
  assert.equal((await verify(f)).status,400);
  assert.equal((await consent(f,'DECLINE')).data.status,'MANUAL_REVIEW');
  assert.equal((await verify(f)).status,409);
  assert.equal((await consent(f)).data.consent.status,'ACCEPTED');
  assert.equal((await verify(f,'GE750',{score:780})).status,400);
  for(const extra of [{fileIds:['screenshot']},{note:'780分'},{verifiedBy:'spoof'},{verifiedAt:new Date().toISOString()},{customerPresented:false}]) assert.equal((await verify(f,'GE750',extra)).status,400);
  const c=(await req(`/admin/applications/${f.id}/credit-review`)).data;
  const payload={consentId:c.consent.id,creditRevision:c.creditRevision,band:'GE750',customerPresented:true,idempotencyKey:randomUUID()};
  assert.equal((await req(`/admin/applications/${f.id}/credit-verifications`,payload,'FINANCE')).status,403);
  assert.equal((await req(`/admin/applications/${f.id}/credit-verifications`,payload,'SUPPORT')).status,403);
  const results=await Promise.all([req(`/admin/applications/${f.id}/credit-verifications`,payload,'OPERATIONS'),req(`/admin/applications/${f.id}/credit-verifications`,payload,'OPERATIONS')]);
  assert.equal(results[0].status,201);assert.equal(results[1].data.verification.id,results[0].data.verification.id);
});
test('each verified band derives deposit server-side and low/unverifiable never produce a final plan',async()=>{
  for(const [band,deposit] of [['GE750',0],['B700_749',519900],['B650_699',1039800],['LT650',null],['UNVERIFIABLE',null]] as const){
    const f=await fixture();assert.equal((await consent(f)).status,201);assert.equal((await verify(f,band)).status,201);
    if(deposit===null){assert.equal((await plan(f)).status,409);continue;}
    assert.equal((await plan(f,{depositAmount:1})).status,409);
    const result=await plan(f);assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.finalPlan.depositAmount,deposit);assert.equal(result.data.finalPlan.creditBand,band);assert.equal(result.data.finalPlan.creditRuleVersion,'ZHIMA_MANUAL_V1');
    const customerView=(await req(`/customer/applications/${f.id}/credit-review`,undefined,f.token)).data;
    assert.equal(customerView.verificationCurrent,true);assert.equal(customerView.canConfirmFinalPlan,true);
  }
});
test('cross-application authorization and stale verification revisions cannot be used',async()=>{
  const a=await fixture(),b=await fixture();await consent(a);await consent(b);
  const ca=(await req(`/admin/applications/${a.id}/credit-review`)).data, cb=(await req(`/admin/applications/${b.id}/credit-review`)).data;
  assert.equal((await req(`/admin/applications/${b.id}/credit-verifications`,{consentId:ca.consent.id,creditRevision:cb.creditRevision,band:'GE750',customerPresented:true,idempotencyKey:randomUUID()})).status,409);
  await verify(a);const old=(await plan(a)).data.finalPlan;await verify(a,'B700_749');
  assert.equal((await req(`/customer/applications/${a.id}/confirm`,{revision:old.revision,commercialHash:old.commercialHash},a.token)).status,409);
  assert.equal((await plan(a,{creditVerificationId:old.creditVerificationId})).status,409);
});
test('withdrawal invalidates an unconfirmed plan, repeated withdrawal is idempotent, and historical verification remains',async()=>{
  const f=await fixture();await consent(f);const v=await verify(f);const p=(await plan(f)).data.finalPlan;
  const body={consentId:v.data.consent.id,idempotencyKey:randomUUID()};
  const withdrawn=await req(`/customer/applications/${f.id}/credit-consent/withdraw`,body,f.token);assert.equal(withdrawn.data.consent.status,'WITHDRAWN');
  assert.equal((await req(`/customer/applications/${f.id}/credit-consent/withdraw`,body,f.token)).status,201);
  assert.equal((await req(`/customer/applications/${f.id}/confirm`,{revision:p.revision,commercialHash:p.commercialHash},f.token)).status,409);
  assert.equal((await plan(f)).status,409);assert.equal((await (db as any).creditVerification.count({where:{applicationId:f.id}})),1);
});
test('withdrawal racing verification or confirmation is serializable and never alters a confirmed order deposit',async()=>{
  const f=await fixture();await consent(f);const v=await verify(f,'B700_749');const p=(await plan(f)).data.finalPlan;
  const outcomes=await Promise.all([req(`/customer/applications/${f.id}/confirm`,{revision:p.revision,commercialHash:p.commercialHash},f.token),req(`/customer/applications/${f.id}/credit-consent/withdraw`,{consentId:v.data.consent.id,idempotencyKey:randomUUID()},f.token)]);
  assert.equal(outcomes[1].status,201);assert.ok([201,409].includes(outcomes[0].status));
  const order=await db.order.findUnique({where:{applicationId:f.id}});if(order)assert.equal((order.finalPlanSnapshot as any).depositAmount,519900);
  assert.equal((await verify(f)).status,409);
});
test('new credit document invalidates old consent and plan until a fresh explicit consent and verification',async()=>{
  const f=await fixture();await consent(f);await verify(f);const old=(await plan(f)).data.finalPlan;
  doc=await db.legalDocument.create({data:{type:'credit-verification',version:doc.version+1,title:'更新核验说明',content:'新合成测试版本',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
  assert.equal((await req(`/customer/applications/${f.id}/confirm`,{revision:old.revision,commercialHash:old.commercialHash},f.token)).status,409);
  assert.equal((await verify(f)).status,409);
  assert.equal((await consent(f)).status,201);assert.equal((await plan(f)).status,409);
  assert.equal((await verify(f)).status,201);assert.equal((await plan(f)).status,201);
});
test('privacy refresh blocks acceptance and verification but never blocks declining or withdrawing',async()=>{
  const f=await fixture();await consent(f);
  const privacy=await db.legalDocument.findFirstOrThrow({where:{type:'privacy',status:'PUBLISHED'},orderBy:{version:'desc'}});
  await db.customerConsent.deleteMany({where:{customerId:f.customerId,documentId:privacy.id}});
  const view=(await req(`/customer/applications/${f.id}/credit-review`,undefined,f.token)).data;
  assert.equal(view.canConsent,false);assert.equal(view.canDecline,true);assert.equal(view.canWithdraw,true);
  assert.equal((await consent(f)).status,409);assert.equal((await verify(f)).status,409);
  assert.equal((await req(`/customer/applications/${f.id}/credit-consent/withdraw`,{consentId:view.consent.id,idempotencyKey:randomUUID()},f.token)).status,201);
  assert.equal((await consent(f,'DECLINE')).status,201);
});
test('concurrent consent replay and withdrawal versus verification preserve one authorization fact',async()=>{
  const f=await fixture(),key=randomUUID();
  const cs=await Promise.all([consent(f,'ACCEPT',key),consent(f,'ACCEPT',key)]);assert.equal(cs[0].status,201);assert.equal(cs[1].status,201);assert.equal(cs[0].data.consent.id,cs[1].data.consent.id);
  const c=cs[0].data;
  const results=await Promise.all([req(`/admin/applications/${f.id}/credit-verifications`,{consentId:c.consent.id,creditRevision:c.creditRevision,band:'GE750',customerPresented:true,idempotencyKey:randomUUID()}),req(`/customer/applications/${f.id}/credit-consent/withdraw`,{consentId:c.consent.id,idempotencyKey:randomUUID()},f.token)]);
  assert.equal(results[1].status,201);assert.ok([201,409].includes(results[0].status));
  assert.equal((await plan(f)).status,409);assert.equal((await req(`/admin/applications/${f.id}/credit-review`)).data.canFinalize,false);
});
test('finance/support can read financial amounts but cannot retrieve credit details through specialized or ordinary resources',async()=>{
  const f=await fixture();await consent(f);await verify(f,'B700_749');const p=(await plan(f)).data.finalPlan;
  const confirmed=await req(`/customer/applications/${f.id}/confirm`,{revision:p.revision,commercialHash:p.commercialHash},f.token);assert.equal(confirmed.status,201);
  for(const role of ['FINANCE','SUPPORT']){
    assert.equal((await req(`/admin/applications/${f.id}/credit-review`,undefined,role)).status,403);
    const detail=await req(`/admin/applications/${f.id}`,undefined,role);assert.equal(detail.status,200);assert.equal(detail.data.finalPlan.depositAmount,519900);
    const order=await req(`/admin/orders/${confirmed.data.id}`,undefined,role);assert.equal(order.status,200);assert.equal(order.data.finalPlanSnapshot.depositAmount,519900);
    const apps=await req(`/admin/applications?keyword=${f.id}`,undefined,role),orders=await req(`/admin/orders?keyword=${confirmed.data.id}`,undefined,role);
    for(const response of [detail,order,apps,orders])for(const key of ['creditBand','creditVerificationId','creditRevision','creditRuleVersion'])assert.ok(!JSON.stringify(response.data).includes('"'+key+'"'),role+' must not receive '+key);
  }
  for(const role of ['ADMIN','OPERATIONS'])assert.equal((await req(`/admin/applications/${f.id}/credit-review`,undefined,role)).data.verification.band,'B700_749');
  assert.equal((await req(`/customer/applications/${f.id}/credit-review`,undefined,f.token)).data.verification.band,'B700_749');
});

test('scoped one-fen price preserves actual credit band, creates thirteen exact bills and never edits public plan',async()=>{
 const saved=process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
 try{
  for(const band of ['GE750','B650_699']){
   const f=await fixture();await consent(f);await verify(f,band);const application=await db.application.findUniqueOrThrow({where:{id:f.id}});
   const scope={applicationId:f.id,customerId:f.customerId,vehicleId:application.vehicleId,startDate:'2026-11-01',firstDueDate:'2026-11-01',reference:'local-scope-'+f.id};
   const special={pricingMode:'V1_ONE_FEN',monthlyFeeAmount:1,depositAmount:1};
   delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;assert.equal((await plan(f,special)).status,409);
   process.env.ORDER_ACCEPTANCE_SCOPE_JSON=JSON.stringify(scope);
   assert.equal((await req(`/admin/applications/${f.id}/credit-review`)).data.acceptancePricing?.depositAmount,1);
   assert.equal((await req(`/admin/applications/${f.id}/credit-review`,undefined,'OPERATIONS')).data.acceptancePricing,undefined);
   assert.equal((await plan(f,special,'OPERATIONS')).status,403);
   const result=await plan(f,special);assert.equal(result.status,201,JSON.stringify(result.data));const final=result.data.finalPlan;
   assert.equal(final.creditBand,band);assert.equal(final.depositAmount,1);assert.match(final.pricingDescription,/12期.*0.01/);
   const confirmation={revision:final.revision,commercialHash:final.commercialHash};
   process.env.ORDER_ACCEPTANCE_SCOPE_JSON=JSON.stringify({...scope,customerId:'other'});assert.equal((await req(`/customer/applications/${f.id}/confirm`,confirmation,f.token)).status,409);
   process.env.ORDER_ACCEPTANCE_SCOPE_JSON=JSON.stringify(scope);const order=await req(`/customer/applications/${f.id}/confirm`,confirmation,f.token);assert.equal(order.status,201,JSON.stringify(order.data));
   delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;assert.equal((await req(`/customer/applications/${f.id}/confirm`,confirmation,f.token)).data.id,order.data.id);
   const bills=await db.bill.findMany({where:{orderId:order.data.id}});assert.equal(bills.length,13);assert.ok(bills.every(b=>b.amount===1));
   assert.equal((await db.subscriptionPlan.findUniqueOrThrow({where:{id:application.subscriptionPlanId}})).monthlyFeeAmount,519900);
   assert.equal((order.data.finalPlanSnapshot as any).acceptancePricing.scope.applicationId,f.id);
   for(const role of ['FINANCE','SUPPORT'])for(const path of [`/admin/applications/${f.id}`,`/admin/orders/${order.data.id}`]){
    const response=await req(path,undefined,role);assert.equal(response.status,200);
    assert.ok(!JSON.stringify(response.data).includes('standardDepositAmount'),role+' must not infer the private credit tier from acceptance metadata');
   }
  }
 }finally{if(saved===undefined)delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;else process.env.ORDER_ACCEPTANCE_SCOPE_JSON=saved;}
});

test('one-fen scope never bypasses missing, low, changed or withdrawn credit authorization',async()=>{
 const saved=process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
 try{
  for(const band of ['LT650','UNVERIFIABLE','GE750']){
   const f=await fixture(),application=await db.application.findUniqueOrThrow({where:{id:f.id}});
   process.env.ORDER_ACCEPTANCE_SCOPE_JSON=JSON.stringify({applicationId:f.id,customerId:f.customerId,vehicleId:application.vehicleId,startDate:'2026-11-01',firstDueDate:'2026-11-01',reference:'local-credit-guards'});
   const special={pricingMode:'V1_ONE_FEN',monthlyFeeAmount:1,depositAmount:1};
   assert.equal((await plan(f,special)).status,409);
   await consent(f);const verification=await verify(f,band);
   if(band!=='GE750'){assert.equal((await plan(f,special)).status,409);continue;}
   const original=(await plan(f,special)).data.finalPlan;await verify(f,'B650_699');
   assert.equal((await req(`/customer/applications/${f.id}/confirm`,{revision:original.revision,commercialHash:original.commercialHash},f.token)).status,409);
   const revised=(await plan(f,special)).data.finalPlan;
   assert.equal((await req(`/customer/applications/${f.id}/credit-consent/withdraw`,{consentId:verification.data.consent.id,idempotencyKey:randomUUID()},f.token)).status,201);
   assert.equal((await req(`/customer/applications/${f.id}/confirm`,{revision:revised.revision,commercialHash:revised.commercialHash},f.token)).status,409);
   assert.equal((await plan(f,special)).status,409);
   assert.equal(await db.order.count({where:{applicationId:f.id}}),0);
  }
 }finally{if(saved===undefined)delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;else process.env.ORDER_ACCEPTANCE_SCOPE_JSON=saved;}
});
