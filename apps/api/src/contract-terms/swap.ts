import {z} from 'zod';
import {canonicalHash} from '../customers/types';
import {calculateUpgradePricing} from '../vehicle-changes/upgrade-pricing';
import {shanghaiDay} from '../usage/rules';
import {calendarDay} from '../service-calendar/rules';

const id=z.string().trim().min(1).max(128),cents=z.number().int().min(0).max(2147483647);
const day=z.iso.date(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema=z.object({
 orderId:id,customerId:id,changeId:id,priorTermsHash:digest,originalAssignmentId:id,
 ownerId:id,targetOwnerId:id,originalVehicleId:id,targetVehicleId:id,
 targetProduct:z.object({productVersionId:id,sourceHash:digest,months:z.number().int().min(3).max(120),minimumTermMonths:z.number().int().min(3).max(120)}).passthrough(),
 depositAmount:cents,originalDepositAmount:cents,currentMonthlyFeeAmount:cents.positive(),targetMonthlyFeeAmount:cents.positive(),serviceFeeAmount:cents,
 serviceAnchor:z.object({firstStartDay:day,anchorDay:z.number().int().min(1).max(31),ruleVersion:z.literal('V31')}).strict(),
 startDate:day,months:z.number().int().min(1).max(120),
 periods:z.array(z.object({sequence:z.number().int().positive(),startDate:day,endDate:day,dueDate:day,amount:cents}).strict()).min(1).max(120)
}).strict();
export type SwapTermsInput=z.input<typeof sourceSchema>;
export type FrozenSwapTerms=ReturnType<typeof freezeSwapTerms>;
const fact=(ok:unknown,code:string)=>{if(!ok)throw new RangeError(code);};
const safe=(n:bigint)=>{fact(n>=0n&&n<=2147483647n,'SWAP_AMOUNT_OVERFLOW');return Number(n);};
const round=(rate:number,days:number,total:number)=>safe((BigInt(rate)*BigInt(days)*2n+BigInt(total))/(2n*BigInt(total)));

/** Caller supplies verified persisted sources. This pure freezer never grants authority or writes money. */
export function freezeSwapTerms(raw:SwapTermsInput){
 const s=sourceSchema.parse(raw);
 fact(s.ownerId===s.targetOwnerId,'OWNER_SWAP_BINDING');
 fact(s.originalVehicleId!==s.targetVehicleId,'SWAP_SAME_VEHICLE');
 fact(s.depositAmount===s.originalDepositAmount,'SWAP_DEPOSIT_IMMUTABLE');
 fact(s.targetProduct.months>=s.targetProduct.minimumTermMonths,'PRODUCT_TERMS_CHANGED');
 const priced=calculateUpgradePricing({...s,deliveryAt:s.startDate+'T00:00:00+08:00'});
 fact(s.periods.length===priced.periods.length,'SWAP_PERIOD_SOURCE');
 s.periods.forEach((p,i)=>fact(p.startDate===priced.periods[i].startDate&&p.endDate===priced.periods[i].endDate&&(i===0||p.sequence===s.periods[i-1].sequence+1),'SWAP_PERIOD_SOURCE'));
 const snapshot={version:1 as const,formula:'V31_SWAP_SERVICE_MONTH_NATURAL_DAYS' as const,...s,endDate:priced.endDate};
 return{snapshot,hash:canonicalHash(snapshot)};
}

export type SwapPaidPeriod={sequence:number;netPaidAmount:number;paymentIds:string[]};
/** Pure factual calculation. Callers must validate payment ownership/allocation under the existing order lock. */
export function calculateSwapFacts(frozen:FrozenSwapTerms,returnedAt:string,deliveredAt:string,paid:readonly SwapPaidPeriod[]){
 fact(frozen?.hash===canonicalHash(frozen?.snapshot),'SWAP_TERMS_CHANGED');
 const {version,formula,endDate,...source}=frozen.snapshot;
 fact(version===1&&formula==='V31_SWAP_SERVICE_MONTH_NATURAL_DAYS'&&freezeSwapTerms(source).hash===frozen.hash,'SWAP_TERMS_CHANGED');
 fact(z.iso.datetime({offset:true}).safeParse(returnedAt).success&&z.iso.datetime({offset:true}).safeParse(deliveredAt).success&&new Date(deliveredAt)>=new Date(returnedAt),'SWAP_FACT_DATES');
 const s=frozen.snapshot,returnedDay=shanghaiDay(new Date(returnedAt)),deliveredDay=shanghaiDay(new Date(deliveredAt));
 fact(returnedDay>=s.startDate&&deliveredDay<endDate,'SWAP_OUTSIDE_TERM');
 fact(paid.length===s.periods.length&&new Set(paid.map(p=>p.sequence)).size===paid.length,'SWAP_PAYMENT_SOURCE');
 const pricing=calculateUpgradePricing({...s,deliveryAt:deliveredAt});
 const periods=s.periods.map((p,i)=>{
  const receipt=paid.find(r=>r.sequence===p.sequence);
  fact(receipt&&cents.safeParse(receipt.netPaidAmount).success&&Array.isArray(receipt.paymentIds)&&receipt.paymentIds.every(v=>id.safeParse(v).success)&&new Set(receipt.paymentIds).size===receipt.paymentIds.length&&(receipt.netPaidAmount===0||receipt.paymentIds.length>0),'SWAP_PAYMENT_SOURCE');
  const gapStart=calendarDay(returnedDay>p.startDate?returnedDay:p.startDate).getTime(),gapEnd=calendarDay(deliveredDay<p.endDate?deliveredDay:p.endDate).getTime();
  const gapDays=Math.max(0,(gapEnd-gapStart)/86400000),upgradeRentAmount=pricing.periods[i].differenceAmount;
  const gapReductionAmount=round(s.currentMonthlyFeeAmount,gapDays,pricing.periods[i].totalDays);
  const amount=safe(BigInt(p.amount)+BigInt(upgradeRentAmount)-BigInt(gapReductionAmount));
  return{...p,originalAmount:p.amount,amount,upgradeRentAmount,gapDays,gapReductionAmount,netPaidAmount:receipt!.netPaidAmount,alreadyPaidCreditAmount:Math.min(amount,receipt!.netPaidAmount),chargeAmount:Math.max(0,amount-receipt!.netPaidAmount),refundAmount:Math.max(0,receipt!.netPaidAmount-amount),paymentIds:[...receipt!.paymentIds]};
 });
 const sum=(key:'upgradeRentAmount'|'gapReductionAmount'|'chargeAmount'|'refundAmount')=>periods.reduce((n,p)=>n+p[key],0);
 return{version:1 as const,termsHash:frozen.hash,returnedAt,deliveredAt,periods,depositAmount:s.depositAmount,serviceFeeAmount:s.serviceFeeAmount,shareableUpgradeRentAmount:sum('upgradeRentAmount'),gapReductionAmount:sum('gapReductionAmount'),rentChargeAmount:sum('chargeAmount'),rentRefundAmount:sum('refundAmount')};
}
