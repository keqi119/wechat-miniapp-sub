import {ensure} from '../common/errors';
/** API2 local times are Shanghai civil time, never the process timezone. */
export function providerInstant(raw:unknown,now=new Date(),earliest?:Date){
 const m=typeof raw==='string'?/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(raw):null;
 ensure(m,502,'ELECTRONIC_SIGNING_TIME_REQUIRED','渠道实际签署时间缺失或格式未知');
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),fraction=m[7]??'',precisionMs=fraction?10**(3-fraction.length):1000;
 const civil=new Date(Date.UTC(year,month-1,day,hour,minute,second,Number(fraction.padEnd(3,'0'))));
 ensure(year>=2000&&civil.getUTCFullYear()===year&&civil.getUTCMonth()===month-1&&civil.getUTCDate()===day&&civil.getUTCHours()===hour&&civil.getUTCMinutes()===minute&&civil.getUTCSeconds()===second,502,'ELECTRONIC_SIGNING_TIME_INVALID','渠道实际签署日期无效');
 const date=new Date(civil.getTime()-8*3600000);
 ensure(date.getTime()<=now.getTime()&&(!earliest||date.getTime()+precisionMs>earliest.getTime()),502,'ELECTRONIC_SIGNING_TIME_INVALID','渠道实际签署时间超出原交易范围');
 return{at:date.toISOString(),raw:raw as string,precisionMs};
}

/** contract_verify.api pads whole-second PDF/CMS and TSA times with literal .00.
 * This endpoint's representation does not add centisecond precision. Preserve
 * nonzero fractions and all original facts; never add an arbitrary clock skew.
 * Confirmed against the signed CMS/TSTInfo from the 2026-11-11 channel acceptance.
 */
export function providerPdfInstant(raw:unknown,now=new Date()){
 const instant=providerInstant(raw,now);
 return typeof raw==='string'&&/\.00$/.test(raw)?{...instant,precisionMs:1000}:instant;
}
