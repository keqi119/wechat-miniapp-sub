import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {BillingService} from '../src/billing/billing';
import {PaymentReconciliationService} from '../src/billing/reconciliation';
import {receivableCash} from '../src/billing/receivable-state';
import {billFundsReady} from '../src/billing/receipt-state';
import {financeView} from '../src/order-changes/finance';

// No DB, providers, network, or source writes: real command methods over isolated facts.
test('approved REFUNDED review restores a valid ordinary receivable after its refund was held for review',async()=>{
 const order:any={id:'order-review',customerId:'customer-review',status:'ACTIVE',revision:1,contractMode:'ESIGN',effectiveTermsVersionId:null};
 const bill:any={id:'bill-review',orderId:order.id,customerId:order.customerId,type:'SUBSCRIPTION',sequence:1,amount:10000,paidAmount:10000,status:'PAID',serviceStageId:null};
 const payment:any={id:'payment-review',billId:bill.id,customerId:order.customerId,status:'SUCCEEDED',amount:10000,revision:1,providerTransactionId:'synthetic-transaction',reconciliationRequired:true,reconciliationReason:'OFFLINE_ARCHIVE_REQUIRED',succeededAt:null};
 const refund:any={id:'refund-review',paymentId:payment.id,customerId:order.customerId,amount:10000,status:'PROCESSING',providerRefundId:null};
 const snapshot={paymentId:payment.id,billId:bill.id,customerId:payment.customerId,amount:payment.amount,providerTransactionId:payment.providerTransactionId,status:payment.status};
 const review:any={id:'review-1',paymentId:payment.id,status:'SUBMITTED',resolution:'REFUNDED',submittedBy:'maker-review',evidenceFileIds:['evidence-review'],paymentSnapshot:snapshot};
 const actor={id:'approver-review',role:'FINANCE',authVersion:1};
 const fullBill=()=>({...bill,order,payments:[{...payment,refunds:[{...refund}]}]});
 const fullPayment=()=>({...payment,bill:{...bill,order},refunds:[{...refund}]});
 const tx:any={
  $queryRaw:async()=>[],
  adminUser:{findUnique:async()=>({...actor,active:true,staffPersonId:'reviewer-person'}),findUniqueOrThrow:async()=>({...actor,active:true,staffPersonId:'reviewer-person'}),findMany:async({where}:any)=>where.id.in.map((id:string)=>({id,staffPersonId:'person-'+id}))},
  refund:{findUnique:async()=>({...refund,payment:fullPayment()}),update:async({data}:any)=>Object.assign(refund,data)},
  payment:{findUnique:async()=>fullPayment(),findUniqueOrThrow:async()=>fullPayment(),update:async({data}:any)=>{const {revision,...rest}=data;Object.assign(payment,rest);if(revision?.increment)payment.revision+=revision.increment;return fullPayment();}},
  bill:{findUniqueOrThrow:async()=>fullBill(),updateMany:async({data}:any)=>{Object.assign(bill,data);return{count:1};}},
  order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order},
  orderChange:{count:async()=>0},serviceObligation:{count:async()=>0},returnSettlement:{findFirst:async()=>null},vehicleReceiptEvent:{findFirst:async()=>null},
  paymentReconciliation:{count:async()=>0,findUnique:async()=>review,update:async({data}:any)=>Object.assign(review,data)},
  archiveCommand:{findUnique:async()=>null,create:async({data}:any)=>data},
  storedFile:{findMany:async()=>[{id:'evidence-review',adminId:'maker-review',customerId:null,purpose:'evidence',mimeType:'application/pdf',size:1}],count:async()=>0},
  electronicFileQuarantine:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},auditLog:{create:async({data}:any)=>data}
 };
 await new BillingService({serial:(fn:any)=>fn(tx)} as any,{} as any).settleRefund(refund.id,{status:'SUCCEEDED',providerRefundId:'synthetic-refund',paymentId:payment.id,amount:10000,totalAmount:10000});
 assert.equal(bill.status,'PAID'); // Correct: unresolved money is not silently reallocated.
 await new PaymentReconciliationService().review(tx,actor,payment.id,review.id,{revision:1,idempotencyKey:'review-approval-1',decision:'APPROVED',note:'independently checked full return'});
 assert.equal(payment.reconciliationRequired,false);
 assert.equal(receivableCash(fullBill()).net,0);
 assert.equal(bill.status,'PENDING');
 assert.equal(bill.paidAmount,0);
});

test('a repaid ordinary deposit remains usable when later applying a delivery-delay amendment',async()=>{
 const deposit={id:'deposit-review',type:'DEPOSIT',status:'PAID',amount:10000,paidAmount:10000,payments:[
  {id:'deposit-p1',status:'SUCCEEDED',amount:10000,reconciliationRequired:false,refunds:[{status:'SUCCEEDED',amount:3000}]},
  {id:'deposit-p2',status:'SUCCEEDED',amount:3000,reconciliationRequired:false,refunds:[]}
 ]};
 assert.equal(billFundsReady(deposit),true);
 const day=new Date('2026-11-06T00:00:00Z');
 const tx:any={
  delayQuote:{findUniqueOrThrow:async()=>({id:'quote-review',snapshot:{periods:[{refundAmount:0}]}})},
  serviceObligation:{findMany:async()=>[{sequence:1,startDate:day,endDate:day,dueDate:day,amount:10000,chargeAmount:0,allocations:[{amount:10000}]}]},
  refund:{findMany:async()=>[]},bill:{findMany:async()=>[deposit]}
 };
 const result=await financeView(tx,{id:'change-review',orderId:'order-review',kind:'DELIVERY_DELAY',activeQuoteId:'quote-review'});
 assert.deepEqual(result.blockers,[]);
});
