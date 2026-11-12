import {canonicalHash} from '../customers/types';
/** Validates stored, independently verified bank evidence against this exact Refund.
 * Method labels and SUCCEEDED alone are never cash proof. No private account data is needed. */
export function refundReceiptIdentity(r:any):string|null {
 if(r?.status!=='SUCCEEDED'||!r.succeededAt)return null;
 if(!r.method||r.method==='WECHAT_ORIGINAL')return typeof r.providerRefundId==='string'&&r.providerRefundId?`WECHAT:${r.providerRefundId}`:null;
 if(r.method!=='MANUAL_BANK'||r.providerRefundId)return null;
 const p=r.bankExecution,s=p?.source,a=r.bankAccount;
 if(p?.version!==1||p.status!=='VERIFIED'||!s||canonicalHash(s)!==p.sourceHash||a?.status!=='VERIFIED'||a.hash!==s.accountHash||s.refundId!==r.id||s.paymentId!==r.paymentId||s.customerId!==r.customerId||s.amount!==r.amount||new Date(r.succeededAt).getTime()!==Date.parse(s.paidAt))return null;
 if(!p.recordedBy||!p.reviewedBy||p.recordedBy===p.reviewedBy||!p.recordedPersonId||!p.reviewedPersonId||p.recordedPersonId===p.reviewedPersonId||!p.reviewedAt||!s.payerName||!s.payeeName||!s.reference||!s.files?.length||!s.files.every((f:any)=>f.id&&/^[a-f0-9]{64}$/.test(f.sha256)))return null;
 const receiptKey=canonicalHash({payerName:s.payerName,reference:s.reference});
 return r.bankReceiptKey===receiptKey?`BANK:${receiptKey}`:null;
}
export const hasRefundReceipt=(r:any)=>refundReceiptIdentity(r)!==null;
export function safeRefund(r:any){const {bankAccountCiphertext,payment,...safe}=r;return safe;}

/** Normal obligation performance and actual cash are different when linked attempts both pay. */
export function normalRefundAmount(r:any):number{return r.duplicateReceipt?.normalRefundId&&r.duplicateReceipt.normalRefundId!==r.id?0:r.amount;}
export function refundCashState(rows:any[]){
 const succeeded=rows.filter(r=>r.status==='SUCCEEDED'),pending=rows.filter(r=>['PENDING_APPROVAL','PROCESSING'].includes(r.status));
 const external=rows.filter(r=>r.duplicateReceipt&&!r.duplicateReceipt.additionalRefundId);
 const normalRefunded=succeeded.reduce((n,r)=>n+normalRefundAmount(r),0),actualRefunded=succeeded.reduce((n,r)=>n+r.amount,0)+external.reduce((n,r)=>n+(r.duplicateReceipt.verifiedExtraAmount??(r.duplicateReceipt.bank?.status==='VERIFIED'?r.duplicateReceipt.unresolvedExtraAmount:0)),0);
 const reserved=succeeded.reduce((n,r)=>n+r.amount,0)+pending.reduce((n,r)=>n+r.amount,0)+external.reduce((n,r)=>n+r.duplicateReceipt.unresolvedExtraAmount,0);
 return{normalRefunded,actualRefunded,reserved,hasConflict:rows.some(r=>!!r.duplicateReceipt)};
}
