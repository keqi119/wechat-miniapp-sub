import {requireElectronicRenewalAgreement} from './electronic-archive';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireChangeAgreementReady,requireHistoricalPreparedQuoteAgreement} from '../order-changes/agreement-readiness';
import {readServiceStage} from '../order-service-stages/readiness';
import {parseStageSnapshot,stageDay} from '../order-service-stages/source';
import type {StageSnapshotV1} from '../order-service-stages/types';
import {resolveUsagePricing} from '../usage/pricing';
import {requireOfflineSwapFacts} from '../vehicle-changes/offline-facts';
import {versionSnapshot} from '../products/snapshot';
import {productVersionInclude} from '../products/types';
import {readSimpleAgreementSnapshot} from '../partners/simple-agreements';
import {approvedPartner} from '../partners/types';
import {ownerCooperationReady} from '../offline-documents/readiness';
import {assertNotAssetFiles} from '../files/asset-files';
import {coverageAt} from '../insurance/coverage';
import {assertRenewalFrozenQuote,renewalId} from './types';
import {assertRenewalNotCancelling} from './cancellation-state';
import {readCompletedRenewalCancellationSource} from './cancellation-history';

const same=(a:unknown,b:unknown)=>canonicalHash(a)===canonicalHash(b);
function sourceFact(value:unknown,message='续期冻结来源缺失或不一致'):asserts value{ensure(value,409,'RENEWAL_STAGE_SOURCE',message);}

/** A frozen product identity is permanent. Publication/visibility/revision may later change. */
async function frozenProduct(tx:any,s:any){
 const refs=s.source,[listing,plan,version]=await Promise.all([
  tx.vehicleListing.findUnique({where:{id:refs.listingId}}),
  tx.subscriptionPlan.findUnique({where:{id:refs.subscriptionPlanId}}),
  tx.productVersion.findUnique({where:{id:refs.productVersionId},include:productVersionInclude}),
 ]);
 sourceFact(listing?.id===refs.listingId&&listing.vehicleId===refs.vehicleId&&listing.productVersionId===refs.productVersionId&&listing.subscriptionPlanId===refs.subscriptionPlanId&&Number.isInteger(listing.revision)&&listing.revision>=refs.listingRevision,'冻结商品关联已失效');
 sourceFact(plan?.id===refs.subscriptionPlanId&&plan.vehicleId===refs.vehicleId&&plan.productVersionId===refs.productVersionId&&version?.id===refs.productVersionId,'冻结产品与套餐关联已失效');
 const {listingId,listingRevision,sourceHash,...configuration}=s.product;
 sourceFact(same(versionSnapshot(version),configuration)&&['EXPLICIT','LEGACY_MIGRATED'].includes(listing.source),'产品版本原文与客户已确认来源不一致');
 // Never substitute today's listing revision into the customer's frozen hash.
 sourceFact(sourceHash===canonicalHash({listingId,listingRevision,vehicleId:refs.vehicleId,subscriptionPlanId:refs.subscriptionPlanId,product:configuration}));
}

