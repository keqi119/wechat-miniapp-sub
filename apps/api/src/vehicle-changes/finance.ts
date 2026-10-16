import {financeQuoteId} from './recovery';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
export async function prepareSwapAdjustments(tx:any,change:any,q:any,actor:any){
 const s=q.snapshot;
 if(!q.financePreparedAt){const now=await tx.payment.findMany({where:{customerId:change.customerId,status:'SUCCEEDED',bill:{orderId:change.orderId,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']}}},include:{refunds:true},orderBy:{id:'asc'}});const current=now.map((p:any)=>({id:p.id,amount:p.amount,net:p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)}));ensure(hash(current)===hash(s.depositFunds),409,'FUNDS_CHANGED','押金实际收退已变化，须核对已签资金方案');
  await tx.bill.updateMany({where:{orderId:change.orderId,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']},status:{in:['DRAFT','REVIEWED','PENDING']},paidAmount:0},data:{status:'VOID'}});
  for(const [type,amount,basis]of [['DEPOSIT_ADJUSTMENT',s.depositChargeAmount,s.depositBasis],['SWAP_HANDOVER_FEE',s.handoverFeeAmount,s.handoverFeeBasis]]){if(!amount)continue;const sequence=((await tx.bill.aggregate({where:{orderId:change.orderId,type},_max:{sequence:true}}))._max.sequence||0)+1;await tx.bill.create({data:{orderId:change.orderId,customerId:change.customerId,type,sequence,amount,dueDate:new Date(s.periods.find((r:any)=>r.sequence===s.affectedSequence).dueDate),description:basis,status:'PENDING',createdBy:q.createdBy,reviewedBy:q.reviewedBy,reviewedAt:new Date(),idempotencyKey:`swap-${q.id}-${type}`}});}
 }
 let remaining=s.depositRefundAmount;for(const p of s.depositFunds){const expected=Math.min(remaining,p.net);remaining-=expected;if(!expected)continue;const key=`delay-${q.id}-deposit-${p.id}`,refunds=await tx.refund.findMany({where:{paymentId:p.id,idempotencyKey:{startsWith:key}}});const paid=refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0);if(paid>=expected||refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))continue;await tx.refund.create({data:{paymentId:p.id,customerId:change.customerId,amount:expected-paid,reason:`换车补充协议 ${q.id} 押金原路退回`,requestedBy:actor.id,idempotencyKey:`${key}-${refunds.length}`}});}
}
export async function swapFinanceView(tx:any,change:any,q:any,bills:any[],obligations:any[],blockers:string[]){
 const s=q.snapshot,adjustments=bills.filter(b=>b.idempotencyKey?.startsWith(`swap-${financeQuoteId(q)}-`));
 if(adjustments.some(b=>b.status!=='PAID'||b.paidAmount!==b.amount||b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)))))blockers.push('本次押金补款或交接费尚未核清');
 const required=obligations.filter((o:any)=>o.sequence<=s.affectedSequence);if(required.some((o:any)=>o.allocatedAmount!==o.amount))blockers.push('交付所在期及之前应收尚未核清');
 const net=bills.filter(b=>['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(b.type)).flatMap(b=>b.payments).filter((p:any)=>p.status==='SUCCEEDED').reduce((n:number,p:any)=>n+p.amount-p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((m:number,r:any)=>m+r.amount,0),0);
 if(net!==s.depositAmount)blockers.push('换车约定押金尚未按真实渠道净额核清');
 return{adjustments:adjustments.map(b=>({id:b.id,type:b.type,amount:b.amount,paidAmount:b.paidAmount,status:b.status,dueDate:b.dueDate.toISOString().slice(0,10)})),depositRefundAmount:s.depositRefundAmount};
}
