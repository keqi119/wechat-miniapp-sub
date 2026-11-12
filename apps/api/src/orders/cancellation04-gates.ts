import {unsignedCancellationStatus,withdrawUnsignedSubscription} from './unsigned-cancellation';
import {readTermination,terminationCaseView,applyUnilateralCancellation} from './termination';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {caseView04,readCase04,applyCancellation04} from './cancellation04';
import {assertNeverDelivered04,cancellation04Money,lockCancellation04} from './cancellation04-source';

export async function cancellation04Status(tx:any,order:any){
 const unilateral=await tx.orderTermination.findFirst({where:{orderId:order.id,kind:'UNILATERAL'},orderBy:{version:'desc'}});
 if(unilateral&&unilateral.sourceSnapshot.scope==='NEVER_DELIVERED'){const u=await readTermination(tx,unilateral.id);if(u.facts.some((f:any)=>f.kind==='EFFECTIVE'))return{s:null,case:terminationCaseView(u),unilateral:u,blockers:[],unsigned:false};}
 const row=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId:order.id},orderBy:{version:'desc'}}),s=row?await readCase04(tx,row.id):null;
 if(!s){const unsigned=await unsignedCancellationStatus(tx,order);return{s:null,case:null,unsigned:unsigned.eligible,blockers:unsigned.blockers};}
 const blockers:any[]=[];try{await assertNeverDelivered04(tx,order);}catch(e:any){const error=e.getResponse?.().error;if(!error)throw e;blockers.push({code:error.code,message:error.message});}
 if(!s?.facts.some((f:any)=>f.kind==='EFFECTIVE'))blockers.push({code:'CANCELLATION_04_REQUIRED',message:'须核实04真实三方合意或有效签署；依法单方解除另走有权依据及送达核验'});
 return{s,case:s?caseView04(s):null,blockers};
}
export async function completeCancellation04(tx:any,order:any,revision:number|undefined,reason='撤回未成立订阅',actorId='SYSTEM'){
 ensure(order.revision===revision,409,'REVISION_CONFLICT');const status=await cancellation04Status(tx,order),block=status.blockers[0];ensure(!block,409,block?.code??'CANCELLATION_04_REQUIRED',block?.message);
 if('unilateral' in status&&status.unilateral){await applyUnilateralCancellation(tx,status.unilateral);return tx.order.findUniqueOrThrow({where:{id:order.id}});}
 if(!status.s)return withdrawUnsignedSubscription(tx,order,reason,actorId);
 await applyCancellation04(tx,status.s);return tx.order.findUniqueOrThrow({where:{id:order.id}});
}
export async function guardCancellation04Delivery(tx:any,orderId:string){
 const termination=await tx.orderTermination.findFirst({where:{orderId},orderBy:{version:'desc'}});ensure(!termination||termination.state==='REJECTED',409,'TERMINATION_DELIVERY_HOLD','解除事实须先核清，禁止继续首次交付');
 const row=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId},orderBy:{version:'desc'}});
 ensure(!row||row.state==='REJECTED',409,'CANCELLATION04_DELIVERY_HOLD','原订阅取消事实办理中，须核清后再交付');
}
/** Existing Refund is the only ledger. Draft fees never authorize deductions or dispatch. */
export async function lockCancellation04Refund(tx:any,reference:any){
 if(!reference?.preDeliveryCancellationId)return reference;
 const payment=reference.payment??await tx.payment.findUniqueOrThrow({where:{id:reference.paymentId}}),bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});
 await lockCancellation04(tx,bill.orderId);await tx.$queryRaw`SELECT id FROM "Refund" WHERE id=${reference.id} FOR UPDATE`;
 const current=await tx.refund.findUniqueOrThrow({where:{id:reference.id},include:{payment:true}});
 ensure(current.preDeliveryCancellationId===reference.preDeliveryCancellationId&&current.preDeliveryCancellationSourceHash===reference.preDeliveryCancellationSourceHash&&current.paymentId===reference.paymentId&&current.customerId===reference.customerId,409,'CANCELLATION04_REFUND_SOURCE_REQUIRED');return current;
}
async function requireRefundReviewer04(tx:any,refund:any,actor:any){
 ensure(actor?.id&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED');const staff=await requireCurrentStaff(tx,actor,'bills');ensure(['ADMIN','FINANCE'].includes(staff.role),403,'FORBIDDEN');
 await assertIndependentStaffReview(tx,actor.id,[refund.requestedBy],'DUAL_APPROVAL');if(refund.approvedBy&&refund.approvedBy!==actor.id)await assertIndependentStaffReview(tx,refund.approvedBy,[refund.requestedBy],'DUAL_APPROVAL');
}
export async function guardCancellation04Refund(tx:any,payment:any,amount:number,refund?:any,actor?:any){
 const bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});await lockCancellation04(tx,bill.orderId);
 const row=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId:bill.orderId},orderBy:{version:'desc'}}),bound=refund?.preDeliveryCancellationId!=null||refund?.preDeliveryCancellationSourceHash!=null;
 if(!row){ensure(!bound,409,'CANCELLATION04_REFUND_SOURCE_REQUIRED');return;}
 const s=await readCase04(tx,row.id),effective=s.facts.find((f:any)=>f.kind==='EFFECTIVE');
 if(s.record.state==='REJECTED'&&!effective){
  // A terminal rejection preserves the original contract; it creates no04 debt.
  // Bound money cannot shed its source, and ordinary approval/retry still needs real people.
  ensure(!bound,409,'CANCELLATION04_REFUND_SOURCE_REQUIRED');if(refund)await requireRefundReviewer04(tx,refund,actor);return;
 }
 ensure(effective,409,'CANCELLATION04_REFUND_SOURCE_REQUIRED','退款须关联已生效取消与真实确认金额');
 const p=row.proposal.money.payments.find((p:any)=>p.paymentId===payment.id);
 // A late genuine receipt has no confirmed04 amount yet; Task9 must append an exact amount source.
 ensure(p&&p.billId===bill.id&&p.amount===payment.amount&&p.transactionId===payment.providerTransactionId,409,'CANCELLATION04_LATE_PAYMENT_REVIEW','新成功款项须核对真实无争议金额，不能套用旧退款来源');
 const deductions=row.proposal.costs.filter((c:any)=>c.paymentId===payment.id).reduce((n:number,c:any)=>n+c.amount,0);
 const reserved=await tx.refund.aggregate({where:{paymentId:payment.id,status:{in:['PENDING_APPROVAL','PROCESSING','SUCCEEDED']},...(refund?{id:{not:refund.id}}:{})},_sum:{amount:true}});
 ensure((reserved._sum.amount??0)+amount<=payment.amount-deductions,409,'CANCELLATION04_REFUND_LIMIT','原付款退款额度须保留已具体同意抵扣的同一债务');
 if(refund){ensure(refund.preDeliveryCancellationId===row.id&&refund.preDeliveryCancellationSourceHash===row.proposalHash,409,'CANCELLATION04_REFUND_SOURCE_REQUIRED');await requireRefundReviewer04(tx,refund,actor);}
 return{caseId:row.id,proposalHash:row.proposalHash,effectiveFactId:effective.id,paymentId:payment.id};
}
export async function cancellation04Readiness(tx:any,order:any,actor:any){
 const status=await cancellation04Status(tx,order),money=await cancellation04Money(tx,order.id),operator=['ADMIN','OPERATIONS'].includes(actor.role);
 return{version:2,executionMode:'ELECTRONIC',orderId:order.id,orderRevision:order.revision,orderStatus:order.status,mode:order.status==='CANCELLED'?'TERMINAL':status.blockers.some(b=>b.code==='CANCELLATION_ALREADY_DELIVERED')?'POST_DELIVERY_RETURN':'PRE_DELIVERY_CANCEL',cancellationKind:'unilateral' in status&&status.unilateral?'UNILATERAL':status.unsigned?'UNFORMED_WITHDRAWAL':'AGREED04',canCancel:operator&&!status.blockers.length&&order.status!=='CANCELLED',case:status.case,blockers:status.blockers,actions:[{key:status.unsigned?'CANCEL_UNSIGNED':'OPEN_CANCELLATION04',target:{resource:'orders',id:order.id,section:'cancellation04'},expectedRevision:order.revision,enabled:operator}],attention:status.unsigned?[{code:'UNFORMED_SUBSCRIPTION',description:'尚未成立且无未核清外部签署、资金，可撤回业务申请；不记录04解除合意。'}]:[{code:'CANCELLATION04_FACTS_AND_FUNDS_SEPARATE',description:'04办理中暂停初次交付；真实解除与无争议金额确认分别留痕，资金发起、受理和到账独立跟踪。'}],payments:money.payments,financialSourceHash:money.hash,unilateralPath:'VERIFIED_GROUND_AND_NOTICE_TASK8D'};
}
