import {readElectronicSubscriptionReady} from '../electronic-documents/subscription';
import {canonicalHash} from '../customers/types';
import {parseStageSnapshot,parseStageRow,stageFact,stageDay,stagePeriods} from './source';
import {hash} from '../common/data';
import {freezeUsagePricing} from '../usage/pricing';
import {freezeSwapPolicy} from '../swap-purchases/policy';
import {requireEffectiveContractChain} from '../order-changes/agreement-readiness';
import type {StageSnapshotV1} from './types';

/** Pure candidate for renewal preview. The stable id is a proposal, not a persisted/current stage.
 * Existing original bills provide due dates; changed current products/vehicles never fill history.
 */
export async function prepareInitialServiceStageSnapshot(tx:any,order:any):Promise<StageSnapshotV1>{
 const existing=await tx.orderServiceStage.findMany({where:{orderId:order.id,kind:'INITIAL'}}),initial=existing.filter((r:any)=>r.kind==='INITIAL');
 stageFact(initial.length<=1);if(initial.length)return parseStageRow(initial[0],order).snapshot;
 stageFact(order.status==='ACTIVE'&&['OFFLINE','ESIGN','ELECTRONIC'].includes(order.contractMode)&&typeof order.applicationId==='string'&&order.applicationId);
 const t=order.finalPlanSnapshot,account=await tx.usageAccount.findUnique({where:{orderId:order.id}}),pricing=freezeUsagePricing(t);
 stageFact(account&&!account.returnedOn&&account.orderId===order.id&&account.customerId===order.customerId&&account.policyVersion===pricing.policyVersion&&(account.pricingSnapshot==null?pricing.policyVersion==='USAGE_V1':canonicalHash(account.pricingSnapshot)===canonicalHash(pricing)));
 // Non-flat historical schedules need their own exact source adapter, never a flat reconstruction.
 for(const key of ['monthlyAmounts','billingSchedule'])if(t[key]!=null)stageFact(Array.isArray(t[key])&&t[key].length===t.months&&t[key].every((v:any)=>Number.isSafeInteger(key==='monthlyAmounts'?v:v?.amount)&&(key==='monthlyAmounts'?v:v.amount)===t.monthlyFeeAmount),'原期包含非等额或不完整逐期约定，不能重建为平月费');
 const assignments=await tx.vehicleAssignment.findMany({where:{orderId:order.id,customerId:order.customerId,changeId:null},orderBy:{startAt:'asc'}});
 stageFact(assignments.length===1,'原始交付车辆来源不唯一');const a=assignments[0];
 stageFact(a&&a.orderId===order.id&&a.customerId===order.customerId&&!a.changeId&&a.deliveryHandoverId&&['ACTIVE','CLOSED'].includes(a.status));
 const app=await tx.application.findUnique({where:{id:order.applicationId}});stageFact(app&&app.id===order.applicationId&&app.customerId===order.customerId&&app.vehicleId===a.vehicleId,'原申请与初始交付车辆不一致');
 const delivered=await tx.handover.findUnique({where:{id:a.deliveryHandoverId}}),instant=(v:any)=>v==null?NaN:new Date(v).getTime();
 stageFact(delivered&&delivered.id===a.deliveryHandoverId&&delivered.orderId===order.id&&delivered.customerId===order.customerId&&delivered.vehicleId===a.vehicleId&&delivered.assignmentId===a.id&&!delivered.changeId&&delivered.type==='DELIVERY'&&delivered.status==='COMPLETED'&&Number.isFinite(instant(delivered.actualAt))&&Number.isFinite(instant(delivered.completedAt))&&instant(delivered.actualAt)===instant(a.startAt));
 const startDate=stageDay(account.startedOn);stageFact(new Date(instant(a.startAt)+8*3600000).toISOString().slice(0,10)===startDate);
 const rows=stagePeriods(startDate,t.months,1,t.monthlyFeeAmount,order.serviceAnchor??undefined),periods=await tx.usagePeriod.findMany({where:{orderId:order.id,accountId:account.id},orderBy:{sequence:'asc'}});
 stageFact(periods.length===rows.length&&new Set(periods.map((p:any)=>p.sequence)).size===rows.length);
 for(const p of periods){const r=rows.find(r=>r.sequence===p.sequence);stageFact(r&&p.orderId===order.id&&p.accountId===account.id&&stageDay(p.startDate)===r.startDate&&stageDay(p.endDate)===r.endDate&&(p.pricingSnapshot==null?pricing.policyVersion==='USAGE_V1':canonicalHash(p.pricingSnapshot)===canonicalHash(pricing)));}
 const bills=await tx.bill.findMany({where:{orderId:order.id,customerId:order.customerId,type:'SUBSCRIPTION'},orderBy:{sequence:'asc'}});stageFact(bills.length===rows.length&&new Set(bills.map((b:any)=>b.sequence)).size===rows.length,'原订阅逐期账单来源不完整');
 for(const row of rows){const bill=bills.find((b:any)=>b.sequence===row.sequence);stageFact(bill&&bill.orderId===order.id&&bill.customerId===order.customerId&&bill.type==='SUBSCRIPTION'&&bill.amount===row.amount,'原订阅账单金额与冻结方案不一致');row.dueDate=stageDay(bill.dueDate);}
 let originalContractId:string|null=null,originalArchiveVersionId:string|null=null,originalArchiveHash:string|null=null;
 if(order.contractMode==='ELECTRONIC'){const proof=await readElectronicSubscriptionReady(tx,order.id);stageFact(proof.ready&&proof.versionId&&proof.contractId);const v=await tx.archiveVersion.findUnique({where:{id:proof.versionId}});stageFact(v&&/^[a-f0-9]{64}$/.test(v.fileManifestHash));originalContractId=proof.contractId;originalArchiveVersionId=proof.versionId;originalArchiveHash=v.fileManifestHash;}
 if(order.contractMode==='OFFLINE'){
  const chain=await requireEffectiveContractChain(tx,order.id),version=await tx.archiveVersion.findUnique({where:{id:chain.original.archiveVersionId}});
  stageFact(version&&version.id===chain.original.archiveVersionId&&version.archiveId===chain.original.archiveId&&typeof version.fileManifestHash==='string'&&/^[a-f0-9]{64}$/.test(version.fileManifestHash));
  originalContractId=chain.original.contractId;originalArchiveVersionId=version.id;originalArchiveHash=version.fileManifestHash;
 }
 const product=t.productSnapshot,sourceProduct=product?.listingId?{listingId:product.listingId,listingRevision:product.listingRevision,productVersionId:product.productVersionId,subscriptionPlanId:app.subscriptionPlanId,sourceHash:product.sourceHash}:null;
 const snapshot:StageSnapshotV1={version:1,kind:'INITIAL',...(order.serviceAnchor?{serviceAnchor:structuredClone(order.serviceAnchor)}:{}),identity:{serviceStageId:`initial:${order.id}`,orderId:order.id,customerId:order.customerId,sequence:1,previousStageId:null,vehicleId:a.vehicleId,assignmentId:a.id,ownerId:t.lessorSnapshot?.ownerId??null},period:{startDate,endDate:rows.at(-1)!.endDate,months:t.months,firstPeriodSequence:1,lastPeriodSequence:t.months},termsSnapshot:structuredClone(t),usagePricing:pricing,swapPolicy:freezeSwapPolicy(order),billingSchedule:rows,source:{originalTermsHash:canonicalHash(t),product:sourceProduct,agreement:{originalContractId,originalArchiveVersionId,originalArchiveHash,priorTermsVersionId:null,priorTermsHash:hash(t),changeId:null,quoteId:null,quoteRevision:null,commercialHash:t.commercialHash,approvedArchiveVersionId:null,approvedArchiveHash:null,document:null}}};
 return parseStageSnapshot(snapshot,order);
}

