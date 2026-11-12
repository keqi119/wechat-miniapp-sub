import {ensure} from '../common/errors';
import {serviceBillSequences} from '../order-changes/obligations';
import {remainingRentCents} from '../service-calendar/rules';
/** Economic relief is never cash: map only exact successful original receipts and
 * carried allocations. Previously released03 excess remains its own debt. */
export async function exitCashLines(tx:any,order:any,statement:any,money:any){
 const lines:any[]=[],observed=statement.financialObservation.payments;
 const payments=statement.paymentReferences.map((p:any)=>{const current=money.payments.find((m:any)=>m.paymentId===p.paymentId);ensure(current&&current.billId===p.billId&&current.amount===p.amount&&current.transactionId===p.transactionId,409,'REFUND_EXIT_PAYMENT_SOURCE');const old=observed.find((m:any)=>m.paymentId===p.paymentId);ensure(old,409,'REFUND_EXIT_PAYMENT_SOURCE');return{...p,net:p.amount-old.refundedAmount};});
 if(statement.scenario==='ORIGINAL_CANCELLATION')return payments.map((p:any)=>({payment:p,amount:p.net,confirmed:true,refs:{legalBasis:statement.legalBasis}}));
 for(const p of payments.filter((p:any)=>['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(p.billType)))lines.push({payment:p,amount:p.net,confirmed:false,refs:{kind:'DEPOSIT',separateClaims:true}});
 const seq=await serviceBillSequences(tx,order.id),obligations=await tx.serviceObligation.findMany({where:{orderId:order.id,active:true},include:{allocations:{where:{releasedAt:null}}}});
 for(const period of statement.periods){const o=obligations.find((o:any)=>o.sequence===period.sequence),relief=remainingRentCents([{index:period.sequence,startDay:period.startDate,endDayExclusive:period.endDate}],[period.amount],new Date(statement.amounts.stopAt));
 let earned=Math.max(0,(o?.amount??period.amount)-relief);
 const refs={periodSequence:period.sequence,serviceStageId:period.stageId,serviceObligationId:o?.id??null,obligationAmount:o?.amount??period.amount,unusedRentAmount:relief,earnedAmount:earned,allocationIds:o?.allocations.map((a:any)=>a.id)??[],separateCompensationAmount:statement.amounts.compensationAmount,occupancyClaimId:statement.occupancyClaim?.id??null};
 for(const p of payments.filter((p:any)=>seq.get(p.billId)===period.sequence).sort((a:any,b:any)=>a.paymentId.localeCompare(b.paymentId))){
 let capacity=p.net;
 if(o?.swapSettlementId){const allocations=o.allocations.filter((a:any)=>a.paymentId===p.paymentId);capacity=Math.min(capacity,allocations.reduce((n:number,a:any)=>n+a.amount,0));}
 const used=Math.min(earned,capacity);earned-=used;const amount=capacity-used;
 if(amount)lines.push({payment:p,amount,confirmed:false,refs});
 }
 }
 return lines;
}
