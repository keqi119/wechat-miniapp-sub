import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';
import {snapshotUsagePolicy,usagePolicyAppendix,usageRules} from '../src/usage/policy';
import {initializeUsage} from '../src/usage/rules';
import {readHandoverCompletion} from '../src/orders/order-process-handover';

const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const template='每服务月含 {{baseAllowanceKm}} 公里，超额 {{excessPriceYuan}} 元/公里（{{excessPriceAmount}} 分）。充换电费用自付。';
const doc=(content=template)=>({id:'usage-v2-template',type:'usage-policy-v2',version:3,status:'PUBLISHED',confirmedBy:'legal-reviewer',confirmedAt:new Date(),content});
const product=(km=2200,price=175)=>({configurationVersion:2,mileagePerMonthKm:km,excessMileagePriceAmount:price,energyDescription:'充换电费用自付'});
async function policy(km=2200,price=175){return (snapshotUsagePolicy as any)({legalDocument:{findFirst:async()=>doc()}},product(km,price));}
async function pricing(){const m:any=await import('../src/usage/pricing').catch(()=>({}));assert.equal(typeof m.freezeUsagePricing,'function');return m;}

test('no-product invocation preserves the exact historical v1 snapshot and appendix',async()=>{
 const oldDoc={...doc('历史固定规则'),type:'usage-policy'},result=await snapshotUsagePolicy({legalDocument:{findFirst:async({where}:any)=>{assert.equal(where.type,'usage-policy');return oldDoc;}}} as any);
 assert.deepEqual(result,{...usageRules,documentId:oldDoc.id,documentVersion:oldDoc.version,hash:hash(oldDoc.content),content:oldDoc.content});assert.match(usagePolicyAppendix(result),/历史固定规则/);
 for(const oldProduct of [{mileagePerMonthKm:1500,excessMileagePriceAmount:150},{configurationVersion:1,mileagePerMonthKm:1500,excessMileagePriceAmount:150}])assert.deepEqual(await snapshotUsagePolicy({legalDocument:{findFirst:async()=>oldDoc}} as any,oldProduct),result);
});

test('v2 freezes approved original template and exact rendered cents without changing its self-paid energy text',async()=>{
 const queries:any[]=[];const result=await (snapshotUsagePolicy as any)({legalDocument:{findFirst:async(q:any)=>{queries.push(q);return doc();}}},product());
 assert.equal(queries[0].where.type,'usage-policy-v2');assert.equal(result.policyVersion,'USAGE_V2');assert.equal(result.baseAllowanceKm,2200);assert.equal(result.excessPriceAmount,175);
 assert.equal(result.templateContent,template);assert.equal(result.templateHash,hash(template));assert.equal(result.content,'每服务月含 2200 公里，超额 1.75 元/公里（175 分）。充换电费用自付。');assert.equal(result.hash,hash(result.content));assert.match(usagePolicyAppendix(result),/1\.75 元/);
 for(const [km,price,text]of [[0,0,'0.00'],[0,1,'0.01'],[2147483647,2147483647,'21474836.47']] as const){const p=await policy(km,price);assert.equal(p.baseAllowanceKm,km);assert.equal(p.excessPriceAmount,price);assert.ok(p.content.includes(text));assert.doesNotThrow(()=>usagePolicyAppendix(p));}
});

test('unapproved templates, missing placeholders, invalid amounts and unsupported versions cannot produce v2 policy',async()=>{
 for(const invalid of [null,{...doc(),status:'DRAFT'},{...doc(),confirmedBy:null},{...doc(),confirmedAt:null},doc('固定1500公里'),doc('{{baseAllowanceKm}} {{other}}'),doc('{{baseAllowanceKm}} {{excessPriceYuan}} {{unknown}}')])await assert.rejects((snapshotUsagePolicy as any)({legalDocument:{findFirst:async()=>invalid}},product()));
 for(const key of ['mileagePerMonthKm','excessMileagePriceAmount'])for(const value of [-1,1.5,2147483648,NaN,'100',null,undefined])await assert.rejects((snapshotUsagePolicy as any)({legalDocument:{findFirst:async()=>doc()}},{...product(),[key]:value}));
 await assert.rejects((snapshotUsagePolicy as any)({legalDocument:{findFirst:async()=>doc()}},{...product(),configurationVersion:99}));
});

test('v2 appendix verifies both original and substituted body, including recalculated-body tampering',async()=>{
 const p=await policy();
 for(const changed of [{...p,content:'修改后的正文'},{...p,content:'修改后的正文',hash:hash('修改后的正文')},{...p,templateContent:'修改原文'},{...p,templateHash:'a'.repeat(64)},{...p,baseAllowanceKm:0},{...p,excessPriceAmount:0}])assert.throws(()=>usagePolicyAppendix(changed),error('USAGE_POLICY'));
});

test('initialization freezes matching account and period prices anchored to original order policy, including zero values',async()=>{
 const m=await pricing();
 for(const [km,price]of [[2200,175],[0,0]]){
  const p=await policy(km,price),terms={startDate:'2026-01-31',months:2,mileagePerMonthKm:km,excessMileagePriceAmount:price,usagePolicyVersion:'USAGE_V2',usagePolicy:p};
  const order={id:'order',customerId:'customer',finalPlanSnapshot:terms},saved:any[]=[];const tx:any={usageAccount:{findUnique:async()=>null,create:async({data}:any)=>{saved.push(data);return data;}}};
  await initializeUsage(tx,order,{actualAt:new Date('2026-01-31T10:00:00+08:00'),readingKm:100});
  const expected={policyVersion:'USAGE_V2',baseAllowanceKm:km,excessPriceAmount:price,sourceHash:canonicalHash(p)};assert.deepEqual(m.freezeUsagePricing(terms),expected);assert.deepEqual(saved[0].pricingSnapshot,expected);assert.equal(saved[0].policyVersion,'USAGE_V2');assert.equal(saved[0].periods.create.length,2);assert.ok(saved[0].periods.create.every((row:any)=>canonicalHash(row.pricingSnapshot)===canonicalHash(expected)));
  assert.deepEqual(saved[0].periods.create.map((row:any)=>[row.startDate.toISOString().slice(0,10),row.endDate.toISOString().slice(0,10)]),[['2026-01-31','2026-02-28'],['2026-02-28','2026-03-31']]);
 }
});

