import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {AgreementFactError,agreementInstant,assertHistoricalPreparedQuote,assertOfflineContract,frozenVehicleId,offlineChangeScope} from '../order-changes/agreement-facts';
import {readServiceStage} from '../order-service-stages/readiness';
import {parseStageRow} from '../order-service-stages/source';
import type {StageSnapshotV1} from '../order-service-stages/types';
import {assertApproval} from '../offline-documents/review';
import {archivePrintConfirmed} from '../offline-documents/archive-workflow';
import {assertNotAssetFiles} from '../files/asset-files';
import {assertRenewalCancellationTiming} from './cancellation-timing';
import {readRenewalCancellationPaper,cancellationScope,renderRenewalCancellationBody} from './cancellation-paper';
import {renewalId} from './types';
import type {PreparedRenewalSource} from './source';

const same=(a:any,b:any)=>a!==undefined&&b!==undefined&&canonicalHash(a)===canonicalHash(b);
const id=(v:any)=>typeof v==='string'&&!!v.trim()&&!v.includes('\0');
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const instant=(v:any)=>Number.isFinite(agreementInstant(v));
function fact(v:unknown,message='已完成续期取消的冻结来源不完整或不一致'):asserts v{ensure(v,409,'RENEWAL_CANCELLATION_HISTORY_SOURCE',message);}
const include={versions:{include:{files:{include:{file:true}},feedback:true}}};

/** Verifies the original immutable archived version, without requiring it to remain today's approved pin. */
async function historicalPin(tx:any,a:any,v:any,businessHash:string,parties:any[],scope:any){
 fact(a&&v&&v.archiveId===a.id&&['ARCHIVED','INVALIDATED'].includes(v.status)&&v.businessSnapshotHash===businessHash&&same(v.scopeSnapshot,scope));
 const roles=['CUSTOMER','OWNER','PLATFORM'];fact(Array.isArray(v.requiredSigners)&&v.requiredSigners.length===3&&roles.every(r=>v.requiredSigners.includes(r))&&Array.isArray(v.partiesSnapshot)&&v.partiesSnapshot.length===3&&roles.every(r=>v.partiesSnapshot.filter((p:any)=>p.role===r&&p.partyId===parties.find(p=>p.role===r)?.partyId).length===1));
 fact(id(v.sourceFileId)&&id(v.submittedBy)&&id(v.reviewedBy)&&instant(v.submittedAt)&&instant(v.reviewedAt)&&agreementInstant(v.reviewedAt)>=agreementInstant(v.submittedAt)&&id(v.signedOn)&&id(v.contractNumber)&&Array.isArray(v.files)&&v.files.length>0&&Array.isArray(v.partyChecks));
 // The approval validator checks the original review facts; no stored status is changed.
 assertApproval({...v,status:'REVIEWED'},{checklist:v.reviewChecklist,partyChecks:v.partyChecks,reason:v.reviewReason},v.reviewedBy,businessHash);
 const file=await tx.storedFile.findUnique({where:{id:v.sourceFileId}});fact(file?.id===v.sourceFileId&&file.purpose==='offline-source'&&file.mimeType==='application/pdf'&&Number.isSafeInteger(file.size)&&file.size>0&&digest(file.sha256));
 await assertNotAssetFiles(tx,[v.sourceFileId,...v.files.map((f:any)=>f.fileId)]);fact(await archivePrintConfirmed(tx,a,v),'历史纸档缺少对应原打印确认');
 return v;
}

