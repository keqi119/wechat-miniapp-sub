import {hasRefundReceipt,refundCashState} from '../billing/refund-proof';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {assertIndependentStaffReview} from '../partners/capabilities';

/** Task9 binds an independently reviewed ordinary debt bill to this exact dependency, never to renewal cash. */
export async function readDependencySettlement(tx:any,record:any,dependencyHash:string){
 const key=`v31-renewal-dependency:${record.id}:${dependencyHash}`,rows=await tx.bill.findMany({where:{orderId:record.orderId,idempotencyKey:key},include:{payments:{orderBy:{id:'asc'},include:{refunds:{orderBy:{id:'asc'}}}}}});
 if(!rows.length)return null;ensure(rows.length===1,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');const b=rows[0];
 ensure(b.orderId===record.orderId&&b.customerId===record.customerId&&!b.serviceStageId&&['EXTRA_FEE','RETURN_SETTLEMENT'].includes(b.type)&&b.idempotencyKey===key&&Number.isSafeInteger(b.amount)&&b.amount>0,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');
 let ready=b.status==='PAID'&&!!b.reviewedAt&&!!b.createdBy&&!!b.reviewedBy,net=0;
 if(b.reviewedBy)await assertIndependentStaffReview(tx,b.reviewedBy,[b.createdBy],'DUAL_APPROVAL');
 for(const p of b.payments){ensure(p.billId===b.id&&p.customerId===record.customerId&&Number.isSafeInteger(p.amount)&&p.amount>0,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');if(['CREATING','PENDING'].includes(p.status))ready=false;if(p.status==='SUCCEEDED'){ensure(p.providerTransactionId&&p.succeededAt,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');net+=p.amount;if(p.reconciliationRequired)ready=false;}
  if(refundCashState(p.refunds).hasConflict)ready=false;
  for(const r of p.refunds){if(['PENDING_APPROVAL','PROCESSING'].includes(r.status))ready=false;if(r.status==='SUCCEEDED'){ensure(hasRefundReceipt(r)&&r.succeededAt&&r.paymentId===p.id&&r.customerId===record.customerId&&Number.isSafeInteger(r.amount)&&r.amount>0,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');net-=r.amount;}}
 }
 return{billId:b.id,amount:b.amount,sourceHash:canonicalHash(b),ready:ready&&Number.isSafeInteger(net)&&net===b.amount};
}
