import {HttpException} from '@nestjs/common';
import {z,ZodError} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {dateInput,dateOnly,revision,storedDate} from '../asset-costs/types';
import {forecastResidual,RESIDUAL_ALGORITHM_VERSION,RESIDUAL_REFERENCE_COMMIT,type ResidualForecastPoint} from './calculations';
import {normalizeBatteryCapacity} from './dimensions';
import {validateFrozen as validateFrozenCurve} from './curves';
import {forecastAdoptInput,forecastCreateInput,forecastListInput,forecastPreviewInput,forecastStateInput,residualId,type ForecastPreviewInput} from './forecast-types';
import {forecastCommand,lockForecast,lockForecastVehicle} from './forecast-command';

const include={points:{orderBy:{horizonMonth:'asc'}}};
const identityFields=['id','revision','modelDefinitionId','brand','model','title','year','vin','plateNumber'] as const;
export function forecastVehicleSnapshot(vehicle:any){return Object.fromEntries(identityFields.map(field=>[field,vehicle[field]??null]));}
const nullableText=z.string().nullable(),vehicleSchema=z.object({id:residualId,revision,modelDefinitionId:residualId,brand:z.string(),model:z.string(),title:z.string(),year:z.number().int(),vin:nullableText,plateNumber:nullableText}).strict();
const inputSchema=z.object({version:z.literal(1),algorithmVersion:z.literal(RESIDUAL_ALGORITHM_VERSION),referenceCommit:z.literal(RESIDUAL_REFERENCE_COMMIT),asOfDate:dateInput,horizonMonths:z.array(z.number().int().min(0).max(120)).min(1).max(10),vehicle:vehicleSchema,model:z.object({id:residualId,revision,brand:z.string(),name:z.string(),modelYear:z.number().int().min(1900).max(2100).nullable()}).strict(),asset:z.object({vehicleId:residualId,revision,firstRegistrationDate:dateInput,batteryOwnership:z.enum(['UNKNOWN','OWNED','BAAS']),batteryCapacityKwh:nullableText}).strict(),trim:z.null(),purchasePriceAmount:z.null()}).strict();
const pointFields=['horizonMonth','targetAgeMonth','interpolationMethod','predictedAmount','lowerAmount','upperAmount','predictedResidualRateBps','matchSnapshot'] as const;
function pointFact(point:ResidualForecastPoint){return{horizonMonth:point.horizonMonth,targetDate:point.targetDate,targetAgeMonth:point.targetAgeMonth,status:point.pointStatus,interpolationMethod:point.interpolationMethod==='UNSUPPORTED_OUT_OF_RANGE'?'UNSUPPORTED':point.interpolationMethod,predictedAmount:point.predictedResidualAmount,lowerAmount:point.lowerBoundAmount,upperAmount:point.upperBoundAmount,predictedResidualRateBps:point.predictedResidualRateBps,matchSnapshot:{confidenceScore:point.confidenceScore,matchedCurvePointAgeMonth:point.matchedCurvePointAgeMonth,interpolation:point.interpolation}};}
function checkDimension(input:z.output<typeof inputSchema>,curve:any){
 const dimension=curve.dimensionSnapshot;
 ensure(input.model.id===input.vehicle.modelDefinitionId&&input.asset.vehicleId===input.vehicle.id&&dimension.modelDefinitionId===input.vehicle.modelDefinitionId&&(dimension.modelYear===null||dimension.modelYear===input.model.modelYear)&&dimension.trim===null&&(dimension.batteryOwnership===null||dimension.batteryOwnership===input.asset.batteryOwnership)&&(dimension.batteryCapacityKwh===null||dimension.batteryCapacityKwh===input.asset.batteryCapacityKwh),409,'FORECAST_DIMENSION_MISMATCH','车辆车型、年款、电池事实或款型与曲线不匹配；缺失事实不能推测');
}
function calculateFrozen(input:z.output<typeof inputSchema>,curve:any){
 validateFrozenCurve(curve);checkDimension(input,curve);
 ensure(Array.isArray(curve.points)&&curve.points.every((point:any)=>point.curveId===curve.id&&typeof point.id==='string'&&point.id.length>0)&&new Set(curve.points.map((point:any)=>point.id)).size===curve.points.length,409,'FORECAST_SOURCE_INVALID','曲线点归属无效');
 return forecastResidual({asOfDate:input.asOfDate,registrationDate:input.asset.firstRegistrationDate,horizonMonths:input.horizonMonths,purchasePriceAmount:null,points:curve.points.map((point:any)=>({id:point.id,ageMonth:point.ageMonth,predictedResidualAmount:point.medianPriceAmount,lowerBoundAmount:point.p25PriceAmount,upperBoundAmount:point.p75PriceAmount,confidenceScore:point.confidenceScore}))});
}
const hashSource=(inputSnapshot:any,curveSnapshot:any)=>canonicalHash({version:1,inputSnapshot,curveSnapshot});
function freezeCurve(curve:any):Record<string,any>&{points:any[]}{
 const fields=['id','revision','modelDefinitionId','name','status','dimensionHash','dimensionSnapshot','filterSnapshot','referencePriceAmount','algorithmVersion','referenceCommit','sourceSnapshot','sourceHash','pointCount','sampleCount','confidenceScore','skippedReasons'] as const;
 const pointKeys=['id','curveId','ageMonth','sampleCount','medianPriceAmount','p25PriceAmount','p75PriceAmount','averagePriceAmount','minPriceAmount','maxPriceAmount','predictedResidualRateBps','confidenceScore','sampleSnapshot'] as const;
 return{...Object.fromEntries(fields.map(field=>[field,curve[field]??null])),points:curve.points.map((point:any)=>Object.fromEntries(pointKeys.map(field=>[field,point[field]??null])))};
}
export function validateFrozenForecast(row:any){
 try{
  const input=inputSchema.parse(row.inputSnapshot),curve=row.curveSnapshot;
  ensure(curve&&typeof curve==='object'&&curve.status==='ACTIVE'&&row.vehicleId===input.vehicle.id&&row.curveId===curve.id&&row.vehicleRevision===input.vehicle.revision&&row.assetRevision===input.asset.revision&&row.curveRevision===curve.revision&&dateOnly(row.asOfDate)===input.asOfDate&&row.sourceHash===hashSource(input,curve),409,'FORECAST_SOURCE_INVALID','预测冻结来源不一致');
  const calculated=calculateFrozen(input,curve),points=calculated.points.map(pointFact),stored=[...row.points].sort((a,b)=>a.horizonMonth-b.horizonMonth);
  ensure(stored.length===points.length&&new Set(stored.map(point=>point.id)).size===stored.length,409,'FORECAST_SOURCE_INVALID','预测点数量或编号无效');
  for(let index=0;index<points.length;index++){
   const expected=points[index],point=stored[index];ensure(point.forecastId===row.id&&typeof point.id==='string'&&point.id.length>0&&dateOnly(point.targetDate)===expected.targetDate&&canonicalHash(Object.fromEntries(pointFields.map(field=>[field,point[field]])))===canonicalHash(Object.fromEntries(pointFields.map(field=>[field,expected[field]])))&&(point.status===expected.status||expected.status==='GENERATED'&&point.status==='ADOPTED'),409,'FORECAST_SOURCE_INVALID','预测金额、权重或点归属不符');
   if(point.status==='ADOPTED')ensure(Number.isInteger(point.adoptedAmount)&&point.adoptedAmount>0&&point.adoptedAmount<=2147483647&&typeof point.adoptReason==='string'&&point.adoptReason.trim()&&typeof point.adoptedBy==='string'&&point.adoptedBy&&point.adoptedAt&&!Number.isNaN(new Date(point.adoptedAt).getTime()),409,'FORECAST_SOURCE_INVALID','采用事实无效');
   else ensure([point.adoptedAmount,point.adoptReason,point.adoptedBy,point.adoptedAt].every(value=>value===null),409,'FORECAST_SOURCE_INVALID','未采用的点不能含采用事实');
  }
  const adopted=stored.some(point=>point.status==='ADOPTED');ensure(['GENERATED','ADOPTED','ARCHIVED','VOIDED'].includes(row.status)&&(row.status!=='ADOPTED'||adopted)&&(!['GENERATED','VOIDED'].includes(row.status)||!adopted),409,'FORECAST_SOURCE_INVALID','预测状态与采用事实不符');return calculated;
 }catch(error){if(error instanceof ZodError||error instanceof HttpException)ensure(false,409,'FORECAST_SOURCE_INVALID','预测冻结来源、数学或采用事实无效');throw error;}
}
export function forecastSnapshot(row:any){
 return JSON.parse(JSON.stringify({id:row.id,revision:row.revision,vehicleId:row.vehicleId,curveId:row.curveId,asOfDate:dateOnly(row.asOfDate),status:row.status,vehicleRevision:row.vehicleRevision,assetRevision:row.assetRevision,curveRevision:row.curveRevision,inputSnapshot:row.inputSnapshot,curveSnapshot:row.curveSnapshot,sourceHash:row.sourceHash,createdAt:row.createdAt,updatedAt:row.updatedAt,points:row.points.map((point:any)=>({id:point.id,forecastId:point.forecastId,...Object.fromEntries(pointFields.map(field=>[field,point[field]])),targetDate:dateOnly(point.targetDate),status:point.status,adoptedAmount:point.adoptedAmount,adoptReason:point.adoptReason,adoptedBy:point.adoptedBy,adoptedAt:point.adoptedAt}))}));
}
export async function readFrozenForecast(tx:any,id:string){residualId.parse(id);const row=await tx.vehicleResidualForecast.findUnique({where:{id},include});ensure(row,404,'NOT_FOUND','残值预测不存在');validateFrozenForecast(row);return row;}

