import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {loadElectronicArchiveProof} from '../electronic-documents/archive';
import {readElectronicSubscriptionOrigin} from '../electronic-documents/subscription';
import {assertElectronicRenewalCommercial} from './electronic-agreement';
import {assertRenewalNotCancelling} from './cancellation-state';

/** Immutable05 proof. Current catalog, auto grants and signing readiness do not gate historical access. */
export async function requireElectronicRenewalAgreement(tx:any,change:any,quote?:any){
 const q=quote??await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}}),s=assertElectronicRenewalCommercial(change,q),order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});
 const contract=q.contract??await tx.contract.findUnique({where:{delayQuoteId:q.id}}),task=contract?await tx.electronicSigningTask.findUnique({where:{contractId:contract.id},include:{parties:true}}):null;
 ensure(order.contractMode==='ELECTRONIC'&&change.kind==='SUBSCRIPTION_EXTENSION'&&change.customerId===order.customerId&&q.status==='CONFIRMED'&&q.confirmedAt&&s.customerAcceptance?.customerId===order.customerId&&s.customerAcceptance.sharingAccepted===true&&s.customerAcceptance.bodyHash===s.document.bodyHash&&s.customerAcceptance.lessorHash===s.source.lessorHash&&s.customerAcceptance.noticeHash===s.renewalTerms.lessorSnapshot.sharingNotice.contentHash&&contract?.id===s.electronicContractId&&contract.executionMode==='ELECTRONIC'&&contract.kind==='AMENDMENT'&&contract.orderId===order.id&&contract.customerId===order.customerId&&contract.documentHash===q.commercialHash&&task?.kind==='RENEWAL'&&task.orderId===order.id&&task.customerId===order.customerId&&task.businessHash===q.commercialHash&&!task.withdrawnAt&&!task.retiredAt,409,'ELECTRONIC_ARCHIVE_REQUIRED','须使用客户确认且未停派的独立05');
 const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}}),scope=version?.scopeSnapshot,archive=version?.archive;
 ensure(archive?.kind==='ORDER_AMENDMENT'&&archive.subjectType==='ORDER_CHANGE_QUOTE'&&archive.subjectId===q.id&&archive.quoteId===q.id&&archive.orderId===order.id&&archive.ownerId===s.source.ownerId&&archive.currentApprovedVersionId===version.id&&scope.changeId===change.id&&scope.quoteId===q.id&&scope.quoteRevision===q.revision&&scope.renewalSourceHash===s.sourceHash&&scope.originalArchiveVersionId===change.originalArchiveVersionId&&scope.priorTermsVersionId===change.priorTermsVersionId&&scope.currentStageId===s.source.currentStageId&&scope.currentStageHash===s.source.currentStageHash&&scope.assignmentId===s.originalAssignmentId&&version.templateId===s.document.id&&version.templateVersion===s.document.version&&scope.templateHash===s.document.templateHash&&scope.v31Sources?.hash===s.v31Sources?.hash&&canonicalHash(scope.v31Sources?.snapshot)===scope.v31Sources?.hash&&(!q.approvedArchiveVersionId||q.approvedArchiveVersionId===version.id),409,'ELECTRONIC_BINDING_MISMATCH','05档案与原合同、当前阶段、分配或固定报价不一致');
 const expected=order.finalPlanSnapshot.partiesSnapshot;
 ensure(Array.isArray(expected)&&expected.length===3&&task.parties.length===3&&task.parties.every((p:any)=>p.mode==='MANUAL'&&expected.some((v:any)=>v.role===p.role&&v.partyId===p.subjectId&&v.subjectType===p.subjectType)),409,'ELECTRONIC_PARTIES_MISMATCH','05须由原三方逐份本人签署');
 const origin=await readElectronicSubscriptionOrigin(tx,order.id);ensure(origin.ready&&origin.contractId===change.originalContractId&&origin.versionId===change.originalArchiveVersionId,409,'ELECTRONIC_BINDING_MISMATCH','原01档案来源不一致');
 const proof=await loadElectronicArchiveProof(tx,version.id);ensure(proof&&proof.taskId===task.id&&proof.kind==='RENEWAL'&&proof.businessHash===q.commercialHash,409,'ELECTRONIC_ARCHIVE_REQUIRED','完整签署、验签和归档证据缺失');
 return{mode:'ELECTRONIC' as const,contractId:contract.id,archiveId:archive.id,archiveVersionId:version.id,quoteId:q.id,quoteRevision:q.revision,commercialHash:q.commercialHash,fileManifestHash:version.fileManifestHash,taskId:task.id,finalFileId:proof.finalFile.id};
}
/** Legal completion only; never starts service, prepares money or grants rights. */
export async function activateElectronicRenewal(tx:any,task:any){
 ensure(task?.kind==='RENEWAL'&&task.contractId&&task.orderId,409,'ELECTRONIC_BUSINESS_CHANGED');
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${task.orderId} FOR UPDATE`;
 const contract=await tx.contract.findUnique({where:{id:task.contractId}}),q=contract?.delayQuoteId?await tx.delayQuote.findUnique({where:{id:contract.delayQuoteId},include:{contract:true}}):null,change=q?await tx.orderChange.findUnique({where:{id:q.changeId}}):null;
 ensure(change?.orderId===task.orderId&&change.activeQuoteId===q?.id&&['AWAITING_SIGNATURE','AWAITING_FINANCE','SCHEDULED','APPLIED'].includes(change.status),409,'ELECTRONIC_BUSINESS_CHANGED','续期已停止或报价已替代');
 await assertRenewalNotCancelling(tx,change.id);
 const proof=await requireElectronicRenewalAgreement(tx,change,q);ensure(proof.taskId===task.id,409,'ELECTRONIC_BINDING_MISMATCH');
 if(contract.status!=='SIGNED')await tx.contract.update({where:{id:contract.id},data:{status:'SIGNED',signedFileId:proof.finalFileId,signingLeaseUntil:null}});
 const result=await tx.orderChange.updateMany({where:{id:change.id,status:'AWAITING_SIGNATURE'},data:{status:'AWAITING_FINANCE',revision:{increment:1}}});
 if(result.count)await audit(tx,'electronic-verified','ELECTRONIC_RENEWAL_ARCHIVED','order-changes',change.id,{taskId:task.id,archiveVersionId:proof.archiveVersionId},'SYSTEM');return proof;
}
