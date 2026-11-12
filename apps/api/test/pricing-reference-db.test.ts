import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {versionSnapshot} from '../src/products/snapshot';

const root='/admin/pricing-reference';
test('pricing versions, review calibration, immutable runs, scoped draft adoption and permissions', {skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();await h.start();
 try{
  const model=await h.db.modelDefinition.create({data:{brand:'合成宁达',name:'定价验收',modelYear:2024,description:'仅本地合成'}});
  const createVehicle=async(label:string,purchaseAmount:number,batteryOwnership='OWNED',capacity=75)=>h.db.vehicle.create({data:{title:h.prefix+'-'+label,brand:'合成宁达',model:'定价验收',modelDefinitionId:model.id,year:2025,mileageKm:10000,city:'上海',revision:0,assetProfile:{create:{purchaseAmount,purchaseDate:new Date('2024-01-01'),firstRegistrationDate:new Date('2024-02-01'),batteryOwnership,batteryCapacityKwh:capacity,createdBy:h.maker.id,updatedBy:h.maker.id}}}});
  const [one,two,baas,outside]=await Promise.all([createVehicle('一',20000000),createVehicle('二',10000000),createVehicle('BaaS',18000000,'BAAS',100),createVehicle('未选车辆',20000000)]);
  const scenarioPayload={name:'合成管理规模',managementVehicleCount:10,monthlyManagementBudgetCents:1200000,occupancyRate:0.8,targetAnnualRoa:0.1,expectedMonthlyMileageKm:1000,variableCostPerOccupiedMonthCents:5000,otherFixedMonthlyCostCents:0,disposalCostCents:0,oneTimeCostCents:0,notes:'固定管理成本已包含全部管理预算；显式合成假设'};
  const scenarioCommand={...command(),payload:scenarioPayload};
  const scenario=await h.post(root+'/scenarios',scenarioCommand,h.finance);
  assert.equal((await h.post(root+'/scenarios',scenarioCommand,h.finance)).id,scenario.id);
  await h.reject(root+'/scenarios',{...scenarioCommand,payload:{...scenarioPayload,name:'changed'}},h.finance,'IDEMPOTENCY_CONFLICT');
  for(const [ownership,capacity] of [['OWNED',75],['BAAS',100]] as const){
   await h.post(root+'/curves',{...command(),payload:{name:'合成曲线 '+ownership,modelDefinitionId:model.id,year:2024,batteryOwnership:ownership,batteryCapacityKwh:capacity,configuration:'',mileageMinKm:0,mileageMaxKm:300000,condition:'正常车况',effectiveFrom:'2024-01-01',valuationDate:'2024-01-01',source:'MANUAL',sourceNotes:'本地合成估值假设',points:[{ageMonths:0,coefficient:1},{ageMonths:12,coefficient:0.8},{ageMonths:24,coefficient:0.6},{ageMonths:36,coefficient:0.4}]}},h.maker);
  }
  const group=(groupKey:string,ids:string[])=>({groupKey,vehicleIds:ids,draft:{configurationVersion:2,name:'合成订阅 '+groupKey,months:12,minimumTermMonths:3,baseFeeAmount:400000,mileageMonthlyFeeAmount:20000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,conditions:'仅本地合成验收，不用于真实交易',swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:50000},vehicleIds:ids,modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]}});
  const request={scenarioVersionId:scenario.id,pricingDate:'2025-02-01',exitDate:'2026-02-01',groups:[group('owned',[one.id,two.id]),group('baas',[baas.id])],vehicleOverrides:[one,two,baas].map(v=>({vehicleId:v.id,insuranceMonthlyBudgetCents:10000,conditionConfirmed:true,assumptionNotes:'合成正常车况核验与未来保险预算',...(v.id===baas.id?{baasMonthlyBudgetCents:72800}:{})}))};
  const preview=await h.post(root+'/preview',request,h.finance);
  assert.equal(preview.result.calculableCount,3);
  assert.equal(preview.result.vehicles.find((v:any)=>v.vehicleId===one.id).currentValueCents,16000000);
  assert.equal(preview.result.groups.find((g:any)=>g.groupKey==='owned').baseFeeCapCents,280000);
  assert.equal(preview.result.groups.find((g:any)=>g.groupKey==='owned').overCapVehicles.length,1);
  const runCommand={...request,...command()},run=await h.post(root+'/runs',runCommand);
  assert.equal((await h.post(root+'/runs',runCommand)).id,run.id);
  const frozen=structuredClone(run.snapshot);
  await h.reject(root+'/runs/'+run.id,undefined,h.support,'FORBIDDEN','GET');
  await h.reject(root+'/runs/'+run.id+'/groups/owned/drafts',command(),h.finance,'FORBIDDEN');
  await h.reject(root+'/preview',{...request,groups:[group('mixed',[one.id,baas.id])],vehicleOverrides:request.vehicleOverrides.filter(v=>v.vehicleId!==two.id)},h.maker,'GROUP_DIMENSION_MISMATCH');
  const incomplete=await h.post(root+'/preview',{...request,vehicleOverrides:request.vehicleOverrides.map(v=>{const {baasMonthlyBudgetCents,...rest}=v;return rest;})});
  assert.equal(incomplete.result.calculableCount,2);
  assert.equal(incomplete.result.vehicles.find((v:any)=>v.vehicleId===baas.id).annualRoa,null);
  const review=await h.post(root+'/reviews',{...command(),payload:{vehicleId:one.id,observedAt:'2025-02-01',effectiveAt:'2025-02-01',ageMonths:12,mileageKm:10000,valueCents:17000000,curveId:null,notes:'合成 review 校准',withdrawn:false}});
  const recalculated=await h.post(root+'/runs',{...request,...command(),recalculatedFromId:run.id});
  assert.equal(recalculated.snapshot.result.vehicles.find((v:any)=>v.vehicleId===one.id).currentValueCents,17000000);
  assert.deepEqual((await h.get(root+'/runs/'+run.id)).snapshot,frozen);
  const withdrawal=await h.post(root+'/reviews',{...command(review.revision),lineageId:review.lineageId,payload:{...review.payload,withdrawn:true,notes:'撤回合成 review'}});
  assert.equal(withdrawal.version,2);
  const afterWithdrawal=await h.post(root+'/preview',request);
  assert.equal(afterWithdrawal.result.vehicles.find((v:any)=>v.vehicleId===one.id).currentValueCents,16000000);
  await h.reject(root+'/reviews',{...command(review.revision),lineageId:review.lineageId,payload:review.payload},h.maker,'REVISION_CONFLICT');
  const next=await h.post(root+'/scenarios',{...command(scenario.revision),lineageId:scenario.lineageId,payload:{...scenarioPayload,name:'合成新场景',managementVehicleCount:20}},h.finance);
  assert.equal(next.version,2);
  assert.deepEqual((await h.get(root+'/runs/'+run.id)).snapshot,frozen);
  const adoptCommand=command(),route=root+'/runs/'+run.id+'/groups/owned/drafts';
  const results=await Promise.all([h.post(route,adoptCommand),h.post(route,adoptCommand)]);
  assert.equal(results[0].productVersionId,results[1].productVersionId);
  assert.equal((await h.post(route,command())).productVersionId,results[0].productVersionId);
  const version=await h.db.productVersion.findUniqueOrThrow({where:{id:results[0].productVersionId},include:{items:{include:{benefitVersion:true}}}});
  assert.equal(version.status,'DRAFT');assert.equal(version.baseFeeAmount,400000);
  assert.deepEqual([...version.vehicleIds].sort(),[one.id,two.id].sort());assert.deepEqual(version.modelDefinitionIds,[]);assert(!version.vehicleIds.includes(outside.id));
  assert.equal(await h.db.pricingReferenceAdoption.count({where:{runId:run.id,groupKey:'owned'}}),1);
  assert.equal(await h.db.vehicleListing.count({where:{productVersionId:version.id}}),0);
  const customerSnapshot=JSON.stringify(versionSnapshot(version));
  for(const forbidden of ['annualRoa','purchaseAmount','sourceSnapshot','managementVehicleCount'])assert.equal(customerSnapshot.includes(forbidden),false);
  assert.deepEqual((await h.get(root+'/runs/'+run.id)).snapshot,frozen);
  const financeSelection=await h.get('/admin/vehicles?view=pricing-selection&pageSize=100',h.finance);
  assert(financeSelection.items.every((v:any)=>!('assetProfile' in v)&&!('cooperationOwner' in v)));
  assert.equal(h.externalCalls+h.esignCalls+h.identityCalls,0);
 }finally{await h.close();}
});
