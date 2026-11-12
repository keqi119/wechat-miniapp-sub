import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listedProductSnapshot,versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
import {day,periods} from '../src/usage/rules';

async function implementation(){
 const pricing:any=await import('../src/vehicle-changes/offline-pricing').catch(()=>({}));
 const input:any=await import('../src/vehicle-changes/offline-pricing-input').catch(()=>({}));
 assert.equal(typeof pricing.composeOfflineSwapPricing,'function','offline price composer must exist');
 assert.equal(typeof pricing.loadOfflineSwapTarget,'function','validated listing loader must exist');
 assert.equal(typeof input.offlineSwapQuoteInput?.safeParse,'function','strict v2 quote input must exist');
 return{...pricing,...input};
}
function productPlan(monthlyFeeAmount=20000){
 const version:any={id:'product-v2',productId:'product',version:2,configurationVersion:2,name:'明确商品',months:24,baseFeeAmount:monthlyFeeAmount,mileageMonthlyFeeAmount:0,monthlyFeeAmount,mileagePerMonthKm:2400,excessMileagePriceAmount:230,energyDescription:'充换电费用由客户自付',conditions:'明确使用条件',swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000},vehicleIds:['target-vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],status:'PUBLISHED'};
 const snapshot=versionSnapshot(version);
 return{id:'plan',vehicleId:'target-vehicle',productVersionId:version.id,active:true,vehicle:{id:'target-vehicle',modelDefinitionId:null},productVersion:version,listing:{id:'listing',revision:3,vehicleId:'target-vehicle',subscriptionPlanId:'plan',productVersionId:version.id,status:'PUBLISHED',visible:true,source:'EXPLICIT',productSourceHash:canonicalHash(snapshot),snapshot}};
}
function target(monthlyFeeAmount=20000){const plan=productPlan(monthlyFeeAmount);return{vehicleId:plan.vehicleId,subscriptionPlanId:plan.id,product:listedProductSnapshot(plan)};}
function request(extra:any={}){const source=target();return{pricingVersion:2,revision:4,idempotencyKey:'explicit-swap-quote-key',targetListingId:'listing',targetListingRevision:3,targetSourceHash:source.product.sourceHash,plannedReturnAt:'2026-03-01T08:00:00+08:00',plannedDeliveryAt:'2026-03-01T10:00:00+08:00',depositAmount:50000,depositBasis:'押金独立逐单核定',insuranceResponsibility:'明确保险责任',downtimeArrangement:'明确无车安排',settlementExplanation:'逐期差价及原到期日',handoverArrangement:'双方实际交接',cancellationTerms:'明确取消处理',reason:'客户明确升级',expiresAt:'2026-03-02T10:00:00+08:00',externalCompensationRequired:false,...extra};}
function sourceRows(startDate='2026-01-31',months=3,amount=10000){return periods(startDate,months).map(p=>({sequence:p.sequence,startDate:day(p.startDate),endDate:day(p.endDate),dueDate:day(p.startDate),amount}));}
function composeInput(extra:any={}){return{priorTermsVersionId:'terms-2',priorTermsHash:'a'.repeat(64),originalStartDate:'2026-01-31',months:3,currentMonthlyFeeAmount:10000,target:target(),deliveryAt:'2026-03-01T10:00:00+08:00',currentPeriods:sourceRows(),...extra};}
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;

test('v2 input admits only selected source and explicit commercial facts, never client price/vehicle/period/fee overrides',async()=>{
 const {offlineSwapQuoteInput:schema}=await implementation();assert.equal(schema.safeParse(request()).success,true);
 for(const extra of [{pricingVersion:1},{pricingVersion:3},{pricingVersion:undefined},{targetVehicleId:'injected'},{newMonthlyFeeAmount:1},{monthlyFeeAmount:1},{targetMonthlyFeeAmount:1},{periods:[]},{handoverFeeAmount:0},{handoverFeeBasis:'manual fee'},{externalCompensationRequired:true},{sourceHash:'b'.repeat(64)}])assert.equal(schema.safeParse(request(extra)).success,false,JSON.stringify(extra));
});

test('quote source versions, integer deposits and timestamp/text facts are strict without coercion',async()=>{
 const {offlineSwapQuoteInput:schema}=await implementation();
 for(const extra of [{targetListingRevision:-1},{targetListingRevision:'3'},{targetSourceHash:'unknown'},{targetListingId:'bad\0id'},{idempotencyKey:'nul-key\0'},{depositAmount:1.5},{depositAmount:2147483648},{depositBasis:'bad\0text'},{plannedDeliveryAt:'2026-02-30T10:00:00+08:00'},{plannedDeliveryAt:'2026-03-01T10:00:00'},{plannedDeliveryAt:'2026-03-01T07:00:00+08:00'},{expiresAt:'0000-01-01T00:00:00Z'}])assert.equal(schema.safeParse(request(extra)).success,false,JSON.stringify(extra));
 const parsed=schema.parse(request({depositAmount:0}));assert.equal(parsed.depositAmount,0);assert.equal(parsed.depositBasis,'押金独立逐单核定');
});

test('31st contract uses current obligations plus original-month actual-day differences and keeps original due dates',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation(),input=composeInput();input.currentPeriods[0].amount=9000;input.currentPeriods[1].amount=15000;input.currentPeriods[1].dueDate='2026-03-05';
 const result=compose(input);assert.equal(result.pricingVersion,2);assert.equal(result.financialGate,'BEFORE_RETURN');assert.equal(result.pricing.endDate,'2026-04-30');
 assert.deepEqual(result.periods.map((p:any)=>({sequence:p.sequence,originalAmount:p.originalAmount,differenceAmount:p.differenceAmount,amount:p.amount,dueDate:p.dueDate})),[
  {sequence:1,originalAmount:9000,differenceAmount:0,amount:9000,dueDate:'2026-01-31'},
  {sequence:2,originalAmount:15000,differenceAmount:9677,amount:24677,dueDate:'2026-03-05'},
  {sequence:3,originalAmount:10000,differenceAmount:10000,amount:20000,dueDate:'2026-03-31'}]);
 assert.equal(result.pricing.totalDifferenceAmount,19677);assert.equal(result.totalOriginalAmount,34000);assert.equal(result.totalAmount,53677);assert.equal(result.currentMonthlyFeeAmount,10000);assert.equal(result.targetMonthlyFeeAmount,20000);
});

