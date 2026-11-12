import {hasRefundReceipt,refundReceiptIdentity,normalRefundAmount,refundCashState} from '../billing/refund-proof';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {AgreementFactError,assertConfirmedQuote,assertOfflineContract,agreementInstant} from '../order-changes/agreement-facts';
import {readServiceStage} from '../order-service-stages/readiness';
import {parseStageRow,stageDay} from '../order-service-stages/source';
import {shanghaiDay} from '../usage/rules';
import {renewalId} from './types';
import {assertRenewalCancellationTiming} from './cancellation-timing';
import type {RenewalCancellationFacts,RenewalCancellationReadInput,CancellationPaymentFact,CancellationRefundFact} from './cancellation-types';

const same=(a:any,b:any)=>canonicalHash(a)===canonicalHash(b);
const id=(v:any)=>typeof v==='string'&&v.trim().length>0&&!v.includes('\0');
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const cents=(v:any)=>Number.isInteger(v)&&v>=0&&v<=2147483647;
const revision=(v:any)=>cents(v);
const instant=(v:any)=>Number.isFinite(agreementInstant(v));
const iso=(v:any):string|null=>instant(v)?new Date(v).toISOString():null;
const sorted=(rows:any[])=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const unique=(values:string[])=>[...new Set(values)].sort();
function fact(v:unknown,message='续期取消冻结来源缺失或不一致'):asserts v{ensure(v,409,'RENEWAL_CANCELLATION_SOURCE',message);}

function frozenQuoteSourceOf(order:any,change:any,quote:any,contract:any,originalVersion:any){
 const s=quote.snapshot,original={contractId:change.originalContractId,archiveVersionId:change.originalArchiveVersionId,archiveHash:originalVersion.fileManifestHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash};
 return{orderId:order.id,customerId:order.customerId,changeId:change.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,confirmedAt:iso(quote.confirmedAt),contractId:contract.id,original,document:s.document,source:s.source,sourceHash:s.sourceHash,periods:s.periods,renewalTerms:s.renewalTerms,usagePricing:s.usagePricing,swapPolicy:s.swapPolicy,customerAcceptance:s.customerAcceptance};
}

