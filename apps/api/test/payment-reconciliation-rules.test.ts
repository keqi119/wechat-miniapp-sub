import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReconciliationResolution} from '../src/billing/reconciliation';
test('manual exception reconciliation preserves actual money and requires exact original bill or full refund',()=>{
 const payment:any={status:'SUCCEEDED',amount:100,providerTransactionId:'verified-tx',refunds:[]};const bill:any={type:'SUBSCRIPTION',status:'PAID',amount:100,paidAmount:100};
 assert.doesNotThrow(()=>validateReconciliationResolution(payment,bill,'APPLY_TO_BILL'));
 for(const change of [{status:'VOID'},{amount:101},{paidAmount:99}])assert.throws(()=>validateReconciliationResolution(payment,{...bill,...change},'APPLY_TO_BILL'));
 payment.refunds=[{status:'PROCESSING',amount:100}];assert.throws(()=>validateReconciliationResolution(payment,bill,'APPLY_TO_BILL'));assert.throws(()=>validateReconciliationResolution(payment,bill,'REFUNDED'));
 payment.refunds=[{status:'SUCCEEDED',amount:100}];assert.doesNotThrow(()=>validateReconciliationResolution(payment,{status:'VOID'},'REFUNDED'));assert.throws(()=>validateReconciliationResolution(payment,bill,'APPLY_TO_BILL'));
 payment.amount=101;assert.throws(()=>validateReconciliationResolution(payment,bill,'REFUNDED'));
});
