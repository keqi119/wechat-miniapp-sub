import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {dateOnly,storedDate} from '../asset-costs/types';
import {requireAssetFiles} from '../files/asset-files';
import {normalizeBatteryCapacity,observationDedupeKey} from './dimensions';
import {observationConfidence,type ResidualObservation} from './calculations';
import {observationCreateInput,observationListInput,observationStateInput,residualId,type ObservationFactInput} from './observation-types';
import {residualObservationCommand} from './observation-command';

export const residualModelSelect={id:true,revision:true,brand:true,name:true,modelYear:true};
export function residualModelSnapshot(model:any){return{id:model.id,revision:model.revision,brand:model.brand,name:model.name,modelYear:model.modelYear??null};}
export function observationData(input:ObservationFactInput,model:any){
 ensure(model&&model.id===input.modelDefinitionId,404,'RESIDUAL_MODEL_NOT_FOUND','请指定真实车型主数据');
 ensure(model.revision===input.modelRevision,409,'REVISION_CONFLICT','车型资料已变化，请核对版本');
 const {modelRevision,...facts}=input,modelSnapshot=residualModelSnapshot(model),sourceListingId=input.sourceListingId?.trim()||null;
 const dedupeKey=observationDedupeKey({...input,sourceListingId,brand:model.brand,model:model.name,modelYear:model.modelYear??null,series:null});
 return{...facts,sourceListingId,modelSnapshot,dedupeKey,confidenceScore:observationConfidence({...input,brand:model.brand,model:model.name}),observedOn:storedDate(input.observedOn),registrationDate:input.registrationDate?storedDate(input.registrationDate):null};
}
export function observationView(row:any){
 return{id:row.id,revision:row.revision,modelDefinitionId:row.modelDefinitionId,modelSnapshot:residualModelSnapshot(row.modelSnapshot),source:row.source,sourceListingId:row.sourceListingId??null,observedOn:dateOnly(row.observedOn),priceType:row.priceType,priceAmount:row.priceAmount,batteryOwnership:row.batteryOwnership,batteryCapacityKwh:normalizeBatteryCapacity(row.batteryCapacityKwh?.toString()),mileageKm:row.mileageKm??null,registrationDate:row.registrationDate?dateOnly(row.registrationDate):null,vehicleAgeMonths:row.vehicleAgeMonths??null,province:row.province,city:row.city,trim:row.trim,conditionGrade:row.conditionGrade,batteryHealthPercent:row.batteryHealthPercent??null,accidentFlag:row.accidentFlag??null,sourceUrl:row.sourceUrl??null,sourceNote:row.sourceNote,dedupeKey:row.dedupeKey,confidenceScore:row.confidenceScore,status:row.status,correctionOfId:row.correctionOfId??null,importBatchId:row.importBatchId??null,createdBy:row.createdBy,updatedBy:row.updatedBy,createdAt:row.createdAt,updatedAt:row.updatedAt};
}
/** Exact pure-statistics DTO; never pass ORM rows or untrusted JSON wholesale. */
export function observationForCurve(row:any):ResidualObservation{
 const view=observationView(row);return{id:view.id,revision:view.revision,status:view.status,modelDefinitionId:view.modelDefinitionId,modelYear:view.modelSnapshot.modelYear,brand:view.modelSnapshot.brand,series:null,model:view.modelSnapshot.name,trim:view.trim||null,source:view.source,sourceListingId:view.sourceListingId,observedOn:view.observedOn,registrationDate:view.registrationDate,vehicleAgeMonths:view.vehicleAgeMonths,priceType:view.priceType,priceAmount:view.priceAmount,batteryOwnership:view.batteryOwnership,batteryCapacityKwh:view.batteryCapacityKwh,mileageKm:view.mileageKm,city:view.city||null,accidentFlag:view.accidentFlag,batteryHealthPercent:view.batteryHealthPercent,confidenceScore:view.confidenceScore};
}
export class ResidualObservationsService{
 async list(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'residual-observations',false);const q=observationListInput.parse(raw),where={...(q.modelDefinitionId?{modelDefinitionId:q.modelDefinitionId}:{}),...(q.source?{source:q.source}:{}),...(q.priceType?{priceType:q.priceType}:{}),...(q.status?{status:q.status}:{}),...(q.observedFrom||q.observedTo?{observedOn:{...(q.observedFrom?{gte:storedDate(q.observedFrom)}:{}),...(q.observedTo?{lte:storedDate(q.observedTo)}:{})}}:{})};
  const [rows,total]=await Promise.all([tx.marketPriceObservation.findMany({where,orderBy:[{observedOn:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),tx.marketPriceObservation.count({where})]);return{items:rows.map(observationView),total,page:q.page,pageSize:q.pageSize};
 }
 async detail(tx:any,actor:StaffActor,rawId:unknown){
  await requireCurrentStaff(tx,actor,'residual-observations',false);const id=residualId.parse(rawId),row=await tx.marketPriceObservation.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','残值样本不存在');return{...observationView(row),files:await requireAssetFiles(tx,actor,{kind:'RESIDUAL_OBSERVATION',resourceId:id})};
 }
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=observationCreateInput.parse(raw);return residualObservationCommand(tx,actor,'residual-observations','NEW','CREATE',input,async()=>{
   await tx.$queryRaw`SELECT id FROM "ModelDefinition" WHERE id=${input.modelDefinitionId} FOR UPDATE`;
   const model=await tx.modelDefinition.findUnique({where:{id:input.modelDefinitionId},select:residualModelSelect}),{revision,idempotencyKey,...facts}=input,data=observationData(facts,model);
   if(input.correctionOfId){await tx.$queryRaw`SELECT id FROM "MarketPriceObservation" WHERE id=${input.correctionOfId} FOR UPDATE`;const old=await tx.marketPriceObservation.findUnique({where:{id:input.correctionOfId}});ensure(old?.status==='VOIDED',409,'RESIDUAL_CORRECTION','更正必须明确引用已作废的原样本');}
   ensure(!await tx.marketPriceObservation.findFirst({where:{dedupeKey:data.dedupeKey,status:{in:['ACTIVE','IGNORED']}}}),409,'RESIDUAL_DUPLICATE','该有效样本已存在');
   const row=await tx.marketPriceObservation.create({data:{...data,createdBy:actor.id,updatedBy:actor.id}}),result=observationView(row);await audit(tx,actor.id,'CREATE','residual-observations',row.id,{after:result});return result;
  });
 }
 async transition(tx:any,actor:StaffActor,rawId:unknown,action:'ignore'|'restore'|'void',raw:unknown){
  const id=residualId.parse(rawId),input=observationStateInput.parse(raw);return residualObservationCommand(tx,actor,'residual-observations',id,action.toUpperCase(),input,async()=>{
   await tx.$queryRaw`SELECT id FROM "MarketPriceObservation" WHERE id=${id} FOR UPDATE`;const row=await tx.marketPriceObservation.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','残值样本不存在');ensure(row.revision===input.revision,409,'REVISION_CONFLICT','样本资料已变化，请刷新');
   const allowed=action==='ignore'?row.status==='ACTIVE':action==='restore'?row.status==='IGNORED':action==='void'&&['ACTIVE','IGNORED'].includes(row.status);ensure(allowed,409,'RESIDUAL_STATE','当前样本状态不可执行此操作');
   const status=action==='ignore'?'IGNORED':action==='restore'?'ACTIVE':'VOIDED';
   if(action==='restore')ensure(!await tx.marketPriceObservation.findFirst({where:{dedupeKey:row.dedupeKey,status:{in:['ACTIVE','IGNORED']},id:{not:id}}}),409,'RESIDUAL_DUPLICATE','已有相同有效样本，不可恢复');
   const changed=await tx.marketPriceObservation.updateMany({where:{id,revision:input.revision,status:row.status},data:{status,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','样本资料已变化，请刷新');
   const result=observationView(await tx.marketPriceObservation.findUnique({where:{id}}));await audit(tx,actor.id,action.toUpperCase(),'residual-observations',id,{before:observationView(row),after:result,reason:input.reason});return result;
  });
 }
}
