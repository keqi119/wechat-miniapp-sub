import {z} from 'zod';
import type {MoneyCents,ServiceAnchor,ServicePeriod} from './types';
export const termMonthsInput=z.number().int().min(3).max(120);
export function validTermMonths(months:unknown,minimumTermMonths?:unknown):boolean{
 return termMonthsInput.safeParse(months).success&&(minimumTermMonths==null||termMonthsInput.safeParse(minimumTermMonths).success&&(months as number)>=(minimumTermMonths as number));
}
export function calendarDay(value:string):Date{
 if(!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('服务日期无效');
 const result=new Date(value+'T00:00:00Z');if(!Number.isFinite(result.getTime())||result.toISOString().slice(0,10)!==value)throw new Error('服务日期无效');return result;
}
/** Index is one based from the original delivery, including all renewal stages. */
export function servicePeriods(anchor:ServiceAnchor,startPeriod:number,months:number):ServicePeriod[]{
 const first=calendarDay(anchor.firstStartDay);
 if(anchor.ruleVersion!=='V31'||!Number.isInteger(anchor.anchorDay)||anchor.anchorDay!==first.getUTCDate()||!Number.isSafeInteger(startPeriod)||startPeriod<1||!Number.isInteger(months)||months<1||months>120)throw new Error('服务日历来源无效');
 const boundary=(offset:number)=>{const index=first.getUTCFullYear()*12+first.getUTCMonth()+offset,year=Math.floor(index/12),month=index%12;if(year<1||year>9999)throw new Error('服务日期超出范围');const date=new Date(0);date.setUTCFullYear(year,month+1,0);const last=date.getUTCDate();date.setUTCFullYear(year,month,Math.min(anchor.anchorDay,last));return date.toISOString().slice(0,10);};
 return Array.from({length:months},(_,i)=>({index:startPeriod+i,startDay:boundary(startPeriod+i-1),endDayExclusive:boundary(startPeriod+i)}));
}
/** Each positional rate is the full agreed service-month fee, in integer cents.
 * Prorate only unused time at termination; delivery time never discounts a full month.
 * Shanghai has no daylight-saving transition in the supported modern service dates. */
export function remainingRentCents(periods:readonly ServicePeriod[],rates:readonly MoneyCents[],stopAt:Date):MoneyCents{
 if(!Number.isFinite(stopAt.getTime())||rates.length!==periods.length)throw new Error('剩余租金来源无效');
 let total=0n;
 periods.forEach((p,i)=>{const start=calendarDay(p.startDay).getTime()-8*3600000,end=calendarDay(p.endDayExclusive).getTime()-8*3600000,rate=rates[i];
 if(!Number.isSafeInteger(rate)||rate<0||rate>2147483647||end<=start||!Number.isSafeInteger(p.index)||p.index<1||i>0&&(periods[i-1].endDayExclusive!==p.startDay||periods[i-1].index+1!==p.index))throw new Error('剩余租金期间或金额无效');
 const duration=BigInt(end-start),unused=BigInt(Math.max(0,end-Math.max(start,stopAt.getTime())));total+=(BigInt(rate)*unused+duration/2n)/duration;
 });
 if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('剩余租金超出安全整数范围');return Number(total);
}

/** One actual interval, rounded once within its original service month. */
export function durationProrationCents(rate:number,durationMs:number,periodMs:number){
 if(!Number.isSafeInteger(rate)||rate<0||rate>2147483647||!Number.isSafeInteger(durationMs)||durationMs<0||!Number.isSafeInteger(periodMs)||periodMs<=0||durationMs>periodMs)throw new Error('实际时长计费来源无效');
 return Number((BigInt(rate)*BigInt(durationMs)+BigInt(periodMs)/2n)/BigInt(periodMs));
}
