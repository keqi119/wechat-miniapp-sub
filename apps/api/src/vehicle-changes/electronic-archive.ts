import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {loadElectronicArchiveProof} from '../electronic-documents/archive';
import {assertOfflineSwapQuote} from './offline-target';
import {assertElectronicSwapCommercial} from './electronic-source';

/** Historical immutable03 proof, independent from mutable current catalog/auto-grant. */
export async function requireElectronicSwapAgreement(tx:any,change:any,quote?:any){
 const q=quote??await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}}),s=assertOfflineSwapQuote(change,q),order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});
 assertElectronicSwapCommercial(change,q);
 const contract=q.contract??await tx.contract.findUnique({where:{delayQuoteId:q.id}}),task=contract?await tx.electronicSigningTask.findUnique({where:{contractId:contract.id},include:{parties:true}}):null;
 ensure(contract?.id===s.electronicContractId,409,'ELECTRONIC_BINDING_MISMATCH','电子换车合同编号与确认来源不一致');
 ensure(order.contractMode==='ELECTRONIC'&&s.executionMode==='ELECTRONIC'&&q.status==='CONFIRMED'&&q.confirmedAt&&contract?.executionMode==='ELECTRONIC'&&contract.kind==='AMENDMENT'&&contract.orderId===order.id&&contract.customerId===order.customerId&&contract.delayQuoteId===q.id&&contract.documentHash===q.commercialHash&&task?.kind==='VEHICLE_SWAP'&&task.orderId===order.id&&task.customerId===order.customerId&&task.businessHash===q.commercialHash&&!task.withdrawnAt&&!task.retiredAt,409,'ELECTRONIC_ARCHIVE_REQUIRED','须使用本次客户确认且未停派的独立03');
 const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}}),scope=version?.scopeSnapshot,archive=version?.archive;
 ensure(archive?.kind==='ORDER_AMENDMENT'&&archive.subjectType==='ORDER_CHANGE_QUOTE'&&archive.subjectId===q.id&&archive.quoteId===q.id&&archive.orderId===order.id&&archive.ownerId===s.targetLessorSnapshot.ownerId&&archive.currentApprovedVersionId===version.id&&scope.changeId===change.id&&scope.quoteId===q.id&&scope.quoteRevision===q.revision&&scope.termsHash===s.electronicTerms.hash&&scope.originalArchiveVersionId===change.originalArchiveVersionId&&version.templateId===s.document.id&&version.templateVersion===s.document.version&&scope.templateHash===s.document.templateHash&&(!q.approvedArchiveVersionId||q.approvedArchiveVersionId===version.id),409,'ELECTRONIC_BINDING_MISMATCH','03档案与报价版本、原合同或目标价格不一致');
 const expected=order.finalPlanSnapshot.partiesSnapshot;
 ensure(Array.isArray(expected)&&expected.length===3&&task.parties.length===3&&task.parties.every((p:any)=>p.mode==='MANUAL'&&expected.some((v:any)=>v.role===p.role&&v.partyId===p.subjectId&&v.subjectType===p.subjectType)),409,'ELECTRONIC_PARTIES_MISMATCH','03须由原三方逐份本人签署');
 const proof=await loadElectronicArchiveProof(tx,version.id);ensure(proof&&proof.taskId===task.id&&proof.kind==='VEHICLE_SWAP'&&proof.businessHash===q.commercialHash,409,'ELECTRONIC_ARCHIVE_REQUIRED','完整签署、验签和归档证据缺失');
 return{mode:'ELECTRONIC' as const,contractId:contract.id,archiveId:archive.id,archiveVersionId:version.id,quoteId:q.id,quoteRevision:q.revision,commercialHash:q.commercialHash,fileManifestHash:version.fileManifestHash,taskId:task.id,finalFileId:proof.finalFile.id};
}
export async function activateElectronicSwap(tx:any,task:any){
 ensure(task?.kind==='VEHICLE_SWAP'&&task.contractId&&task.orderId,409,'ELECTRONIC_BUSINESS_CHANGED','须为本单换车电子文书');
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${task.orderId} FOR UPDATE`;
 const contract=await tx.contract.findUnique({where:{id:task.contractId}}),q=contract?.delayQuoteId?await tx.delayQuote.findUnique({where:{id:contract.delayQuoteId},include:{contract:true}}):null,change=q?await tx.orderChange.findUnique({where:{id:q.changeId}}):null;
 ensure(change?.orderId===task.orderId&&change.activeQuoteId===q?.id&&['AWAITING_SIGNATURE','AWAITING_FINANCE','SWAP_RETURNED','APPLIED'].includes(change.status),409,'ELECTRONIC_BUSINESS_CHANGED','当前换车已停止或报价已替代');
 const proof=await requireElectronicSwapAgreement(tx,change,q);ensure(proof.taskId===task.id,409,'ELECTRONIC_BINDING_MISMATCH','签署任务与当前03不同');
 if(!q.approvedArchiveVersionId)await tx.delayQuote.update({where:{id:q.id},data:{approvedArchiveVersionId:proof.archiveVersionId}});
 if(contract.status!=='SIGNED')await tx.contract.update({where:{id:contract.id},data:{status:'SIGNED',signedFileId:proof.finalFileId,signingLeaseUntil:null}});
 const result=await tx.orderChange.updateMany({where:{id:change.id,status:'AWAITING_SIGNATURE'},data:{status:'AWAITING_FINANCE',revision:{increment:1}}});
 if(result.count)await audit(tx,'electronic-verified','ELECTRONIC_SWAP_ARCHIVED','order-changes',change.id,{taskId:task.id,archiveVersionId:proof.archiveVersionId},'SYSTEM');
 return proof;
}
