import {refundCashState} from './refund-proof';
/** Amounts are integer cents; pending refunds never count as settled cash. */
export function receiptState(payment:any){
 const refunds=payment.refunds||[];
 const pending=refunds.some((refund:any)=>['PENDING_APPROVAL','PROCESSING'].includes(refund.status));
 const cash=refundCashState(refunds),returned=cash.actualRefunded;
 const valid=!cash.hasConflict&&Number.isSafeInteger(payment.amount)&&payment.amount>=0&&Number.isSafeInteger(returned)&&returned>=0&&returned<=payment.amount;
 return{pending,returned,normalReturned:cash.normalRefunded,hasConflict:cash.hasConflict,valid,retained:valid?payment.amount-returned:0};
}

export function fullyReturnedReceipt(payment:any){
 const state=receiptState(payment);
 // Only the independently approved reconciliation command clears an exception.
 // A successful refund alone must not make an unresolved receipt disappear.
 return payment.status==='SUCCEEDED'&&!payment.reconciliationRequired&&state.valid&&!state.pending&&payment.amount>0&&state.returned===payment.amount;
}

export function billFundsReady(bill:any){
 if(bill.status!=='PAID'||bill.paidAmount!==bill.amount)return false;
 const payments=bill.payments||[];
 if(payments.some((payment:any)=>payment.reconciliationRequired||receiptState(payment).pending))return false;
 const receipts=payments.filter((payment:any)=>payment.status==='SUCCEEDED');
 // Retained cash from multiple receipts can cover the original unchanged bill.
 // Amended obligations still validate their own allocation ledger separately.
 if(receipts.some((payment:any)=>!receiptState(payment).valid))return false;
 return receipts.reduce((total:number,payment:any)=>total+receiptState(payment).retained,0)===bill.amount;
}
