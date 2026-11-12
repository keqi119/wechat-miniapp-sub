import './legacy-esign-mode';
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
import {snapshotUsagePolicy} from '../src/usage/policy';
import {initializeUsage} from '../src/usage/rules';
import {BillingService} from '../src/billing/billing';
import {creditView,reserveCredit,releaseCredits,consumeCredit,readSwapCreditAvailability} from '../src/vehicle-changes/credits';
import {expireSwapPurchases} from '../src/swap-purchases/ledger';
import {freezeSwapPolicy,freezeSwapPricing,swapProduct} from '../src/swap-purchases/policy';
import {swapTerms} from '../src/swap-purchases/rules';

// Real persistence only through the guarded isolated runner. All gateways are synthetic.
let db:Db,app:any,base:string,swapDoc:any;
const now=new Date('2026-02-10T10:00:00+08:00'),actors:any={},remote=new Map<string,any>(),refundRemote=new Map<string,any>();
const previousPurchaseFlag=process.env.SWAP_CREDIT_PURCHASE_ENABLED;
let providerCalls=0;
async function req(path:string,body?:any,who='FINANCE'){
 const actor=actors[who],response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3100',...(actor?{Cookie:'admin_session='+actor.token,'X-CSRF-Token':'term-swap-local'}:{Authorization:'Bearer '+who})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return{status:response.status,data:await response.json() as any};
}
before(async()=>{
 process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 for(const role of ['ADMIN','FINANCE']){const token=randomUUID(),user=await db.adminUser.create({data:{username:token,name:'合同期次数合成财务',passwordHash:'synthetic',role:role as any}});await db.adminSession.create({data:{id:tokenHash(token),adminId:user.id,csrfToken:'term-swap-local',expiresAt:new Date(Date.now()+3600000)}});actors[role]={id:user.id,token};}
 for(const [type,content] of [['swap-credit-v2','合同期额外换车一次 {{extraFeeYuan}} 元（{{extraFeeAmount}} 分）；免费优先，未使用退款须依法审批。'],['usage-policy-v2','每月 {{baseAllowanceKm}} 公里，超额每公里 {{excessPriceYuan}} 元。'],['terms','合成测试用户协议'],['privacy','合成测试隐私协议']]){
  const version=((await db.legalDocument.aggregate({where:{type},_max:{version:true}}))._max.version||0)+1;
  const doc=await db.legalDocument.create({data:{type,version,title:'合成合同期测试文档',content,status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'synthetic-term-reviewer'}});if(type==='swap-credit-v2')swapDoc=doc;
 }
 app=await createApp({db,usageClock:()=>now,payment:{create:async i=>{providerCalls++;remote.set(i.paymentId,{status:'PENDING',amount:i.amount});return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic',package:'prepay_id=synthetic',signType:'RSA',paySign:'synthetic'};},query:async id=>remote.get(id),close:async id=>{remote.set(id,{...remote.get(id),status:'CLOSED'});},refund:async i=>{refundRemote.set(i.refundId,{status:'PROCESSING',paymentId:i.paymentId,amount:i.amount,totalAmount:i.totalAmount});return{status:'PROCESSING'};},queryRefund:async id=>refundRemote.get(id)}});
 base=await listenForHttpTests(app);
});
after(async()=>{await app?.close();await db?.$disconnect();if(previousPurchaseFlag===undefined)delete process.env.SWAP_CREDIT_PURCHASE_ENABLED;else process.env.SWAP_CREDIT_PURCHASE_ENABLED=previousPurchaseFlag;});
async function fixture(includedCount=0,amount=50000){
 const token=randomUUID(),customer=await db.customer.create({data:{mobile:token,openId:token}});await db.customerSession.create({data:{id:tokenHash(token),customerId:customer.id,expiresAt:new Date(Date.now()+3600000)}});
 for(const type of ['terms','privacy']){const d=await db.legalDocument.findFirstOrThrow({where:{type,status:'PUBLISHED'},orderBy:{version:'desc'}});await db.customerConsent.create({data:{customerId:customer.id,documentId:d.id,type,version:d.version,source:'TEST'}});}
 const vehicle=await db.vehicle.create({data:{brand:'合成',model:'EV',title:'合同期次数测试车',year:2026,city:'上海',mileageKm:100,status:'IN_USE'}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成冻结产品',months:24,monthlyFeeAmount:519900,mileagePerMonthKm:2400,excessMileagePriceAmount:230,energyDescription:'合成',benefits:[],conditions:'合成'}});
 const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],requestHash:token,idempotencyKey:token,status:'FINAL_PLAN_CONFIRMED'}});
 const product={configurationVersion:2,productId:'synthetic-'+token,productVersionId:'synthetic-version-'+token,version:2,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount,extraFeeAmount:amount}};
 const usagePolicy=await snapshotUsagePolicy(db,product),snapshot={months:24,startDate:'2026-01-31',firstDueDate:'2026-01-31',monthlyFeeAmount:519900,depositAmount:0,mileagePerMonthKm:2400,excessMileagePriceAmount:230,productSnapshot:product,usagePolicyVersion:usagePolicy.policyVersion,usagePolicy};
 const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:snapshot,status:'ACTIVE',contractMode:'ESIGN',confirmedMileageKm:100}});await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:order.id}});
 const handover=await db.handover.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,type:'DELIVERY',executionMode:'ESIGN',status:'COMPLETED',signatureStatus:'SIGNED',actualAt:new Date('2026-01-31T10:00:00+08:00'),readingKm:100,manifestHash:token,fileIds:[],checklist:[],completedAt:new Date()}});
 await db.serial(tx=>initializeUsage(tx,order,handover));const account=await db.usageAccount.findUniqueOrThrow({where:{orderId:order.id}});
 return{token,customer,order,vehicle,snapshot,account};
}
async function input(f:any){const terms=await swapTerms(db,f.order),product=swapProduct(f.order);return{productId:product.id,pricingHash:product.pricingHash,termsVersion:terms!.version,termsDocumentId:terms!.documentId,termsDocumentVersion:terms!.documentVersion,termsHash:terms!.hash,accepted:true,idempotencyKey:randomUUID()};}
async function purchased(f:any){const result=await req(`/customer/orders/${f.order.id}/swap-credits`,await input(f),f.token);assert.equal(result.status,201,JSON.stringify(result.data));return{...f,purchase:result.data.purchase,bill:result.data.bill};}
async function paid(f:any){const p=await purchased(f),result=await req(`/customer/bills/${p.bill.id}/pay`,{idempotencyKey:randomUUID()},f.token);assert.equal(result.status,201,JSON.stringify(result.data));await app.get(BillingService).settle(result.data.paymentId,{status:'SUCCEEDED',amount:p.bill.amount,transactionId:'synthetic-'+result.data.paymentId});return{...p,paymentId:result.data.paymentId};}

