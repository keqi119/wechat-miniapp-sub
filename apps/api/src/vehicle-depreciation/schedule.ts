import {z} from 'zod';
import {money} from '../common/data';
import {ensure} from '../common/errors';
import {addMonths,parsePeriod,periodEnd,periodOf,periodStart} from '../asset-costs/calendar';

const common={basisAmount:money,residualAmount:money,startDate:z.string()};
const manualPeriodSchema=z.object({costPeriod:z.string(),amount:money,reason:z.string().trim().min(1).max(5000)}).strict();
const inputSchema=z.discriminatedUnion('method',[
 z.object({...common,method:z.literal('STRAIGHT_LINE'),usefulLifeMonths:z.number().int().min(1).max(120)}).strict(),
 z.object({...common,method:z.literal('MANUAL'),manualPeriods:z.array(manualPeriodSchema).max(120,'一次最多预览 120 期，请缩小范围')}).strict(),
 z.object({...common,method:z.literal('NONE'),manualPeriods:z.array(manualPeriodSchema).max(0).optional()}).strict(),
]);
export type ManualDepreciationPeriod=z.input<typeof manualPeriodSchema>;
export type DepreciationScheduleInput=z.input<typeof inputSchema>;
export type DepreciationScheduleRow={costPeriod:string;periodStart:string;periodEnd:string;amount:number;reason?:string};
export type DepreciationSchedulePreview={algorithmVersion:'DEPRECIATION_STRAIGHT_LINE_V1'|'DEPRECIATION_MANUAL_V1'|'DEPRECIATION_NONE_V1';rows:DepreciationScheduleRow[];depreciableAmount:number;totalAmount:number};

/** Preview only; a shortened first calendar month is still one full depreciation period. */
export function previewDepreciationSchedule(raw:DepreciationScheduleInput):DepreciationSchedulePreview{
 const input=inputSchema.parse(raw),firstPeriod=periodOf(input.startDate);
 ensure(input.residualAmount<=input.basisAmount,400,'VALIDATION','残值不得超过折旧基数');
 const depreciableAmount=input.basisAmount-input.residualAmount,rows:DepreciationScheduleRow[]=[];
 if(input.method==='NONE')return{algorithmVersion:'DEPRECIATION_NONE_V1',rows,depreciableAmount,totalAmount:0};
 const makeRow=(costPeriod:string,amount:number):DepreciationScheduleRow=>({costPeriod,periodStart:costPeriod===firstPeriod?input.startDate:periodStart(costPeriod),periodEnd:periodEnd(costPeriod),amount});
 if(input.method==='STRAIGHT_LINE'){
  // Check the end before generating any rows, including the year 9999 boundary.
  addMonths(firstPeriod,input.usefulLifeMonths-1);
  const available=BigInt(depreciableAmount),monthly=available/BigInt(input.usefulLifeMonths);
  for(let index=0;index<input.usefulLifeMonths;index++){
   const amount=index===input.usefulLifeMonths-1?available-monthly*BigInt(input.usefulLifeMonths-1):monthly;
   rows.push(makeRow(addMonths(firstPeriod,index),Number(amount)));
  }
 }else{
  const seen=new Set<string>();
  for(const period of input.manualPeriods){
   parsePeriod(period.costPeriod);
   ensure(period.costPeriod>=firstPeriod,400,'VALIDATION','手工折旧账期不得早于起算月');
   ensure(!seen.has(period.costPeriod),400,'DUPLICATE_PERIOD','手工折旧账期不得重复');
   seen.add(period.costPeriod);rows.push({...makeRow(period.costPeriod,period.amount),reason:period.reason});
  }
  rows.sort((a,b)=>a.costPeriod<b.costPeriod?-1:a.costPeriod>b.costPeriod?1:0);
 }
 const total=rows.reduce((sum,row)=>sum+BigInt(row.amount),0n);
 ensure(total<=BigInt(Number.MAX_SAFE_INTEGER),400,'AMOUNT_OVERFLOW','预览总额超出安全整数范围');
 ensure(total<=BigInt(depreciableAmount),400,'DEPRECIATION_LIMIT','累计折旧不得超过可折旧额');
 return{algorithmVersion:input.method==='STRAIGHT_LINE'?'DEPRECIATION_STRAIGHT_LINE_V1':'DEPRECIATION_MANUAL_V1',rows,depreciableAmount,totalAmount:Number(total)};
}
