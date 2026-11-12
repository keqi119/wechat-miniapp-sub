import {HttpException} from '@nestjs/common';
import {z,ZodError} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {dateOnly,storedDate} from '../asset-costs/types';
import {shanghaiDay} from '../usage/rules';
import {buildResidualCurve,RESIDUAL_ALGORITHM_VERSION,RESIDUAL_REFERENCE_COMMIT,type ResidualCurveResult,type ResidualObservation} from './calculations';
import {normalizeBatteryCapacity,normalizeResidualDimension,residualDimensionHash} from './dimensions';
import {curveIdInput,curveActivateInput,curveArchiveInput,curveCreateInput,curveListInput,curvePreviewInput,type CurvePreviewInput} from './curve-types';
import {lockCurveDimension,lockCurves,residualCurveCommand} from './curve-command';

const include={points:{orderBy:{ageMonth:'asc'}}};
const modelSnapshotSchema=z.object({id:z.string().min(1),revision:z.number().int().min(0).max(2147483647),brand:z.string().trim().min(1),name:z.string().trim().min(1),modelYear:z.number().int().min(1900).max(2100).nullable()});
/** Explicit DB -> pure DTO: immutable model labels, canonical dates/Decimal,
 * no client-supplied model text or unrelated observation/private file fields. */
function observationForCurve(row:any):ResidualObservation{
 const model=modelSnapshotSchema.parse(row.modelSnapshot);ensure(model.id===row.modelDefinitionId,409,'RESIDUAL_SOURCE_INVALID','样本车型快照与关联不一致');
 return{id:row.id,revision:row.revision,status:row.status,modelDefinitionId:row.modelDefinitionId,modelYear:model.modelYear,brand:model.brand,series:null,model:model.name,trim:row.trim||null,source:row.source,sourceListingId:row.sourceListingId??null,observedOn:dateOnly(row.observedOn),registrationDate:row.registrationDate?dateOnly(row.registrationDate):null,vehicleAgeMonths:row.vehicleAgeMonths??null,priceType:row.priceType,priceAmount:row.priceAmount,batteryOwnership:row.batteryOwnership,batteryCapacityKwh:normalizeBatteryCapacity(row.batteryCapacityKwh?.toString()),mileageKm:row.mileageKm??null,city:row.city||null,accidentFlag:row.accidentFlag??null,batteryHealthPercent:row.batteryHealthPercent??null,confidenceScore:row.confidenceScore??null};
}
const pointFields=['ageMonth','sampleCount','medianPriceAmount','p25PriceAmount','p75PriceAmount','averagePriceAmount','minPriceAmount','maxPriceAmount','predictedResidualRateBps','confidenceScore'] as const;
function frozenPoints(calculated:ResidualCurveResult){return calculated.points.map(point=>({...Object.fromEntries(pointFields.map(field=>[field,point[field]])),sampleSnapshot:point.sampleObservationIds.map(id=>{const source=calculated.sourceSnapshot.observations.find(row=>row.id===id)!;return{observationId:id,revision:source.revision,priceAmount:source.priceAmount,sourceHash:canonicalHash(source)};})}));}
function curveView(row:any){return{id:row.id,revision:row.revision,modelDefinitionId:row.modelDefinitionId,name:row.name,status:row.status,dimensionHash:row.dimensionHash,dimensionSnapshot:row.dimensionSnapshot,filterSnapshot:row.filterSnapshot,referencePriceAmount:row.referencePriceAmount??null,algorithmVersion:row.algorithmVersion,referenceCommit:row.referenceCommit,sourceHash:row.sourceHash,pointCount:row.pointCount,sampleCount:row.sampleCount,confidenceScore:row.confidenceScore,skippedReasons:row.skippedReasons,effectiveFrom:row.effectiveFrom?dateOnly(row.effectiveFrom):null,activatedAt:row.activatedAt??null,activatedBy:row.activatedBy??null,supersededAt:row.supersededAt??null,archivedAt:row.archivedAt??null,createdAt:row.createdAt,updatedAt:row.updatedAt};}
export function validateFrozen(row:any){
 try{
  const source=row.sourceSnapshot;ensure(source?.version===1&&source.algorithmVersion===RESIDUAL_ALGORITHM_VERSION&&source.referenceCommit===RESIDUAL_REFERENCE_COMMIT&&row.algorithmVersion===source.algorithmVersion&&row.referenceCommit===source.referenceCommit&&canonicalHash(source)===row.sourceHash,409,'RESIDUAL_SOURCE_INVALID','曲线来源摘要无效');
  const calculated=buildResidualCurve({dimension:source.dimension,modelRevision:source.modelRevision,observations:source.observations,...source.filters});
  ensure(calculated.sourceHash===row.sourceHash&&source.dimension.modelDefinitionId===row.modelDefinitionId&&residualDimensionHash(source.dimension)===row.dimensionHash&&canonicalHash(source.dimension)===canonicalHash(row.dimensionSnapshot)&&canonicalHash(source.filters)===canonicalHash(row.filterSnapshot)&&source.filters.referencePriceAmount===(row.referencePriceAmount??null),409,'RESIDUAL_SOURCE_INVALID','曲线冻结维度或筛选条件不一致');
  ensure(calculated.points.length>0&&row.pointCount===calculated.points.length&&row.sampleCount===calculated.sampleCount&&row.confidenceScore===calculated.confidenceScore&&canonicalHash(row.skippedReasons)===canonicalHash(calculated.skippedReasons),409,'RESIDUAL_SOURCE_INVALID','曲线统计摘要不一致');
  const stored=[...row.points].sort((a,b)=>a.ageMonth-b.ageMonth).map(point=>({...Object.fromEntries(pointFields.map(field=>[field,point[field]])),sampleSnapshot:point.sampleSnapshot}));ensure(canonicalHash(stored)===canonicalHash(frozenPoints(calculated)),409,'RESIDUAL_SOURCE_INVALID','曲线点或样本证据与冻结原计算不一致');return calculated;
 }catch(error){if(error instanceof ZodError||error instanceof HttpException)ensure(false,409,'RESIDUAL_SOURCE_INVALID','曲线冻结来源、点或样本证据无效');throw error;}
}

