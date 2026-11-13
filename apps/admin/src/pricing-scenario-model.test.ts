import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as scenario from './pricing-scenario-model.ts';
const model=scenario as any;
const complete=()=>({...model.scenarioInitial(),name:'宁达',managementVehicleCount:'10',occupancyRate:'90',productTermMonths:'6',repeatOrderRate:'40',badDebtRate:'0',expectedMonthlyMileageKm:'1000',marketing:{fixedBudgetCents:'0',conversionMonths:'12',coverageVehicleCount:'',newOrderCostCents:'500',repeatOrderCostCents:'50'}});

test('legacy conversion preserves named zero and unknown rows without retaining legacy totals',()=>{
 assert.equal(typeof model.scenarioInitial,'function');
 const values=model.scenarioInitial({name:'旧场景',managementVehicleCount:10,occupancyRate:.9,targetAnnualRoa:null,expectedMonthlyMileageKm:1000,monthlyManagementBudgetCents:50000,variableCostPerOccupiedMonthCents:0,otherFixedMonthlyCostCents:null,oneTimeCostCents:0,disposalCostCents:null,notes:''});
 assert.equal(values.vehicleCosts.find((r:any)=>r.basis==='OCCUPIED_MONTH').amountCents,'0.00');
 assert.equal(values.vehicleCosts.find((r:any)=>r.basis==='HOLDING_MONTH').amountCents,'');
 assert.equal(values.enterpriseCosts[0].amountCents,'500.00');
 for(const key of ['productTermMonths','repeatOrderRate','badDebtRate'])assert.equal(values[key],'');
 assert.throws(()=>model.scenarioPayload(values),/期限|复购|坏账/);
 const payload=model.scenarioPayload({...complete(),vehicleCosts:values.vehicleCosts,enterpriseCosts:values.enterpriseCosts});
 assert.equal(payload.costModelVersion,2);assert.equal(payload.vehicleCosts[0].amountCents,0);
 for(const key of ['monthlyManagementBudgetCents','variableCostPerOccupiedMonthCents','otherFixedMonthlyCostCents','oneTimeCostCents','disposalCostCents'])assert.equal(key in payload,false);
});
test('unit and money validation rejects fractional cents, wrong bases, negative quantities and invalid amortization dates',()=>{
 assert.equal(typeof model.scenarioPayload,'function');
 const row={id:'r',label:'交付',basis:'PER_CYCLE',amountCents:'12.34',quantity:'2'};
 assert.equal(model.scenarioPayload({...complete(),vehicleCosts:[row]}).vehicleCosts[0].amountCents,1234);
 for(const patch of [{amountCents:'1.234'},{quantity:'-1'},{basis:'MONTH'},{label:''}])assert.throws(()=>model.scenarioPayload({...complete(),vehicleCosts:[{...row,...patch}]}));
 assert.throws(()=>model.scenarioPayload({...complete(),enterpriseCosts:[{...row,basis:'AMORTIZED_ONCE',startDate:'2026-02-30',allocationMonths:'12'}]}));
 assert.throws(()=>model.scenarioPayload({...complete(),vehicleCosts:[row,row]}),/重复/);
 assert.throws(()=>model.scenarioPayload({...complete(),vehicleCosts:[row],enterpriseCosts:[{...row,basis:'MONTH'}]}),/重复/);
 assert.throws(()=>model.scenarioPayload({...complete(),productTermMonths:'2'}),/期限/);
 const once={...row,basis:'AMORTIZED_ONCE',startDate:'2026-11-01',allocationMonths:'12'};
 assert.equal(model.scenarioPayload({...complete(),enterpriseCosts:[once]}).enterpriseCosts[0].allocationMonths,12);
});
test('marketing annual preview uses fractional cycles and preserves unknown versus explicit zero',()=>{
 assert.equal(typeof model.scenarioSummary,'function');
 let form=complete();let summary=model.scenarioSummary(form);assert.equal(summary.annualCycles,1.8);assert.equal(summary.marketingAnnualCents,57600);
 form={...form,repeatOrderRate:'0'};assert.equal(model.scenarioSummary(form).marketingAnnualCents,90000);
 form={...form,marketing:{...form.marketing,fixedBudgetCents:'1200',conversionMonths:'2',coverageVehicleCount:'10'}};
 assert.equal(model.scenarioSummary(form).fixedMarketingAnnualCents,72000);
 assert.equal(model.scenarioSummary({...form,marketing:{...form.marketing,newOrderCostCents:''}}).marketingAnnualCents,null);
 assert.equal(model.scenarioSummary({...form,occupancyRate:'0',badDebtRate:'100'}).annualCycles,0);
});
test('new groups default to selected scenario term; existing group months take precedence',()=>{
 assert.equal(typeof model.scenarioGroupTerm,'function');
 assert.deepEqual(model.scenarioGroupTerm({productTermMonths:6}),{months:6,source:'SCENARIO'});
 assert.deepEqual(model.scenarioGroupTerm({productTermMonths:6},3),{months:3,source:'GROUP'});
 assert.deepEqual(model.scenarioGroupTerm({productTermMonths:6},12),{months:12,source:'GROUP'});
 assert.deepEqual(model.scenarioGroupTerm({}),{months:'',source:'MISSING'});
});
test('v2 payload restored from frozen request retains every row, zero and unknown',()=>{
 assert.equal(typeof model.scenarioInitial,'function');
 const payload=model.scenarioPayload({...complete(),vehicleCosts:[{id:'gps',label:'GPS',basis:'HOLDING_YEAR',amountCents:'0',quantity:'1'},{id:'parking',label:'停车',basis:'IDLE_MONTH',amountCents:'',quantity:'2'}]});
 assert.deepEqual(model.scenarioPayload(model.scenarioInitial(payload)),payload);
});
