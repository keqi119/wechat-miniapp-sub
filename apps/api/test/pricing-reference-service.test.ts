import test from 'node:test';
import assert from 'node:assert/strict';
import {previewInput, parameterInput, scenarioPayload} from '../src/pricing-reference/types';
import {pricingCommand} from '../src/pricing-reference/command';
import {selectReviews, coveredCost,purchaseAgeMonths,baasIntervals} from '../src/pricing-reference/sources';
const actor={id:'staff',role:'ADMIN'};
test('strict mutations reject invented opening values, duplicates and invalid revision',()=>{
 assert.equal(previewInput.safeParse({openingValueCents:100}).success,false);
 assert.equal(parameterInput(scenarioPayload).safeParse({revision:-1,idempotencyKey:'test-key',payload:{}}).success,false);
});
test('command authenticates current staff before replay and rejects changed content',async()=>{
 let current:any={id:'staff',role:'ADMIN',active:true};let saved:any=null;let calls=0;
 const tx:any={adminUser:{findUnique:async()=>current},pricingReferenceCommand:{findUnique:async()=>saved,create:async({data}:any)=>{saved=data;}}};
 const run=(input:any)=>pricingCommand(tx,actor,'NEW','RUN',input,async()=>({id:++calls}));
 const input={revision:0,idempotencyKey:'command-1'};
 assert.deepEqual(await run(input),{id:1});assert.deepEqual(await run(input),{id:1});assert.equal(calls,1);
 await assert.rejects(run({...input,revision:1}));current={...current,active:false};await assert.rejects(run(input));
});
test('review correction/withdrawal observes knowledge and effective cutoffs',()=>{
 const rows=[{id:'a',lineageId:'l',version:1,createdAt:'2026-01-01',payload:{observedAt:'2026-01-01',effectiveAt:'2026-01-01',withdrawn:false}},{id:'b',lineageId:'l',version:2,createdAt:'2026-03-01',payload:{observedAt:'2026-01-01',effectiveAt:'2026-03-01',withdrawn:true}}];
 assert.deepEqual(selectReviews(rows,'2026-02-01','2026-02-01').map((r:any)=>r.id),['a']);
 assert.equal(selectReviews(rows,'2026-04-01','2026-04-01').length,0);
});
test('cost coverage requires every day; explicit future budget fills only uncovered days',()=>{
 const intervals=[{start:'2026-01-01',end:'2026-02-01',amount:3100}];
 assert.equal(coveredCost('2026-01-16','2026-02-01',intervals).amount,1600);
 assert.equal(coveredCost('2026-01-16','2026-03-01',intervals).amount,null);
 assert.equal(coveredCost('2026-01-16','2026-03-01',intervals,2800).amount,4400);
});

