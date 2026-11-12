import {dateOnly} from '../billing/rules';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {snapshotProduct} from '../products/snapshot';
import type {ListedProductSnapshot} from '../products/types';
import {offlineSwapTargetInput} from './offline-pricing-input';
import {calculateUpgradePricing,type UpgradePricing} from './upgrade-pricing';
import {parseSwapStageScope,type SwapStageScope} from './stage-source';

const MAX_INT=2147483647;
export interface OfflineSwapTarget {
 vehicleId:string;
 subscriptionPlanId:string;
 product:ListedProductSnapshot;
}
export interface OfflineSwapCurrentPeriod {
 sequence:number;
 stageSequence?:number;
 startDate:string;
 endDate:string;
 dueDate:string;
 amount:number;
}
export interface OfflineSwapPricedPeriod extends OfflineSwapCurrentPeriod {
 originalAmount:number;
 differenceAmount:number;
}
export interface OfflineSwapPricingInput {
 serviceStageScope?:SwapStageScope;
 priorTermsVersionId:string|null;
 priorTermsHash:string;
 originalStartDate:string;
 months:number;
 currentMonthlyFeeAmount:number;
 /** Server-validated snapshot from loadOfflineSwapTarget, never a client quote body. */
 target:OfflineSwapTarget;
 deliveryAt:string;
 /** Current effective obligations, including earlier upgrades, not original catalog prices. */
 currentPeriods:readonly OfflineSwapCurrentPeriod[];
}
export interface OfflineSwapPricing {
 serviceStageScope?:SwapStageScope;
 pricingVersion:2;
 financialGate:'BEFORE_RETURN';
 priorTermsVersionId:string|null;
 priorTermsHash:string;
 currentMonthlyFeeAmount:number;
 targetMonthlyFeeAmount:number;
 target:OfflineSwapTarget;
 pricing:UpgradePricing;
 periods:OfflineSwapPricedPeriod[];
 totalOriginalAmount:number;
 totalAmount:number;
 pricingHash:string;
}

/** Read a NEW quote's target inside the caller's transaction/vehicle lock.
 * snapshotProduct supplies publication, visibility, scope and immutable-source checks.
 * This does not replace live stock, allocation, same-owner, qualification or coverage guards.
 * A previously agreed quote uses its frozen target and must not be repriced from this loader.
 */
export async function loadOfflineSwapTarget(tx:any,raw:unknown):Promise<OfflineSwapTarget>{
 const input=offlineSwapTargetInput.parse(raw);
 const listing=await tx.vehicleListing.findUnique({where:{id:input.targetListingId},select:{id:true,revision:true,vehicleId:true,subscriptionPlanId:true}});
 ensure(listing,409,'GOODS_UNAVAILABLE','目标商品不存在或已不可用');
 const product=await snapshotProduct(tx,listing.subscriptionPlanId);
 ensure(product.listingId===listing.id&&product.listingRevision===listing.revision&&product.listingRevision===input.targetListingRevision&&product.sourceHash===input.targetSourceHash,409,'GOODS_SOURCE_CHANGED','目标商品来源或版本已变化，请重新选择');
 return{vehicleId:listing.vehicleId,subscriptionPlanId:listing.subscriptionPlanId,product};
}

function storedAmount(value:unknown,field:string):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>MAX_INT)throw new RangeError(`OFFLINE_SWAP_PRICING_INVALID_AMOUNT: ${field}`);
 return value;
}
function safeTotal(value:bigint):number{
 if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('OFFLINE_SWAP_PRICING_AMOUNT_OVERFLOW');
 return Number(value);
}
function realDay(value:unknown):value is string{
 try{return typeof value==='string'&&!value.startsWith('0000-')&&!!dateOnly(value);}catch{return false;}
}
function id(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0&&value.length<=128&&!value.includes('\0');}

/** Pure automatic upgrade calculation; no bills, refunds, usage or TERM rights are changed.
 * Each original-period obligation is increased by only this upgrade's rounded difference.
 */
