import {ensure} from '../common/errors';
import {hash,audit} from '../common/data';
import {financeView} from '../order-changes/finance';
import {reserveCredit} from './credits';
import {shanghaiDay} from '../usage/rules';
export const recoveryFields=['plannedReturnAt','plannedDeliveryAt','handoverArrangement','downtimeArrangement','reason','expiresAt'];
export const financeQuoteId=(q:any)=>q.snapshot.financeSourceQuoteId||q.id;
export async function recoverSwapQuote(tx:any,change:any,active:any,input:any,actor:any){
 ensure(!/待确认|待补齐|待填写|另行通知|\{\{|\}\}/.test(JSON.stringify(input)),400,'COMMERCIAL_INCOMPLETE','恢复安排须填写真实逐单内容');
 const s=active.snapshot,omit=new Set(['revision','idempotencyKey',...recoveryFields]);
 for(const k of Object.keys(input).filter(k=>!omit.has(k)))ensure(hash(input[k])===hash(k==='periods'?s.periods.map((p:any)=>({sequence:p.sequence,amount:p.amount,dueDate:p.dueDate,calculationBasis:p.calculationBasis})):s[k]),409,'SWAP_RECOVERY_MONEY_IMMUTABLE','此次恢复仅允许日期、交接与无车安排调整；改价或更换目标车辆须另行人工财务处理，尚未完成');
 const financial=await financeView(tx,change);const source=await tx.delayQuote.findUniqueOrThrow({where:{id:financeQuoteId(active)}});ensure(source.financePreparedAt&&!financial.blockers.length,409,'FINANCE_UNRESOLVED','原已签资金安排须先核清才能恢复');
 const old=await tx.vehicleAssignment.findUniqueOrThrow({where:{id:s.originalAssignmentId}}),ret=change.returnHandoverId?await tx.handover.findUniqueOrThrow({where:{id:change.returnHandoverId}}):null;
 const returned=new Date(input.plannedReturnAt),delivered=new Date(input.plannedDeliveryAt);ensure(returned>=old.startAt&&delivered>=returned&&new Date(input.expiresAt)>new Date(),400,'SWAP_DATES','恢复日期或有效期不正确');
 ensure(s.periods.some((p:any)=>p.startDate<=shanghaiDay(delivered)&&shanghaiDay(delivered)<p.endDate),409,'SWAP_OUTSIDE_TERM','恢复交车不得延长原订阅期限');
 ensure(await tx.usagePeriod.count({where:{orderId:change.orderId,status:'SETTLED',effectiveEndDate:{gt:new Date(shanghaiDay(returned))}}})===0,409,'SETTLED_USAGE_IMMUTABLE','恢复安排不可改变已结算月份');
 if(ret?.status==='COMPLETED')ensure(returned.getTime()===ret.actualAt.getTime(),409,'PHYSICAL_FACT_IMMUTABLE','旧车已经实际归还，不能修改该事实');
 for(const id of [change.returnHandoverId,change.deliveryHandoverId].filter(Boolean)){const h=await tx.handover.findUniqueOrThrow({where:{id}});if(h.status==='COMPLETED')continue;ensure(h.signatureStatus==='DRAFT'&&!h.providerTaskId&&!h.signingLeaseUntil&&['DRAFT','OBJECTION_SUBMITTED'].includes(h.status),409,'HANDOVER_IN_FLIGHT','已有客户确认或签署中的交接，须先核对原交接结果，不能重写事实');await tx.handover.update({where:{id},data:{status:'SUPERSEDED'}});await audit(tx,actor.id,'SUPERSEDED_BY_SWAP_RECOVERY','handovers',id,{changeId:change.id,manifestHash:h.manifestHash});}
 const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:change.targetVehicleId}}),hold=vehicle.holdId?await tx.vehicleHold.findUnique({where:{id:vehicle.holdId}}):null;ensure(hold?.changeId===change.id&&hold.status==='HELD'&&!vehicle.reservedOrderId&&vehicle.status==='PUBLISHED',409,'VEHICLE_HOLD_MISMATCH','原目标车预留不可用，不能继续恢复');
 const fields=Object.fromEntries(recoveryFields.map(k=>[k,input[k]])),snapshot={...s,...fields,document:null,previousQuoteId:active.id,recoveryFromQuoteId:active.contract?.status==='SIGNED'?active.id:active.snapshot.recoveryFromQuoteId||active.id,financeSourceQuoteId:financeQuoteId(active),affectedSequence:s.periods.find((p:any)=>p.startDate<=shanghaiDay(delivered)&&shanghaiDay(delivered)<p.endDate).sequence};
 const revision=((await tx.delayQuote.aggregate({where:{changeId:change.id},_max:{revision:true}}))._max.revision||0)+1;
 const quote=await tx.delayQuote.create({data:{changeId:change.id,revision,snapshot,fundsSnapshot:active.fundsSnapshot,commercialHash:hash({priorTermsHash:change.priorTermsHash,snapshot}),createdBy:actor.id}});
 await tx.vehicleHold.update({where:{id:hold.id},data:{quoteId:quote.id,expiresAt:new Date(input.expiresAt)}});const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});await reserveCredit(tx,order,await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),change.id,delivered);
 await tx.orderChange.update({where:{id:change.id},data:{activeQuoteId:quote.id,status:'REVIEW_PENDING',returnHandoverId:ret?.status==='COMPLETED'?ret.id:null,deliveryHandoverId:null}});
}

export async function cancelRecovery(tx:any,change:any){
 const q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}});if(!q.snapshot.recoveryFromQuoteId)return false;
 const previous=await tx.delayQuote.findUniqueOrThrow({where:{id:q.snapshot.recoveryFromQuoteId},include:{contract:true}});ensure(previous.changeId===change.id&&previous.contract?.status==='SIGNED',409,'RECOVERY_STATE','原已签版本不可恢复');
 await tx.delayQuote.update({where:{id:q.id},data:{status:'REJECTED'}});const h=change.returnHandoverId?await tx.handover.findUnique({where:{id:change.returnHandoverId}}):null;
 await tx.orderChange.update({where:{id:change.id},data:{activeQuoteId:previous.id,status:h?.status==='COMPLETED'?'SWAP_RETURNED':'AWAITING_FINANCE'}});const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:change.targetVehicleId}});await tx.vehicleHold.update({where:{id:vehicle.holdId},data:{quoteId:previous.id}});await reserveCredit(tx,await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),await tx.usageAccount.findUniqueOrThrow({where:{orderId:change.orderId}}),change.id,new Date(previous.snapshot.plannedDeliveryAt));return true;
}