export class ResidualForecastsService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async calculate(tx:any,input:ForecastPreviewInput){
  const vehicle=await tx.vehicle.findUnique({where:{id:input.vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');const model=vehicle.modelDefinitionId?await tx.modelDefinition.findUnique({where:{id:vehicle.modelDefinitionId}}):null;ensure(model&&model.id===vehicle.modelDefinitionId,409,'FORECAST_MODEL_REQUIRED','请先明确车辆的真实车型');
  const asset=await tx.vehicleAssetProfile.findUnique({where:{vehicleId:vehicle.id}});ensure(asset?.firstRegistrationDate,409,'FORECAST_REGISTRATION_REQUIRED','请先维护车辆首次登记日');
  const curve=await tx.vehicleResidualCurve.findUnique({where:{id:input.curveId},include:{points:{orderBy:{ageMonth:'asc'}}}});ensure(curve,404,'NOT_FOUND','残值曲线不存在');ensure(['DRAFT','ACTIVE'].includes(curve.status),409,'FORECAST_CURVE_INACTIVE','只能预览草稿或有效曲线');
  const inputSnapshot=inputSchema.parse({version:1,algorithmVersion:RESIDUAL_ALGORITHM_VERSION,referenceCommit:RESIDUAL_REFERENCE_COMMIT,asOfDate:input.asOfDate,horizonMonths:[...input.horizonMonths].sort((a,b)=>a-b),vehicle:forecastVehicleSnapshot(vehicle),model:{id:model.id,revision:model.revision,brand:model.brand,name:model.name,modelYear:model.modelYear??null},asset:{vehicleId:vehicle.id,revision:asset.revision,firstRegistrationDate:dateOnly(asset.firstRegistrationDate),batteryOwnership:asset.batteryOwnership,batteryCapacityKwh:normalizeBatteryCapacity(asset.batteryCapacityKwh?.toString())},trim:null,purchasePriceAmount:null});
  const curveSnapshot=freezeCurve(curve),calculated=calculateFrozen(inputSnapshot,curveSnapshot),sourceHash=hashSource(inputSnapshot,curveSnapshot);
  return{vehicleId:vehicle.id,vehicleRevision:vehicle.revision,assetRevision:asset.revision,curveId:curve.id,curveRevision:curve.revision,algorithmVersion:RESIDUAL_ALGORITHM_VERSION,asOfDate:input.asOfDate,vehicleAgeMonths:calculated.vehicleAgeMonths,points:calculated.points.map(pointFact),warnings:[...(curve.status==='DRAFT'?['CURVE_NOT_ACTIVE']:[]),'PURCHASE_PRICE_UNAVAILABLE'],inputSnapshot,curveSnapshot,sourceHash,previewHash:sourceHash};
 }
 async preview(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'residual-forecasts',false);return this.calculate(tx,forecastPreviewInput.parse(raw));}
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=forecastCreateInput.parse(raw);return forecastCommand(tx,actor,'NEW','CREATE_RESIDUAL_FORECAST',input,async()=>{
   await lockForecastVehicle(tx,input.vehicleId);await tx.$queryRaw`SELECT "vehicleId" FROM "VehicleAssetProfile" WHERE "vehicleId"=${input.vehicleId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "VehicleResidualCurve" WHERE id=${input.curveId} FOR UPDATE`;
   const preview=await this.calculate(tx,input);ensure(preview.curveSnapshot.status==='ACTIVE',409,'FORECAST_CURVE_INACTIVE','正式预测只能使用当前有效曲线');ensure(preview.vehicleRevision===input.revision&&preview.assetRevision===input.assetRevision&&preview.curveRevision===input.curveRevision,409,'REVISION_CONFLICT','车辆、资产或曲线版本已变化');ensure(preview.previewHash===input.previewHash,409,'PREVIEW_CHANGED','预测依据已变化，请重新预览');
   const row=await tx.vehicleResidualForecast.create({data:{vehicleId:input.vehicleId,curveId:input.curveId,asOfDate:storedDate(input.asOfDate),vehicleRevision:preview.vehicleRevision,assetRevision:preview.assetRevision,curveRevision:preview.curveRevision,inputSnapshot:preview.inputSnapshot,curveSnapshot:preview.curveSnapshot,sourceHash:preview.sourceHash,createdBy:actor.id,updatedBy:actor.id}});
   for(const point of preview.points)await tx.vehicleResidualForecastPoint.create({data:{forecastId:row.id,...point,targetDate:storedDate(point.targetDate)}});
   await audit(tx,actor.id,'CREATE_RESIDUAL_FORECAST','residual-forecasts',row.id,{sourceHash:preview.sourceHash});return this.detail(tx,actor,row.id);
  });
 }
 async detail(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'residual-forecasts',false);return forecastSnapshot(await readFrozenForecast(tx,id));}
 async list(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'residual-forecasts',false);const input=forecastListInput.parse(raw),where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.status?{status:input.status}:{})};const [rows,total]=await Promise.all([tx.vehicleResidualForecast.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.vehicleResidualForecast.count({where})]);
  return{items:rows.map((row:any)=>({id:row.id,revision:row.revision,vehicleId:row.vehicleId,curveId:row.curveId,asOfDate:dateOnly(row.asOfDate),status:row.status,sourceHash:row.sourceHash,createdAt:row.createdAt})),total,page:input.page,pageSize:input.pageSize};
 }
 private async locked(tx:any,id:string,expectedRevision:number){const before=await tx.vehicleResidualForecast.findUnique({where:{id}});ensure(before,404,'NOT_FOUND','残值预测不存在');await lockForecastVehicle(tx,before.vehicleId);await lockForecast(tx,id);const row=await readFrozenForecast(tx,id);ensure(row.vehicleId===before.vehicleId&&row.revision===expectedRevision,409,'REVISION_CONFLICT','预测版本已变化');return row;}
 async adopt(tx:any,actor:StaffActor,id:string,pointId:string,raw:unknown){
  const input=forecastAdoptInput.parse(raw);residualId.parse(pointId);return forecastCommand(tx,actor,id,'ADOPT_FORECAST_POINT',{...input,pointId},async()=>{
   const row=await this.locked(tx,id,input.revision);ensure(['GENERATED','ADOPTED'].includes(row.status),409,'FORECAST_STATE','仅未归档作废的预测可以采用');const point=row.points.find((point:any)=>point.id===pointId);ensure(point&&point.forecastId===id,409,'FORECAST_POINT_MISMATCH','预测点不属于当前预测');ensure(point.status!=='UNSUPPORTED',409,'FORECAST_POINT_UNSUPPORTED','范围外预测不可采用');ensure(point.status!=='ADOPTED',409,'FORECAST_POINT_ADOPTED','该点已采用，请新建评估保留历史');
   const changed=await tx.vehicleResidualForecastPoint.updateMany({where:{id:pointId,forecastId:id,status:'GENERATED'},data:{status:'ADOPTED',adoptedAmount:input.amount,adoptReason:input.reason,adoptedBy:actor.id,adoptedAt:this.clock()}});ensure(changed.count===1,409,'REVISION_CONFLICT','预测点已变化');await this.update(tx,actor,row,{status:'ADOPTED'});await audit(tx,actor.id,'ADOPT_FORECAST_POINT','residual-forecasts',id,{pointId,amount:input.amount,reason:input.reason});return this.detail(tx,actor,id);
  });
 }
 private async update(tx:any,actor:StaffActor,row:any,data:any){const changed=await tx.vehicleResidualForecast.updateMany({where:{id:row.id,revision:row.revision,status:row.status},data:{...data,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','预测版本已变化');}
 private async state(tx:any,actor:StaffActor,id:string,raw:unknown,status:'ARCHIVED'|'VOIDED'){
  const input=forecastStateInput.parse(raw);return forecastCommand(tx,actor,id,status==='ARCHIVED'?'ARCHIVE_RESIDUAL_FORECAST':'VOID_RESIDUAL_FORECAST',input,async()=>{
   const row=await this.locked(tx,id,input.revision);ensure(['GENERATED','ADOPTED'].includes(row.status),409,'FORECAST_STATE','预测已归档或作废');if(status==='VOIDED')ensure(!row.points.some((point:any)=>point.status==='ADOPTED')&&!await tx.vehicleValuationReview.count({where:{forecastPointId:{in:row.points.map((point:any)=>point.id)},status:'APPROVED'}}),409,'FORECAST_IN_USE','已有采用或批准估值引用，不能作废');await this.update(tx,actor,row,{status});await audit(tx,actor.id,status==='ARCHIVED'?'ARCHIVE_RESIDUAL_FORECAST':'VOID_RESIDUAL_FORECAST','residual-forecasts',id,{reason:input.reason});return this.detail(tx,actor,id);
  });
 }
 archive(tx:any,actor:StaffActor,id:string,raw:unknown){return this.state(tx,actor,id,raw,'ARCHIVED');}
 void(tx:any,actor:StaffActor,id:string,raw:unknown){return this.state(tx,actor,id,raw,'VOIDED');}
}
