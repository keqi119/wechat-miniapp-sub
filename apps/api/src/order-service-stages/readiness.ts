import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {parseStageRow,stageDay,stageFact} from './source';
import type {StageRead} from './types';

/** Internal read validation, not a replacement for current staff/customer or paper readiness gates. */
export async function readServiceStage(tx:any,order:any,id:string):Promise<StageRead>{
 const row=await tx.orderServiceStage.findUnique({where:{id}});stageFact(row,'服务租期不存在或来源缺失');const result=parseStageRow(row,order);
 if(result.snapshot.kind==='RENEWAL'&&['ACTIVE','ENDED'].includes(row.status)){
  const terms=await tx.orderTermsVersion.findFirst({where:{id:row.termsVersionId,orderId:order.id,quoteId:row.quoteId}});
  stageFact(terms&&terms.id===row.termsVersionId&&terms.orderId===order.id&&terms.quoteId===row.quoteId&&terms.hash===result.snapshot.source.agreement.commercialHash&&canonicalHash(terms.snapshot)===canonicalHash(result.snapshot.termsSnapshot),'服务租期与已生效条款版本不一致');
 }
 return result;
}
export async function readServiceStageAt(tx:any,order:any,on:string):Promise<StageRead>{
 const date=stageDay(on),rows=await tx.orderServiceStage.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
 const candidates=rows.filter((r:any)=>r.orderId===order.id&&['ACTIVE','ENDED'].includes(r.status)&&stageDay(r.startDate)<=date&&date<stageDay(r.endDate));
 ensure(candidates.length===1,409,'SERVICE_STAGE_ACTIVATION_REQUIRED',candidates.length?'服务租期范围存在冲突，请人工核对':'该日期没有已生效服务租期，请先完成续期核对并显式生效');
 return readServiceStage(tx,order,candidates[0].id);
}
export async function readPeriodServiceStage(tx:any,order:any,account:any,period:any):Promise<StageRead>{
 stageFact(typeof period.serviceStageId==='string'&&period.serviceStageId&&period.orderId===order.id&&period.accountId===account.id);
 const result=await readServiceStage(tx,order,period.serviceStageId),s=result.snapshot;
 stageFact(['ACTIVE','ENDED'].includes(result.stage.status),'尚未生效的服务租期不能用于月度计价');
 const row=s.billingSchedule.find(r=>r.sequence===period.sequence&&r.stageSequence===period.stageSequence);
 stageFact(row&&stageDay(period.startDate)===row.startDate&&stageDay(period.endDate)===row.endDate&&canonicalHash(period.pricingSnapshot)===canonicalHash(s.usagePricing),'服务月日期、序号或冻结价格与租期不符');
 return result;
}