/** Only the real prefix referenced by this cancelled quote; later agreements and today's paper pins are irrelevant. */
async function historicalPrior(tx:any,order:any,change:any,parties:any[]){
 const original=await tx.contract.findUnique({where:{id:change.originalContractId}});fact(original&&original.orderId===order.id&&original.customerId===order.customerId&&['RENTAL','SUBSCRIPTION'].includes(original.kind)&&!original.delayQuoteId&&original.documentHash===order.finalPlanSnapshot.commercialHash);assertOfflineContract(original);
 const archive=await tx.documentArchive.findUnique({where:{id:original.offlineArchiveId},include}),version=archive?.versions?.find((v:any)=>v.id===change.originalArchiveVersionId),ownerId=parties.find(p=>p.role==='OWNER')?.partyId;
 fact(archive?.kind==='RENTAL'&&archive.subjectType==='ORDER'&&archive.subjectId===order.id&&archive.orderId===order.id&&archive.ownerId===ownerId&&!archive.quoteId&&!archive.handoverId&&!archive.renewalCancellationId&&version?.scopeSnapshot?.vehicleId===frozenVehicleId(order.finalPlanSnapshot));
 await historicalPin(tx,archive,version,order.finalPlanSnapshot.commercialHash,parties,version.scopeSnapshot);
 let prior=order.finalPlanSnapshot,priorId:string|null=null;
 if(change.priorTermsVersionId){
  const all=await tx.orderTermsVersion.findMany({where:{orderId:order.id},orderBy:{version:'asc'},include:{quote:{include:{change:true,contract:true}}}}),end=all.find((t:any)=>t.id===change.priorTermsVersionId);fact(end&&Number.isInteger(end.version)&&end.version>0);
  const prefix=all.filter((t:any)=>t.version<=end.version).sort((a:any,b:any)=>a.version-b.version);fact(prefix.length===end.version);
  for(let i=0;i<prefix.length;i++){
   const t=prefix[i],q=t.quote,c=q?.change,contract=q?.contract;
   fact(t.version===i+1&&t.orderId===order.id&&q?.id===t.quoteId&&c?.status==='APPLIED'&&c.orderId===order.id&&c.customerId===order.customerId&&c.originalContractId===original.id&&c.originalArchiveVersionId===version.id&&(c.priorTermsVersionId??null)===priorId&&c.priorTermsHash===hash(prior)&&same(c.priorTerms,prior));
   assertHistoricalPreparedQuote(c,q,contract,order);assertOfflineContract(contract);
   fact(t.hash===q.commercialHash&&t.snapshot?.commercialHash===t.hash&&t.snapshot.amendmentContractId===contract.id&&t.offlineArchiveVersionId===q.approvedArchiveVersionId);
   if(c.kind==='SUBSCRIPTION_EXTENSION')fact(same(t.snapshot,q.snapshot.renewalTerms));
   const a=await tx.documentArchive.findUnique({where:{id:contract.offlineArchiveId},include}),v=a?.versions?.find((v:any)=>v.id===t.offlineArchiveVersionId);
   fact(a?.kind==='ORDER_AMENDMENT'&&a.subjectType==='ORDER_CHANGE_QUOTE'&&a.subjectId===q.id&&a.quoteId===q.id&&a.orderId===order.id&&a.ownerId===ownerId&&!a.handoverId&&!a.renewalCancellationId&&v?.templateId===q.snapshot.document.id&&v.templateVersion===q.snapshot.document.version);
   await historicalPin(tx,a,v,q.commercialHash,parties,offlineChangeScope(c,q,contract));prior=t.snapshot;priorId=t.id;
  }
 }
 fact(priorId===(change.priorTermsVersionId??null)&&same(prior,change.priorTerms)&&hash(prior)===change.priorTermsHash);
}

export type CompletedRenewalCancellationSource={record:any;order:any;change:any;quote:any;contract:any;stage:Record<string,any>|null;snapshot:StageSnapshotV1|null;completion:any;frozenQuoteSource:any;preparedSource:PreparedRenewalSource|null};

