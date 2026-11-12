import {customerBaasInput} from '../contract-terms/types';
import {validTermMonths} from '../service-calendar/rules';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {benefitInput,productVersionInclude,ProductSnapshot,ListedProductSnapshot} from './types';
import {storedProductDraft} from './configuration';
export function productApplies(version:any,vehicle:any){return !!version&&!!vehicle&&(version.vehicleIds?.includes(vehicle.id)||!!vehicle.modelDefinitionId&&version.modelDefinitionIds?.includes(vehicle.modelDefinitionId));}
export function versionSnapshot(version:any):ProductSnapshot {
 ensure(version.configurationVersion===undefined||version.configurationVersion===1||version.configurationVersion===2,409,'PRODUCT_CONFIGURATION_INVALID','产品配置版本无效');
 const draft=version.configurationVersion===2?storedProductDraft(version):undefined;
 const modules=draft?.configurationVersion===2?{configurationVersion:2,baseFeeAmount:draft.baseFeeAmount,mileageMonthlyFeeAmount:draft.mileageMonthlyFeeAmount,swapPolicy:draft.swapPolicy}:{};
 const {id,productId,name,months,monthlyFeeAmount,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,conditions,vehicleIds,modelDefinitionIds}=version;
 const benefits=(version.items||[]).filter((v:any)=>v.kind==='BENEFIT').map((item:any)=>{const b=item.benefitVersion;ensure(b,409,'PRODUCT_BENEFITS_INVALID','产品权益版本缺失');const parsed=benefitInput.parse({kind:b.kind,name:b.name,description:b.description,provider:b.provider,conditions:b.conditions,validity:b.validity,unit:b.unit,totalQuantity:b.totalQuantity});return {benefitVersionId:b.id,definitionId:b.definitionId,version:b.version,...parsed};});
 return JSON.parse(JSON.stringify({productId,productVersionId:id,version:version.version,name,months,monthlyFeeAmount,mileagePerMonthKm,excessMileagePriceAmount,energyDescription,conditions,vehicleIds,modelDefinitionIds,benefits,...(version.customerBaas!=null?{customerBaas:customerBaasInput.parse(version.customerBaas)}:{}),...(version.minimumTermMonths!=null?{minimumTermMonths:version.minimumTermMonths}:{}),...modules}));
}
export function validatePublishedVersion(version:any,requireExplicitMinimum=false){
 ensure(validTermMonths(version.months,version.minimumTermMonths)&&(!requireExplicitMinimum||version.minimumTermMonths!=null),409,'PRODUCT_TERM_INVALID','请明确确认最短期限（至少3个月），实际期限不得小于最短期限');
 const {items}=storedProductDraft(version);
 ensure(items.filter((i:any)=>i.kind==='BASE_SUBSCRIPTION').length===1,409,'PRODUCT_COMBINATION_INVALID','产品必须恰好包含一个基础订阅');
 versionSnapshot(version);
}
/** Shared by explicit publication, the public catalog and application snapshots. */
export function validateListingSource(listing:any,version:any,vehicle:any,plan:any):ProductSnapshot{
 ensure(!vehicle?.virtualAcceptanceScopeId,409,'VIRTUAL_PUBLICATION_FORBIDDEN','虚拟验收资产不得进入公开商品');
 ensure(listing&&plan&&version&&vehicle&&listing.subscriptionPlanId===plan.id&&listing.vehicleId===vehicle.id&&plan.vehicleId===vehicle.id&&listing.productVersionId===version.id&&plan.productVersionId===version.id,409,'GOODS_SOURCE_MISMATCH','商品、车辆与产品版本关联不一致');
 ensure(version.status==='PUBLISHED',409,'PRODUCT_UNAVAILABLE','产品未发布或已停用，请重新选择方案');
 ensure(productApplies(version,vehicle),409,'PRODUCT_SCOPE_MISMATCH','车辆不在产品适用范围');
 validatePublishedVersion(version);const snapshot=versionSnapshot(version),sourceHash=canonicalHash(snapshot);
 ensure(['EXPLICIT','LEGACY_MIGRATED'].includes(listing.source),409,'GOODS_SOURCE_MISMATCH','商品来源尚未核实');
 const migrated=listing.source==='LEGACY_MIGRATED'&&listing.productSourceHash==null&&listing.snapshot==null;
 ensure(migrated||listing.productSourceHash===sourceHash&&listing.snapshot&&canonicalHash(listing.snapshot)===sourceHash,409,'GOODS_SOURCE_CHANGED','商品冻结配置已变化，请核对产品版本');
 return snapshot;
}
export function listedProductSnapshot(plan:any):ListedProductSnapshot{
 const listing=plan?.listing;
 ensure(plan?.active&&listing?.status==='PUBLISHED'&&listing.visible===true,409,'GOODS_UNAVAILABLE','商品未发布、不可见或已下架，请重新选择方案');
 const product=validateListingSource(listing,plan.productVersion,plan.vehicle,plan);
 ensure(typeof listing.id==='string'&&listing.id&&Number.isSafeInteger(listing.revision)&&listing.revision>=0,409,'GOODS_SOURCE_MISMATCH','商品版本不完整');
 return{...product,listingId:listing.id,listingRevision:listing.revision,sourceHash:canonicalHash({listingId:listing.id,listingRevision:listing.revision,vehicleId:listing.vehicleId,subscriptionPlanId:plan.id,product})};
}
export async function snapshotProduct(tx:any,subscriptionPlanId:string):Promise<ListedProductSnapshot>{
 const plan=await tx.subscriptionPlan.findUnique({where:{id:subscriptionPlanId},include:{vehicle:true,listing:true,productVersion:{include:productVersionInclude}}});
 if(plan?.vehicle?.virtualAcceptanceScopeId){const {requireCurrentVirtualScope}=await import('../virtual-acceptance/scope'),scope=await requireCurrentVirtualScope(tx,{vehicleId:plan.vehicleId,action:'PRODUCT'});ensure(scope&&plan.active&&plan.productVersionId===scope.productVersionId&&!plan.listing,409,'VIRTUAL_PRODUCT_CHANGED','测试套餐与冻结产品不一致');const product=versionSnapshot(plan.productVersion),listingId=`VIRTUAL:${scope.id}`,listingRevision=scope.revision;return{...product,listingId,listingRevision,sourceHash:canonicalHash({scopeHash:scope.configurationHash,planId:plan.id,product})};}
 return listedProductSnapshot(plan);
}
export function assertProductQuote(snapshot:ProductSnapshot,input:any){
 const matches=['months','mileagePerMonthKm','excessMileagePriceAmount','energyDescription','conditions'].every(k=>input[k]===(snapshot as any)[k]);
 ensure(matches&&JSON.stringify(input.benefits)===JSON.stringify(snapshot.benefits.map(b=>b.name)),409,'PRODUCT_TERMS_CHANGED','报价条款与产品版本不一致，请重新出具方案');
 ensure(input.monthlyFeeAmount===snapshot.monthlyFeeAmount||typeof input.priceAdjustmentReason==='string'&&input.priceAdjustmentReason.trim().length>0,409,'PRODUCT_PRICE_ADJUSTMENT_REQUIRED','月费变更须明确记录报价差异');
}
