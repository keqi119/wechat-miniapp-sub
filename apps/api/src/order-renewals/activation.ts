import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {dateOnly} from '../billing/rules';
import {shanghaiDay} from '../usage/rules';
import {stageDay} from '../order-service-stages/source';
import {openSegments} from '../vehicle-changes/assignments';
import {expireSwapStageFreeCredits} from '../swap-purchases/ledger';
import {readPreparedRenewalSource,requireRenewalCurrentEligibility} from './source';
import {readRenewalFunding} from './finance';

/** Read-only current activation evidence. Historical bill/source readers do not use this gate. */
export async function buildRenewalActivation(tx:any,changeId:string,now:Date){
 ensure(now instanceof Date&&Number.isFinite(now.getTime()),400,'RENEWAL_TIME_INVALID','实际办理时间无效');
 const row=await tx.orderServiceStage.findFirst({where:{changeId}});ensure(row,409,'RENEWAL_PREPARATION_REQUIRED','须先准备并安排续期');
 const source=await readPreparedRenewalSource(tx,row.id),{order,account,stage,change,quote,snapshot,previousStage,assignment}=source;
 ensure(change.id===changeId&&change.status==='SCHEDULED'&&change.activeQuoteId===quote.id&&stage.status==='SCHEDULED',409,'RENEWAL_STAGE_STATE','只有待生效续期可以显式激活');
 const eligibility=await requireRenewalCurrentEligibility(tx,source,now),funding=await readRenewalFunding(tx,source,now),today=shanghaiDay(now),blockers:string[]=[];
 if(today<snapshot.period.startDate)blockers.push('RENEWAL_NOT_STARTED');if(today>=snapshot.period.endDate)blockers.push('RENEWAL_STAGE_EXPIRED');blockers.push(...funding.blockers);
 const stages=await tx.orderServiceStage.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
 ensure(stages.every((s:any)=>s.orderId===order.id&&s.customerId===order.customerId)&&stages.filter((s:any)=>s.status==='ACTIVE').length===1&&stages.find((s:any)=>s.status==='ACTIVE')?.id===previousStage.stage.id&&stages.filter((s:any)=>['PREPARED','SCHEDULED'].includes(s.status)).length===1&&stages.find((s:any)=>['PREPARED','SCHEDULED'].includes(s.status))?.id===stage.id,409,'RENEWAL_STAGE_SOURCE','前段或未来租期来源冲突');
 ensure(stages.filter((s:any)=>s.id!==stage.id&&s.status!=='VOIDED').every((s:any)=>stageDay(s.endDate)<=snapshot.period.startDate&&s.lastPeriodSequence<snapshot.period.firstPeriodSequence),409,'RENEWAL_STAGE_SOURCE','服务段日期或月份范围重叠');
 const periods=await tx.usagePeriod.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
 ensure(periods.length>0&&periods.every((p:any)=>p.orderId===order.id&&p.accountId===account.id&&Number.isInteger(p.sequence)&&p.sequence>0&&p.sequence<snapshot.period.firstPeriodSequence&&p.serviceStageId!==stage.id)&&new Set(periods.map((p:any)=>p.sequence)).size===periods.length,409,'RENEWAL_USAGE_CONFLICT','续期月份已占用或原用量来源不完整');
 const actual=periods.filter((p:any)=>p.status!=='CANCELLED').sort((a:any,b:any)=>a.sequence-b.sequence),last=actual.at(-1);
 ensure(last&&stageDay(last.endDate)===snapshot.period.startDate&&stageDay(last.effectiveEndDate)===snapshot.period.startDate&&actual.every((p:any)=>stageDay(p.endDate)<=snapshot.period.startDate),409,'RENEWAL_USAGE_CONFLICT','原实际服务月份未连续衔接续期或已被截断');
 const terms=await tx.orderTermsVersion.findMany({where:{orderId:order.id},orderBy:{version:'asc'}}),ordered=[...terms].sort((a:any,b:any)=>a.version-b.version),head=ordered.at(-1),nextTermsVersion=(head?.version??0)+1;
 ensure((head?.id??null)===(order.effectiveTermsVersionId??null)&&terms.every((t:any)=>t.orderId===order.id&&t.quoteId!==quote.id&&Number.isInteger(t.version)&&t.version>0)&&new Set(terms.map((t:any)=>t.version)).size===terms.length&&Number.isInteger(nextTermsVersion)&&nextTermsVersion<=2147483647,409,'RENEWAL_TERMS_CONFLICT','当前条款链头或新版本已变化');
 const effectiveAt=new Date(snapshot.period.startDate+'T00:00:00+08:00');
 const previewHash=canonicalHash({today,changeRevision:change.revision,orderRevision:order.revision,accountRevision:account.revision,stageId:stage.id,stageRevision:stage.revision,previousStageRevision:previousStage.stage.revision,snapshotHash:stage.snapshotHash,nextTermsVersion,assignment:{id:assignment.id,orderId:assignment.orderId,customerId:assignment.customerId,vehicleId:assignment.vehicleId,status:assignment.status,startAt:assignment.startAt,deliveryHandoverId:assignment.deliveryHandoverId,endAt:assignment.endAt??null,returnHandoverId:assignment.returnHandoverId??null},eligibility,fundingHash:funding.sourceHash,stages:stages.map((s:any)=>({id:s.id,status:s.status,revision:s.revision,snapshotHash:s.snapshotHash})),periods:periods.map((p:any)=>({id:p.id,sequence:p.sequence,revision:p.revision,status:p.status,startDate:p.startDate,endDate:p.endDate,effectiveEndDate:p.effectiveEndDate,serviceStageId:p.serviceStageId??null}))});
 return{source,funding,blockers,previewHash,nextTermsVersion,effectiveAt,view:{changeId,revision:change.revision,orderRevision:order.revision,accountRevision:account.revision,stageId:stage.id,stageRevision:stage.revision,previousStageId:previousStage.stage.id,previousStageRevision:previousStage.stage.revision,assignmentId:assignment.id,startDate:snapshot.period.startDate,endDate:snapshot.period.endDate,effectiveAt:effectiveAt.toISOString(),periods:snapshot.billingSchedule,ready:blockers.length===0,blockers,previewHash}};
}

