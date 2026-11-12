import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {dateOnly} from '../asset-costs/types';
import {readWork,readWorkCost} from './command';
import {workCostCategory} from './types';

export function assertWorkCostCategory(work:any,category:string){workCostCategory.parse(category);ensure(work.kind==='MAINTENANCE'?category==='MAINTENANCE':['REPAIR','ACCIDENT_REPAIR'].includes(work.kind)&&['REPAIR','TOWING'].includes(category),409,'WORK_COST_CATEGORY','费用类别与真实工单类型不符');}
export async function acceptanceFact(tx:any,work:any,eventId:string,acceptedRevision:number){
 ensure(typeof eventId==='string'&&eventId.length>0&&Number.isInteger(acceptedRevision)&&acceptedRevision>0,409,'WORK_ORDER_ACCEPTANCE_INVALID','缺少真实验收事件及版本');
 const event=await tx.assetWorkOrderEvent.findUnique({where:{id:eventId}}),detail=event?.detailSnapshot;
 ensure(event&&event.workOrderId===work.id&&event.action==='ACCEPT'&&Number.isInteger(event.beforeRevision)&&event.afterRevision===event.beforeRevision+1&&event.afterRevision===acceptedRevision&&typeof event.actorId==='string'&&event.actorId.length>0&&detail?.version===1&&detail.eventId===event.id&&detail.workOrderId===work.id&&detail.vehicleId===work.vehicleId&&detail.status==='PENDING_COST_CONFIRMATION'&&typeof detail.submissionEventId==='string'&&Number.isInteger(detail.submissionRevision)&&Array.isArray(detail.evidence)&&detail.evidence.length>0&&event.sourceHash===canonicalHash(detail),409,'WORK_ORDER_ACCEPTANCE_INVALID','费用来源缺少真实、完整的运营验收事件');
 return event;
}
export async function assertWorkSourceCurrent(tx:any,source:any){
 requireCurrentFrozenAcceptance(source);
 ensure(!await tx.assetWorkOrderCost.count({where:{replacesCostId:source.id}}),409,'WORK_COST_REPLACEMENT_EXISTS','原费用已被明确替代，不得重新确认或重开');
 await assertReplacement(tx,source.record.workOrder,source.record.replacesCostId??null,source.id);
}
export async function currentAcceptance(tx:any,work:any){
 ensure(work.status==='PENDING_COST_CONFIRMATION'&&work.costConfirmationRequired===true,409,'WORK_ORDER_COST_STATE','只有待财务确认的有成本工单可冻结费用');
 const event=await acceptanceFact(tx,work,work.acceptedEventId,work.acceptedRevision),{status,...snapshot}=event.detailSnapshot;
 ensure(work.acceptedBy===event.actorId&&work.acceptedAt&&new Date(work.acceptedAt).getTime()===new Date(event.actorAt).getTime()&&canonicalHash(work.acceptanceSnapshot)===canonicalHash(snapshot),409,'WORK_ORDER_ACCEPTANCE_INVALID','工单验收指针与真实事件不一致');return event;
}
export function requireCurrentFrozenAcceptance(source:any){
 const work=source.record.workOrder,snapshot=source.terms;
 ensure(work?.status==='PENDING_COST_CONFIRMATION'&&work.costConfirmationRequired===true,409,'WORK_ORDER_COST_STATE','工单须处于待财务确认状态');
 ensure(work.acceptedEventId===snapshot.acceptedEventId&&work.acceptedRevision===snapshot.acceptedRevision,409,'WORK_ORDER_ACCEPTANCE_CHANGED','验收已变化，请作废旧未入账计划并新建明确替代来源');
 const {status,...accepted}=snapshot.acceptedSnapshot;
 ensure(canonicalHash(work.acceptanceSnapshot)===canonicalHash(accepted)&&work.acceptedBy===source.record.acceptedEvent.actorId&&work.acceptedAt&&new Date(work.acceptedAt).getTime()===new Date(source.record.acceptedEvent.actorAt).getTime(),409,'WORK_ORDER_ACCEPTANCE_INVALID','当前验收与冻结事实不一致');
}
const parents=['baasContractId','depreciationPolicyId','costEntryId','licensePlateId','observationId','valuationReviewId','workOrderId','workOrderCostId'];
/** Internal immutable-proof verification. Public callers separately check current financial permission. */
async function validateFrozenEvidence(tx:any,line:any,snapshot:any){
 const proofs=snapshot.evidence;ensure(Array.isArray(proofs)&&proofs.length>0&&new Set(proofs.map((item:any)=>item.id)).size===proofs.length,409,'COST_SOURCE_MISMATCH','冻结费用缺少证据');
 const rows=await tx.assetPrivateFile.findMany({where:{workOrderCostId:line.id},include:{file:true},orderBy:{fileId:'asc'}});
 ensure(rows.length===proofs.length,409,'COST_SOURCE_MISMATCH','冻结后的费用证据集合变化');
 for(const binding of rows){const file=binding.file,proof=proofs.find((item:any)=>item.id===binding.fileId);ensure(proof&&binding.kind==='WORK_ORDER_COST'&&parents.every(field=>field==='workOrderCostId'?binding[field]===line.id:binding[field]===null)&&file&&file.id===binding.fileId&&file.customerId===null&&!file.fieldTaskId&&file.adminId===binding.uploadedBy&&file.purpose==='asset-work-order-cost'&&/^[a-f0-9]{64}$/.test(file.sha256)&&binding.sha256===file.sha256&&proof.sha256===file.sha256&&proof.size===file.size&&proof.mimeType===file.mimeType,409,'COST_SOURCE_MISMATCH','费用证据与冻结归属或摘要不符');}
}
export async function frozenWorkCostSource(tx:any,id:string){
 const line=await readWorkCost(tx,id),work=await readWork(tx,line.workOrderId),snapshot=line.sourceSnapshot;
 ensure(line.status==='FROZEN'&&line.frozenAt&&line.frozenBy&&line.vehicleId===work.vehicleId&&snapshot?.version===1&&snapshot.sourceKind==='WORK_ORDER'&&snapshot.sourceId===line.id&&snapshot.workOrderId===work.id&&snapshot.vehicleId===work.vehicleId&&snapshot.sourceRevision===line.revision&&snapshot.evidenceRevision===line.revision-1&&line.sourceHash===canonicalHash(snapshot),409,'COST_SOURCE_MISMATCH','费用来源未冻结或摘要不符');
 assertWorkCostCategory(work,line.category);
 ensure(Number.isInteger(line.amount)&&line.amount>0&&line.amount<=2147483647&&snapshot.category===line.category&&snapshot.amount===line.amount&&snapshot.occurredOn===dateOnly(line.occurredOn)&&snapshot.supplierName===line.supplierName&&snapshot.referenceNo===line.referenceNo&&snapshot.reason===line.reason&&snapshot.replacesCostId===(line.replacesCostId??null),409,'COST_SOURCE_MISMATCH','费用事实与冻结原文不一致');
 const event=await acceptanceFact(tx,work,snapshot.acceptedEventId,snapshot.acceptedRevision);ensure(snapshot.acceptedEventHash===event.sourceHash&&canonicalHash(snapshot.acceptedSnapshot)===event.sourceHash,409,'WORK_ORDER_ACCEPTANCE_INVALID','冻结验收与原事件不一致');
 await validateFrozenEvidence(tx,line,snapshot);
 return{sourceKind:'WORK_ORDER' as const,id:line.id,vehicleId:line.vehicleId,revision:line.revision,status:line.status,activatedAt:line.frozenAt,termsHash:line.sourceHash,terms:snapshot,record:{...line,workOrder:work,acceptedEvent:event}};
}
export function validWorkPlan(plan:any,source:any){
 const snapshot=source.terms,date=snapshot.occurredOn;
 ensure(plan.sourceKind==='WORK_ORDER'&&plan.workOrderCostId===source.id&&!plan.baasContractId&&!plan.depreciationPolicyId&&plan.vehicleId===source.vehicleId&&plan.sourceRevision===source.revision&&plan.sourceHash===source.termsHash&&canonicalHash(plan.sourceSnapshot)===source.termsHash&&plan.amount===snapshot.amount&&plan.costPeriod===date.slice(0,7)&&dateOnly(plan.periodStart)===date&&dateOnly(plan.periodEnd)===date&&plan.dueDate===null,409,'COST_SOURCE_MISMATCH','工单成本计划与冻结费用事实不一致');
}
export function validWorkEntry(entry:any,plan:any){
 ensure(entry.effect==='COST'&&plan.status==='CONFIRMED'&&entry.planId===plan.id&&entry.vehicleId===plan.vehicleId&&entry.sourceKey==='cost-plan:'+plan.id&&entry.category===plan.sourceSnapshot.category&&entry.amount===plan.amount&&dateOnly(entry.periodStart)===dateOnly(plan.periodStart)&&dateOnly(entry.periodEnd)===dateOnly(plan.periodEnd)&&entry.sourceHash===plan.sourceHash&&canonicalHash(entry.sourceSnapshot)===plan.sourceHash,409,'COST_SOURCE_MISMATCH','工单成本分录与冻结计划不一致');
}
export function validWorkReversal(reversal:any,entry:any){ensure(reversal&&reversal.effect==='REVERSAL'&&reversal.reversalOfId===entry.id&&reversal.planId===entry.planId&&reversal.vehicleId===entry.vehicleId&&reversal.amount===entry.amount&&reversal.category===entry.category&&reversal.sourceHash===entry.sourceHash&&canonicalHash(reversal.sourceSnapshot)===entry.sourceHash&&dateOnly(reversal.periodStart)===dateOnly(entry.periodStart)&&dateOnly(reversal.periodEnd)===dateOnly(entry.periodEnd),409,'COST_SOURCE_MISMATCH','冲正须为原始成本的完整同源反向事实');}
export async function assertReplacement(tx:any,work:any,replacesCostId:string|null,currentLineId?:string){
 if(!replacesCostId)return;
 const source=await frozenWorkCostSource(tx,replacesCostId);ensure(source.vehicleId===work.vehicleId&&source.record.workOrderId===work.id,409,'WORK_COST_REPLACEMENT_REQUIRED','替代来源必须属于同一工单及车辆');
 ensure(!await tx.assetWorkOrderCost.count({where:{replacesCostId,...(currentLineId?{id:{not:currentLineId}}:{})}}),409,'WORK_COST_REPLACEMENT_EXISTS','原费用已有明确替代行');
 const plans=await tx.assetCostPlan.findMany({where:{workOrderCostId:replacesCostId}});ensure(plans.length===1,409,'WORK_COST_REPLACEMENT_REQUIRED','原费用须有唯一冻结计划');const plan=plans[0];validWorkPlan(plan,source);
 const entries=await tx.assetCostEntry.findMany({where:{planId:plan.id}});
 if(!entries.length)ensure(plan.status==='VOIDED',409,'WORK_COST_REPLACEMENT_REQUIRED','未入账原计划必须先明确作废');
 else{const originals=entries.filter((entry:any)=>entry.effect==='COST'),reversals=entries.filter((entry:any)=>entry.effect==='REVERSAL');ensure(originals.length===1&&reversals.length===1,409,'WORK_COST_REPLACEMENT_REQUIRED','已入账原费用必须先完整冲正');validWorkEntry(originals[0],plan);validWorkReversal(reversals[0],originals[0]);}
}
