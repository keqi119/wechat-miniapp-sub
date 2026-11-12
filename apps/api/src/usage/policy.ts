import { Prisma } from '@prisma/client';
import { hash } from '../common/data';
import { ensure } from '../common/errors';
export const usageRules={policyVersion:'USAGE_V1',timezone:'Asia/Shanghai',monthBoundary:'ORIGINAL_DAY_CLAMPED_END_EXCLUSIVE',baseAllowanceKm:1500,baseCarry:false,baseFirst:true,excessPriceAmount:150,packCarry:'SUBSCRIPTION',packRetroactive:'CURRENT_UNSETTLED_ONLY',returnFullBase:true,returnUnusedPack:'EXPIRE_NONREFUNDABLE_WITH_LEGAL_EXCEPTIONS',minimumMonths:12} as const;
export function validUsageInteger(value:unknown):value is number{return Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=2147483647;}
function renderUsageTemplate(template:string,baseAllowanceKm:number,excessPriceAmount:number){
 ensure(typeof template==='string'&&template.includes('{{baseAllowanceKm}}')&&template.includes('{{excessPriceYuan}}')&&validUsageInteger(baseAllowanceKm)&&validUsageInteger(excessPriceAmount),409,'USAGE_POLICY','里程模板须包含每月公里数和超额单价，且数值须为有效整数');
 const cents=BigInt(excessPriceAmount),values:Record<string,string>={baseAllowanceKm:String(baseAllowanceKm),excessPriceYuan:`${cents/100n}.${String(cents%100n).padStart(2,'0')}`,excessPriceAmount:String(excessPriceAmount)};
 const content=template.replace(/{{([^{}]+)}}/g,(_,name:string)=>{ensure(Object.hasOwn(values,name),409,'USAGE_POLICY','里程模板包含未支持的占位符');return values[name];});
 ensure(!content.includes('{{')&&!content.includes('}}'),409,'USAGE_POLICY','里程模板占位符不完整');return content;
}
export async function snapshotUsagePolicy(tx:Prisma.TransactionClient,product?:{configurationVersion?:number;mileagePerMonthKm?:number;excessMileagePriceAmount?:number}){
 ensure(product?.configurationVersion===undefined||product.configurationVersion===1||product.configurationVersion===2,409,'USAGE_POLICY','产品配置版本不支持');
 const v2=product?.configurationVersion===2;
 const doc=await tx.legalDocument.findFirst({where:{type:v2?'usage-policy-v2':'usage-policy',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});
 ensure(doc&&doc.content?.trim(),409,'USAGE_POLICY_UNPUBLISHED','订阅里程与退订规则须先批准发布，才能出具正式方案');
 if(v2){
  ensure(doc.type==='usage-policy-v2'&&doc.status==='PUBLISHED'&&doc.confirmedAt&&doc.confirmedBy,409,'USAGE_POLICY_UNPUBLISHED','可配置里程模板须先批准发布');
  const baseAllowanceKm=product.mileagePerMonthKm,excessPriceAmount=product.excessMileagePriceAmount;
  ensure(validUsageInteger(baseAllowanceKm)&&validUsageInteger(excessPriceAmount),409,'USAGE_POLICY','产品里程数和超额单价须为有效非负整数');
  const content=renderUsageTemplate(doc.content,baseAllowanceKm,excessPriceAmount);
  return {...usageRules,policyVersion:'USAGE_V2' as const,baseAllowanceKm,excessPriceAmount,documentId:doc.id,documentVersion:doc.version,templateContent:doc.content,templateHash:hash(doc.content),hash:hash(content),content};
 }
 return {...usageRules,documentId:doc.id,documentVersion:doc.version,hash:hash(doc.content),content:doc.content};
}
export function usagePolicyAppendix(policy:any){
 const v2=policy?.policyVersion==='USAGE_V2';
 ensure(policy&&Object.entries(usageRules).every(([k,v])=>v2&&['policyVersion','baseAllowanceKm','excessPriceAmount'].includes(k)||policy[k]===v)&&typeof policy.documentId==='string'&&Number.isInteger(policy.documentVersion)&&typeof policy.content==='string'&&policy.content.trim()&&policy.hash===hash(policy.content),409,'USAGE_POLICY','已确认的里程规则附件不完整或已变化');
 if(v2)ensure(typeof policy.templateContent==='string'&&policy.templateHash===hash(policy.templateContent)&&policy.content===renderUsageTemplate(policy.templateContent,policy.baseAllowanceKm,policy.excessPriceAmount),409,'USAGE_POLICY','里程附件与冻结模板或本单价格不符');
 return `\n\n订阅里程与退订规则附件（版本 ${policy.documentVersion}；文档 ${policy.documentId}；SHA-256 ${policy.hash}）\n\n${policy.content}`;
}