test('leap February and final contract day retain actual days, inclusive delivery and per-period half-up fen',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation();
 const leap=compose(composeInput({originalStartDate:'2024-01-31',months:2,currentPeriods:sourceRows('2024-01-31',2),deliveryAt:'2024-02-28T23:59:59+08:00'}));assert.deepEqual(leap.periods.map((p:any)=>p.differenceAmount),[345,10000]);assert.equal(leap.pricing.endDate,'2024-03-31');
 const last=compose(composeInput({deliveryAt:'2026-04-29T23:59:59+08:00'}));assert.deepEqual(last.periods.map((p:any)=>p.differenceAmount),[0,0,333]);
 const half=compose(composeInput({originalStartDate:'2026-04-01',months:2,currentMonthlyFeeAmount:10000,target:target(10001),currentPeriods:sourceRows('2026-04-01',2),deliveryAt:'2026-04-16T00:00:00+08:00'}));assert.deepEqual(half.periods.map((p:any)=>p.differenceAmount),[1,1]);assert.equal(half.pricing.totalDifferenceAmount,2);
});

test('a second same-day upgrade uses current monthly fee and preserves the first upgrade in each current obligation',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation(),first=compose(composeInput());
 const second=compose(composeInput({priorTermsVersionId:'terms-3',priorTermsHash:'b'.repeat(64),currentMonthlyFeeAmount:20000,target:target(25000),currentPeriods:first.periods}));
 assert.equal(second.pricing.monthlyDifferenceAmount,5000);assert.deepEqual(second.periods.map((p:any)=>p.differenceAmount),[0,4839,5000]);assert.deepEqual(second.periods.map((p:any)=>p.amount),[10000,24516,25000]);assert.equal(second.pricing.endDate,first.pricing.endDate);assert.equal(second.priorTermsVersionId,'terms-3');
});

