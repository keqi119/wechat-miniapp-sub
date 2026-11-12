import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {stageDay} from '../order-service-stages/source';
import {readPreparedRenewalSource} from './source';
import {assertRenewalNotCancelling} from './cancellation-state';

function sourceFact(value:unknown):asserts value{ensure(value,409,'RENEWAL_PAYMENT_SOURCE','续期账单、服务期或已确认资金来源不一致');}

/** Frozen bill authority, including original obligations retained after a later swap. */
export async function readRenewalBillSource(tx:any,bill:any){
 if(bill.serviceStageId==null||bill.type!=='SUBSCRIPTION')return null;
 sourceFact(typeof bill.serviceStageId==='string'&&bill.serviceStageId.length>0);
 const source=await readPreparedRenewalSource(tx,bill.serviceStageId),{order,stage,snapshot,change,quote}=source;
 ensure(['PREPARED','SCHEDULED','ACTIVE','ENDED','VOIDED'].includes(stage.status),409,'RENEWAL_STAGE_STATE','续期已撤销或不能收款');
 const row=snapshot.billingSchedule.find(r=>r.sequence===bill.sequence);
 sourceFact(row&&bill.orderId===order.id&&bill.customerId===order.customerId&&bill.amount===row.amount&&stageDay(bill.dueDate)===row.dueDate&&bill.idempotencyKey===`renewal:${quote.id}:${row.sequence}`);
 const obligations=await tx.serviceObligation.findMany({where:{chargeBillId:bill.id}}),obligation=obligations[0];
 sourceFact(obligations.length===1&&obligation.orderId===order.id&&obligation.quoteId===quote.id&&obligation.serviceStageId===stage.id&&obligation.sequence===row.sequence&&obligation.stageSequence===row.stageSequence&&obligation.amount===row.amount&&obligation.chargeAmount===row.amount&&Array.isArray(obligation.sourceBillIds)&&obligation.sourceBillIds.length===0&&stageDay(obligation.startDate)===row.startDate&&stageDay(obligation.endDate)===row.endDate&&stageDay(obligation.dueDate)===row.dueDate);
 if(['PREPARED','SCHEDULED'].includes(stage.status)){
  sourceFact(change.activeQuoteId===quote.id&&change.status===(stage.status==='SCHEDULED'?'SCHEDULED':'AWAITING_FINANCE')&&obligation.active===false);
  ensure(row.stageSequence===1,409,'RENEWAL_FUTURE_BILL','续期生效前仅可支付新租期首期账单');
 }else if(stage.status==='VOIDED')sourceFact(change.status==='CANCELLED'&&obligation.active===false);
 else sourceFact(change.status==='APPLIED'&&!!stage.termsVersionId);
 return{source,obligation};
}

/** Current money eligibility is separate from immutable historical bill authority. */
export async function readRenewalPaymentGuard(tx:any,bill:any){
 const result=await readRenewalBillSource(tx,bill);
 if(result)ensure(result.source.stage.status!=='VOIDED',409,'RENEWAL_STAGE_STATE','续期已取消，不得重新收款或分配，仅可核对历史实收');
 if(result)await assertRenewalNotCancelling(tx,result.source.change.id);
 if(result&&['ACTIVE','ENDED'].includes(result.source.stage.status))ensure(result.obligation.active===true,409,'RENEWAL_OBLIGATION_REPLACED','此期原续期义务已由后续协议替代，请按当前资金安排核对');
 return result;
}

async function allocationSource(tx:any,payment:any){
 const bill=payment.bill??await tx.bill.findUniqueOrThrow({where:{id:payment.billId}}),result=await readRenewalPaymentGuard(tx,bill);
 if(!result)return null;
 sourceFact(payment.billId===bill.id&&payment.customerId===result.source.order.customerId&&payment.amount===result.obligation.chargeAmount&&!payment.reconciliationRequired);
 const old=await tx.paymentAllocation.findUnique({where:{paymentId_obligationId:{paymentId:payment.id,obligationId:result.obligation.id}}});
 sourceFact(!old||old.paymentId===payment.id&&old.obligationId===result.obligation.id&&old.amount===payment.amount&&!old.releasedAt);
 const allocations=await tx.paymentAllocation.findMany({where:{obligationId:result.obligation.id,releasedAt:null}});
 sourceFact(allocations.every((a:any)=>a.paymentId===payment.id&&a.amount===payment.amount));
 return result;
}

/** Expected business failures become reconciliation reasons; programming/database errors still propagate. */
export async function renewalPaymentBlocker(tx:any,bill:any,payment?:any):Promise<string|null>{
 try{if(payment)await allocationSource(tx,payment);else await readRenewalPaymentGuard(tx,bill);return null;}
 catch(error){if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return (error.getResponse() as any)?.error?.code||'RENEWAL_PAYMENT_SOURCE';throw error;}
}

/** Called only by Billing's verified receipt transaction after the same source was checked before money writes. */
export async function allocateRenewalPayment(tx:any,payment:any){
 const result=await allocationSource(tx,payment);if(!result)return false;
 await tx.order.update({where:{id:result.source.order.id},data:{revision:{increment:1}}});
 await tx.paymentAllocation.upsert({where:{paymentId_obligationId:{paymentId:payment.id,obligationId:result.obligation.id}},create:{paymentId:payment.id,obligationId:result.obligation.id,amount:payment.amount},update:{}});
 return true;
}
