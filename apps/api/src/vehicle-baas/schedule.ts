import {z} from 'zod';
import {money} from '../common/data';
import {ensure} from '../common/errors';
import {addMonths,dateAtDay,monthsBetween,parseDate,periodEnd,periodStart} from '../asset-costs/calendar';

const inputSchema=z.object({
 fromPeriod:z.string(),toPeriod:z.string(),billingCycle:z.enum(['MONTHLY','QUARTERLY','YEARLY']),
 rentalAmount:money.positive(),paymentDayOfMonth:z.number().int().min(1).max(31),
 effectiveFrom:z.string(),effectiveTo:z.string().nullable(),firstCostPeriod:z.string().optional(),
}).strict();
export type BaasScheduleInput=z.input<typeof inputSchema>;
export type BaasWarningId=`${string}:OUTSIDE_CONTRACT_${'START'|'END'}`;
export type BaasScheduleRow={costPeriod:string;periodStart:string;periodEnd:string;dueDate:string;amount:number;warningIds:BaasWarningId[]};
export type BaasSchedulePreview={algorithmVersion:'BAAS_FULL_PERIOD_V1';rows:BaasScheduleRow[];totalAmount:number;warningIds:BaasWarningId[]};

/** Preview only. A cycle always retains its complete dates and original rental amount. */
export function previewBaasSchedule(raw:BaasScheduleInput):BaasSchedulePreview{
 const input=inputSchema.parse(raw),cycleMonths={MONTHLY:1,QUARTERLY:3,YEARLY:12}[input.billingCycle];
 const distance=monthsBetween(input.fromPeriod,input.toPeriod);
 ensure(distance>=0,400,'VALIDATION','截止账期不得早于开始账期');
 parseDate(input.effectiveFrom);
 if(input.effectiveTo!==null){parseDate(input.effectiveTo);ensure(input.effectiveFrom<=input.effectiveTo,400,'VALIDATION','合同结束日期不得早于开始日期');}
 if(input.firstCostPeriod!==undefined)ensure(monthsBetween(input.firstCostPeriod,input.fromPeriod)%cycleMonths===0,400,'BAAS_PERIOD_PHASE','开始账期须与原首期保持同一计费周期');
 const count=Math.floor(distance/cycleMonths)+1;
 ensure(count<=120,400,'SCHEDULE_LIMIT','一次最多预览 120 期，请缩小范围');
 const rows:BaasScheduleRow[]=[],warningIds:BaasWarningId[]=[];
 let total=0n;
 for(let index=0;index<count;index++){
  const costPeriod=addMonths(input.fromPeriod,index*cycleMonths),start=periodStart(costPeriod),end=periodEnd(addMonths(costPeriod,cycleMonths-1));
  const rowWarnings:BaasWarningId[]=[];
  if(start<input.effectiveFrom)rowWarnings.push(`${costPeriod}:OUTSIDE_CONTRACT_START`);
  if(input.effectiveTo!==null&&end>input.effectiveTo)rowWarnings.push(`${costPeriod}:OUTSIDE_CONTRACT_END`);
  rows.push({costPeriod,periodStart:start,periodEnd:end,dueDate:dateAtDay(costPeriod,input.paymentDayOfMonth),amount:input.rentalAmount,warningIds:rowWarnings});
  warningIds.push(...rowWarnings);total+=BigInt(input.rentalAmount);
 }
 ensure(total<=BigInt(Number.MAX_SAFE_INTEGER),400,'AMOUNT_OVERFLOW','预览总额超出安全整数范围');
 return{algorithmVersion:'BAAS_FULL_PERIOD_V1',rows,totalAmount:Number(total),warningIds};
}
