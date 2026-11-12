import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {encryptIdentity,decryptIdentity} from '../esign/fadada/fadada-safety';
import {assertNotAssetFiles} from '../files/asset-files';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {refundStaff,lockRefund,refundObligationGuard,independentRefundSource,assertRefundReplacementOpen} from './refund-execution';
import {guardRenewalCancellationRefund} from './renewal-cancellation-refunds';
import {guardCancellation04Refund} from '../orders/cancellation04-gates';
import {safeRefund} from './refund-proof';
const key=z.string().min(8).max(128),note=z.string().trim().min(1).max(2000),digest=z.string().regex(/^[a-f0-9]{64}$/);
const command={revision:z.number().int().nonnegative(),idempotencyKey:key};
const ids=z.array(z.string()).min(1).max(20);
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
function revision(r:any,n:number){ensure(r.revision===n,409,'REVISION_CONFLICT');}
export function terminalOriginal(r:any){
 const e=r.channelEvidence;if(!e||e.paymentId!==r.paymentId||e.amount!==r.amount)return false;
 if(e.code==='USER_ACCOUNT_ABNORMAL'&&e.evidenceSource==='SIGNED_REQUEST_REJECTION'&&e.refundId===r.id&&e.queryEvidence?.source==='SIGNED_QUERY_NOT_FOUND'&&e.queryEvidence.refundId===r.id&&!r.acceptedAt&&!r.providerRefundId)return true;
 return !!e.providerRefundId&&(e.evidenceSource==='QUERY'||e.evidenceSource==='CALLBACK')&&(e.nativeStatus==='CLOSED'||e.nativeStatus==='SUCCESS'&&e.receiptDestination==='MERCHANT');
}

