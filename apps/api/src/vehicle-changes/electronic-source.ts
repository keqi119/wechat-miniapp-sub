import {electronicRenewalChainNode} from '../order-renewals/electronic-chain';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireOnlineConfirmation} from '../operations/online-handover';
import {readElectronicSubscriptionOrigin} from '../electronic-documents/subscription';
import {requireSwapSettlement} from './fact-settlement';
import {electronicSwapAppliedTerms} from './electronic-completion';

export function assertElectronicSwapCommercial(change:any,q:any){
 const s=q?.snapshot,{document,v31Sources,...fields}=s??{};
 ensure(document&&typeof s.electronicContractId==='string',409,'SWAP_QUOTE_SOURCE_MISMATCH','电子换车缺少固定正文及合同编号');
 const {content,bodyHash}=document;
 ensure(typeof content==='string'&&hash(content)===bodyHash&&q.commercialHash===canonicalHash({priorTermsHash:change.priorTermsHash,snapshot:{...fields,document},contractId:s.electronicContractId}),409,'SWAP_QUOTE_SOURCE_MISMATCH','已确认换车商业方案或正文摘要被改变');
}

/** Original archive plus every applied03, actual delivery, financial source and prior-terms link. */
export async function requireElectronicSwapChain(tx:any,order:any){
 ensure(order?.contractMode==='ELECTRONIC',409,'ELECTRONIC_BUSINESS_CHANGED');
 const ready=await readElectronicSubscriptionOrigin(tx,order.id);
 ensure(ready.ready&&ready.contractId&&ready.archiveId&&ready.versionId,409,ready.blockers[0]||'ELECTRONIC_ARCHIVE_REQUIRED');
 const original=await tx.archiveVersion.findUniqueOrThrow({where:{id:ready.versionId}});
 ensure(original.businessSnapshotHash===order.finalPlanSnapshot.commercialHash,409,'ELECTRONIC_BUSINESS_CHANGED');
 const versions=await tx.orderTermsVersion.findMany({where:{orderId:order.id},orderBy:{version:'asc'}}),amendmentVersionIds:string[]=[];
 let prior=order.finalPlanSnapshot,priorId:string|null=null,vehicleId=prior.lessorSnapshot.vehicleId,assignmentId:string|null=null;
 for(const [index,version]of versions.entries()){
  const q=await tx.delayQuote.findUniqueOrThrow({where:{id:version.quoteId},include:{contract:true}}),change=await tx.orderChange.findUniqueOrThrow({where:{id:q.changeId}}),finance=await tx.swapFactFinance.findUnique({where:{quoteId:q.id}});
  if(change.kind==='SUBSCRIPTION_EXTENSION'&&change.status==='CANCELLED'){
   await(await import('../order-renewals/cancellation-v31')).requireV31CorrectedTerms(tx,change.id,version);
   ensure(version.version===index+1&&change.priorTermsVersionId===priorId&&change.priorTermsHash===hash(prior),409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED');continue;
  }
  if(change.kind==='SUBSCRIPTION_EXTENSION'){const next=await electronicRenewalChainNode(tx,order,version,change,q,{prior,priorId,vehicleId,assignmentId,index,contractId:ready.contractId!,archiveVersionId:ready.versionId!});prior=next.prior;priorId=next.priorId;vehicleId=next.vehicleId;assignmentId=next.assignmentId;amendmentVersionIds.push(next.archiveVersionId);continue;}
  ensure(change.kind==='VEHICLE_CHANGE'&&change.status==='APPLIED'&&change.orderId===order.id&&change.customerId===order.customerId&&change.activeQuoteId===q.id&&change.originalContractId===ready.contractId&&change.originalArchiveVersionId===ready.versionId&&change.priorTermsVersionId===priorId&&change.priorTermsHash===hash(prior)&&hash(change.priorTerms)===hash(prior)&&version.version===index+1&&version.hash===q.commercialHash&&version.offlineArchiveVersionId===q.approvedArchiveVersionId&&finance&&canonicalHash(finance.plan)===finance.planHash,409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','已生效换车必须逐版关联原合同、原条款及真实资金来源');
  const {row,h,receipt}=await requireSwapSettlement(tx,finance.settlementId),old=await tx.vehicleAssignment.findUniqueOrThrow({where:{id:receipt.assignmentId}}),assignment=h.assignmentId?await tx.vehicleAssignment.findUnique({where:{id:h.assignmentId}}):null;
  if(index===0){
   const initial=old.deliveryHandoverId?await tx.handover.findUnique({where:{id:old.deliveryHandoverId}}):null,stage=await tx.orderServiceStage.findFirst({where:{orderId:order.id,kind:'INITIAL',sequence:1}}),s=stage?.snapshot;
   ensure(initial?.type==='DELIVERY'&&initial.executionMode==='ELECTRONIC'&&initial.confirmationMode==='ONLINE_RECORD'&&initial.status==='COMPLETED'&&initial.completedAt&&!initial.changeId&&!old.changeId&&initial.orderId===order.id&&initial.customerId===order.customerId&&initial.vehicleId===vehicleId&&initial.assignmentId===old.id&&initial.actualAt?.getTime()===old.startAt.getTime()&&initial.readingKm===old.startReadingKm&&stage?.assignmentId===old.id&&stage.vehicleId===vehicleId&&stage.customerId===order.customerId&&canonicalHash(s)===stage.snapshotHash&&s.identity.assignmentId===old.id&&s.source.agreement.originalContractId===ready.contractId&&s.source.agreement.originalArchiveVersionId===ready.versionId,409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','原车分配须关联真实首交及初始服务段，不可借用其他交接');
   await requireOnlineConfirmation(tx,initial);
  }
  ensure(old.orderId===order.id&&old.customerId===order.customerId&&old.vehicleId===vehicleId&&(!assignmentId||old.id===assignmentId)&&old.status==='CLOSED'&&old.endAt?.getTime()===receipt.receivedAt.getTime()&&old.endReadingKm===receipt.readingKm&&h.status==='COMPLETED'&&h.completedAt&&h.id===change.deliveryHandoverId&&h.vehicleId===change.targetVehicleId&&assignment?.orderId===order.id&&assignment.customerId===order.customerId&&assignment.changeId===change.id&&assignment.vehicleId===h.vehicleId&&assignment.deliveryHandoverId===h.id&&assignment.startAt.getTime()===h.actualAt.getTime()&&assignment.startReadingKm===h.readingKm&&version.effectiveAt.getTime()===h.actualAt.getTime()&&change.actualCompletedAt?.getTime()===h.actualAt.getTime(),409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','03生效须有原车收回与新车真实分配');
  ensure(canonicalHash(version.snapshot)===canonicalHash(electronicSwapAppliedTerms(change,q,row,finance)),409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','有效条款不得改写原里程权益、固定押金或事实资金来源');
  const ledger=await tx.swapLedger.findUnique({where:{sourceKey:`consume:${change.id}`}});ensure(ledger?.orderId===order.id&&ledger.changeId===change.id&&ledger.type==='CONSUME'&&ledger.actualAt?.getTime()===h.actualAt.getTime(),409,'SWAP_CREDIT_SOURCE');
  prior=version.snapshot;priorId=version.id;vehicleId=h.vehicleId;assignmentId=assignment.id;amendmentVersionIds.push(q.approvedArchiveVersionId);
 }
 ensure((order.effectiveTermsVersionId??null)===priorId&&order.vehicleId===vehicleId&&(!assignmentId||!order.currentAssignmentId||order.currentAssignmentId===assignmentId),409,'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED','订单当前条款或车辆不属于实际生效链');
 return{ready:true as const,blockers:[],original:{contractId:ready.contractId!,archiveId:ready.archiveId!,archiveVersionId:ready.versionId!,businessHash:original.businessSnapshotHash},termsVersionId:priorId,termsHash:hash(prior),amendmentVersionIds};
}
