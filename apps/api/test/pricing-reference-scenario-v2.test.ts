import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioPayload, previewInput} from '../src/pricing-reference/types';
import {assemble} from '../src/pricing-reference/assembly';

const item=(id:string,basis:string,amountCents:number|null,quantity=1,extra:any={})=>({id,label:id,basis,amountCents,quantity,...extra});
const scenario=(extra:any={})=>({costModelVersion:2,name:'v2 synthetic',managementVehicleCount:10,occupancyRate:.9,targetAnnualRoa:.1,expectedMonthlyMileageKm:1000,notes:'synthetic',productTermMonths:6,repeatOrderRate:.4,badDebtRate:0,baasMonthlyBudgetCents:0,insuranceAnnualBudgetCents:0,vehicleCosts:[],enterpriseCosts:[],marketing:{fixedBudgetCents:0,conversionMonths:3,coverageVehicleCount:null,newOrderCostCents:50000,repeatOrderCostCents:5000},...extra});
function fixture(payload:any=scenario(),months=6){
 const vehicle:any={id:'a',revision:0,modelDefinitionId:'m',modelDefinition:{modelYear:2026},mileageKm:20000,assetProfile:{batteryOwnership:'OWNED',batteryCapacityKwh:75,purchaseAmount:8000000,purchaseDate:'2025-01-01',firstRegistrationDate:'2025-01-01'},baasContracts:[],assetCostPlans:[]};
 const curve:any={id:'curve',lineageId:'c',version:1,createdAt:'2025-01-01',payload:{modelDefinitionId:'m',year:2026,batteryOwnership:'OWNED',batteryCapacityKwh:75,configuration:'',mileageMinKm:10000,mileageMaxKm:1000000,effectiveFrom:'2025-01-01',valuationDate:'2025-01-01',points:[{ageMonths:0,coefficient:1},{ageMonths:120,coefficient:.5}]}};
 const policies:any[]=[];
 const tx:any={vehicle:{findMany:async()=>[vehicle]},pricingReferenceParameter:{findFirst:async()=>({id:'s',payload}),findMany:async({where}:any)=>where.kind==='CURVE'?[curve]:[]},insurancePolicy:{findMany:async()=>policies}};
 const request:any={scenarioVersionId:'s',pricingDate:'2026-01-01',exitDate:'2027-01-01',groups:[{groupKey:'g',vehicleIds:['a'],draft:{configurationVersion:2,name:'group',months,minimumTermMonths:3,baseFeeAmount:300000,mileageMonthlyFeeAmount:50000,mileagePerMonthKm:1000,excessMileagePriceAmount:100,conditions:'synthetic',swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:100},vehicleIds:['a'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]}}],vehicleOverrides:[{vehicleId:'a',conditionConfirmed:true}]};
 return {payload,vehicle,curve,policies,tx,request,run:()=>assemble(tx,request,'2026-01-01T00:00:00Z')};
}
const amount=(run:any,id:string)=>run.input.vehicles[0].costBreakdown.find((r:any)=>r.id===id)?.amountCents;

