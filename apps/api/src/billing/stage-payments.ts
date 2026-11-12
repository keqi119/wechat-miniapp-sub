import {hasRefundReceipt,refundCashState} from './refund-proof';
import {HttpException} from '@nestjs/common';
import {readSwapFactBillPaymentGuard} from '../vehicle-changes/fact-settlement';
import {ensure} from '../common/errors';
import {readStageSwapPaymentGuard} from '../vehicle-changes/finance';
import {renewalPaymentBlocker} from '../order-renewals/payment';

const allocationFact=(v:unknown)=>ensure(v,409,'SWAP_STAGE_ALLOCATION_SOURCE','换车补差款与本期义务或原分配不一致，请核对实际收退款');
async function requireCarriedAllocations(tx:any,source:any,ownPaymentId?:string){
 const {obligation,quote,order}=source,row=quote.snapshot.periods.find((p:any)=>p.sequence===obligation.sequence),fund=quote.fundsSnapshot.find((p:any)=>p.sequence===obligation.sequence),expected=new Map<string,number>();
 allocationFact(row&&fund&&Number.isSafeInteger(row.carryAmount)&&row.carryAmount>=0&&row.carryAmount+obligation.chargeAmount===obligation.amount&&Array.isArray(fund.payments));
 let remaining=row.carryAmount;
 for(const frozen of fund.payments){allocationFact(Number.isSafeInteger(frozen.net)&&frozen.net>=0&&typeof frozen.id==='string');const amount=Math.min(remaining,frozen.net);remaining-=amount;if(amount===0)continue;allocationFact(!expected.has(frozen.id)&&frozen.id!==ownPaymentId);expected.set(frozen.id,amount);
  const paid=await tx.payment.findUnique({where:{id:frozen.id},include:{bill:true,refunds:true}});
  allocationFact(paid?.status==='SUCCEEDED'&&paid.customerId===order.customerId&&paid.amount===frozen.amount&&!!paid.providerTransactionId&&!paid.reconciliationRequired&&paid.bill?.orderId===order.id&&paid.bill.customerId===order.customerId&&paid.bill.serviceStageId===obligation.serviceStageId&&obligation.sourceBillIds.includes(paid.billId)&&Array.isArray(paid.refunds));
  allocationFact(!paid.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)));
  let refunded=0n;for(const r of paid.refunds.filter((r:any)=>r.status==='SUCCEEDED')){allocationFact(r.paymentId===paid.id&&r.customerId===order.customerId&&hasRefundReceipt(r)&&Number.isSafeInteger(r.amount)&&r.amount>=0);refunded+=BigInt(r.amount);}
  allocationFact(!refundCashState(paid.refunds).hasConflict);refunded=BigInt(refundCashState(paid.refunds).actualRefunded);
  allocationFact(refunded<=BigInt(paid.amount)&&BigInt(paid.amount)-refunded>=BigInt(amount));
 }
 allocationFact(remaining===0);
 const rows=await tx.paymentAllocation.findMany({where:{obligationId:obligation.id,releasedAt:null}}),carried=rows.filter((a:any)=>a.paymentId!==ownPaymentId);
 allocationFact(carried.length===expected.size&&carried.every((a:any)=>expected.get(a.paymentId)===a.amount)&&new Set(carried.map((a:any)=>a.paymentId)).size===carried.length);
 return rows;
}

/** Includes legitimate frozen carried principal, separately from the new adjustment receipt. */
export async function readStageSwapBillPaymentGuard(tx:any,bill:any){const source=await readStageSwapPaymentGuard(tx,bill);if(source)await requireCarriedAllocations(tx,source);return source;}

async function swapAllocationSource(tx:any,payment:any){
 const bill=payment.bill??await tx.bill.findUniqueOrThrow({where:{id:payment.billId}}),source=await readStageSwapPaymentGuard(tx,bill,'ALLOCATION');if(!source)return null;
 allocationFact(payment.billId===bill.id&&payment.customerId===source.order.customerId&&payment.amount===source.obligation.chargeAmount&&!payment.reconciliationRequired);
 const old=await tx.paymentAllocation.findUnique({where:{paymentId_obligationId:{paymentId:payment.id,obligationId:source.obligation.id}}});
 allocationFact(!old||old.paymentId===payment.id&&old.obligationId===source.obligation.id&&old.amount===payment.amount&&!old.releasedAt);
 const allocations=await requireCarriedAllocations(tx,source,payment.id);
 allocationFact(allocations.filter((a:any)=>a.paymentId===payment.id).every((a:any)=>a.amount===payment.amount));return source;
}

/** Read-only preflight for a trusted receipt, before either bill money or allocations are changed. */
export async function stagePaymentBlocker(tx:any,bill:any,payment?:any):Promise<string|null>{
 const renewal=await renewalPaymentBlocker(tx,bill,payment);if(renewal)return renewal;
 try{if(await readSwapFactBillPaymentGuard(tx,bill,payment))return null;if(payment)await swapAllocationSource(tx,payment);else await readStageSwapBillPaymentGuard(tx,bill);return null;}
 catch(error){if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return (error.getResponse() as any)?.error?.code||'SWAP_STAGE_PAYMENT_SOURCE';throw error;}
}

export async function allocateStageSwapPayment(tx:any,payment:any){
 const bill=payment.bill??await tx.bill.findUniqueOrThrow({where:{id:payment.billId}}),factual=await readSwapFactBillPaymentGuard(tx,bill,payment,'ALLOCATION');
 const source=factual??await swapAllocationSource(tx,payment);if(!source)return false;
 await tx.order.update({where:{id:source.order.id},data:{revision:{increment:1}}});
 await tx.paymentAllocation.upsert({where:{paymentId_obligationId:{paymentId:payment.id,obligationId:source.obligation.id}},create:{paymentId:payment.id,obligationId:source.obligation.id,amount:payment.amount},update:{}});return true;
}