import {PricingReferenceService} from '../src/pricing-reference/service';
import {vehicleGroupDimension} from '../src/pricing-reference/assembly';
import {writeParameter} from '../src/pricing-reference/parameters';
const scenario={name:'small',managementVehicleCount:10,monthlyManagementBudgetCents:10000,occupancyRate:0.7,targetAnnualRoa:null,expectedMonthlyMileageKm:1000,variableCostPerOccupiedMonthCents:0,otherFixedMonthlyCostCents:0,disposalCostCents:0,oneTimeCostCents:0,notes:'explicit'};
test('parameter revisions append immutable lineage and stale versions fail',async()=>{
 const rows:any[]=[];const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},pricingReferenceCommand:{findUnique:async()=>null,create:async()=>{}},pricingReferenceParameter:{findFirst:async()=>rows.at(-1),create:async({data}:any)=>{const row={id:String(rows.length),...data};rows.push(row);return row;}},auditLog:{create:async()=>{}}};
 const first=await writeParameter(tx,actor,'SCENARIO',{revision:0,idempotencyKey:'scenario-1',payload:scenario});
 const second=await writeParameter(tx,actor,'SCENARIO',{revision:1,lineageId:first.lineageId,idempotencyKey:'scenario-2',payload:{...scenario,occupancyRate:0}});
 assert.equal(first.payload.occupancyRate,0.7);assert.equal(second.version,2);assert.equal(second.revision,2);
 await assert.rejects(writeParameter(tx,actor,'SCENARIO',{revision:1,lineageId:first.lineageId,idempotencyKey:'scenario-3',payload:scenario}));
});
test('historical reads return stored snapshot without fetching current financial sources',async()=>{
 const frozen={id:'run',revision:0,snapshot:{result:{currentValueCents:123}},adoptions:[]};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},pricingReferenceRun:{findUnique:async()=>frozen}};
 assert.deepEqual(await new PricingReferenceService().run(tx,actor,'run'),frozen);
});
test('adoption uses exact frozen vehicles, empty model OR scope and bounded internal command key',async()=>{
 let received:any;const groupKey='g'.repeat(100),group={groupKey,vehicleIds:['a','b'],draft:{name:'frozen',vehicleIds:['a','b'],modelDefinitionIds:[],baseFeeAmount:100}};
 const tx:any={adminUser:{findUnique:async()=>({...actor,active:true})},pricingReferenceCommand:{findUnique:async()=>null,create:async()=>{}},pricingReferenceRun:{findUnique:async()=>({id:'r'.repeat(40),revision:0,snapshot:{groups:[group]}})},pricingReferenceAdoption:{findUnique:async()=>null,create:async()=>{}},auditLog:{create:async()=>{}}};
 const service=new PricingReferenceService({createDraft:async(_tx:any,_actor:any,input:any)=>{received=input;return {id:'v',productId:'p'};}} as any);
 await service.adopt(tx,actor,'r'.repeat(40),groupKey,{revision:0,idempotencyKey:'adoption-1'});
 assert.deepEqual(received.vehicleIds,['a','b']);assert.deepEqual(received.modelDefinitionIds,[]);assert.ok(received.idempotencyKey.length<=128);
 assert.equal(received.name,'frozen');
});
test('finance cannot adopt even when command already succeeded for another role',async()=>{
 const tx:any={adminUser:{findUnique:async()=>({id:'staff',role:'FINANCE',active:true})}};
 await assert.rejects(new PricingReferenceService().adopt(tx,{id:'staff',role:'FINANCE'},'r','g',{revision:0,idempotencyKey:'adoption-2'}));
});
test('dimension includes model, year, battery ownership and normalized capacity',()=>{
 const v={modelDefinitionId:'m',modelDefinition:{modelYear:2026},year:2024,assetProfile:{batteryOwnership:'BAAS',batteryCapacityKwh:75}};
 assert.notEqual(vehicleGroupDimension(v),vehicleGroupDimension({...v,modelDefinition:{modelYear:2025}}));
 assert.notEqual(vehicleGroupDimension(v),vehicleGroupDimension({...v,assetProfile:{...v.assetProfile,batteryOwnership:'OWNED'}}));
});

test('pre-registration new-car purchase has zero anchor age; future purchases unavailable',()=>{
 assert.equal(purchaseAgeMonths('2025-01-01','2025-02-01','2026-01-01'),0);
 assert.equal(purchaseAgeMonths('2025-03-01','2025-02-01','2026-01-01'),1);
 assert.equal(purchaseAgeMonths('2027-01-01','2025-02-01','2026-01-01'),null);
});
test('quarterly BaaS preserves original calendar period and partial remaining cost',()=>{
 const rows=baasIntervals([{status:'ACTIVE',effectiveFrom:'2026-01-01',effectiveTo:'2026-03-31',firstCostPeriod:'2026-01',billingCycle:'QUARTERLY',rentalAmount:9000,paymentDayOfMonth:1}]);
 assert.equal(rows[0].start,'2026-01-01');assert.equal(rows[0].end,'2026-04-01');assert.equal(rows[0].amount,9000);
 assert.equal(coveredCost('2026-03-01','2026-04-01',rows).amount,3100);
 assert.equal(coveredCost('2026-03-01','2026-05-01',rows).amount,null);
});

test('insurance uses exact Shanghai coverage intervals and prepaid premiums without occupancy',async()=>{
 const {insuranceCost}=await import('../src/pricing-reference/sources');
 const rows=['COMPULSORY_TRAFFIC','COMMERCIAL'].map((policyType,i)=>({id:String(i),versions:[{id:String(i),policyId:String(i),version:1,status:'APPROVED',createdAt:'2025-12-01',effectiveAt:'2025-12-01',startAt:'2025-12-31T16:00:00.000Z',endAt:'2026-01-31T16:00:00.000Z',vehicleIds:['a'],policyType,premiumAmount:3100}]}));
 assert.equal(insuranceCost('2026-01-16','2026-02-01',rows,'a','2026-01-16T00:00:00Z').amount,3200);
 assert.equal(insuranceCost('2026-01-16','2026-03-01',rows,'a','2026-01-16T00:00:00Z').amount,null);
 assert.equal(insuranceCost('2026-01-16','2026-03-01',rows,'a','2026-01-16T00:00:00Z',2800).amount,6000);
});

