import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';
import {usageRules} from '../src/usage/policy';
import {UsageService} from '../src/usage/usage.service';
import {UsageController} from '../src/usage/usage.controller';

const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
function fixture(km=2000,price=175,version='USAGE_V2'){
 const template='每服务月含 {{baseAllowanceKm}} 公里，超额 {{excessPriceYuan}} 元/公里。充换电自付。',content=`每服务月含 ${km} 公里，超额 ${Math.floor(price/100)}.${String(price%100).padStart(2,'0')} 元/公里。充换电自付。`;
 const policy:any={...usageRules,policyVersion:version,baseAllowanceKm:km,excessPriceAmount:price,documentId:'frozen-policy',documentVersion:2,content,hash:hash(content),...(version==='USAGE_V2'?{templateContent:template,templateHash:hash(template)}:{})};
 const terms={startDate:'2026-01-31',months:12,mileagePerMonthKm:km,excessMileagePriceAmount:price,usagePolicyVersion:version,usagePolicy:policy};
 const order:any={id:'order',customerId:'customer',vehicleId:'vehicle',status:'ACTIVE',confirmedMileageKm:1000,finalPlanSnapshot:terms};
 const pricing={policyVersion:version,baseAllowanceKm:km,excessPriceAmount:price,sourceHash:canonicalHash(policy)};
 const account:any={id:'account',orderId:order.id,customerId:order.customerId,policyVersion:version,pricingSnapshot:version==='USAGE_V2'?pricing:null,startedOn:new Date('2026-01-31'),returnedOn:null,packStatus:'ACTIVE',order,purchases:[],ledger:[],settlement:null};
 const period:any={id:'period',orderId:order.id,accountId:account.id,sequence:1,revision:2,status:'READY',startDate:new Date('2026-01-31'),endDate:new Date('2026-02-28'),effectiveEndDate:new Date('2026-02-28'),startReadingKm:1000,endReadingKm:4000,readingId:'reading',pricingSnapshot:version==='USAGE_V2'?{...pricing}:null,account};account.periods=[period];
 const pack:any={id:'pack',status:'ACTIVE',remainingKm:300,applicableFromSequence:1},bills:any[]=[],ledger:any[]=[],audits:any[]=[];let receipt:any=null,refundPending=false;
 const tx:any={
  order:{update:async()=>order},usageAccount:{findFirst:async()=>account,findUnique:async()=>account,update:async()=>account},
  usagePeriod:{findUnique:async()=>period,findUniqueOrThrow:async()=>period,count:async()=>0,update:async({data}:any)=>{const {revision,...rest}=data;Object.assign(period,rest);if(revision)period.revision+=revision.increment;return period;}},
  vehicleReceiptEvent:{findFirst:async()=>receipt},legalDocument:{findFirst:async()=>null},vehicleAssignment:{count:async()=>1,findMany:async()=>[]},usageSegment:{findMany:async()=>[]},orderChange:{findFirst:async()=>null},
  mileagePurchase:{count:async()=>refundPending?1:0,findMany:async({where}:any)=>where.status==='ACTIVE'&&pack.remainingKm>0?[pack]:[],update:async({data}:any)=>{pack.remainingKm-=data.remainingKm.decrement;return pack;}},
  mileageLedger:{create:async({data}:any)=>{ledger.push(data);return data;}},bill:{create:async({data}:any)=>{const bill={id:'bill-'+bills.length,...data};bills.push(bill);return bill;}},mileage:{findUniqueOrThrow:async()=>({fileIds:['verified-reading-file']})},mileagePackProduct:{findMany:async()=>[]},
  vehicle:{findUniqueOrThrow:async()=>({id:'vehicle',reservedOrderId:'order',status:'IN_USE',mileageKm:1000}),update:async()=>({})},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  productVersion:new Proxy({},{get(){throw Error('Settlement must never read current products');}}),subscriptionPlan:new Proxy({},{get(){throw Error('Settlement must never read catalog prices');}})
 };
 const service=new UsageService({serial:async(fn:any)=>fn(tx)} as any,()=>new Date('2026-02-28T08:00:00Z'));
 return{service,tx,order,account,period,pack,bills,ledger,audits,pricing,setReceipt:(v:any)=>receipt=v,setRefundPending:()=>{refundPending=true;}};
}

test('v2 account and every period expose frozen prices; actual settlement consumes base then packs then exact nondefault excess once',async()=>{
 const f=fixture(),view=await f.service.account('order','customer');assert.equal(view.policyVersion,'USAGE_V2');assert.equal(view.baseAllowanceKm,2000);assert.equal(view.excessPriceAmount,175);assert.equal(view.periods[0].policyVersion,'USAGE_V2');assert.equal(view.periods[0].baseAllowanceKm,2000);assert.equal(view.periods[0].excessPriceAmount,175);assert.equal('sourceHash' in view.periods[0],false);
 const command={revision:2,idempotencyKey:'settlement-command'},result=await f.service.settle('period',command,'finance');
 assert.equal(result.baseUsedKm,2000);assert.equal(result.packUsedKm,300);assert.equal(result.excessKm,700);assert.equal(result.excessAmount,122500);assert.equal(f.bills[0].amount,122500);assert.match(f.bills[0].description,/700公里×175分/);assert.equal(f.ledger.length,1);
 assert.deepEqual(await f.service.settle('period',command,'finance'),result);assert.equal(f.bills.length,1);assert.equal(f.ledger.length,1);assert.equal(f.audits.length,1);await assert.rejects(f.service.settle('period',{...command,idempotencyKey:'different-command'},'finance'),code('IDEMPOTENCY_CONFLICT'));
});

