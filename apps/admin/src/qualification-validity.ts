import {date} from './core.ts';
import type {BusinessField} from './domain-commands.ts';
export const qualificationValidityInitial={identityValidity:'fixed',drivingLicenseValidity:'fixed'};
export const qualificationValidityFields:BusinessField[]=[
 {key:'identityValidity',label:'身份证有效期类型',kind:'select',required:true,choices:[{value:'fixed',label:'有效期至某日'},{value:'long-term',label:'长期'}]},
 {key:'identityExpiresAt',label:'身份证有效期至',kind:'date',required:true,when:{key:'identityValidity',value:'fixed'}},
 {key:'drivingLicenseValidity',label:'驾驶证有效期类型',kind:'select',required:true,choices:[{value:'fixed',label:'有效期至某日'},{value:'long-term',label:'长期'}]},
 {key:'drivingLicenseExpiresAt',label:'驾驶证有效期至',kind:'date',required:true,when:{key:'drivingLicenseValidity',value:'fixed'}},
];
export function qualificationValidityPayload(values:Record<string,unknown>){
 const output:Record<string,unknown>={};
 for(const [kind,label] of [['identity','身份证'],['drivingLicense','驾驶证']]){
  const mode=values[kind+'Validity'];if(!['fixed','long-term'].includes(String(mode)))throw new Error(`请选择${label}有效期类型`);
  const longTerm=mode==='long-term',value=values[kind+'ExpiresAt'];
  if(!longTerm&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)))throw new Error(`请选择${label}有效期至日期`);
  output[kind+'LongTerm']=longTerm;output[kind+'ExpiresAt']=longTerm?null:value;
 }
 return output;
}
export function qualificationValidityLabel(value:unknown,longTerm:unknown){return longTerm===true?'长期':value?date(value,true):'未提供';}
