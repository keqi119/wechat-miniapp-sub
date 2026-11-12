import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {financialContext} from '../order-changes/context';
import {requireSwapSettlement} from '../vehicle-changes/fact-settlement';

/** Historical consent owns its funds. A later receipt cannot reallocate the
 * service credit already bound to an older payment or replace its first clock. */
export async function swapRefundSources(tx:any,order:any,money:any,add:(c:any)=>Promise<void>,dependencies:any[],candidate:Function){
 const settlements=await tx.swapFactSettlement.findMany({where:{orderId:order.id},orderBy:{createdAt:'asc'}});
 for(const row of settlements){
  const source=await requireSwapSettlement(tx,row.id);
  const posted=await tx.swapFactFinance.findUnique({where:{settlementId:row.id}});
  if(posted)ensure(canonicalHash(posted.plan)===posted.planHash,409,'REFUND_SWAP_SOURCE');
  const responses=await tx.swapFactAmountResponse.findMany({where:{settlementId:row.id,decision:'CONFIRM'},orderBy:{revision:'asc'}});
  if(!responses.length){dependencies.push({code:'SWAP_AMOUNT_CONFIRMATION_REQUIRED',sourceId:row.id,route:`/admin/order-changes/${row.changeId}`});continue;}
  const covered=new Set<string>(),usedByPeriod=new Map<number,number>();
  let originalFunds:any[]|null=null,missingProvenance=false;
  for(const response of responses){
   ensure(response.sourceHash===row.sourceHash&&response.amountHash===canonicalHash({sourceHash:response.sourceHash,fundsHash:response.fundsHash,result:response.amounts}),409,'REFUND_SWAP_SOURCE');
   let snapshot=response.fundsSnapshot;
   if(!snapshot){
    const funds=posted?.plan.fundsHash===response.fundsHash?posted.plan.funds:(await financialContext(tx,order)).rows;
    // Legacy rows may only use a byte-equivalent funds binding, never new money.
    if(canonicalHash(funds)===response.fundsHash){
     const references=funds.flatMap((f:any)=>f.payments.map((p:any)=>{
      const cash=money.payments.find((m:any)=>m.paymentId===p.id);
      const refunds=cash?.refunds.filter((r:any)=>r.status==='SUCCEEDED'&&new Date(r.succeededAt)<=response.createdAt)??[];
      return cash&&cash.amount-refunds.reduce((n:number,r:any)=>n+r.amount,0)===p.net?{...cash,customerId:order.customerId,baselineRefundIds:refunds.map((r:any)=>r.id)}:null;
     }));
     if(references.every(Boolean))snapshot={version:1,funds,paymentReferences:references};
    }
   }
   if(!snapshot){
    dependencies.push({code:'SWAP_CONFIRMED_FUNDS_PROVENANCE_REQUIRED',sourceId:row.id,confirmationId:response.id,confirmedAt:response.createdAt,amountHash:response.amountHash,fundsHash:response.fundsHash,confirmedAmounts:response.amounts,responsibleRole:'FINANCE',route:`/admin/order-changes/${row.changeId}`});
    missingProvenance=true;break;
   }
   ensure(snapshot.version===1&&canonicalHash(snapshot.funds)===response.fundsHash,409,'REFUND_SWAP_SOURCE');
   originalFunds??=snapshot.funds;
   for(const period of response.amounts.periods){
    const fund=snapshot.funds.find((f:any)=>f.sequence===period.sequence);ensure(fund,409,'REFUND_SWAP_SOURCE');
    let carry=Math.max(0,period.amount-(usedByPeriod.get(period.sequence)??0));
    for(const p of fund.payments){
     if(covered.has(p.id))continue;
     const cash=money.payments.find((m:any)=>m.paymentId===p.id),reference=snapshot.paymentReferences.find((m:any)=>m.paymentId===p.id);
     ensure(cash&&reference&&cash.billId===reference.billId&&fund.sourceBillIds.includes(cash.billId)&&cash.amount===p.amount&&cash.amount===reference.amount&&cash.transactionId===reference.transactionId&&order.customerId===reference.customerId&&p.net>=0&&p.net<=cash.amount,409,'REFUND_PAYMENT_SOURCE');
     const used=Math.min(carry,p.net);carry-=used;covered.add(p.id);usedByPeriod.set(period.sequence,(usedByPeriod.get(period.sequence)??0)+used);
     await add(candidate(order,source.q.snapshot.electronicTerms.snapshot.ownerId,'SWAP03',row.id,cash,p.net-used,row.sourceSnapshot.delivery.actualAt,{id:response.id,confirmedAt:response.createdAt,sourceHash:response.amountHash},{changeId:row.changeId,quoteId:row.quoteId,financeId:posted?.id??null,planHash:posted?.planHash??null,confirmationFundsHash:response.fundsHash,settlementHash:row.sourceHash,periodSequence:period.sequence,serviceStageScope:source.serviceStageScope??null,serviceCreditAmount:used,baselineRefundIds:reference.baselineRefundIds}));
    }
   }
  }
  if(missingProvenance||!originalFunds)continue;
  // Only receipts against the exact original period bills can be additional
  // coverage. Reconciliation remains a separate cash-execution responsibility.
  for(const fund of originalFunds){
   const period=responses[0].amounts.periods.find((p:any)=>p.sequence===fund.sequence);
   let carry=Math.max(0,period.amount-(usedByPeriod.get(fund.sequence)??0));
   for(const cash of money.payments.filter((p:any)=>fund.sourceBillIds.includes(p.billId)&&!covered.has(p.paymentId))){
    const net=cash.amount-cash.refundedAmount,used=Math.min(carry,net);carry-=used;
    dependencies.push({code:'SWAP_AMOUNT_CONFIRMATION_REQUIRED',sourceId:row.id,paymentId:cash.paymentId,route:`/customer/orders/${order.id}/refund-obligations`});
    if((await tx.payment.findUniqueOrThrow({where:{id:cash.paymentId}})).reconciliationRequired)dependencies.push({code:'PAYMENT_RECONCILIATION_REQUIRED',paymentId:cash.paymentId,responsibleRole:'FINANCE'});
    await add(candidate(order,source.q.snapshot.electronicTerms.snapshot.ownerId,'SWAP03',row.id,cash,net-used,row.sourceSnapshot.delivery.actualAt,null,{changeId:row.changeId,quoteId:row.quoteId,settlementHash:row.sourceHash,originalConfirmationId:responses[0].id,confirmationFundsHash:responses[0].fundsHash,periodSequence:fund.sequence,serviceStageScope:source.serviceStageScope??null,serviceCreditAmount:used,additionalReceipt:true,baselineRefundIds:cash.refunds.filter((r:any)=>r.status==='SUCCEEDED').map((r:any)=>r.id)}));
   }
  }
 }
}
