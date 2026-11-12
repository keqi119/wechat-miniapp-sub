import {refundCashState} from './refund-proof';
import {ensure} from '../common/errors';
import {requireCancellationRefundStaff} from './renewal-cancellation-refunds';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {canonicalHash} from '../customers/types';
import {lockOrder} from '../offline-documents/readiness';
export async function refundStaff(tx:any,actor:any,otherId?:string|null){
 await requireCancellationRefundStaff(tx,actor);
 const staff=await tx.adminUser.findUniqueOrThrow({where:{id:actor.id}});
 ensure(staff.staffPersonId,409,'STAFF_PERSON_UNVERIFIED','当前账号的实际人员归属尚未核实，请管理员在人员管理中核实并绑定实际人员，然后重新登录再办理退款');
 if(otherId)await assertIndependentStaffReview(tx,actor.id,[otherId],'DUAL_APPROVAL');
 return staff;
}
export async function lockRefund(tx:any,id:string){
 const r=await tx.refund.findUnique({where:{id},include:{payment:{include:{bill:true}}}});ensure(r,404,'NOT_FOUND');
 await lockOrder(tx,r.payment.bill.orderId);await tx.$queryRaw`SELECT id FROM "Refund" WHERE id=${id} FOR UPDATE`;
 return tx.refund.findUniqueOrThrow({where:{id},include:{payment:{include:{bill:true}}}});
}
export async function refundObligationGuard(tx:any,payment:any,amount:number,obligationId?:string,excludeId?:string,execution?:{method:string;accountHash?:string;collectAccountOnly?:boolean}){
 if(!obligationId){ensure(!payment.reconciliationRequired,409,'PAYMENT_RECONCILIATION_REQUIRED');return null;}
 const o=await tx.refundObligation.findUnique({where:{id:obligationId}}),bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});
 ensure(o&&o.paymentId===payment.id&&o.customerId===payment.customerId&&o.orderId===bill.orderId&&bill.customerId===o.customerId&&canonicalHash(o.source)===o.sourceHash&&o.source.originalPaymentAmount===payment.amount&&payment.status==='SUCCEEDED'&&payment.providerTransactionId&&payment.succeededAt,409,'REFUND_OBLIGATION_SOURCE');
 const funds=await refundFunding(tx,payment,o,excludeId);
 ensure(amount<=funds.obligationAvailable,409,'REFUND_OBLIGATION_LIMIT');
 ensure(amount<=funds.paymentAvailable,409,'REFUND_LIMIT');
 let reconciliationId:string|undefined;
 if(payment.reconciliationRequired&&!execution?.collectAccountOnly){
  const reviews=await tx.paymentReconciliation.findMany({where:{paymentId:payment.id,resolution:'REFUND_ONLY',status:'APPROVED'}});
  const exact=reviews.find((r:any)=>{
   const a=r.paymentSnapshot?.refundAuthorization;
   return a&&(!r.usedRefundId||r.usedRefundId===excludeId)&&(!a.refundId||a.refundId===excludeId)&&a.obligationId===o.id&&a.sourceHash===o.sourceHash&&a.amount===amount&&a.method===(execution?.method??'WECHAT_ORIGINAL')&&(a.accountHash??null)===(execution?.accountHash??null)&&r.paymentSnapshot.providerTransactionId===payment.providerTransactionId&&r.paymentSnapshot.amount===payment.amount&&a.approvedPaymentRevision===payment.revision&&a.fundsHash===funds.hash;
  });
  ensure(exact,409,'PAYMENT_RECONCILIATION_REQUIRED');reconciliationId=exact.id;
  if(excludeId)await consumeRefundAuthorization(tx,excludeId,exact.id);
 }

 return {...o,reconciliationId};
}

