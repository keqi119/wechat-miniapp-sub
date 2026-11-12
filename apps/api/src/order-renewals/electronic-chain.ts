import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireOnlineConfirmation} from '../operations/online-handover';
import {readPreparedRenewalSource} from './source';

/** A05 continues the real assignment; it never supplies swap receipt or consume evidence. */
export async function electronicRenewalChainNode(tx:any,order:any,version:any,change:any,q:any,head:{prior:any;priorId:string|null;vehicleId:string;assignmentId:string|null;index:number;contractId:string;archiveVersionId:string}){
 const source=await readPreparedRenewalSource(tx,q.snapshot?.renewalTerms?.serviceStageId),{stage,snapshot,assignment,previousStage,agreement}=source;
 ensure(change.kind==='SUBSCRIPTION_EXTENSION'&&change.status==='APPLIED'&&change.orderId===order.id&&change.customerId===order.customerId&&change.activeQuoteId===q.id&&change.originalContractId===head.contractId&&change.originalArchiveVersionId===head.archiveVersionId&&change.priorTermsVersionId===head.priorId&&change.priorTermsHash===hash(head.prior)&&hash(change.priorTerms)===hash(head.prior)&&version.version===head.index+1&&version.hash===q.commercialHash&&version.offlineArchiveVersionId===agreement.archiveVersionId&&q.approvedArchiveVersionId===agreement.archiveVersionId&&q.financePreparedAt&&source.change.id===change.id&&source.quote.id===q.id&&stage.termsVersionId===version.id&&['ACTIVE','ENDED'].includes(stage.status)&&stage.activatedBy&&stage.activatedAt&&stage.activatedAt.getTime()>=version.effectiveAt.getTime()&&version.effectiveAt.getTime()===new Date(snapshot.period.startDate+'T00:00:00+08:00').getTime()&&canonicalHash(version.snapshot)===canonicalHash(snapshot.termsSnapshot)&&previousStage.stage.status==='ENDED'&&assignment.vehicleId===head.vehicleId&&(!head.assignmentId||assignment.id===head.assignmentId)&&snapshot.identity.assignmentId===assignment.id,409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','05须关联原合同、实际前段、同车分配和真实阶段激活');
 if(head.index===0){
  const initial=assignment.deliveryHandoverId?await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}):null,s=previousStage.snapshot;
  ensure(previousStage.stage.kind==='INITIAL'&&previousStage.stage.sequence===1&&initial?.type==='DELIVERY'&&initial.executionMode==='ELECTRONIC'&&initial.confirmationMode==='ONLINE_RECORD'&&initial.status==='COMPLETED'&&initial.completedAt&&!initial.changeId&&!assignment.changeId&&initial.orderId===order.id&&initial.customerId===order.customerId&&initial.vehicleId===head.vehicleId&&initial.assignmentId===assignment.id&&initial.actualAt?.getTime()===assignment.startAt.getTime()&&initial.readingKm===assignment.startReadingKm&&s.identity.assignmentId===assignment.id&&s.source.agreement.originalContractId===head.contractId&&s.source.agreement.originalArchiveVersionId===head.archiveVersionId,409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','05首个前段须来自真实01交付及INITIAL');
  await requireOnlineConfirmation(tx,initial);
 }
 return{prior:version.snapshot,priorId:version.id,vehicleId:assignment.vehicleId,assignmentId:assignment.id,archiveVersionId:agreement.archiveVersionId};
}
