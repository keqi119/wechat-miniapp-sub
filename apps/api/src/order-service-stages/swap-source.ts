import {ensure} from '../common/errors';
import {HttpException} from '@nestjs/common';
import {canonicalHash} from '../customers/types';
import {day,periods,shanghaiDay} from '../usage/rules';
import {freezeSwapPolicy,type SwapTermPolicy} from '../swap-purchases/policy';
import {readServiceStage} from './readiness';
import {stageDay} from './source';

export type SwapSource={kind:'INITIAL'|'RENEWAL';serviceStageId:string|null;stageSourceHash:string|null;policy:SwapTermPolicy|null;startAt:Date;endAt:Date;stageStatus:'ACTIVE'|'ENDED'};
const boundary=(date:string)=>new Date(date+'T00:00:00+08:00');
function accountOwner(order:any,account:any){ensure(order?.id&&account?.orderId===order.id&&account.customerId===order.customerId,409,'SWAP_STAGE_SOURCE','次数租期与订单客户或用量账户不符');}
function originalSource(order:any,account:any,status:'ACTIVE'|'ENDED'='ACTIVE'):SwapSource{
 accountOwner(order,account);const start=stageDay(account.startedOn),months=order.finalPlanSnapshot?.months;
 ensure(Number.isSafeInteger(months)&&months>0&&months<=120,409,'SWAP_STAGE_SOURCE','原订阅期限来源缺失');const schedule=periods(start,months);
 return{kind:'INITIAL',serviceStageId:null,stageSourceHash:null,policy:freezeSwapPolicy(order),startAt:boundary(start),endAt:boundary(day(schedule.at(-1)!.endDate)),stageStatus:status};
}
/** Every paid row is verified against its own immutable source, never the current product. */
export async function readHistoricalSwapSource(tx:any,order:any,account:any,serviceStageId:string|null|undefined):Promise<SwapSource>{
 accountOwner(order,account);
 if(serviceStageId==null)return originalSource(order,account);
 ensure(typeof serviceStageId==='string'&&serviceStageId.trim()===serviceStageId&&serviceStageId.length>0&&!serviceStageId.includes('\0'),409,'SWAP_STAGE_SOURCE','次数租期标识无效');
 const read=await readServiceStage(tx,order,serviceStageId),s=read.snapshot;
 if(read.stage.status==='VOIDED'&&read.stage.termsVersionId){await(await import('../order-renewals/cancellation-v31')).requireV31CorrectedTerms(tx,read.stage.changeId,await tx.orderTermsVersion.findUniqueOrThrow({where:{id:read.stage.termsVersionId}}));return{kind:'RENEWAL',serviceStageId:read.stage.id,stageSourceHash:read.stage.snapshotHash,policy:s.swapPolicy,startAt:boundary(s.period.startDate),endAt:boundary(s.period.endDate),stageStatus:'ENDED'};}
 ensure(s.kind==='RENEWAL'&&['ACTIVE','ENDED'].includes(read.stage.status),409,'SWAP_STAGE_SOURCE','次数必须引用真实已生效的续期；初始历史次数保留原空来源');
 return{kind:'RENEWAL',serviceStageId:read.stage.id,stageSourceHash:read.stage.snapshotHash,policy:s.swapPolicy,startAt:boundary(s.period.startDate),endAt:boundary(s.period.endDate),stageStatus:read.stage.status};
}
/** New rights require the one explicitly ACTIVE stage covering the actual Shanghai date. */
export async function readSwapSourceAt(tx:any,order:any,account:any,at:Date):Promise<SwapSource>{
 accountOwner(order,account);ensure(at instanceof Date&&Number.isFinite(at.getTime()),409,'SWAP_STAGE_SOURCE','实际次数日期无效');
 const date=shanghaiDay(at),rows=await tx.orderServiceStage.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
 ensure(rows.every((r:any)=>r.orderId===order.id&&r.customerId===order.customerId),409,'SWAP_STAGE_SOURCE','次数租期归属不一致');
 const candidates=rows.filter((r:any)=>r.status!=='VOIDED'&&stageDay(r.startDate)<=date&&date<stageDay(r.endDate));
 if(!candidates.length){const source=originalSource(order,account);ensure(!rows.some((r:any)=>r.kind==='INITIAL')&&at>=source.startAt&&at<source.endAt,409,'SWAP_STAGE_ACTIVATION_REQUIRED','该日期没有已生效的服务租期');return source;}
 ensure(candidates.length===1&&candidates[0].status==='ACTIVE',409,'SWAP_STAGE_ACTIVATION_REQUIRED','该日期的服务租期未显式生效或范围冲突');
 const read=await readServiceStage(tx,order,candidates[0].id);
 if(read.snapshot.kind==='INITIAL'){const source=originalSource(order,account);ensure(source.startAt.getTime()===boundary(read.snapshot.period.startDate).getTime()&&source.endAt.getTime()===boundary(read.snapshot.period.endDate).getTime()&&canonicalHash(source.policy)===canonicalHash(read.snapshot.swapPolicy),409,'SWAP_STAGE_SOURCE','初始租期不得改变原政策或有效期');return source;}
 return readHistoricalSwapSource(tx,order,account,read.stage.id);
}
export function withinSwapSource(order:any,account:any,source:SwapSource,at:Date){return order.status==='ACTIVE'&&!account.returnedOn&&source.stageStatus==='ACTIVE'&&at>=source.startAt&&at<source.endAt;}
/** Historical projection stays available when the next stage awaits explicit activation. */
export async function readSwapSourceProjection(tx:any,order:any,account:any,at:Date){
 let source:SwapSource;const blockers:string[]=[];
 try{source=await readSwapSourceAt(tx,order,account,at);}catch(error){
  if(!(error instanceof HttpException&&(error.getResponse() as any).error?.code==='SWAP_STAGE_ACTIVATION_REQUIRED'))throw error;
  blockers.push((error.getResponse() as any).error.message);const rows=await tx.orderServiceStage.findMany({where:{orderId:order.id,status:{in:['ACTIVE','ENDED']}},orderBy:{sequence:'desc'}}),date=shanghaiDay(at);
  const latest=rows.filter((r:any)=>['ACTIVE','ENDED'].includes(r.status)&&stageDay(r.startDate)<=date).sort((a:any,b:any)=>b.sequence-a.sequence)[0];
  source=latest?.kind==='RENEWAL'?await readHistoricalSwapSource(tx,order,account,latest.id):originalSource(order,account);source={...source,stageStatus:'ENDED'};
 }
 try{await requireNoConfirmedFutureSwap(tx,order);}catch(error){if(!(error instanceof HttpException&&(error.getResponse() as any).error?.code==='SWAP_FUTURE_STAGE_CONFIRMED'))throw error;blockers.push((error.getResponse() as any).error.message);}
 if(source.serviceStageId){const stage=await tx.orderServiceStage.findUnique({where:{id:source.serviceStageId}});if(stage?.changeId)try{await(await import('../order-renewals/cancellation-state')).assertRenewalNotCancelling(tx,stage.changeId);}catch(error){if(!(error instanceof HttpException&&(error.getResponse() as any).error?.code==='RENEWAL_CANCELLATION_IN_PROGRESS'))throw error;blockers.push('RENEWAL_CANCELLATION_IN_PROGRESS');}}
 return{source,blockers};
}
/** Confirmation already freezes the future vehicle, even before an archive or stage row exists. */
export async function requireNoConfirmedFutureSwap(tx:any,order:any){
 const stages=await tx.orderServiceStage.findMany({where:{orderId:order.id,status:{in:['PREPARED','SCHEDULED']}}});
 for(const stage of stages){ensure(stage.orderId===order.id&&stage.customerId===order.customerId,409,'SWAP_STAGE_SOURCE','未来租期归属不一致');if(['PREPARED','SCHEDULED'].includes(stage.status))ensure(false,409,'SWAP_FUTURE_STAGE_CONFIRMED','已确认未来续期，须先核对该同车安排，不能新增换车或次数购买');}
 const changes=await tx.orderChange.findMany({where:{orderId:order.id,kind:'SUBSCRIPTION_EXTENSION',status:{notIn:['APPLIED','CANCELLED','REJECTED']}}});
 for(const change of changes){ensure(change.orderId===order.id&&change.customerId===order.customerId&&change.kind==='SUBSCRIPTION_EXTENSION',409,'SWAP_STAGE_SOURCE','未来续期变更归属不一致');if(['APPLIED','CANCELLED','REJECTED'].includes(change.status))continue;
  if(!change.activeQuoteId){ensure(['DRAFT','REVIEW_PENDING','REVIEWED','AWAITING_CONFIRMATION'].includes(change.status),409,'SWAP_STAGE_SOURCE','已确认未来续期缺少真实报价');continue;}
  const quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}});ensure(quote?.id===change.activeQuoteId&&quote.changeId===change.id,409,'SWAP_STAGE_SOURCE','未来续期当前报价来源不符');
  if(quote.confirmedAt||['AWAITING_ARCHIVE','AWAITING_FINANCE','PREPARED','SCHEDULED'].includes(change.status))ensure(false,409,'SWAP_FUTURE_STAGE_CONFIRMED','客户已确认未来同车续期，不能新增换车或次数购买');
 }
}