async function evidence(tx:any,fileIds:string[],customerId:string,staffId?:string){
 await assertNotAssetFiles(tx,fileIds);const rows=await tx.storedFile.findMany({where:{id:{in:fileIds}},orderBy:{id:'asc'}});
 ensure(rows.length===new Set(fileIds).size&&rows.every((f:any)=>f.purpose==='refund-bank'&&!f.fieldTaskId&&['application/pdf','image/png','image/jpeg'].includes(f.mimeType)&&f.size>0&&f.size<=10485760&&/^[a-f0-9]{64}$/.test(f.sha256)&&(staffId?f.adminId===staffId&&!f.customerId:f.customerId===customerId&&!f.adminId)),403,'FILE_OWNERSHIP');
 return rows.map((f:any)=>({id:f.id,sha256:f.sha256,adminId:f.adminId,customerId:f.customerId}));
}
async function unchangedFiles(tx:any,files:any[]){for(const f of files){const current=await tx.storedFile.findUnique({where:{id:f.id}});ensure(current&&current.sha256===f.sha256&&current.adminId===f.adminId&&current.customerId===f.customerId&&current.purpose==='refund-bank',409,'REFUND_EVIDENCE_CHANGED');}}
export async function refundNotice(tx:any,r:any,state:string){
 const eventKey=canonicalHash({refundId:r.id,state,bankProof:r.bankExecution?.sourceHash??null,duplicate:r.duplicateReceipt??null});
 if(await tx.auditLog.findFirst({where:{resourceType:'refunds',resourceId:r.id,action:'REFUND_NOTICE_V1',data:{path:['eventKey'],equals:eventKey}}}))return;
 await audit(tx,'ninda','REFUND_NOTICE_V1','refunds',r.id,{version:1,eventKey,sender:'NINDA',recipientCustomerId:r.customerId,refundId:r.id,obligationId:r.obligationId,amount:r.amount,state,contentVersion:'NINDA_REFUND_V1',deliveryStatus:'NOT_SENT',deliveredAt:null},'SYSTEM');
}
export async function refundConflict(tx:any,r:any,original:any,bank:any){
 const conflict={version:1,original,bank,unresolvedExtraAmount:r.amount,verifiedExtraAmount:bank.status==='VERIFIED'?r.amount:0,claimedExtraAmount:r.amount};
 if(r.duplicateReceipt){
  const old=r.duplicateReceipt;ensure(canonicalHash(old.original)===canonicalHash(original)&&old.bank.sourceHash===bank.sourceHash&&canonicalHash(old.bank.source)===canonicalHash(bank.source),409,'REFUND_DUPLICATE_EVIDENCE_CHANGED');
  if(bank.status==='VERIFIED'&&old.bank.status!=='VERIFIED'&&!old.bankVerification){
   const next={...old,verifiedExtraAmount:r.amount,bankVerification:{sourceHash:bank.sourceHash,status:bank.status,reviewedBy:bank.reviewedBy,reviewedPersonId:bank.reviewedPersonId,reviewedAt:bank.reviewedAt,reviewReason:bank.reviewReason}};
   await tx.refund.update({where:{id:r.id},data:{duplicateReceipt:next}});await tx.payment.update({where:{id:r.paymentId},data:{revision:{increment:1}}});
   await audit(tx,bank.reviewedBy,'REFUND_DUPLICATE_BANK_VERIFIED','refunds',r.id,{conflictHash:canonicalHash(old),bankVerification:next.bankVerification});
  }
  return;
 }
 await tx.refund.update({where:{id:r.id},data:{duplicateReceipt:conflict}});
 await tx.payment.update({where:{id:r.paymentId},data:{reconciliationRequired:true,reconciliationReason:'DUPLICATE_REFUND_CHANNEL_RECEIPT',revision:{increment:1}}});
 await tx.paymentReconciliation.create({data:{paymentId:r.paymentId,resolution:'DUPLICATE_REFUND_CHANNEL_RECEIPT',note:'原路与银行实汇冲突，须独立财务处理',evidenceFileIds:bank.source.files.map((f:any)=>f.id),paymentSnapshot:{paymentId:r.paymentId,refundId:r.id,conflict},submittedBy:'payment-provider'}});
 await refundNotice(tx,{...r,duplicateReceipt:conflict},'DUPLICATE_CHANNEL_RECEIPT');
}
const lateBankFact=(r:any)=>r.method==='WECHAT_ORIGINAL'&&r.status==='SUCCEEDED'&&r.providerRefundId&&r.bankAccount?.status==='INVALIDATED_BY_ORIGINAL_SUCCESS'&&r.bankAccount.verifiedAt&&r.bankAccount.verifiedBy;
export class RefundBankService{
 constructor(private db:Db,private complete:(tx:any,r:any)=>Promise<void>){}
 async submit(id:string,raw:unknown,customerId:string){
  const input=z.object({...command,accountNumber:z.string().regex(/^\d{12,30}$/),bankName:z.string().trim().min(2).max(100),accountName:z.string().trim().min(1).max(100),evidenceFileIds:ids,accepted:z.literal(true)}).strict().parse(raw);
  return this.db.serial(async(tx:any)=>{const r=await lockRefund(tx,id);ensure(r.customerId===customerId,404,'NOT_FOUND');
   return archiveCommand(tx,{id:customerId,role:'CUSTOMER'},`refund-bank:${id}`,'CUSTOMER_ACCOUNT',{...input,accountNumber:canonicalHash(input.accountNumber)},async()=>{
    revision(r,input.revision);await assertRefundReplacementOpen(tx,r);ensure(!await tx.refund.count({where:{replacesRefundId:id}}),409,'REFUND_REPLACED');ensure(r.obligationId&&terminalOriginal(r)&&r.status!=='SUCCEEDED'&&!r.bankExecution,409,'REFUND_ORIGINAL_UNRESOLVED');
    const identity=await requireElectronicCustomerIdentity(tx,customerId);ensure(identity.customer.name===input.accountName,409,'REFUND_OWN_ACCOUNT_REQUIRED');
    const files=await evidence(tx,input.evidenceFileIds,customerId);await refundObligationGuard(tx,r.payment,r.amount,r.obligationId,r.id,{method:'MANUAL_BANK',collectAccountOnly:true});
    const source={refundId:id,paymentId:r.paymentId,customerId,obligationId:r.obligationId,amount:r.amount,accountNumber:input.accountNumber,accountName:input.accountName,bankName:input.bankName,identityHash:identity.snapshot.identityHash,files},hash=canonicalHash(source);
    const bankAccount={version:(r.bankAccount?.version??0)+1,hash,status:'SUBMITTED',maskedNumber:'****'+input.accountNumber.slice(-4),bankName:input.bankName,accountName:input.accountName,customerId,identityHash:identity.snapshot.identityHash,files,submittedAt:new Date().toISOString()};
    const updated=await tx.refund.update({where:{id},data:{method:'MANUAL_BANK',status:'PENDING_APPROVAL',providerRefundId:null,approvedBy:null,bankAccountCiphertext:encryptIdentity(source,`refund:${id}`,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||''),bankAccount,revision:{increment:1}}});
    await audit(tx,customerId,'REFUND_OWN_ACCOUNT','refunds',id,{accountHash:hash,version:bankAccount.version},'CUSTOMER');return safeRefund(updated);
   });
  });
 }
 async verify(id:string,raw:unknown,actor:any){
  const input=z.object({...command,accountHash:digest,unavailabilityKind:z.enum(['CUSTOMER_ACCOUNT_CLOSED','CUSTOMER_ACCOUNT_UNAVAILABLE','PROVIDER_CONFIRMED_ORIGINAL_ROUTE_UNAVAILABLE']),unavailabilityReason:note,evidenceFileIds:ids}).strict().parse(raw);
  return this.db.serial(async(tx:any)=>{await refundStaff(tx,actor);const r=await lockRefund(tx,id);return archiveCommand(tx,actor,`refund-bank:${id}`,'VERIFY_ACCOUNT',input,async()=>{
   revision(r,input.revision);ensure(r.method==='MANUAL_BANK'&&r.status==='PENDING_APPROVAL'&&r.bankAccount?.status==='SUBMITTED'&&r.bankAccount.hash===input.accountHash&&terminalOriginal(r),409,'REFUND_ACCOUNT_CHANGED');
   await refundStaff(tx,actor,r.requestedBy);await independentRefundSource(tx,r,actor);
   // Original-route unavailability is a separate reviewed fact; CLOSED alone is insufficient.
   const files=await evidence(tx,input.evidenceFileIds,r.customerId,r.requestedBy);await assertIndependentStaffReview(tx,actor.id,files.map((f:any)=>f.adminId),'DUAL_APPROVAL');await unchangedFiles(tx,r.bankAccount.files);
   await refundObligationGuard(tx,r.payment,r.amount,r.obligationId,r.id,{method:'MANUAL_BANK',accountHash:r.bankAccount.hash});
   await guardRenewalCancellationRefund(tx,r,actor,new Date(),'APPROVE');await guardCancellation04Refund(tx,r.payment,r.amount,r,actor);
   const account=decryptIdentity(r.bankAccountCiphertext,`refund:${id}`,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');ensure(canonicalHash(account)===r.bankAccount.hash,409,'REFUND_ACCOUNT_CHANGED');
   const identity=await requireElectronicCustomerIdentity(tx,r.customerId);ensure(identity.snapshot.identityHash===account.identityHash&&identity.customer.name===account.accountName,409,'REFUND_OWN_ACCOUNT_REQUIRED');
   const updated=await tx.refund.update({where:{id},data:{status:'PROCESSING',approvedBy:actor.id,bankAccount:{...r.bankAccount,status:'VERIFIED',verifiedBy:actor.id,verifiedAt:new Date().toISOString(),unavailability:{kind:input.unavailabilityKind,reason:input.unavailabilityReason,files,originalEvidenceHash:canonicalHash(r.channelEvidence)}},revision:{increment:1}}});
   await audit(tx,actor.id,'REFUND_BANK_APPROVED','refunds',id,{accountHash:input.accountHash});return safeRefund(updated);
  });});
 }
 async instructions(id:string,actor:any){return this.db.serial(async(tx:any)=>{await refundStaff(tx,actor);const r=await lockRefund(tx,id);ensure(r.method==='MANUAL_BANK'&&r.bankAccount?.status==='VERIFIED'&&r.status==='PROCESSING'&&!r.bankExecution&&terminalOriginal(r),409,'REFUND_BANK_STATE');await refundObligationGuard(tx,r.payment,r.amount,r.obligationId,r.id,{method:'MANUAL_BANK',accountHash:r.bankAccount.hash});await audit(tx,actor.id,'REFUND_BANK_PRIVATE_READ','refunds',id,{accountHash:r.bankAccount.hash});const a=decryptIdentity(r.bankAccountCiphertext,`refund:${id}`,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');return{refundId:id,amount:r.amount,accountHash:r.bankAccount.hash,accountNumber:a.accountNumber,bankName:a.bankName,accountName:a.accountName};});}
 async record(id:string,raw:unknown,actor:any){
  const input=z.object({...command,accountHash:digest,amount:z.number().int().positive(),paidAt:z.string().datetime({offset:true}),payerName:z.string().trim().min(1).max(100),payerAccount:z.string().regex(/^\d{8,30}$/),payeeAccount:z.string().regex(/^\d{12,30}$/),reference:z.string().trim().min(1).max(100),evidenceFileIds:ids}).strict().parse(raw);
  return this.db.serial(async(tx:any)=>{const staff=await refundStaff(tx,actor),r=await lockRefund(tx,id);return archiveCommand(tx,actor,`refund-bank:${id}`,'RECORD_BANK',{...input,payerAccount:canonicalHash(input.payerAccount),payeeAccount:canonicalHash(input.payeeAccount)},async()=>{
   revision(r,input.revision);const late=lateBankFact(r);ensure((late||r.method==='MANUAL_BANK'&&r.status==='PROCESSING'&&r.bankAccount?.status==='VERIFIED'&&terminalOriginal(r))&&r.bankAccount.hash===input.accountHash&&!r.bankExecution,409,'REFUND_BANK_STATE');
   ensure(input.amount===r.amount&&Date.parse(input.paidAt)<=Date.now()&&Date.parse(input.paidAt)>=Date.parse(r.bankAccount.verifiedAt),409,'REFUND_BANK_AMOUNT_TIME');
   if(!late)await refundObligationGuard(tx,r.payment,r.amount,r.obligationId,r.id,{method:'MANUAL_BANK',accountHash:r.bankAccount.hash});await unchangedFiles(tx,r.bankAccount.files);await unchangedFiles(tx,r.bankAccount.unavailability.files);
   const account=decryptIdentity(r.bankAccountCiphertext,`refund:${id}`,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');ensure(canonicalHash(account)===r.bankAccount.hash&&account.accountNumber===input.payeeAccount,409,'REFUND_ACCOUNT_CHANGED');
   const files=await evidence(tx,input.evidenceFileIds,r.customerId,actor.id),source={refundId:id,paymentId:r.paymentId,customerId:r.customerId,obligationId:r.obligationId,amount:r.amount,accountHash:r.bankAccount.hash,payerName:input.payerName,payerAccountHash:canonicalHash(input.payerAccount),payeeName:account.accountName,payeeAccountHash:canonicalHash(input.payeeAccount),reference:input.reference,paidAt:new Date(input.paidAt).toISOString(),files,...(late?{lateRegistration:true,invalidatedAt:r.bankAccount.invalidatedAt,authorizationTiming:Date.parse(input.paidAt)>Date.parse(r.bankAccount.invalidatedAt)?'AFTER_INVALIDATION':'BEFORE_INVALIDATION'}:{})};

   const bankExecution={version:1,status:'RECORDED',source,sourceHash:canonicalHash(source),recordedBy:actor.id,recordedPersonId:staff.staffPersonId,recordedAt:new Date().toISOString()};
   const updated=await tx.refund.update({where:{id},data:{bankExecution,bankReceiptKey:canonicalHash({payerName:source.payerName,reference:source.reference}),revision:{increment:1}}});await audit(tx,actor.id,'REFUND_BANK_RECORDED','refunds',id,{sourceHash:bankExecution.sourceHash});return safeRefund(updated);
  });});
 }
 async correctEvidence(id:string,raw:unknown,actor:any){
  const input=z.object({...command,sourceHash:digest,evidenceFileIds:ids,reason:note}).strict().parse(raw);
  return this.db.serial(async(tx:any)=>{const staff=await refundStaff(tx,actor),r=await lockRefund(tx,id);return archiveCommand(tx,actor,`refund-bank:${id}`,'CORRECT_BANK_EVIDENCE',input,async()=>{
   revision(r,input.revision);const proof=r.bankExecution;
   ensure(proof?.status==='REJECTED'&&proof.sourceHash===input.sourceHash&&canonicalHash(proof.source)===proof.sourceHash,409,'REFUND_BANK_SOURCE');
   ensure(proof.source.refundId===id&&proof.source.paymentId===r.paymentId&&proof.source.customerId===r.customerId&&proof.source.amount===r.amount&&proof.source.accountHash===r.bankAccount?.hash,409,'REFUND_BANK_SOURCE');
   const files=await evidence(tx,input.evidenceFileIds,r.customerId,actor.id);
   const {reviewedBy,reviewedPersonId,reviewedAt,reviewReason,...claim}=proof;
   const addition={files,submittedBy:actor.id,submittedPersonId:staff.staffPersonId,submittedAt:new Date().toISOString(),reason:input.reason,priorReview:{reviewedBy,reviewedPersonId,reviewedAt,reviewReason}};
   // Preserve the recorded financial source/hash and original recorder. Only evidence
   // is appended; this action cannot produce another instruction or cash effect.
   const bankExecution={...claim,status:'RECORDED',evidenceRevision:(proof.evidenceRevision??0)+1,supplementalEvidence:[...(proof.supplementalEvidence??[]),addition]};
   const updated=await tx.refund.update({where:{id},data:{bankExecution,revision:{increment:1}}});
   await audit(tx,actor.id,'REFUND_BANK_EVIDENCE_ADDED','refunds',id,{sourceHash:proof.sourceHash,evidenceRevision:bankExecution.evidenceRevision,addition});return safeRefund(updated);
  });});
 }
 async reconcile(id:string,raw:unknown,actor:any){
  const input=z.object({...command,sourceHash:digest,decision:z.enum(['VERIFIED','REJECTED']),reason:note}).strict().parse(raw);
  return this.db.serial(async(tx:any)=>{const staff=await refundStaff(tx,actor),r=await lockRefund(tx,id);return archiveCommand(tx,actor,`refund-bank:${id}`,'RECONCILE_BANK',input,async()=>{
   revision(r,input.revision);const proof=r.bankExecution,late=lateBankFact(r);ensure((late||r.method==='MANUAL_BANK'&&r.status==='PROCESSING')&&proof?.status==='RECORDED'&&proof.sourceHash===input.sourceHash&&canonicalHash(proof.source)===proof.sourceHash&&(!r.duplicateReceipt||late&&r.duplicateReceipt.bank.sourceHash===proof.sourceHash),409,'REFUND_BANK_STATE');
   const allFiles=[...proof.source.files,...(proof.supplementalEvidence??[]).flatMap((e:any)=>e.files)];
   await refundStaff(tx,actor,r.requestedBy);await assertIndependentStaffReview(tx,actor.id,[proof.recordedBy,...allFiles.map((f:any)=>f.adminId)],'DUAL_APPROVAL');await independentRefundSource(tx,r,actor);await unchangedFiles(tx,allFiles);
   ensure((late||terminalOriginal(r))&&proof.source.accountHash===r.bankAccount.hash&&proof.source.paymentId===r.paymentId&&proof.source.customerId===r.customerId&&proof.source.amount===r.amount,409,'REFUND_BANK_SOURCE');
   // A rejected receipt still denotes a claimed transfer: preserve its reservation for investigation.
   const bankExecution={...proof,status:input.decision,reviewedBy:actor.id,reviewedPersonId:staff.staffPersonId,reviewedAt:new Date().toISOString(),reviewReason:input.reason};
   const updated=await tx.refund.update({where:{id},data:{bankExecution,revision:{increment:1},...(input.decision==='VERIFIED'?{failureCode:null,...(!late?{status:'SUCCEEDED',succeededAt:new Date(proof.source.paidAt)}:{})}:{failureCode:'BANK_EVIDENCE_REJECTED'})},include:{payment:{include:{bill:true}}}});
   if(input.decision==='VERIFIED'){if(late)await refundConflict(tx,updated,r.duplicateReceipt?.original??{method:'WECHAT_ORIGINAL',refundId:id,providerRefundId:r.providerRefundId,amount:r.amount,succeededAt:r.succeededAt.toISOString()},bankExecution);else await this.complete(tx,updated);}await refundNotice(tx,updated,input.decision==='VERIFIED'?'SUCCEEDED':'BANK_REVIEW_REQUIRED');return safeRefund(await tx.refund.findUniqueOrThrow({where:{id}}));
  });});
 }
}

export async function refundReissueConflict(tx:any,additional:any,normal:any){
 if(additional.duplicateReceipt)return;
 const proof=(r:any)=>({refundId:r.id,method:r.method,providerRefundId:r.providerRefundId,bankExecution:r.bankExecution??null,amount:r.amount,succeededAt:r.succeededAt.toISOString()});
 const conflict={version:1,kind:'ORIGINAL_REISSUE',normalRefundId:normal.id,additionalRefundId:additional.id,original:proof(normal),additional:proof(additional),unresolvedExtraAmount:additional.amount,verifiedExtraAmount:additional.amount};
 await tx.refund.update({where:{id:additional.id},data:{duplicateReceipt:conflict}});
 await tx.payment.update({where:{id:additional.paymentId},data:{reconciliationRequired:true,reconciliationReason:'DUPLICATE_REFUND_CHANNEL_RECEIPT',revision:{increment:1}}});
 await tx.paymentReconciliation.create({data:{paymentId:additional.paymentId,resolution:'DUPLICATE_REFUND_CHANNEL_RECEIPT',note:'同一替代链发生两次真实退款，普通履行仅一次',evidenceFileIds:[],paymentSnapshot:{paymentId:additional.paymentId,refundId:additional.id,conflict},submittedBy:'payment-provider'}});
 await refundNotice(tx,{...additional,duplicateReceipt:conflict},'DUPLICATE_CHANNEL_RECEIPT');
}
