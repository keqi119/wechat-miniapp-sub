import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {readCase04,caseView04} from '../orders/cancellation04';
import {historicalCancellation04Source,cancellation04Money} from '../orders/cancellation04-source';
import {readV31CancellationSource,v31RefundSources} from '../order-renewals/cancellation-v31';
import {swapRefundSources} from './swap-refund-sources';
import {terminationSource,terminationCustody} from '../orders/termination-source';
import {readTermination} from '../orders/termination';
import {exitAmountSource} from '../orders/termination-amount-source';
import {exitResponseGroups} from '../orders/exit-amount-responses';
import {exitCashLines} from './refund-exit-cash';
export const json=(v:any)=>JSON.parse(JSON.stringify(v));
export function candidate(order:any,ownerId:string,kind:string,sourceId:string,payment:any,amount:number,factAt:any,confirmation:any,refs:any){
 ensure(Number.isSafeInteger(amount)&&amount>=0&&payment.succeededAt,409,'REFUND_AMOUNT_SOURCE');
 const paymentId=payment.paymentId??payment.id,debtKey=`${kind}:${sourceId}:${paymentId}`,source={version:1,orderId:order.id,customerId:order.customerId,ownerId,paymentId,billId:payment.billId,originalPaymentAmount:payment.amount,receiptAt:payment.succeededAt,sourceKind:kind,sourceId,debtKey,amount,factAt:new Date(factAt).toISOString(),confirmation:confirmation?{id:confirmation.id,confirmedAt:new Date(confirmation.confirmedAt).toISOString(),sourceHash:confirmation.sourceHash}:null,refs};
 return{...json(source),sourceKey:canonicalHash({debtKey,confirmationId:confirmation?.id??null}),workingDays:kind==='SWAP03'||kind==='RETURN'?7:3};
}
async function confirmed(tx:any,c:any){const key=canonicalHash(c),row=await tx.refundAmountConfirmation.findFirst({where:{orderId:c.orderId,sourceKey:key,kind:{in:['CUSTOMER','VERIFIED']}},orderBy:[{recordedAt:'asc'},{id:'asc'}]});if(row)ensure(row.sourceHash===canonicalHash(row.source)&&canonicalHash(row.source)===key,409,'REFUND_CONFIRMATION_SOURCE');return{...c,amountStatementHash:key,...(row?{confirmation:{id:row.id,confirmedAt:row.confirmedAt.toISOString(),sourceHash:row.sourceHash},sourceKey:canonicalHash({debtKey:c.debtKey,confirmationId:row.id})}:{})};}
/** Only genuine reviewed producers. No client amount, owner or payment is accepted here. */
export async function refundSources(tx:any,order:any){
 const candidates:any[]=[],statements:any[]=[],dependencies:any[]=[];const money=await cancellation04Money(tx,order.id);
 const add=async(c:any)=>{if(!c.amount)return;if(c.confirmation){if(!candidates.some(v=>v.sourceKey===c.sourceKey))candidates.push(c);}else{const s=await confirmed(tx,c);if(s.confirmation){if(!candidates.some(v=>v.sourceKey===s.sourceKey))candidates.push(s);}else statements.push(s);}};
 const cancel=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId:order.id},orderBy:{version:'desc'}});
 if(cancel){const s=await readCase04(tx,cancel.id),v=caseView04(s);if(v.effectiveAt&&v.amountConfirmedAt){await historicalCancellation04Source(tx,cancel);for(const p of cancel.proposal.money.payments){const costs=cancel.proposal.costs.filter((r:any)=>r.paymentId===p.paymentId).reduce((n:number,r:any)=>n+r.amount,0);await add(candidate(order,cancel.ownerId,'CANCEL04',cancel.id,p,p.amount-p.refundedAmount-costs,v.effectiveAt,{id:v.amountConfirmationFactId,confirmedAt:v.amountConfirmedAt,sourceHash:v.amountConfirmationFactHash},{proposalHash:cancel.proposalHash,effectiveFactId:v.effectiveFactId,costAmount:costs,baselineRefundIds:p.refunds.filter((r:any)=>r.status==='SUCCEEDED').map((r:any)=>r.id)}));}
 for(const p of money.payments.filter((p:any)=>!cancel.proposal.money.payments.some((a:any)=>a.paymentId===p.paymentId))){dependencies.push({code:'ADDITIONAL_AMOUNT_CONFIRMATION_REQUIRED',paymentId:p.paymentId,amount:p.amount,route:`/customer/orders/${order.id}/refund-obligations`});await add(candidate(order,cancel.ownerId,'CANCEL04',cancel.id,p,p.amount,v.effectiveAt,null,{proposalHash:cancel.proposalHash,effectiveFactId:v.effectiveFactId,additionalReceipt:true,baselineRefundIds:[]}));}}
 else dependencies.push({code:'CANCELLATION_EFFECT_OR_AMOUNT_REQUIRED',sourceId:cancel.id,route:`/admin/orders/${order.id}/cancellation04`});}
 const renewals=await tx.orderRenewalCancellation.findMany({where:{orderId:order.id}});
 for(const r of renewals){if(r.sourceSnapshot?.version!==31)continue;const s=await readV31CancellationSource(tx,r.changeId),v=s.history.find((f:any)=>f.kind==='VERIFIED');if(!v){dependencies.push({code:'RENEWAL_CANCELLATION_VERIFICATION_REQUIRED',sourceId:r.id,route:`/admin/order-renewals/${r.changeId}/cancellation-v31`});continue;}
 for(const p of await v31RefundSources(tx,s))await add(candidate(order,r.ownerId,'CANCEL05',r.id,p,p.amount,v.occurredAt,null,{changeId:r.changeId,stageId:s.stage.id,quoteId:s.quote.id,verifiedFactId:v.id,verifiedFactHash:v.factHash,oldDebtOffsetAmount:0,baselineRefundIds:[]}));}
 // Exact independent cash consents remain usable before materialization even
 // when later receipts or an economic response change the current statement.
 const cashConfirmations=await tx.refundAmountConfirmation.findMany({where:{orderId:order.id,kind:{in:['CUSTOMER','VERIFIED']}},orderBy:[{confirmedAt:'asc'},{recordedAt:'asc'},{id:'asc'}]});
 for(const confirmation of cashConfirmations){const c=confirmation.source;if(!['SWAP03','RETURN'].includes(c.sourceKind))continue;
  const p=money.payments.find((p:any)=>p.paymentId===c.paymentId);
  ensure(confirmation.customerId===order.customerId&&c.orderId===order.id&&c.customerId===order.customerId&&canonicalHash(c)===confirmation.sourceHash&&confirmation.sourceKey===confirmation.sourceHash&&p&&p.billId===c.billId&&p.amount===c.originalPaymentAmount,409,'REFUND_CONFIRMATION_SOURCE');
  await add({...c,confirmation:{id:confirmation.id,confirmedAt:confirmation.confirmedAt.toISOString(),sourceHash:confirmation.sourceHash},sourceKey:canonicalHash({debtKey:c.debtKey,confirmationId:confirmation.id})});
 }
 await swapRefundSources(tx,order,money,add,dependencies,candidate);
 // An effective unilateral cancellation does not require a numbered04/06 or invented receipt.
 const termination=await tx.orderTermination.findFirst({where:{orderId:order.id},orderBy:{version:'desc'}});
 if(!cancel&&(termination||order.serviceAnchor)){const source=await terminationSource(tx,order.id),s=termination?await readTermination(tx,termination.id):null,custody=source.pin.scope==='ACTUAL_SERVICE'?await terminationCustody(tx,order):null,view=await exitAmountSource(tx,source,s,custody,money);
 if(view){
  const groups=await exitResponseGroups(tx,order.id);
  const sources=groups.filter(g=>g.first).map(g=>({statement:g.first.source,confirmation:g.first,bindingHash:g.bindingHash}));
  if(!view.confirmation&&view.scenario==='ACTUAL_RETURN')sources.push({statement:view,confirmation:null,bindingHash:view.bindingHash});
  for(const entry of sources){
   const {statement,confirmation,bindingHash}=entry,lines=await exitCashLines(tx,order,statement,money);
   for(const line of lines){
    const kind=statement.scenario==='ORIGINAL_CANCELLATION'?'UNILATERAL':'RETURN',factAt=statement.scenario==='ORIGINAL_CANCELLATION'?statement.effectiveAt:statement.actualReceiptAt;
    await add(candidate(order,source.pin.ownerId,kind,statement.terminationId??statement.binding.receipt.id,line.payment,line.amount,factAt,line.confirmed&&confirmation?{id:confirmation.id,confirmedAt:confirmation.confirmedAt,sourceHash:confirmation.sourceHash}:null,{...line.refs,exitResponseId:confirmation?.id??null,exitSourceHash:confirmation?.sourceHash??view.hash,bindingHash,exitBinding:statement.binding,baselineRefundIds:statement.financialObservation.payments.find((p:any)=>p.paymentId===line.payment.paymentId)?.refunds.filter((r:any)=>r.status==='SUCCEEDED').map((r:any)=>r.id)??[]}));
   }
  }
  for(const g of groups)if(g.view.openObjection)dependencies.push({code:'EXIT_OBJECTION_SCOPE_REVIEW_REQUIRED',responseId:g.view.openObjection.id,undisputedAmount:null,responsibleRole:'FINANCE',route:`/admin/orders/${order.id}/termination`});
  if(!view.confirmation)dependencies.push({code:'EXIT_AMOUNT_CONFIRMATION_REQUIRED',sourceHash:view.hash,doesNotBlockIndependentCashConfirmation:true,route:`/customer/orders/${order.id}/exit-amounts/respond`});
 }else dependencies.push({code:source.pin.scope==='ACTUAL_SERVICE'?'ACTUAL_RETURN_AND_AMOUNT_REQUIRED':'TERMINATION_EFFECT_REQUIRED',route:`/admin/orders/${order.id}/termination`});}
 return{candidates,statements,dependencies,money};
}
