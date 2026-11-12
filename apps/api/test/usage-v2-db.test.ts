import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../src/common/db';
import {projectRoot} from '../src/common/config';
import {BillingService} from '../src/billing/billing';
import {snapshotUsagePolicy} from '../src/usage/policy';
import {freezeUsagePricing} from '../src/usage/pricing';
import {initializeUsage} from '../src/usage/rules';
import {UsageService,reviewUsageReading} from '../src/usage/usage.service';

const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
function isolatedDb(){
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test','Requires dedicated loopback usage test database');
 assert.ok(existsSync(resolve(projectRoot,'.runtime/mvp-api-tests.lock')),'Run only through the guarded API test runner');
 return new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
}
async function fixture(db:Db,km=2000,price=175,v1=false){
 const key=randomUUID(),type=v1?'usage-policy':'usage-policy-v2',content=v1?'仅合成历史固定里程政策':'仅合成：每服务月含 {{baseAllowanceKm}} 公里，超额 {{excessPriceYuan}} 元/公里，充换电费用自付。';
 const max=await db.legalDocument.aggregate({where:{type},_max:{version:true}});
 await db.legalDocument.create({data:{type,version:(max._max.version||0)+1,title:'合成用量规则，禁止真实交易',content,status:'PUBLISHED',confirmedBy:'synthetic-legal-reviewer',confirmedAt:new Date()}});
 const policy=await db.serial(tx=>snapshotUsagePolicy(tx,v1?undefined:{configurationVersion:2,mileagePerMonthKm:km,excessMileagePriceAmount:price}));
 const terms={months:12,startDate:'2026-01-31',firstDueDate:'2026-01-31',monthlyFeeAmount:400000,depositAmount:0,mileagePerMonthKm:km,excessMileagePriceAmount:price,usagePolicyVersion:policy.policyVersion,usagePolicy:policy};
 const customer=await db.customer.create({data:{mobile:'usage-v2-'+key,openId:key,name:'合成里程客户'}});
 const vehicle=await db.vehicle.create({data:{brand:'合成',model:'V2',title:'合成里程测试车',year:2026,city:'上海',mileageKm:1000,status:'IN_USE'}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'历史计划载体，仅测试用量',months:12,monthlyFeeAmount:400000,mileagePerMonthKm:km,excessMileagePriceAmount:price,energyDescription:'充换电费用自付',benefits:[],conditions:'仅合成',active:true}});
 const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],requestHash:key,idempotencyKey:key,status:'FINAL_PLAN_CONFIRMED'}});
 const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,confirmedMileageKm:1000,status:'ACTIVE',finalPlanSnapshot:terms}});
 await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:order.id}});
 await db.serial(tx=>initializeUsage(tx,order,{actualAt:new Date('2026-01-31T10:00:00+08:00'),readingKm:1000}));
 const account=await db.usageAccount.findUniqueOrThrow({where:{orderId:order.id},include:{periods:{orderBy:{sequence:'asc'}}}}),pricing=freezeUsagePricing(terms);
 assert.deepEqual(account.pricingSnapshot,pricing);assert.ok(account.periods.every(p=>JSON.stringify(p.pricingSnapshot)===JSON.stringify(account.pricingSnapshot)));
 let now=new Date('2026-01-31T04:00:00Z');const service=new UsageService(db,()=>now);
 return{db,customer,vehicle,plan,order,account,pricing,service,setNow:(value:Date)=>now=value};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function paidPack(f:Fixture){
 const {db,customer,order,service}=f,max=await db.legalDocument.aggregate({where:{type:'mileage-pack'},_max:{version:true}});
 await db.legalDocument.create({data:{type:'mileage-pack',version:(max._max.version||0)+1,title:'仅合成里程包规则',content:'本订阅期有效，退订失效，依法处理退款争议。',status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'synthetic-reviewer'}});
 const product=await db.mileagePackProduct.create({data:{id:randomUUID(),version:1,km:300,amount:30000}}),view=await service.account(order.id,customer.id),terms=view.purchaseTerms!;
 const purchase=await service.purchase(order.id,customer.id,{productId:product.id,termsVersion:terms.version,termsDocumentId:terms.documentId,termsDocumentVersion:terms.documentVersion,termsHash:terms.hash,accepted:true,idempotencyKey:randomUUID()});
 const payment=await db.payment.create({data:{billId:purchase.bill.id,customerId:customer.id,amount:purchase.bill.amount,status:'PENDING',idempotencyKey:randomUUID()}});
 const gateway=new Proxy({},{get(){return()=>{throw new Error('Real payment provider is forbidden in usage fixture');};}});
 const receipt=await new BillingService(db,gateway as any).settle(payment.id,{status:'SUCCEEDED',amount:purchase.bill.amount,transactionId:'synthetic-'+payment.id});assert.equal(receipt.reconciliationRequired,false);
 return db.mileagePurchase.findUniqueOrThrow({where:{id:purchase.purchase.id}});
}
async function ready(f:Fixture){
 f.setNow(new Date('2026-02-28T04:00:00Z'));
 const period=f.account.periods[0],file=await f.db.storedFile.create({data:{customerId:f.customer.id,name:'合成仪表.jpg',mimeType:'image/jpeg',size:8,sha256:randomUUID(),storagePath:'synthetic-no-file',purpose:'mileage'}});
 const reading=await f.service.submit(period.id,f.customer.id,{readingKm:4000,recordedAt:'2026-02-28T08:00:00+08:00',fileIds:[file.id],idempotencyKey:randomUUID()});
 await f.db.serial(tx=>reviewUsageReading(tx,reading,{decision:'APPROVED',note:'合成月界照片核验',boundaryConfirmed:true},'synthetic-reviewer'));
 return f.db.usagePeriod.findUniqueOrThrow({where:{id:period.id}});
}

