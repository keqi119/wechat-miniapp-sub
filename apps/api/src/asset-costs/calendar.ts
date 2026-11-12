import {ensure} from '../common/errors';

export type CalendarPeriod={year:number;month:number};
export type CalendarDate=CalendarPeriod&{day:number};
const pad=(value:number,length=2)=>String(value).padStart(length,'0');
const formatPeriod=({year,month}:CalendarPeriod)=>`${pad(year,4)}-${pad(month)}`;

/** Gregorian calendar arithmetic only: no machine time zone or Date rollover. */
export function parsePeriod(value:string):CalendarPeriod{
 ensure(typeof value==='string'&&value.length===7&&/^\d{4}-\d{2}$/.test(value),400,'VALIDATION','账期须为 YYYY-MM');
 const year=Number(value.slice(0,4)),month=Number(value.slice(5,7));
 ensure(year>=1&&year<=9999&&month>=1&&month<=12,400,'VALIDATION','账期年月无效');
 return{year,month};
}

function monthDays({year,month}:CalendarPeriod):number{
 if(month===2)return year%4===0&&(year%100!==0||year%400===0)?29:28;
 return [4,6,9,11].includes(month)?30:31;
}

export function parseDate(value:string):CalendarDate{
 ensure(typeof value==='string'&&value.length===10&&/^\d{4}-\d{2}-\d{2}$/.test(value),400,'VALIDATION','日期须为 YYYY-MM-DD');
 const period=parsePeriod(value.slice(0,7)),day=Number(value.slice(8,10));
 ensure(day>=1&&day<=monthDays(period),400,'VALIDATION','日期不是有效日历日期');
 return{...period,day};
}

export function periodOf(date:string):string{return formatPeriod(parseDate(date));}
export function periodStart(period:string):string{return `${formatPeriod(parsePeriod(period))}-01`;}
export function periodEnd(period:string):string{const parsed=parsePeriod(period);return `${formatPeriod(parsed)}-${pad(monthDays(parsed))}`;}

/** Offset a month, refusing results outside the four-digit supported year range. */
export function addMonths(period:string,offset:number):string{
 const parsed=parsePeriod(period);
 ensure(Number.isSafeInteger(offset),400,'VALIDATION','月份偏移须为安全整数');
 const index=(parsed.year-1)*12+parsed.month-1+offset;
 ensure(Number.isSafeInteger(index)&&index>=0&&index<9999*12,400,'VALIDATION','月份偏移超出日期范围');
 return formatPeriod({year:Math.floor(index/12)+1,month:index%12+1});
}

export function dateAtDay(period:string,day:number):string{
 const parsed=parsePeriod(period);
 ensure(Number.isInteger(day)&&day>=1&&day<=31,400,'VALIDATION','付款日须为 1 至 31 的整数');
 return `${formatPeriod(parsed)}-${pad(Math.min(day,monthDays(parsed)))}`;
}

/** Signed number of months from the first period to the second. */
export function monthsBetween(fromPeriod:string,toPeriod:string):number{
 const from=parsePeriod(fromPeriod),to=parsePeriod(toPeriod);
 return (to.year-from.year)*12+to.month-from.month;
}