/** Source validation is deliberately independent of current paper approval/catalog/qualification readiness. */
async function frozenSource(tx:any,input:RenewalCancellationReadInput,now:Date){
 ensure(input.timingPurpose===undefined||['PREVIEW','RECORD_MUTUAL_AGREEMENT'].includes(input.timingPurpose),400,'VALIDATION','取消事实读取用途无效');
 const change=await tx.orderChange.findUnique({where:{id:renewalId.parse(input.changeId)}});
 ensure(change?.kind==='SUBSCRIPTION_EXTENSION'&&(input.customerId===undefined||change.customerId===input.customerId),404,'NOT_FOUND','续期变更不存在');
 const order=await tx.order.findUnique({where:{id:change.orderId}});fact(order&&order.customerId===change.customerId&&order.contractMode==='OFFLINE'&&revision(order.revision)&&revision(change.revision));
 fact(['AWAITING_ARCHIVE','AWAITING_FINANCE','SCHEDULED'].includes(change.status)&&id(change.activeQuoteId),'仅可取消未开始且已确认的续期');
 const quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}}),contract=quote?.contract;
 try{assertConfirmedQuote(change,quote,contract,order);assertOfflineContract(contract);}catch(e){if(e instanceof AgreementFactError)fact(false,e.code);throw e;}
 fact(quote.createdBy&&quote.reviewedBy&&quote.createdBy!==quote.reviewedBy,'须保留原报价独立财务复核');
 const s=quote.snapshot,today=shanghaiDay(now);
 const [account,assignment,original,originalVersion,prior,stages,cancellation]=await Promise.all([
  tx.usageAccount.findUnique({where:{orderId:order.id}}),tx.vehicleAssignment.findUnique({where:{id:s.originalAssignmentId}}),
  tx.contract.findUnique({where:{id:change.originalContractId}}),tx.archiveVersion.findUnique({where:{id:change.originalArchiveVersionId}}),
  change.priorTermsVersionId?tx.orderTermsVersion.findUnique({where:{id:change.priorTermsVersionId}}):null,
  tx.orderServiceStage.findMany({where:{OR:[{id:s.renewalTerms.serviceStageId},{changeId:change.id},{quoteId:quote.id}]}}),
  tx.orderRenewalCancellation.findUnique({where:{quoteId:quote.id}}),
 ]);
 fact(account?.id===s.source.accountId&&account.orderId===order.id&&account.customerId===order.customerId&&revision(account.revision));
 fact(assignment?.id===s.originalAssignmentId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===s.source.vehicleId&&['ACTIVE','CLOSED'].includes(assignment.status)&&instant(assignment.startAt)&&agreementInstant(assignment.startAt)<=agreementInstant(quote.confirmedAt));
 const delivery=assignment.deliveryHandoverId?await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}):null;
 fact(delivery?.id===assignment.deliveryHandoverId&&delivery.orderId===order.id&&delivery.customerId===order.customerId&&delivery.vehicleId===assignment.vehicleId&&delivery.assignmentId===assignment.id&&['DELIVERY','SWAP_DELIVERY'].includes(delivery.type)&&delivery.status==='COMPLETED'&&instant(delivery.actualAt)&&instant(delivery.completedAt)&&agreementInstant(delivery.actualAt)===agreementInstant(assignment.startAt));
 fact(original?.id===change.originalContractId&&['RENTAL','SUBSCRIPTION'].includes(original.kind)&&original.documentHash===order.finalPlanSnapshot.commercialHash&&!original.delayQuoteId&&original.orderId===order.id&&original.customerId===order.customerId);assertOfflineContract(original);
 const originalArchive=originalVersion?await tx.documentArchive.findUnique({where:{id:originalVersion.archiveId}}):null;
 fact(originalArchive?.kind==='RENTAL'&&originalArchive.subjectType==='ORDER'&&originalArchive.subjectId===order.id&&!originalArchive.quoteId&&!originalArchive.handoverId&&originalArchive.orderId===order.id&&originalArchive.ownerId===s.source.ownerId&&original.offlineArchiveId===originalArchive.id&&originalVersion.id===change.originalArchiveVersionId&&originalVersion.fileManifestHash===s.source.originalArchiveHash&&digest(originalVersion.fileManifestHash)&&originalVersion.businessSnapshotHash===order.finalPlanSnapshot.commercialHash);
 fact(change.priorTermsVersionId?prior?.id===change.priorTermsVersionId&&prior.orderId===order.id&&same(prior.snapshot,change.priorTerms)&&prior.hash===change.priorTerms.commercialHash:same(order.finalPlanSnapshot,change.priorTerms));
 const previous=await readServiceStage(tx,order,s.source.currentStageId);
 fact(['ACTIVE','ENDED'].includes(previous.stage.status)&&previous.stage.snapshotHash===s.source.currentStageHash&&previous.snapshot.period.endDate===s.startDate&&previous.snapshot.identity.sequence<s.source.nextStageSequence&&previous.snapshot.period.lastPeriodSequence<s.periods[0].sequence);
 fact(previous.snapshot.kind==='INITIAL'?!Object.hasOwn(change.priorTerms,'serviceStageId'):change.priorTerms.serviceStageId===previous.stage.id);
 fact(stages.length<=1);let stage:any=null;
 if(stages.length){
  stage=stages[0];fact(['PREPARED','SCHEDULED'].includes(stage.status)&&stage.activatedAt==null,'已生效或结束租期不能按未开始取消');fact(await tx.usagePeriod.count({where:{serviceStageId:stage.id}})===0,'已有真实新期使用期间，不能按未开始取消');const parsed=parseStageRow(stage,order),p=parsed.snapshot,a=p.source.agreement;
  fact(stage.kind==='RENEWAL'&&stage.id===s.renewalTerms.serviceStageId&&stage.changeId===change.id&&stage.quoteId===quote.id&&stage.ownerId===s.source.ownerId&&stage.assignmentId===assignment.id&&stage.previousStageId===previous.stage.id&&stage.sequence===s.source.nextStageSequence);
  fact(instant(quote.financePreparedAt)&&agreementInstant(quote.financePreparedAt)>=agreementInstant(quote.confirmedAt)&&quote.approvedArchiveVersionId===stage.approvedArchiveVersionId&&a.quoteRevision===quote.revision&&a.commercialHash===quote.commercialHash&&same(a.document,s.document));
  fact(a.originalContractId===original.id&&a.originalArchiveVersionId===originalVersion.id&&a.originalArchiveHash===originalVersion.fileManifestHash&&a.priorTermsVersionId===(change.priorTermsVersionId??null)&&a.priorTermsHash===change.priorTermsHash);
  fact(same(p.termsSnapshot,s.renewalTerms)&&same(p.billingSchedule,s.periods)&&same(p.usagePricing,s.usagePricing)&&same(p.swapPolicy,s.swapPolicy)&&p.period.startDate===s.startDate&&p.period.endDate===s.endDate);
  fact(['AWAITING_FINANCE','SCHEDULED'].includes(change.status));
 }else fact(!quote.financePreparedAt&&!quote.approvedArchiveVersionId&&change.status!=='SCHEDULED','已准备财务的报价缺失对应真实服务段');
 if(cancellation)fact(cancellation.orderId===order.id&&cancellation.customerId===order.customerId&&cancellation.ownerId===s.source.ownerId&&cancellation.changeId===change.id&&cancellation.quoteId===quote.id&&(cancellation.serviceStageId??null)===(stage?.id??null)&&revision(cancellation.revision));
 const frozenQuoteSource=frozenQuoteSourceOf(order,change,quote,contract,originalVersion);
 if(cancellation)fact(cancellation.sourceSnapshot?.version===1&&cancellation.sourceSnapshot.facts?.version===1&&same(cancellation.sourceSnapshot.facts.frozenQuoteSource,frozenQuoteSource)&&digest(cancellation.sourceHash)&&canonicalHash(cancellation.sourceSnapshot)===cancellation.sourceHash,'取消案原冻结报价来源不匹配');
 let timingProof:Awaited<ReturnType<typeof assertRenewalCancellationTiming>>=null;const timingBlockers:string[]=[];
 try{timingProof=await assertRenewalCancellationTiming(tx,cancellation,s.startDate,now);}catch(error){
  if(input.timingPurpose&&error instanceof HttpException&&error.getStatus()===409&&(error.getResponse() as any)?.error?.code==='RENEWAL_CANCELLATION_AGREEMENT_REQUIRED')timingBlockers.push('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED');else throw error;
 }
 const timing={mutualAgreementVerified:timingProof!==null,requiresMutualAgreement:today>=s.startDate,blockers:timingBlockers};
 return{change,order,quote,contract,s,today,account,assignment,original,originalVersion,stage,cancellation,timing,timingProof,frozenQuoteSource};
}