test('zero included mileage and zero excess price are explicit values, while v1 null snapshots retain 1500/150',async()=>{
 const zero=fixture(0,0),z=await zero.service.settle('period',{revision:2,idempotencyKey:'zero-price-command'},'finance');assert.equal(z.baseUsedKm,0);assert.equal(z.packUsedKm,300);assert.equal(z.excessKm,2700);assert.equal(z.excessAmount,0);assert.equal(zero.bills.length,0);
 const old=fixture(1500,150,'USAGE_V1'),v=await old.service.settle('period',{revision:2,idempotencyKey:'old-price-command'},'finance');assert.equal(v.baseUsedKm,1500);assert.equal(v.excessAmount,180000);assert.equal(old.account.pricingSnapshot,null);assert.equal(old.period.pricingSnapshot,null);
});

test('missing or forged period/account prices never display or create a settlement bill',async()=>{
 for(const record of ['account','period'] as const)for(const bad of [null,{policyVersion:'USAGE_V2',baseAllowanceKm:2000,excessPriceAmount:175,sourceHash:'f'.repeat(64)}]){
  const f=fixture();f[record].pricingSnapshot=bad;await assert.rejects(f.service.account('order','customer'));await assert.rejects(f.service.settle('period',{revision:2,idempotencyKey:'bad-price-command'},'finance'));assert.equal(f.bills.length,0);assert.equal(f.ledger.length,0);assert.equal(f.period.status,'READY');
 }
 const changed=fixture();changed.order.effectiveTermsVersionId='unapproved-usage-change';changed.tx.orderTermsVersion={findFirst:async()=>({snapshot:{...changed.order.finalPlanSnapshot,mileagePerMonthKm:3000}})};
 await assert.rejects(changed.service.account('order','customer'));await assert.rejects(changed.service.settle('period',{revision:2,idempotencyKey:'changed-price-command'},'finance'));assert.equal(changed.bills.length,0);
});

test('excess overflow rejects before a bill and existing reading, physical-return and refund gates remain effective',async()=>{
 const overflow=fixture(0,2147483647);await assert.rejects(overflow.service.settle('period',{revision:2,idempotencyKey:'overflow-command'},'finance'),code('USAGE_AMOUNT_OVERFLOW'));assert.equal(overflow.bills.length,0);assert.equal(overflow.period.status,'READY');
 const pending=fixture();pending.setRefundPending();await assert.rejects(pending.service.settle('period',{revision:2,idempotencyKey:'refund-pending-command'},'finance'),code('PACK_REFUND_PENDING'));
 const reading=fixture();reading.period.endReadingKm=null;await assert.rejects(reading.service.settle('period',{revision:2,idempotencyKey:'missing-reading-command'},'finance'),code('PERIOD_NOT_READY'));
 const physical=fixture();physical.setReceipt({receivedAt:new Date('2026-01-30T00:00:00+08:00')});await assert.rejects(physical.service.settle('period',{revision:2,idempotencyKey:'physical-return-command'},'finance'),code('PHYSICAL_RETURN_BILL_PAUSED'));
});

test('admin list and detail disclose the same verified period prices without hash or account data',async()=>{
 const f=fixture();f.tx.usagePeriod.findMany=async()=>[f.period];f.tx.usagePeriod.count=async()=>1;
 const controller=new UsageController(f.tx,f.service,()=>new Date('2026-02-28T08:00:00Z'));
 for(const role of ['FINANCE','OPERATIONS','SUPPORT']){
  const request={admin:{role}},list=await controller.periods({page:1,pageSize:10},request),detail=await controller.period('period',request);
  assert.deepEqual(list.items[0],detail);assert.equal(detail.policyVersion,'USAGE_V2');assert.equal(detail.baseAllowanceKm,2000);assert.equal(detail.excessPriceAmount,175);assert.equal('sourceHash' in detail,false);assert.equal('pricingSnapshot' in detail,false);assert.equal('account' in detail,false);assert.equal(detail.canSettle,role==='FINANCE');assert.equal(detail.canRequestEvidence,role==='OPERATIONS');
 }
 f.period.pricingSnapshot.sourceHash='0'.repeat(64);await assert.rejects(controller.periods({},{}),code('USAGE_PRICING'));await assert.rejects(controller.period('period',{}),code('USAGE_PRICING'));
});