export class ResidualCurvesService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async read(tx:any,id:string){curveIdInput.parse(id);const row=await tx.vehicleResidualCurve.findUnique({where:{id},include});ensure(row,404,'NOT_FOUND','残值曲线不存在');return row;}
 private async calculate(tx:any,input:CurvePreviewInput,sourceChanged=false){
  const model=await tx.modelDefinition.findUnique({where:{id:input.modelDefinitionId}});ensure(model,sourceChanged?409:404,sourceChanged?'SOURCE_CHANGED':'NOT_FOUND','车型不存在，请重新选择');ensure(model.revision===input.modelRevision,409,sourceChanged?'SOURCE_CHANGED':'REVISION_CONFLICT',sourceChanged?'曲线来源已变化，请新建草稿':'车型版本已变化，请重新预览');
  const dimension=normalizeResidualDimension({modelDefinitionId:model.id,modelYear:model.modelYear??null,trim:input.trim,batteryOwnership:input.batteryOwnership,batteryCapacityKwh:input.batteryCapacityKwh});
  const observations=await tx.marketPriceObservation.findMany({where:{modelDefinitionId:model.id,status:'ACTIVE'},orderBy:{id:'asc'}}),calculated=buildResidualCurve({dimension,modelRevision:model.revision,observations:observations.map(observationForCurve),priceTypes:input.priceTypes,minSamplePerPoint:input.minSamplePerPoint,referencePriceAmount:input.referencePriceAmount,sampleStartDate:input.sampleStartDate,sampleEndDate:input.sampleEndDate});
  return{name:input.name,modelDefinitionId:model.id,modelRevision:model.revision,dimensionHash:residualDimensionHash(dimension),dimensionSnapshot:dimension,filterSnapshot:calculated.sourceSnapshot.filters,...calculated,pointCount:calculated.points.length,previewHash:canonicalHash({version:1,name:input.name,sourceHash:calculated.sourceHash})};
 }
 async preview(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'residual-curves',false);return this.calculate(tx,curvePreviewInput.parse(raw));}
 async list(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'residual-curves',false);const input=curveListInput.parse(raw),where={...(input.modelDefinitionId?{modelDefinitionId:input.modelDefinitionId}:{}),...(input.status?{status:input.status}:{})};
  const [rows,total]=await Promise.all([tx.vehicleResidualCurve.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.vehicleResidualCurve.count({where})]);return{items:rows.map(curveView),total,page:input.page,pageSize:input.pageSize};
 }
 async detail(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'residual-curves',false);const row=await this.read(tx,id);validateFrozen(row);return{...curveView(row),sourceSnapshot:row.sourceSnapshot,points:row.points.map((point:any)=>({id:point.id,...Object.fromEntries(pointFields.map(field=>[field,point[field]])),sampleSnapshot:point.sampleSnapshot}))};}
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=curveCreateInput.parse(raw);return residualCurveCommand(tx,actor,'NEW','CREATE_RESIDUAL_CURVE',input,async()=>{
   await tx.$queryRaw`SELECT id FROM "ModelDefinition" WHERE id=${input.modelDefinitionId} FOR UPDATE`;
   const {revision,idempotencyKey,previewHash,...request}=input,preview=await this.calculate(tx,request);ensure(preview.previewHash===previewHash,409,'PREVIEW_CHANGED','预览来源已变化，请重新核对');ensure(preview.points.length>0,409,'RESIDUAL_NO_POINTS','没有满足条件的有效曲线点');
   const row=await tx.vehicleResidualCurve.create({data:{modelDefinitionId:input.modelDefinitionId,name:input.name,status:'DRAFT',dimensionHash:preview.dimensionHash,dimensionSnapshot:preview.dimensionSnapshot,filterSnapshot:preview.filterSnapshot,referencePriceAmount:input.referencePriceAmount,algorithmVersion:preview.algorithmVersion,referenceCommit:preview.referenceCommit,sourceSnapshot:preview.sourceSnapshot,sourceHash:preview.sourceHash,pointCount:preview.pointCount,sampleCount:preview.sampleCount,confidenceScore:preview.confidenceScore,skippedReasons:preview.skippedReasons,createdBy:actor.id,updatedBy:actor.id}});
   for(const point of frozenPoints(preview))await tx.vehicleResidualCurvePoint.create({data:{curveId:row.id,...point}});
   await audit(tx,actor.id,'CREATE_RESIDUAL_CURVE','residual-curves',row.id,{sourceHash:row.sourceHash,dimensionHash:row.dimensionHash,pointCount:row.pointCount});return this.detail(tx,actor,row.id);
  });
 }
 async activate(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=curveActivateInput.parse(raw);curveIdInput.parse(id);return residualCurveCommand(tx,actor,id,'ACTIVATE_RESIDUAL_CURVE',input,async()=>{
   const before=await this.read(tx,id);await lockCurveDimension(tx,before.dimensionHash);const current=await tx.vehicleResidualCurve.findMany({where:{dimensionHash:before.dimensionHash,status:'ACTIVE'}});await lockCurves(tx,[id,...current.map((row:any)=>row.id)]);const row=await this.read(tx,id);
   ensure(row.dimensionHash===before.dimensionHash&&row.revision===input.revision,409,'REVISION_CONFLICT','曲线版本已变化');ensure(row.status==='DRAFT',409,'RESIDUAL_CURVE_STATE','只有草稿曲线可以首次生效');const now=this.clock();ensure(input.effectiveFrom===shanghaiDay(now),409,'RESIDUAL_EFFECTIVE_DATE','生效日期必须为上海今天');const frozen=validateFrozen(row);
   const source=frozen.sourceSnapshot,live=await this.calculate(tx,curvePreviewInput.parse({modelDefinitionId:row.modelDefinitionId,modelRevision:source.modelRevision,name:row.name,trim:source.dimension.trim,batteryOwnership:source.dimension.batteryOwnership,batteryCapacityKwh:source.dimension.batteryCapacityKwh,...source.filters}),true);ensure(live.sourceHash===row.sourceHash,409,'SOURCE_CHANGED','样本或车型来源已变化，请新建曲线草稿');
   ensure(current.length<=1,409,'RESIDUAL_ACTIVE_CONFLICT','同维度存在多条生效曲线，请核查');for(const old of current){validateFrozen(await this.read(tx,old.id));const changed=await tx.vehicleResidualCurve.updateMany({where:{id:old.id,revision:old.revision,status:'ACTIVE',dimensionHash:row.dimensionHash},data:{status:'SUPERSEDED',supersededAt:now,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','原生效曲线已变化');await audit(tx,actor.id,'SUPERSEDE_RESIDUAL_CURVE','residual-curves',old.id,{successorId:id,reason:input.reason,revision:old.revision+1});}
   const changed=await tx.vehicleResidualCurve.updateMany({where:{id,revision:input.revision,status:'DRAFT'},data:{status:'ACTIVE',effectiveFrom:storedDate(input.effectiveFrom),activatedAt:now,activatedBy:actor.id,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','曲线已变化');await audit(tx,actor.id,'ACTIVATE_RESIDUAL_CURVE','residual-curves',id,{reason:input.reason,revision:input.revision+1,sourceHash:row.sourceHash,effectiveFrom:input.effectiveFrom});return this.detail(tx,actor,id);
  });
 }
 async archive(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=curveArchiveInput.parse(raw);curveIdInput.parse(id);return residualCurveCommand(tx,actor,id,'ARCHIVE_RESIDUAL_CURVE',input,async()=>{
   const before=await this.read(tx,id);await lockCurveDimension(tx,before.dimensionHash);await lockCurves(tx,[id]);const row=await this.read(tx,id);ensure(row.dimensionHash===before.dimensionHash&&row.revision===input.revision,409,'REVISION_CONFLICT','曲线版本已变化');ensure(['DRAFT','ACTIVE','SUPERSEDED'].includes(row.status),409,'RESIDUAL_CURVE_STATE','曲线已归档');validateFrozen(row);
   const changed=await tx.vehicleResidualCurve.updateMany({where:{id,revision:input.revision,status:row.status},data:{status:'ARCHIVED',archivedAt:this.clock(),revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','曲线已变化');await audit(tx,actor.id,'ARCHIVE_RESIDUAL_CURVE','residual-curves',id,{reason:input.reason,revision:input.revision+1,sourceHash:row.sourceHash});return this.detail(tx,actor,id);
  });
 }
}