async function signatureHistory(tx:any,source:Awaited<ReturnType<typeof frozenSource>>){
 const{order,quote,contract,s,stage,cancellation}=source;
 const archives=await tx.documentArchive.findMany({where:{OR:[{quoteId:quote.id},{subjectType:'ORDER_CHANGE_QUOTE',subjectId:quote.id},...(contract.offlineArchiveId?[{id:contract.offlineArchiveId}]:[])]},include:{versions:{include:{files:true,feedback:true}}},orderBy:{id:'asc'}});
 fact(archives.length<=1,'续期档案关联不唯一');const archive=archives[0]??null;
 if(archive)fact(archive.kind==='ORDER_AMENDMENT'&&archive.orderId===order.id&&archive.ownerId===s.source.ownerId&&archive.subjectType==='ORDER_CHANGE_QUOTE'&&archive.subjectId===quote.id&&archive.quoteId===quote.id&&!archive.handoverId&&contract.offlineArchiveId===archive.id&&Array.isArray(archive.versions));
 else fact(!contract.offlineArchiveId&&!stage,'已准备续期缺少原补充档案引用');
 if(stage){const pin=archive.versions.find((v:any)=>v.id===quote.approvedArchiveVersionId);fact(pin&&pin.archiveId===archive.id&&pin.businessSnapshotHash===quote.commercialHash&&pin.templateId===s.document.id&&pin.templateVersion===s.document.version&&pin.fileManifestHash===stage.snapshot.source.agreement.approvedArchiveHash&&digest(pin.fileManifestHash),'原续期纸档冻结 pin 不匹配');}
 const cancelledArchives=cancellation?await tx.documentArchive.findMany({where:{OR:[{renewalCancellationId:cancellation.id},{subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:cancellation.id}]},include:{versions:{include:{files:true,feedback:true}}},orderBy:{id:'asc'}}):[];
 fact(cancelledArchives.length<=1);const cancelArchive=cancelledArchives[0]??null;
 if(cancelArchive)fact(cancelArchive.kind==='RENEWAL_CANCELLATION'&&cancelArchive.subjectType==='ORDER_RENEWAL_CANCELLATION'&&cancelArchive.subjectId===cancellation.id&&cancelArchive.renewalCancellationId===cancellation.id&&cancelArchive.orderId===order.id&&cancelArchive.ownerId===s.source.ownerId&&Array.isArray(cancelArchive.versions));
 async function history(a:any){
  if(!a)return{versions:[],commands:[],signed:false,incomplete:false,revision:null};
  const versions=sorted(a.versions).map((v:any)=>{
   fact(v.archiveId===a.id&&Array.isArray(v.files));for(const f of v.files)fact(f.versionId===v.id&&id(f.fileId));
   return{id:v.id,version:v.version,status:v.status,sourceFileId:v.sourceFileId??null,fileIds:v.files.map((f:any)=>f.fileId).sort(),fileManifestHash:v.fileManifestHash??null,submittedAt:iso(v.submittedAt),reviewedAt:iso(v.reviewedAt),invalidatedAt:iso(v.invalidatedAt),signedOn:v.signedOn??null,feedback:sorted(v.feedback??[]).map((f:any)=>({id:f.id,status:f.status,createdAt:iso(f.createdAt),resolvedAt:iso(f.resolvedAt)}))};
  });
  const commands=sorted(await tx.archiveCommand.findMany({where:{resourceId:a.id},orderBy:{id:'asc'}})).map((c:any)=>({id:c.id,action:c.action,requestHash:c.requestHash,resultSnapshot:c.resultSnapshot,createdAt:iso(c.createdAt)}));
  const incomplete=versions.some((v:any)=>!['DRAFT','SUBMITTED','REVIEWED','ARCHIVED','REJECTED','INVALIDATED','SUPERSEDED'].includes(v.status));
  const signed=versions.some((v:any)=>v.fileIds.length>0||v.signedOn||v.submittedAt||v.reviewedAt||v.fileManifestHash||['SUBMITTED','REVIEWED','ARCHIVED','REJECTED','INVALIDATED'].includes(v.status))||commands.some(c=>/^(?:FIELD_)?UPLOAD:/.test(c.action)||['SUBMIT','FIELD_SUBMIT','REVIEW','ARCHIVE','INVALIDATE'].includes(c.action));
  return{versions,commands,signed,incomplete,revision:a.revision??null};
 }
 const original=await history(archive),cancelled=await history(cancelArchive),historyHash=canonicalHash({archiveId:archive?.id??null,currentApprovedVersionId:archive?.currentApprovedVersionId??null,original,cancellationArchiveId:cancelArchive?.id??null,cancelled});
 return{archiveId:archive?.id??null,currentApprovedVersionId:archive?.currentApprovedVersionId??null,hasHistoricalSignedUpload:original.signed,cancellationArchiveId:cancelArchive?.id??null,hasCancellationSignedUpload:cancelled.signed,canDeclareUnsigned:!original.signed&&!cancelled.signed&&!original.incomplete&&!cancelled.incomplete,versions:original.versions,historyHash,blockers:original.incomplete||cancelled.incomplete?['SIGNATURE_HISTORY_INCOMPLETE']:[]};
}

