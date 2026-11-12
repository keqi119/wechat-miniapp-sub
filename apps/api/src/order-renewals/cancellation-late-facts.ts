import {hasRefundReceipt,refundReceiptIdentity,normalRefundAmount,refundCashState} from '../billing/refund-proof';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {agreementInstant} from '../order-changes/agreement-facts';
import {stageDay} from '../order-service-stages/source';
import {readCompletedRenewalCancellationSource} from './cancellation-history';
import type {CancellationRefundFact} from './cancellation-types';

const id=(v:any)=>typeof v==='string'&&!!v.trim()&&!v.includes('\0');
const cents=(v:any)=>Number.isInteger(v)&&v>=0&&v<=2147483647;
const instant=(v:any)=>Number.isFinite(agreementInstant(v));
const iso=(v:any)=>instant(v)?new Date(v).toISOString():null;
const unique=(v:string[])=>[...new Set(v)].sort();
const sorted=(rows:any[])=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const same=(a:any,b:any)=>canonicalHash(a)===canonicalHash(b);
const version1RefundFields=['id','paymentId','customerId','amount','status','providerRefundId','succeededAt','renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId','createdAt','updatedAt'] as const;
function sameFrozenRefund(current:any,frozen:any,version:number){
 if(version!==1||Object.hasOwn(frozen,'method')||Object.hasOwn(frozen,'receiptIdentity'))return same(current,frozen);
 // The old version1 shape proves original-channel money only. Current method proof
 // is checked independently below; presentation fields never rewrite frozen evidence.
 if(current.method!=='WECHAT_ORIGINAL'||current.receiptIdentity!==`WECHAT:${frozen.providerRefundId}`||current.duplicateReceipt)return false;
 return same(Object.fromEntries(version1RefundFields.map(field=>[field,current[field]])),frozen);
}
function fact(v:unknown):asserts v{ensure(v,409,'RENEWAL_CANCELLATION_LATE_SOURCE','已取消续期的迟到款账单或期间来源不一致');}
export type CompletedCancellationLatePayment={id:string;billId:string;customerId:string;amount:number;status:string;revision:number;completionStatus:string|null;eligibleLateReceipt:boolean;receivedAmount:number|null;refundedAmount:number|null;remainingRefundAmount:number|null;providerTransactionId:string|null;succeededAt:string|null;reconciliationRequired:boolean;refunds:CancellationRefundFact[];pendingRefundIds:string[];blockers:string[]};

