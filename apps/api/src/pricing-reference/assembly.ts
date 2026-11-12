import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {financialSourceView} from './source-view';
import {calculatePricingReference,selectReview} from './engine';
import type {PricingReferenceInput,PricingVehicleInput} from './engine-types';
import {ageMonths,baasIntervals,coveredCost,isoDay,selectReviews,CostInterval,purchaseAgeMonths,insuranceCost,baasCost,effectiveInstant} from './sources';


const nextDay=(v:any)=>new Date(new Date(v).getTime()+86400000).toISOString().slice(0,10);
function latestCurves(rows:any[],date:string,cutoff:string){const map=new Map<string,any>();for(const row of rows){if(new Date(row.createdAt)>new Date(cutoff)||row.payload.effectiveFrom>date||row.payload.valuationDate>date)continue;const previous=map.get(row.lineageId);if(!previous||row.version>previous.version)map.set(row.lineageId,row);}return [...map.values()];}
export function vehicleGroupDimension(v:any){return JSON.stringify([v.modelDefinitionId,v.modelDefinition?.modelYear??null,v.assetProfile?.batteryOwnership??'UNKNOWN',v.assetProfile?.batteryCapacityKwh==null?null:Number(v.assetProfile.batteryCapacityKwh)]);}
export async function assemble(tx:any,request:any,cutoff:string){
 const scenario=await tx.pricingReferenceParameter.findFirst({where:{id:request.scenarioVersionId,kind:'SCENARIO'}});ensure(scenario,404,'SCENARIO_NOT_FOUND','经营场景版本不存在');
 const ids=request.groups.flatMap((g:any)=>g.vehicleIds),vehicles=await tx.vehicle.findMany({where:{id:{in:ids}},include:{modelDefinition:true,assetProfile:true,conditionAssessment:true,baasContracts:true,assetCostPlans:{where:{sourceKind:'BAAS',status:{not:'VOIDED'}}}}});
 ensure(vehicles.length===ids.length,404,'VEHICLE_NOT_FOUND','选定车辆不存在');
 const [curves,reviews,policies]=await Promise.all([tx.pricingReferenceParameter.findMany({where:{kind:'CURVE'}}),tx.pricingReferenceParameter.findMany({where:{kind:'REVIEW'}}),tx.insurancePolicy.findMany({where:{versions:{some:{vehicleIds:{hasSome:ids}}}},include:{versions:true}})]);
 const candidates=latestCurves(curves,request.pricingDate,cutoff),validReviews=selectReviews(reviews,request.pricingDate,cutoff),sourceVehicles:any[]=[],engineVehicles:PricingVehicleInput[]=[];
 for(const group of request.groups){const members=group.vehicleIds.map((id:string)=>vehicles.find((v:any)=>v.id===id));ensure(new Set(members.map(vehicleGroupDimension)).size===1,400,'GROUP_DIMENSION_MISMATCH','不同车型、年款或电池方式/规格必须分组');
  for(const vehicle of members){const asset=vehicle.assetProfile,override=request.vehicleOverrides.find((o:any)=>o.vehicleId===vehicle.id)??{},exitDate=override.exitDate??request.exitDate,holdingMonths=ageMonths(request.pricingDate,exitDate),missing:string[]=[];
   ensure(holdingMonths>0&&holdingMonths<=120,400,'HOLDING_RANGE','剩余经营期须大于0且不超过120个月');
   const registration=asset?.firstRegistrationDate?isoDay(asset.firstRegistrationDate):null,purchaseDate=asset?.purchaseDate?isoDay(asset.purchaseDate):null;
   if(!registration||registration>request.pricingDate)missing.push('FIRST_REGISTRATION_DATE_MISSING_OR_FUTURE');
   const currentAge=registration?ageMonths(registration,request.pricingDate):0,exitAge=registration?ageMonths(registration,exitDate):holdingMonths;
   const matches=(row:any)=>{const p=row.payload;return p.modelDefinitionId===vehicle.modelDefinitionId&&p.year===vehicle.modelDefinition?.modelYear&&p.batteryOwnership===asset?.batteryOwnership&&p.batteryCapacityKwh===(asset?.batteryCapacityKwh==null?null:Number(asset.batteryCapacityKwh))&&p.mileageMinKm<=vehicle.mileageKm&&p.mileageMaxKm>=vehicle.mileageKm&&p.effectiveFrom<=request.pricingDate&&p.valuationDate<=request.pricingDate;};
   let curve:any=null;
   if(override.curveId){curve=curves.find((c:any)=>c.id===override.curveId&&matches(c)&&new Date(c.createdAt)<=new Date(cutoff));if(!curve)missing.push('EXPLICIT_CURVE_NOT_APPLICABLE');}
   else{const possible=candidates.filter((c:any)=>matches(c)&&c.payload.configuration==='');if(possible.length===1)curve=possible[0];else missing.push(possible.length?'CURVE_MATCH_AMBIGUOUS':'CURVE_MATCH_MISSING');}
   if(!registration||registration>request.pricingDate)curve=null;
   if(!override.conditionConfirmed){missing.push('CONDITION_APPLICABILITY_UNCONFIRMED');curve=null;}
   if(curve&&vehicle.mileageKm+holdingMonths*scenario.payload.occupancyRate*scenario.payload.expectedMonthlyMileageKm>curve.payload.mileageMaxKm)missing.push('EXIT_MILEAGE_OUTSIDE_CURVE');
   const selectedReviews=validReviews.filter((r:any)=>r.payload.vehicleId===vehicle.id),owned=asset?.batteryOwnership==='OWNED';
   const chosenReview=selectReview(selectedReviews.map((r:any)=>({id:r.id,...r.payload,recordedAt:new Date(r.createdAt).toISOString(),effectiveAt:effectiveInstant(r.payload.effectiveAt)})),Date.parse(request.pricingDate),Date.parse(cutoff));
   if(curve&&chosenReview&&chosenReview!=='AMBIGUOUS'){
    const mileage=(chosenReview as any).mileageKm;
    if(mileage<curve.payload.mileageMinKm||mileage>curve.payload.mileageMaxKm){missing.push('REVIEW_MILEAGE_OUTSIDE_CURVE');curve=null;}
   }
   const customerBaas=group.draft.customerBaas;
   let additionalOccupiedRevenue:{amountCents:number,periodMonths:number}|undefined;
   if(customerBaas?.disposition==='SEPARATE'){
    if(!group.customerBaasIncomeTreatment||!group.customerBaasIncomeBasisNotes?.trim())missing.push('CUSTOMER_BAAS_INCOME_BASIS_MISSING');
    else if(group.customerBaasIncomeTreatment==='BUSINESS_REVENUE')additionalOccupiedRevenue={amountCents:customerBaas.amount,periodMonths:customerBaas.period==='MONTH'?1:group.draft.months};
   }
   // Original source plans preserve the actual charge cycle. Unknown periods need a named budget.
   const baas=owned?{amount:0,missingDays:0,ambiguous:false}:baasCost(request.pricingDate,exitDate,vehicle.baasContracts,vehicle.assetCostPlans,override.baasMonthlyBudgetCents);
   if(!['OWNED','BAAS'].includes(asset?.batteryOwnership))missing.push('BATTERY_OWNERSHIP_UNKNOWN');
   const insuranceRows=policies.flatMap((p:any)=>p.versions.filter((v:any)=>new Date(v.createdAt)<=new Date(cutoff))),insurance=insuranceCost(request.pricingDate,exitDate,policies,vehicle.id,cutoff,override.insuranceMonthlyBudgetCents),s=scenario.payload;
   const fixed=s.otherFixedMonthlyCostCents===null||insurance.amount===null?null:Math.round(s.otherFixedMonthlyCostCents*holdingMonths)+insurance.amount;
   const input:PricingVehicleInput={vehicleId:vehicle.id,groupKey:group.groupKey,currentAgeMonths:currentAge,exitAgeMonths:exitAge,holdingMonths,purchaseAmountCents:asset?.purchaseAmount??null,purchaseAgeMonths:purchaseAgeMonths(purchaseDate,registration,request.pricingDate),curve:curve?{id:curve.id,points:curve.payload.points}:null,reviews:selectedReviews.map((r:any)=>({id:r.id,...r.payload,recordedAt:new Date(r.createdAt).toISOString(),observedAt:r.payload.observedAt,effectiveAt:effectiveInstant(r.payload.effectiveAt)})),baseFeeCents:group.draft.baseFeeAmount,...(additionalOccupiedRevenue?{additionalOccupiedRevenue}:{}),nonBaseMonthlyRevenueCents:group.draft.mileageMonthlyFeeAmount,variableCostPerOccupiedMonthCents:s.variableCostPerOccupiedMonthCents,holdingBaasCostCents:baas.amount,holdingOtherFixedCostCents:fixed,disposalCostCents:override.disposalCostCents??s.disposalCostCents,oneTimeCostCents:override.oneTimeCostCents??s.oneTimeCostCents,valuationMissing:missing};
   engineVehicles.push(input);sourceVehicles.push({vehicleId:vehicle.id,vehicleRevision:vehicle.revision,...financialSourceView({asset,contracts:vehicle.baasContracts,plans:vehicle.assetCostPlans,insurance:insuranceRows}),vehicle:{modelDefinitionId:vehicle.modelDefinitionId,modelYear:vehicle.modelDefinition?.modelYear??null,mileageKm:vehicle.mileageKm,title:vehicle.title,vin:vehicle.vin},purchaseDate,registrationDate:registration,exitDate,curve,reviewVersions:selectedReviews,baasCoverage:baas,insuranceCoverage:insurance,assumptions:{...override,insuranceCoverageRule:'COMPULSORY_TRAFFIC_AND_COMMERCIAL; full premium only single-vehicle policies; budget covers uncovered dates',expectedExitMileageKm:vehicle.mileageKm+holdingMonths*s.occupancyRate*s.expectedMonthlyMileageKm},sourceHash:hash({asset,curve,reviews:selectedReviews,contracts:vehicle.baasContracts,insuranceRows})});
  }
 }
 const input:PricingReferenceInput={pricingDate:request.pricingDate,knowledgeCutoff:cutoff,scenario:scenario.payload,vehicles:engineVehicles};
 return JSON.parse(JSON.stringify({request,knowledgeCutoff:cutoff,input,sourceSnapshot:{scenario,vehicles:sourceVehicles},result:calculatePricingReference(input),groups:request.groups}));
}