test('isolated database: v2 frozen prices survive catalog edits and concurrent settlement creates one exact bill',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=isolatedDb();try{
  const f=await fixture(db),pack=await paidPack(f);assert.equal(pack.remainingKm,300);
  await db.subscriptionPlan.update({where:{id:f.plan.id},data:{mileagePerMonthKm:9999,excessMileagePriceAmount:999}});
  const period=await ready(f),view=await f.service.account(f.order.id,f.customer.id);assert.equal(view.baseAllowanceKm,2000);assert.equal(view.excessPriceAmount,175);assert.ok(view.periods.every(p=>p.baseAllowanceKm===2000&&p.excessPriceAmount===175&&p.policyVersion==='USAGE_V2'));
  const command={revision:period.revision,idempotencyKey:randomUUID()},results=await Promise.all([f.service.settle(period.id,command,'synthetic-finance'),f.service.settle(period.id,command,'synthetic-finance')]);assert.equal(results[0].billId,results[1].billId);assert.equal(results[0].baseUsedKm,2000);assert.equal(results[0].packUsedKm,300);assert.equal(results[0].excessKm,700);assert.equal(results[0].excessAmount,122500);
  assert.equal((await db.bill.findUniqueOrThrow({where:{id:results[0].billId}})).amount,122500);assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS'}}),1);assert.equal(await db.mileageLedger.count({where:{periodId:period.id,type:'CONSUME'}}),1);
  assert.deepEqual((await db.usageAccount.findUniqueOrThrow({where:{id:f.account.id}})).pricingSnapshot,f.pricing);assert.deepEqual((await db.usagePeriod.findUniqueOrThrow({where:{id:period.id}})).pricingSnapshot,f.pricing);
 }finally{await db.$disconnect();}
});

test('isolated database: explicit zero prices and historical v1 null snapshots retain their own settlement rules',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=isolatedDb();try{
  for(const [km,price,v1,amount]of [[0,0,false,0],[1500,150,true,225000]] as const){
   const f=await fixture(db,km,price,v1);if(v1){await db.usageAccount.update({where:{id:f.account.id},data:{pricingSnapshot:Prisma.DbNull}});await db.usagePeriod.updateMany({where:{accountId:f.account.id},data:{pricingSnapshot:Prisma.DbNull}});}
   const period=await ready(f),result=await f.service.settle(period.id,{revision:period.revision,idempotencyKey:randomUUID()},'synthetic-finance');assert.equal(result.baseUsedKm,km);assert.equal(result.excessAmount,amount);assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS'}}),amount?1:0);
   if(v1){assert.equal((await db.usageAccount.findUniqueOrThrow({where:{id:f.account.id}})).pricingSnapshot,null);assert.equal((await db.usagePeriod.findUniqueOrThrow({where:{id:period.id}})).pricingSnapshot,null);}
  }
 }finally{await db.$disconnect();}
});

test('isolated database: missing and forged v2 snapshots reject views and settlement without changing the period',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=isolatedDb();try{
  for(const record of ['account','period'] as const)for(const missing of [true,false]){
   const f=await fixture(db),period=await ready(f),pricingSnapshot=missing?Prisma.DbNull:{...f.pricing,sourceHash:'f'.repeat(64)};
   if(record==='account')await db.usageAccount.update({where:{id:f.account.id},data:{pricingSnapshot}});else await db.usagePeriod.update({where:{id:period.id},data:{pricingSnapshot}});
   await assert.rejects(f.service.account(f.order.id,f.customer.id),code('USAGE_PRICING'));await assert.rejects(f.service.settle(period.id,{revision:period.revision,idempotencyKey:randomUUID()},'synthetic-finance'),code('USAGE_PRICING'));
   const after=await db.usagePeriod.findUniqueOrThrow({where:{id:period.id}});assert.equal(after.status,'READY');assert.equal(after.revision,period.revision);assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS'}}),0);assert.equal(await db.mileageLedger.count({where:{periodId:period.id}}),0);
  }
 }finally{await db.$disconnect();}
});

test('isolated database: excess overflow rolls back pack consumption, period state and all fees',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=isolatedDb();try{
  const f=await fixture(db,0,2147483647),pack=await paidPack(f),period=await ready(f);
  await assert.rejects(f.service.settle(period.id,{revision:period.revision,idempotencyKey:randomUUID()},'synthetic-finance'),code('USAGE_AMOUNT_OVERFLOW'));
  assert.equal((await db.mileagePurchase.findUniqueOrThrow({where:{id:pack.id}})).remainingKm,300);assert.equal(await db.mileageLedger.count({where:{periodId:period.id}}),0);assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS'}}),0);const after=await db.usagePeriod.findUniqueOrThrow({where:{id:period.id}});assert.equal(after.status,'READY');assert.equal(after.revision,period.revision);
 }finally{await db.$disconnect();}
});