async function fundingFacts(tx:any,source:Awaited<ReturnType<typeof frozenSource>>):Promise<RenewalCancellationFacts['funding']>{
 const{order,quote,s,stage,cancellation}=source,stageId=stage?.id??s.renewalTerms.serviceStageId;
 const bills=sorted(await tx.bill.findMany({where:{OR:[{serviceStageId:stageId},{idempotencyKey:{startsWith:`renewal:${quote.id}:`}}]},include:{payments:{include:{refunds:true}}},orderBy:{id:'asc'}}));
 const obligations=sorted(await tx.serviceObligation.findMany({where:{OR:[{serviceStageId:stageId},{quoteId:quote.id}]},orderBy:{id:'asc'}}));
 fact(stage?bills.length===s.months&&obligations.length===s.months:bills.length===0&&obligations.length===0,'续期财务期间行缺失或出现无服务段账款');
 const billFacts:any[]=[],obligationFacts:any[]=[];
 if(stage)for(const row of s.periods){
  const bs=bills.filter(b=>b.sequence===row.sequence),os=obligations.filter(o=>o.sequence===row.sequence&&o.stageSequence===row.stageSequence),b=bs[0],o=os[0];
  fact(bs.length===1&&os.length===1&&b.type==='SUBSCRIPTION'&&b.orderId===order.id&&b.customerId===order.customerId&&b.serviceStageId===stageId&&b.amount===row.amount&&stageDay(b.dueDate)===row.dueDate&&b.idempotencyKey===`renewal:${quote.id}:${row.sequence}`&&Array.isArray(b.payments));
  fact(o.orderId===order.id&&o.quoteId===quote.id&&o.serviceStageId===stageId&&o.chargeBillId===b.id&&o.amount===row.amount&&o.chargeAmount===row.amount&&o.active===false&&Array.isArray(o.sourceBillIds)&&o.sourceBillIds.length===0&&stageDay(o.startDate)===row.startDate&&stageDay(o.endDate)===row.endDate&&stageDay(o.dueDate)===row.dueDate);
  billFacts.push({id:b.id,orderId:b.orderId,customerId:b.customerId,serviceStageId:stageId,sequence:row.sequence,stageSequence:row.stageSequence,amount:b.amount,paidAmount:b.paidAmount,dueDate:row.dueDate,status:b.status,idempotencyKey:b.idempotencyKey});
  obligationFacts.push({id:o.id,orderId:o.orderId,quoteId:o.quoteId,serviceStageId:stageId,sequence:o.sequence,stageSequence:o.stageSequence,amount:o.amount,chargeAmount:o.chargeAmount,chargeBillId:o.chargeBillId,sourceBillIds:o.sourceBillIds,startDate:row.startDate,endDate:row.endDate,dueDate:row.dueDate,active:o.active});
 }
 const allPayments=sorted(bills.flatMap(b=>b.payments)),paymentIds=allPayments.map(p=>p.id),[allocations,reconciliations]=(paymentIds.length||obligations.length)?await Promise.all([
  tx.paymentAllocation.findMany({where:{OR:[{paymentId:{in:paymentIds}},{obligationId:{in:obligations.map(o=>o.id)}}]},orderBy:{id:'asc'}}),tx.paymentReconciliation.findMany({where:{paymentId:{in:paymentIds}},orderBy:{id:'asc'}}),
 ]):[[],[]];
 const blockers:string[]=[];
 for(const b of bills)if(!['PENDING','PAID','VOID'].includes(b.status)||!cents(b.paidAmount))blockers.push('BILL_STATE_UNKNOWN');
 const payments:CancellationPaymentFact[]=allPayments.map(p=>{
  const errors:string[]=[],b=bills.find(b=>b.payments.some((x:any)=>x===p)),rawRefunds=Array.isArray(p.refunds)?sorted(p.refunds):[];
  let paymentValid=cents(p.amount)&&p.amount>0&&p.billId===b?.id&&p.customerId===order.customerId&&revision(p.revision)&&id(p.id),refundValid=Array.isArray(p.refunds);
  if(!paymentValid)errors.push('PAYMENT_SOURCE_MISMATCH');
  if(allPayments.filter(x=>x.id===p.id).length!==1||p.providerTransactionId&&allPayments.filter(x=>x.providerTransactionId===p.providerTransactionId).length!==1){paymentValid=false;errors.push('MONEY_DUPLICATE_FACT');}
  if(!['CREATING','PENDING','SUCCEEDED','FAILED','CLOSED'].includes(p.status)){paymentValid=false;errors.push('PAYMENT_STATUS_UNKNOWN');}
  if(['CREATING','PENDING'].includes(p.status))errors.push('PAYMENT_UNRESOLVED');
  if(p.status==='SUCCEEDED'&&(!id(p.providerTransactionId)||!instant(p.succeededAt))){paymentValid=false;errors.push('PAYMENT_RECEIPT_UNPROVED');}
  if(p.status!=='SUCCEEDED'&&(p.succeededAt||p.providerTransactionId)){paymentValid=false;errors.push('PAYMENT_RECEIPT_CONFLICT');}
  if(p.reconciliationRequired!==false)errors.push('PAYMENT_RECONCILIATION_REQUIRED');
  let refunded=0;const refunds:CancellationRefundFact[]=rawRefunds.map(r=>{
   const fields=['renewalCancellationId','renewalCancellationOrderId','renewalCancellationStageId','renewalCancellationBillId'],empty=fields.every(k=>r[k]==null),bound=fields.every(k=>id(r[k]))&&cancellation&&r.renewalCancellationId===cancellation.id&&r.renewalCancellationOrderId===order.id&&r.renewalCancellationStageId===stageId&&r.renewalCancellationBillId===p.billId;
   if(r.paymentId!==p.id||r.customerId!==order.customerId||!id(r.id)||!cents(r.amount)||r.amount<=0||(!empty&&!bound)){refundValid=false;errors.push('REFUND_SOURCE_MISMATCH');}
   if(allPayments.flatMap(x=>x.refunds??[]).filter(x=>x.id===r.id).length!==1||refundReceiptIdentity(r)&&allPayments.flatMap(x=>x.refunds??[]).filter(x=>refundReceiptIdentity(x)===refundReceiptIdentity(r)).length!==1){refundValid=false;errors.push('MONEY_DUPLICATE_FACT');}
   if(!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(r.status)){refundValid=false;errors.push('REFUND_STATUS_UNKNOWN');}
   if(['PENDING_APPROVAL','PROCESSING'].includes(r.status))errors.push('REFUND_UNRESOLVED');
   if(r.status==='SUCCEEDED'){if(!hasRefundReceipt(r)||!instant(r.succeededAt)||p.status!=='SUCCEEDED'){refundValid=false;errors.push('REFUND_RECEIPT_UNPROVED');}if(cents(r.amount))refunded+=normalRefundAmount(r);}
   else if(r.succeededAt){refundValid=false;errors.push('REFUND_RECEIPT_CONFLICT');}
   return{id:r.id,paymentId:r.paymentId,customerId:r.customerId,amount:r.amount,status:r.status,...(r.duplicateReceipt?{normalAmount:normalRefundAmount(r),duplicateReceipt:r.duplicateReceipt}:{}),method:r.method??'WECHAT_ORIGINAL',receiptIdentity:refundReceiptIdentity(r),providerRefundId:r.providerRefundId??null,succeededAt:iso(r.succeededAt),renewalCancellationId:r.renewalCancellationId??null,renewalCancellationOrderId:r.renewalCancellationOrderId??null,renewalCancellationStageId:r.renewalCancellationStageId??null,renewalCancellationBillId:r.renewalCancellationBillId??null,createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt)};
  });
  if(!Number.isSafeInteger(refunded)||refunded>p.amount){refundValid=false;errors.push('REFUND_AMOUNT_CONFLICT');}
  if(!refundValid)errors.push('REFUND_SOURCE_MISMATCH');
  const reviews=reconciliations.filter((r:any)=>r.paymentId===p.id),receipt={paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,status:p.status};
  const reviewed=(r:any)=>r.status==='APPROVED'&&r.resolution==='REFUNDED'&&same(r.paymentSnapshot,receipt)&&id(r.submittedBy)&&id(r.reviewedBy)&&r.reviewedBy!==r.submittedBy&&instant(r.createdAt)&&instant(r.reviewedAt)&&agreementInstant(r.reviewedAt)>=agreementInstant(r.createdAt)&&Array.isArray(r.evidenceFileIds)&&r.evidenceFileIds.length>0&&r.evidenceFileIds.every(id);
  if((p.reconciliationReason||reviews.length)&&!reviews.some(reviewed))errors.push('PAYMENT_RECONCILIATION_REQUIRED');
  if(reviews.some((r:any)=>r.status==='APPROVED'&&!reviewed(r)))errors.push('RECONCILIATION_SOURCE_MISMATCH');
  if(reviews.some((r:any)=>r.status==='SUBMITTED'))errors.push('PAYMENT_RECONCILIATION_REQUIRED');
  const receivedAmount=paymentValid?(p.status==='SUCCEEDED'?p.amount:0):null,refundedAmount=refundValid?refunded:null,remainingRefundAmount=receivedAmount!==null&&refundedAmount!==null?receivedAmount-refundedAmount:null;
  blockers.push(...errors);return{id:p.id,billId:p.billId,customerId:p.customerId,revision:p.revision,status:p.status,amount:p.amount,providerTransactionId:p.providerTransactionId??null,succeededAt:iso(p.succeededAt),reconciliationRequired:p.reconciliationRequired!==false,...(refundCashState(p.refunds??[]).hasConflict?{cash:refundCashState(p.refunds??[])}:{}),refunds,receivedAmount,refundedAmount,remainingRefundAmount,blockers:unique(errors)};
 });
 for(const b of bills){
  // A paid counter is never proof of cash, but it cannot exceed real gross receipts.
  // Refunds do not erase a historical counter; late verified cash can exceed it.
  const received=payments.filter(p=>p.billId===b.id&&p.status==='SUCCEEDED'&&p.receivedAmount!==null).reduce((n,p)=>n+BigInt(p.receivedAmount!),0n);
  if(cents(b.paidAmount)&&BigInt(b.paidAmount)>received)blockers.push('BILL_RECEIPT_COUNTER_CONFLICT');
  if(b.status==='PAID'&&b.paidAmount!==b.amount)blockers.push('BILL_PAID_STATE_CONFLICT');
 }
 for(const a of allocations){const p=payments.find(p=>p.id===a.paymentId),o=obligations.find(o=>o.id===a.obligationId);if(!p||!o||o.chargeBillId!==p.billId||!cents(a.amount)||a.amount<=0||p.status!=='SUCCEEDED')blockers.push('ALLOCATION_SOURCE_MISMATCH');}
 for(const p of payments){const amount=allocations.filter((a:any)=>a.paymentId===p.id&&!a.releasedAt).reduce((n:number,a:any)=>n+(cents(a.amount)?a.amount:0),0);if(!Number.isSafeInteger(amount)||p.receivedAmount===null||amount>p.receivedAmount)blockers.push('ALLOCATION_AMOUNT_CONFLICT');}
 for(const r of reconciliations){if(!paymentIds.includes(r.paymentId)||!['SUBMITTED','APPROVED','REJECTED'].includes(r.status))blockers.push('RECONCILIATION_SOURCE_MISMATCH');if(r.status==='SUBMITTED')blockers.push('PAYMENT_RECONCILIATION_REQUIRED');}
 const total=(key:'receivedAmount'|'refundedAmount'|'remainingRefundAmount'):number|null=>{if(payments.some(p=>p[key]===null))return null;const n=payments.reduce((n,p)=>n+p[key]!,0);if(!Number.isSafeInteger(n)||n<0){blockers.push('MONEY_TOTAL_INVALID');return null;}return n;};
 const receivedAmount=total('receivedAmount'),refundedAmount=total('refundedAmount'),remainingRefundAmount=total('remainingRefundAmount');
 const sourceHash=canonicalHash({stageId:stage?.id??null,quoteId:quote.id,bills:billFacts,obligations:obligationFacts,payments,allocations:sorted(allocations).map(a=>({id:a.id,paymentId:a.paymentId,obligationId:a.obligationId,amount:a.amount,releasedAt:iso(a.releasedAt)})),reconciliations:sorted(reconciliations).map(r=>({id:r.id,paymentId:r.paymentId,status:r.status,resolution:r.resolution,paymentSnapshot:r.paymentSnapshot,evidenceFileIds:r.evidenceFileIds??[],submittedBy:r.submittedBy,reviewedBy:r.reviewedBy??null,reviewedAt:iso(r.reviewedAt),createdAt:iso(r.createdAt)}))});
 return{bills:billFacts,obligations:obligationFacts,payments,receivedAmount,refundedAmount,remainingRefundAmount,refundRequired:remainingRefundAmount!==null&&remainingRefundAmount>0,fundsClear:blockers.length===0&&remainingRefundAmount===0,sourceHash,blockers:unique(blockers)};
}

