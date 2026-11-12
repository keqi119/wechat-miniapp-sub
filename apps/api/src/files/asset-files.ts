import {Body,Controller,Get,Inject,Param,Post,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import type {StaffActor} from '../auth/staff.types';
import {archiveCommand} from '../offline-documents/command';
import {readableFileName} from './filename';
import {saveFile,streamFile,validMime} from './storage';
import {assertNotInspectionFiles} from '../vehicle-inspections/service';

type Kind='BAAS'|'DEPRECIATION'|'COST'|'PLATE'|'RESIDUAL_OBSERVATION'|'VALUATION'|'WORK_ORDER'|'WORK_ORDER_COST';
const limits={fileSize:10*1024*1024,files:1};
const definitions={
 BAAS:{resource:'baas-contracts',model:'vehicleBaasContract',field:'baasContractId',purpose:'asset-baas'},
 DEPRECIATION:{resource:'depreciation-policies',model:'vehicleDepreciationPolicy',field:'depreciationPolicyId',purpose:'asset-depreciation'},
 COST:{resource:'asset-costs',model:'assetCostEntry',field:'costEntryId',purpose:'asset-cost'},
 PLATE:{resource:'license-plates',model:'licensePlate',field:'licensePlateId',purpose:'asset-plate'},
 RESIDUAL_OBSERVATION:{resource:'residual-observations',model:'marketPriceObservation',field:'observationId',purpose:'asset-residual-observation'},
 VALUATION:{resource:'vehicle-valuations',model:'vehicleValuationReview',field:'valuationReviewId',purpose:'asset-valuation'},
 WORK_ORDER:{resource:'asset-work-orders',model:'assetWorkOrder',field:'workOrderId',purpose:'asset-work-order'},
 WORK_ORDER_COST:{resource:'asset-work-order-cost-lines',model:'assetWorkOrderCost',field:'workOrderCostId',purpose:'asset-work-order-cost'},
} as const;
const parentFields=['baasContractId','depreciationPolicyId','costEntryId','licensePlateId','observationId','valuationReviewId','workOrderId','workOrderCostId'] as const;
const inputSchema=z.object({revision:z.preprocess(value=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value,z.number().int().min(0).max(2147483647)),idempotencyKey:key}).strict();
const baasFileActionInput=z.object({revision:z.number().int().min(0).max(2147483647),idempotencyKey:key.refine(value=>!value.includes('\0')),reason:z.string().trim().min(1).max(500).refine(value=>!value.includes('\0'))}).strict();
export type AssetFileManifest={id:string;name:string;mimeType:string;size:number;sha256:string};
export type BaasFileRecord=AssetFileManifest&{state:'ACTIVE'|'VOIDED';voidedAt:string|null;voidedBy:string|null;voidReason:string|null;url:string};
const metadata=(file:any):AssetFileManifest=>({id:file.id,name:readableFileName(file.name),mimeType:file.mimeType,size:file.size,sha256:file.sha256});
const lifecycleFields=['voidedAt','voidedBy','voidReason','removedAt','removedBy','removeReason'] as const;
const currentBaasFile=(binding:any)=>binding.voidedAt==null&&binding.removedAt==null;
const currentBaasPdf=(binding:any)=>currentBaasFile(binding)&&binding.file.mimeType==='application/pdf';
const baasFileUrl=(id:string,fileId:string,history=false)=>`/api/admin/baas-contracts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}${history?'/history':''}`;
function validLifecycle(binding:any){
 if(binding.kind!=='BAAS')return lifecycleFields.every(field=>binding[field]==null);
 return [['voidedAt','voidedBy','voidReason'],['removedAt','removedBy','removeReason']].every(([at,by,reason])=>
  binding[at]==null&&binding[by]==null&&binding[reason]==null||binding[at] instanceof Date&&Number.isFinite(binding[at].getTime())&&typeof binding[by]==='string'&&binding[by].trim().length>0&&typeof binding[reason]==='string'&&binding[reason].trim().length>0&&binding[reason].length<=500);
}

async function authorize(tx:any,actor:StaffActor,kind:Kind,write=false){
 ensure(actor&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 await requireCurrentStaff(tx,actor,definitions[kind].resource,write);
}
async function parent(tx:any,kind:Kind,id:string){
 ensure(typeof id==='string'&&id.length>0,400,'VALIDATION','资源编号无效');
 const row=await tx[definitions[kind].model].findUnique({where:{id}});
 ensure(row&&row.id===id&&(kind==='PLATE'||kind==='RESIDUAL_OBSERVATION'||typeof row.vehicleId==='string'&&row.vehicleId),404,'NOT_FOUND','资产资料不存在');
 return row;
}

/** Every caller must use its own business scope as well. This blocks even a
 * corrupted purpose on a file which has ever been bound to a private asset. */
export async function assertNotAssetFiles(tx:any,fileIds:string[]){
 if(!fileIds.length)return;
 ensure(!await tx.vehicleDocumentFile.count({where:{fileId:{in:fileIds}}}),403,'VEHICLE_DOCUMENT_ROUTE_REQUIRED','请从所属车辆原件档案读取文件');
 ensure(!await tx.assetPrivateFile.count({where:{fileId:{in:fileIds}}}),403,'ASSET_FILE_ROUTE_REQUIRED','请从所属资产资料读取文件');
 await assertNotInspectionFiles(tx,fileIds);
 ensure(!await tx.electronicFileQuarantine.count({where:{fileId:{in:fileIds}}}),403,'ELECTRONIC_QUARANTINE_PRIVATE','隔离签署证据不得作为普通业务附件使用');
}

/** Current staff permission and exact parent mapping are rechecked on every use,
 * including activation, manual payment evidence and dedicated downloads. */
async function readBoundAssetFiles(tx:any,input:{kind:Kind;resourceId:string;fileIds?:string[]}){
 ensure(Object.hasOwn(definitions,input.kind),400,'VALIDATION','资产文件类型无效');
 await parent(tx,input.kind,input.resourceId);
 const ids=input.fileIds;
 ensure(ids===undefined||Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length,400,'ASSET_FILE_INVALID','附件编号无效或重复');
 const definition=definitions[input.kind];
 const bindings=await tx.assetPrivateFile.findMany({where:ids===undefined?{[definition.field]:input.resourceId}:{fileId:{in:ids}},include:{file:true},orderBy:{fileId:'asc'}});
 ensure(ids===undefined||bindings.length===ids.length,409,'ASSET_FILE_INVALID','附件不存在或不属于本资产资料');
 const seen=new Set<string>();
 for(const binding of bindings){
  const file=binding.file;
  ensure(binding.kind===input.kind&&parentFields.every(field=>field===definition.field?binding[field]===input.resourceId:binding[field]===null)&&file&&binding.fileId===file.id&&!seen.has(file.id)&&
   file.purpose===definition.purpose&&file.customerId===null&&!file.fieldTaskId&&typeof file.adminId==='string'&&file.adminId.length>0&&binding.uploadedBy===file.adminId&&
   typeof file.name==='string'&&file.name.length>0&&['application/pdf','image/jpeg','image/png'].includes(file.mimeType)&&Number.isInteger(file.size)&&file.size>0&&file.size<=limits.fileSize&&
   /^[a-f0-9]{64}$/.test(file.sha256)&&binding.sha256===file.sha256&&validLifecycle(binding),409,'ASSET_FILE_INVALID','附件归属、用途或文件摘要不一致');
  seen.add(file.id);
 }
 return bindings;
}

async function assetFileBindings(tx:any,actor:StaffActor,input:{kind:Kind;resourceId:string;fileIds?:string[]}){
 ensure(Object.hasOwn(definitions,input.kind),400,'VALIDATION','资产文件类型无效');
 await authorize(tx,actor,input.kind);
 return readBoundAssetFiles(tx,input);
}

/** Internal facts only: caller must already own the vehicle business scope.
 * Never use this helper as a route/download authorization bypass. */
export async function readBaasRegistrationPdfFiles(tx:any,contractId:string):Promise<AssetFileManifest[]>{
 const bindings=await readBoundAssetFiles(tx,{kind:'BAAS',resourceId:contractId});
 return bindings.filter(currentBaasPdf).map((binding:any)=>metadata(binding.file)).sort((a:AssetFileManifest,b:AssetFileManifest)=>a.id.localeCompare(b.id));
}

/** Only current BaaS PDFs are evidence for a new use. This is not signature verification. */
export async function requireAssetFiles(tx:any,actor:StaffActor,input:{kind:Kind;resourceId:string;fileIds?:string[];required?:boolean}):Promise<AssetFileManifest[]>{
 const bindings=await assetFileBindings(tx,actor,input),usable=input.kind==='BAAS'?bindings.filter(currentBaasPdf):bindings;
 ensure(input.fileIds===undefined||usable.length===input.fileIds.length,409,'ASSET_FILE_INVALID','附件已作废、移除、不属于本资产资料或不是当前要求的PDF');
 ensure(!input.required||usable.length>0,409,'ASSET_FILES_REQUIRED',input.kind==='BAAS'?'请上传已签署的BaaS合同PDF':'请先上传本资产资料的有效专用附件');
 return usable.map((binding:any)=>metadata(binding.file)).sort((a:AssetFileManifest,b:AssetFileManifest)=>a.id.localeCompare(b.id));
}

/** Current card records include readable void history, but never removed files. */
export async function listBaasFileRecords(tx:any,actor:StaffActor,id:string):Promise<BaasFileRecord[]>{
 const bindings=await assetFileBindings(tx,actor,{kind:'BAAS',resourceId:id});
 return bindings.filter((binding:any)=>binding.removedAt==null).map((binding:any)=>({...metadata(binding.file),state:binding.voidedAt==null?'ACTIVE':'VOIDED',voidedAt:binding.voidedAt?.toISOString()??null,voidedBy:binding.voidedBy??null,voidReason:binding.voidReason??null,url:baasFileUrl(id,binding.fileId,binding.voidedAt!=null)})).sort((a:BaasFileRecord,b:BaasFileRecord)=>a.id.localeCompare(b.id));
}

async function baasFileForRead(tx:any,actor:StaffActor,id:string,fileId:string,history=false){
 const [binding]=await assetFileBindings(tx,actor,{kind:'BAAS',resourceId:id,fileIds:[fileId]});
 ensure(binding.removedAt==null&&(history?binding.voidedAt!=null:currentBaasFile(binding)),404,'NOT_FOUND','附件不存在或已移除');
 return binding.file;
}

async function lockParent(tx:any,kind:Kind,id:string){
 const initial=await parent(tx,kind,id);
 // Plate evidence belongs to the plate, including before any vehicle binding.
 // This operation never acquires or changes a vehicle after locking the plate.
 if(kind==='PLATE'){
  await tx.$queryRaw`SELECT id FROM "LicensePlate" WHERE id=${id} FOR UPDATE`;
  return parent(tx,kind,id);
 }
 if(kind==='RESIDUAL_OBSERVATION'){
  await tx.$queryRaw`SELECT id FROM "MarketPriceObservation" WHERE id=${id} FOR UPDATE`;
  return parent(tx,kind,id);
 }
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.vehicleId} FOR UPDATE`;
 if(kind==='BAAS')await tx.$queryRaw`SELECT id FROM "VehicleBaasContract" WHERE id=${id} FOR UPDATE`;
 else if(kind==='DEPRECIATION')await tx.$queryRaw`SELECT id FROM "VehicleDepreciationPolicy" WHERE id=${id} FOR UPDATE`;
 else if(kind==='VALUATION')await tx.$queryRaw`SELECT id FROM "VehicleValuationReview" WHERE id=${id} FOR UPDATE`;
 else if(kind==='WORK_ORDER')await tx.$queryRaw`SELECT id FROM "AssetWorkOrder" WHERE id=${id} FOR UPDATE`;
 else if(kind==='WORK_ORDER_COST')await lockWorkOrderCost(tx,id,initial.vehicleId);
 else{
  const plan=await tx.assetCostPlan.findUnique({where:{id:initial.planId}});
  ensure(plan&&plan.vehicleId===initial.vehicleId,409,'ASSET_FILE_INVALID','成本与来源计划不一致');
  if(plan.sourceKind==='BAAS'&&plan.baasContractId&&!plan.depreciationPolicyId&&!plan.workOrderCostId)await tx.$queryRaw`SELECT id FROM "VehicleBaasContract" WHERE id=${plan.baasContractId} FOR UPDATE`;
  else if(plan.sourceKind==='DEPRECIATION'&&plan.depreciationPolicyId&&!plan.baasContractId&&!plan.workOrderCostId)await tx.$queryRaw`SELECT id FROM "VehicleDepreciationPolicy" WHERE id=${plan.depreciationPolicyId} FOR UPDATE`;
  else if(plan.sourceKind==='WORK_ORDER'&&plan.workOrderCostId&&!plan.baasContractId&&!plan.depreciationPolicyId)await lockWorkOrderCost(tx,plan.workOrderCostId,initial.vehicleId);
  else ensure(false,409,'ASSET_FILE_INVALID','成本来源不一致');
  await tx.$queryRaw`SELECT id FROM "AssetCostPlan" WHERE id=${initial.planId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AssetCostEntry" WHERE id=${id} FOR UPDATE`;
 }
 const current=await parent(tx,kind,id);
 ensure(current.vehicleId===initial.vehicleId&&(kind!=='COST'||current.planId===initial.planId)&&(kind!=='WORK_ORDER_COST'||current.workOrderId===initial.workOrderId),409,'REVISION_CONFLICT','资产归属已变化，请刷新重试');
 return current;
}

/** The caller already holds Vehicle. Never infer a work-order parent from JSON. */
async function lockWorkOrderCost(tx:any,id:string,vehicleId:string){
 const line=await tx.assetWorkOrderCost.findUnique({where:{id}});
 ensure(line?.id===id&&line.vehicleId===vehicleId&&typeof line.workOrderId==='string',409,'ASSET_FILE_INVALID','费用来源与车辆不一致');
 await tx.$queryRaw`SELECT id FROM "AssetWorkOrder" WHERE id=${line.workOrderId} FOR UPDATE`;
 const work=await tx.assetWorkOrder.findUnique({where:{id:line.workOrderId}});
 ensure(work?.id===line.workOrderId&&work.vehicleId===vehicleId,409,'ASSET_FILE_INVALID','费用与实际工单不一致');
 await tx.$queryRaw`SELECT id FROM "AssetWorkOrderCost" WHERE id=${id} FOR UPDATE`;
 const current=await tx.assetWorkOrderCost.findUnique({where:{id}});
 ensure(current?.id===id&&current.vehicleId===vehicleId&&current.workOrderId===work.id,409,'ASSET_FILE_INVALID','费用来源已变化');
}

@Controller()
export class AssetFilesController{
 constructor(@Inject(Db)private db:Db){}
 private async list(kind:Kind,id:string,actor:StaffActor){return this.db.serial(async tx=>({items:kind==='BAAS'?await listBaasFileRecords(tx,actor,id):await requireAssetFiles(tx,actor,{kind,resourceId:id}),revision:(await parent(tx,kind,id)).revision}));}
 private async read(kind:Kind,id:string,fileId:string,actor:StaffActor,response:any){
  const file=await this.db.serial(async tx=>{if(kind==='BAAS')return baasFileForRead(tx,actor,id,fileId);await requireAssetFiles(tx,actor,{kind,resourceId:id,fileIds:[fileId],required:true});return tx.storedFile.findUnique({where:{id:fileId}});});
  ensure(file,404,'NOT_FOUND','附件不存在');return streamFile(file,response);
 }
 private async disposeBaas(id:string,fileId:string,raw:unknown,actor:StaffActor,disposition:'void'|'remove'){
  const input=baasFileActionInput.parse(raw),action=disposition==='void'?'ASSET_FILE_VOID':'ASSET_FILE_REMOVE';
  return this.db.serial(async tx=>{
   await authorize(tx,actor,'BAAS',true);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:baas-contracts:${id}:${action}:${input.idempotencyKey}`},0))`;
   const current=await lockParent(tx,'BAAS',id);
   // Validate permanent scope before replay, including after an accepted remove.
   const [binding]=await assetFileBindings(tx,actor,{kind:'BAAS',resourceId:id,fileIds:[fileId]});
   return archiveCommand(tx,actor,id,action,{...input,fileId,action},async()=>{
    ensure(current.revision===input.revision,409,'REVISION_CONFLICT','合同已更新，请刷新后重试');
    ensure(binding.removedAt==null&&(disposition==='remove'||binding.voidedAt==null),409,'BAAS_FILE_STATE','附件已作废或移除，请刷新');
    const at=new Date(),before=binding.voidedAt==null?'ACTIVE':'VOIDED';
    const data=disposition==='void'?{voidedAt:at,voidedBy:actor.id,voidReason:input.reason}:{removedAt:at,removedBy:actor.id,removeReason:input.reason};
    const changed=await tx.vehicleBaasContract.updateMany({where:{id,revision:input.revision},data:{revision:{increment:1},updatedBy:actor.id}});
    ensure(changed.count===1,409,'REVISION_CONFLICT','合同已更新，请刷新后重试');
    const fileChanged=await tx.assetPrivateFile.updateMany({where:{fileId,kind:'BAAS',baasContractId:id,removedAt:null,...(disposition==='void'?{voidedAt:null}:{})},data});
    ensure(fileChanged.count===1,409,'BAAS_FILE_STATE','附件已作废或移除，请刷新');
    const state=disposition==='void'?'VOIDED':'REMOVED',updated={...binding,...data};
    await audit(tx,actor.id,action,'baas-contracts',id,{vehicleId:current.vehicleId,fileId,name:metadata(binding.file).name,sha256:binding.sha256,before,after:state,previousRevision:input.revision,revision:input.revision+1,reason:input.reason,at:at.toISOString()});
    return{fileId,revision:input.revision+1,state,voidedAt:updated.voidedAt?.toISOString()??null,voidedBy:updated.voidedBy??null,voidReason:updated.voidReason??null,removedAt:updated.removedAt?.toISOString()??null,removedBy:updated.removedBy??null,removeReason:updated.removeReason??null};
   });
  });
 }
 private async upload(kind:Kind,id:string,raw:unknown,file:Express.Multer.File,actor:StaffActor){
  const input=inputSchema.parse(raw);
  ensure(file&&Buffer.isBuffer(file.buffer)&&file.buffer.length>0&&file.buffer.length<=limits.fileSize&&file.size===file.buffer.length&&validMime(file.buffer,file.mimetype)&&(kind!=='BAAS'||file.mimetype==='application/pdf'),400,'ASSET_FILE_INVALID',kind==='BAAS'?'请上传已签署的BaaS合同PDF，单份10MiB以内':'仅支持10MiB以内内容有效的PNG/JPEG/PDF文件');
  // Preflight rejects unauthorized uploads without saving bytes. The transaction
  // below rechecks the session and parent after disk I/O, before any mutation.
  await this.db.serial(async tx=>{await authorize(tx,actor,kind,true);await parent(tx,kind,id);});
  const stored=await saveFile(file),definition=definitions[kind],action='ASSET_FILE_UPLOAD';
  const command={...input,kind,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:createHash('sha256').update(file.buffer).digest('hex')};
  return this.db.serial(async tx=>{
   await authorize(tx,actor,kind,true);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:${definition.resource}:${id}:${action}:${input.idempotencyKey}`},0))`;
   const current=await lockParent(tx,kind,id);
   return archiveCommand(tx,actor,id,action,command,async()=>{
    ensure(current.revision===input.revision,409,'REVISION_CONFLICT','资产资料已变化，请刷新后重试');
    ensure(kind!=='COST'||!current.lockedAt,409,'ASSET_COST_LOCKED','已锁定成本不可变更附件');
    ensure(kind!=='RESIDUAL_OBSERVATION'||['ACTIVE','IGNORED'].includes(current.status),409,'ASSET_SOURCE_CLOSED','已作废样本不可追加依据');
    ensure(kind!=='VALUATION'||current.status==='PENDING',409,'ASSET_SOURCE_CLOSED','已完成复核不可追加依据');
    ensure(kind!=='WORK_ORDER'||!['CLOSED','CANCELLED'].includes(current.status),409,'ASSET_SOURCE_CLOSED','已关闭或取消工单不可追加凭据');
    ensure(kind!=='WORK_ORDER_COST'||current.status==='DRAFT',409,'ASSET_SOURCE_CLOSED','已冻结费用来源不可追加凭据');
    const changed=await (tx as any)[definition.model].updateMany({where:{id,revision:input.revision,...(kind==='COST'?{lockedAt:null}:{})},data:{revision:{increment:1},...(kind==='COST'?{}:{updatedBy:actor.id})}});
    ensure(changed.count===1,409,'REVISION_CONFLICT','资产资料已变化，请刷新后重试');
    const created=await tx.storedFile.create({data:{...stored,purpose:definition.purpose,customerId:null,adminId:actor.id}});
    await tx.assetPrivateFile.create({data:{fileId:created.id,kind,[definition.field]:id,sha256:created.sha256,uploadedBy:actor.id}});
    await audit(tx,actor.id,action,definition.resource,id,{fileId:created.id,sha256:created.sha256,revision:input.revision+1});
    return{...metadata(created),revision:input.revision+1,url:`/api/admin/${definition.resource}/${encodeURIComponent(id)}/files/${encodeURIComponent(created.id)}`};
   });
  });
 }
 @Post('admin/baas-contracts/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadBaas(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('BAAS',id,body,file,req.admin);}
 @Get('admin/baas-contracts/:id/files') listBaas(@Param('id')id:string,@Req()req:any){return this.list('BAAS',id,req.admin);}
 @Get('admin/baas-contracts/:id/files/:fileId') readBaas(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('BAAS',id,fileId,req.admin,res);}
 @Get('admin/baas-contracts/:id/files/:fileId/history') async readBaasHistory(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){const file=await this.db.serial(tx=>baasFileForRead(tx,req.admin,id,fileId,true));return streamFile(file,res);}
 @Post('admin/baas-contracts/:id/files/:fileId/void') voidBaas(@Param('id')id:string,@Param('fileId')fileId:string,@Body()body:unknown,@Req()req:any){return this.disposeBaas(id,fileId,body,req.admin,'void');}
 @Post('admin/baas-contracts/:id/files/:fileId/remove') removeBaas(@Param('id')id:string,@Param('fileId')fileId:string,@Body()body:unknown,@Req()req:any){return this.disposeBaas(id,fileId,body,req.admin,'remove');}
 @Post('admin/depreciation-policies/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadDepreciation(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('DEPRECIATION',id,body,file,req.admin);}
 @Get('admin/depreciation-policies/:id/files') listDepreciation(@Param('id')id:string,@Req()req:any){return this.list('DEPRECIATION',id,req.admin);}
 @Get('admin/depreciation-policies/:id/files/:fileId') readDepreciation(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('DEPRECIATION',id,fileId,req.admin,res);}
 @Post('admin/asset-costs/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadCost(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('COST',id,body,file,req.admin);}
 @Get('admin/asset-costs/:id/files') listCost(@Param('id')id:string,@Req()req:any){return this.list('COST',id,req.admin);}
 @Get('admin/asset-costs/:id/files/:fileId') readCost(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('COST',id,fileId,req.admin,res);}
 @Post('admin/license-plates/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadPlate(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('PLATE',id,body,file,req.admin);}
 @Get('admin/license-plates/:id/files') listPlate(@Param('id')id:string,@Req()req:any){return this.list('PLATE',id,req.admin);}
 @Get('admin/license-plates/:id/files/:fileId') readPlate(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('PLATE',id,fileId,req.admin,res);}
 @Post('admin/residual-observations/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadObservation(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('RESIDUAL_OBSERVATION',id,body,file,req.admin);}
 @Get('admin/residual-observations/:id/files') listObservation(@Param('id')id:string,@Req()req:any){return this.list('RESIDUAL_OBSERVATION',id,req.admin);}
 @Get('admin/residual-observations/:id/files/:fileId') readObservation(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('RESIDUAL_OBSERVATION',id,fileId,req.admin,res);}
 @Post('admin/vehicle-valuations/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadValuation(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('VALUATION',id,body,file,req.admin);}
 @Get('admin/vehicle-valuations/:id/files') listValuation(@Param('id')id:string,@Req()req:any){return this.list('VALUATION',id,req.admin);}
 @Get('admin/vehicle-valuations/:id/files/:fileId') readValuation(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('VALUATION',id,fileId,req.admin,res);}
 @Post('admin/asset-work-orders/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadWorkOrder(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('WORK_ORDER',id,body,file,req.admin);}
 @Get('admin/asset-work-orders/:id/files') listWorkOrder(@Param('id')id:string,@Req()req:any){return this.list('WORK_ORDER',id,req.admin);}
 @Get('admin/asset-work-orders/:id/files/:fileId') readWorkOrder(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('WORK_ORDER',id,fileId,req.admin,res);}
 @Post('admin/asset-work-order-cost-lines/:id/files') @UseInterceptors(FileInterceptor('file',{limits})) uploadWorkOrderCost(@Param('id')id:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File,@Req()req:any){return this.upload('WORK_ORDER_COST',id,body,file,req.admin);}
 @Get('admin/asset-work-order-cost-lines/:id/files') listWorkOrderCost(@Param('id')id:string,@Req()req:any){return this.list('WORK_ORDER_COST',id,req.admin);}
 @Get('admin/asset-work-order-cost-lines/:id/files/:fileId') readWorkOrderCost(@Param('id')id:string,@Param('fileId')fileId:string,@Req()req:any,@Res()res:any){return this.read('WORK_ORDER_COST',id,fileId,req.admin,res);}
}