/** Caller checks current OPS authority, exact preview and holds the existing renewal source locks. */
export async function activateRenewalStage(tx:any,preview:Awaited<ReturnType<typeof buildRenewalActivation>>,actor:any,now:Date){
 const {source:s,effectiveAt,nextTermsVersion}=preview,{order,account,stage,previousStage,quote,snapshot,assignment}=s;
 const terms=await tx.orderTermsVersion.create({data:{orderId:order.id,quoteId:quote.id,version:nextTermsVersion,snapshot:snapshot.termsSnapshot,hash:quote.commercialHash,offlineArchiveVersionId:s.agreement.archiveVersionId,effectiveAt}});
 ensure((await tx.orderServiceStage.updateMany({where:{id:previousStage.stage.id,orderId:order.id,revision:previousStage.stage.revision,status:'ACTIVE'},data:{status:'ENDED',endedAt:now,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','前一服务段已变化');
 ensure((await tx.orderServiceStage.updateMany({where:{id:stage.id,orderId:order.id,revision:stage.revision,status:'SCHEDULED'},data:{status:'ACTIVE',activatedBy:actor.id,activatedAt:now,termsVersionId:terms.id,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','待生效服务段已变化');
 for(const p of snapshot.billingSchedule)await tx.usagePeriod.create({data:{orderId:order.id,accountId:account.id,serviceStageId:stage.id,stageSequence:p.stageSequence,sequence:p.sequence,startDate:dateOnly(p.startDate),endDate:dateOnly(p.endDate),effectiveEndDate:dateOnly(p.endDate),pricingSnapshot:snapshot.usagePricing,startReadingKm:null,endReadingKm:null}});
 await openSegments(tx,assignment,false,{serviceStageId:stage.id});
 ensure((await tx.serviceObligation.updateMany({where:{orderId:order.id,quoteId:quote.id,serviceStageId:stage.id,active:false},data:{active:true}})).count===snapshot.period.months,409,'RENEWAL_FINANCE_ROWS_MISMATCH','本段逐期义务已变化');
 ensure((await tx.order.updateMany({where:{id:order.id,revision:order.revision},data:{effectiveTermsVersionId:terms.id,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','订单已变化');
 ensure((await tx.usageAccount.updateMany({where:{id:account.id,orderId:order.id,revision:account.revision},data:{revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','用量账户已变化');
 await expireSwapStageFreeCredits(tx,{...order,effectiveTermsVersionId:terms.id},account,now);
 return terms;
}
