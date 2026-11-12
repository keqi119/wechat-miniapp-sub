import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {cancellationRefundInput,cancellationLateRefundInput,cancellationLatePaymentsQuery} from './cancellation-inputs';
import {canonicalHash} from '../customers/types';
import {renewalId} from './types';
import {assertCancellationInput,bumpCancellationSource,cancellationCommand,cancellationPermission,cancellationSignatureReady,cancellationState} from './cancellation-commands';

/** Only prepares an independently reviewed request. No provider, approval or payment mutation occurs here. */
export async function requestRenewalCancellationRefund(tx:any,actor:any,changeId:string,raw:unknown,now:Date){
 const input=cancellationRefundInput.parse(raw);await cancellationPermission(tx,actor,'finance');return cancellationCommand(tx,actor,changeId,'REQUEST_REFUND',input,async()=>{
  const state=await cancellationState(tx,changeId,now);assertCancellationInput(state,input);const{record,facts}=state;await cancellationSignatureReady(tx,state,now);
  ensure(facts.stage&&record.serviceStageId===facts.stage.id,409,'RENEWAL_CANCELLATION_REFUND_SOURCE','未准备服务段不能申请续期账单退款');
  const payment=facts.funding.payments.find((p:any)=>p.id===input.paymentId);
  ensure(payment?.status==='SUCCEEDED'&&payment.customerId===facts.order.customerId&&payment.providerTransactionId&&payment.receivedAmount===payment.amount&&Number.isSafeInteger(payment.remainingRefundAmount)&&payment.remainingRefundAmount!>0&&payment.remainingRefundAmount!<=2147483647,409,'RENEWAL_CANCELLATION_REFUND_SOURCE','仅可退本服务段真实到账的剩余全额');
  ensure(!payment.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)),409,'RENEWAL_CANCELLATION_REFUND_PENDING','该笔实收仍有未结束退款，请先核对结果');
  // A reconciliation flag is precisely why some late receipts need refunds;
  // other unknown receipt/refund facts must never be used as an amount source.
  ensure(payment.blockers.every((b:string)=>b==='PAYMENT_RECONCILIATION_REQUIRED'),409,'RENEWAL_CANCELLATION_REFUND_UNRESOLVED','原到账或退款来源尚不完整');
  const old=await tx.refund.findUnique({where:{requestedBy_idempotencyKey:{requestedBy:actor.id,idempotencyKey:input.idempotencyKey}}});ensure(!old,409,'IDEMPOTENCY_CONFLICT','退款请求编号已用于另一笔请求');
  const refund=await tx.refund.create({data:{paymentId:payment.id,customerId:facts.order.customerId,amount:payment.remainingRefundAmount,reason:input.reason,status:'PENDING_APPROVAL',requestedBy:actor.id,idempotencyKey:input.idempotencyKey,renewalCancellationId:record.id,renewalCancellationOrderId:facts.order.id,renewalCancellationStageId:facts.stage.id,renewalCancellationBillId:payment.billId}});
  ensure((await tx.orderRenewalCancellation.updateMany({where:{id:record.id,revision:record.revision,status:'OPEN'},data:{revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','取消案已变化');await bumpCancellationSource(tx,facts);
  await audit(tx,actor.id,'RENEWAL_CANCELLATION_REQUEST_REFUND','refunds',refund.id,{cancellationId:record.id,changeId,paymentId:payment.id,billId:payment.billId,stageId:facts.stage.id,amount:refund.amount,sourceHash:record.sourceHash,fundingHash:facts.funding.sourceHash,reason:input.reason});
  return{refundId:refund.id,paymentId:payment.id,billId:payment.billId,amount:refund.amount,status:refund.status,cancellationId:record.id,cancellationRevision:input.cancellationRevision+1,changeId,revision:input.revision+1,orderRevision:input.orderRevision+1};
 });
}

async function lateRefundState(tx:any,changeId:string,paymentId:string){
 const facts=await(await import('./cancellation-late-facts')).readCompletedRenewalCancellationLateFacts(tx,renewalId.parse(changeId),{paymentId:renewalId.parse(paymentId)}),payment=facts.payments.find(p=>p.id===paymentId);
 ensure(payment,404,'NOT_FOUND','这笔付款不属于该已完成取消案');
 const{record,order}=facts.source,previewHash=canonicalHash({version:1,cancellationId:record.id,cancellationRevision:record.revision,completionHash:record.completionHash,orderRevision:order.revision,paymentId,sourceHash:facts.sourceHash});
 return{facts,payment,previewHash};
}

/** Discover target IDs from the verified whole-stage source before safe, stable pagination. */
export async function listRenewalCancellationLatePayments(tx:any,actor:any,changeId:string,raw:unknown){
 await cancellationPermission(tx,actor,'finance');const query=cancellationLatePaymentsQuery.parse(raw??{}),facts=await(await import('./cancellation-late-facts')).readCompletedRenewalCancellationLateFacts(tx,renewalId.parse(changeId)),{record,order,stage}=facts.source;
 const rows=[...facts.payments].sort((a,b)=>a.id.localeCompare(b.id)),offset=(query.page-1)*query.pageSize;
 return{changeId,cancellationId:record.id,cancellationRevision:record.revision,orderId:order.id,orderRevision:order.revision,stageId:stage?.id??null,page:query.page,pageSize:query.pageSize,total:rows.length,blockers:facts.blockers,items:rows.slice(offset,offset+query.pageSize).map(p=>({id:p.id,billId:p.billId,status:p.status,amount:p.amount,receivedAmount:p.receivedAmount,refundedAmount:p.refundedAmount,remainingRefundAmount:p.remainingRefundAmount,eligibleLateReceipt:p.eligibleLateReceipt,reconciliationRequired:p.reconciliationRequired,pendingRefundIds:p.pendingRefundIds,blockers:p.blockers}))};
}

/** A read-only view of one original request; the hash still covers all current stage money. */
export async function readRenewalCancellationLateRefundPreview(tx:any,actor:any,changeId:string,paymentId:string){
 await cancellationPermission(tx,actor,'finance');const{facts,payment,previewHash}=await lateRefundState(tx,changeId,paymentId),{record,order}=facts.source;
 return{changeId,cancellationId:record.id,cancellationRevision:record.revision,orderRevision:order.revision,stageId:record.serviceStageId,paymentId:payment.id,billId:payment.billId,amount:payment.amount,status:payment.status,completionStatus:payment.completionStatus,eligibleLateReceipt:payment.eligibleLateReceipt,receivedAmount:payment.receivedAmount,refundedAmount:payment.refundedAmount,remainingRefundAmount:payment.remainingRefundAmount,reconciliationRequired:payment.reconciliationRequired,pendingRefundIds:payment.pendingRefundIds,blockers:[...new Set([...facts.blockers,...payment.blockers])],previewHash};
}

/** Never reopens or rewrites a completed case. Only the full original late receipt can be requested. */
export async function requestRenewalCancellationLateRefund(tx:any,actor:any,changeId:string,raw:unknown){
 const input=cancellationLateRefundInput.parse(raw);await cancellationPermission(tx,actor,'finance');return cancellationCommand(tx,actor,changeId,'REQUEST_LATE_REFUND',input,async()=>{
  const{facts,payment,previewHash}=await lateRefundState(tx,changeId,input.paymentId),{record,order,stage}=facts.source;
  ensure(record.id===input.cancellationId&&record.revision===input.cancellationRevision&&order.revision===input.orderRevision,409,'VERSION_CONFLICT','取消案或订单版本已变化，请重新核对');
  ensure(input.previewHash===previewHash,409,'PREVIEW_CHANGED','迟到实收或退款事实已变化，请重新核对');
  ensure(stage&&record.serviceStageId===stage.id&&payment.eligibleLateReceipt&&payment.status==='SUCCEEDED'&&payment.customerId===order.customerId&&payment.providerTransactionId&&payment.receivedAmount===payment.amount&&Number.isSafeInteger(payment.remainingRefundAmount)&&payment.remainingRefundAmount!>0&&payment.remainingRefundAmount!<=2147483647,409,'RENEWAL_CANCELLATION_REFUND_SOURCE','仅可退取消完成时已记录且后来真实到账的原笔付款剩余全额');
  ensure(payment.pendingRefundIds.length===0,409,'RENEWAL_CANCELLATION_REFUND_PENDING','该笔迟到实收仍有未结束退款');
  ensure([...facts.blockers,...payment.blockers].every(b=>b==='PAYMENT_RECONCILIATION_REQUIRED'),409,'RENEWAL_CANCELLATION_REFUND_UNRESOLVED','迟到到账或退款来源尚未核清');
  const old=await tx.refund.findUnique({where:{requestedBy_idempotencyKey:{requestedBy:actor.id,idempotencyKey:input.idempotencyKey}}});ensure(!old,409,'IDEMPOTENCY_CONFLICT','退款请求编号已用于另一笔请求');
  const refund=await tx.refund.create({data:{paymentId:payment.id,customerId:order.customerId,amount:payment.remainingRefundAmount,reason:input.reason,status:'PENDING_APPROVAL',requestedBy:actor.id,idempotencyKey:input.idempotencyKey,renewalCancellationId:record.id,renewalCancellationOrderId:order.id,renewalCancellationStageId:stage.id,renewalCancellationBillId:payment.billId}});
  ensure((await tx.order.updateMany({where:{id:order.id,revision:order.revision},data:{revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','订单已变化');
  await audit(tx,actor.id,'RENEWAL_CANCELLATION_REQUEST_LATE_REFUND','refunds',refund.id,{cancellationId:record.id,changeId,paymentId:payment.id,billId:payment.billId,stageId:stage.id,amount:refund.amount,sourceHash:record.sourceHash,completionHash:record.completionHash,fundingHash:facts.sourceHash,reason:input.reason});
  return{refundId:refund.id,paymentId:payment.id,billId:payment.billId,amount:refund.amount,status:refund.status,cancellationId:record.id,cancellationRevision:record.revision,changeId,orderRevision:input.orderRevision+1};
 });
}
