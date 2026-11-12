import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {usageRules} from '../src/usage/policy';
import {UsageService} from '../src/usage/usage.service';
import {voidUnpaidQuotes} from '../src/usage/ledger';

const date=(value:string)=>new Date(value+'T00:00:00Z');
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;
function fixture(sequence=25,previousSequence=12){
 const policy={...usageRules,documentId:'original-policy',documentVersion:1,content:'原期已确认规则',hash:hash('原期已确认规则')};
 const order:any={id:'order',customerId:'customer',vehicleId:'car',status:'SETTLING',finalPlanSnapshot:{usagePolicy:policy,usagePolicyVersion:'USAGE_V1',mileagePerMonthKm:1500,excessMileagePriceAmount:150}};
 const account:any={id:'account',orderId:order.id,customerId:order.customerId,order,policyVersion:'USAGE_V1',pricingSnapshot:null,returnedOn:null,packStatus:'ACTIVE'};
 const previous:any={id:'previous',accountId:account.id,orderId:order.id,sequence:previousSequence,status:'SETTLED',startDate:date('2027-01-31'),endDate:date('2027-02-28'),effectiveEndDate:date('2027-02-28'),endReadingKm:4000};
 const current:any={id:'current',accountId:account.id,orderId:order.id,account,sequence,revision:0,status:'READY',startDate:date('2027-02-28'),endDate:date('2027-03-31'),effectiveEndDate:date('2027-03-31'),endReadingKm:6000,startReadingKm:null,readingId:'reading',pricingSnapshot:null};
 const cancelled:any[]=[];for(let n=previousSequence+1;n<sequence;n++)cancelled.push({id:'cancelled-'+n,accountId:account.id,orderId:order.id,sequence:n,status:'CANCELLED',endReadingKm:null});
 const periods=[previous,...cancelled,current],bills:any[]=[],purchases:any[]=[],audits:any[]=[];
 let unknownPayment=false;
 const match=(row:any,where:any)=>{
  if(where.accountId&&row.accountId!==where.accountId||where.orderId&&row.orderId!==where.orderId)return false;
  if(where.sequence?.lt!=null&&row.sequence>=where.sequence.lt)return false;
  if(where.status?.not&&row.status===where.status.not||where.status?.notIn?.includes(row.status))return false;
  return true;
 };
 const tx:any={
  order:{update:async()=>order},usageAccount:{findUnique:async()=>account,update:async({data}:any)=>{if(data.packStatus)account.packStatus=data.packStatus;return account;}},
  usagePeriod:{findUnique:async()=>current,findUniqueOrThrow:async({where}:any)=>{const p=periods.find(r=>r.sequence===where.orderId_sequence.sequence);assert.ok(p,'requested existing real month');return p;},findFirst:async({where}:any)=>periods.filter(p=>match(p,where)).sort((a,b)=>b.sequence-a.sequence)[0]??null,count:async({where}:any)=>periods.filter(p=>match(p,where)).length,update:async({data}:any)=>{Object.assign(current,{...data,revision:current.revision+data.revision.increment});return current;}},
  vehicleReceiptEvent:{findFirst:async()=>null},orderChange:{findFirst:async()=>null},vehicleAssignment:{count:async()=>1},usageSegment:{findMany:async()=>[]},
  mileagePurchase:{count:async()=>0,findMany:async({where}:any)=>purchases.filter(p=>p.status===where.status&&(where.applicableFromSequence?.lte==null||p.applicableFromSequence<=where.applicableFromSequence.lte)),update:async({where,data}:any)=>Object.assign(purchases.find(p=>p.id===where.id),data)},
  payment:{count:async()=>unknownPayment?1:0},bill:{create:async({data}:any)=>{const b={id:'excess',...data};bills.push(b);return b;},update:async({where,data}:any)=>{bills.push({id:where.id,...data});return data;}},mileage:{findUniqueOrThrow:async()=>({fileIds:['real-boundary-photo']})},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},returnSettlement:{updateMany:async()=>({count:1})}
 };
 const service=new UsageService({serial:async(fn:any)=>fn(tx)} as any,()=>new Date('2027-03-31T04:00:00Z'));
 return{tx,service,order,account,current,previous,cancelled,periods,bills,purchases,audits,setUnknownPayment:()=>{unknownPayment=true;}};
}
const command={revision:0,idempotencyKey:'real-stage-settlement'};

