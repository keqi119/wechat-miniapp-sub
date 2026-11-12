import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {lockOrder} from '../offline-documents/readiness';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {cancellationState,cancellationSignatureReady} from '../order-renewals/cancellation-commands';
import {readCompletedRenewalCancellationLateFacts} from '../order-renewals/cancellation-late-facts';
import type {CancellationPaymentFact} from '../order-renewals/cancellation-types';

const fields=['renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId'] as const;
const id=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
export function isRenewalCancellationRefund(item:any){return !!item&&fields.some(field=>item[field]!=null);}
function source(value:unknown,message='退款须对应本取消案的真实新增续期实收'):asserts value{ensure(value,409,'RENEWAL_CANCELLATION_REFUND_SOURCE',message);}

/** Order first, then refund. Re-read after waiting so a stale rejection cannot overwrite approval. */
export async function lockRenewalCancellationRefund(tx:any,reference:any){
 if(!reference)return reference;
 const bound=isRenewalCancellationRefund(reference);
 if(bound)source(fields.every(field=>id(reference[field])));
 const bill=reference.payment?await tx.bill.findUnique({where:{id:reference.payment.billId}}):null;
 if(!bound&&!bill?.serviceStageId)return reference;
 const orderId=bound?reference.renewalCancellationOrderId:bill.orderId;
 await lockOrder(tx,orderId);await tx.$queryRaw`SELECT id FROM "Refund" WHERE id=${reference.id} FOR UPDATE`;
 const current=await tx.refund.findUnique({where:{id:reference.id},include:{payment:true}});
 ensure(current,409,'STATE_CONFLICT','退款请求已变化');
 source(fields.every(field=>(current[field]??null)===(reference[field]??null))&&current.paymentId===reference.paymentId&&current.customerId===reference.customerId);
 return current;
}

export async function requireCancellationRefundStaff(tx:any,actor:any){
 ensure(actor&&id(actor.id)&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED','请使用当前财务人员会话');
 const current=await requireCurrentStaff(tx,actor,'bills');ensure(['ADMIN','FINANCE'].includes(current.role),403,'FORBIDDEN','仅财务人员可处理退款');
}

export async function assertRenewalCancellationRefundManaged(tx:any,bill:any){
 if(bill?.serviceStageId)ensure(!await tx.orderRenewalCancellation.findFirst({where:{serviceStageId:bill.serviceStageId,status:{in:['OPEN','COMPLETED']}}}),409,'RENEWAL_CANCELLATION_REFUND_MANAGED','续期取消退款请使用取消案的全额退款或迟到款退款流程');
}

/** New money dispatch only. Trusted query/callback receipts deliberately do not call this readiness gate. */
export async function guardRenewalCancellationRefund(tx:any,item:any,actor:any,now:Date,mode:'APPROVE'|'RETRY'){
 const bound=isRenewalCancellationRefund(item);
 const bill=item?.payment?await tx.bill.findUnique({where:{id:item.payment.billId}}):null;
 if(!bound){
  await assertRenewalCancellationRefundManaged(tx,bill);
  return null;
 }
 source(fields.every(field=>id(item[field])));await requireCancellationRefundStaff(tx,actor);
 const record=await tx.orderRenewalCancellation.findUnique({where:{id:item.renewalCancellationId}});
 source(record&&['OPEN','COMPLETED'].includes(record.status)&&record.orderId===item.renewalCancellationOrderId&&record.customerId===item.customerId&&record.serviceStageId===item.renewalCancellationStageId&&bill?.id===item.renewalCancellationBillId&&bill.orderId===record.orderId&&bill.customerId===record.customerId&&bill.serviceStageId===record.serviceStageId);
 if(record.sourceSnapshot?.version===31){
  const {readV31CancellationSource,v31CancellationView}=await import('../order-renewals/cancellation-v31'),s=await readV31CancellationSource(tx,record.changeId),view=await v31CancellationView(tx,s),p=view.refundSources.find((p:any)=>p.paymentId===item.paymentId);
  source(s.stage?.status==='VOIDED'&&s.history.some((f:any)=>f.kind==='CORRECTED')&&p&&p.billId===bill.id&&p.remainingAmount===item.amount&&p.remainingAmount>0);
  const pending=p.refunds.filter((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status));source(pending.length===1&&pending[0].id===item.id&&pending[0].amount===item.amount&&pending[0].status===item.status);
  const reviewer=mode==='APPROVE'?actor.id:item.approvedBy;source(id(reviewer));await assertIndependentStaffReview(tx,reviewer,[item.requestedBy],'DUAL_APPROVAL');
  return{cancellationId:record.id,fundingHash:view.financialSourceHash,sourceHash:record.sourceHash};
 }
 let payment:CancellationPaymentFact|undefined,fundingHash:string;
 if(record.status==='COMPLETED'){
  const late=await readCompletedRenewalCancellationLateFacts(tx,record.changeId);
  source(late.source.record.id===record.id&&late.source.stage?.id===record.serviceStageId);
  const candidate=late.payments.find(p=>p.id===item.paymentId);source(candidate?.eligibleLateReceipt);payment=candidate;
  source(late.payments.flatMap(p=>p.pendingRefundIds).every(id=>id===item.id),'其他迟到款退款尚未结束，请核对结果后办理');
  ensure(late.blockers.every(code=>['REFUND_UNRESOLVED','PAYMENT_RECONCILIATION_REQUIRED'].includes(code)),409,'RENEWAL_CANCELLATION_REFUND_UNRESOLVED','已完成取消的迟到款来源尚未核清');
  fundingHash=late.sourceHash;
 }else{
  const state=await cancellationState(tx,record.changeId,now),{facts}=state;
  source(state.record?.id===record.id&&facts.stage?.id===record.serviceStageId);
  await cancellationSignatureReady(tx,state,now);
  payment=facts.funding.payments.find(p=>p.id===item.paymentId);fundingHash=facts.funding.sourceHash;
 }
 source(payment?.status==='SUCCEEDED'&&payment.billId===bill.id&&payment.customerId===item.customerId&&payment.providerTransactionId&&payment.receivedAmount===payment.amount&&Number.isSafeInteger(payment.remainingRefundAmount)&&payment.remainingRefundAmount!>0&&payment.remainingRefundAmount===item.amount);
 const pending=payment.refunds.filter(r=>['PENDING_APPROVAL','PROCESSING'].includes(r.status));
 source(pending.length===1&&pending[0].id===item.id&&pending[0].amount===item.amount&&pending[0].status===item.status&&pending[0].renewalCancellationId===record.id);
 // The one request being approved/recovered causes REFUND_UNRESOLVED. Other
 // uncertain money facts cannot be ignored. Late verified receipts may need reconciliation after refund.
 ensure(payment.blockers.every(code=>['REFUND_UNRESOLVED','PAYMENT_RECONCILIATION_REQUIRED'].includes(code)),409,'RENEWAL_CANCELLATION_REFUND_UNRESOLVED','本笔实际收退款仍有未核清事实');
 const reviewer=mode==='APPROVE'?actor.id:item.approvedBy;source(id(reviewer));
 await assertIndependentStaffReview(tx,reviewer,[item.requestedBy],'DUAL_APPROVAL');
 return{cancellationId:record.id,fundingHash,sourceHash:record.sourceHash,...(record.status==='COMPLETED'?{completionHash:record.completionHash}:{} )};
}
