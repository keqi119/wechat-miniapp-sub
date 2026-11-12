import {orderChangeScopeEnabled} from '../offline-documents/change-mode';
import { hash } from '../common/data';
import { ensure } from '../common/errors';
import { periods, day } from '../usage/rules';
import {HttpException} from '@nestjs/common';
import {requireCurrentQualification} from '../customers/qualifications';
import {requireEffectiveContractChain} from './agreement-readiness';
import {readSwapStageScope,parseSwapStageScope,type SwapStageScope} from '../vehicle-changes/stage-source';
import {stagePeriods} from '../order-service-stages/source';
import type {ServiceAnchor} from '../service-calendar/types';
export const terminal = ['APPLIED','CANCELLED','REJECTED'];
export const capabilityNote = '仅支持同一期原路退或补收；超出原实收的额外赔付须人工处理，不可报为已核清。';
export async function effectiveTerms(tx:any,order:any){
  if(!order.effectiveTermsVersionId)return order.finalPlanSnapshot as any;
  const version=await tx.orderTermsVersion.findFirst({where:{id:order.effectiveTermsVersionId,orderId:order.id}});
  ensure(version,409,'TERMS_MISSING','有效服务条款记录缺失');return version.snapshot;
}
export async function lockOrder(tx:any,id:string){return tx.order.update({where:{id},data:{revision:{increment:1}}});}
/** A date change cannot erase a real delivery, even if an account has gone missing. */
export async function requireUndeliveredDelay(tx:any,order:any){
  ensure(['AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status)&&!await tx.usageAccount.findUnique({where:{orderId:order.id}})&&!await tx.handover.count({where:{orderId:order.id,type:{in:['DELIVERY','SWAP_DELIVERY']},status:'COMPLETED'}})&&!await tx.vehicleAssignment.count({where:{orderId:order.id}}),409,'ALREADY_DELIVERED','仅支持尚未实际交车的订单延期');
}
/** Current qualification is checked, but no current identity is copied into historical terms. */
export async function requireOfflineDelayFacts(tx:any,order:any,change?:any){
  ensure(order.contractMode==='OFFLINE',409,'AGREEMENT_OFFLINE_REQUIRED','须为线下合同订单');
  await requireUndeliveredDelay(tx,order);const chain=await requireEffectiveContractChain(tx,order.id),terms=await effectiveTerms(tx,order);
  if(change)ensure(change.orderId===order.id&&change.customerId===order.customerId&&change.originalContractId===chain.original?.contractId&&change.originalArchiveVersionId===chain.original.archiveVersionId&&(change.priorTermsVersionId??null)===chain.termsVersionId&&change.priorTermsHash===hash(terms)&&hash(change.priorTerms)===hash(terms),409,'AGREEMENT_PRIOR_TERMS_MISMATCH','原合同或当前有效条款已变化，请重新核对');
  const risk=terms.riskSnapshot;
  ensure(risk&&risk.applicationId===order.applicationId&&risk.customerId===order.customerId&&typeof risk.reviewId==='string'&&risk.reviewId,409,'ORDER_RISK_SNAPSHOT_MISMATCH','订单风险审核凭据不完整');
  const review=await tx.applicationRiskReview.findUnique({where:{id:risk.reviewId}});
  ensure(review?.decision==='APPROVED'&&review.identityChecked&&review.drivingQualificationChecked&&review.applicationId===order.applicationId&&review.customerId===order.customerId&&review.finalPlanId===risk.planId&&review.planRevision===risk.planRevision&&review.commercialHash===risk.commercialHash&&review.qualificationId===risk.qualificationId&&review.qualificationRevision===risk.qualificationRevision,409,'ORDER_RISK_SNAPSHOT_MISMATCH','订单原风险审核凭据不匹配');
  const qualification=await requireCurrentQualification(tx,order.customerId);
  ensure(qualification.revision>=risk.qualificationRevision&&qualification.profileHash===review.profileHash,409,'CUSTOMER_QUALIFICATION_REQUIRED','当前身份资料与原审核签约主体不一致，请先核对订单');
  return chain;
}
/** Domain eligibility is separate from the rollout gate; this does not enable a new command. */
export async function offlineDelayEligibility(tx:any,order:any){
  try{const chain=await requireOfflineDelayFacts(tx,order);return{ready:true,blockers:[] as string[],contractId:chain.original!.contractId,originalArchiveVersionId:chain.original!.archiveVersionId,priorTermsVersionId:chain.termsVersionId};}
  catch(error){if(error instanceof HttpException&&error.getStatus()===409)return{ready:false,blockers:[(error.getResponse() as any).error?.message||'线下延期依据不完整'],contractId:null,originalArchiveVersionId:null,priorTermsVersionId:null};throw error;}
}
/** Shared pure mapping; callers select the actual current or frozen historical obligations. */
export function serviceFundsRows(terms:any,obligations:any[],bills:any[],rawScope?:SwapStageScope,serviceAnchor?:ServiceAnchor){
  const scope=rawScope===undefined?null:parseSwapStageScope(rawScope);
  const anchor=serviceAnchor??scope?.serviceAnchor;
  const schedule=anchor?stagePeriods(scope?.startDate??anchor.firstStartDay,terms.months,scope?.firstPeriodSequence??1,terms.monthlyFeeAmount,anchor).map(p=>({...p,startDate:new Date(p.startDate),endDate:new Date(p.endDate),effectiveEndDate:new Date(p.endDate)})):periods(String(terms.startDate).slice(0,10),terms.months).map(p=>({...p,...(scope?{sequence:scope.firstPeriodSequence+p.sequence-1,stageSequence:p.sequence}:{})}));
  if(scope)ensure(terms.serviceStageId===scope.serviceStageId&&terms.startDate===scope.startDate&&terms.months===scope.months&&obligations.length===scope.months&&new Set(obligations.map(o=>o.sequence)).size===scope.months&&obligations.every(o=>{const p=schedule.find(p=>p.sequence===o.sequence);return p&&o.serviceStageId===scope.serviceStageId&&o.stageSequence===p.stageSequence&&day(o.startDate)===day(p.startDate)&&day(o.endDate)===day(p.endDate)&&Array.isArray(o.sourceBillIds);}),409,'SWAP_STAGE_SOURCE','服务段原逐期义务缺失或不一致');
  const blockers:string[]=[];
  if(bills.some((b:any)=>b.payments.some((p:any)=>['CREATING','PENDING'].includes(p.status))))blockers.push('存在未确认支付，请先查询或可信关单');
  if(bills.some((b:any)=>b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))))blockers.push('存在待审批或处理中退款，请先核清');
  const rows=schedule.map(period=>{
    const obligation=obligations.find((o:any)=>o.sequence===period.sequence);
    const sources=bills.filter((b:any)=>obligation ? [...obligation.sourceBillIds,obligation.chargeBillId].includes(b.id):b.type==='SUBSCRIPTION'&&b.sequence===period.sequence);
    if(scope){const ids=[...obligation.sourceBillIds,...(obligation.chargeBillId?[obligation.chargeBillId]:[])];ensure(new Set(ids).size===ids.length&&sources.length===ids.length&&sources.every((b:any)=>b.orderId===obligation.orderId&&b.serviceStageId===scope.serviceStageId),409,'SWAP_STAGE_SOURCE','本服务段不得借用其他租期或缺失的原账单');}
    const payments=sources.flatMap((b:any)=>b.payments.filter((p:any)=>p.status==='SUCCEEDED').map((p:any)=>({id:p.id,amount:p.amount,net:p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)})));
    ensure(payments.every((p:any)=>p.net>=0),409,'FUNDS_INCONSISTENT','实际收退款记录需人工核对');
    const original=sources.find((b:any)=>b.type==='SUBSCRIPTION')||sources[0];
    return{sequence:period.sequence,...(scope?{stageSequence:period.stageSequence}:{}),startDate:day(period.startDate),endDate:day(period.endDate),dueDate:obligation?day(obligation.dueDate):original?day(original.dueDate):day(period.startDate),amount:obligation?.amount??original?.amount??terms.monthlyFeeAmount,billId:obligation?.chargeBillId??original?.id??null,billStatus:original?.status??null,netPaidAmount:payments.reduce((n:number,p:any)=>n+p.net,0),sourceBillIds:sources.map((b:any)=>b.id),payments};
  });
  return{terms,rows,blockers,...(scope?{serviceStageScope:scope}:{})};
}
export async function financialContext(tx:any,order:any){
  const terms=await effectiveTerms(tx,order);
  const scope=await readSwapStageScope(tx,order,terms);
  const obligations=await tx.serviceObligation.findMany({where:{orderId:order.id,active:true,...(scope?{serviceStageId:scope.serviceStageId}:{})},orderBy:{sequence:'asc'}});
  const bills=await tx.bill.findMany({where:{orderId:order.id,...(scope?{serviceStageId:scope.serviceStageId}:{})},orderBy:{id:'asc'},include:{payments:{orderBy:{id:'asc'},include:{refunds:true}}}});
  return serviceFundsRows(terms,obligations,bills,scope??undefined,order.serviceAnchor??undefined);
}
export async function delayContext(tx:any,id:string){
  const order=await tx.order.findUnique({where:{id}});ensure(order,404,'NOT_FOUND','订单不存在');
  const finance=await financialContext(tx,order), active=await tx.orderChange.findFirst({where:{orderId:id,status:{notIn:terminal}}});
  const offline=order.contractMode==='OFFLINE'?await offlineDelayEligibility(tx,order):null;
  const contract=offline?(offline.contractId?await tx.contract.findUnique({where:{id:offline.contractId}}):null):await tx.contract.findFirst({where:{orderId:id,kind:'SUBSCRIPTION',status:'SIGNED'}});
  const blockers=[...finance.blockers];if(!orderChangeScopeEnabled(order,'DELIVERY_DELAY'))blockers.push('本版变更请联系平台办理线下资料');
  if(offline)blockers.push(...offline.blockers);else{
    if(!contract)blockers.push('主合同尚未签署完成');
    if(!['AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status)||await tx.usageAccount.findUnique({where:{orderId:id}}))blockers.push('仅支持主合同已签且尚未实际交车的订单');
  }
  if(await tx.handover.count({where:{orderId:id,status:{not:'SUPERSEDED'},signatureStatus:'PENDING'}}))blockers.push('交接签署仍在渠道处理中，请先核验结果');
  if(active)blockers.push('已有未完成的订单变更');
  const last=finance.rows.at(-1)!;
  return{order,contract,offline,terms:finance.terms,rows:finance.rows,public:{orderId:id,orderRevision:order.revision,priorTermsHash:hash(finance.terms),months:finance.terms.months,startDate:String(finance.terms.startDate).slice(0,10),endDate:day(new Date(new Date(last.endDate).getTime()-86400000)),depositAmount:finance.terms.depositAmount,periods:finance.rows.map(({payments,sourceBillIds,...row}:any)=>row),canCreate:blockers.length===0,activeChangeId:active?.id??null,blockers,capabilityNote}};
}