test('materialized January plan does not erase known later BaaS obligations with zero fallback',async()=>{
 const {baasCost}=await import('../src/pricing-reference/sources');
 const contracts=[{id:'c',status:'ACTIVE',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',firstCostPeriod:'2026-01',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:1}];
 const plans=[{baasContractId:'c',periodStart:'2026-01-01',periodEnd:'2026-01-31',amount:72800}];
 assert.equal(baasCost('2026-02-01','2027-01-01',contracts,plans,0).amount,72800*11);
 assert.equal(baasCost('2026-01-01','2026-02-01',contracts,[...plans,...plans],0).amount,null);
});
test('financial source snapshot excludes private identities, files and banking data',async()=>{
 const {financialSourceView}=await import('../src/pricing-reference/source-view');
 const source=financialSourceView({asset:{purchaseAmount:123,notes:'secret',registeredOwnerName:'secret'},contracts:[{id:'c',rentalAmount:100,lessorCollectionAccountInfo:'secret',lesseeCreditCode:'secret'}],plans:[{id:'p',amount:100,sourceSnapshot:{privateFile:'secret'}}],insurance:[{id:'i',premiumAmount:100,policyholder:'secret',insuredParty:'secret',fileIds:['secret'],registrationSnapshot:{contact:'secret'}}]});
 assert.equal(JSON.stringify(source).includes('secret'),false);assert.equal(source.asset.purchaseAmount,123);assert.equal(source.baasContracts[0].rentalAmount,100);
});

test('review same-day effective instants honor exact cutoff instead of date-prefix comparisons',()=>{
 const review=(effectiveAt:string)=>({id:effectiveAt,lineageId:effectiveAt,version:1,createdAt:'2026-11-12T01:00:00Z',payload:{effectiveAt,observedAt:'2026-11-12',withdrawn:false}});
 const rows=[review('2026-11-12T02:00:00Z'),review('2026-11-12T04:00:00Z')];
 assert.deepEqual(selectReviews(rows,'2026-11-12','2026-11-12T03:00:00Z').map((r:any)=>r.id),['2026-11-12T02:00:00Z']);
});
test('open-ended active BaaS keeps known signed rent through planned exit despite zero budget',async()=>{
 const {baasCost}=await import('../src/pricing-reference/sources');
 assert.equal(baasCost('2026-02-01','2026-04-01',[{id:'c',status:'ACTIVE',effectiveFrom:'2026-01-01',effectiveTo:null,firstCostPeriod:'2026-01',billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:1}],[],0).amount,145600);
});
test('explicit insurance gap budget never erases a known partial insurance premium',async()=>{
 const {insuranceCost}=await import('../src/pricing-reference/sources');
 const rows=[{versions:[{id:'i',version:1,status:'APPROVED',createdAt:'2025-12-01',effectiveAt:'2025-12-01',startAt:'2025-12-31T16:00:00Z',endAt:'2026-01-31T16:00:00Z',vehicleIds:['a'],policyType:'COMPULSORY_TRAFFIC',premiumAmount:3100}]}];
 assert.equal(insuranceCost('2026-01-01','2026-02-01',rows,'a','2026-01-01T00:00:00Z',0).amount,3100);
});


import {assemble} from '../src/pricing-reference/assembly';
function assemblyFixture(){
 const vehicle={id:'a',revision:0,modelDefinitionId:'m',modelDefinition:{modelYear:2026},mileageKm:20000,assetProfile:{batteryOwnership:'OWNED',batteryCapacityKwh:75,purchaseAmount:8000000,purchaseDate:'2025-01-01',firstRegistrationDate:'2025-01-01'},baasContracts:[],assetCostPlans:[]};
 const curve={id:'curve',lineageId:'c',version:1,createdAt:'2025-01-01',payload:{modelDefinitionId:'m',year:2026,batteryOwnership:'OWNED',batteryCapacityKwh:75,configuration:'',mileageMinKm:10000,mileageMaxKm:100000,effectiveFrom:'2025-01-01',valuationDate:'2025-01-01',points:[{ageMonths:0,coefficient:1},{ageMonths:120,coefficient:0.5}]}};
 const reviews:any[]=[];
 const tx:any={vehicle:{findMany:async()=>[vehicle]},pricingReferenceParameter:{findFirst:async()=>({payload:scenario}),findMany:async({where}:any)=>where.kind==='CURVE'?[curve]:reviews},insurancePolicy:{findMany:async()=>[]}};
 const draft:any={configurationVersion:2,name:'group',months:3,minimumTermMonths:3,baseFeeAmount:300000,mileageMonthlyFeeAmount:0,mileagePerMonthKm:1000,excessMileagePriceAmount:100,conditions:'synthetic',swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:100},vehicleIds:['a'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const request:any={scenarioVersionId:'s',pricingDate:'2026-01-01',exitDate:'2027-01-01',groups:[{groupKey:'g',vehicleIds:['a'],draft}],vehicleOverrides:[{vehicleId:'a',conditionConfirmed:true,insuranceMonthlyBudgetCents:0,assumptionNotes:'explicit zero'}]};
 return {tx,request,reviews,curve};
}
test('selected latest review mileage must fit curve without falling back to older anchor',async()=>{
 const {tx,request,reviews}=assemblyFixture();
 const review=(id:string,observedAt:string,mileageKm:number)=>({id,lineageId:id,version:1,createdAt:'2025-12-01',payload:{vehicleId:'a',observedAt,effectiveAt:'2025-12-01',ageMonths:10,mileageKm,valueCents:7000000,withdrawn:false}});
 reviews.push(review('old','2025-10-01',20000),review('latest','2025-11-01',5000));
 const invalid=await assemble(tx,request,'2026-01-01T00:00:00Z');
 assert.equal(invalid.result.vehicles[0].currentValueCents,null);assert.equal(invalid.result.vehicles[0].baseFeeCapCents,null);assert.equal(invalid.result.vehicles[0].annualRoa,null);
 reviews[1].payload.mileageKm=20000;reviews[0].payload.mileageKm=5000;
 assert.equal((await assemble(tx,request,'2026-01-01T00:00:00Z')).result.vehicles[0].complete,true);
});
for(const [start,end,expected] of [['2026-01-01','2036-01-01',120000],['2026-01-15','2036-01-15',120000]] as const)test('120-month BaaS coverage preserves known cost '+start,async()=>{
 const {baasCost}=await import('../src/pricing-reference/sources');
 assert.equal(baasCost(start,end,[{id:'c',status:'ACTIVE',effectiveFrom:'2026-01-01',effectiveTo:null,firstCostPeriod:'2026-01',billingCycle:'MONTHLY',rentalAmount:1000,paymentDayOfMonth:1}],[],0).amount,expected);
});
test('separate customer BaaS needs an explicit income basis and persists exact occupied revenue',async()=>{
 const {tx,request}=assemblyFixture();const group=request.groups[0];group.draft.customerBaas={disposition:'SEPARATE',amount:100,period:'TERM',recipient:'operator'};
 const missing=await assemble(tx,request,'2026-01-01T00:00:00Z');assert.equal(missing.result.vehicles[0].complete,false);assert.ok(missing.result.vehicles[0].missing.includes('CUSTOMER_BAAS_INCOME_BASIS_MISSING'));
 group.customerBaasIncomeTreatment='THIRD_PARTY_DIRECT';group.customerBaasIncomeBasisNotes='Customer pays third party';
 assert.equal(previewInput.safeParse(request).success,true);
 const direct=await assemble(tx,previewInput.parse(request),'2026-01-01T00:00:00Z');assert.equal(direct.result.vehicles[0].complete,true);
 group.customerBaasIncomeTreatment='BUSINESS_REVENUE';group.customerBaasIncomeBasisNotes='Operator receives income';
 const business=await assemble(tx,previewInput.parse(request),'2026-01-01T00:00:00Z');
 assert.deepEqual(business.input.vehicles[0].additionalOccupiedRevenue,{amountCents:100,periodMonths:3});
 assert.equal(business.result.vehicles[0].periodProfitCents-direct.result.vehicles[0].periodProfitCents,280);
 assert.equal(business.groups[0].customerBaasIncomeBasisNotes,'Operator receives income');assert.equal('customerBaasIncomeTreatment' in business.groups[0].draft,false);
 group.draft.customerBaas.period='MONTH';
 const monthly=await assemble(tx,request,'2026-01-01T00:00:00Z');assert.equal(monthly.result.vehicles[0].periodProfitCents-direct.result.vehicles[0].periodProfitCents,840);
 delete group.customerBaasIncomeBasisNotes;assert.equal((await assemble(tx,request,'2026-01-01T00:00:00Z')).result.vehicles[0].complete,false);
});
