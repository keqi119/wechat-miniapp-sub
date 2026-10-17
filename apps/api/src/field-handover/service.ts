import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,key,pagination,text} from '../common/data';
import {createHandoverRecord,publishHandoverRecord,reviseHandoverRecord,guardHandoverOrder} from '../operations/handover-records';
import {draftInput,publishFacts,versionInput} from './rules';
import {saveFile,streamFile,validMime} from '../files/storage';
import {effectiveTerms} from '../order-changes/context';
const assignment=z.object({orderId:text,type:z.enum(['DELIVERY','RETURN']),assigneeId:text,note:z.string().trim().max(500).default('')}).strict();
const include={assignee:{select:{id:true,name:true,username:true}},order:{include:{vehicle:{select:{title:true,plateNumber:true,mileageKm:true}},customer:{select:{name:true}}}}};
@Injectable()
export class FieldHandoverService {
 constructor(@Inject(Db) private db:Db){}
 private async staff(tx:any,id:string){const u=await tx.adminUser.findFirst({where:{id,active:true,role:'FIELD'}});ensure(u,403,'FIELD_UNAVAILABLE','现场账号已停用或角色变化');return u;}
 async assigned(tx:any,id:string,actorId:string){await this.staff(tx,actorId);const task=await tx.fieldHandoverTask.findFirst({where:{id,assigneeId:actorId,status:'ASSIGNED'}});ensure(task,404,'NOT_FOUND','任务不存在或已改派、取消');return task;}
 private version(task:any,version:number){ensure(task.version===version,409,'VERSION_CONFLICT','任务已更新，请刷新后重新核对；未保存的输入请先记录');}
 private async editable(tx:any,task:any){
  const order=await tx.order.findUniqueOrThrow({where:{id:task.orderId}});
  ensure(order.vehicleId===task.vehicleId&&order.currentAssignmentId===task.vehicleAssignmentId,409,'VEHICLE_CONTEXT_CHANGED','订单车辆或交付批次已变化，旧材料已锁定，请后台核对后重新采集');
  const handover=task.currentHandoverId?await tx.handover.findUnique({where:{id:task.currentHandoverId}}):null;
  ensure(!handover||handover.status==='OBJECTION_SUBMITTED',409,'FACTS_LOCKED','已发布材料已锁定，客户提出异议后才能修订');
  ensure(!await tx.handover.count({where:{orderId:task.orderId,type:task.type,status:{not:'SUPERSEDED'},...(handover?{id:{not:handover.id}}:{})}}),409,'HANDOVER_CHANGED','后台已有其他交接版本，请由运营核对');
  return handover;
 }
 private async view(tx:any,id:string,admin=false){
  const t=await tx.fieldHandoverTask.findUniqueOrThrow({where:{id},include});
  const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:t.vehicleId}});
  const contextChanged=t.vehicleId!==t.order.vehicleId||t.vehicleAssignmentId!==t.order.currentAssignmentId;
  const h=t.currentHandoverId?await tx.handover.findUnique({where:{id:t.currentHandoverId}}):null;
  const d=draftInput.parse(t.draft);const ids=d.fileIds;
  const files=await tx.storedFile.findMany({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,id:{in:ids}},select:{id:true,name:true,size:true,mimeType:true}});
  // Never return the included Order/Customer rows to a field user.
  return {id:t.id,orderId:t.orderId,type:t.type,status:t.status,version:t.version,note:t.note,draft:d,files,
   assigneeId:t.assigneeId,assignee:t.assignee,createdAt:t.createdAt,updatedAt:t.updatedAt,
   vehicleTitle:vehicle.title,plateNumber:vehicle.plateNumber,customerName:t.order.customer.name,contextChanged,
   orderStatus:t.order.status,handoverId:t.currentHandoverId,handoverArrangement:(await effectiveTerms(tx,t.order))?.commercialTerms?.handoverArrangement||'',minReadingKm:Math.max(t.order.confirmedMileageKm,t.order.vehicle.mileageKm),
   canEdit:t.status==='ASSIGNED'&&!contextChanged&&(!h||h.status==='OBJECTION_SUBMITTED'),
   handover:h?{id:h.id,status:h.status,signatureStatus:h.signatureStatus,manifestHash:h.manifestHash,revision:h.revision,responseReason:h.responseReason,completedAt:h.completedAt}:null,
   ...(admin?{createdBy:t.createdBy,updatedBy:t.updatedBy}: {})};
 }
 async list(query:any,actorId?:string){return this.db.serial(async tx=>{
  if(actorId)await this.staff(tx,actorId);const p=pagination(query);const where:any=actorId?{assigneeId:actorId,status:'ASSIGNED'}:{};
  if(!actorId&&query.status)where.status=String(query.status);
  if(query.keyword)where.OR=['id','orderId'].map(k=>({[k]:{contains:String(query.keyword)}}));
  const rows=await tx.fieldHandoverTask.findMany({where,take:p.take,skip:p.skip,orderBy:{updatedAt:'desc'}});
  return{items:await Promise.all(rows.map(t=>this.view(tx,t.id,!actorId))),total:await tx.fieldHandoverTask.count({where}),page:p.page,pageSize:p.pageSize};
 });}
 async detail(id:string,actorId?:string){return this.db.serial(async tx=>{if(actorId)await this.assigned(tx,id,actorId);else ensure(await tx.fieldHandoverTask.count({where:{id}}),404,'NOT_FOUND','任务不存在');return this.view(tx,id,!actorId);});}
 async assignees(query:any){const p=pagination(query);const where:any={active:true,role:'FIELD',...(query.keyword?{OR:['name','username'].map(k=>({[k]:{contains:String(query.keyword)}}))}:{})};return{items:await this.db.adminUser.findMany({where,take:p.take,skip:p.skip,select:{id:true,name:true,username:true}}),total:await this.db.adminUser.count({where}),page:p.page,pageSize:p.pageSize};}
 create(body:unknown,actorId:string){const input=assignment.parse(body);return this.db.serial(async tx=>{
  await this.staff(tx,input.assigneeId);const order=await tx.order.findUnique({where:{id:input.orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
  await guardHandoverOrder(tx,order,input.type,Math.max(order.confirmedMileageKm,(await tx.vehicle.findUniqueOrThrow({where:{id:order.vehicleId}})).mileageKm));
  ensure(!await tx.fieldHandoverTask.count({where:{orderId:order.id,type:input.type}}),409,'TASK_EXISTS','该订单已有同类任务，请查看原任务');
  ensure(!await tx.handover.count({where:{orderId:order.id,type:input.type,status:{not:'SUPERSEDED'}}}),409,'HANDOVER_EXISTS','已有交接单，请继续原流程');
  const t=await tx.fieldHandoverTask.create({data:{...input,vehicleId:order.vehicleId,vehicleAssignmentId:order.currentAssignmentId,createdBy:actorId,updatedBy:actorId}});await audit(tx,actorId,'ASSIGN','handover-tasks',t.id,{assigneeId:input.assigneeId,orderId:order.id});return this.view(tx,t.id,true);
 });}
 restart(id:string,body:unknown,actorId:string){const input=z.object({version:versionInput,assigneeId:text,note:z.string().trim().min(1).max(500),reset:z.literal(true)}).strict().parse(body);return this.db.serial(async tx=>{
  const t=await tx.fieldHandoverTask.findUnique({where:{id}});ensure(t,404,'NOT_FOUND','任务不存在');this.version(t,input.version);
  ensure(!t.currentHandoverId,409,'PUBLISHED_TASK','已发布任务须先在原交接流程处理，不能清除事实');
  const order=await tx.order.findUniqueOrThrow({where:{id:t.orderId}});
  ensure(t.status==='CANCELLED'||t.vehicleId!==order.vehicleId||t.vehicleAssignmentId!==order.currentAssignmentId,409,'RESTART_NOT_REQUIRED','当前任务可正常办理，无须重新启用');
  await this.staff(tx,input.assigneeId);await guardHandoverOrder(tx,order,t.type,Math.max(order.confirmedMileageKm,(await tx.vehicle.findUniqueOrThrow({where:{id:order.vehicleId}})).mileageKm));
  ensure(!await tx.handover.count({where:{orderId:t.orderId,type:t.type,status:{not:'SUPERSEDED'}}}),409,'HANDOVER_EXISTS','后台已有交接单，请继续原流程');
  await tx.fieldHandoverTask.update({where:{id},data:{status:'ASSIGNED',assigneeId:input.assigneeId,vehicleId:order.vehicleId,vehicleAssignmentId:order.currentAssignmentId,draft:{},note:input.note,materialGeneration:{increment:1},version:{increment:1},updatedBy:actorId}});
  await audit(tx,actorId,'RESTART','handover-tasks',id,{previousDraft:t.draft,previousVehicleId:t.vehicleId,previousAssigneeId:t.assigneeId,previousGeneration:t.materialGeneration,...input});return this.view(tx,id,true);
 });}
 manage(id:string,body:unknown,actorId:string,cancel=false){const input=z.object({version:versionInput,assigneeId:text.optional(),note:z.string().trim().min(1).max(500)}).strict().parse(body);return this.db.serial(async tx=>{
  const t=await tx.fieldHandoverTask.findUnique({where:{id}});ensure(t?.status==='ASSIGNED',409,'STATE_CONFLICT','任务不可变更');this.version(t,input.version);
  if(cancel)ensure(!t.currentHandoverId,409,'PUBLISHED_TASK','已发布任务不能取消，请在原交接流程处理');else {ensure(input.assigneeId,400,'ASSIGNEE','请选择现场人员');await this.staff(tx,input.assigneeId);}
  await tx.fieldHandoverTask.update({where:{id},data:{...(cancel?{status:'CANCELLED'}:{assigneeId:input.assigneeId}),note:input.note,version:{increment:1},updatedBy:actorId}});
  await audit(tx,actorId,cancel?'CANCEL':'REASSIGN','handover-tasks',id,{previousAssigneeId:t.assigneeId,...input});return this.view(tx,id,true);
 });}
 save(id:string,body:unknown,actorId:string){const input=z.object({version:versionInput,draft:draftInput}).strict().parse(body);return this.db.serial(async tx=>{
  const t=await this.assigned(tx,id,actorId);this.version(t,input.version);await this.editable(tx,t);
  ensure(await tx.storedFile.count({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,id:{in:input.draft.fileIds}}})===new Set(input.draft.fileIds).size,403,'FILE_OWNERSHIP','只能选择本次任务的现场材料');
  await tx.fieldHandoverTask.update({where:{id},data:{draft:input.draft,version:{increment:1},updatedBy:actorId}});await audit(tx,actorId,'SAVE_DRAFT','handover-tasks',id,{version:t.version+1});return this.view(tx,id);
 });}
 publish(id:string,body:unknown,actorId:string){const input=z.object({version:versionInput,idempotencyKey:key,checked:z.literal(true)}).strict().parse(body);return this.db.serial(async tx=>{
  const t=await this.assigned(tx,id,actorId);
  if(t.lastPublishKey===input.idempotencyKey){ensure(t.lastPublishVersion===input.version,409,'IDEMPOTENCY_CONFLICT','发布编号对应的版本不一致');return this.view(tx,id);}
  this.version(t,input.version);const old=await this.editable(tx,t);const staff=await this.staff(tx,actorId);const facts=publishFacts(t.draft,staff.name,!!old);
  ensure(await tx.storedFile.count({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,id:{in:facts.fileIds}}})===new Set(facts.fileIds).size,403,'FILE_OWNERSHIP','请重新核对本次采集的附件');
  const next=old?await reviseHandoverRecord(tx,old.id,{...facts,resolutionNote:draftInput.parse(t.draft).resolutionNote},actorId,id):await createHandoverRecord(tx,{...facts,orderId:t.orderId,type:t.type},actorId,id);
  await publishHandoverRecord(tx,next.id,actorId);
  await tx.fieldHandoverTask.update({where:{id},data:{currentHandoverId:next.id,version:{increment:1},lastPublishKey:input.idempotencyKey,lastPublishVersion:input.version,updatedBy:actorId}});
  await audit(tx,actorId,'PUBLISH','handover-tasks',id,{handoverId:next.id,manifestHash:next.manifestHash});return this.view(tx,id);
 });}
 async upload(id:string,version:number,file:Express.Multer.File,actorId:string){
  ensure(file&&validMime(file.buffer,file.mimetype),400,'FILE_TYPE','请选择有效 JPEG、PNG 照片或 PDF；HEIC 请先导出为 JPEG');
  // Check ownership before disk I/O, then recheck inside the metadata transaction.
  await this.db.serial(async tx=>{const t=await this.assigned(tx,id,actorId);this.version(t,version);await this.editable(tx,t);});
  const data=await saveFile(file);
  return this.db.serial(async tx=>{const t=await this.assigned(tx,id,actorId);this.version(t,version);await this.editable(tx,t);const draft=draftInput.parse(t.draft);
   const duplicate=await tx.storedFile.findFirst({where:{fieldTaskId:id,sha256:data.sha256,id:{in:draft.fileIds}}});if(duplicate)return{id:duplicate.id,name:duplicate.name,mimeType:duplicate.mimeType,size:duplicate.size,task:await this.view(tx,id)};
   ensure(draft.fileIds.length<20,400,'FILE_LIMIT','每份交接最多20份材料');
   const f=await tx.storedFile.create({data:{...data,purpose:'handover',adminId:actorId,fieldTaskId:id,fieldTaskGeneration:t.materialGeneration}});
   await tx.fieldHandoverTask.update({where:{id},data:{draft:{...draft,fileIds:[...draft.fileIds,f.id]},version:{increment:1},updatedBy:actorId}});
   await audit(tx,actorId,'UPLOAD','handover-tasks',id,{fileId:f.id,sha256:f.sha256});return{id:f.id,name:f.name,mimeType:f.mimeType,size:f.size,task:await this.view(tx,id)};
  });
 }
 async readFile(id:string,fileId:string,actorId:string,response:any){const f=await this.db.serial(async tx=>{const t=await this.assigned(tx,id,actorId);const f=await tx.storedFile.findFirst({where:{id:fileId,fieldTaskId:id,fieldTaskGeneration:t.materialGeneration}});ensure(f,404,'NOT_FOUND','附件不存在');return f;});return streamFile(f,response);}
}