async function quoteSource(tx:any,change:any,quote:any,agreement:any){
 const s=assertRenewalFrozenQuote(change,quote),order=await tx.order.findUnique({where:{id:change.orderId}});
 sourceFact(quote.createdBy&&quote.reviewedBy&&quote.reviewedBy!==quote.createdBy,'报价缺少独立财务复核来源');
 sourceFact(['OFFLINE','ELECTRONIC'].includes(order?.contractMode)&&order.customerId===change.customerId&&agreement.mode===order.contractMode&&agreement.quoteId===quote.id&&agreement.quoteRevision===quote.revision&&agreement.commercialHash===quote.commercialHash);
 const account=await tx.usageAccount.findUnique({where:{orderId:order.id}});sourceFact(account?.id===s.source.accountId);resolveUsagePricing(order,account);
 const previousStage=await readServiceStage(tx,order,s.source.currentStageId);
 sourceFact(previousStage.stage.snapshotHash===s.source.currentStageHash&&previousStage.snapshot.period.endDate===s.startDate&&previousStage.snapshot.identity.sequence<s.source.nextStageSequence);
 const assignment=await tx.vehicleAssignment.findUnique({where:{id:s.originalAssignmentId}}),vehicle=await tx.vehicle.findUnique({where:{id:s.source.vehicleId}});
 sourceFact(assignment?.id===s.originalAssignmentId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===s.source.vehicleId&&vehicle?.id===s.source.vehicleId);
 await frozenProduct(tx,s);
 const snapshot=parseStageSnapshot({
  version:1,kind:'RENEWAL',...(s.renewalTerms.serviceAnchor?{serviceAnchor:s.renewalTerms.serviceAnchor}:{}),identity:{serviceStageId:s.renewalTerms.serviceStageId,orderId:order.id,customerId:order.customerId,sequence:s.source.nextStageSequence,previousStageId:previousStage.stage.id,vehicleId:s.source.vehicleId,assignmentId:assignment.id,ownerId:s.source.ownerId},
  period:{startDate:s.startDate,endDate:s.endDate,months:s.months,firstPeriodSequence:s.periods[0].sequence,lastPeriodSequence:s.periods.at(-1).sequence},
  termsSnapshot:s.renewalTerms,usagePricing:s.usagePricing,swapPolicy:s.swapPolicy,billingSchedule:s.periods,
  source:{originalTermsHash:canonicalHash(order.finalPlanSnapshot),product:{listingId:s.source.listingId,listingRevision:s.source.listingRevision,productVersionId:s.source.productVersionId,subscriptionPlanId:s.source.subscriptionPlanId,sourceHash:s.source.listingSourceHash},agreement:{originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:s.source.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash,changeId:change.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,approvedArchiveVersionId:agreement.archiveVersionId,approvedArchiveHash:agreement.fileManifestHash,document:s.document}},
 },order);
 return{order,account,change,quote,agreement,previousStage,assignment,vehicle,snapshot};
}
export type RenewalSource=Awaited<ReturnType<typeof quoteSource>>;
export type PreparedRenewalSource=RenewalSource&{stage:Record<string,any>};

/** First preparation only. Read-only; no live catalog pricing, no supplier, no implicit pin write. */
export async function readConfirmedRenewalSource(tx:any,changeId:string):Promise<RenewalSource>{
 const change=await tx.orderChange.findUnique({where:{id:renewalId.parse(changeId)}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION',404,'NOT_FOUND','续期变更不存在');
 sourceFact(change.status==='AWAITING_FINANCE'&&change.activeQuoteId,'须先完成客户确认及纸质归档');
 const quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}});
 sourceFact(quote?.status==='CONFIRMED'&&!quote.financePreparedAt&&!quote.approvedArchiveVersionId,'此报价已准备或不再可准备');
 const agreement=quote.snapshot.executionMode==='ELECTRONIC'?await requireElectronicRenewalAgreement(tx,change,quote):await requireChangeAgreementReady(tx,change.id);return quoteSource(tx,change,quote,agreement);
}

/** Frozen historical source for bills/callbacks. Do NOT add current car, today's qualification or catalog status gates here. */
export async function readPreparedRenewalSource(tx:any,stageId:string):Promise<PreparedRenewalSource>{
 const row=await tx.orderServiceStage.findUnique({where:{id:renewalId.parse(stageId)}});sourceFact(row?.kind==='RENEWAL','续期服务段不存在');
 if(row.status==='VOIDED'){
  const record=await tx.orderRenewalCancellation.findUnique({where:{quoteId:row.quoteId}});
  if(record?.sourceSnapshot?.version===31){const s=await(await import('./cancellation-v31')).readV31CancellationSource(tx,row.changeId);sourceFact(s.history.some((f:any)=>f.kind==='CORRECTED'));const source=await quoteSource(tx,s.change,s.quote,s.agreement);return{...source,stage:s.stage,snapshot:s.stage.snapshot};}
  const history=await readCompletedRenewalCancellationSource(tx,row.changeId);sourceFact(history.preparedSource&&history.stage?.id===row.id,'已撤销续期缺少真实完成取消来源');return history.preparedSource;
 }
 const order=await tx.order.findUnique({where:{id:row.orderId}});sourceFact(order);const parsed=await readServiceStage(tx,order,row.id);
 const change=await tx.orderChange.findUnique({where:{id:row.changeId}}),quote=await tx.delayQuote.findUnique({where:{id:row.quoteId},include:{contract:true}});
 sourceFact(change?.kind==='SUBSCRIPTION_EXTENSION'&&quote?.changeId===change.id&&change.orderId===order.id&&change.customerId===order.customerId&&quote.financePreparedAt&&quote.approvedArchiveVersionId===row.approvedArchiveVersionId);
 const agreement=quote.snapshot.executionMode==='ELECTRONIC'?await requireElectronicRenewalAgreement(tx,change,quote):await requireHistoricalPreparedQuoteAgreement(tx,change.id,quote.id),source=await quoteSource(tx,change,quote,agreement);
 sourceFact(same(source.snapshot,parsed.snapshot),'服务段与已准备原报价或纸档不一致');return{...source,stage:parsed.stage,snapshot:parsed.snapshot};
}

