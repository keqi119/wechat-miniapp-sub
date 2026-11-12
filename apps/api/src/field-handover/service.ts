import {currentSwapReceipt} from '../vehicle-changes/swap-receipt';
import {publicOnlineRecord,publicOnlineConfirmation} from '../operations/online-handover';
import {Inject,Injectable} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,key,pagination} from '../common/data';
import {createHandoverRecord,publishHandoverRecord,reviseHandoverRecord,guardHandoverOrder} from '../operations/handover-records';
import {createSwapHandover,guardSwapHandoverReservation} from '../vehicle-changes/handovers';
import {draftInput,publishFacts,versionInput} from './rules';
import {saveFile,streamFile,validMime} from '../files/storage';
import {currentPhysicalReceipt} from '../offline-documents/vehicle-receipt';
import {archivePrintConfirmed} from '../offline-documents/archive-workflow';
import {assertNotAssetFiles} from '../files/asset-files';
import {deriveFieldHandoverBatch,fieldReceiptKind,type FieldHandoverBatch} from './batches';
import {assignmentInput,fieldActor,fieldId,fieldNote,loadFieldFacts,lockFieldOrder,lockFieldTask,taskHandover,taskMinimumReading,taskSource,unoccupiedTaskBatch,type FieldActor} from './task-context';
import {fieldTaskTransaction} from './transaction';
const include={assignee:{select:{id:true,name:true,username:true}},order:{include:{customer:{select:{name:true}}}}};
const safeDraft=draftInput.refine(d=>Object.values(d).every(v=>typeof v==='string'?!v.includes('\0'):!Array.isArray(v)||v.every(id=>!id.includes('\0'))),'材料不得含空字符');
const frozen=(b:FieldHandoverBatch)=>({batchKey:b.batchKey,changeId:b.changeId,quoteId:b.quoteId,termsVersionId:b.termsVersionId,vehicleId:b.vehicleId,vehicleAssignmentId:b.vehicleAssignmentId});
@Injectable()
export class FieldHandoverService {
 constructor(@Inject(Db) private db:Db){}
 private async staff(tx:any,id:string){const u=await tx.adminUser.findUnique({where:{id}});ensure(u?.active&&u.role==='FIELD',403,'FIELD_UNAVAILABLE','现场账号已停用或角色变化');return u;}
 async assigned(tx:any,id:string,actor:FieldActor,write=true){const current=await fieldActor(tx,actor,true,write);const task=await tx.fieldHandoverTask.findFirst({where:{id,assigneeId:current.id,status:'ASSIGNED'}});ensure(task,404,'NOT_FOUND','任务不存在或已改派、取消');return task;}
 private async owned(tx:any,id:string,actor:FieldActor){const current=await fieldActor(tx,actor,true);const task=await lockFieldTask(tx,id);ensure(task.assigneeId===current.id&&task.status==='ASSIGNED',404,'NOT_FOUND','任务不存在或已改派、取消');return{task,current};}
 private version(task:any,version:number){ensure(task.version===version,409,'VERSION_CONFLICT','任务已更新，请刷新后重新核对；未保存的输入请先记录');}
 private async update(tx:any,task:any,data:any){ensure(task.version<2147483647,409,'VERSION_LIMIT','任务版本已达上限');const changed=await tx.fieldHandoverTask.updateMany({where:{id:task.id,version:task.version,status:task.status,assigneeId:task.assigneeId},data:{...data,version:{increment:1}}});ensure(changed.count===1,409,'VERSION_CONFLICT','任务已更新，请刷新核对');}
 private async editable(tx:any,task:any){
  const facts=await loadFieldFacts(tx,task.orderId),source=taskSource(task,facts);
  ensure(!source.contextChanged&&source.batch,409,'VEHICLE_CONTEXT_CHANGED','交接批次、车辆或报价已变化，旧材料已锁定，请后台核对后重新采集');
  const handover=task.currentHandoverId?facts.handovers.find(h=>h.id===task.currentHandoverId):null;
  ensure(!handover||handover.status==='OBJECTION_SUBMITTED',409,'FACTS_LOCKED','已发布材料已锁定，客户提出异议后才能修订');
  unoccupiedTaskBatch(source.batch,facts,task);return{handover,batch:source.batch,facts};
 }
 private async guardBatch(tx:any,batch:FieldHandoverBatch,order:any){
  if(batch.changeId){ensure(batch.type==='SWAP_RETURN'||batch.type==='SWAP_DELIVERY',409,'FIELD_BATCH_SOURCE_INVALID','换车批次类型不一致');return guardSwapHandoverReservation(tx,{orderId:batch.orderId,customerId:batch.customerId,changeId:batch.changeId,type:batch.type,vehicleId:batch.vehicleId,assignmentId:batch.vehicleAssignmentId});}
  const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:batch.vehicleId}}),readingKm=await taskMinimumReading(tx,batch,order,vehicle);
  return guardHandoverOrder(tx,order,batch.type,readingKm,true);
 }
 private async view(tx:any,id:string,admin=false){
  const t=await tx.fieldHandoverTask.findUniqueOrThrow({where:{id},include}),vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:t.vehicleId}}),facts=await loadFieldFacts(tx,t.orderId);
  const source=t.status==='COMPLETED'?{contextChanged:false,blockers:[]}:taskSource(t,facts),contextChanged=source.contextChanged;
  const h=taskHandover(t,facts);
  const receipt=t.type==='RETURN'?await currentPhysicalReceipt(tx,t.orderId):t.type==='SWAP_RETURN'&&t.order.contractMode==='ELECTRONIC'?await currentSwapReceipt(tx,t.changeId):null;
  const archive=(h as any)?.executionMode==='OFFLINE'&&(h as any)?.confirmationMode!=='ONLINE_RECORD'?await tx.documentArchive.findFirst({where:{handoverId:h!.id,kind:fieldReceiptKind(t.type)},include:{versions:{orderBy:{version:'desc'},take:1,include:{files:{orderBy:{position:'asc'},include:{file:{select:{id:true,name:true,mimeType:true,size:true}}}}}}}}):null;
  const paper=archive?.versions[0],d=draftInput.parse(t.draft),ids=d.fileIds;
  const files=await tx.storedFile.findMany({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,id:{in:ids}},select:{id:true,name:true,size:true,mimeType:true}});
  await assertNotAssetFiles(tx,[...ids,...(paper?.files||[]).map((f:any)=>f.fileId),...(paper?.sourceFileId?[paper.sourceFileId]:[])]);
  const terms:any=t.termsVersionId?facts.termsVersions.find(v=>v.id===t.termsVersionId):null,quote:any=t.quoteId?facts.quotes.find(v=>v.id===t.quoteId):null;
  const arrangement=quote?.snapshot.handoverArrangement||terms?.snapshot?.commercialTerms?.handoverArrangement||t.order.finalPlanSnapshot?.commercialTerms?.handoverArrangement||'';
  return {id:t.id,orderId:t.orderId,type:t.type,batchKey:t.batchKey,changeId:t.changeId??null,quoteId:t.quoteId??null,termsVersionId:t.termsVersionId??null,vehicleId:t.vehicleId,vehicleAssignmentId:t.vehicleAssignmentId??null,status:t.status,version:t.version,note:t.note,draft:d,files:files.map((f:any)=>({id:f.id,name:f.name,size:f.size,mimeType:f.mimeType})),
   assigneeId:t.assigneeId,assignee:t.assignee?{id:t.assignee.id,name:t.assignee.name}:null,createdAt:t.createdAt,updatedAt:t.updatedAt,vehicleTitle:vehicle.title,plateNumber:vehicle.plateNumber,customerName:t.order.customer.name,contextChanged,sourceBlockers:source.blockers,
   orderStatus:t.order.status,handoverId:t.currentHandoverId,handoverArrangement:typeof arrangement==='string'?arrangement:'',minReadingKm:await taskMinimumReading(tx,t,t.order,vehicle),canEdit:t.status==='ASSIGNED'&&!contextChanged&&(!h||h.status==='OBJECTION_SUBMITTED'),
   contractMode:t.order.contractMode,physicalReceipt:receipt?{id:receipt.id,revision:receipt.revision,receivedAt:receipt.receivedAt,readingKm:receipt.readingKm,storageLocation:receipt.storageLocation}:null,
   offlineReceipt:archive&&paper?{archiveId:archive.id,revision:archive.revision,versionId:paper.id,version:paper.version,status:paper.status,printConfirmed:await archivePrintConfirmed(tx,archive,paper),manifestMatches:paper.businessSnapshotHash===(h as any).manifestHash,files:paper.files.map((f:any)=>({id:f.file.id,name:f.file.name,mimeType:f.file.mimeType,size:f.file.size,position:f.position})),signedOn:paper.signedOn,contractNumber:paper.contractNumber||archive.id,originalCustodian:paper.originalCustodian,originalLocation:paper.originalLocation,declaredPages:paper.declaredPages}:null,
   canRecordPhysicalReceipt:(t.type==='RETURN'&&(t.order.contractMode==='OFFLINE'||t.order.contractMode==='ELECTRONIC'&&(h as any)?.confirmationMode==='ONLINE_RECORD'&&['PUBLISHED','CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED'].includes(h?.status??''))||t.type==='SWAP_RETURN'&&t.order.contractMode==='ELECTRONIC')&&t.order.status==='ACTIVE'&&t.status==='ASSIGNED'&&!contextChanged&&!!h&&!receipt,
   handover:h?{id:h.id,status:h.status,executionMode:(h as any).executionMode,confirmationMode:(h as any).confirmationMode,...(admin?{onlineRecord:publicOnlineRecord((h as any).onlineRecordSnapshot),onlineConfirmation:publicOnlineConfirmation((h as any).onlineConfirmation)}:{}),signatureStatus:(h as any).signatureStatus,manifestHash:(h as any).manifestHash,revision:(h as any).revision,responseReason:(h as any).responseReason,completedAt:(h as any).completedAt}:null,...(admin?{createdBy:t.createdBy,updatedBy:t.updatedBy}:{})};
 }
 async list(query:any,actor:FieldActor,field?:boolean){return this.db.serial(async tx=>{
  field=field??(typeof actor==='string'?(await tx.adminUser.findUnique({where:{id:actor}}))?.role==='FIELD':false);
  const current=await fieldActor(tx,actor,field,false),p=pagination(query),where:any=field?{assigneeId:current.id,status:'ASSIGNED'}:{};
  if(!field&&query.status)where.status=String(query.status);if(query.keyword)where.OR=['id','orderId'].map(k=>({[k]:{contains:String(query.keyword)}}));
  const rows=await tx.fieldHandoverTask.findMany({where,take:p.take,skip:p.skip,orderBy:[{updatedAt:'desc'},{id:'asc'}]});return{items:await Promise.all(rows.map(t=>this.view(tx,t.id,!field))),total:await tx.fieldHandoverTask.count({where}),page:p.page,pageSize:p.pageSize};
 });}
 async detail(id:string,actor:FieldActor,field?:boolean){fieldId.parse(id);return this.db.serial(async tx=>{field=field??(typeof actor==='string'?(await tx.adminUser.findUnique({where:{id:actor}}))?.role==='FIELD':false);if(field)await this.assigned(tx,id,actor,false);else{await fieldActor(tx,actor,false,false);ensure(await tx.fieldHandoverTask.count({where:{id}}),404,'NOT_FOUND','任务不存在');}return this.view(tx,id,!field);});}
 async assignees(query:any,actor:FieldActor){return this.db.serial(async tx=>{await fieldActor(tx,actor,false,false);const p=pagination(query),where:any={active:true,role:'FIELD',...(query.keyword?{OR:['name','username'].map(k=>({[k]:{contains:String(query.keyword)}}))}:{})};return{items:await tx.adminUser.findMany({where,take:p.take,skip:p.skip,select:{id:true,name:true,username:true}}),total:await tx.adminUser.count({where}),page:p.page,pageSize:p.pageSize};});}
 create(body:unknown,actor:FieldActor){const input=assignmentInput.parse(body);return fieldTaskTransaction(this.db,async tx=>{
  const current=await fieldActor(tx,actor,false);await this.staff(tx,input.assigneeId);await lockFieldOrder(tx,input.orderId);const facts=await loadFieldFacts(tx,input.orderId),order=facts.order as any;
  if(!input.changeId)await guardHandoverOrder(tx,order,input.type,Math.max(order.confirmedMileageKm,(await tx.vehicle.findUniqueOrThrow({where:{id:order.vehicleId}})).mileageKm),true);
  const batch=deriveFieldHandoverBatch({orderId:input.orderId,type:input.type,changeId:input.changeId},facts);unoccupiedTaskBatch(batch,facts);if(batch.changeId)await this.guardBatch(tx,batch,order);
  const t=await tx.fieldHandoverTask.create({data:{orderId:input.orderId,type:input.type,assigneeId:input.assigneeId,note:input.note,...frozen(batch),createdBy:current.id,updatedBy:current.id}});await audit(tx,current.id,'ASSIGN','handover-tasks',t.id,{assigneeId:input.assigneeId,orderId:order.id,...frozen(batch)});return this.view(tx,t.id,true);
 });}
 restart(id:string,body:unknown,actor:FieldActor){fieldId.parse(id);const input=z.object({version:versionInput,assigneeId:fieldId,note:fieldNote.min(1),reset:z.literal(true)}).strict().parse(body);return this.db.serial(async tx=>{
  const current=await fieldActor(tx,actor,false),t=await lockFieldTask(tx,id);this.version(t,input.version);ensure(t.status!=='COMPLETED',409,'COMPLETED_TASK','已完成交接不可重启或覆盖');
  const facts=await loadFieldFacts(tx,t.orderId),source=taskSource(t,facts),legacy=!t.batchKey||t.batchKey.startsWith('LEGACY:');
  ensure(source.batch&&!source.blockers.includes('FIELD_BATCH_LEGACY_REVIEW_REQUIRED')&&(!legacy||!source.contextChanged),409,'FIELD_BATCH_LEGACY_REVIEW_REQUIRED','旧任务来源尚未核清，请保留历史并核对原交接依据');
  const batch=source.batch;ensure(legacy||batch.batchKey===t.batchKey,409,'FIELD_BATCH_CHANGED','条款已形成新的交接批次，请取消未发布旧任务后创建新批次');
  const published=facts.handovers.filter(h=>h.fieldTaskId===t.id||h.id===t.currentHandoverId);ensure(published.every(h=>h.status==='SUPERSEDED'),409,'PUBLISHED_TASK','已发布任务须先在原交接流程处理，不能清除事实');
  ensure(!t.currentHandoverId||published.some(h=>h.id===t.currentHandoverId),409,'PUBLISHED_TASK','原发布事实缺失，不能清除');
  ensure(t.status==='CANCELLED'||source.contextChanged||published.length>0,409,'RESTART_NOT_REQUIRED','当前任务可正常办理，无须重新启用');
  await this.staff(tx,input.assigneeId);unoccupiedTaskBatch(batch,facts,t);await this.guardBatch(tx,batch,facts.order);
  const previous={previousDraft:t.draft,previousVehicleId:t.vehicleId,previousAssigneeId:t.assigneeId,previousGeneration:t.materialGeneration,previousQuoteId:t.quoteId,previousTermsVersionId:t.termsVersionId};
  await this.update(tx,t,{status:'ASSIGNED',assigneeId:input.assigneeId,...frozen(batch),currentHandoverId:null,draft:{},note:input.note,materialGeneration:{increment:1},lastPublishKey:null,lastPublishVersion:null,updatedBy:current.id});
  await audit(tx,current.id,'RESTART','handover-tasks',id,{...previous,...input});return this.view(tx,id,true);
 });}
 manage(id:string,body:unknown,actor:FieldActor,cancel=false){fieldId.parse(id);const input=z.object({version:versionInput,assigneeId:fieldId.optional(),note:fieldNote.min(1)}).strict().parse(body);return this.db.serial(async tx=>{
  const current=await fieldActor(tx,actor,false),t=await lockFieldTask(tx,id);ensure(t.status==='ASSIGNED',409,'STATE_CONFLICT','任务不可变更');this.version(t,input.version);
  if(cancel)ensure(!t.currentHandoverId,409,'PUBLISHED_TASK','已发布任务不能取消，请在原交接流程处理');else{ensure(input.assigneeId,400,'ASSIGNEE','请选择现场人员');await this.staff(tx,input.assigneeId);}
  const previousAssigneeId=t.assigneeId;await this.update(tx,t,{...(cancel?{status:'CANCELLED'}:{assigneeId:input.assigneeId}),note:input.note,updatedBy:current.id});await audit(tx,current.id,cancel?'CANCEL':'REASSIGN','handover-tasks',id,{previousAssigneeId,...input});return this.view(tx,id,true);
 });}
 save(id:string,body:unknown,actor:FieldActor){fieldId.parse(id);const input=z.object({version:versionInput,draft:safeDraft}).strict().parse(body);return this.db.serial(async tx=>{
  const {task:t,current}=await this.owned(tx,id,actor);this.version(t,input.version);await this.editable(tx,t);
  ensure(await tx.storedFile.count({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,id:{in:input.draft.fileIds}}})===new Set(input.draft.fileIds).size,403,'FILE_OWNERSHIP','只能选择本次任务的现场材料');await assertNotAssetFiles(tx,input.draft.fileIds);
  const nextVersion=t.version+1;await this.update(tx,t,{draft:input.draft,updatedBy:current.id});await audit(tx,current.id,'SAVE_DRAFT','handover-tasks',id,{version:nextVersion});return this.view(tx,id);
 });}
 publish(id:string,body:unknown,actor:FieldActor){fieldId.parse(id);const input=z.object({version:versionInput,idempotencyKey:key.refine(v=>!v.includes('\0')),checked:z.literal(true)}).strict().parse(body);return this.db.serial(async tx=>{
  const {task:t,current}=await this.owned(tx,id,actor);
  if(t.lastPublishKey===input.idempotencyKey){ensure(t.lastPublishVersion===input.version,409,'IDEMPOTENCY_CONFLICT','发布编号对应的版本不一致');return this.view(tx,id);}
  this.version(t,input.version);const context=await this.editable(tx,t),old=context.handover,facts=publishFacts(safeDraft.parse(t.draft),current.name,!!old);
  ensure(await tx.storedFile.count({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,id:{in:facts.fileIds}}})===new Set(facts.fileIds).size,403,'FILE_OWNERSHIP','请重新核对本次采集的附件');await assertNotAssetFiles(tx,facts.fileIds);
  let next:any;
  if(old)next=await reviseHandoverRecord(tx,old.id,{...facts,resolutionNote:draftInput.parse(t.draft).resolutionNote},current.id,id);
  else if(context.batch.changeId){const change=context.facts.changes.find(c=>c.id===context.batch.changeId);next=await createSwapHandover(tx,change,{...facts,side:t.type==='SWAP_RETURN'?'RETURN':'DELIVERY'},current,{taskId:t.id,quoteId:context.batch.quoteId!});}
  else next=await createHandoverRecord(tx,{...facts,orderId:t.orderId,type:t.type},current.id,id);
  await publishHandoverRecord(tx,next.id,current.id);
  await this.update(tx,t,{currentHandoverId:next.id,lastPublishKey:input.idempotencyKey,lastPublishVersion:input.version,updatedBy:current.id});await audit(tx,current.id,'PUBLISH','handover-tasks',id,{handoverId:next.id,manifestHash:next.manifestHash,...frozen(context.batch)});return this.view(tx,id);
 });}
 async upload(id:string,version:number,file:Express.Multer.File,actor:FieldActor){
  fieldId.parse(id);ensure(file&&validMime(file.buffer,file.mimetype),400,'FILE_TYPE','请选择有效 JPEG、PNG 照片或 PDF；HEIC 请先导出为 JPEG');
  await this.db.serial(async tx=>{const{task:t}=await this.owned(tx,id,actor);this.version(t,version);await this.editable(tx,t);await assertNotAssetFiles(tx,draftInput.parse(t.draft).fileIds);});
  const data=await saveFile(file);
  return this.db.serial(async tx=>{const{task:t,current}=await this.owned(tx,id,actor);this.version(t,version);await this.editable(tx,t);const draft=draftInput.parse(t.draft);
   const duplicate=await tx.storedFile.findFirst({where:{fieldTaskId:id,fieldTaskGeneration:t.materialGeneration,sha256:data.sha256,id:{in:draft.fileIds}}});if(duplicate)return{id:duplicate.id,name:duplicate.name,mimeType:duplicate.mimeType,size:duplicate.size,task:await this.view(tx,id)};
   ensure(draft.fileIds.length<20,400,'FILE_LIMIT','每份交接最多20份材料');const f=await tx.storedFile.create({data:{...data,purpose:'handover',adminId:current.id,fieldTaskId:id,fieldTaskGeneration:t.materialGeneration}});
   await this.update(tx,t,{draft:{...draft,fileIds:[...draft.fileIds,f.id]},updatedBy:current.id});await audit(tx,current.id,'UPLOAD','handover-tasks',id,{fileId:f.id,sha256:f.sha256});return{id:f.id,name:f.name,mimeType:f.mimeType,size:f.size,task:await this.view(tx,id)};
  });
 }
 async readFile(id:string,fileId:string,actor:FieldActor,response:any){fieldId.parse(id);fieldId.parse(fileId);const f=await this.db.serial(async tx=>{const t=await this.assigned(tx,id,actor,false),f=await tx.storedFile.findFirst({where:{id:fileId,fieldTaskId:id,fieldTaskGeneration:t.materialGeneration}});ensure(f,404,'NOT_FOUND','附件不存在');ensure(!['offline-archive','offline-source'].includes(f.purpose),403,'ARCHIVE_ROUTE_REQUIRED','请从当前任务纸质档案入口读取');await assertNotAssetFiles(tx,[fileId]);return f;});return streamFile(f,response);}
}
