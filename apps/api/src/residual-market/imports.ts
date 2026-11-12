import {randomUUID} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {ZodError} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {parseResidualCsv,yuanToFen} from './csv';
import {observationFactInput,observationFields,residualId} from './observation-types';
import {observationData,observationView,residualModelSelect,residualModelSnapshot} from './observations';
import {residualObservationCommand} from './observation-command';
import {residualImportPreviewInput,residualImportCommitInput,residualImportListInput,RESIDUAL_CSV_COLUMNS,RESIDUAL_CSV_REQUIRED,RESIDUAL_CSV_CONTRACT} from './import-types';

type PreviewRow={rowNumber:number;action:'IMPORTED'|'SKIPPED_DUPLICATE'|'FAILED';normalized?:any;duplicateId?:string;duplicateRowNumber?:number;observationId?:string;errorCode?:string;message?:string};
function headers(input:string[]){
 const aliases=new Map(Object.entries(RESIDUAL_CSV_COLUMNS).flatMap(([field,names])=>names.map(name=>[name,field] as const))),mapping=new Map<string,string>(),seen=new Set<string>();
 for(const name of input){const field=aliases.get(name);ensure(field,400,'CSV_COLUMNS',`未知 CSV 列：${name}`);ensure(!seen.has(field),400,'CSV_COLUMNS',`同义 CSV 列重复：${field}`);seen.add(field);mapping.set(name,field);}
 for(const field of RESIDUAL_CSV_REQUIRED)ensure(seen.has(field),400,'CSV_COLUMNS',`缺少必填 CSV 列：${field}`);return mapping;
}
const integer=(value:string|undefined)=>value===undefined||value===''?null:/^\d+$/.test(value)?Number(value):NaN;
function parseRecord(values:Record<string,string>,source:string){
 const optional=(name:string)=>values[name]||null;
 const battery=optional('batteryOwnership');
 return observationFactInput.parse({modelDefinitionId:values.modelDefinitionId,modelRevision:integer(values.modelRevision),source,sourceListingId:optional('sourceListingId'),observedOn:values.observedOn,priceType:values.priceType,priceAmount:yuanToFen(values.priceYuan),sourceNote:values.sourceNote,
  batteryOwnership:battery==='BUYOUT'?'OWNED':battery??'UNKNOWN',batteryCapacityKwh:optional('batteryCapacityKwh'),mileageKm:integer(values.mileageKm),registrationDate:optional('registrationDate'),vehicleAgeMonths:integer(values.vehicleAgeMonths),province:values.province||'',city:values.city||'',trim:values.trim||'',conditionGrade:values.conditionGrade||'',batteryHealthPercent:integer(values.batteryHealthPercent),accidentFlag:!values.accidentFlag?null:values.accidentFlag==='true'?true:values.accidentFlag==='false'?false:values.accidentFlag,sourceUrl:optional('sourceUrl'),correctionOfId:null});
}
function rowFailure(error:unknown):{errorCode:string;message:string}{
 if(error instanceof ZodError)return{errorCode:'VALIDATION',message:error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0,1000)};
 if(error instanceof HttpException&&error.getStatus()<500){const body=error.getResponse() as any;if(body?.error?.code)return{errorCode:body.error.code,message:String(body.error.message).slice(0,1000)};}
 throw error;
}
function normalizedView(value:any){
 const facts=Object.fromEntries(Object.keys(observationFields).map(key=>[key,value[key]]));
 return{...facts,modelSnapshot:residualModelSnapshot(value.modelSnapshot),confidenceScore:value.confidenceScore,dedupeKey:value.dedupeKey};
}
function rowView(row:any):PreviewRow{
 return{rowNumber:row.rowNumber,action:row.action,...(row.normalized?{normalized:normalizedView(row.normalized)}:{}),...(row.duplicateId?{duplicateId:row.duplicateId}:{}),...(row.duplicateRowNumber!==undefined?{duplicateRowNumber:row.duplicateRowNumber}:{}),...(row.observationId?{observationId:row.observationId}:{}),...(row.errorCode?{errorCode:row.errorCode,message:row.message}:{})};
}
export function residualImportView(row:any,details=false){return{id:row.id,revision:row.revision,csvHash:row.csvHash,fileName:row.fileName,source:row.source,status:row.status,rowCount:row.rowCount,importedCount:row.importedCount,duplicateCount:row.duplicateCount,failedCount:row.failedCount,createdBy:row.createdBy,createdAt:row.createdAt,...(details?{columnContract:RESIDUAL_CSV_CONTRACT,rowResults:row.rowResults.map(rowView)}:{})};}

