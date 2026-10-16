import { ensure } from '../common/errors';
import { fen } from '../common/data';
import { amount, billSchedule, dateOnly } from '../billing/rules';
export const commercialTermKeys = ['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'] as const;
const incomplete = /\{\{|\}\}|待确认|待补齐|待填写|另行通知/;
function required(value:unknown,code='COMMERCIAL_INCOMPLETE'):string {ensure(typeof value==='string'&&value.trim()&&!incomplete.test(value),409,code,'逐单条款或交接事实不完整，请补齐并重新向客户确认');return value.trim();}
export function approvedTemplate(document:any){ensure(document?.status==='PUBLISHED'&&document.confirmedBy&&document.confirmedAt&&typeof document.content==='string'&&document.content.trim(),409,'LEGAL_NOT_APPROVED','正式文案尚未审定发布');ensure(!/待补齐|待填写/.test(document.content),409,'LEGAL_PLACEHOLDERS','正式模板仍有未审定内容');}
function interpolate(template:string,values:Record<string,string>){const text=template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_match,key)=>{ensure(Object.hasOwn(values,key)&&values[key]?.trim(),409,'LEGAL_PLACEHOLDERS',`正式模板字段未填写：${key}`);return values[key];});ensure(!/\{\{|\}\}/.test(text),409,'LEGAL_PLACEHOLDERS','正式文案仍有未填写字段');return text;}
export function commercialSnapshot(snapshot:any){
  const terms:any={};for(const key of commercialTermKeys)terms[key]=required(snapshot?.commercialTerms?.[key]);
  ensure(Number.isInteger(snapshot.months)&&snapshot.months>=1&&snapshot.months<=120&&Number.isSafeInteger(snapshot.mileagePerMonthKm)&&snapshot.mileagePerMonthKm>=0&&Number.isInteger(snapshot.revision)&&snapshot.revision>0,409,'COMMERCIAL_INCOMPLETE','最终方案期限、里程或版本不完整');
  let bills,startDate:string,firstDueDate:string;try{amount(snapshot.monthlyFeeAmount);amount(snapshot.depositAmount);amount(snapshot.excessMileagePriceAmount);const normalize=(value:unknown)=>{ensure(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(T00:00:00\.000Z)?$/.test(value),409,'COMMERCIAL_INCOMPLETE','最终方案日期无效');const day=value.slice(0,10);dateOnly(day);return day;};startDate=normalize(snapshot.startDate);firstDueDate=normalize(snapshot.firstDueDate);bills=billSchedule(firstDueDate,snapshot.months,snapshot.monthlyFeeAmount);}catch{ensure(false,409,'COMMERCIAL_INCOMPLETE','最终方案金额或日期无效');}
  required(snapshot.commercialHash);required(snapshot.energyDescription);required(snapshot.conditions);ensure(Array.isArray(snapshot.benefits)&&snapshot.benefits.every((x:unknown)=>typeof x==='string'&&x.trim()&&!incomplete.test(x)),409,'COMMERCIAL_INCOMPLETE','方案权益不完整');
  const boundaries=billSchedule(startDate!,snapshot.months+1<=120?snapshot.months+1:120,0).map(x=>x.dueDate);
  // The same anchor-day clamping as billing; the final anniversary is computed directly for 120-month terms.
  const start=dateOnly(startDate!),endMonth=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+snapshot.months+1,0));
  const anniversary=new Date(Date.UTC(endMonth.getUTCFullYear(),endMonth.getUTCMonth(),Math.min(start.getUTCDate(),endMonth.getUTCDate())));
  const finalEnd=new Date(anniversary.getTime()-86400000).toISOString().slice(0,10);
  const endBefore=(date:string)=>new Date(dateOnly(date).getTime()-86400000).toISOString().slice(0,10);
  const billing=bills!.map((bill,index)=>`第${bill.sequence}期：${fen(bill.amount)}，到期日${bill.dueDate}，服务期间${boundaries[index]}至${index+1===snapshot.months?finalEnd:endBefore(boundaries[index+1])}`).join('；');
  return {terms,billing,finalEnd,startDate:startDate!,firstDueDate:firstDueDate!};
}
export function resolveSubscriptionTemplate(template:string,resource:any,identity:any,version:number){const snapshot=resource.order.finalPlanSnapshot;const{terms,billing,finalEnd,startDate,firstDueDate}=commercialSnapshot(snapshot);return interpolate(template,{
  contractNo:required(resource.id),templateVersion:String(version),orderNo:required(resource.orderId),applicationId:required(resource.order.applicationId),revision:String(snapshot.revision),commercialHash:snapshot.commercialHash,
  customerName:required(identity.name,'LEGAL_PLACEHOLDERS'),customerIdentityNo:required(identity.idCardNo,'LEGAL_PLACEHOLDERS'),customerMobile:required(resource.order.customer.mobile),customerAddress:terms.customerAddress,
  ...terms,subscriptionDates:`${startDate}至${finalEnd}，共${snapshot.months}期`,billingSchedule:billing,depositSchedule:`押金${fen(snapshot.depositAmount)}，支付时间${firstDueDate}`,
  mileageAllowance:`每月${snapshot.mileagePerMonthKm}公里；${terms.mileageCarryRule}`,excessMileageRule:`${fen(snapshot.excessMileagePriceAmount)}/公里；${terms.excessMileageCalculation}`,
  serviceBenefits:`${snapshot.benefits.length?snapshot.benefits.join('；'):'本方案未列其他服务权益'}；${terms.serviceCoverage}；能源：${snapshot.energyDescription}；使用条件：${snapshot.conditions}`,
  platformSignatureSlot:'由企业签章区签署',customerSignatureSlot:'由订阅方签署区签署'
});}
const checklistKeys=['actualTimeAndPlace','batteryLevel','accessoriesChecklist','conditionChecklist','openItems','resolutionPlan','staffName'];
const labels:Record<string,string>={actualTimeAndPlace:'实际交接时间地点',batteryLevel:'电量',accessoriesChecklist:'随车物品',conditionChecklist:'车辆状况',openItems:'处理事项',resolutionPlan:'负责人及期限',staffName:'交接人员'};
export function resolveHandoverTemplate(template:string,resource:any,identity:any,contractId:string,files:{id:string;name:string;sha256:string}[]){
  ensure(resource.customerResponse==='CONFIRM'&&Number.isSafeInteger(resource.readingKm)&&resource.readingKm>=0&&['DELIVERY','RETURN'].includes(resource.type),409,'HANDOVER_INCOMPLETE','须先确认当前交接事实与有效里程');
  const checklist=Array.isArray(resource.checklist)?Object.fromEntries(resource.checklist.map((x:any)=>[x.key||x.label,x.value])):resource.checklist;
  const values:Record<string,string>={};for(const key of checklistKeys)values[key]=required(checklist?.[key]??checklist?.[labels[key]],'HANDOVER_INCOMPLETE');
  return interpolate(template,{...values,orderNo:required(resource.orderId),handoverType:resource.type==='DELIVERY'?'交车':'还车',handoverId:required(resource.id),contractNo:required(contractId,'HANDOVER_INCOMPLETE'),customerName:required(identity.name),vehicleIdentification:required(resource.order.finalPlanSnapshot?.commercialTerms?.vehicleIdentification,'HANDOVER_INCOMPLETE'),readingKm:String(resource.readingKm),manifestHash:required(resource.manifestHash,'HANDOVER_INCOMPLETE'),attachmentManifest:files.length?files.map(file=>`${required(file.name)}（${required(file.id)}；SHA-256 ${required(file.sha256)}）`).join('；'):'本记录无关联附件',customerResponse:'事实无异议',objection:resource.responseReason?required(resource.responseReason,'HANDOVER_INCOMPLETE'):'无异议',platformSignatureSlot:'由企业签章区签署',customerSignatureSlot:'由客户签署区签署'});
}