/** No amount override, pending-refund bypass, write, or case reopening. Caller separately authorizes and locks. */
export async function readCompletedRenewalCancellationLateFacts(tx:any,changeId:string,input:{paymentId?:string}={}){
 const source=await readCompletedRenewalCancellationSource(tx,changeId),{record,order,quote,stage,snapshot,completion}=source,blockers:string[]=[];
 if(input.paymentId!==undefined)fact(id(input.paymentId));
 if(!stage){const sourceHash=canonicalHash({completionHash:record.completionHash,payments:[]});return{source,payments:[] as CompletedCancellationLatePayment[],sourceHash,blockers};}
 const bills=sorted(await tx.bill.findMany({where:{serviceStageId:stage.id},orderBy:{id:'asc'}})),obligations=sorted(await tx.serviceObligation.findMany({where:{serviceStageId:stage.id},orderBy:{id:'asc'}}));
 fact(snapshot&&bills.length===snapshot.billingSchedule.length&&obligations.length===bills.length&&completion.funding.bills.length===bills.length&&completion.funding.obligations.length===obligations.length);
 for(const row of snapshot!.billingSchedule){
  const bs=bills.filter(b=>b.sequence===row.sequence),os=obligations.filter(o=>o.sequence===row.sequence&&o.stageSequence===row.stageSequence),b=bs[0],o=os[0],old=completion.funding.bills.find((x:any)=>x.id===b?.id),oldO=completion.funding.obligations.find((x:any)=>x.id===o?.id);
  fact(bs.length===1&&os.length===1&&old&&oldO&&b.type==='SUBSCRIPTION'&&b.orderId===order.id&&b.customerId===order.customerId&&b.serviceStageId===stage.id&&b.amount===row.amount&&old.amount===b.amount&&old.sequence===row.sequence&&old.stageSequence===row.stageSequence&&stageDay(b.dueDate)===row.dueDate&&b.idempotencyKey===`renewal:${quote.id}:${row.sequence}`&&old.idempotencyKey===b.idempotencyKey);
  fact(o.orderId===order.id&&o.quoteId===quote.id&&o.serviceStageId===stage.id&&o.chargeBillId===b.id&&oldO.chargeBillId===b.id&&o.amount===row.amount&&o.chargeAmount===row.amount&&o.active===false&&Array.isArray(o.sourceBillIds)&&o.sourceBillIds.length===0&&stageDay(o.startDate)===row.startDate&&stageDay(o.endDate)===row.endDate&&stageDay(o.dueDate)===row.dueDate);
 }
 const raw=sorted(await tx.payment.findMany({where:{billId:{in:bills.map(b=>b.id)}},include:{refunds:true},orderBy:{id:'asc'}})),allRefunds=raw.flatMap(p=>p.refunds??[]),reviews=raw.length?await tx.paymentReconciliation.findMany({where:{paymentId:{in:raw.map(p=>p.id)}},orderBy:{id:'asc'}}):[];
 if(completion.funding.payments.some((p:any)=>raw.filter(r=>r.id===p.id).length!==1))blockers.push('COMPLETION_PAYMENT_MISSING');
 const payments:CompletedCancellationLatePayment[]=raw.map(p=>{
  const errors:string[]=[],notEligible:string[]=[],b=bills.find(b=>b.id===p.billId),old=completion.funding.payments.filter((x:any)=>x.id===p.id);
  const original=old[0],known=old.length===1&&['CLOSED','FAILED'].includes(original.status)&&original.receivedAmount===0&&original.refundedAmount===0&&original.remainingRefundAmount===0&&original.providerTransactionId==null&&original.succeededAt==null&&Array.isArray(original.blockers)&&original.blockers.length===0;
  const identity=old.length===1&&p.billId===original.billId&&p.customerId===original.customerId&&p.customerId===order.customerId&&p.amount===original.amount&&cents(original.revision)&&cents(p.revision)&&p.revision>=original.revision;
  const matching=known&&identity&&p.revision>original.revision&&instant(p.updatedAt)&&agreementInstant(p.updatedAt)>=agreementInstant(record.completedAt);
  const oldSettled=identity&&original.status==='SUCCEEDED'&&original.receivedAmount===original.amount&&original.refundedAmount===original.amount&&original.remainingRefundAmount===0&&p.status==='SUCCEEDED'&&p.providerTransactionId===original.providerTransactionId&&iso(p.succeededAt)===original.succeededAt&&Array.isArray(original.blockers)&&original.blockers.length===0;
  const stillClosed=known&&identity&&['CLOSED','FAILED'].includes(p.status)&&p.providerTransactionId==null&&p.succeededAt==null;
  if(!known){if(oldSettled)notEligible.push('PAYMENT_NOT_FROZEN_CLOSED');else errors.push('PAYMENT_NOT_FROZEN_CLOSED');}
  else if(!matching&&!stillClosed)errors.push('LATE_PAYMENT_SOURCE_MISMATCH');
  let receipt=cents(p.amount)&&p.amount>0&&id(p.id)&&p.customerId===order.customerId&&!!b;
  if(raw.filter(x=>x.id===p.id).length!==1||p.providerTransactionId&&raw.filter(x=>x.providerTransactionId===p.providerTransactionId).length!==1){receipt=false;errors.push('MONEY_DUPLICATE_FACT');}
  if(!['CREATING','PENDING','SUCCEEDED','FAILED','CLOSED'].includes(p.status)){receipt=false;errors.push('PAYMENT_STATUS_UNKNOWN');}
  if(p.status!=='SUCCEEDED')(stillClosed?notEligible:errors).push('LATE_RECEIPT_NOT_VERIFIED');
  if(p.status==='SUCCEEDED'&&(!id(p.providerTransactionId)||!instant(p.succeededAt))){receipt=false;errors.push('PAYMENT_RECEIPT_UNPROVED');}
  if(p.status!=='SUCCEEDED'&&(p.succeededAt||p.providerTransactionId)){receipt=false;errors.push('PAYMENT_RECEIPT_CONFLICT');}
  if(!receipt)errors.push('PAYMENT_SOURCE_MISMATCH');
  if(p.reconciliationRequired!==false)errors.push('PAYMENT_RECONCILIATION_REQUIRED');
  let refundValid=Array.isArray(p.refunds),refunded=0;const pendingRefundIds:string[]=[];
  const refunds:CancellationRefundFact[]=sorted(p.refunds??[]).map(r=>{
   const fields=['renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId'],legacy=fields.every(k=>r[k]==null),bound=fields.every(k=>id(r[k]))&&r.renewalCancellationId===record.id&&r.renewalCancellationOrderId===order.id&&r.renewalCancellationStageId===stage.id&&r.renewalCancellationBillId===p.billId;
   if(!id(r.id)||r.paymentId!==p.id||r.customerId!==order.customerId||!cents(r.amount)||r.amount<=0||(!legacy&&!bound)){refundValid=false;errors.push('REFUND_SOURCE_MISMATCH');}
   if(allRefunds.filter(x=>x.id===r.id).length!==1||refundReceiptIdentity(r)&&allRefunds.filter(x=>refundReceiptIdentity(x)===refundReceiptIdentity(r)).length!==1){refundValid=false;errors.push('MONEY_DUPLICATE_FACT');}
   if(!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(r.status)){refundValid=false;errors.push('REFUND_STATUS_UNKNOWN');}
   if(['PENDING_APPROVAL','PROCESSING'].includes(r.status)){pendingRefundIds.push(r.id);errors.push('REFUND_UNRESOLVED');}
   if(r.status==='SUCCEEDED'){if(!hasRefundReceipt(r)||!instant(r.succeededAt)||p.status!=='SUCCEEDED'){refundValid=false;errors.push('REFUND_RECEIPT_UNPROVED');}if(cents(r.amount))refunded+=normalRefundAmount(r);}
   else if(r.succeededAt){refundValid=false;errors.push('REFUND_RECEIPT_CONFLICT');}
   return{id:r.id,paymentId:r.paymentId,customerId:r.customerId,amount:r.amount,status:r.status,...(r.duplicateReceipt?{normalAmount:normalRefundAmount(r),duplicateReceipt:r.duplicateReceipt}:{}),method:r.method??'WECHAT_ORIGINAL',receiptIdentity:refundReceiptIdentity(r),providerRefundId:r.providerRefundId??null,succeededAt:iso(r.succeededAt),renewalCancellationId:r.renewalCancellationId??null,renewalCancellationOrderId:r.renewalCancellationOrderId??null,renewalCancellationStageId:r.renewalCancellationStageId??null,renewalCancellationBillId:r.renewalCancellationBillId??null,createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt)};
  });
  if(oldSettled&&(refunded!==original.refundedAmount||!Array.isArray(original.refunds)||original.refunds.filter((r:any)=>r.status==='SUCCEEDED').some((r:any)=>!refunds.some(current=>current.id===r.id&&sameFrozenRefund(current,r,completion.version))))){refundValid=false;errors.push('COMPLETION_REFUND_CHANGED');}
  if(!Number.isSafeInteger(refunded)||refunded>p.amount){refundValid=false;errors.push('REFUND_AMOUNT_CONFLICT');}if(!refundValid)errors.push('REFUND_SOURCE_MISMATCH');
  const ownReviews=reviews.filter((r:any)=>r.paymentId===p.id),receiptSnapshot={paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,status:p.status};
  const approved=(r:any)=>r.status==='APPROVED'&&r.resolution==='REFUNDED'&&same(r.paymentSnapshot,receiptSnapshot)&&id(r.submittedBy)&&id(r.reviewedBy)&&r.submittedBy!==r.reviewedBy&&instant(r.createdAt)&&instant(r.reviewedAt)&&agreementInstant(r.reviewedAt)>=agreementInstant(r.createdAt)&&Array.isArray(r.evidenceFileIds)&&r.evidenceFileIds.length>0&&r.evidenceFileIds.every(id);
  if((p.reconciliationReason||ownReviews.length)&&!ownReviews.some(approved))errors.push('PAYMENT_RECONCILIATION_REQUIRED');
  if(ownReviews.some((r:any)=>r.status==='APPROVED'&&!approved(r)||!['SUBMITTED','APPROVED','REJECTED'].includes(r.status)))errors.push('RECONCILIATION_SOURCE_MISMATCH');
  if(ownReviews.some((r:any)=>r.status==='SUBMITTED'))errors.push('PAYMENT_RECONCILIATION_REQUIRED');
  const receivedAmount=receipt?(p.status==='SUCCEEDED'?p.amount:0):null,refundedAmount=refundValid?refunded:null,remainingRefundAmount=receivedAmount!==null&&refundedAmount!==null?receivedAmount-refundedAmount:null;
  const eligibleLateReceipt=!!matching&&receipt&&p.status==='SUCCEEDED';blockers.push(...errors);
  return{id:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,status:p.status,revision:p.revision,completionStatus:original?.status??null,eligibleLateReceipt,receivedAmount,refundedAmount,remainingRefundAmount,providerTransactionId:p.providerTransactionId??null,succeededAt:iso(p.succeededAt),reconciliationRequired:p.reconciliationRequired!==false,...(refundCashState(p.refunds??[]).hasConflict?{cash:refundCashState(p.refunds??[])}:{}),refunds,pendingRefundIds:unique(pendingRefundIds),blockers:unique([...errors,...notEligible])};
 });
 for(const bill of bills){const gross=payments.filter(p=>p.billId===bill.id).reduce((sum,p)=>sum+BigInt(p.receivedAmount??0),0n);if(!cents(bill.paidAmount)||BigInt(bill.paidAmount)>gross)blockers.push('BILL_RECEIPT_COUNTER_CONFLICT');if(bill.status==='PAID'&&bill.paidAmount!==bill.amount)blockers.push('BILL_PAID_STATE_CONFLICT');}
 const sourceHash=canonicalHash({completionHash:record.completionHash,orderRevision:order.revision,cancellationRevision:record.revision,stageRevision:stage.revision,bills:bills.map(b=>({id:b.id,status:b.status,amount:b.amount,paidAmount:b.paidAmount})),payments,paymentObservations:raw.map(p=>({id:p.id,updatedAt:iso(p.updatedAt),reconciliationReason:p.reconciliationReason??null})),reviews:sorted(reviews).map(r=>({id:r.id,paymentId:r.paymentId,status:r.status,resolution:r.resolution,paymentSnapshot:r.paymentSnapshot,evidenceFileIds:r.evidenceFileIds??[],submittedBy:r.submittedBy,reviewedBy:r.reviewedBy??null,createdAt:iso(r.createdAt),reviewedAt:iso(r.reviewedAt)}))});
 return{source,payments:input.paymentId===undefined?payments:payments.filter(p=>p.id===input.paymentId),sourceHash,blockers:unique(blockers)};
}
