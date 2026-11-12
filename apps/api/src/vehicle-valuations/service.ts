import {HttpException} from '@nestjs/common';
import {z,ZodError} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,money} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {dateOnly,revision,storedDate} from '../asset-costs/types';
import {requireAssetFiles} from '../files/asset-files';
import {shanghaiDay} from '../usage/rules';
import {addResidualMonths} from '../residual-market/calculations';
import {forecastSnapshot,forecastVehicleSnapshot,readFrozenForecast,validateFrozenForecast} from '../residual-market/forecasts';
import {lockForecast,lockForecastVehicle} from '../residual-market/forecast-command';
import {residualId} from '../residual-market/forecast-types';
import {valuationApproveInput,valuationCreateInput,valuationDecisionInput,valuationListInput} from './types';
import {valuationCommand} from './command';

const sourceSchema=z.object({version:z.literal(1),source:z.enum(['MANUAL','FORECAST']),vehicleId:residualId,vehicleRevision:revision,forecastPointId:residualId.nullable(),forecastRevision:revision.nullable(),forecast:z.unknown().nullable()}).strict();
const identitySchema=z.object({id:residualId,revision,modelDefinitionId:residualId.nullable(),brand:z.string(),model:z.string(),title:z.string(),year:z.number().int(),vin:z.string().nullable(),plateNumber:z.string().nullable()}).strict();
const beforeSchema=z.object({version:z.literal(1),vehicle:identitySchema,latestApprovedValuation:z.object({id:residualId,approvedAmount:money.min(1),nextReviewDate:z.string(),decidedAt:z.string()}).strict().nullable()}).strict();
const fileSchema=z.object({id:residualId,name:z.string().min(1),mimeType:z.enum(['application/pdf','image/jpeg','image/png']),size:z.number().int().min(1).max(10*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
function sourceHash(row:any){return canonicalHash({version:1,vehicleId:row.vehicleId,source:row.source,forecastPointId:row.forecastPointId,requestedAmount:row.requestedAmount,reason:row.reason,beforeSnapshot:row.beforeSnapshot,sourceSnapshot:row.sourceSnapshot});}
function validateReview(row:any){
 try{
  const source=sourceSchema.parse(row.sourceSnapshot),before=beforeSchema.parse(row.beforeSnapshot);ensure(row.sourceHash===sourceHash(row)&&row.vehicleId===source.vehicleId&&row.vehicleId===before.vehicle.id&&source.vehicleRevision===before.vehicle.revision&&row.source===source.source&&row.forecastPointId===source.forecastPointId&&Number.isInteger(row.requestedAmount)&&row.requestedAmount>0&&row.requestedAmount<=2147483647&&typeof row.reason==='string'&&row.reason.trim(),409,'VALUATION_SOURCE_INVALID','估值申请冻结资料不一致');
  if(source.source==='MANUAL')ensure(source.forecast===null&&source.forecastPointId===null&&source.forecastRevision===null,409,'VALUATION_SOURCE_INVALID','人工申请不能含预测关联');
  else{const forecast:any=source.forecast;ensure(forecast&&typeof forecast==='object',409,'VALUATION_SOURCE_INVALID','预测来源缺失');validateFrozenForecast(forecast);const point=forecast.points.find((point:any)=>point.id===source.forecastPointId);ensure(forecast.vehicleId===row.vehicleId&&forecast.revision===source.forecastRevision&&['GENERATED','ADOPTED'].includes(forecast.status)&&point&&point.forecastId===forecast.id&&point.status!=='UNSUPPORTED',409,'VALUATION_SOURCE_INVALID','预测点冻结归属或状态无效');}
  if(row.status==='PENDING')ensure([row.approvedAmount,row.decidedBy,row.decidedAt,row.decisionReason,row.nextReviewDate,row.evidenceSnapshot].every(value=>value===null)&&Array.isArray(row.evidenceFileIds)&&row.evidenceFileIds.length===0,409,'VALUATION_SOURCE_INVALID','待审核记录不能含终态事实');
  else{
   ensure(['APPROVED','REJECTED','CANCELLED'].includes(row.status)&&typeof row.decidedBy==='string'&&row.decidedBy&&row.decidedAt&&!Number.isNaN(new Date(row.decidedAt).getTime())&&typeof row.decisionReason==='string'&&row.decisionReason.trim(),409,'VALUATION_SOURCE_INVALID','审核结论元数据无效');
   if(row.status==='APPROVED'){money.min(1).parse(row.approvedAmount);ensure(dateOnly(row.nextReviewDate)===addResidualMonths(shanghaiDay(new Date(row.decidedAt)),3),409,'VALUATION_SOURCE_INVALID','复核日期不一致');const files=z.array(fileSchema).min(1).max(20).parse(row.evidenceSnapshot);ensure(Array.isArray(row.evidenceFileIds)&&new Set(row.evidenceFileIds).size===row.evidenceFileIds.length&&canonicalHash([...row.evidenceFileIds].sort())===canonicalHash(files.map(file=>file.id).sort())&&new Set(files.map(file=>file.id)).size===files.length,409,'VALUATION_SOURCE_INVALID','批准凭据摘要不一致');}
   else ensure(row.approvedAmount===null&&row.nextReviewDate===null&&row.evidenceSnapshot===null&&Array.isArray(row.evidenceFileIds)&&row.evidenceFileIds.length===0,409,'VALUATION_SOURCE_INVALID','拒绝或取消不能含批准金额');
  }
 }catch(error){if(error instanceof ZodError||error instanceof HttpException)ensure(false,409,'VALUATION_SOURCE_INVALID','估值冻结来源或审核事实无效');throw error;}
}
function view(row:any){return{id:row.id,revision:row.revision,vehicleId:row.vehicleId,forecastPointId:row.forecastPointId,source:row.source,requestedAmount:row.requestedAmount,reason:row.reason,status:row.status,approvedAmount:row.approvedAmount,decidedBy:row.decidedBy,decidedAt:row.decidedAt,decisionReason:row.decisionReason,nextReviewDate:row.nextReviewDate?dateOnly(row.nextReviewDate):null,sourceHash:row.sourceHash,createdBy:row.createdBy,createdAt:row.createdAt,updatedAt:row.updatedAt};}
async function readReview(tx:any,id:string){residualId.parse(id);const row=await tx.vehicleValuationReview.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','估值复核不存在');validateReview(row);return row;}
async function actualPoint(tx:any,pointId:string,vehicleId:string,lock:boolean){
 const link=await tx.vehicleResidualForecastPoint.findUnique({where:{id:pointId}});ensure(link,409,'FORECAST_POINT_MISMATCH','预测点不存在或不属于本车');if(lock){await lockForecast(tx,link.forecastId);await tx.$queryRaw`SELECT id FROM "VehicleResidualForecastPoint" WHERE id=${pointId} FOR UPDATE`;}
 const forecast=await readFrozenForecast(tx,link.forecastId),point=forecast.points.find((point:any)=>point.id===pointId);ensure(forecast.vehicleId===vehicleId&&point&&point.forecastId===forecast.id,409,'FORECAST_POINT_MISMATCH','预测点不属于本车');ensure(point.status!=='UNSUPPORTED',409,'FORECAST_POINT_UNSUPPORTED','范围外预测不能申请估值');return{forecast,point};
}

export class VehicleValuationsService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=valuationCreateInput.parse(raw);return valuationCommand(tx,actor,'NEW','CREATE',input,async()=>{
   await lockForecastVehicle(tx,input.vehicleId);const vehicle=await tx.vehicle.findUnique({where:{id:input.vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');ensure(vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆资料已变化');let forecast:any=null;
   if(input.source==='FORECAST'){const linked=await actualPoint(tx,input.forecastPointId!,input.vehicleId,true);ensure(linked.forecast.revision===input.forecastRevision,409,'REVISION_CONFLICT','预测版本已变化');ensure(['GENERATED','ADOPTED'].includes(linked.forecast.status),409,'FORECAST_STATE','已归档或作废预测不能申请估值');ensure(!await tx.vehicleValuationReview.count({where:{forecastPointId:input.forecastPointId,status:'PENDING'}}),409,'VALUATION_PENDING_EXISTS','该点已有待审估值');forecast=forecastSnapshot(linked.forecast);}
   const previous=await tx.vehicleValuationReview.findFirst({where:{vehicleId:input.vehicleId,status:'APPROVED'},orderBy:[{decidedAt:'desc'},{id:'desc'}]}),beforeSnapshot=beforeSchema.parse({version:1,vehicle:forecastVehicleSnapshot(vehicle),latestApprovedValuation:previous?{id:previous.id,approvedAmount:previous.approvedAmount,nextReviewDate:dateOnly(previous.nextReviewDate),decidedAt:new Date(previous.decidedAt).toISOString()}:null});
   const sourceSnapshot={version:1,source:input.source,vehicleId:input.vehicleId,vehicleRevision:input.vehicleRevision,forecastPointId:input.forecastPointId,forecastRevision:input.forecastRevision,forecast},data={vehicleId:input.vehicleId,forecastPointId:input.forecastPointId,source:input.source,requestedAmount:input.requestedAmount,reason:input.reason,beforeSnapshot,sourceSnapshot};
   const row=await tx.vehicleValuationReview.create({data:{...data,sourceHash:sourceHash(data),createdBy:actor.id,updatedBy:actor.id}});await audit(tx,actor.id,'CREATE_VEHICLE_VALUATION','vehicle-valuations',row.id,{sourceHash:row.sourceHash,requestedAmount:input.requestedAmount});return this.detail(tx,actor,row.id);
  });
 }
 async detail(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'vehicle-valuations',false);const row=await readReview(tx,id),files=await requireAssetFiles(tx,actor,{kind:'VALUATION',resourceId:id});return{...view(row),beforeSnapshot:row.beforeSnapshot,sourceSnapshot:row.sourceSnapshot,evidenceFileIds:row.evidenceFileIds,evidenceSnapshot:row.evidenceSnapshot,files};}
 async list(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'vehicle-valuations',false);const input=valuationListInput.parse(raw),where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.status?{status:input.status}:{})};const [rows,total]=await Promise.all([tx.vehicleValuationReview.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.vehicleValuationReview.count({where})]);return{items:rows.map(view),total,page:input.page,pageSize:input.pageSize};}
 private async lock(tx:any,id:string,expectedRevision:number,forecastRequired:boolean){
  const before=await tx.vehicleValuationReview.findUnique({where:{id}});ensure(before,404,'NOT_FOUND','估值复核不存在');await lockForecastVehicle(tx,before.vehicleId);let linked:Awaited<ReturnType<typeof actualPoint>>|null=null;if(forecastRequired&&before.forecastPointId)linked=await actualPoint(tx,before.forecastPointId,before.vehicleId,true);await tx.$queryRaw`SELECT id FROM "VehicleValuationReview" WHERE id=${id} FOR UPDATE`;
  const row=await readReview(tx,id);ensure(row.vehicleId===before.vehicleId&&row.forecastPointId===before.forecastPointId&&row.revision===expectedRevision,409,'REVISION_CONFLICT','复核资料或凭据已变化');ensure(row.status==='PENDING',409,'VALUATION_STATE','终态估值不能改写，请新建复核');return{row,linked};
 }
 private async update(tx:any,actor:StaffActor,row:any,data:any){const changed=await tx.vehicleValuationReview.updateMany({where:{id:row.id,revision:row.revision,status:'PENDING'},data:{...data,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','复核资料已变化');}
 async approve(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=valuationApproveInput.parse(raw);return valuationCommand(tx,actor,id,'APPROVE',input,async()=>{
   const {row,linked}=await this.lock(tx,id,input.revision,true),vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId}});ensure(vehicle&&vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆资料已变化');if(row.source==='FORECAST'){ensure(linked&&linked.forecast.status!=='VOIDED',409,'FORECAST_SOURCE_VOIDED','预测已作废，不能批准该依据');ensure(linked.forecast.sourceHash===row.sourceSnapshot.forecast.sourceHash,409,'VALUATION_SOURCE_INVALID','预测原始来源已变化');}
   const evidence=await requireAssetFiles(tx,actor,{kind:'VALUATION',resourceId:id,fileIds:input.fileIds,required:true}),now=this.clock(),nextReviewDate=addResidualMonths(shanghaiDay(now),3);await this.update(tx,actor,row,{status:'APPROVED',approvedAmount:input.approvedAmount,decidedBy:actor.id,decidedAt:now,decisionReason:input.reason,nextReviewDate:storedDate(nextReviewDate),evidenceFileIds:evidence.map(file=>file.id),evidenceSnapshot:evidence});await audit(tx,actor.id,'APPROVE_VEHICLE_VALUATION','vehicle-valuations',id,{approvedAmount:input.approvedAmount,nextReviewDate,reason:input.reason,evidence});return this.detail(tx,actor,id);
  });
 }
 private async decide(tx:any,actor:StaffActor,id:string,raw:unknown,action:'REJECT'|'CANCEL'){
  const input=valuationDecisionInput.parse(raw);return valuationCommand(tx,actor,id,action,input,async()=>{const {row}=await this.lock(tx,id,input.revision,false);await this.update(tx,actor,row,{status:action==='REJECT'?'REJECTED':'CANCELLED',decidedBy:actor.id,decidedAt:this.clock(),decisionReason:input.reason});await audit(tx,actor.id,`${action}_VEHICLE_VALUATION`,'vehicle-valuations',id,{reason:input.reason});return this.detail(tx,actor,id);});
 }
 reject(tx:any,actor:StaffActor,id:string,raw:unknown){return this.decide(tx,actor,id,raw,'REJECT');}
 cancel(tx:any,actor:StaffActor,id:string,raw:unknown){return this.decide(tx,actor,id,raw,'CANCEL');}
}
