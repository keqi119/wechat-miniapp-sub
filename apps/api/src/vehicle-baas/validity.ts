import {baasMissingFields,baasRequiredFields} from './types';
import {dateOnly,storedDate} from '../asset-costs/types';

export type BaasValidityGroup='CURRENT'|'EXPIRED'|'OTHER';
export const shanghaiDate=(now:Date)=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
export function baasValidity(row:any,today:string,businessReady?:boolean){
 const from=row.effectiveFrom?dateOnly(row.effectiveFrom):null,to=row.effectiveTo?dateOnly(row.effectiveTo):null;
 const result=(validityGroup:BaasValidityGroup,validityState:string,validityLabel:string)=>({validityGroup,validityState,validityLabel,serverDate:today});
 if(businessReady===false||businessReady===undefined&&baasMissingFields(row).length)return result('OTHER','INCOMPLETE','待完善');
 if(row.activatedAt&&to&&to<today)return result('EXPIRED','EXPIRED','已过期');
 if(row.status==='ACTIVE'&&row.activatedAt&&from&&from<=today&&(!to||to>=today))return result('CURRENT','CURRENT','有效中');
 if(row.status==='SUSPENDED')return result('OTHER','SUSPENDED','已暂停');
 if(row.status==='TERMINATED')return result('OTHER','TERMINATED','已终止');
 if(row.status==='ARCHIVED')return result('OTHER','ARCHIVED','已归档');
 if(from&&from>today)return result('OTHER','UPCOMING','未到生效日');
 return result('OTHER','DRAFT',row.status==='DRAFT'?'待启用':'待核对');
}
/** Same predicates as the projection, applied in SQL before count and pagination. */
export function baasValidityWhere(group:BaasValidityGroup,today:string):any{
 const complete={AND:[...baasRequiredFields.map(field=>({[field]:{not:null}})),{provider:{not:''}},{batteryPackage:{not:''}}]},day=storedDate(today);
 const current={AND:[complete,{status:'ACTIVE',activatedAt:{not:null},effectiveFrom:{lte:day},OR:[{effectiveTo:null},{effectiveTo:{gte:day}}]}]};
 const expired={AND:[complete,{activatedAt:{not:null},effectiveTo:{not:null,lt:day}}]};
 return group==='CURRENT'?current:group==='EXPIRED'?expired:{NOT:{OR:[current,expired]}};
}
