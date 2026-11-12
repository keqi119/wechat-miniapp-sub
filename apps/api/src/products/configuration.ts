import {ensure} from '../common/errors';
import {productDraftInput,SELF_PAID_ENERGY,type ProductDraft} from './types';

/** Inputs contain modules; stored versions and public snapshots contain derived totals. */
export function productDraftData(input:ProductDraft){
 const {items,...fields}=input;
 return input.configurationVersion===2?{...fields,monthlyFeeAmount:input.baseFeeAmount+input.mileageMonthlyFeeAmount,energyDescription:SELF_PAID_ENERGY}:{...fields,configurationVersion:1};
}
export function storedProductDraft(version:any):ProductDraft{
 ensure(version.configurationVersion===undefined||version.configurationVersion===1||version.configurationVersion===2,409,'PRODUCT_CONFIGURATION_INVALID','产品配置版本无效');
 const keys=['name','months','conditions','vehicleIds','modelDefinitionIds','mileagePerMonthKm','excessMileagePriceAmount'];
 if(version.configurationVersion===2)keys.push('configurationVersion','baseFeeAmount','mileageMonthlyFeeAmount','swapPolicy');else keys.push('monthlyFeeAmount','energyDescription');
 if(version.customerBaas!=null)keys.push('customerBaas');
 if(version.minimumTermMonths!=null)keys.push('minimumTermMonths');
 const items=(version.items||[]).map((item:any)=>item.kind==='BASE_SUBSCRIPTION'?{kind:item.kind}:{kind:item.kind,benefitVersionId:item.benefitVersionId||item.benefitVersion?.id});
 const draft=productDraftInput.parse({...Object.fromEntries(keys.map(key=>[key,version[key]])),items});
 if(draft.configurationVersion===2)ensure(version.monthlyFeeAmount===draft.baseFeeAmount+draft.mileageMonthlyFeeAmount&&version.energyDescription===SELF_PAID_ENERGY,409,'PRODUCT_CONFIGURATION_INVALID','产品月费或能源说明与模块配置不一致');
 return draft;
}