export function composeOfflineSwapPricing(input:OfflineSwapPricingInput):OfflineSwapPricing{
 if(!input||!realDay(input.originalStartDate)||input.priorTermsVersionId!==null&&!id(input.priorTermsVersionId)||!/^[a-f0-9]{64}$/.test(input.priorTermsHash))throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_SOURCE');
 const target=input.target,product=target?.product;
 if(!target||!id(target.vehicleId)||!id(target.subscriptionPlanId)||!product||!id(product.productId)||!id(product.productVersionId))throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_SOURCE');
 offlineSwapTargetInput.parse({targetListingId:product.listingId,targetListingRevision:product.listingRevision,targetSourceHash:product.sourceHash});
 const currentMonthlyFeeAmount=storedAmount(input.currentMonthlyFeeAmount,'currentMonthlyFeeAmount'),targetMonthlyFeeAmount=storedAmount(product.monthlyFeeAmount,'targetMonthlyFeeAmount');
 if(targetMonthlyFeeAmount===0)throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_AMOUNT: targetMonthlyFeeAmount');
 const scope=input.serviceStageScope===undefined?null:parseSwapStageScope(input.serviceStageScope);
 if(scope&&(scope.startDate!==input.originalStartDate||scope.months!==input.months))throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_SOURCE');
 const local=calculateUpgradePricing({startDate:input.originalStartDate,months:input.months,currentMonthlyFeeAmount,targetMonthlyFeeAmount,deliveryAt:input.deliveryAt,...(scope?.serviceAnchor?{serviceAnchor:scope.serviceAnchor}:{})});
 const pricing:UpgradePricing=scope?{...local,periods:local.periods.map(p=>({...p,sequence:scope.firstPeriodSequence+p.sequence-1,stageSequence:p.sequence}))}:local;
 if(!Array.isArray(input.currentPeriods)||input.currentPeriods.length!==pricing.periods.length)throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_PERIODS');
 const originals=new Map<number,OfflineSwapCurrentPeriod>();
 for(const row of input.currentPeriods){
  if(!row||!Number.isInteger(row.sequence)||row.sequence<(scope?.firstPeriodSequence??1)||row.sequence>(scope?.lastPeriodSequence??input.months)||(scope?row.stageSequence!==row.sequence-scope.firstPeriodSequence+1:row.stageSequence!=null)||originals.has(row.sequence)||!realDay(row.dueDate))throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_PERIODS');
  storedAmount(row.amount,'currentPeriod.amount');originals.set(row.sequence,row);
 }
 let totalOriginalAmount=0n,totalAmount=0n;
 const periods=pricing.periods.map(period=>{
  const original=originals.get(period.sequence);
  if(!original||original.startDate!==period.startDate||original.endDate!==period.endDate)throw new RangeError('OFFLINE_SWAP_PRICING_INVALID_PERIODS');
  const amount=BigInt(original.amount)+BigInt(period.differenceAmount);
  if(amount>BigInt(MAX_INT))throw new RangeError('OFFLINE_SWAP_PRICING_AMOUNT_OVERFLOW');
  totalOriginalAmount+=BigInt(original.amount);totalAmount+=amount;
  return{sequence:period.sequence,...(scope?{stageSequence:period.sequence-scope.firstPeriodSequence+1}:{}),startDate:period.startDate,endDate:period.endDate,dueDate:original.dueDate,originalAmount:original.amount,differenceAmount:period.differenceAmount,amount:Number(amount)};
 });
 const snapshot={...(scope?{serviceStageScope:scope}:{}),pricingVersion:2 as const,financialGate:'BEFORE_RETURN' as const,priorTermsVersionId:input.priorTermsVersionId,priorTermsHash:input.priorTermsHash,currentMonthlyFeeAmount,targetMonthlyFeeAmount,target:JSON.parse(JSON.stringify(target)) as OfflineSwapTarget,pricing,periods,totalOriginalAmount:safeTotal(totalOriginalAmount),totalAmount:safeTotal(totalAmount)};
 return{...snapshot,pricingHash:canonicalHash(snapshot)};
}
