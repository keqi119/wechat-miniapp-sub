import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {renewalNow,renewalOps} from './order-renewals-fixture';
import {addRenewalCancellationArchive} from './renewal-cancellation-paper-fixture';

export const lateNow=new Date('2026-10-31T03:00:00Z');
/** Real in-memory confirmation/preparation/cancellation commands. Only channel receipt mutation is synthetic. */
export async function completedCancellationFixture(prepared=true,withRefundedPayment=false){
 const f=await renewalCancellationFixture(prepared),service:any=f.service,bill=prepared?f.bills.find(b=>b.serviceStageId===f.stage.id)!:null;
 const attempt:any=bill?{id:'known-closed-payment',billId:bill.id,customerId:f.customer.id,amount:bill.amount,status:'CLOSED',revision:2,providerTransactionId:null,succeededAt:null,reconciliationRequired:false,reconciliationReason:null,refunds:[],createdAt:renewalNow,updatedAt:renewalNow}:null;
 if(attempt)bill!.payments.push(attempt);else f.unsigned();
 const originalPayment=withRefundedPayment?f.pay(bill):null;
 if(originalPayment)f.refunds.push({id:'already-refunded-payment',paymentId:originalPayment.id,customerId:f.customer.id,amount:originalPayment.amount,status:'SUCCEEDED',providerRefundId:'original-real-refund',succeededAt:renewalNow,createdAt:renewalNow,updatedAt:renewalNow,renewalCancellationId:null,renewalCancellationOrderId:null,renewalCancellationStageId:null,renewalCancellationBillId:null});
 const input=async()=>{const p=await service.cancellationPreview(f.change.id,renewalOps);return{revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,...(f.cases[0]?{cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision}:{} )};};
 await service.openCancellation(f.change.id,{...await input(),reason:'双方取消未开始续期，全退新增实收无费用',idempotencyKey:'history-open'},renewalOps);
 await service.verifyCancellationSignature(f.change.id,{...await input(),signatureState:prepared?'SIGNED':'UNSIGNED',evidenceFileIds:[f.evidence.id],note:'核对全部原签字事实',idempotencyKey:'history-signature'},renewalOps);
 await service.confirmCancellationAgreement(f.change.id,{...await input(),mutuallyAgreedAt:renewalNow.toISOString(),evidenceFileIds:[f.evidence.id],note:'客户和出租方有权代表已同意取消本次续期',idempotencyKey:'history-mutual'},renewalOps);
 const paper=prepared?await addRenewalCancellationArchive(f,f.cases[0]):null;
 await service.cancelPrepared(f.change.id,{...await input(),reason:'原款核清，取消已完成',idempotencyKey:'history-complete'},renewalOps);
 const record=f.cases[0],writesBefore=f.writes.length;
 const arrive=()=>{Object.assign(attempt,{status:'SUCCEEDED',revision:3,providerTransactionId:'trusted-late-channel',succeededAt:new Date('2026-10-31T01:59:59Z'),updatedAt:lateNow,reconciliationRequired:true,reconciliationReason:'CLOSED后可信渠道晚到'});return attempt;};
 const refund=(amount=attempt.amount,status='SUCCEEDED',linked=false)=>{const r:any={id:'history-refund-'+f.refunds.length,paymentId:attempt.id,customerId:f.customer.id,amount,status,requestedBy:'finance',approvedBy:status==='SUCCEEDED'?'other-finance':null,providerRefundId:status==='SUCCEEDED'?'real-refund-'+f.refunds.length:null,succeededAt:status==='SUCCEEDED'?lateNow:null,createdAt:lateNow,updatedAt:lateNow,renewalCancellationId:linked?record.id:null,renewalCancellationOrderId:linked?f.order.id:null,renewalCancellationStageId:linked?f.stage.id:null,renewalCancellationBillId:linked?bill!.id:null};f.refunds.push(r);return r;};
 return{...f,bill,attempt,originalPayment,record,paper,arrive,refund,writesBefore};
}