test('equal price is zero and downgrade/outside original term remain explicit blockers',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation(),same=compose(composeInput({target:target(10000)}));assert.equal(same.pricing.totalDifferenceAmount,0);assert.deepEqual(same.periods.map((p:any)=>p.amount),[10000,10000,10000]);
 assert.throws(()=>compose(composeInput({target:target(9999)})),/DOWNGRADE_NOT_SUPPORTED/);
 for(const deliveryAt of ['2026-01-30T23:59:59+08:00','2026-04-30T00:00:00+08:00'])assert.throws(()=>compose(composeInput({deliveryAt})),/OUTSIDE_TERM/);
});

test('missing, duplicate, shifted or invalid original periods cannot silently produce a different payment schedule',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation();
 for(const mutate of [(p:any[])=>p.pop(),(p:any[])=>p[1].sequence=1,(p:any[])=>p[1].startDate='2026-03-01',(p:any[])=>p[1].endDate='2026-04-01',(p:any[])=>p[1].dueDate='2026-02-30',(p:any[])=>p[1].amount=-1,(p:any[])=>p[1].amount=0.5,(p:any[])=>p[1].amount=Number.MAX_SAFE_INTEGER+1]){const rows=sourceRows();mutate(rows);assert.throws(()=>compose(composeInput({currentPeriods:rows})));}
 const reversed=sourceRows().reverse();assert.deepEqual(compose(composeInput({currentPeriods:reversed})).periods.map((p:any)=>p.sequence),[1,2,3]);
});

test('each stored period stays within PostgreSQL Int while rounded term totals can exceed Int safely',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation(),max=2147483647;
 const large=compose(composeInput({originalStartDate:'2026-01-01',months:120,currentMonthlyFeeAmount:0,target:target(max),currentPeriods:sourceRows('2026-01-01',120,0),deliveryAt:'2026-01-01T00:00:00+08:00'}));
 assert.equal(large.totalAmount,257698037640);assert.equal(large.pricing.totalDifferenceAmount,257698037640);assert.equal(Number.isSafeInteger(large.totalAmount),true);assert(large.periods.every((p:any)=>p.amount===max));
 const rows=sourceRows();rows[1].amount=max;assert.throws(()=>compose(composeInput({currentPeriods:rows})),/AMOUNT_OVERFLOW/);
 assert.throws(()=>compose(composeInput({currentMonthlyFeeAmount:max+1,target:target(max)})),/INVALID_AMOUNT/);
 const bad=target();bad.product.monthlyFeeAmount=Number.MAX_SAFE_INTEGER;assert.throws(()=>compose(composeInput({target:bad})),/INVALID_AMOUNT/);
});

test('frozen target source hash is unchanged and pricing hash binds current terms, source, due dates and Shanghai delivery day',async()=>{
 const {composeOfflineSwapPricing:compose}=await implementation(),input=composeInput(),before=structuredClone(input),result=compose(input);
 assert.equal(result.target.product.sourceHash,input.target.product.sourceHash);assert.notEqual(result.pricingHash,result.target.product.sourceHash);assert.match(result.pricingHash,/^[a-f0-9]{64}$/);
 for(const extra of [{priorTermsHash:'c'.repeat(64)},{priorTermsVersionId:'other-terms'},{deliveryAt:'2026-03-02T10:00:00+08:00'},{currentPeriods:sourceRows().map((p,i)=>i===1?{...p,dueDate:'2026-03-02'}:p)}])assert.notEqual(compose(composeInput(extra)).pricingHash,result.pricingHash);
 const equivalent=compose(composeInput({deliveryAt:'2026-02-28T16:00:00Z'}));assert.equal(equivalent.pricingHash,result.pricingHash);
 result.target.product.swapPolicy.includedCount=999;result.periods[1].amount=1;assert.deepEqual(input,before);
 // Pricing returns a source snapshot, never a replacement usage or entitlement account.
 for(const key of ['usageAccount','usagePolicy','entitlements','swapCredits','newMonths'])assert.equal(Object.hasOwn(result,key),false);
});

