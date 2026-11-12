import {z} from 'zod';

const isoDateTime=z.string().datetime({offset:true});
const beijing=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
type ValidityInput={identityLongTerm?:unknown;drivingLicenseLongTerm?:unknown;identityExpiresAt?:unknown;drivingLicenseExpiresAt?:unknown};
export type QualificationValidity={identityLongTerm:boolean;drivingLicenseLongTerm:boolean;identityExpiresAt:Date|null;drivingLicenseExpiresAt:Date|null};
const fields=[['identityLongTerm','identityExpiresAt','身份证'],['drivingLicenseLongTerm','drivingLicenseExpiresAt','驾驶证']] as const;

function validDay(value:string){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(year<1||month<1||month>12||day<1)return false;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 return day<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
}
function beijingDay(value:Date):string|null{
 if(!Number.isFinite(value.getTime()))return null;
 const parts=Object.fromEntries(beijing.formatToParts(value).map(part=>[part.type,part.value]));
 const result=`${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`;return validDay(result)?result:null;
}
/** Date-only values are calendar dates; legacy instants are interpreted in Beijing. */
export function qualificationExpiryDay(value:unknown):string|null{
 if(value instanceof Date)return beijingDay(value);
 if(typeof value!=='string')return null;
 if(validDay(value))return value;
 if(!isoDateTime.safeParse(value).success||!validDay(value.slice(0,10)))return null;
 return beijingDay(new Date(value));
}
export function qualificationValidityIssues(value:ValidityInput){
 const issues:{path:string;message:string}[]=[];
 for(const [flag,date,label] of fields){
  if(value[flag]!==undefined&&typeof value[flag]!=='boolean'){issues.push({path:flag,message:`请选择${label}有效期类型`});continue;}
  if(value[flag]===true){if(value[date]!==undefined&&value[date]!==null)issues.push({path:date,message:`${label}选择长期有效时不能同时填写截止日期`});}
  else if(qualificationExpiryDay(value[date])===null)issues.push({path:date,message:`请填写${label}有效的截止日期或选择长期有效`});
 }
 return issues;
}
/** New fixed-date submissions persist Beijing midnight; request DTO bytes stay untouched. */
export function normalizeQualificationValidity(value:ValidityInput):QualificationValidity{
 if(qualificationValidityIssues(value).length)throw new Error('资格有效期格式不正确');
 const identityLongTerm=value.identityLongTerm===true,drivingLicenseLongTerm=value.drivingLicenseLongTerm===true;
 return{identityLongTerm,drivingLicenseLongTerm,identityExpiresAt:identityLongTerm?null:new Date(`${qualificationExpiryDay(value.identityExpiresAt)}T00:00:00+08:00`),drivingLicenseExpiresAt:drivingLicenseLongTerm?null:new Date(`${qualificationExpiryDay(value.drivingLicenseExpiresAt)}T00:00:00+08:00`)};
}
/** Expiry day remains valid for the entire Beijing calendar day, including old ISO records. */
export function qualificationValidityCurrent(value:ValidityInput,now=new Date()):boolean{
 const today=beijingDay(now);if(!today||qualificationValidityIssues(value).length)return false;
 return fields.every(([flag,date])=>value[flag]===true||(qualificationExpiryDay(value[date])??'')>=today);
}
