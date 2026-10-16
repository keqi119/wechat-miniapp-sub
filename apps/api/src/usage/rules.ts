import { effectiveTerms } from '../order-changes/context';
import { usagePolicyAppendix } from './policy';
import { dateOnly } from '../billing/rules';
import { ensure } from '../common/errors';
export const USAGE_CLOCK=Symbol('USAGE_CLOCK');
export const USAGE_POLICY='USAGE_V1',PACK_TERMS='MILEAGE_PACK_V1';
export const day=(date:Date)=>date.toISOString().slice(0,10);
export const shanghaiDay=(date:Date)=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
export function periods(start:string,months:number){
  const origin=dateOnly(start);ensure(Number.isInteger(months)&&months>0&&months<=120,409,'USAGE_POLICY','订阅期限不完整');
  const boundary=(index:number)=>{const last=new Date(Date.UTC(origin.getUTCFullYear(),origin.getUTCMonth()+index+1,0));return new Date(Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),Math.min(origin.getUTCDate(),last.getUTCDate())));};
  return Array.from({length:months},(_,i)=>({sequence:i+1,startDate:boundary(i),endDate:boundary(i+1),effectiveEndDate:boundary(i+1)}));
}
export async function lockAccount(tx:any,orderId:string){await tx.order.update({where:{id:orderId},data:{revision:{increment:1}}});const account=await tx.usageAccount.findUnique({where:{orderId}});ensure(account,409,'USAGE_NOT_ACTIVE','请先完成符合已签日期的交车，建立月度用量账户');return tx.usageAccount.update({where:{id:account.id},data:{revision:{increment:1}}});}
export async function initializeUsage(tx:any,order:any,handover:any){
  const snapshot=await effectiveTerms(tx,order);
  ensure(handover.actualAt&&handover.actualAt<=new Date(Date.now()+300000),409,'HANDOVER_DATE_REQUIRED','交接须包含真实且非未来的交车时间');
  const actual=shanghaiDay(handover.actualAt);
  ensure(actual===String(snapshot.startDate).slice(0,10),409,'DELIVERY_DATE_AMENDMENT_REQUIRED','实际交车日与已签方案不符，须先双方确认延期费用和补充协议');
  ensure(snapshot.usagePolicyVersion===USAGE_POLICY&&snapshot.mileagePerMonthKm===1500&&snapshot.excessMileagePriceAmount===150,409,'USAGE_POLICY','已签方案缺少当前结构化里程规则，请先补齐协议');
  usagePolicyAppendix(snapshot.usagePolicy);
  ensure(!(await tx.usageAccount.findUnique({where:{orderId:order.id}})),409,'USAGE_EXISTS','用量账户已建立');
  return tx.usageAccount.create({data:{orderId:order.id,customerId:order.customerId,policyVersion:USAGE_POLICY,startedOn:dateOnly(actual),periods:{create:periods(actual,snapshot.months).map((period,index)=>({...period,orderId:order.id,...(index===0?{startReadingKm:handover.readingKm}:{})}))}}});
}
