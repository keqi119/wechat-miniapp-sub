import {hasRefundReceipt,refundReceiptIdentity,refundCashState} from './refund-proof';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {lockOrder} from '../offline-documents/readiness';
import {readDeliveryFunding} from '../orders/readiness';

const cents=(n:any)=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647;
/** Trusted money is immutable. paidAmount is the current allocation, not lifetime gross receipts. */
export function receivableCash(bill:any){
 let valid=cents(bill.amount)&&cents(bill.paidAmount)&&bill.paidAmount<=bill.amount,received=0,returned=0,refundPending=false;
 const ids=new Set<string>(),channels=new Set<string>();
 const unique=(kind:string,id:any)=>{if(typeof id!=='string'||!id||ids.has(kind+id)){valid=false;return;}ids.add(kind+id);};
 if(!Array.isArray(bill.payments))valid=false;
 for(const p of bill.payments??[]){
  unique('payment:',p.id);if(p.billId!==bill.id||p.customerId!==bill.customerId||!cents(p.amount)||p.amount<=0||!Array.isArray(p.refunds)||p.reconciliationRequired||!['CREATING','PENDING','SUCCEEDED','FAILED','CLOSED'].includes(p.status))valid=false;
  let refunded=0,reserved=0;
  if(p.status==='SUCCEEDED'){if(!p.providerTransactionId||channels.has('p:'+p.providerTransactionId))valid=false;channels.add('p:'+p.providerTransactionId);received+=p.amount;}
  for(const r of p.refunds??[]){
   unique('refund:',r.id);if(r.paymentId!==p.id||r.customerId!==bill.customerId||!cents(r.amount)||r.amount<=0||p.status!=='SUCCEEDED'||!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(r.status))valid=false;
   if(['PENDING_APPROVAL','PROCESSING'].includes(r.status)){refundPending=true;reserved+=r.amount;}
   if(r.status==='SUCCEEDED'){const receipt=refundReceiptIdentity(r);if(!receipt||channels.has(receipt))valid=false;if(receipt)channels.add(receipt);refunded+=r.amount;reserved+=r.amount;}
  }
  const cash=refundCashState(p.refunds??[]);if(cash.hasConflict)valid=false;refunded=cash.actualRefunded;reserved=cash.reserved;
  if(!cents(refunded)||reserved>p.amount)valid=false;returned+=refunded;
 }
 const net=received-returned;if(!Number.isSafeInteger(received)||!Number.isSafeInteger(returned)||!cents(net)||net>bill.amount)valid=false;
 return{valid,received,returned,net,refundPending,outstanding:valid?bill.amount-net:null};
}

/** Amendments, terminal settlements and purchased rights own separate obligation ledgers. */
export async function ordinaryReceivableScope(tx:any,bill:any,order:any){
 if(!order||order.id!==bill.orderId||order.customerId!==bill.customerId||!['SUBSCRIPTION','DEPOSIT','EXTRA_FEE','RETURN_SETTLEMENT'].includes(bill.type)||!['PENDING','PAID'].includes(bill.status)||bill.serviceStageId||order.effectiveTermsVersionId||['CANCELLED','COMPLETED','SETTLING'].includes(order.status))return false;
 if(await tx.orderChange.count({where:{orderId:order.id,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}}))return false;
 if(await tx.serviceObligation.count({where:{orderId:order.id,OR:[{chargeBillId:bill.id},{sourceBillIds:{has:bill.id}}]}}))return false;
 if(await tx.returnSettlement.findFirst({where:{orderId:order.id},select:{id:true}}))return false;
 if(await tx.vehicleReceiptEvent.findFirst({where:{orderId:order.id,isCurrent:true},select:{id:true}}))return false;
 return true;
}

export async function remainingBillPayment(tx:any,bill:any,order:any){
 if(!await ordinaryReceivableScope(tx,bill,order))return bill.paidAmount===0?bill.amount:0;
 const full=await tx.bill.findUniqueOrThrow({where:{id:bill.id},include:{payments:{include:{refunds:true}}}}),cash=receivableCash(full);
 ensure(cash.valid&&cash.net===bill.paidAmount,409,'BILL_FUNDS_REVIEW','账单收退款需核对后再支付');
 ensure(!cash.refundPending,409,'BILL_REFUND_PENDING','退款处理中，请待结果确认后再支付');
 return cash.outstanding!;
}

/** Must be called in a transaction; order lock serializes callbacks, repayment and repair. */
export async function reconcileOrdinaryReceivable(tx:any,billId:string,actorId='payment-provider',actorType='PROVIDER'){
 const reference=await tx.bill.findUniqueOrThrow({where:{id:billId}});await lockOrder(tx,reference.orderId);
 const bill=await tx.bill.findUniqueOrThrow({where:{id:billId},include:{payments:{include:{refunds:true}}}}),order=await tx.order.findUniqueOrThrow({where:{id:bill.orderId}});
 if(!await ordinaryReceivableScope(tx,bill,order))return{changed:false,reason:'MANAGED_OBLIGATION'};
 const cash=receivableCash(bill);if(!cash.valid)return{changed:false,reason:'MONEY_REVIEW_REQUIRED'};
 const status=cash.net===bill.amount?'PAID':'PENDING',before={status:bill.status,paidAmount:bill.paidAmount},after={status,paidAmount:cash.net};
 let changed=false;
 if(before.status!==after.status||before.paidAmount!==after.paidAmount){
  ensure((await tx.bill.updateMany({where:{id:bill.id,status:bill.status,paidAmount:bill.paidAmount,amount:bill.amount},data:after})).count===1,409,'BILL_CHANGED','账单已变化，请刷新');
  await audit(tx,actorId,'RECALCULATE_BILL_RECEIVABLE','bills',bill.id,{orderId:order.id,before,after,receivedAmount:cash.received,refundedAmount:cash.returned,outstandingAmount:cash.outstanding},actorType);changed=true;
 }
 if(order.status==='AWAITING_HANDOVER'&&(bill.type==='DEPOSIT'||bill.type==='SUBSCRIPTION'&&bill.sequence===1)&&!(await readDeliveryFunding(tx,order)).ready){
  const delivered=await tx.handover.count({where:{orderId:order.id,type:'DELIVERY',status:'COMPLETED'}}),usage=await tx.usageAccount.findUnique({where:{orderId:order.id}});
  if(!delivered&&!usage&&!order.currentAssignmentId){
   ensure((await tx.order.updateMany({where:{id:order.id,status:'AWAITING_HANDOVER',revision:order.revision},data:{status:'AWAITING_PAYMENT',revision:{increment:1}}})).count===1,409,'ORDER_CHANGED','订单已变化，请刷新');
   await audit(tx,actorId,'RETURN_TO_PAYMENT_AFTER_REFUND','orders',order.id,{billId:bill.id,before:'AWAITING_HANDOVER',after:'AWAITING_PAYMENT'},actorType);
  }
 }
 return{changed,before,after,outstandingAmount:cash.outstanding};
}
