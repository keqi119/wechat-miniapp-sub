import { ensure } from '../common/errors';
import { canonicalHash } from '../customers/types';
import { effectiveTerms } from '../order-changes/context';
import { usagePolicyAppendix, validUsageInteger } from './policy';
import {readServiceStage,readServiceStageAt,readPeriodServiceStage} from '../order-service-stages/readiness';

export type UsagePricing={policyVersion:'USAGE_V1'|'USAGE_V2';baseAllowanceKm:number;excessPriceAmount:number;sourceHash:string};

// The original signed order policy is the authority. Current products never price existing usage.
export function freezeUsagePricing(terms:any):UsagePricing{
 usagePolicyAppendix(terms?.usagePolicy);
 const policy=terms.usagePolicy;
 ensure(terms.usagePolicyVersion===policy.policyVersion&&terms.mileagePerMonthKm===policy.baseAllowanceKm&&terms.excessMileagePriceAmount===policy.excessPriceAmount,409,'USAGE_POLICY','订单价格与冻结的里程规则不符');
 return {policyVersion:policy.policyVersion,baseAllowanceKm:policy.baseAllowanceKm,excessPriceAmount:policy.excessPriceAmount,sourceHash:canonicalHash(policy)};
}

function matches(actual:any,expected:UsagePricing){return actual&&Object.entries(expected).every(([key,value])=>actual[key]===value);}
export function assertUsagePolicyUnchanged(original:any,effective:any){
 const pricing=freezeUsagePricing(original);
 ensure(matches(freezeUsagePricing(effective),pricing),409,'USAGE_POLICY','本版不支持变更订单已冻结的里程政策');return pricing;
}

export function resolveUsagePricing(order:any,account:any,period?:any):UsagePricing{
 const expected=freezeUsagePricing(order.finalPlanSnapshot);
 ensure(account.orderId===order.id&&account.customerId===order.customerId&&account.policyVersion===expected.policyVersion,409,'USAGE_PRICING','用量账户与原订单政策或客户不符');
 const validRecord=(snapshot:any)=>snapshot==null&&expected.policyVersion==='USAGE_V1'||matches(snapshot,expected);
 ensure(validRecord(account.pricingSnapshot),409,'USAGE_PRICING','用量账户的冻结价格缺失或与订单不符');
 if(period)ensure(period.accountId===account.id&&period.orderId===order.id&&validRecord(period.pricingSnapshot),409,'USAGE_PRICING','订阅月的冻结价格缺失或与订单不符');
 return expected;
}

async function verifyEffectiveStagePricing(tx:any,order:any){
 if(!order.effectiveTermsVersionId)return null;
 const terms=await effectiveTerms(tx,order);
 if(Object.hasOwn(terms,'serviceStageId')){
  ensure(typeof terms.serviceStageId==='string'&&terms.serviceStageId.trim()===terms.serviceStageId&&terms.serviceStageId.length>0&&!terms.serviceStageId.includes('\0')&&tx.orderServiceStage,409,'USAGE_PRICING','当前条款缺少有效的租期来源');
  const read=await readServiceStage(tx,order,terms.serviceStageId);
  ensure(read.snapshot.kind==='RENEWAL'&&['ACTIVE','ENDED'].includes(read.stage.status)&&canonicalHash(freezeUsagePricing(terms))===canonicalHash(read.snapshot.usagePricing),409,'USAGE_PRICING','当前条款与原生效租期的里程政策不一致');return read;
 }
 const stages=tx.orderServiceStage?await tx.orderServiceStage.findMany({where:{orderId:order.id}}):[];
 ensure(!stages.some((s:any)=>s.orderId===order.id&&s.kind==='RENEWAL'&&(s.termsVersionId===order.effectiveTermsVersionId||s.status==='ACTIVE')),409,'USAGE_PRICING','续期后的当前条款缺少明确租期来源');
 assertUsagePolicyUnchanged(order.finalPlanSnapshot,terms);return null;
}

export async function readUsagePricing(tx:any,order:any,account:any,period?:any,at=new Date()){
 // The account remains anchored to the original policy, even after a later stage activates.
 resolveUsagePricing(order,account);
 if(period?.serviceStageId)return(await readPeriodServiceStage(tx,order,account,period)).snapshot.usagePricing;
 ensure(period?.stageSequence==null,409,'USAGE_PRICING','服务月缺少明确的租期来源');
 const pricing=resolveUsagePricing(order,account,period);
 if(!period&&tx.orderServiceStage){
  const stages=await tx.orderServiceStage.findMany({where:{orderId:order.id}});
  if(stages.length){const current=await readServiceStageAt(tx,order,new Date(at.getTime()+8*3600000).toISOString().slice(0,10)),effective=await verifyEffectiveStagePricing(tx,order);if(current.snapshot.kind==='RENEWAL')ensure(effective?.stage.id===current.stage.id,409,'USAGE_PRICING','当前日期与有效条款的租期不一致');return current.snapshot.usagePricing;}
 }
 await verifyEffectiveStagePricing(tx,order);
 return pricing;
}

export function usagePricingView(pricing:UsagePricing){return {policyVersion:pricing.policyVersion,baseAllowanceKm:pricing.baseAllowanceKm,excessPriceAmount:pricing.excessPriceAmount};}

export function usageExcessAmount(km:number,price:number){
 ensure(validUsageInteger(km)&&validUsageInteger(price),409,'USAGE_AMOUNT','超额里程和单价须为有效非负整数');
 const amount=BigInt(km)*BigInt(price);ensure(amount<=2147483647n,409,'USAGE_AMOUNT_OVERFLOW','超额里程费用超出整数分上限');return Number(amount);
}