test('settlement follows the actual preceding service month across cancelled global numbers',async()=>{
 const f=fixture(),before=JSON.stringify(f.cancelled);const result=await f.service.settle('current',command,'finance');
 assert.equal(result.startReadingKm,4000);assert.equal(result.usedKm,2000);assert.equal(result.excessAmount,75000);assert.equal(f.bills[0].sequence,25);assert.equal(JSON.stringify(f.cancelled),before);
 assert.deepEqual(await f.service.settle('current',command,'finance'),result);assert.equal(f.bills.length,1);assert.equal(f.audits.length,1);
});

test('unused reserved numbers need no invented month, while a real unfinished prior month still blocks',async()=>{
 const f=fixture();f.periods.splice(1,f.cancelled.length);assert.equal((await f.service.settle('current',command,'finance')).usedKm,2000);
 const pending=fixture();pending.previous.status='READY';await assert.rejects(pending.service.settle('current',command,'finance'),code('MISSING_PRIOR_READING'));assert.equal(pending.bills.length,0);
});

test('a skipped number cannot conceal a missing, overlapping or truncated date boundary',async()=>{
 for(const end of ['2027-02-27','2027-03-01']){const f=fixture(13,12);f.previous.endDate=date(end);f.previous.effectiveEndDate=date(end);await assert.rejects(f.service.settle('current',command,'finance'),code('USAGE_PERIOD_CONTINUITY'));assert.equal(f.bills.length,0);assert.equal(f.current.status,'READY');}
 const truncated=fixture(13,12);truncated.previous.effectiveEndDate=date('2027-02-26');await assert.rejects(truncated.service.settle('current',command,'finance'),code('USAGE_PERIOD_CONTINUITY'));
 const missing=fixture();missing.periods.splice(0,missing.periods.length-1);await assert.rejects(missing.service.settle('current',command,'finance'),code('USAGE_PERIOD_CONTINUITY'));
});

test('actual return settlement voids unpaid mileage purchases after global month 120 without altering paid credits',async()=>{
 const f=fixture(132,131);f.account.returnedOn=date('2027-03-31');
 f.purchases.push({id:'unpaid',accountId:'account',billId:'pack-bill',status:'PENDING_PAYMENT',applicableFromSequence:132},{id:'paid',accountId:'account',status:'REFUNDED',applicableFromSequence:131,remainingKm:0});
 await f.service.settle('current',command,'finance');assert.equal(f.purchases[0].status,'VOID');assert.equal(f.purchases[1].status,'REFUNDED');assert.equal(f.bills.find(b=>b.id==='pack-bill')?.status,'VOID');
});

test('unbounded final cleanup covers all pending quotes but still rejects unknown real payments',async()=>{
 const f=fixture();f.purchases.push({id:'later',accountId:'account',billId:'later-bill',status:'PENDING_PAYMENT',applicableFromSequence:241});
 await voidUnpaidQuotes(f.tx,'account',undefined as any);assert.equal(f.purchases[0].status,'VOID');
 const blocked=fixture();blocked.purchases.push({id:'later',accountId:'account',billId:'later-bill',status:'PENDING_PAYMENT',applicableFromSequence:241});blocked.setUnknownPayment();await assert.rejects(voidUnpaidQuotes(blocked.tx,'account',undefined as any),code('PACK_PAYMENT_PENDING'));assert.equal(blocked.purchases[0].status,'PENDING_PAYMENT');assert.equal(blocked.bills.length,0);
});

test('normal monthly cleanup retains future unpaid purchases and only voids elapsed applicable quotes',async()=>{
 const f=fixture();f.purchases.push({id:'old',accountId:'account',billId:'old-bill',status:'PENDING_PAYMENT',applicableFromSequence:24},{id:'next',accountId:'account',billId:'next-bill',status:'PENDING_PAYMENT',applicableFromSequence:26});
 await voidUnpaidQuotes(f.tx,'account',25);assert.equal(f.purchases[0].status,'VOID');assert.equal(f.purchases[1].status,'PENDING_PAYMENT');
});