test('TERM persisted ledger lazily reserves one final gift under concurrency, reuses release and consumes once without annual renewal',async()=>{
 const f=await fixture(1),before=await creditView(db,f.order,f.account,now) as any;assert.equal(before.term.available,1);await readSwapCreditAvailability(db,f.order,f.account,'read-only',now);assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),0);
 const ids=[randomUUID(),randomUUID()],outcomes=await Promise.allSettled(ids.map(id=>db.serial(tx=>reserveCredit(tx,f.order,f.account,id,now))));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const winner=ids[outcomes.findIndex(r=>r.status==='fulfilled')];
 assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),1);assert.equal(await db.swapReservation.count({where:{orderId:f.order.id,status:'RESERVED'}}),1);
 const reserved:any=await creditView(db,f.order,f.account,now);assert.deepEqual([reserved.term.remaining,reserved.term.reserved,reserved.term.available],[1,1,0]);assert.equal(reserved.reservations[0].scope,'TERM');assert.equal(reserved.reservations[0].termSequence,1);
 await db.serial(tx=>releaseCredits(tx,winner));await db.serial(tx=>reserveCredit(tx,f.order,f.account,winner,now));const beforeReplay=await db.swapLedger.count({where:{orderId:f.order.id}});await db.serial(tx=>reserveCredit(tx,f.order,f.account,winner,now));assert.equal(await db.swapLedger.count({where:{orderId:f.order.id}}),beforeReplay);await Promise.all([1,2].map(()=>db.serial(tx=>consumeCredit(tx,f.order,f.account,winner,now))));
 assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).revision,f.order.revision);assert.equal((await db.usageAccount.findUniqueOrThrow({where:{id:f.account.id}})).revision,f.account.revision);
 assert.equal(await db.swapLedger.count({where:{orderId:f.order.id,type:'GRANT'}}),1);assert.equal(await db.swapLedger.count({where:{orderId:f.order.id,type:'CONSUME'}}),1);
 const later:any=await creditView(db,f.order,f.account,new Date('2027-02-10T00:00:00+08:00'));assert.equal(later.term.available,0);assert.equal(later.term.consumed,1);await assert.rejects(db.serial(tx=>reserveCredit(tx,f.order,f.account,randomUUID(),new Date('2027-02-10T00:00:00+08:00'))));
 assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).finalPlanSnapshot,f.snapshot);assert.equal((await db.usagePeriod.findFirstOrThrow({where:{orderId:f.order.id,sequence:1}})).startDate.toISOString().slice(0,10),'2026-01-31');
 const stored=await db.swapCredit.findFirstOrThrow({where:{orderId:f.order.id}});assert.equal(stored.cycleSequence,null);assert.deepEqual(stored.policySnapshot,freezeSwapPolicy(f.order));
});
test('maximum included count never preallocates; ending service expires only the single actual reservation and rejects forged frozen sources',async()=>{
 const f=await fixture(2147483647),view:any=await creditView(db,f.order,f.account,now);assert.equal(view.term.available,2147483647);assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),0);
 const reservation=await db.serial(tx=>reserveCredit(tx,f.order,f.account,randomUUID(),now));await db.usageAccount.update({where:{id:f.account.id},data:{returnedOn:new Date('2026-02-10')}});await db.serial(tx=>expireSwapPurchases(tx,f.order.id,now,true));await db.serial(tx=>expireSwapPurchases(tx,f.order.id,now,true));
 assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),1);assert.equal((await db.swapCredit.findUniqueOrThrow({where:{id:reservation.creditId}})).status,'EXPIRED');assert.equal(await db.swapLedger.count({where:{orderId:f.order.id,type:'EXPIRE'}}),1);
 const account=await db.usageAccount.findUniqueOrThrow({where:{id:f.account.id}});assert.equal((await creditView(db,f.order,account,now) as any).term.available,0);
 await db.swapCredit.update({where:{id:reservation.creditId},data:{policySnapshot:{...freezeSwapPolicy(f.order)!,sourceHash:'0'.repeat(64)}}});await assert.rejects(creditView(db,f.order,account,now));
});
test('v2 HTTP purchase freezes configured cents and exact template evidence; trusted receipt and full refund stay idempotent',async()=>{
 const f=await fixture(),body=await input(f),path=`/customer/orders/${f.order.id}/swap-credits`,other=await fixture();
 assert.equal((await req(path,body,other.token)).status,404);assert.equal((await req(path,{...body,pricingHash:undefined},f.token)).status,400);assert.equal((await req(path,{...body,amount:1},f.token)).status,400);assert.equal((await req(path,{...body,pricingHash:'0'.repeat(64)},f.token)).status,409);
 const results=await Promise.all([req(path,body,f.token),req(path,body,f.token)]);assert.ok(results.every(r=>r.status===201),JSON.stringify(results));const made=results[0].data;assert.equal(made.purchase.id,results[1].data.purchase.id);assert.equal(made.bill.amount,50000);assert.equal(made.purchase.policyVersion,'SWAP_TERM_V2');assert.equal(made.purchase.pricingHash,body.pricingHash);assert.equal(made.purchase.terms.templateContent,swapDoc.content);assert.match(made.purchase.terms.content,/500\.00/);assert.match(made.purchase.terms.templateHash,/^[a-f0-9]{64}$/);
 assert.deepEqual((await db.swapCreditPurchase.findUniqueOrThrow({where:{id:made.purchase.id}})).pricingSnapshot,freezeSwapPricing(f.order));assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),0);
 const pay=await req(`/customer/bills/${made.bill.id}/pay`,{idempotencyKey:randomUUID()},f.token);assert.equal(pay.status,201,JSON.stringify(pay.data));const billing=app.get(BillingService),event={status:'SUCCEEDED',amount:50000,transactionId:'synthetic-'+pay.data.paymentId};await assert.rejects(billing.settle(pay.data.paymentId,{...event,amount:80000}));assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),0);await Promise.all([1,2].map(()=>billing.settle(pay.data.paymentId,event)));
 assert.equal(await db.swapCredit.count({where:{orderId:f.order.id}}),1);assert.equal(await db.swapLedger.count({where:{orderId:f.order.id,type:'GRANT'}}),1);const account=await req(`/customer/orders/${f.order.id}/swap-account`,undefined,f.token);assert.equal(account.status,200,JSON.stringify(account.data));assert.equal(account.data.term.available,0);assert.equal(account.data.paidAvailable,1);assert.equal(account.data.product.amount,50000);assert.equal(account.data.ledger[0].termSequence,null);
 assert.equal((await req('/admin/refunds',{paymentId:pay.data.paymentId,amount:25000,reason:'拒绝部分退款',idempotencyKey:randomUUID()})).status,409);
 const changeId=randomUUID();await db.serial(tx=>reserveCredit(tx,f.order,f.account,changeId,now));assert.equal((await req('/admin/refunds',{paymentId:pay.data.paymentId,amount:50000,reason:'拒绝预占退款',idempotencyKey:randomUUID()})).status,409);await db.serial(tx=>releaseCredits(tx,changeId));
 const refund=await req('/admin/refunds',{paymentId:pay.data.paymentId,amount:50000,reason:'合成全额例外退款',idempotencyKey:randomUUID()});assert.equal(refund.status,201,JSON.stringify(refund.data));assert.equal((await req('/admin/refunds/'+refund.data.id+'/approve',{},'ADMIN')).status,201);
 const success={status:'SUCCEEDED',paymentId:pay.data.paymentId,amount:50000,totalAmount:50000,providerRefundId:randomUUID()};await Promise.all([1,2].map(()=>billing.settleRefund(refund.data.id,success)));assert.equal((await req('/customer/swap-credit-purchases/'+made.purchase.id,undefined,f.token)).data.status,'REFUNDED');assert.equal(await db.swapLedger.count({where:{sourceKey:'swap-refund:'+refund.data.id}}),1);
});
test('OFFLINE total gate blocks new purchase/payment; original trusted receipt and historical v2 evidence remain available',async()=>{
 const f=await purchased(await fixture()),before=providerCalls;await db.order.update({where:{id:f.order.id},data:{contractMode:'OFFLINE'}});
 assert.equal((await req(`/customer/orders/${f.order.id}/swap-credits`,await input(f),f.token)).status,409);assert.equal((await req(`/customer/bills/${f.bill.id}/pay`,{idempotencyKey:randomUUID()},f.token)).status,409);assert.equal(providerCalls,before);
 const payment=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,amount:50000,idempotencyKey:randomUUID(),status:'PENDING'}});await app.get(BillingService).settle(payment.id,{status:'SUCCEEDED',amount:50000,transactionId:randomUUID()});
 const history=await req('/customer/swap-credit-purchases/'+f.purchase.id,undefined,f.token);assert.equal(history.status,200);assert.equal(history.data.amount,50000);assert.equal(history.data.policyVersion,'SWAP_TERM_V2');assert.equal(history.data.canPay,false);assert.equal(history.data.terms.templateContent,swapDoc.content);assert.equal(await db.swapCredit.count({where:{sourcePaymentId:payment.id}}),1);
});