/** Current eligibility belongs to prepare/schedule/activate, never historical bill reads. Caller holds Order then Account/Vehicle for writes. */
export async function requireRenewalCurrentEligibility(tx:any,source:RenewalSource,now:Date){
 const {order,change,quote,assignment,vehicle,snapshot,account}=source,s=quote.snapshot;
 await assertRenewalNotCancelling(tx,change.id);
 sourceFact(quote.status==='CONFIRMED'&&change.activeQuoteId===quote.id,'当前办理须引用尚有效的客户已确认报价');
 const current=await requireOfflineSwapFacts(tx,order,undefined,now);
 sourceFact(order.status==='ACTIVE'&&!account.returnedOn&&current.assignment.id===assignment.id&&assignment.status==='ACTIVE'&&!assignment.endAt&&!assignment.returnHandoverId&&vehicle.status==='IN_USE'&&vehicle.reservedOrderId===order.id&&!vehicle.holdId,'当前在用车辆或实际分配已变化');
 sourceFact(current.chain.original.contractId===change.originalContractId&&current.chain.original.archiveVersionId===change.originalArchiveVersionId&&(current.chain.termsVersionId??null)===(change.priorTermsVersionId??null)&&hash(current.terms)===change.priorTermsHash,'当前条款链已变化');
 sourceFact(source.previousStage.stage.status==='ACTIVE','前一服务段已结束或被替换');
 sourceFact(!await tx.handover.count({where:{orderId:order.id,type:'RETURN',status:{not:'SUPERSEDED'}}}),'已有最终归还办理');
 const changes=await tx.orderChange.findMany({where:{orderId:order.id,status:{notIn:['APPLIED','CANCELLED','REJECTED']},id:{not:change.id}}});sourceFact(changes.length===0,'已有其他未完成变更');
 const owner=await tx.vehicleOwner.findUnique({where:{id:s.source.ownerId}}),lessor=snapshot.termsSnapshot.lessorSnapshot;
 sourceFact(owner&&owner.status!=='SUSPENDED'&&owner.id===lessor.ownerId&&owner.name===lessor.name&&owner.subjectType===lessor.subjectType&&owner.creditCode===lessor.creditCode,'当前实际出租方已变化');
 const range={startDate:snapshot.period.startDate,endDate:stageDay(new Date(new Date(snapshot.period.endDate+'T00:00:00Z').getTime()-86400000))};let cooperation:any;
 if(lessor.mode==='SIMPLE_AGREEMENT'){
  cooperation=await readSimpleAgreementSnapshot(tx,vehicle.id,range);sourceFact(cooperation?.ownerId===owner.id,'当前合作协议未覆盖完整续期');
 }else{
  const binding=await tx.ownerVehicle.findUnique({where:{vehicleId:vehicle.id}});sourceFact(binding?.ownerId===owner.id&&binding.status==='APPROVED'&&binding.reviewedBy&&binding.reviewedAt,'车辆权属来源未有效复核');await assertNotAssetFiles(tx,[binding.evidenceFileId]);
  await approvedPartner(tx,owner);cooperation=await ownerCooperationReady(tx,owner.id,vehicle.id,range.startDate,range.endDate);sourceFact(cooperation.ready,'当前合作协议未覆盖完整续期');
 }
 const coverage=await coverageAt(tx,vehicle.id,s.source.productVersionId,now);ensure(coverage.ready,409,coverage.blockers[0]?.code||'INSURANCE_COVERAGE_REQUIRED','当前车辆保障未就绪');
 return{qualificationId:current.qualification.id,qualificationRevision:current.qualification.revision,qualificationProfileHash:current.qualification.profileHash,ownerId:owner.id,ownerRevision:owner.revision,cooperation,coverage};
}

/** No business revision changes just to acquire locks. First write later CASes Order. */
export async function lockRenewalFinanceSource(tx:any,change:any){
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${change.orderId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "UsageAccount" WHERE "orderId"=${change.orderId} FOR UPDATE`;
 const quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}});const s=assertRenewalFrozenQuote(change,quote);
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${s.source.vehicleId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${s.source.ownerId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "VehicleAssignment" WHERE id=${s.originalAssignmentId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "OrderServiceStage" WHERE "orderId"=${change.orderId} ORDER BY sequence FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "OrderChange" WHERE id=${change.id} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "DelayQuote" WHERE id=${quote.id} FOR UPDATE`;
}
