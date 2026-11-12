import {z} from 'zod';
import {dateOnly} from '../billing/rules';
import {day,periods,shanghaiDay} from '../usage/rules';
import {servicePeriods} from '../service-calendar/rules';
import type {ServiceAnchor} from '../service-calendar/types';

export const UPGRADE_PRICING_RULE_VERSION='SWAP_UPGRADE_ACTUAL_DAYS_V1' as const;
const DAY_MS=86400000,MAX_AMOUNT=BigInt(Number.MAX_SAFE_INTEGER);
const zonedTimestamp=z.iso.datetime({offset:true});

export interface UpgradePricingInput {
 readonly startDate:string;
 readonly months:number;
 /** Frozen current effective monthly fee, in integer cents. */
 readonly currentMonthlyFeeAmount:number;
 /** Selected target fee frozen for this calculation, in integer cents. */
 readonly targetMonthlyFeeAmount:number;
 readonly deliveryAt:string;
 /** Original service anchor, never a clipped renewal day or billing sequence. */
 readonly serviceAnchor?:ServiceAnchor;
}
export interface UpgradePricingPeriod {
 sequence:number;
 startDate:string;
 /** Exclusive original service-month boundary. */
 endDate:string;
 totalDays:number;
 chargeDays:number;
 differenceAmount:number;
}
export interface UpgradePricing {
 ruleVersion:typeof UPGRADE_PRICING_RULE_VERSION;
 timeZone:'Asia/Shanghai';
 startDate:string;
 /** Exclusive original contract boundary; a swap never extends it. */
 endDate:string;
 deliveryDate:string;
 monthlyDifferenceAmount:number;
 periods:UpgradePricingPeriod[];
 totalDifferenceAmount:number;
}
function cents(value:unknown,field:string):bigint {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new RangeError(`UPGRADE_PRICING_INVALID_AMOUNT: ${field}`);
 return BigInt(value);
}
function safeAmount(value:bigint):number {
 if(value>MAX_AMOUNT)throw new RangeError('UPGRADE_PRICING_AMOUNT_OVERFLOW');
 return Number(value);
}

/** Pure quotation only: original months, Shanghai delivery day included, per-period half-up cents. */
export function calculateUpgradePricing(input:UpgradePricingInput):UpgradePricing {
 if(!input||typeof input!=='object')throw new RangeError('UPGRADE_PRICING_INVALID_INPUT');
 try{if(typeof input.startDate!=='string')throw Error();dateOnly(input.startDate);}catch{throw new RangeError('UPGRADE_PRICING_INVALID_DATE: startDate');}
 if(!Number.isInteger(input.months)||input.months<1||input.months>120)throw new RangeError('UPGRADE_PRICING_INVALID_TERM: months');
 if(!zonedTimestamp.safeParse(input.deliveryAt).success)throw new RangeError('UPGRADE_PRICING_INVALID_DATE: deliveryAt');
 const delivered=new Date(input.deliveryAt);
 if(!Number.isFinite(delivered.getTime()))throw new RangeError('UPGRADE_PRICING_INVALID_DATE: deliveryAt');
 const deliveryDate=shanghaiDay(delivered);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate))throw new RangeError('UPGRADE_PRICING_INVALID_DATE: deliveryAt');
 const current=cents(input.currentMonthlyFeeAmount,'currentMonthlyFeeAmount'),target=cents(input.targetMonthlyFeeAmount,'targetMonthlyFeeAmount');
 if(target<current)throw new RangeError('UPGRADE_PRICING_DOWNGRADE_NOT_SUPPORTED');
 const monthlyDifference=target-current;
 let original=periods(input.startDate,input.months);
 if(input.serviceAnchor){
  const first=dateOnly(input.serviceAnchor.firstStartDay),start=dateOnly(input.startDate);
  const offset=(start.getUTCFullYear()-first.getUTCFullYear())*12+start.getUTCMonth()-first.getUTCMonth()+1;
  original=servicePeriods(input.serviceAnchor,offset,input.months).map((p,i)=>({sequence:i+1,startDate:dateOnly(p.startDay),endDate:dateOnly(p.endDayExclusive),effectiveEndDate:dateOnly(p.endDayExclusive)}));
 }
 // Reject unsupported calendar boundaries rather than silently shifting the original term.
 if(day(original[0].startDate)!==input.startDate||original.some(p=>!/^\d{4}-\d{2}-\d{2}$/.test(day(p.endDate))))throw new RangeError('UPGRADE_PRICING_INVALID_TERM: startDate/months');
 const endDate=day(original[original.length-1].endDate);
 if(deliveryDate<input.startDate||deliveryDate>=endDate)throw new RangeError('UPGRADE_PRICING_OUTSIDE_TERM');
 const deliveredDay=dateOnly(deliveryDate).getTime();let total=0n;
 const priced=original.map(period=>{
  const start=period.startDate.getTime(),end=period.endDate.getTime(),totalDays=(end-start)/DAY_MS;
  if(!Number.isSafeInteger(totalDays)||totalDays<=0)throw new RangeError('UPGRADE_PRICING_INVALID_TERM: startDate/months');
  const chargeDays=Math.max(0,(end-Math.max(start,deliveredDay))/DAY_MS);
  const denominator=BigInt(totalDays),numerator=monthlyDifference*BigInt(chargeDays);
  const rounded=numerator/denominator+(numerator%denominator*2n>=denominator?1n:0n);
  total+=rounded;
  return{sequence:period.sequence,startDate:day(period.startDate),endDate:day(period.endDate),totalDays,chargeDays,differenceAmount:safeAmount(rounded)};
 });
 return{ruleVersion:UPGRADE_PRICING_RULE_VERSION,timeZone:'Asia/Shanghai',startDate:input.startDate,endDate,deliveryDate,monthlyDifferenceAmount:safeAmount(monthlyDifference),periods:priced,totalDifferenceAmount:safeAmount(total)};
}