export class ResidualImportsService{
 private async plan(tx:any,input:{source:string;fileName:string;csvText:string},lockModels=false){
  const parsed=parseResidualCsv(input.csvText),mapping=headers(parsed.headers);ensure(parsed.rowCount>0,400,'CSV_EMPTY','CSV 至少需要一条数据记录');
  const records=parsed.records.map(record=>({rowNumber:record.rowNumber,values:Object.fromEntries(Object.entries(record.values).map(([key,value])=>[mapping.get(key)!,value]))}));
  const ids=[...new Set(records.flatMap(record=>{const parsedId=residualId.safeParse(record.values.modelDefinitionId);return parsedId.success?[parsedId.data]:[]}))].sort();
  if(lockModels)for(const id of ids)await tx.$queryRaw`SELECT id FROM "ModelDefinition" WHERE id=${id} FOR UPDATE`;
  // All database reads live outside the recoverable per-row validation catch.
  const models=await tx.modelDefinition.findMany({where:{id:{in:ids}},select:residualModelSelect}),modelMap=new Map(models.map((model:any)=>[model.id,model]));
  const rows:PreviewRow[]=parsed.errors.map(error=>({rowNumber:error.rowNumber,action:'FAILED',errorCode:error.code,message:error.message})),dataByRow=new Map<number,any>();
  for(const record of records){try{
   const facts=parseRecord(record.values,input.source),data=observationData(facts,modelMap.get(facts.modelDefinitionId));dataByRow.set(record.rowNumber,data);
   rows.push({rowNumber:record.rowNumber,action:'IMPORTED',normalized:{...facts,sourceListingId:data.sourceListingId,modelSnapshot:data.modelSnapshot,confidenceScore:data.confidenceScore,dedupeKey:data.dedupeKey}});
  }catch(error){rows.push({rowNumber:record.rowNumber,action:'FAILED',...rowFailure(error)});}}
  rows.sort((a,b)=>a.rowNumber-b.rowNumber);
  const keys=[...new Set([...dataByRow.values()].map(data=>data.dedupeKey))].sort(),duplicates=await tx.marketPriceObservation.findMany({where:{dedupeKey:{in:keys},status:{in:['ACTIVE','IGNORED']}}}),duplicateMap=new Map(duplicates.map((row:any)=>[row.dedupeKey,row]));
  const seen=new Map<string,number>();for(const row of rows){if(row.action==='FAILED')continue;const data=dataByRow.get(row.rowNumber),duplicate=duplicateMap.get(data.dedupeKey) as any,prior=seen.get(data.dedupeKey);if(duplicate){row.action='SKIPPED_DUPLICATE';row.duplicateId=duplicate.id;}else if(prior!==undefined){row.action='SKIPPED_DUPLICATE';row.duplicateRowNumber=prior;}else seen.set(data.dedupeKey,row.rowNumber);}
  const counts={rowCount:parsed.rowCount,imported:rows.filter(row=>row.action==='IMPORTED').length,duplicate:rows.filter(row=>row.action==='SKIPPED_DUPLICATE').length,failed:rows.filter(row=>row.action==='FAILED').length};
  const modelStates=ids.map(id=>({id,model:modelMap.has(id)?residualModelSnapshot(modelMap.get(id)):null})),duplicateStates=duplicates.map(observationView).sort((a:any,b:any)=>a.id.localeCompare(b.id));
  const previewHash=canonicalHash({version:RESIDUAL_CSV_CONTRACT.version,csvHash:parsed.csvHash,fileName:input.fileName,source:input.source,rows,counts,modelStates,duplicateStates});
  return{preview:{csvHash:parsed.csvHash,columnContract:RESIDUAL_CSV_CONTRACT,rows:rows.map(rowView),counts,previewHash},dataByRow};
 }
 async preview(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'residual-imports',false);const input=residualImportPreviewInput.parse(raw);return(await this.plan(tx,input)).preview;}
 async commit(tx:any,actor:StaffActor,raw:unknown){
  const input=residualImportCommitInput.parse(raw);return residualObservationCommand(tx,actor,'residual-imports','NEW','IMPORT',input,async()=>{
   const {preview,dataByRow}=await this.plan(tx,input,true);ensure(preview.previewHash===input.previewHash,409,'PREVIEW_CHANGED','导入依据已变化，请重新预览并确认');
   const assigned=new Map<number,string>();for(const row of preview.rows)if(row.action==='IMPORTED')assigned.set(row.rowNumber,randomUUID());
   const rowResults=preview.rows.map(row=>rowView({...row,...(row.action==='IMPORTED'?{observationId:assigned.get(row.rowNumber)}:{}),...(row.duplicateRowNumber!==undefined?{duplicateId:assigned.get(row.duplicateRowNumber)}:{})}));
   const counts=preview.counts,status=counts.failed===0?'COMPLETED':counts.failed===counts.rowCount?'FAILED':'PARTIAL_FAILED';
   const batch=await tx.marketPriceImportBatch.create({data:{csvHash:preview.csvHash,fileName:input.fileName,source:input.source,status,rowCount:counts.rowCount,importedCount:counts.imported,duplicateCount:counts.duplicate,failedCount:counts.failed,rowResults,createdBy:actor.id}});
   const data=[...assigned].map(([rowNumber,id])=>({...dataByRow.get(rowNumber),id,importBatchId:batch.id,createdBy:actor.id,updatedBy:actor.id}));
   if(data.length){const inserted=await tx.marketPriceObservation.createMany({data});ensure(inserted.count===data.length,409,'IMPORT_INCOMPLETE','导入写入数量不一致，已回滚批次');}
   await audit(tx,actor.id,'IMPORT','residual-imports',batch.id,{csvHash:preview.csvHash,previewHash:preview.previewHash,counts,rowResults});return residualImportView(batch,true);
  });
 }
 async list(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'residual-imports',false);const q=residualImportListInput.parse(raw),where={...(q.source?{source:q.source}:{}),...(q.status?{status:q.status}:{})},[rows,total]=await Promise.all([tx.marketPriceImportBatch.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),tx.marketPriceImportBatch.count({where})]);return{items:rows.map((row:any)=>residualImportView(row)),total,page:q.page,pageSize:q.pageSize};
 }
 async detail(tx:any,actor:StaffActor,rawId:unknown){await requireCurrentStaff(tx,actor,'residual-imports',false);const id=residualId.parse(rawId),row=await tx.marketPriceImportBatch.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','残值导入批次不存在');return residualImportView(row,true);}
}
