import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newOrderContractMode} from '../src/offline-documents/mode';
import {newHandoverMode} from '../src/operations/online-handover';
import {applicationView} from '../src/applications/applications';
import {fixtureUsagePolicy} from './usage-fixtures';
import {initializeUsage} from '../src/usage/rules';
test('new electronic mode uses online records and hides unapproved quote',async()=>{
 assert.equal(newOrderContractMode({NEW_ORDER_CONTRACT_MODE:'ELECTRONIC'}),'ELECTRONIC');
 assert.deepEqual(await newHandoverMode({legalDocument:{findFirst:async()=>({id:'terms',version:1,title:'约定',content:'约定',confirmedBy:'admin',confirmedAt:new Date()})}} as any,'ELECTRONIC'),{confirmationMode:'ONLINE_RECORD'});
 const v=applicationView({status:'IN_REVIEW',finalPlans:[{contractMode:'ELECTRONIC',reviewStatus:'DRAFT'}]});assert.equal(v.finalPlan,null);
});
test('electronic usage starts on actual Shanghai delivery day without rewriting signed plan',async()=>{
 const policy=fixtureUsagePolicy;
 const plan={startDate:'2026-11-10',months:3,mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy:policy};
 const order:any={id:'order',customerId:'customer',contractMode:'ELECTRONIC',finalPlanSnapshot:plan,serviceAnchor:{firstStartDay:'2026-11-12',anchorDay:12,ruleVersion:'V31'}};
 const tx:any={usageAccount:{findUnique:async()=>null,create:async(v:any)=>v.data}};
 const realNow=Date.now;Date.now=()=>new Date('2026-11-12T02:00:00Z').getTime();
 let result:any;try{result=await initializeUsage(tx,order,{id:'delivery',actualAt:new Date('2026-11-12T01:00:00Z'),readingKm:200});}finally{Date.now=realNow;}
 assert.equal(result.startedOn.toISOString().slice(0,10),'2026-11-12');assert.equal(result.periods.create[0].endDate.toISOString().slice(0,10),'2026-12-12');assert.equal(plan.startDate,'2026-11-10');
});

import {assertAgreedFeeComponents} from '../src/electronic-documents/initial-terms';
test('adjusted fees require genuine agreed integer components rather than standard fallback',()=>{
 const p={baseFeeAmount:8000,mileageMonthlyFeeAmount:2000,monthlyFeeAmount:10000};
 assert.deepEqual(assertAgreedFeeComponents(p,{monthlyFeeAmount:10000}),{baseFeeAmount:8000,mileageMonthlyFeeAmount:2000});
 assert.throws(()=>assertAgreedFeeComponents(p,{monthlyFeeAmount:9000,priceAdjustmentReason:'约定优惠'}));
 assert.deepEqual(assertAgreedFeeComponents(p,{monthlyFeeAmount:9000,priceAdjustmentReason:'约定优惠',agreedFeeComponents:{baseFeeAmount:7500,mileageMonthlyFeeAmount:1500}}),{baseFeeAmount:7500,mileageMonthlyFeeAmount:1500});
});

import {electronicDeliveryPlan} from '../src/electronic-documents/delivery-plan';
test('frozen planned day fills date-free facts and equal explicit days deduplicate without changing the source',()=>{
 const facts='计划交付地点：合成中心；现场联系人：合成运营',canonical='计划交付日期：2026-11-10；'+facts;
 assert.equal(electronicDeliveryPlan('2026-11-10',facts),canonical);
 assert.equal(electronicDeliveryPlan('2026-11-10T00:00:00.000Z','计划交付日期：2026-11-10；'+facts+'；计划日期：2026年11月10日'),canonical);
 assert.equal(electronicDeliveryPlan('2026-11-10','计划日期：11月10日；'+facts),canonical);
 assert.equal(facts,'计划交付地点：合成中心；现场联系人：合成运营');
 assert.throws(()=>electronicDeliveryPlan('2026-11-10','计划交付日期：2026-11-11；'+facts),(e:any)=>e.getResponse?.().error.code==='ELECTRONIC_PLANNED_DATE_CONFLICT');
 assert.throws(()=>electronicDeliveryPlan('2026-11-10','2026年11月12日；'+facts),(e:any)=>e.getResponse?.().error.code==='ELECTRONIC_PLANNED_DATE_CONFLICT');
 assert.throws(()=>electronicDeliveryPlan('2026-11-10','计划日期：11月12日；'+facts),(e:any)=>e.getResponse?.().error.code==='ELECTRONIC_PLANNED_DATE_CONFLICT');
 assert.throws(()=>electronicDeliveryPlan('2026-02-30',facts),(e:any)=>e.getResponse?.().error.code==='ELECTRONIC_PLANNED_DATE_REQUIRED');
});
