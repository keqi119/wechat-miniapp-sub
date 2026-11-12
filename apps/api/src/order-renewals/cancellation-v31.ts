import {hasRefundReceipt,refundReceiptIdentity,normalRefundAmount,refundCashState} from '../billing/refund-proof';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {assertNotAssetFiles} from '../files/asset-files';
import {requireElectronicRenewalAgreement} from './electronic-archive';
import {assertElectronicRenewalCommercial} from './electronic-agreement';
import {readElectronicSubscriptionOrigin} from '../electronic-documents/subscription';
import {cancellationCommand,cancellationPermission} from './cancellation-commands';
import {parseStageRow} from '../order-service-stages/source';
import {readDependencySettlement} from './cancellation-dependency';
import {assertIndependentStaffReview} from '../partners/capabilities';

const id=z.string().min(1).max(200),note=z.string().trim().min(1).max(2000),instant=z.string().datetime({offset:true});
const files=z.array(id).min(1).max(20).refine(v=>new Set(v).size===v.length);
const intent=z.object({subjectId:id,intention:note,occurredAt:instant,fileIds:files}).strict();
const claimSchema=z.object({customer:intent,lessor:z.object({ownerId:id,personName:note,personReference:note,authorityScope:note,authorityFrom:instant,authorityUntil:instant,intention:note,occurredAt:instant,fileIds:files,authorityFileIds:files}).strict(),note}).strict();
const base={businessSourceHash:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().nonnegative(),headId:id.nullable(),headHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),idempotencyKey:id};
const schemas={'request-refund':z.object({...base,paymentId:id,sourceHash:z.string(),note}).strict(),claim:z.object({...base,claim:claimSchema}).strict(),verify:z.object({...base,decision:z.enum(['VERIFIED','NEED_MORE','REJECTED']),note}).strict(),correct:z.object(base).strict(),'dispose-dependency':z.object({...base,dependencyHash:z.string(),disposition:z.enum(['NO_SEPARATE_LIABILITY','REFERRED_FINANCIAL_REVIEW','SEPARATELY_SETTLED']),financialBillId:id.optional(),financialBillHash:z.string().optional(),responsibleStaffId:id,dueAt:instant,evidenceFileIds:files,note}).strict(),'close-finance':z.object({...base,sourceHash:z.string(),note}).strict()};

function preparedStageBinding(record:any,pin:any,rejected:any,preparedAt:Date){
 return{kind:'STAGE_PREPARED_AFTER_REJECTION',intakeSourceHash:record.sourceHash,stageId:pin.stageId,stageHash:pin.stageHash,sourceHash:canonicalHash(pin),rejectedFactId:rejected.id,rejectedFactHash:rejected.factHash,financePreparedAt:preparedAt.toISOString()};
}
export function assertV31FactChain(record:any,history:any[],pin:any,currentPin=pin,preparedAt?:Date){
 if(!record){ensure(!history.length,409,'RENEWAL_CANCELLATION_FACT_CHAIN');return;}
 ensure(history.length>0&&record.revision===history.length&&record.lifecycleState===history.filter(f=>f.kind!=='DEPENDENCY_DISPOSITION').at(-1)?.kind,409,'RENEWAL_CANCELLATION_FACT_CHAIN');
 let stageId=pin.stageId??null,bindingFact:any=null;
 for(let i=0;i<history.length;i++){
  const f=history[i],previous=history[i-1],{factHash,...body}=f,binding=f.payload?.stageBinding;
  if(binding){
   ensure(f.kind==='CLAIM'&&!stageId&&!bindingFact&&previous?.kind==='REJECTED'&&currentPin.stageId&&preparedAt&&preparedAt>=previous.recordedAt&&preparedAt<=f.recordedAt,409,'RENEWAL_CANCELLATION_FACT_CHAIN');
   ensure(canonicalHash(binding)===canonicalHash(preparedStageBinding(record,currentPin,previous,preparedAt!)),409,'RENEWAL_CANCELLATION_FACT_CHAIN');
   stageId=currentPin.stageId;bindingFact=f;
  }
  ensure(f.cancellationId===record.id&&['orderId','customerId','changeId','quoteId','contractId','archiveVersionId'].every(k=>(f[k]??null)===(pin[k]??null))&&(f.stageId??null)===stageId&&f.revision===i+1&&f.predecessorId===(previous?.id??null)&&f.predecessorHash===(previous?.factHash??null)&&f.sourceHash===record.sourceHash&&canonicalHash(body)===factHash,409,'RENEWAL_CANCELLATION_FACT_CHAIN');
 }
 ensure((record.serviceStageId??null)===stageId,409,'RENEWAL_CANCELLATION_FACT_CHAIN');
 if(!stageId&&currentPin.stageId)ensure(history.at(-1)?.kind==='REJECTED'&&preparedAt&&preparedAt>=history.at(-1).recordedAt,409,'RENEWAL_CANCELLATION_FACT_CHAIN');
 return bindingFact;
}

