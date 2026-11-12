import {financeQuoteId} from './recovery';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {day} from '../usage/rules';
import {requireHistoricalPreparedQuoteAgreement} from '../order-changes/agreement-readiness';
import {assertOfflineSwapQuote} from './offline-target';
import {readSwapStageScope} from './stage-source';

/** Only stage SWAP_ADJUSTMENT bills. HISTORY validates immutable receipts; it grants no new payment/allocation. */
export async function readStageSwapPaymentGuard(tx:any,bill:any,mode:'PAYMENT'|'ALLOCATION'|'HISTORY'='PAYMENT'){
 if(bill.serviceStageId==null||bill.type!=='SWAP_ADJUSTMENT')return null;
 const fact=(value:unknown)=>ensure(value,409,'SWAP_STAGE_PAYMENT_SOURCE','换车补差账单与冻结服务段、原义务或协议不一致');
 fact(['PAYMENT','ALLOCATION','HISTORY'].includes(mode)&&typeof bill.serviceStageId==='string'&&bill.serviceStageId.length>0);
 const obligations=await tx.serviceObligation.findMany({where:{chargeBillId:bill.id}}),obligation=obligations[0];fact(obligations.length===1&&obligation.serviceStageId===bill.serviceStageId);
 if(obligation.swapSettlementId){const source=await(await import('./fact-settlement')).readSwapFactBillPaymentGuard(tx,bill,undefined,mode);fact(source&&source.serviceStageScope);return{...source,quote:source!.q,serviceStageScope:source!.serviceStageScope!};}
 const order=await tx.order.findUnique({where:{id:bill.orderId}}),q=await tx.delayQuote.findUnique({where:{id:obligation.quoteId},include:{contract:true}}),change=q?await tx.orderChange.findUnique({where:{id:q.changeId}}):null;
 fact(order?.contractMode==='OFFLINE'&&change?.kind==='VEHICLE_CHANGE'&&change.orderId===order.id&&change.customerId===order.customerId&&bill.customerId===order.customerId&&obligation.orderId===order.id&&q?.financePreparedAt);
 const s=assertOfflineSwapQuote(change,q,{historical:true}),scope=await readSwapStageScope(tx,order,change.priorTerms,{historical:true});
 fact(scope&&scope.serviceStageId===bill.serviceStageId&&canonicalHash(scope)===canonicalHash(s.serviceStageScope));
 const agreement=await requireHistoricalPreparedQuoteAgreement(tx,change.id,q.id);fact(agreement.mode==='OFFLINE'&&agreement.archiveVersionId===q.approvedArchiveVersionId);
 const row=s.periods.find((p:any)=>p.sequence===obligation.sequence),fund=q.fundsSnapshot?.find((p:any)=>p.sequence===obligation.sequence);
 fact(row&&fund&&row.stageSequence===obligation.stageSequence&&fund.stageSequence===row.stageSequence&&obligation.stageSequence===obligation.sequence-scope!.firstPeriodSequence+1&&day(obligation.startDate)===row.startDate&&day(obligation.endDate)===row.endDate&&day(obligation.dueDate)===row.dueDate&&day(bill.dueDate)===row.dueDate&&bill.amount>0&&bill.amount===row.chargeAmount&&bill.amount===obligation.chargeAmount&&obligation.amount===row.amount&&bill.idempotencyKey===`delay-${q.id}-${row.sequence}`&&Array.isArray(obligation.sourceBillIds)&&Array.isArray(fund.sourceBillIds)&&canonicalHash([...obligation.sourceBillIds].sort())===canonicalHash([...fund.sourceBillIds].sort()));
 if(mode!=='HISTORY'){
  const preparing=change.activeQuoteId===q.id&&q.status==='CONFIRMED'&&['AWAITING_FINANCE','SWAP_RETURNED'].includes(change.status);
  ensure((obligation.active===true||preparing)&&q.status==='CONFIRMED'&&(mode==='PAYMENT'?bill.status==='PENDING'&&bill.paidAmount===0:['PENDING','PAID'].includes(bill.status)&&(bill.status==='PENDING'?bill.paidAmount===0:bill.paidAmount===bill.amount)),409,'SWAP_STAGE_PAYMENT_BLOCKED','此补差账单已支付、失效或被新资金方案替代，请按当前协议核对');
 }
 return{order,change,quote:q,obligation,serviceStageScope:scope!};
}
export async function prepareSwapAdjustments(tx:any,change:any,q:any,actor:any){
 const s=q.snapshot;
 if(!q.financePreparedAt){const now=await tx.payment.findMany({where:{customerId:change.customerId,status:'SUCCEEDED',bill:{orderId:change.orderId,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']}}},include:{refunds:true},orderBy:{id:'asc'}});const current=now.map((p:any)=>({id:p.id,amount:p.amount,net:p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)}));ensure(canonicalHash(current)===canonicalHash(s.depositFunds),409,'FUNDS_CHANGED','押金实际收退已变化，须核对已签资金方案');
  await tx.bill.updateMany({where:{orderId:change.orderId,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']},status:{in:['DRAFT','REVIEWED','PENDING']},paidAmount:0},data:{status:'VOID'}});
  for(const [type,amount,basis]of [['DEPOSIT_ADJUSTMENT',s.depositChargeAmount,s.depositBasis],['SWAP_HANDOVER_FEE',s.handoverFeeAmount,s.handoverFeeBasis]]){if(!amount)continue;const sequence=((await tx.bill.aggregate({where:{orderId:change.orderId,type},_max:{sequence:true}}))._max.sequence||0)+1;await tx.bill.create({data:{orderId:change.orderId,customerId:change.customerId,type,sequence,amount,dueDate:new Date(s.periods.find((r:any)=>r.sequence===s.affectedSequence).dueDate),description:basis,status:'PENDING',createdBy:q.createdBy,reviewedBy:q.reviewedBy,reviewedAt:new Date(),idempotencyKey:`swap-${q.id}-${type}`}});}
 }
 let remaining=s.depositRefundAmount;for(const p of s.depositFunds){const expected=Math.min(remaining,p.net);remaining-=expected;if(!expected)continue;const key=`delay-${q.id}-deposit-${p.id}`,refunds=await tx.refund.findMany({where:{paymentId:p.id,idempotencyKey:{startsWith:key}}});const paid=refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0);if(paid>=expected||refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))continue;await tx.refund.create({data:{paymentId:p.id,customerId:change.customerId,amount:expected-paid,reason:`换车补充协议 ${q.id} 押金原路退回`,requestedBy:actor.id,idempotencyKey:`${key}-${refunds.length}`}});}
}
export async function swapFinanceView(tx:any,change:any,q:any,bills:any[],obligations:any[],blockers:string[]){
 const s=q.snapshot,adjustments=bills.filter(b=>b.idempotencyKey?.startsWith(`swap-${financeQuoteId(q)}-`));
 if(adjustments.some(b=>b.status!=='PAID'||b.paidAmount!==b.amount||b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)))))blockers.push('本次押金补款或交接费尚未核清');
 const required=obligations.filter((o:any)=>o.sequence<=s.affectedSequence);if(required.some((o:any)=>o.allocatedAmount!==o.amount))blockers.push('交付所在期及之前应收尚未核清');
 const net=bills.filter(b=>['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(b.type)).flatMap(b=>b.payments).filter((p:any)=>p.status==='SUCCEEDED').reduce((n:number,p:any)=>n+p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((m:number,r:any)=>m+r.amount,0),0);
 if(net!==s.depositAmount)blockers.push('换车约定押金尚未按真实渠道净额核清');
 return{adjustments:adjustments.map(b=>({id:b.id,type:b.type,amount:b.amount,paidAmount:b.paidAmount,status:b.status,dueDate:b.dueDate.toISOString().slice(0,10)})),depositRefundAmount:s.depositRefundAmount};
}