export async function independentRefundSource(tx:any,item:any,actor:any){
 if(!item.obligationId)return;
 const o=await tx.refundObligation.findUniqueOrThrow({where:{id:item.obligationId}});
 if(o.sourceKind==='SWAP03'){
  const settlement=await tx.swapFactSettlement.findUniqueOrThrow({where:{id:o.sourceId}}),quote=await tx.delayQuote.findUniqueOrThrow({where:{id:settlement.quoteId}});
  ensure(settlement.orderId===o.orderId&&settlement.customerId===o.customerId&&canonicalHash(settlement.sourceSnapshot)===settlement.sourceHash,409,'REFUND_OBLIGATION_SOURCE');
  await assertIndependentStaffReview(tx,actor.id,[settlement.createdBy,quote.createdBy],'TWO_PERSON_REQUIRED');
 }
}

/** Only financial facts on this original payment affect the authorization. The pending
 * target itself is excluded so dispatch/query of that same execution stays idempotent. */
export async function refundFunding(tx:any,payment:any,obligation:any,excludeId?:string){
 const all=await tx.refund.findMany({where:{paymentId:payment.id},orderBy:{id:'asc'}});
 const rows=all.filter((r:any)=>r.id!==excludeId||r.duplicateReceipt);
 const reserved=(r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)?r.amount:0;
 // A duplicate contains the already counted normal leg plus ONE additional transfer.
 // An independently unverified bank claim reserves that extra amount until resolved.
 const extra=(r:any)=>r.duplicateReceipt&&!r.duplicateReceipt.additionalRefundId?r.duplicateReceipt.unresolvedExtraAmount:0;
 const facts=rows.filter((r:any)=>reserved(r)||extra(r)).map((r:any)=>({id:r.id,obligationId:r.obligationId,amount:r.amount,status:r.status,method:r.method,providerRefundId:r.providerRefundId,succeededAt:r.succeededAt,bankProof:r.bankExecution??null,duplicate:r.duplicateReceipt??null}));
 const paymentAvailable=payment.amount-refundCashState(rows).reserved;
 const obligationAvailable=obligation.amount-refundCashState(rows.filter((r:any)=>r.obligationId===obligation.id)).reserved;
 return{hash:canonicalHash({paymentId:payment.id,providerTransactionId:payment.providerTransactionId,amount:payment.amount,obligationId:obligation.id,sourceHash:obligation.sourceHash,facts}),facts,paymentAvailable,obligationAvailable};
}
export async function consumeRefundAuthorization(tx:any,refundId:string,reconciliationId?:string){
 if(!reconciliationId)return;
 const a=await tx.paymentReconciliation.findUniqueOrThrow({where:{id:reconciliationId}});
 ensure(a.resolution==='REFUND_ONLY'&&a.status==='APPROVED'&&(!a.usedRefundId||a.usedRefundId===refundId),409,'REFUND_AUTHORIZATION_USED');
 await tx.refund.update({where:{id:refundId},data:{reconciliationId}});
 if(!a.usedRefundId)await tx.paymentReconciliation.update({where:{id:reconciliationId},data:{usedRefundId:refundId}});
}

export async function refundReplacementChain(tx:any,r:any){
 if(!r.obligationId)return[r];
 const rows=await tx.refund.findMany({where:{paymentId:r.paymentId}}),ids=new Set<string>([r.id]);let changed=true;
 while(changed){changed=false;for(const row of rows)if(ids.has(row.id)||row.replacesRefundId&&ids.has(row.replacesRefundId)){if(!ids.has(row.id)){ids.add(row.id);changed=true;}if(row.replacesRefundId&&!ids.has(row.replacesRefundId)){ids.add(row.replacesRefundId);changed=true;}}}
 return rows.filter((row:any)=>ids.has(row.id));
}
export async function assertRefundReplacementOpen(tx:any,r:any){
 if(!r.replacesRefundId)return;
 ensure(!(await refundReplacementChain(tx,r)).some((row:any)=>row.id!==r.id&&row.status==='SUCCEEDED'),409,'REFUND_REISSUE_ALREADY_PAID');
}