function reader(plan:any){return{vehicleListing:{findUnique:async({where}:any)=>where.id===plan.listing.id?structuredClone(plan.listing):null},subscriptionPlan:{findUnique:async({where}:any)=>where.id===plan.id?structuredClone(plan):null}};}
function selection(plan:any){const p=listedProductSnapshot(plan);return{targetListingId:p.listingId,targetListingRevision:p.listingRevision,targetSourceHash:p.sourceHash};}

test('target loader uses the real published listing source definition and rejects stale revision/hash or another plan association',async()=>{
 const {loadOfflineSwapTarget:load}=await implementation(),plan=productPlan(),selected=selection(plan),loaded=await load(reader(plan),selected);
 assert.deepEqual(loaded,{vehicleId:'target-vehicle',subscriptionPlanId:'plan',product:listedProductSnapshot(plan)});assert.equal(loaded.product.sourceHash,selected.targetSourceHash);
 for(const patch of [{targetListingRevision:2},{targetSourceHash:'b'.repeat(64)}])await assert.rejects(load(reader(plan),{...selected,...patch}),code('GOODS_SOURCE_CHANGED'));
 await assert.rejects(load(reader(plan),{...selected,targetListingId:'absent'}),code('GOODS_UNAVAILABLE'));
 plan.listing.subscriptionPlanId='wrong';await assert.rejects(load(reader(plan),selected));
});

test('target loader never bypasses published status, visibility, product scope or stored product hash',async()=>{
 const {loadOfflineSwapTarget:load}=await implementation();
 const mutations=[(p:any)=>p.listing.status='WITHDRAWN',(p:any)=>p.listing.visible=false,(p:any)=>p.active=false,(p:any)=>p.productVersion.status='SUSPENDED',(p:any)=>p.productVersion.vehicleIds=[],(p:any)=>p.listing.productSourceHash='bad',(p:any)=>p.productVersion.baseFeeAmount=1,(p:any)=>p.productVersionId='other-version'];
 for(const mutate of mutations){const p=productPlan(),selected=selection(p);mutate(p);await assert.rejects(load(reader(p),selected));}
});

test('known legacy migrated double-null product snapshots retain existing source hashes without inferring v2 rights',async()=>{
 const {loadOfflineSwapTarget:load}=await implementation(),p:any=productPlan();p.productVersion={id:'legacy-v1',productId:'legacy-product',version:1,name:'历史产品',months:12,monthlyFeeAmount:20000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'旧能源说明',conditions:'旧条件',vehicleIds:['target-vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],status:'PUBLISHED'};p.productVersionId='legacy-v1';Object.assign(p.listing,{productVersionId:'legacy-v1',source:'LEGACY_MIGRATED',productSourceHash:null,snapshot:null});
 const selected=selection(p),loaded=await load(reader(p),selected);assert.equal(loaded.product.sourceHash,selected.targetSourceHash);assert.equal(Object.hasOwn(loaded.product,'swapPolicy'),false);assert.equal(Object.hasOwn(loaded.product,'configurationVersion'),false);
 p.listing.productSourceHash='a'.repeat(64);await assert.rejects(load(reader(p),selected),code('GOODS_SOURCE_CHANGED'));
});

test('already frozen calculation is independent of later listing withdrawal, but new source loading refuses it',async()=>{
 const {loadOfflineSwapTarget:load,composeOfflineSwapPricing:compose}=await implementation(),p=productPlan(),selected=selection(p),frozen=await load(reader(p),selected),first=compose(composeInput({target:frozen}));
 p.listing.status='WITHDRAWN';p.productVersion.status='SUSPENDED';await assert.rejects(load(reader(p),selected));assert.deepEqual(compose(composeInput({target:frozen})),first);
});

test('unknown storage failures propagate and the loader accepts only the three explicit source keys',async()=>{
 const {loadOfflineSwapTarget:load}=await implementation(),p=productPlan(),selected=selection(p),tx=reader(p);tx.subscriptionPlan.findUnique=async()=>{throw Error('synthetic infrastructure failure');};
 await assert.rejects(load(tx,selected),/synthetic infrastructure failure/);await assert.rejects(load(reader(p),{...selected,targetMonthlyFeeAmount:1}));
});
