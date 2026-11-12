import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {receivableCash} from '../src/billing/receivable-state';
test('verified manual refund evidence proves exact money without counterfeit provider ID',()=>{
 const source={refundId:'r',paymentId:'p',customerId:'c',amount:30,accountHash:'a'.repeat(64),reference:'bank-ref',payerName:'宁达',payeeName:'本人',paidAt:'2026-11-07T10:00:00Z',files:[{id:'f',sha256:'b'.repeat(64)}]},proof={version:1,status:'VERIFIED',source,sourceHash:canonicalHash(source),recordedBy:'m',recordedPersonId:'person-m',reviewedBy:'v',reviewedPersonId:'person-v',reviewedAt:'2026-11-08T10:00:00Z'};
 const refund:any={id:'r',paymentId:'p',customerId:'c',amount:30,status:'SUCCEEDED',method:'MANUAL_BANK',providerRefundId:null,succeededAt:new Date(source.paidAt),bankAccount:{hash:source.accountHash,status:'VERIFIED'},bankExecution:proof,bankReceiptKey:canonicalHash({payerName:source.payerName,reference:source.reference})};
 const bill:any={id:'b',customerId:'c',amount:100,paidAmount:70,payments:[{id:'p',billId:'b',customerId:'c',amount:100,status:'SUCCEEDED',providerTransactionId:'wx-p',reconciliationRequired:false,refunds:[refund]}]};
 assert.equal(receivableCash(bill).valid,true);assert.equal(receivableCash(bill).net,70);
 refund.bankExecution={...proof,reviewedPersonId:'person-m'};assert.equal(receivableCash(bill).valid,false);
 refund.bankExecution={...proof,source:{...source,amount:31}};assert.equal(receivableCash(bill).valid,false);
 refund.bankExecution=proof;refund.succeededAt=new Date('2026-11-06');assert.equal(receivableCash(bill).valid,false);
});
import {validateReconciliationResolution} from '../src/billing/reconciliation';
test('REFUND_ONLY can review an actual exceptional receipt before cash is returned without applying it to bill',()=>{
 const payment={id:'p',status:'SUCCEEDED',providerTransactionId:'original',amount:100,refunds:[]},bill={id:'b',type:'SWAP_ADJUSTMENT',serviceStageId:'s'};
 assert.doesNotThrow(()=>validateReconciliationResolution(payment,bill,'REFUND_ONLY'));
});

import {refundCashState,normalRefundAmount} from '../src/billing/refund-proof';
test('shared cash projection counts normal performance once and each real transfer once',()=>{
 const normal={id:'n',amount:100,status:'SUCCEEDED'},additional={id:'a',amount:100,status:'SUCCEEDED',duplicateReceipt:{normalRefundId:'n',additionalRefundId:'a',verifiedExtraAmount:100,unresolvedExtraAmount:100}};
 assert.equal(normalRefundAmount(additional),0);assert.deepEqual(refundCashState([normal,additional]),{normalRefunded:100,actualRefunded:200,reserved:200,hasConflict:true});
 const bank={...normal,duplicateReceipt:{verifiedExtraAmount:100,unresolvedExtraAmount:100}};assert.deepEqual(refundCashState([bank]),{normalRefunded:100,actualRefunded:200,reserved:200,hasConflict:true});
 const pendingBank={...normal,duplicateReceipt:{verifiedExtraAmount:0,unresolvedExtraAmount:100}};assert.deepEqual(refundCashState([pendingBank]),{normalRefunded:100,actualRefunded:100,reserved:200,hasConflict:true});
});
