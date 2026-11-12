import {randomUUID} from 'node:crypto';
import {audit,pagination} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {pricingCommand} from './command';
import {parameterInput,scenarioPayload,curvePayload,reviewPayload} from './types';
export type ParameterKind='SCENARIO'|'CURVE'|'REVIEW';
const view=(row:any)=>({...row,revision:row.version});
export async function listParameters(tx:any,actor:any,kind:ParameterKind,query:any={}){
 await requireCurrentStaff(tx,actor,'pricing-reference',false);const p=pagination(query),where:any={kind};
 if(query.vehicleId&&kind==='REVIEW')where.payload={path:['vehicleId'],equals:query.vehicleId};
 const [items,total]=await Promise.all([tx.pricingReferenceParameter.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:p.skip,take:p.take}),tx.pricingReferenceParameter.count({where})]);return {items:items.map(view),total,page:p.page,pageSize:p.pageSize};
}
export async function writeParameter(tx:any,actor:any,kind:ParameterKind,raw:any){
 const input=parameterInput(kind==='SCENARIO'?scenarioPayload:kind==='CURVE'?curvePayload:reviewPayload).parse(raw);
 return pricingCommand(tx,actor,input.lineageId??'NEW',kind,input,async()=>{
  const last=input.lineageId?await tx.pricingReferenceParameter.findFirst({where:{kind,lineageId:input.lineageId},orderBy:{version:'desc'}}):null;
  ensure(!input.lineageId||last,404,'NOT_FOUND','参数版本不存在');ensure(input.revision===(last?.version??0),409,'REVISION_CONFLICT','参数已更新，请刷新');
  if(kind==='REVIEW'){const payload=input.payload as any;ensure(await tx.vehicle.count({where:{id:payload.vehicleId}}),404,'NOT_FOUND','车辆不存在');ensure(!last||last.payload.vehicleId===payload.vehicleId,400,'REVIEW_SCOPE_IMMUTABLE','更正不能改变车辆范围');
   if(payload.curveId)ensure(await tx.pricingReferenceParameter.count({where:{id:payload.curveId,kind:'CURVE'}}),400,'CURVE_NOT_FOUND','指定曲线不存在');}
  if(kind==='CURVE')ensure(await tx.modelDefinition.count({where:{id:(input.payload as any).modelDefinitionId}}),404,'NOT_FOUND','车型不存在');
  const result=await tx.pricingReferenceParameter.create({data:{kind,lineageId:input.lineageId??randomUUID(),version:(last?.version??0)+1,payload:input.payload,createdBy:actor.id}});
  await audit(tx,actor.id,'CREATE_'+kind+'_VERSION','pricing-reference',result.id,{lineageId:result.lineageId,version:result.version});return view(result);
 });
}