/** Caller authorizes current actor and locks Order before any command. This function never writes or executes refunds. */
export async function readRenewalCancellationFacts(tx:any,input:RenewalCancellationReadInput,now:Date):Promise<RenewalCancellationFacts>{
 const source=await frozenSource(tx,input,now).catch(error=>{if(error instanceof AgreementFactError)fact(false,error.code);throw error;}),{order,change,quote,s,stage,account,originalVersion,cancellation}=source;
 const signature=await signatureHistory(tx,source),funding=await fundingFacts(tx,source);
 const frozenQuoteSource=source.frozenQuoteSource,original=frozenQuoteSource.original;
 const sourceSnapshot=structuredClone({version:1 as const,frozenQuoteSource,observed:{observedOn:source.today,orderRevision:order.revision,orderStatus:order.status,changeRevision:change.revision,changeStatus:change.status,accountRevision:account.revision,quoteStatus:quote.status,financePreparedAt:iso(quote.financePreparedAt),approvedArchiveVersionId:quote.approvedArchiveVersionId??null,stage:stage?{id:stage.id,revision:stage.revision,status:stage.status,snapshotHash:stage.snapshotHash}:null,cancellation:cancellation?{id:cancellation.id,revision:cancellation.revision,status:cancellation.status,signatureState:cancellation.signatureState??'UNKNOWN',signatureVerifiedBy:cancellation.signatureVerifiedBy??null,signatureVerifiedAt:iso(cancellation.signatureVerifiedAt),signatureEvidenceFileIds:[...(cancellation.signatureEvidenceFileIds??[])].sort(),signatureNote:cancellation.signatureNote??null,terminationArchiveId:cancellation.terminationArchiveId??null,approvedArchiveVersionId:cancellation.approvedArchiveVersionId??null,terminationArchiveHash:cancellation.terminationArchiveHash??null}:null,timing:source.timing,mutualAgreementProof:source.timingProof,signatureHistoryHash:signature.historyHash,fundingSourceHash:funding.sourceHash,signature,funding}});
 return{version:1,observedOn:source.today,order:{id:order.id,customerId:order.customerId,revision:order.revision,status:order.status},change:{id:change.id,revision:change.revision,status:change.status},quote:{id:quote.id,revision:quote.revision,status:quote.status,commercialHash:quote.commercialHash,confirmedAt:iso(quote.confirmedAt)!,financePreparedAt:iso(quote.financePreparedAt),document:structuredClone(s.document)},ownerId:s.source.ownerId,period:{startDate:s.startDate,endDate:s.endDate,months:s.months},original,stage:sourceSnapshot.observed.stage,timing:source.timing,sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot),signature,funding,blockers:unique([...source.timing.blockers,...signature.blockers,...funding.blockers])};
}