/** Historical signed05 authority; deliberately independent of current product/qualification readiness. */
export async function readV31CancellationSource(tx:any,changeId:string){
 const change=await tx.orderChange.findUnique({where:{id:changeId}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION',404,'NOT_FOUND');
 const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}});
 const s=assertElectronicRenewalCommercial(change,quote),contract=quote.contract,task=contract?await tx.electronicSigningTask.findUnique({where:{contractId:contract.id},include:{parties:true}}):null;
 ensure(order.contractMode==='ELECTRONIC'&&quote.status==='CONFIRMED'&&quote.confirmedAt&&s.customerAcceptance?.customerId===order.customerId&&contract?.id===s.electronicContractId&&contract.orderId===order.id&&contract.customerId===order.customerId&&contract.documentHash===quote.commercialHash&&task?.kind==='RENEWAL'&&task.orderId===order.id&&task.customerId===order.customerId&&task.businessHash===quote.commercialHash,409,'RENEWAL_CANCELLATION_SOURCE');
 const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}}),origin=await readElectronicSubscriptionOrigin(tx,order.id);
 ensure(origin.ready&&origin.contractId===change.originalContractId&&origin.versionId===change.originalArchiveVersionId&&version?.archive.orderId===order.id&&version.archive.quoteId===quote.id&&version.scopeSnapshot?.changeId===change.id&&version.scopeSnapshot?.quoteId===quote.id&&version.scopeSnapshot?.renewalSourceHash===s.sourceHash,409,'RENEWAL_CANCELLATION_SOURCE');
 const agreement=task.status==='ARCHIVED'?await requireElectronicRenewalAgreement(tx,change,quote):{mode:'ELECTRONIC',contractId:contract.id,archiveId:version.archiveId,archiveVersionId:version.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,fileManifestHash:version.fileManifestHash,taskId:task.id};
 const stage=await tx.orderServiceStage.findUnique({where:{changeId}}),account=await tx.usageAccount.findUnique({where:{orderId:order.id}});
 if(stage){
  const parsed=parseStageRow(stage,order);
  // Reconstruct only from the frozen05 and its verified archive, never current sale/identity readiness.
  const expected={version:1,kind:'RENEWAL',...(s.renewalTerms.serviceAnchor?{serviceAnchor:s.renewalTerms.serviceAnchor}:{}),identity:{serviceStageId:s.renewalTerms.serviceStageId,orderId:order.id,customerId:order.customerId,sequence:s.source.nextStageSequence,previousStageId:s.source.currentStageId,vehicleId:s.source.vehicleId,assignmentId:s.originalAssignmentId,ownerId:s.source.ownerId},
   period:{startDate:s.startDate,endDate:s.endDate,months:s.months,firstPeriodSequence:s.periods[0].sequence,lastPeriodSequence:s.periods.at(-1).sequence},termsSnapshot:s.renewalTerms,usagePricing:s.usagePricing,swapPolicy:s.swapPolicy,billingSchedule:s.periods,
   source:{originalTermsHash:canonicalHash(order.finalPlanSnapshot),product:{listingId:s.source.listingId,listingRevision:s.source.listingRevision,productVersionId:s.source.productVersionId,subscriptionPlanId:s.source.subscriptionPlanId,sourceHash:s.source.listingSourceHash},agreement:{originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:s.source.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash,changeId:change.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,approvedArchiveVersionId:agreement.archiveVersionId,approvedArchiveHash:agreement.fileManifestHash,document:s.document}}};
  ensure(quote.financePreparedAt&&quote.approvedArchiveVersionId===agreement.archiveVersionId&&canonicalHash(parsed.snapshot)===canonicalHash(expected),409,'RENEWAL_CANCELLATION_SOURCE');
 }
 ensure(account?.id===s.source.accountId,409,'RENEWAL_CANCELLATION_SOURCE');
 const pin={version:31,orderId:order.id,customerId:order.customerId,ownerId:s.source.ownerId,changeId,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,stageId:stage?.id??null,stageHash:stage?.snapshotHash??null,contractId:agreement.contractId,archiveVersionId:agreement.archiveVersionId,originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,priorTermsVersionId:change.priorTermsVersionId,startDate:s.startDate,endDate:s.endDate};
 const record=await tx.orderRenewalCancellation.findUnique({where:{quoteId:quote.id}});
 const intakePin=record?.sourceSnapshot??pin;
 if(record)ensure(intakePin.version===31&&['orderId','customerId','ownerId','changeId','quoteId'].every(k=>record[k]===(pin as any)[k])&&canonicalHash(intakePin)===record.sourceHash&&canonicalHash({...pin,stageId:intakePin.stageId,stageHash:intakePin.stageHash})===record.sourceHash&&(intakePin.stageId?intakePin.stageId===pin.stageId&&intakePin.stageHash===pin.stageHash:intakePin.stageHash===null),409,'RENEWAL_CANCELLATION_SOURCE');
 const history=record?await tx.renewalCancellationFact.findMany({where:{cancellationId:record.id},orderBy:{revision:'asc'}}):[];
 const bindingFact=assertV31FactChain(record,history,intakePin,pin,quote.financePreparedAt);
 ensure(!stage||task.status==='ARCHIVED',409,'RENEWAL_CANCELLATION_STAGE_ARCHIVE');
 return{change,order,quote,agreement,stage,account,pin,record,history,task,bindingFact,head:history.at(-1)};
}
type Source=Awaited<ReturnType<typeof readV31CancellationSource>>;
async function evidence(tx:any,ids:string[],actorId:string,customerId:string){
 const unique=[...new Set(ids)];await assertNotAssetFiles(tx,unique);const rows=await tx.storedFile.findMany({where:{id:{in:unique}}});
 ensure(rows.length===unique.length&&rows.every((f:any)=>f.purpose==='evidence'&&!f.fieldTaskId&&(f.adminId===actorId&&!f.customerId||f.customerId===customerId&&!f.adminId)&&['application/pdf','image/jpeg','image/png','audio/mpeg','audio/wav'].includes(f.mimeType)&&f.size>0&&/^[a-f0-9]{64}$/.test(f.sha256)),409,'RENEWAL_CANCELLATION_EVIDENCE','须提交本客户或本经办人原始证据文件');
 return rows.map((f:any)=>({id:f.id,sha256:f.sha256,size:f.size,mimeType:f.mimeType,customerId:f.customerId,adminId:f.adminId})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
}
async function ordinaryFactReview(tx:any,actor:any,sourceActorIds:string[]){
 const sources=[...new Set(sourceActorIds)].sort();
 if(actor.role==='ADMIN')return{policy:'ADMIN_EXCEPTION',sourceActorIds:sources};
 await assertIndependentStaffReview(tx,actor.id,sources,'RENEWAL_CANCELLATION_SELF_REVIEW');
 return{policy:'INDEPENDENT_PERSON',sourceActorIds:sources};
}
async function append(tx:any,s:Source,kind:string,payload:any,actor:any,now:Date,occurredAt=now){
 const body={id:randomUUID(),cancellationId:s.record.id,orderId:s.order.id,customerId:s.order.customerId,changeId:s.change.id,quoteId:s.quote.id,stageId:s.stage?.id??null,contractId:s.agreement.contractId,archiveVersionId:s.agreement.archiveVersionId,kind,revision:(s.head?.revision??0)+1,predecessorId:s.head?.id??null,predecessorHash:s.head?.factHash??null,sourceHash:s.record.sourceHash,payload,occurredAt,recordedAt:now,actorId:actor.id};
 const row=await tx.renewalCancellationFact.create({data:{...body,factHash:canonicalHash(body)}});
 await tx.orderRenewalCancellation.update({where:{id:s.record.id},data:{revision:{increment:1},...(kind!=='DEPENDENCY_DISPOSITION'?{lifecycleState:kind}:{})}});
 await tx.order.update({where:{id:s.order.id},data:{revision:{increment:1}}});await tx.orderChange.update({where:{id:s.change.id},data:{revision:{increment:1}}});
 await audit(tx,actor.id,'V31_RENEWAL_CANCELLATION_'+kind,'order-changes',s.change.id,{factId:row.id,factHash:row.factHash,sourceHash:row.sourceHash,...(payload.review?{review:payload.review}:{}),...(payload.stageBinding?{stageBinding:payload.stageBinding}:{})});return{factId:row.id,factHash:row.factHash,revision:row.revision,state:kind};
}
export async function cancellationDependencies(tx:any,s:Source){
 if(!s.stage)return[];
 const periods=await tx.usagePeriod.findMany({where:{serviceStageId:s.stage.id},include:{segments:true}}),credits=await tx.swapCredit.findMany({where:{serviceStageId:s.stage.id}}),handovers=await tx.handover.findMany({where:{orderId:s.order.id,actualAt:{gte:new Date(s.pin.startDate+'T00:00:00+08:00')},status:'COMPLETED'}});
 const values:any[]=[];
 const readings=await tx.mileage.findMany({where:{orderId:s.order.id,periodId:{in:periods.map((p:any)=>p.id)}}});
 for(const r of readings)values.push({kind:'MILEAGE_EVIDENCE',id:r.id,periodId:r.periodId,segmentId:r.segmentId,assignmentId:r.assignmentId,readingKm:r.readingKm,recordedAt:r.recordedAt,fileIds:r.fileIds});
 for(const p of periods){if(p.startReadingKm!==null||p.endReadingKm!==null||p.readingId||p.usedKm!==null||p.settledAt)values.push({kind:'USAGE_PERIOD',id:p.id,readingId:p.readingId,startReadingKm:p.startReadingKm,endReadingKm:p.endReadingKm,usedKm:p.usedKm,settledAt:p.settledAt});for(const seg of p.segments)if(seg.startReadingKm!==null||seg.endReadingKm!==null||seg.readingId||seg.endHandoverId)values.push({kind:'USAGE_SEGMENT',...seg});}
 for(const c of credits)if(c.consumedChangeId)values.push({kind:'CONSUMED_RIGHT',...c});
 for(const h of handovers)values.push({kind:'HANDOVER',id:h.id,type:h.type,actualAt:h.actualAt,readingKm:h.readingKm,assignmentId:h.assignmentId});
 const boundary=new Date(s.pin.startDate+'T00:00:00+08:00');
 const receipts=await tx.vehicleReceiptEvent.findMany({where:{orderId:s.order.id,receivedAt:{gte:boundary}}});
 for(const r of receipts)values.push({kind:'PHYSICAL_RECEIPT',id:r.id,handoverId:r.handoverId,assignmentId:r.assignmentId,revision:r.revision,previousEventId:r.previousEventId,receivedAt:r.receivedAt,readingKm:r.readingKm,evidenceFileIds:r.evidenceFileIds});
 const services=await tx.serviceRequest.findMany({where:{orderId:s.order.id,customerId:s.order.customerId,status:{in:['IN_PROGRESS','COMPLETED']},updatedAt:{gte:boundary}}});
 for(const r of services)values.push({kind:'SERVICE',id:r.id,entitlementId:r.entitlementId,status:r.status,revision:r.revision,createdAt:r.createdAt,updatedAt:r.updatedAt,fileIds:r.fileIds});
 const consumed=await tx.entitlementLedger.findMany({where:{orderId:s.order.id,customerId:s.order.customerId,type:'CONSUME',createdAt:{gte:boundary}}});
 for(const r of consumed)values.push({kind:'CONSUMED_SERVICE_RIGHT',...r});
 return values.sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id)).map(value=>({value,hash:canonicalHash(value)}));
}
/** All successful receipts on exact stage bills, including exceptional late provider receipts. No debt offsets. */
export async function v31RefundSources(tx:any,s:Source){
 if(!s.stage)return[];
 const bills=await tx.bill.findMany({where:{orderId:s.order.id,serviceStageId:s.stage.id},include:{payments:{orderBy:{id:'asc'},include:{refunds:{orderBy:{id:'asc'}}}}},orderBy:{id:'asc'}}),result:any[]=[];
 for(const bill of bills){ensure(bill.customerId===s.order.customerId,409,'RENEWAL_CANCELLATION_MONEY_SOURCE');for(const p of bill.payments){
  ensure(p.customerId===s.order.customerId&&p.billId===bill.id&&Number.isSafeInteger(p.amount)&&p.amount>0,409,'RENEWAL_CANCELLATION_MONEY_SOURCE');
  if(p.status!=='SUCCEEDED')continue;
  ensure(p.providerTransactionId&&p.succeededAt,409,'RENEWAL_CANCELLATION_MONEY_SOURCE');let refundedAmount=0;
  const reviews=await tx.paymentReconciliation.findMany({where:{paymentId:p.id},orderBy:{id:'asc'}}),receipt={paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,status:p.status};
  const reconciliationResolved=!p.reconciliationRequired&&!reviews.some((r:any)=>r.status==='SUBMITTED')&&(!p.reconciliationReason||reviews.some((r:any)=>r.status==='APPROVED'&&r.resolution==='REFUNDED'&&r.reviewedBy&&r.reviewedBy!==r.submittedBy&&r.reviewedAt&&r.evidenceFileIds.length&&canonicalHash(r.paymentSnapshot)===canonicalHash(receipt)));
  for(const r of p.refunds){ensure(r.paymentId===p.id&&r.customerId===p.customerId&&Number.isSafeInteger(r.amount)&&r.amount>0,409,'RENEWAL_CANCELLATION_MONEY_SOURCE');if(r.status==='SUCCEEDED'){ensure(hasRefundReceipt(r)&&r.succeededAt,409,'RENEWAL_CANCELLATION_MONEY_SOURCE');refundedAmount+=normalRefundAmount(r);}}
  ensure(refundedAmount<=p.amount,409,'RENEWAL_CANCELLATION_MONEY_SOURCE');
  result.push({paymentId:p.id,billId:bill.id,stageId:s.stage.id,cancellationId:s.record?.id??null,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,succeededAt:p.succeededAt,reconciliationResolved,reconciliationReviews:reviews,cash:refundCashState(p.refunds),refundedAmount,remainingAmount:p.amount-refundedAmount,refunds:p.refunds.map((r:any)=>({id:r.id,amount:r.amount,status:r.status,requestedBy:r.requestedBy,approvedBy:r.approvedBy,...(r.duplicateReceipt?{normalAmount:normalRefundAmount(r),duplicateReceipt:r.duplicateReceipt}:{}),method:r.method??'WECHAT_ORIGINAL',receiptIdentity:refundReceiptIdentity(r),providerRefundId:r.providerRefundId,succeededAt:r.succeededAt})),route:'ORIGINAL',oldDebtOffsetAmount:0});
 }}return result.sort((a,b)=>a.paymentId.localeCompare(b.paymentId));
}
export async function v31CancellationView(tx:any,s:Source){
 const verified=s.history.find((f:any)=>f.kind==='VERIFIED'),corrected=s.history.find((f:any)=>f.kind==='CORRECTED');
 const refundSources=await v31RefundSources(tx,s),dependencies=await cancellationDependencies(tx,s),dispositions=s.history.filter((f:any)=>f.kind==='DEPENDENCY_DISPOSITION');
 const dependencyViews=await Promise.all(dependencies.map(async d=>({...d,financialSettlement:s.record?await readDependencySettlement(tx,s.record,d.hash):null,disposition:dispositions.filter((f:any)=>f.payload.dependencyHash===d.hash).at(-1)?.payload??null})));
 const pendingPayments=s.stage?await tx.payment.count({where:{bill:{serviceStageId:s.stage.id},status:{in:['CREATING','PENDING']}}}):0;
 const signingUnresolved=s.task.status!=='ARCHIVED'&&s.task.parties.some((p:any)=>p.attemptedAt)&&s.task.stopStatus!=='PROVIDER_CLOSED';
 const financialSourceHash=canonicalHash({cancellationId:s.record?.id??null,verifiedHash:verified?.factHash??null,correctionHash:corrected?.factHash??null,refundSources,dependencies:dependencyViews,dispositions:dispositions.map((f:any)=>f.factHash),pendingPayments,signingUnresolved});
 const ready=!!corrected&&!pendingPayments&&!signingUnresolved&&refundSources.every(p=>p.reconciliationResolved&&p.remainingAmount===0&&!p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))&&p.refunds.filter((r:any)=>r.status==='SUCCEEDED').every((r:any)=>r.approvedBy&&r.requestedBy!==r.approvedBy))&&dependencyViews.every(d=>
  d.disposition?.disposition==='NO_SEPARATE_LIABILITY'&&!d.financialSettlement||d.disposition?.disposition==='SEPARATELY_SETTLED'&&d.financialSettlement?.ready&&d.financialSettlement.sourceHash===d.disposition.financialBillHash);
 const closed=s.history.filter((f:any)=>f.kind==='FINANCE_CLOSED').at(-1);
 return{
  orderId:s.order.id,source:{customerId:s.pin.customerId,ownerId:s.pin.ownerId,startDate:s.pin.startDate,endDate:s.pin.endDate},businessSourceHash:canonicalHash(s.pin),changeId:s.change.id,revision:s.head?.revision??0,headId:s.head?.id??null,headHash:s.head?.factHash??null,
  intakeSourceHash:s.record?.sourceHash??null,stageBinding:s.record?.sourceSnapshot?.stageId===null&&s.stage?{status:s.bindingFact?'BOUND':'AVAILABLE',stageId:s.stage.id,stageHash:s.stage.snapshotHash,sourceHash:canonicalHash(s.pin),intakeSourceHash:s.record.sourceHash,factId:s.bindingFact?.id??null,factHash:s.bindingFact?.factHash??null}:null,
  cancellationId:s.record?.id??null,state:s.record?.lifecycleState??null,stageId:s.stage?.id??null,stageStatus:s.stage?.status??null,
  original05:{contractId:s.agreement.contractId,archiveVersionId:s.agreement.archiveVersionId},
  agreedAt:verified?.occurredAt.toISOString()??null,verifiedAt:verified?.recordedAt.toISOString()??null,correctedAt:corrected?.recordedAt.toISOString()??null,
  refundSources,financialSourceHash,financialStatus:ready?(closed?.payload.financialSourceHash===financialSourceHash?'CLOSED':'READY_TO_CLOSE'):'UNRESOLVED',pendingPayments,signingUnresolved,
  oldDebtOffsetAmount:0,dependencies:dependencyViews,
  history:s.history.map((f:any)=>({id:f.id,kind:f.kind,stageId:f.stageId,sourceHash:f.sourceHash,revision:f.revision,factHash:f.factHash,predecessorId:f.predecessorId,occurredAt:f.occurredAt,recordedAt:f.recordedAt,actorId:f.actorId})),
 };
}
export async function readV31CancellationFile(tx:any,changeId:string,fileId:string,actor?:any,customerId?:string){
 if(actor){await cancellationPermission(tx,actor,'operations');}else{const c=await tx.orderChange.findUnique({where:{id:changeId}});ensure(customerId&&c?.customerId===customerId,404,'NOT_FOUND');}
 const s=await readV31CancellationSource(tx,changeId),claims=s.history.filter((f:any)=>f.kind==='CLAIM'),proof=claims.flatMap((f:any)=>f.payload.evidence).find((e:any)=>e.id===fileId);
 ensure(proof&&(!customerId||claims.some((f:any)=>f.payload.claim.customer.fileIds.includes(fileId))),404,'NOT_FOUND');
 const file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(file&&file.sha256===proof.sha256&&file.size===proof.size&&file.purpose==='evidence',409,'RENEWAL_CANCELLATION_EVIDENCE');await assertNotAssetFiles(tx,[fileId]);return file;
}
export async function v31Cancellation(tx:any,changeId:string,action:string,raw:any,actor:any,now:Date){
 await cancellationPermission(tx,actor,action==='read'?'read':['close-finance','request-refund'].includes(action)||action==='dispose-dependency'&&raw?.disposition==='SEPARATELY_SETTLED'?'finance':'operations');
 if(action==='read'){const s=await readV31CancellationSource(tx,changeId);return{...await v31CancellationView(tx,s),signing:{taskId:s.task.id,status:s.task.status,stopStatus:s.task.stopStatus,legalCompletedAt:s.task.legalCompletedAt,archivedAt:s.task.archivedAt},...(['ADMIN','OPERATIONS'].includes(actor.role)?{claims:s.history.filter((f:any)=>f.kind==='CLAIM').map((f:any)=>({factId:f.id,factHash:f.factHash,...f.payload}))}:{})};}
 ensure(Object.hasOwn(schemas,action),404,'NOT_FOUND');const input=(schemas as any)[action].parse(raw);
 return cancellationCommand(tx,actor,changeId,'V31_'+action,input,async()=>{
  const s=await readV31CancellationSource(tx,changeId);ensure(input.businessSourceHash===canonicalHash(s.pin)&&input.revision===(s.head?.revision??0)&&input.headId===(s.head?.id??null)&&input.headHash===(s.head?.factHash??null),409,'VERSION_CONFLICT');
  if(action==='claim'){
   ensure(!s.record||['CLAIM','NEED_MORE','REJECTED'].includes(s.record.lifecycleState),409,'RENEWAL_CANCELLATION_STATE');
   const c=input.claim,a=c.lessor,agreedAt=new Date(Math.max(Date.parse(c.customer.occurredAt),Date.parse(a.occurredAt))),start=new Date(s.pin.startDate+'T00:00:00+08:00');
   ensure(!await tx.adminUser.findUnique({where:{id:a.personReference}}),409,'RENEWAL_CANCELLATION_LESSOR_AUTHORITY','平台岗位身份不能替代实际出租方授权身份');
   ensure(c.customer.subjectId===s.order.customerId&&a.ownerId===s.pin.ownerId&&Date.parse(a.authorityFrom)<=Date.parse(a.occurredAt)&&Date.parse(a.authorityUntil)>=Date.parse(a.occurredAt)&&agreedAt<start&&agreedAt<=now,409,'RENEWAL_CANCELLATION_BILATERAL_EVIDENCE','须有客户与实际出租方有权人员在新期前的真实合意和权限证据');
   const proof=await evidence(tx,[...c.customer.fileIds,...a.fileIds,...a.authorityFileIds],actor.id,s.order.customerId);
   // A joint PDF may carry both intentions and separately identified authority proof.
   // Nonempty role-specific references, actual identity/scope/times and verification remain mandatory.
   if(!s.record)s.record=await tx.orderRenewalCancellation.create({data:{orderId:s.order.id,customerId:s.order.customerId,ownerId:s.pin.ownerId,changeId,quoteId:s.quote.id,serviceStageId:s.stage?.id??null,sourceSnapshot:s.pin,sourceHash:canonicalHash(s.pin),reason:c.note,createdBy:actor.id}});
   let stageBinding;
   if(!s.record.serviceStageId&&s.stage){
    ensure(s.head?.kind==='REJECTED'&&s.quote.financePreparedAt<=now,409,'RENEWAL_CANCELLATION_FACT_CHAIN');
    stageBinding=preparedStageBinding(s.record,s.pin,s.head,s.quote.financePreparedAt);
    // Projection and its immutable proof commit together; original intake snapshot/hash are never replaced.
    s.record=await tx.orderRenewalCancellation.update({where:{id:s.record.id},data:{serviceStageId:s.stage.id}});
   }
   return append(tx,s,'CLAIM',{claim:c,evidence:proof,...(stageBinding?{stageBinding}:{})},actor,now,agreedAt);
  }
  ensure(s.record,409,'RENEWAL_CANCELLATION_STATE');
  if(action==='verify'){
   ensure(s.head?.kind==='CLAIM',409,'RENEWAL_CANCELLATION_STATE');const p=s.head.payload;
   // The reviewer verifies both original intentions and authority; their own platform role is never lessor consent.
   const stored=await tx.storedFile.findMany({where:{id:{in:p.evidence.map((f:any)=>f.id)}}});ensure(stored.length===p.evidence.length&&stored.every((f:any)=>p.evidence.some((e:any)=>e.id===f.id&&e.sha256===f.sha256&&e.size===f.size)),409,'RENEWAL_CANCELLATION_EVIDENCE');
   const review=await ordinaryFactReview(tx,actor,[s.head.actorId,...p.evidence.map((f:any)=>f.adminId).filter(Boolean)]);
   return append(tx,s,input.decision,{claimId:s.head.id,claimHash:s.head.factHash,note:input.note,review},actor,now,s.head.occurredAt);
  }
  if(action==='correct'){
   ensure(s.record.lifecycleState==='VERIFIED'&&s.head.kind==='VERIFIED',409,'RENEWAL_CANCELLATION_STATE');return correctRenewalAfterLateAgreement(tx,s,actor,now);
  }
  ensure(['CORRECTED','FINANCE_CLOSED'].includes(s.record.lifecycleState),409,'RENEWAL_CANCELLATION_STATE');
  const view=await v31CancellationView(tx,s);
  if(action==='request-refund'){
   ensure(view.financialSourceHash===input.sourceHash,409,'PREVIEW_CHANGED');const p=view.refundSources.find((p:any)=>p.paymentId===input.paymentId);
   ensure(p&&p.remainingAmount>0&&!p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)),409,'RENEWAL_CANCELLATION_REFUND_SOURCE');
   const refund=await tx.refund.create({data:{paymentId:p.paymentId,customerId:s.order.customerId,amount:p.remainingAmount,reason:input.note,status:'PENDING_APPROVAL',requestedBy:actor.id,idempotencyKey:input.idempotencyKey,renewalCancellationId:s.record.id,renewalCancellationOrderId:s.order.id,renewalCancellationStageId:s.stage.id,renewalCancellationBillId:p.billId}});
   await audit(tx,actor.id,'V31_RENEWAL_CANCELLATION_REFUND_REQUEST','refunds',refund.id,{cancellationId:s.record.id,verifiedFactId:s.history.find((f:any)=>f.kind==='VERIFIED').id,financialSourceHash:view.financialSourceHash,paymentId:p.paymentId,amount:p.remainingAmount});
   return{refundId:refund.id,amount:refund.amount,status:refund.status};
  }
  if(action==='dispose-dependency'){
   const d=view.dependencies.find(d=>d.hash===input.dependencyHash);ensure(d,409,'RENEWAL_CANCELLATION_DEPENDENCY_SOURCE');
   const responsible=await tx.adminUser.findUnique({where:{id:input.responsibleStaffId}});ensure(responsible&&responsible.active!==false&&['ADMIN','FINANCE','OPERATIONS'].includes(responsible.role)&&new Date(input.dueAt)>now,409,'RENEWAL_CANCELLATION_DEPENDENCY_OWNER');
   const proof=await evidence(tx,input.evidenceFileIds,actor.id,s.order.customerId);
   if(input.disposition==='SEPARATELY_SETTLED'){await cancellationPermission(tx,actor,'finance');ensure(d.financialSettlement?.ready&&d.financialSettlement.billId===input.financialBillId&&d.financialSettlement.sourceHash===input.financialBillHash,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');}
   let review:any;
   if(input.disposition==='NO_SEPARATE_LIABILITY'){
    ensure(!d.financialSettlement,409,'RENEWAL_DEPENDENCY_FINANCIAL_SOURCE');
    review=await ordinaryFactReview(tx,actor,[...s.history.filter((f:any)=>f.kind==='CLAIM'||f.kind==='DEPENDENCY_DISPOSITION'&&f.payload.dependencyHash===d.hash).map((f:any)=>f.actorId),d.value.actorId,d.value.createdBy].filter(Boolean));
   }
   return append(tx,s,'DEPENDENCY_DISPOSITION',{dependencyHash:d.hash,disposition:input.disposition,...(input.disposition==='SEPARATELY_SETTLED'?{financialBillId:input.financialBillId,financialBillHash:input.financialBillHash}:{}),...(review?{review}:{}),responsibleStaffId:responsible.id,dueAt:input.dueAt,evidence:proof,note:input.note},actor,now);
  }
  ensure(view.financialSourceHash===input.sourceHash&&view.financialStatus==='READY_TO_CLOSE',409,'RENEWAL_CANCELLATION_FINANCE_UNRESOLVED');
  return append(tx,s,'FINANCE_CLOSED',{financialSourceHash:view.financialSourceHash,refundSources:view.refundSources,note:input.note},actor,now);
 });
}

