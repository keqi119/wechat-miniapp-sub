import { hash } from '../common/data';
import { ensure } from '../common/errors';
import { periods, day } from '../usage/rules';
export const terminal = ['APPLIED','CANCELLED','REJECTED'];
export const capabilityNote = '仅支持同一期原路退或补收；超出原实收的额外赔付须人工处理，不可报为已核清。';
export async function effectiveTerms(tx:any,order:any){
  if(!order.effectiveTermsVersionId)return order.finalPlanSnapshot as any;
  const version=await tx.orderTermsVersion.findFirst({where:{id:order.effectiveTermsVersionId,orderId:order.id}});
  ensure(version,409,'TERMS_MISSING','有效服务条款记录缺失');return version.snapshot;
}
export async function lockOrder(tx:any,id:string){return tx.order.update({where:{id},data:{revision:{increment:1}}});}
export async function financialContext(tx:any,order:any){
  const terms=await effectiveTerms(tx,order), schedule=periods(String(terms.startDate).slice(0,10),terms.months);
  const obligations=await tx.serviceObligation.findMany({where:{orderId:order.id,active:true},orderBy:{sequence:'asc'}});
  const bills=await tx.bill.findMany({where:{orderId:order.id},orderBy:{id:'asc'},include:{payments:{orderBy:{id:'asc'},include:{refunds:true}}}});
  const blockers:string[]=[];
  if(bills.some((b:any)=>b.payments.some((p:any)=>['CREATING','PENDING'].includes(p.status))))blockers.push('存在未确认支付，请先查询或可信关单');
  if(bills.some((b:any)=>b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))))blockers.push('存在待审批或处理中退款，请先核清');
  const rows=schedule.map(period=>{
    const obligation=obligations.find((o:any)=>o.sequence===period.sequence);
    const sources=bills.filter((b:any)=>obligation ? [...obligation.sourceBillIds,obligation.chargeBillId].includes(b.id):b.type==='SUBSCRIPTION'&&b.sequence===period.sequence);
    const payments=sources.flatMap((b:any)=>b.payments.filter((p:any)=>p.status==='SUCCEEDED').map((p:any)=>({id:p.id,amount:p.amount,net:p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)})));
    ensure(payments.every((p:any)=>p.net>=0),409,'FUNDS_INCONSISTENT','实际收退款记录需人工核对');
    const original=sources.find((b:any)=>b.type==='SUBSCRIPTION')||sources[0];
    return{sequence:period.sequence,startDate:day(period.startDate),endDate:day(period.endDate),dueDate:obligation?day(obligation.dueDate):original?day(original.dueDate):day(period.startDate),amount:obligation?.amount??original?.amount??terms.monthlyFeeAmount,billId:obligation?.chargeBillId??original?.id??null,billStatus:original?.status??null,netPaidAmount:payments.reduce((n:number,p:any)=>n+p.net,0),sourceBillIds:sources.map((b:any)=>b.id),payments};
  });
  return{terms,rows,blockers};
}
export async function delayContext(tx:any,id:string){
  const order=await tx.order.findUnique({where:{id}});ensure(order,404,'NOT_FOUND','订单不存在');
  const finance=await financialContext(tx,order), active=await tx.orderChange.findFirst({where:{orderId:id,status:{notIn:terminal}}});
  const contract=await tx.contract.findFirst({where:{orderId:id,kind:'SUBSCRIPTION',status:'SIGNED'}});
  const blockers=[...finance.blockers];
  if(!contract)blockers.push('主合同尚未签署完成');
  if(!['AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status)||await tx.usageAccount.findUnique({where:{orderId:id}}))blockers.push('仅支持主合同已签且尚未实际交车的订单');
  if(await tx.handover.count({where:{orderId:id,status:{not:'SUPERSEDED'},signatureStatus:'PENDING'}}))blockers.push('交接签署仍在渠道处理中，请先核验结果');
  if(active)blockers.push('已有未完成的订单变更');
  const last=finance.rows.at(-1)!;
  return{order,contract,terms:finance.terms,rows:finance.rows,public:{orderId:id,orderRevision:order.revision,priorTermsHash:hash(finance.terms),months:finance.terms.months,startDate:String(finance.terms.startDate).slice(0,10),endDate:day(new Date(new Date(last.endDate).getTime()-86400000)),depositAmount:finance.terms.depositAmount,periods:finance.rows.map(({payments,sourceBillIds,...row}:any)=>row),canCreate:blockers.length===0,activeChangeId:active?.id??null,blockers,capabilityNote}};
}
