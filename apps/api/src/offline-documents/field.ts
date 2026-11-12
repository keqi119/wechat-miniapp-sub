import {uploadedFileName} from '../files/filename';
import {Body,Controller,Get,Inject,Injectable,Param,Post,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {z} from 'zod';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../common/db';
import {projectRoot} from '../common/config';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {assertDraft,validateArchiveFile,validateManifest,assertFileBinding} from './files';
import {archiveCommand} from './command';
import {requireArchivePrintConfirmed} from './archive-workflow';
import {ArchiveActor,fieldUploadSchema,fieldSubmitSchema} from './schemas';
import {lockOrder} from './readiness';
import {requireCurrentStaff} from '../auth/staff-session';
import {streamFile} from '../files/storage';
import {assertNotAssetFiles} from '../files/asset-files';
import {fieldReceiptKind} from '../field-handover/batches';
const submitSchema=fieldSubmitSchema.extend({signedOn:z.iso.date(),contractNumber:z.string().trim().min(1).max(100),originalCustodian:z.string().trim().min(1).max(200).optional(),originalLocation:z.string().trim().min(1).max(300).optional(),declaredPages:z.number().int().min(1).max(10000)}).strict();
const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
@Injectable()
export class FieldArchiveService {
 constructor(@Inject(Db)private db:Db){}
 private async scope(tx:any,taskId:string,input:any,actor:ArchiveActor){
  let task=await tx.fieldHandoverTask.findUnique({where:{id:taskId}});ensure(task,404,'NOT_FOUND','任务不存在');await lockOrder(tx,task.orderId);
  await tx.$queryRaw`SELECT id FROM "FieldHandoverTask" WHERE id = ${taskId} FOR UPDATE`;
  task=await tx.fieldHandoverTask.findUnique({where:{id:taskId}});await requireCurrentStaff(tx,actor,'field-tasks');
  ensure(actor.role==='FIELD',403,'FORBIDDEN','仅当前有效现场员工可提交本人交接材料');
  ensure(task.assigneeId===actor.id&&!['CANCELLED','COMPLETED'].includes(task.status),404,'NOT_FOUND','任务不可访问');
  ensure(task.version===input.taskVersion,409,'REVISION_CONFLICT','任务已变化');
  await tx.$queryRaw`SELECT id FROM "DocumentArchive" WHERE id = ${input.archiveId} FOR UPDATE`;
  const archive=await tx.documentArchive.findUnique({where:{id:input.archiveId},include:{versions:{include:{files:{orderBy:{position:'asc'},include:{file:true}}}}}});
  ensure(archive&&archive.orderId===task.orderId&&archive.handoverId===task.currentHandoverId&&['DELIVERY_RECEIPT','RETURN_RECEIPT'].includes(archive.kind),404,'NOT_FOUND','档案不属于当前任务');
  const version=archive.versions.find((v:any)=>v.id===input.versionId),handover=await tx.handover.findUnique({where:{id:task.currentHandoverId}});
  ensure(version&&handover&&handover.fieldTaskId===task.id,404,'NOT_FOUND','材料版本不存在');
  ensure(task.vehicleId===handover.vehicleId&&task.vehicleAssignmentId===handover.assignmentId&&task.type===handover.type&&archive.kind===fieldReceiptKind(task.type),409,'ARCHIVE_SNAPSHOT_MISMATCH','交接车辆或材料批次已变化');
  ensure(version.businessSnapshotHash===handover.manifestHash,409,'ARCHIVE_SNAPSHOT_MISMATCH','当前查验材料已变化');
  await assertNotAssetFiles(tx,[...(version.files||[]).map((f:any)=>f.fileId),...(version.sourceFileId?[version.sourceFileId]:[])]);
  return{archive,version,task};
 }
 async file(taskId:string,fileId:string,actor:ArchiveActor){return this.db.serial(async(tx:any)=>{
  const task=await tx.fieldHandoverTask.findUnique({where:{id:taskId}}),binding=await tx.archiveFile.findUnique({where:{fileId},include:{version:true,file:true}});
  ensure(task&&binding,404,'NOT_FOUND','任务附件不存在');
  const current=await this.scope(tx,taskId,{taskVersion:task.version,archiveId:binding.version.archiveId,versionId:binding.versionId},actor);
  const f=binding.file;
  ensure(current.version.files.some((v:any)=>v.fileId===fileId)&&f.purpose==='offline-archive'&&(!f.fieldTaskId||f.fieldTaskId===taskId&&f.fieldTaskGeneration===current.task.materialGeneration),404,'NOT_FOUND','当前任务材料不存在');return f;
 });}
 async upload(taskId:string,raw:unknown,file:Express.Multer.File,actor:ArchiveActor){
  const input=fieldUploadSchema.parse(raw);ensure(file?.buffer,400,'ARCHIVE_FILE_INVALID','请上传原文件');const valid=validateArchiveFile(file.buffer,file.mimetype);
  const name=uploadedFileName(file.originalname),request={...input,...valid,name};
  return this.db.serial(async(tx:any)=>{const {archive:a,version:v,task}=await this.scope(tx,taskId,input,actor);return archiveCommand(tx,actor,a.id,`FIELD_UPLOAD:${v.id}`,request,async()=>{ensure(a.revision===input.revision,409,'REVISION_CONFLICT','档案已变化');assertDraft(v);await requireArchivePrintConfirmed(tx,a,v);ensure(input.position===v.files.length+1,400,'ARCHIVE_FILE_INVALID','请按顺序上传');validateManifest([...v.files,{position:input.position,file:{id:'new',...valid}}]);
   const path=resolve(root,valid.sha256.slice(0,2),valid.sha256);await fs.mkdir(resolve(root,valid.sha256.slice(0,2)),{recursive:true});await fs.writeFile(path,file.buffer,{mode:0o600});
   const f=await tx.storedFile.create({data:{name,...valid,storagePath:path,purpose:'offline-archive',adminId:actor.id,fieldTaskId:taskId,fieldTaskGeneration:task.materialGeneration}});
   await tx.archiveFile.create({data:{versionId:v.id,fileId:f.id,position:input.position,uploadedBy:actor.id,uploadedRole:'FIELD'}});await tx.documentArchive.update({where:{id:a.id},data:{revision:{increment:1}}});await audit(tx,actor.id,'FIELD_ARCHIVE_UPLOAD','offline-archives',a.id,{versionId:v.id,fileId:f.id});
   return{id:f.id,archiveId:a.id,versionId:v.id,position:input.position,sha256:f.sha256,revision:a.revision+1};
  });});
 }
 async submit(taskId:string,raw:unknown,actor:ArchiveActor){const input=submitSchema.parse(raw);return this.db.serial(async(tx:any)=>{const{archive:a,version:v}=await this.scope(tx,taskId,input,actor);return archiveCommand(tx,actor,a.id,'FIELD_SUBMIT',input,async()=>{ensure(a.revision===input.revision,409,'REVISION_CONFLICT','档案已变化');assertDraft(v);await requireArchivePrintConfirmed(tx,a,v);
  for(const f of v.files){assertFileBinding(v,f);const bytes=await fs.readFile(f.file.storagePath),valid=validateArchiveFile(bytes,f.file.mimeType);ensure(valid.sha256===f.file.sha256&&valid.size===f.file.size,400,'ARCHIVE_FILE_INVALID','原文件摘要不匹配');}
  ensure(input.contractNumber===(v.contractNumber||a.id),409,'ARCHIVE_SOURCE_MISMATCH','合同编号须与已预览文件一致，请联系运营重新生成');const manifest=validateManifest(v.files);await tx.archiveVersion.update({where:{id:v.id},data:{status:'SUBMITTED',submittedBy:actor.id,submittedAt:new Date(),fileManifestHash:manifest,signedOn:input.signedOn,contractNumber:input.contractNumber,originalCustodian:input.originalCustodian,originalLocation:input.originalLocation,declaredPages:input.declaredPages}});await tx.documentArchive.update({where:{id:a.id},data:{revision:{increment:1}}});await audit(tx,actor.id,'FIELD_ARCHIVE_SUBMIT','offline-archives',a.id,{versionId:v.id});return{id:v.id,status:'SUBMITTED',revision:a.revision+1};
 });});}
}
@Controller('admin/field-tasks')
export class FieldArchiveController {
 constructor(@Inject(FieldArchiveService)private service:FieldArchiveService){}
 @Get(':taskId/offline-receipt/files/:fileId') async file(@Param('taskId')id:string,@Param('fileId')fileId:string,@Req()r:any,@Res()response:any){return streamFile(await this.service.file(id,fileId,{id:r.admin.id,role:r.admin.role,authVersion:r.admin.authVersion}),response);}
 @Post(':taskId/offline-receipt/files') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1}})) upload(@Param('taskId')id:string,@Body()b:unknown,@UploadedFile()f:Express.Multer.File,@Req()r:any){return this.service.upload(id,b,f,{id:r.admin.id,role:r.admin.role,authVersion:r.admin.authVersion});}
 @Post(':taskId/offline-receipt/submit') submit(@Param('taskId')id:string,@Body()b:unknown,@Req()r:any){return this.service.submit(id,b,{id:r.admin.id,role:r.admin.role,authVersion:r.admin.authVersion});}
}