/** Explicit transaction command helper. Caller authorizes the business command; never call from GET.
 * Creates only the INITIAL source row. It does not backfill periods/credits, activate renewals,
 * grant benefits, mutate assignments or replace any original account/order snapshot.
 */
export async function createInitialServiceStage(tx:any,input:{orderId:string;expectedOrderRevision:number;snapshot:unknown}){
 const order=await tx.order.findUnique({where:{id:input.orderId}});stageFact(order&&order.revision===input.expectedOrderRevision,'订单已变化，请重新核对初始租期');
 const s=parseStageSnapshot(input.snapshot,order);stageFact(s.kind==='INITIAL');
 const existing=await tx.orderServiceStage.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}}),initial=existing.find((r:any)=>r.kind==='INITIAL');
 if(initial){const read=parseStageRow(initial,order);stageFact(canonicalHash(read.snapshot)===canonicalHash(s),'初始租期已经建立，不能替换历史来源');return initial;}
 stageFact(!existing.length,'存在后续租期但缺少初始来源，请人工核对');
 const account=await tx.usageAccount.findUnique({where:{orderId:order.id}}),assignment=await tx.vehicleAssignment.findUnique({where:{id:s.identity.assignmentId}});
 stageFact(order.status==='ACTIVE'&&account&&!account.returnedOn&&account.orderId===order.id&&account.customerId===order.customerId&&stageDay(account.startedOn)===s.period.startDate&&account.policyVersion===s.usagePricing.policyVersion&&(account.pricingSnapshot==null?s.usagePricing.policyVersion==='USAGE_V1':canonicalHash(account.pricingSnapshot)===canonicalHash(s.usagePricing)));
 stageFact(assignment&&assignment.id===s.identity.assignmentId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===s.identity.vehicleId&&!assignment.changeId&&assignment.deliveryHandoverId&&['ACTIVE','CLOSED'].includes(assignment.status));
 const delivered=await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}),instant=(v:any)=>v==null?NaN:new Date(v).getTime();
 stageFact(delivered&&delivered.id===assignment.deliveryHandoverId&&delivered.orderId===order.id&&delivered.customerId===order.customerId&&delivered.vehicleId===assignment.vehicleId&&delivered.assignmentId===assignment.id&&!delivered.changeId&&delivered.type==='DELIVERY'&&delivered.status==='COMPLETED'&&Number.isFinite(instant(delivered.completedAt))&&Number.isFinite(instant(delivered.actualAt))&&instant(delivered.actualAt)===instant(assignment.startAt));
 stageFact(new Date(instant(assignment.startAt)+8*3600000).toISOString().slice(0,10)===s.period.startDate);
 const periods=await tx.usagePeriod.findMany({where:{accountId:account.id,orderId:order.id},orderBy:{sequence:'asc'}});
 stageFact(periods.length===s.period.months);for(const p of periods){const row=s.billingSchedule.find(r=>r.sequence===p.sequence);stageFact(row&&p.orderId===order.id&&p.accountId===account.id&&stageDay(p.startDate)===row.startDate&&stageDay(p.endDate)===row.endDate&&(p.pricingSnapshot==null?s.usagePricing.policyVersion==='USAGE_V1':canonicalHash(p.pricingSnapshot)===canonicalHash(s.usagePricing)));}
 const bills=await tx.bill.findMany({where:{orderId:order.id,customerId:order.customerId,type:'SUBSCRIPTION'},orderBy:{sequence:'asc'}});
 stageFact(bills.length===s.billingSchedule.length&&new Set(bills.map((bill:any)=>bill.sequence)).size===s.billingSchedule.length,'原订阅逐期账单来源不完整');
 for(const row of s.billingSchedule){const bill=bills.find((bill:any)=>bill.sequence===row.sequence);stageFact(bill&&bill.orderId===order.id&&bill.customerId===order.customerId&&bill.type==='SUBSCRIPTION'&&bill.amount===row.amount&&stageDay(bill.dueDate)===row.dueDate,'原订阅逐期金额或到期日与冻结来源不一致');}
 // The order CAS serializes this explicit initialization with other business commands.
 stageFact((await tx.order.updateMany({where:{id:order.id,revision:input.expectedOrderRevision},data:{revision:{increment:1}}})).count===1,'订单已变化，请重新核对初始租期');
 const i=s.identity,a=s.source.agreement,p=s.source.product;
 return tx.orderServiceStage.create({data:{id:i.serviceStageId,orderId:i.orderId,customerId:i.customerId,sequence:1,kind:'INITIAL',status:'ACTIVE',revision:0,activatedAt:delivered.completedAt,previousStageId:null,changeId:null,quoteId:null,priorTermsVersionId:a.priorTermsVersionId,termsVersionId:null,approvedArchiveVersionId:null,vehicleId:i.vehicleId,assignmentId:i.assignmentId,ownerId:i.ownerId,listingId:p?.listingId??null,productVersionId:p?.productVersionId??null,subscriptionPlanId:p?.subscriptionPlanId??null,startDate:new Date(s.period.startDate+'T00:00:00Z'),endDate:new Date(s.period.endDate+'T00:00:00Z'),months:s.period.months,firstPeriodSequence:s.period.firstPeriodSequence,lastPeriodSequence:s.period.lastPeriodSequence,...(s.serviceAnchor?{serviceAnchor:s.serviceAnchor}:{}),snapshot:s,snapshotHash:canonicalHash(s)}});
}
