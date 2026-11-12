import {refundInvestigationActions,readRefundInvestigation,appendRefundInvestigation,reviewRefundInvestigation} from './refund-investigations';
import {refundStaff,refundFunding} from './refund-execution';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {hasRefundReceipt,refundCashState} from './refund-proof';
import {canonicalHash} from '../customers/types';
import {assertNotAssetFiles} from '../files/asset-files';
import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,hash,key,text,fileIds} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {lockOrder,requireContractReady} from '../offline-documents/readiness';
import {guardPhysicalReceiptBill} from '../offline-documents/vehicle-receipt';
import {advanceToHandover} from '../orders/readiness';
import {reconcileOrdinaryReceivable} from './receivable-state';
import {fullyReturnedReceipt} from './receipt-state';
import {recordSimpleRevenuePayment} from '../partners/simple-revenue';

const command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key});
const submitInput=command.extend({resolution:z.enum(['APPLY_TO_BILL','REFUNDED','REFUND_ONLY']),obligationId:z.string().optional(),refundId:z.string().optional(),refundAmount:z.number().int().positive().optional(),refundMethod:z.enum(['WECHAT_ORIGINAL','MANUAL_BANK']).optional(),accountHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),note:text,evidenceFileIds:fileIds.refine(v=>v.length>0,'请上传人工核对依据')}).strict();
const reviewInput=command.extend({decision:z.enum(['APPROVED','REJECTED']),note:text}).strict();
const snapshot=(p:any)=>({paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,status:p.status});
export function allowedReconciliationResolutions(bill:any){return !bill.serviceStageId&&['DEPOSIT','SUBSCRIPTION'].includes(bill.type)?['APPLY_TO_BILL','REFUNDED','REFUND_ONLY']:['REFUNDED','REFUND_ONLY'];}
export function validateReconciliationResolution(payment:any,bill:any,resolution:string){
 ensure(payment.status==='SUCCEEDED'&&payment.providerTransactionId,409,'PAYMENT_NOT_VERIFIED','仅可核对已由渠道验证的真实到账');
 const pending=payment.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)),refunded=refundCashState(payment.refunds).normalRefunded;
 if(resolution==='REFUND_ONLY')return;
 if(resolution==='REFUNDED')ensure(!refundCashState(payment.refunds).hasConflict&&!pending&&refunded===payment.amount&&payment.refunds.filter((r:any)=>r.status==='SUCCEEDED').every(hasRefundReceipt),409,'REFUND_NOT_COMPLETE','须先核实原款已全额实际退回');
 else {
  ensure(allowedReconciliationResolutions(bill).includes('APPLY_TO_BILL'),409,'RECONCILIATION_APPLY_UNSUPPORTED','该类账单涉及权益或补充资金分配，本版须完成原路退款后核对，不支持直接用于履约');
  ensure(!pending&&refunded===0&&bill.status==='PAID'&&bill.amount===payment.amount&&bill.paidAmount===payment.amount,409,'PAYMENT_ALLOCATION_INVALID','只能核对未退款且金额完全匹配的原已付账单；其他情况请退款处理');
 }
}
async function finance(tx:any,actor:any){await refundStaff(tx,actor);await requireCurrentStaff(tx,actor,'payments');ensure(['ADMIN','FINANCE'].includes(actor.role),403,'FORBIDDEN','仅管理员或财务可核对到账');}
async function paymentWithLock(tx:any,id:string){const ref=await tx.payment.findUnique({where:{id},include:{bill:true}});ensure(ref,404,'NOT_FOUND','付款不存在');await lockOrder(tx,ref.bill.orderId);return tx.payment.findUniqueOrThrow({where:{id},include:{bill:true,refunds:true}});}
async function evidence(tx:any,ids:string[]){const files=await tx.storedFile.findMany({where:{id:{in:ids}}});ensure(files.length===new Set(ids).size&&files.every((f:any)=>f.adminId&&!f.customerId&&f.purpose==='evidence'&&['application/pdf','image/jpeg','image/png'].includes(f.mimeType)&&f.size>0&&f.size<=10*1024*1024),403,'FILE_OWNERSHIP','核对依据须为后台上传的财务材料');await assertNotAssetFiles(tx,ids);return files;}
async function authorizeRefund(tx:any,p:any,input:any){
 const o=await tx.refundObligation.findUnique({where:{id:input.obligationId??''}});
 ensure(o&&o.paymentId===p.id&&o.customerId===p.customerId&&o.orderId===p.bill.orderId&&canonicalHash(o.source)===o.sourceHash&&Number.isSafeInteger(input.refundAmount)&&input.refundAmount>0&&input.refundAmount<=o.amount,409,'REFUND_OBLIGATION_SOURCE');
 const method=input.refundMethod??'WECHAT_ORIGINAL';if(method==='MANUAL_BANK')ensure(input.accountHash&&await tx.refund.count({where:{obligationId:o.id,amount:input.refundAmount,method:'MANUAL_BANK',bankAccount:{path:['hash'],equals:input.accountHash}}}),409,'REFUND_ACCOUNT_CHANGED');
 const target=input.refundId?await tx.refund.findUnique({where:{id:input.refundId}}):null;
 if(input.refundId)ensure(target&&target.paymentId===p.id&&target.obligationId===o.id&&target.amount===input.refundAmount&&['PENDING_APPROVAL','PROCESSING','FAILED'].includes(target.status),409,'REFUND_OBLIGATION_SOURCE');
 if(method==='MANUAL_BANK')ensure(target&&target.bankAccount?.hash===input.accountHash,409,'REFUND_ACCOUNT_CHANGED');
 const funds=await refundFunding(tx,p,o,target?.id);
 ensure(input.refundAmount<=funds.paymentAvailable&&input.refundAmount<=funds.obligationAvailable,409,'REFUND_AUTHORIZATION_CAPACITY');
 return{obligationId:o.id,sourceHash:o.sourceHash,amount:input.refundAmount,method,accountHash:input.accountHash??null,refundId:target?.id??null,fundsHash:funds.hash,funds:funds.facts,paymentAvailable:funds.paymentAvailable,obligationAvailable:funds.obligationAvailable,approvedPaymentRevision:p.revision+2};
}
export class PaymentReconciliationService {
 investigation(tx:any,actor:any,id:string,reviewId:string){return readRefundInvestigation(tx,actor,id,reviewId);}
 appendInvestigation(tx:any,actor:any,id:string,reviewId:string,raw:unknown){return appendRefundInvestigation(tx,actor,id,reviewId,raw);}
 reviewInvestigation(tx:any,actor:any,id:string,reviewId:string,raw:unknown){return reviewRefundInvestigation(tx,actor,id,reviewId,raw);}
 async list(tx:any,actor:any,id:string){await finance(tx,actor);const payment=await tx.payment.findUnique({where:{id},include:{bill:true}});ensure(payment,404,'NOT_FOUND','付款不存在');const items=await tx.paymentReconciliation.findMany({where:{paymentId:id},orderBy:{createdAt:'desc'}});await assertNotAssetFiles(tx,items.flatMap((item:any)=>item.evidenceFileIds||[]));return{items:items.map((r:any)=>r.resolution==='DUPLICATE_REFUND_CHANNEL_RECEIPT'?{...r,investigation:{actions:refundInvestigationActions(id,r.id)}}:r),total:items.length,allowedResolutions:allowedReconciliationResolutions(payment.bill)};}
 async submit(tx:any,actor:any,id:string,raw:unknown){const input=submitInput.parse(raw);await finance(tx,actor);const payment=await paymentWithLock(tx,id);const result=await archiveCommand(tx,actor,id,'PAYMENT_RECONCILIATION_SUBMIT',input,async()=>{
  ensure(payment.revision===input.revision,409,'REVISION_CONFLICT','付款记录已变化，请刷新');ensure(payment.reconciliationRequired&&payment.status==='SUCCEEDED',409,'RECONCILIATION_NOT_REQUIRED','当前付款无需异常核对');
  ensure(!await tx.paymentReconciliation.count({where:{paymentId:id,status:'SUBMITTED',resolution:{not:'DUPLICATE_REFUND_CHANNEL_RECEIPT'}}}),409,'RECONCILIATION_PENDING','已有待审核核对记录');await evidence(tx,input.evidenceFileIds);
  if(input.resolution!=='REFUND_ONLY')ensure(!await tx.paymentReconciliation.count({where:{paymentId:id,resolution:'DUPLICATE_REFUND_CHANNEL_RECEIPT',status:'SUBMITTED'}}),409,'REFUND_DUPLICATE_DISPOSITION_REQUIRED');
  validateReconciliationResolution(payment,payment.bill,input.resolution);
  const refundAuthorization=input.resolution==='REFUND_ONLY'?await authorizeRefund(tx,payment,input):undefined;
  const record=await tx.paymentReconciliation.create({data:{paymentId:id,resolution:input.resolution,note:input.note,evidenceFileIds:input.evidenceFileIds,paymentSnapshot:{...snapshot(payment),...(refundAuthorization?{refundAuthorization}:{})},submittedBy:actor.id}});
  const updated=await tx.payment.update({where:{id},data:{revision:{increment:1}}});await audit(tx,actor.id,'PAYMENT_RECONCILIATION_SUBMIT','payments',id,{reviewId:record.id,resolution:input.resolution});return{...record,paymentRevision:updated.revision};
 });await assertNotAssetFiles(tx,result.evidenceFileIds||[]);return result;}
 async review(tx:any,actor:any,id:string,reviewId:string,raw:unknown){const input=reviewInput.parse(raw);await finance(tx,actor);const payment=await paymentWithLock(tx,id);const result=await archiveCommand(tx,actor,id,`PAYMENT_RECONCILIATION_REVIEW:${reviewId}`,input,async()=>{
  ensure(payment.revision===input.revision,409,'REVISION_CONFLICT','付款记录已变化，请刷新');const record=await tx.paymentReconciliation.findUnique({where:{id:reviewId}});ensure(record?.paymentId===id&&record.status==='SUBMITTED',409,'RECONCILIATION_STATE','核对记录不在待审状态');
  ensure(record.resolution!=='DUPLICATE_REFUND_CHANNEL_RECEIPT',409,'REFUND_DUPLICATE_DISPOSITION_REQUIRED');
  if(record.resolution!=='REFUND_ONLY')ensure(!await tx.paymentReconciliation.count({where:{paymentId:id,resolution:'DUPLICATE_REFUND_CHANNEL_RECEIPT',status:'SUBMITTED'}}),409,'REFUND_DUPLICATE_DISPOSITION_REQUIRED');
  const files=await evidence(tx,record.evidenceFileIds);await assertIndependentStaffReview(tx,actor.id,[record.submittedBy,...files.map((f:any)=>f.adminId)],'SELF_REVIEW');
  ensure(payment.reconciliationRequired&&hash(Object.fromEntries(Object.keys(snapshot(payment)).map(k=>[k,record.paymentSnapshot?.[k]])))===hash(snapshot(payment)),409,'PAYMENT_SNAPSHOT_CHANGED','原到账事实已变化，请重新提交核对');
  if(input.decision==='APPROVED'){
   validateReconciliationResolution(payment,payment.bill,record.resolution);
   if(record.resolution==='REFUND_ONLY'){const a=record.paymentSnapshot.refundAuthorization;ensure(a&&canonicalHash(await authorizeRefund(tx,{...payment,revision:payment.revision-1},{obligationId:a.obligationId,refundId:a.refundId,refundAmount:a.amount,refundMethod:a.method,accountHash:a.accountHash}))===canonicalHash(a),409,'REFUND_AUTHORIZATION_CHANGED');}
   if(record.resolution==='APPLY_TO_BILL'){
    const order=await tx.order.findUniqueOrThrow({where:{id:payment.bill.orderId}});ensure(['AWAITING_PAYMENT','AWAITING_HANDOVER','ACTIVE'].includes(order.status),409,'ORDER_STATE','订单状态不允许将异常款用于履约');
    const otherReceipts=await tx.payment.findMany({where:{billId:payment.billId,status:'SUCCEEDED',id:{not:id}},include:{refunds:true}});
    ensure(otherReceipts.every(fullyReturnedReceipt),409,'DUPLICATE_RECEIPT','原账单存在未退回或未核对的其他到账，须先核对退款');
    if(order.contractMode==='OFFLINE')await requireContractReady(tx,order.id,'PAYMENT');await guardPhysicalReceiptBill(tx,payment.bill);
   }
  }
  const updated=await tx.paymentReconciliation.update({where:{id:reviewId},data:{status:input.decision,reviewedBy:actor.id,reviewedAt:new Date(),reviewNote:input.note}});
  const result=await tx.payment.update({where:{id},data:{revision:{increment:1},...(input.decision==='APPROVED'&&record.resolution!=='REFUND_ONLY'?{reconciliationRequired:false}:{})}});
  if(input.decision==='APPROVED'&&record.resolution!=='REFUND_ONLY')await recordSimpleRevenuePayment(tx,id);
  if(input.decision==='APPROVED'&&record.resolution!=='REFUND_ONLY')await reconcileOrdinaryReceivable(tx,payment.billId,actor.id,'ADMIN');
  if(input.decision==='APPROVED'&&record.resolution!=='REFUND_ONLY')await advanceToHandover(tx,payment.bill.orderId);
  await audit(tx,actor.id,'PAYMENT_RECONCILIATION_REVIEW','payments',id,{reviewId,decision:input.decision,resolution:record.resolution});return{...updated,paymentRevision:result.revision};
 });await assertNotAssetFiles(tx,result.evidenceFileIds||[]);return result;}
}
@Controller('admin/payments/:id/reconciliations')
export class PaymentReconciliationController {
 private service=new PaymentReconciliationService();
 constructor(@Inject(Db)private db:Db){}
 @Get()list(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.service.list(tx,r.admin,id));}
 @Post()submit(@Param('id')id:string,@Body()body:unknown,@Req()r:any){return this.db.serial(tx=>this.service.submit(tx,r.admin,id,body));}
 @Get(':reviewId/investigation')investigation(@Param('id')id:string,@Param('reviewId')reviewId:string,@Req()r:any){return this.db.serial(tx=>this.service.investigation(tx,r.admin,id,reviewId));}
 @Post(':reviewId/investigation/evidence')appendInvestigation(@Param('id')id:string,@Param('reviewId')reviewId:string,@Body()body:unknown,@Req()r:any){return this.db.serial(tx=>this.service.appendInvestigation(tx,r.admin,id,reviewId,body));}
 @Post(':reviewId/investigation/review')reviewInvestigation(@Param('id')id:string,@Param('reviewId')reviewId:string,@Body()body:unknown,@Req()r:any){return this.db.serial(tx=>this.service.reviewInvestigation(tx,r.admin,id,reviewId,body));}
 @Post(':reviewId/review')review(@Param('id')id:string,@Param('reviewId')reviewId:string,@Body()body:unknown,@Req()r:any){return this.db.serial(tx=>this.service.review(tx,r.admin,id,reviewId,body));}
}