test('record pricing must match original order policy; JSONB key order is harmless and historical v1 null stays readable',async()=>{
 const m=await pricing(),p=await policy(),terms={mileagePerMonthKm:2200,excessMileagePriceAmount:175,usagePolicyVersion:'USAGE_V2',usagePolicy:p},order={id:'order',customerId:'customer',finalPlanSnapshot:terms},frozen=m.freezeUsagePricing(terms);
 const account={id:'account',orderId:'order',customerId:'customer',policyVersion:'USAGE_V2',pricingSnapshot:frozen},period={accountId:'account',orderId:'order',pricingSnapshot:frozen};
 assert.deepEqual(m.resolveUsagePricing(order,account,period),frozen);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 assert.deepEqual(m.resolveUsagePricing({...order,finalPlanSnapshot:reorder(terms)},account,period),frozen);
 for(const bad of [null,{...frozen,sourceHash:'b'.repeat(64)},{...frozen,baseAllowanceKm:1500},{...frozen,excessPriceAmount:150},{...frozen,policyVersion:'USAGE_V1'}]){assert.throws(()=>m.resolveUsagePricing(order,{...account,pricingSnapshot:bad},period));assert.throws(()=>m.resolveUsagePricing(order,account,{...period,pricingSnapshot:bad}));}
 for(const bad of [{...account,orderId:'another-order'},{...account,customerId:'another-customer'},{...account,policyVersion:'USAGE_V1'}])assert.throws(()=>m.resolveUsagePricing(order,bad,period));
 for(const bad of [{...period,orderId:'another-order'},{...period,accountId:'another-account'}])assert.throws(()=>m.resolveUsagePricing(order,account,bad));
 const oldPolicy={...usageRules,documentId:'old',documentVersion:1,content:'旧政策',hash:hash('旧政策')},oldTerms={mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy:oldPolicy},oldOrder={...order,finalPlanSnapshot:oldTerms},oldAccount={...account,policyVersion:'USAGE_V1',pricingSnapshot:null},oldPeriod={...period,pricingSnapshot:null};
 assert.equal(m.resolveUsagePricing(oldOrder,oldAccount,oldPeriod).baseAllowanceKm,1500);assert.equal(m.resolveUsagePricing(oldOrder,oldAccount,oldPeriod).excessPriceAmount,150);assert.equal(oldAccount.pricingSnapshot,null);assert.equal(oldPeriod.pricingSnapshot,null);
});

test('integer-cent excess calculation is exact at the database limit and rejects overflow',async()=>{
 const m=await pricing();assert.equal(m.usageExcessAmount(700,175),122500);assert.equal(m.usageExcessAmount(2147483647,0),0);assert.equal(m.usageExcessAmount(1,2147483647),2147483647);
 for(const pair of [[2,2147483647],[2147483647,2147483647]])assert.throws(()=>m.usageExcessAmount(...pair),error('USAGE_AMOUNT_OVERFLOW'));
 for(const pair of [[-1,1],[1.5,1],[NaN,1],[1,-1],[1,1.5]])assert.throws(()=>m.usageExcessAmount(...pair));
});

test('delivery preview accepts valid v2 pricing and rejects altered effective policy without creating an account',async()=>{
 const p=await policy(),snapshot={startDate:'2026-01-31',months:12,mileagePerMonthKm:2200,excessMileagePriceAmount:175,usagePolicyVersion:'USAGE_V2',usagePolicy:p};
 const now=new Date('2026-01-31T08:00:00Z'),order={id:'order',customerId:'customer',contractMode:'ESIGN',status:'AWAITING_HANDOVER',confirmedMileageKm:100,finalPlanSnapshot:snapshot};
 const f={order,snapshot,now,vehicle:{reservedOrderId:'order',status:'RESERVED',mileageKm:100},usage:null,changes:[],archives:[]},h={type:'DELIVERY',customerId:'customer',executionMode:'ESIGN',readingKm:100,actualAt:now};
 const tx={order:{findUnique:async()=>order},vehicleOperationalRestriction:{count:async()=>0}};
 assert.deepEqual(await readHandoverCompletion(tx,f,h),{ready:true,blockers:[]});
 const altered=await policy(3000,175),changed={...snapshot,mileagePerMonthKm:3000,usagePolicy:altered};
 const result=await readHandoverCompletion(tx,{...f,snapshot:changed},h);assert.equal(result.ready,false);assert.ok(result.blockers.some(b=>b.code==='USAGE_POLICY'));
 const legacy={...usageRules,documentId:'old-policy',documentVersion:1,content:'旧条款',hash:hash('旧条款')},oldSnapshot={...snapshot,mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy:legacy};
 assert.deepEqual(await readHandoverCompletion(tx,{...f,order:{...order,finalPlanSnapshot:oldSnapshot},snapshot:oldSnapshot},h),{ready:true,blockers:[]});
});