test('strict v2 accepts only new schema and rejects incomplete, ambiguous or malformed costs',()=>{
 assert.equal(scenarioPayload.safeParse(scenario()).success,true);
 for(const patch of [{monthlyManagementBudgetCents:0},{productTermMonths:1},{productTermMonths:121},{badDebtRate:1.1},{repeatOrderRate:-.1},{vehicleCosts:[item('a','MONTH',0)]},{vehicleCosts:[item('a','PER_CYCLE',0),item('a','HOLDING_MONTH',0)]},{enterpriseCosts:[item('a','AMORTIZED_ONCE',0)]},{enterpriseCosts:[item('a','MONTH',1,-1)]},{vehicleCosts:[item('a','HOLDING_YEAR',.5)]}])assert.equal(scenarioPayload.safeParse(scenario(patch)).success,false,JSON.stringify(patch));
 const f=fixture();f.request.vehicleOverrides[0].includeSetupCosts=true;assert.equal(previewInput.safeParse(f.request).success,true);
});
test('six-month repeat marketing is 576 yuan per year; no repeat is 900 yuan',async()=>{
 const f=fixture();const r=await f.run();assert.equal(amount(r,'marketing-variable'),57600);assert.equal(r.input.vehicles[0].productTermMonths,6);assert.equal(r.input.vehicles[0].productTermSource,'GROUP');
 f.payload.repeatOrderRate=0;assert.equal(amount(await f.run(),'marketing-variable'),90000);
});
test('actual group term takes priority and repeat does not reduce deliveries',async()=>{
 const f=fixture(scenario({vehicleCosts:[item('delivery','PER_CYCLE',10000,2)]}),3);
 const a=await f.run();assert.equal(amount(a,'marketing-variable'),115200);assert.equal(amount(a,'delivery'),72000);
 f.request.groups[0].draft.months=12;const b=await f.run();assert.equal(amount(b,'marketing-variable'),28800);assert.equal(amount(b,'delivery'),18000);
 f.payload.repeatOrderRate=1;assert.equal(amount(await f.run(),'delivery'),18000);
});
test('fixed promotion persists after conversion period and enterprise amortization only intersects dated months',async()=>{
 const f=fixture(scenario({marketing:{fixedBudgetCents:300000,conversionMonths:3,coverageVehicleCount:null,newOrderCostCents:0,repeatOrderCostCents:0},enterpriseCosts:[item('staff','MONTH',10000,2),item('setup','AMORTIZED_ONCE',1200000,1,{startDate:'2025-07-01',allocationMonths:12})]}));
 const r=await f.run();assert.equal(amount(r,'marketing-fixed'),120000);assert.equal(amount(r,'staff'),24000);assert.equal(amount(r,'setup'),60000);
 f.payload.enterpriseCosts[1].startDate='2024-01-01';f.payload.enterpriseCosts[1].amountCents=null;assert.equal(amount(await f.run(),'setup'),0);
});
test('idle vehicles retain holding and enterprise costs; setup is opt-in and zero overrides supersede unknown',async()=>{
 const f=fixture(scenario({occupancyRate:0,vehicleCosts:[item('gps','HOLDING_MONTH',100),item('parking','IDLE_MONTH',200),item('license','FUTURE_SETUP',null),item('disposal','DISPOSAL',null)],enterpriseCosts:[item('office','MONTH',10000)]}));
 f.request.vehicleOverrides[0].disposalCostCents=0;let r=await f.run();assert.equal(r.result.vehicles[0].complete,true);assert.equal(amount(r,'license'),0);assert.equal(amount(r,'gps'),1200);assert.equal(amount(r,'parking'),2400);assert.equal(amount(r,'office'),12000);assert.equal(r.result.vehicles[0].priceSolveReason,'ZERO_OCCUPANCY');
 f.request.vehicleOverrides[0].includeSetupCosts=true;r=await f.run();assert.equal(r.result.vehicles[0].complete,false);
 f.request.vehicleOverrides[0].oneTimeCostCents=0;assert.equal((await f.run()).result.vehicles[0].complete,true);
});
test('bad debt reduces all operator revenue and group inverse slope, never assets or cost',async()=>{
 const f=fixture();const g=f.request.groups[0];g.draft.customerBaas={disposition:'SEPARATE',amount:60000,period:'TERM',recipient:'operator'};g.customerBaasIncomeTreatment='BUSINESS_REVENUE';g.customerBaasIncomeBasisNotes='operator';
 const baseline=await f.run();f.payload.badDebtRate=.2;let r=await f.run(),car=r.result.vehicles[0];assert.equal(car.expectedGrossRevenueCents,3888000);assert.equal(car.badDebtLossCents,777600);assert.equal(car.collectibleRevenueCents,3110400);assert.equal(car.periodProfitCents,baseline.result.vehicles[0].periodProfitCents-777600);assert.equal(car.baseFeeCapCents,baseline.result.vehicles[0].baseFeeCapCents);assert.equal(car.targetBaseFeeCents,r.result.groups[0].groupTargetBaseFeeCents);
 const target=car.targetBaseFeeCents;g.draft.baseFeeAmount=target;r=await f.run();assert.ok(r.result.vehicles[0].annualRoa>=.1);g.draft.baseFeeAmount=target-1;assert.ok((await f.run()).result.vehicles[0].annualRoa<.1);
 f.payload.badDebtRate=1;r=await f.run();car=r.result.vehicles[0];assert.equal(car.complete,true);assert.equal(car.collectibleRevenueCents,0);assert.equal(car.targetBaseFeeCents,null);assert.equal(car.priceSolveReason,'FULL_BAD_DEBT');assert.equal(r.result.groups[0].groupTargetBaseFeeCents,null);
});
test('v2 preserves fractional cents across repeated cycles and annual cost allocation',async()=>{
 const f=fixture(scenario({occupancyRate:1,vehicleCosts:[item('delivery','PER_CYCLE',1)],marketing:{fixedBudgetCents:0,conversionMonths:3,coverageVehicleCount:null,newOrderCostCents:0,repeatOrderCostCents:0}}),3);f.request.exitDate='2026-04-01';
 const a=await f.run();f.payload.vehicleCosts=[];const b=await f.run();assert.equal(b.result.vehicles[0].periodProfitCents-a.result.vehicles[0].periodProfitCents,1);
});
test('actual BaaS and insurance coverage beat zero budgets; per-vehicle budget fills only gaps',async()=>{
 const f=fixture();f.request.exitDate='2026-03-01';f.vehicle.assetProfile.batteryOwnership='BAAS';f.curve.payload.batteryOwnership='BAAS';f.vehicle.baasContracts=[{id:'b',status:'ACTIVE',effectiveFrom:'2026-01-01',effectiveTo:'2026-01-31',firstCostPeriod:'2026-01',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:1}];
 f.payload.baasMonthlyBudgetCents=112800;f.request.vehicleOverrides[0].baasMonthlyBudgetCents=0;f.request.vehicleOverrides[0].assumptionNotes='zero future';
 f.policies.push(...['COMPULSORY_TRAFFIC','COMMERCIAL'].map((policyType,i)=>({versions:[{id:String(i),version:1,status:'APPROVED',createdAt:'2025-12-01',effectiveAt:'2025-12-01',startAt:'2025-12-31T16:00:00Z',endAt:'2026-01-31T16:00:00Z',vehicleIds:['a'],policyType,premiumAmount:3100}]})));
 let r=await f.run();assert.equal(r.input.vehicles[0].holdingBaasCostCents,72800);assert.equal(amount(r,'insurance'),6200);
 delete f.request.vehicleOverrides[0].baasMonthlyBudgetCents;r=await f.run();assert.equal(r.input.vehicles[0].holdingBaasCostCents,185600);
 f.payload.insuranceAnnualBudgetCents=120000;r=await f.run();assert.equal(amount(r,'insurance'),16200);assert.equal(r.sourceSnapshot.scenario.payload.insuranceAnnualBudgetCents,120000);
});
test('partial known insurance is retained and supplemental budget covers only incomplete coverage',async()=>{
 const f=fixture(scenario({insuranceAnnualBudgetCents:120000}));f.request.exitDate='2026-02-01';f.policies.push({versions:[{id:'i',version:1,status:'APPROVED',createdAt:'2025-12-01',effectiveAt:'2025-12-01',startAt:'2025-12-31T16:00:00Z',endAt:'2026-01-31T16:00:00Z',vehicleIds:['a'],policyType:'COMPULSORY_TRAFFIC',premiumAmount:3100}]});
 assert.equal(amount(await f.run(),'insurance'),13100);f.payload.insuranceAnnualBudgetCents=0;assert.equal(amount(await f.run(),'insurance'),3100);
});
test('enterprise amortization supports more than 120 months and only its precise dated intersection',async()=>{
 const f=fixture(scenario({enterpriseCosts:[item('long','AMORTIZED_ONCE',1200000,1,{startDate:'2025-01-01',allocationMonths:240})]}));
 assert.equal(amount(await f.run(),'long'),6000);
 f.payload.enterpriseCosts=[item('partial','AMORTIZED_ONCE',31000,1,{startDate:'2026-01-16',allocationMonths:1})];f.request.exitDate='2026-02-01';
 assert.equal(amount(await f.run(),'partial'),1600);
});
test('many fractional cost rows aggregate exactly without feeding displayed rounding back into profit',async()=>{
 const f=fixture(scenario({occupancyRate:1,vehicleCosts:Array.from({length:6},(_,i)=>item('tiny'+i,'HOLDING_MONTH',1,.1)),marketing:{fixedBudgetCents:0,conversionMonths:3,coverageVehicleCount:null,newOrderCostCents:0,repeatOrderCostCents:0}}));
 f.request.exitDate='2026-02-01';f.curve.payload.points=[{ageMonths:0,coefficient:1},{ageMonths:120,coefficient:1}];f.request.groups[0].draft.baseFeeAmount=0;f.request.groups[0].draft.mileageMonthlyFeeAmount=0;
 const r=await f.run();assert.equal(amount(r,'tiny0'),0);assert.equal(r.input.vehicles[0].holdingOtherFixedCostCents,1);assert.equal(r.result.vehicles[0].periodProfitCents,-1);assert.deepEqual(r.input.vehicles[0].exactCosts.holding,{numerator:'3',denominator:'5'});
});
test('same snapshot respects each group term and weighted group reverse price under bad debt',async()=>{
 const f=fixture(scenario({badDebtRate:.25})),b={...f.vehicle,id:'b',assetProfile:{...f.vehicle.assetProfile,purchaseAmount:16000000}};
 f.tx.vehicle.findMany=async()=>[f.vehicle,b];const g=f.request.groups[0];g.draft.months=3;const other={...g,groupKey:'long',vehicleIds:['b'],draft:{...g.draft,months:12,vehicleIds:['b']}};f.request.groups.push(other);f.request.vehicleOverrides.push({vehicleId:'b',conditionConfirmed:true});
 let r=await f.run();assert.equal(r.input.vehicles[0].productTermMonths,3);assert.equal(r.input.vehicles[1].productTermMonths,12);assert.equal(r.input.vehicles[1].costBreakdown.find((c:any)=>c.id==='marketing-variable').amountCents,28800);
 f.request.groups=[{...g,vehicleIds:['a','b'],draft:{...g.draft,vehicleIds:['a','b']}}];r=await f.run();const target=r.result.groups[0].groupTargetBaseFeeCents;f.request.groups[0].draft.baseFeeAmount=target;assert.ok((await f.run()).result.groups[0].annualRoa>=.1);f.request.groups[0].draft.baseFeeAmount=target-1;assert.ok((await f.run()).result.groups[0].annualRoa<.1);
});
test('v2 signed BaaS uses the original full-cycle divisor before clipping and actual plans remain authoritative',async()=>{
 const f=fixture();f.request.pricingDate='2026-01-30';f.request.exitDate='2026-01-31';f.vehicle.assetProfile.batteryOwnership='BAAS';f.curve.payload.batteryOwnership='BAAS';
 f.vehicle.baasContracts=[{id:'b',status:'ACTIVE',effectiveFrom:'2026-01-30',effectiveTo:'2026-01-31',firstCostPeriod:'2026-01',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:1}];
 let r=await f.run();assert.equal(r.input.vehicles[0].holdingBaasCostCents,2348);assert.deepEqual(r.sourceSnapshot.vehicles[0].baasCoverage.exactAmount,{numerator:'72800',denominator:'31'});
 f.vehicle.assetCostPlans=[{baasContractId:'b',periodStart:'2026-01-30',periodEnd:'2026-01-31',amount:4697}];
 r=await f.run();assert.equal(r.input.vehicles[0].holdingBaasCostCents,2349);assert.deepEqual(r.sourceSnapshot.vehicles[0].baasCoverage.exactAmount,{numerator:'4697',denominator:'2'});
});
test('distinct optional policies do not invent an insurance gap when both required types cover the period',async()=>{
 const f=fixture(scenario({insuranceAnnualBudgetCents:120000}));f.request.exitDate='2026-02-01';
 f.policies.push(...['COMPULSORY_TRAFFIC','COMMERCIAL','OTHER','OTHER'].map((policyType,i)=>({id:String(i),versions:[{id:String(i),version:1,status:'APPROVED',createdAt:'2025-12-01',effectiveAt:'2025-12-01',startAt:'2025-12-31T16:00:00Z',endAt:'2026-01-31T16:00:00Z',vehicleIds:['a'],policyType,premiumAmount:3100}]})));
 let r=await f.run();assert.equal(amount(r,'insurance'),12400);assert.equal(r.sourceSnapshot.vehicles[0].insuranceCoverage.budgetUsed,false);assert.equal(r.sourceSnapshot.vehicles[0].insuranceCoverage.missingDays,0);
 f.payload.insuranceAnnualBudgetCents=null;r=await f.run();assert.equal(amount(r,'insurance'),12400);assert.equal(r.result.vehicles[0].complete,true);
});
