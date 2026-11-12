import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {BillingService} from '../src/billing/billing';
import {billFundsReady} from '../src/billing/receipt-state';
import {collectionBillFact} from '../src/collections/facts';
import {receivableCash,ordinaryReceivableScope,remainingBillPayment} from '../src/billing/receivable-state';

function fixture(refundAmount=369900,orderStatus='AWAITING_PAYMENT'){
 const order:any={id:'order-1',customerId:'customer-1',status:orderStatus,revision:1,contractMode:'ONLINE',finalPlanSnapshot:{},effectiveTermsVersionId:null};
 const bill:any={id:'bill-1',orderId:order.id,customerId:order.customerId,type:'SUBSCRIPTION',sequence:1,amount:369900,paidAmount:369900,status:'PAID',dueDate:new Date('2026-11-05T00:00:00Z'),serviceStageId:null};
 const payment:any={id:'pay-1',billId:bill.id,customerId:order.customerId,amount:369900,status:'SUCCEEDED',revision:1,reconciliationRequired:false,providerTransactionId:'synthetic-receipt',succeededAt:null};
 const refund:any={id:'refund-1',paymentId:payment.id,customerId:order.customerId,amount:refundAmount,status:'PROCESSING',approvedBy:'reviewer',requestedBy:'maker',providerRefundId:null};
 const audits:any[]=[];const viewBill=()=>({...bill,order,payments:[{...payment,refunds:[{...refund}]}]});
 const tx:any={
  $queryRaw:async()=>[],
  refund:{findUnique:async()=>({...refund,payment:{...payment,bill:{...bill,order}}}),update:async({data}:any)=>Object.assign(refund,data),findMany:async()=>[{...refund}]},
  bill:{findUnique:async()=>viewBill(),findUniqueOrThrow:async()=>viewBill(),findMany:async()=>[viewBill()],update:async({data}:any)=>Object.assign(bill,data),updateMany:async({data}:any)=>{Object.assign(bill,data);return{count:1};}},
  payment:{findMany:async()=>viewBill().payments,findUnique:async()=>({...payment,bill:{...bill,order},refunds:[{...refund}]})},
  order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order,updateMany:async({data}:any)=>{const {revision,...rest}=data;Object.assign(order,rest);if(revision?.increment)order.revision+=revision.increment;return{count:1};}},
  serviceObligation:{count:async()=>0,findFirst:async()=>null},orderChange:{count:async()=>0,findFirst:async()=>null},
  usageAccount:{findUnique:async()=>null},returnSettlement:{findFirst:async()=>null},vehicleReceiptEvent:{findFirst:async()=>null},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},handover:{count:async()=>0},
 };
 const service=new BillingService({serial:(fn:any)=>fn(tx)} as any,{} as any,()=>new Date('2026-11-06T12:50:00Z'));
 const event:any={status:'SUCCEEDED',providerRefundId:'synthetic-refund',paymentId:payment.id,amount:refundAmount,totalAmount:payment.amount};
 return{service,event,bill,payment,refund,order,audits,tx,viewBill};
}
test('real payment command collects remaining balance once and old receipt cannot repay a refunded bill',async()=>{
 const f=fixture(100000);await f.service.settleRefund(f.refund.id,f.event);
 const receipts:any[]=[{...f.payment,refunds:[{...f.refund}]}],created:any[]=[];
 const full=()=>({...f.bill,order:f.order,payments:structuredClone(receipts)});
 const pview=(p:any)=>p?({...p,bill:{...f.bill,order:f.order}}):null;
 const update=({where,data}:any)=>{const p=receipts.find(p=>p.id===where.id);if(!p||where.status&&where.status!==p.status)return null;const {revision,...rest}=data;Object.assign(p,rest);if(revision?.increment)p.revision+=revision.increment;return p;};
 f.tx.bill.findFirst=async()=>full();f.tx.bill.findUniqueOrThrow=async()=>full();f.tx.bill.findMany=async()=>[full()];
 f.tx.payment={findUnique:async({where}:any)=>pview(where.id?receipts.find(p=>p.id===where.id):receipts.find(p=>p.idempotencyKey===where.customerId_idempotencyKey.idempotencyKey)),findUniqueOrThrow:async({where}:any)=>pview(receipts.find(p=>p.id===where.id)),findFirst:async()=>pview(receipts.find(p=>['CREATING','PENDING'].includes(p.status))),create:async({data}:any)=>{const p={...data,id:'pay-replacement',status:'CREATING',revision:0,reconciliationRequired:false,updatedAt:new Date(),refunds:[]};receipts.push(p);return pview(p);},update:async(args:any)=>pview(update(args)),updateMany:async(args:any)=>({count:update(args)?1:0})};
 f.tx.order.update=async({data}:any)=>{if(data.revision?.increment)f.order.revision+=data.revision.increment;return f.order;};
 f.tx.notification={create:async()=>({})};f.tx.contract={count:async()=>1};f.tx.partnerRevenueEvent={findUnique:async()=>null};
 const service=new BillingService({...f.tx,serial:(fn:any)=>fn(f.tx)} as any,{create:async(v:any)=>{created.push(v);return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic'};}} as any);
 const customer={id:f.order.customerId,openId:'synthetic-open-id'};
 await service.pay(customer,f.bill.id,'replacement-1');await service.pay(customer,f.bill.id,'replacement-1');
 assert.equal(created.length,1);assert.equal(created[0].amount,100000);
 await service.settle(f.payment.id,{status:'SUCCEEDED',amount:369900,transactionId:f.payment.providerTransactionId});assert.equal(f.bill.status,'PENDING');assert.equal(f.bill.paidAmount,269900);
 await service.settle('pay-replacement',{status:'SUCCEEDED',amount:100000,transactionId:'synthetic-new-receipt'});
 assert.equal(f.bill.status,'PAID');assert.equal(f.bill.paidAmount,369900);assert.equal(f.order.status,'AWAITING_HANDOVER');assert.equal(billFundsReady(full()),true);
 await service.settle('pay-replacement',{status:'SUCCEEDED',amount:100000,transactionId:'synthetic-new-receipt'});assert.equal(f.bill.paidAmount,369900);
});
test('verified full refund reopens original unpaid debt and overdue fact',async()=>{
 const f=fixture();await f.service.settleRefund(f.refund.id,f.event);
 assert.equal(f.bill.status,'PENDING');assert.equal(f.bill.paidAmount,0);
 const fact=collectionBillFact(f.viewBill(),f.order,'2026-11-06');assert.equal(fact.confirmedOverdueAmount,369900);assert.equal(fact.overdueDays,1);
 assert.equal(f.payment.status,'SUCCEEDED');assert.equal(f.refund.status,'SUCCEEDED');
});
test('partial refund leaves only retained cash allocated; duplicate callback is idempotent',async()=>{
 const f=fixture(100000);await f.service.settleRefund(f.refund.id,f.event);await f.service.settleRefund(f.refund.id,f.event);
 assert.equal(f.bill.status,'PENDING');assert.equal(f.bill.paidAmount,269900);
 assert.equal(collectionBillFact(f.viewBill(),f.order,'2026-11-06').confirmedOverdueAmount,100000);
});
test('in-flight or failed refund does not reopen or reduce the bill',async()=>{
 for(const status of ['PROCESSING','FAILED']){const f=fixture();await f.service.settleRefund(f.refund.id,{...f.event,status} as any);assert.equal(f.bill.status,'PAID');assert.equal(f.bill.paidAmount,369900);}
});
test('refunded first payment invalidates awaiting handover, not active service',async()=>{
 const f=fixture(369900,'AWAITING_HANDOVER');await f.service.settleRefund(f.refund.id,f.event);assert.equal(f.order.status,'AWAITING_PAYMENT');
 const active=fixture(369900,'ACTIVE');await active.service.settleRefund(active.refund.id,active.event);assert.equal(active.order.status,'ACTIVE');assert.equal(active.bill.status,'PENDING');
});
test('a partially refunded receipt plus exact replacement can satisfy ordinary bill funding',()=>{
 const f=fixture(100000);f.refund.status='SUCCEEDED';f.refund.providerRefundId='synthetic-refund';const b=f.viewBill();b.payments.push({...f.payment,id:'pay-2',amount:100000,providerTransactionId:'synthetic-replacement',refunds:[]});assert.equal(billFundsReady(b),true);
});
test('payment amount is only the remaining debt and pending refund blocks repayment',async()=>{
 const f=fixture(100000);await f.service.settleRefund(f.refund.id,f.event);
 assert.equal(await remainingBillPayment(f.tx,f.bill,f.order),100000);
 f.refund.status='PROCESSING';await assert.rejects(()=>remainingBillPayment(f.tx,f.bill,f.order));
});
test('closed, void, amended and returned obligations are never recreated by ordinary reconciliation',async()=>{
 for(const status of ['CANCELLED','COMPLETED','SETTLING']){const f=fixture(369900,status);await f.service.settleRefund(f.refund.id,f.event);assert.equal(f.bill.status,'PAID');assert.equal(f.bill.paidAmount,369900);}
 for(const key of ['VOID','stage','terms','obligation','change','return','receipt']){const f=fixture();if(key==='VOID')f.bill.status='VOID';if(key==='stage')f.bill.serviceStageId='stage-1';if(key==='terms')f.order.effectiveTermsVersionId='terms-1';if(key==='obligation')f.tx.serviceObligation.count=async()=>1;if(key==='change')f.tx.orderChange.count=async()=>1;if(key==='return')f.tx.returnSettlement.findFirst=async()=>({id:'return-1'});if(key==='receipt')f.tx.vehicleReceiptEvent.findFirst=async()=>({id:'receipt-1'});assert.equal(await ordinaryReceivableScope(f.tx,f.bill,f.order),false);}
});
test('unverified, foreign, duplicate, over-refunded or unresolved money cannot be automatically allocated',()=>{
 for(const mutate of [
  (b:any)=>{b.payments[0].customerId='foreign';},
  (b:any)=>{b.payments[0].providerTransactionId=null;},
  (b:any)=>{b.payments[0].reconciliationRequired=true;},
  (b:any)=>{b.payments.push(b.payments[0]);},
  (b:any)=>{b.payments[0].refunds[0].providerRefundId=null;},
  (b:any)=>{b.payments[0].refunds[0].amount=400000;},
  (b:any)=>{b.payments[0].refunds[0].paymentId='foreign';},
 ]){const f=fixture();f.refund.status='SUCCEEDED';f.refund.providerRefundId='synthetic-refund';const b=f.viewBill();mutate(b);assert.equal(receivableCash(b).valid,false);}
});
test('full and partial refunds each create one allocation audit and repeat success creates none',async()=>{
 const f=fixture(100000);await f.service.settleRefund(f.refund.id,f.event);await f.service.settleRefund(f.refund.id,f.event);
 const changes=f.audits.filter(a=>a.action==='RECALCULATE_BILL_RECEIVABLE');assert.equal(changes.length,1);assert.deepEqual(changes[0].data.after,{status:'PENDING',paidAmount:269900});
});