/** Called only under Order→Account→stages→change→quote→case→bill→payment locks and a verified append-only fact. */
export async function correctRenewalAfterLateAgreement(tx:any,s:Source,actor:any,now:Date){
 const dependencies=await cancellationDependencies(tx,s),before={stage:s.stage,orderTermsVersionId:s.order.effectiveTermsVersionId},stage=s.stage;
 if(stage){
  ensure(['PREPARED','SCHEDULED','ACTIVE'].includes(stage.status),409,'RENEWAL_CANCELLATION_STAGE');
  ensure(!await tx.orderServiceStage.count({where:{previousStageId:stage.id,status:{not:'VOIDED'}}}),409,'RENEWAL_CANCELLATION_FOLLOWING_STAGE');
  ensure(!stage.termsVersionId||s.order.effectiveTermsVersionId===stage.termsVersionId,409,'RENEWAL_CANCELLATION_FOLLOWING_TERMS');
  const periods=await tx.usagePeriod.findMany({where:{serviceStageId:stage.id},include:{segments:true}});
  for(const p of periods)if(!dependencies.some(d=>d.value.id===p.id||d.value.periodId===p.id||p.segments.some((seg:any)=>seg.id===d.value.id))){
   await tx.usagePeriod.update({where:{id:p.id},data:{status:'CANCELLED',reviewNote:'V31真实期前取消；空自动期间纠正',revision:{increment:1}}});
   await tx.usageSegment.updateMany({where:{periodId:p.id},data:{status:'FROZEN',frozenHash:canonicalHash({cancellationId:s.record.id,verifiedFactId:s.head.id}),revision:{increment:1}}});
  }
  const credits=await tx.swapCredit.findMany({where:{serviceStageId:stage.id,source:'FREE',consumedChangeId:null}});
  for(const c of credits){const reservations=await tx.swapReservation.findMany({where:{creditId:c.id,status:'RESERVED'}});for(const r of reservations){await tx.swapReservation.update({where:{id:r.id},data:{status:'RELEASED'}});await tx.swapLedger.create({data:{orderId:s.order.id,creditId:c.id,changeId:r.changeId,source:'FREE',type:'RELEASE',sourceKey:'release:'+r.id}});}await tx.swapCredit.update({where:{id:c.id},data:{status:'EXPIRED'}});await tx.swapLedger.create({data:{orderId:s.order.id,creditId:c.id,source:'FREE',type:'EXPIRE',sourceKey:'v31-cancel:'+s.record.id+':'+c.id}});}
  await tx.bill.updateMany({where:{serviceStageId:stage.id,status:{in:['DRAFT','REVIEWED','PENDING']}},data:{status:'VOID'}});
  const obligations=await tx.serviceObligation.findMany({where:{serviceStageId:stage.id}});await tx.paymentAllocation.updateMany({where:{obligationId:{in:obligations.map((o:any)=>o.id)},releasedAt:null},data:{releasedAt:now}});await tx.serviceObligation.updateMany({where:{serviceStageId:stage.id},data:{active:false}});
  await tx.orderServiceStage.update({where:{id:stage.id},data:{status:'VOIDED',voidedAt:now,voidedBy:actor.id,voidReason:'V31真实期前双方合意：'+s.head.id,revision:{increment:1}}});
  if(stage.termsVersionId)await tx.order.update({where:{id:s.order.id},data:{effectiveTermsVersionId:s.change.priorTermsVersionId}});
  await tx.usageAccount.update({where:{id:s.account.id},data:{revision:{increment:1}}});
 }
 await tx.orderChange.update({where:{id:s.change.id},data:{status:'CANCELLED'}});
 if(s.task.status!=='ARCHIVED'){
  await tx.$queryRaw`SELECT id FROM "ElectronicSigningTask" WHERE id=${s.task.id} FOR UPDATE`;
  await tx.electronicSigningTask.update({where:{id:s.task.id},data:{status:'WITHDRAWN',withdrawnAt:s.task.withdrawnAt??now,stopStatus:s.task.parties.some((p:any)=>p.attemptedAt)?'NEEDS_REVIEW':'STOPPED_LOCAL_ONLY',revision:{increment:1},processingToken:null,processingUntil:null}});
 }
 return append(tx,s,'CORRECTED',{verifiedFactId:s.head.id,verifiedFactHash:s.head.factHash,before,dependencies,refundSources:await v31RefundSources(tx,s),oldDebtOffsetAmount:0},actor,now);
}

/** Proves why a historical technical terms node is excluded from the effective chain. */
export async function requireV31CorrectedTerms(tx:any,changeId:string,version:any){
 const s=await readV31CancellationSource(tx,changeId),f=s.history.find((f:any)=>f.kind==='CORRECTED');
 ensure(f&&s.stage?.status==='VOIDED'&&s.stage.termsVersionId===version.id&&s.change.status==='CANCELLED'&&f.payload.before.orderTermsVersionId===version.id&&f.payload.before.stage.snapshotHash===s.stage.snapshotHash&&version.hash===s.quote.commercialHash&&canonicalHash(version.snapshot)===canonicalHash(s.quote.snapshot.renewalTerms),409,'RENEWAL_CANCELLATION_CORRECTION_SOURCE');return s;
}