async function completedSource(tx:any,changeId:string):Promise<CompletedRenewalCancellationSource>{
 const change=await tx.orderChange.findUnique({where:{id:renewalId.parse(changeId)}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION',404,'NOT_FOUND','续期变更不存在');
 fact(change.status==='CANCELLED'&&id(change.activeQuoteId));
 const record=await tx.orderRenewalCancellation.findUnique({where:{quoteId:change.activeQuoteId}}),order=await tx.order.findUnique({where:{id:change.orderId}});
 fact(record?.status==='COMPLETED'&&order?.contractMode==='OFFLINE'&&record.orderId===order.id&&record.customerId===order.customerId&&change.customerId===order.customerId&&record.changeId===change.id&&record.quoteId===change.activeQuoteId&&id(record.completedBy)&&instant(record.completedAt));
 const opening=record.sourceSnapshot,completion=record.completionSnapshot,frozen=opening?.facts?.frozenQuoteSource;
 fact(opening?.version===1&&opening.facts?.version===1&&digest(record.sourceHash)&&canonicalHash(opening)===record.sourceHash&&completion?.version===1&&completion.sourceHash===record.sourceHash&&digest(record.completionHash)&&canonicalHash(completion)===record.completionHash&&same(completion.facts?.frozenQuoteSource,frozen)&&agreementInstant(completion.completedAt)===agreementInstant(record.completedAt));
 const quote=await tx.delayQuote.findUnique({where:{id:record.quoteId},include:{contract:true}}),contract=quote?.contract;
 fact(quote?.status==='CONFIRMED'&&quote.changeId===change.id&&frozen?.orderId===order.id&&frozen.customerId===order.customerId&&frozen.changeId===change.id&&frozen.quoteId===quote.id&&frozen.quoteRevision===quote.revision&&frozen.commercialHash===quote.commercialHash);
 const {paper}=await readRenewalCancellationPaper(tx,record.id);fact(paper.identity.ownerId===record.ownerId&&paper.identity.quoteId===quote.id&&paper.identity.stageId===(record.serviceStageId??null));
 await historicalPrior(tx,order,change,paper.parties);assertOfflineContract(contract);fact(id(quote.createdBy)&&id(quote.reviewedBy)&&quote.createdBy!==quote.reviewedBy);
 const s=quote.snapshot,previousStage=await readServiceStage(tx,order,s.source.currentStageId),account=await tx.usageAccount.findUnique({where:{orderId:order.id}}),assignment=await tx.vehicleAssignment.findUnique({where:{id:s.originalAssignmentId}}),vehicle=await tx.vehicle.findUnique({where:{id:s.source.vehicleId}});
 fact(['ACTIVE','ENDED'].includes(previousStage.stage.status)&&previousStage.stage.snapshotHash===s.source.currentStageHash&&previousStage.snapshot.period.endDate===s.startDate&&previousStage.snapshot.identity.sequence<s.source.nextStageSequence&&previousStage.snapshot.period.lastPeriodSequence<s.periods[0].sequence);
 fact(previousStage.snapshot.kind==='INITIAL'?!Object.hasOwn(change.priorTerms,'serviceStageId'):change.priorTerms.serviceStageId===previousStage.stage.id);
 fact(account?.id===s.source.accountId&&account.orderId===order.id&&account.customerId===order.customerId&&assignment?.id===s.originalAssignmentId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===s.source.vehicleId&&['ACTIVE','CLOSED'].includes(assignment.status)&&instant(assignment.startAt)&&agreementInstant(assignment.startAt)<=agreementInstant(quote.confirmedAt)&&vehicle?.id===s.source.vehicleId);
 const delivery=assignment.deliveryHandoverId?await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}):null;
 fact(delivery?.id===assignment.deliveryHandoverId&&delivery.orderId===order.id&&delivery.customerId===order.customerId&&delivery.vehicleId===assignment.vehicleId&&delivery.assignmentId===assignment.id&&['DELIVERY','SWAP_DELIVERY'].includes(delivery.type)&&delivery.status==='COMPLETED'&&instant(delivery.actualAt)&&instant(delivery.completedAt)&&agreementInstant(delivery.actualAt)===agreementInstant(assignment.startAt));
 const funding=completion.funding,signature=completion.signature;
 fact(same(funding,completion.facts?.observed?.funding)&&same(completion.signatureHistory,completion.facts?.observed?.signature)&&funding?.fundsClear===true&&funding.remainingRefundAmount===0&&Number.isSafeInteger(funding.receivedAmount)&&funding.receivedAmount>=0&&funding.refundedAmount===funding.receivedAmount&&Array.isArray(funding.blockers)&&funding.blockers.length===0&&Array.isArray(funding.payments)&&Array.isArray(funding.bills)&&Array.isArray(funding.obligations));
 fact(signature&&['SIGNED','UNSIGNED'].includes(signature.state)&&signature.state===record.signatureState&&signature.verifiedBy===record.signatureVerifiedBy&&agreementInstant(signature.verifiedAt)===agreementInstant(record.signatureVerifiedAt)&&signature.note===record.signatureNote&&Array.isArray(signature.evidence)&&signature.evidence.length>0&&same(signature.evidence.map((e:any)=>e.fileId).sort(),[...record.signatureEvidenceFileIds].sort()));
 const signatureFiles=await tx.storedFile.findMany({where:{id:{in:record.signatureEvidenceFileIds}}});fact(signatureFiles.length===signature.evidence.length&&signature.evidence.every((e:any)=>signatureFiles.some((f:any)=>f.id===e.fileId&&f.sha256===e.sha256&&f.size===e.size&&f.mimeType===e.mimeType&&f.purpose==='evidence'&&f.adminId&&!f.customerId&&!f.fieldTaskId)));await assertNotAssetFiles(tx,record.signatureEvidenceFileIds);
 const mutual=await assertRenewalCancellationTiming(tx,record,paper.renewal.startDate,new Date(record.completedAt));fact(mutual&&same(mutual,completion.facts?.observed?.mutualAgreementProof),'已完成取消缺少原双方期前互认证据');
 if(signature.state==='SIGNED'){
  fact(completion.agreement&&id(record.terminationArchiveId)&&id(record.approvedArchiveVersionId)&&digest(record.terminationArchiveHash));
  const archive=await tx.documentArchive.findUnique({where:{id:record.terminationArchiveId},include}),v=archive?.versions?.find((v:any)=>v.id===record.approvedArchiveVersionId);
  fact(archive?.kind==='RENEWAL_CANCELLATION'&&archive.subjectType==='ORDER_RENEWAL_CANCELLATION'&&archive.subjectId===record.id&&archive.renewalCancellationId===record.id&&archive.orderId===order.id&&archive.ownerId===record.ownerId&&!archive.quoteId&&!archive.handoverId&&v?.scopeSnapshot&&same(v.scopeSnapshot.source,cancellationScope(record,paper)));
  const d=v.scopeSnapshot.document,template=await tx.legalDocument.findUnique({where:{id:v.templateId}});
  fact(d&&d.templateId===v.templateId&&d.templateVersion===v.templateVersion&&d.bodyHash===hash(d.content)&&template?.type==='OFFLINE_RENEWAL_CANCELLATION'&&template.version===v.templateVersion&&template.confirmedBy&&instant(template.confirmedAt)&&hash(template.content)===d.templateHash&&renderRenewalCancellationBody(template.content,paper)===d.content);
  await historicalPin(tx,archive,v,record.sourceHash,paper.parties,v.scopeSnapshot);
  const bound={archiveId:archive.id,archiveVersionId:v.id,fileManifestHash:v.fileManifestHash,businessHash:record.sourceHash,scopeHash:canonicalHash(v.scopeSnapshot)},agreement={...bound,terminationArchiveHash:canonicalHash(bound)};
  fact(same(agreement,completion.agreement)&&record.terminationArchiveHash===agreement.terminationArchiveHash);
 }else fact(record.terminationArchiveId==null&&record.approvedArchiveVersionId==null&&record.terminationArchiveHash==null&&completion.agreement===null&&completion.signatureHistory.canDeclareUnsigned===true&&!completion.signatureHistory.hasHistoricalSignedUpload&&!completion.signatureHistory.hasCancellationSignedUpload);
 let stage:Record<string,any>|null=null,snapshot:StageSnapshotV1|null=null,preparedSource:PreparedRenewalSource|null=null;
 const stages=await tx.orderServiceStage.findMany({where:{OR:[{changeId:change.id},{quoteId:quote.id}]}});
 if(record.serviceStageId){
  fact(stages.length===1&&stages[0].id===record.serviceStageId);stage=stages[0];fact(stage!.status==='VOIDED'&&stage!.activatedAt==null&&stage!.activatedBy==null&&stage!.termsVersionId==null&&stage!.orderId===order.id&&stage!.customerId===order.customerId&&stage!.ownerId===record.ownerId&&stage!.changeId===change.id&&stage!.quoteId===quote.id&&agreementInstant(stage!.voidedAt)===agreementInstant(record.completedAt)&&stage!.voidedBy===record.completedBy);
  fact(await tx.usagePeriod.count({where:{serviceStageId:stage!.id}})===0,'已出现真实新期使用，不能使用未开始取消历史来源');
  const parsed=parseStageRow(stage,order);snapshot=parsed.snapshot;const a=snapshot.source.agreement;
  assertHistoricalPreparedQuote(change,quote,contract,order);
  fact(stage!.snapshotHash===completion.facts.observed.stage?.snapshotHash&&stage!.id===completion.facts.observed.stage?.id&&completion.facts.observed.stage?.revision<stage!.revision&&same(snapshot.termsSnapshot,s.renewalTerms)&&same(snapshot.billingSchedule,s.periods)&&same(snapshot.usagePricing,s.usagePricing)&&same(snapshot.swapPolicy,s.swapPolicy));
  fact(a.originalContractId===frozen.original.contractId&&a.originalArchiveVersionId===frozen.original.archiveVersionId&&a.originalArchiveHash===frozen.original.archiveHash&&a.priorTermsVersionId===frozen.original.priorTermsVersionId&&a.priorTermsHash===frozen.original.priorTermsHash&&a.quoteId===quote.id&&a.changeId===change.id&&a.quoteRevision===quote.revision&&a.commercialHash===quote.commercialHash&&same(a.document,s.document)&&a.approvedArchiveVersionId===quote.approvedArchiveVersionId);
  const archive=await tx.documentArchive.findUnique({where:{id:contract.offlineArchiveId},include}),v=archive?.versions?.find((v:any)=>v.id===quote.approvedArchiveVersionId);
  fact(archive?.kind==='ORDER_AMENDMENT'&&archive.subjectType==='ORDER_CHANGE_QUOTE'&&archive.subjectId===quote.id&&archive.quoteId===quote.id&&archive.orderId===order.id&&archive.ownerId===record.ownerId&&!archive.handoverId&&v?.templateId===s.document.id&&v.templateVersion===s.document.version&&v.fileManifestHash===a.approvedArchiveHash);
  await historicalPin(tx,archive,v,quote.commercialHash,paper.parties,offlineChangeScope(change,quote,contract));
  const agreement={mode:'OFFLINE' as const,contractId:contract.id,archiveId:archive.id,archiveVersionId:v.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,fileManifestHash:v.fileManifestHash as string};
  fact(assignment.id===snapshot.identity.assignmentId);
  preparedSource={order,account,change,quote,agreement,previousStage,assignment,vehicle,snapshot,stage:stage!};
 }else fact(stages.length===0&&!quote.financePreparedAt&&!quote.approvedArchiveVersionId&&funding.bills.length===0&&funding.obligations.length===0&&funding.payments.length===0&&funding.receivedAmount===0);
 return{record,order,change,quote,contract,stage,snapshot,completion,frozenQuoteSource:structuredClone(frozen),preparedSource};
}

/** Internal immutable history; no current-payment or current-paper capability is granted. */
export async function readCompletedRenewalCancellationSource(tx:any,changeId:string):Promise<CompletedRenewalCancellationSource>{
 try{return await completedSource(tx,changeId);}catch(error){if(error instanceof AgreementFactError)fact(false,error.code);if(error instanceof HttpException)throw error;throw error;}
}
