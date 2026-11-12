import {Body,Controller,Get,Inject,Param,Patch,Post,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {z} from 'zod';
import {Db} from '../common/db';
import {projectRoot} from '../common/config';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import type {StaffActor} from '../auth/staff.types';
import {archiveCommand} from '../offline-documents/command';
import {readableFileName} from '../files/filename';
import {saveFile,validMime} from '../files/storage';

const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
const limits={fileSize:32*1024*1024,files:1};
const categories=['REGISTRATION','DRIVING_LICENSE','PURCHASE','PURCHASE_CONTRACT','INVOICE','INSURANCE','BAAS','PAYMENT','INSPECTION','PHOTO','OTHER'] as const;
const docxMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const mimeTypes=['application/pdf','image/jpeg','image/png',docxMime,'video/mp4'];
function validSourcePath(path:string){return path.length>0&&path.length<=1000&&!/[\\:\u0000-\u001f\u007f]/.test(path)&&path.split('/').every(segment=>segment.length>0&&segment!=='.'&&segment!=='..');}
const revision=z.preprocess(value=>typeof value==='string'&&/^\d+$/.test(value)?Number(value):value,z.number().int().min(0).max(2147483647));
const inputSchema=z.object({revision,vehicleRevision:revision,idempotencyKey:key,category:z.enum(categories),sourceRelativePath:z.string().refine(validSourcePath)}).strict();

/** Read a bounded ZIP directory without extracting or inflating untrusted data.
 * Required OOXML parts must point to consistent, non-encrypted local entries. */
function validDocx(buffer:Buffer){
 if(buffer.length<22||buffer.readUInt32LE(0)!==0x04034b50)return false;
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-22-65535);i--){if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}}
 if(end<0||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))return false;
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
 if(!count||count>10000||count!==buffer.readUInt16LE(end+8)||start+size!==end)return false;
 let cursor=start;const names=new Set<string>();
 for(let i=0;i<count;i++){
  if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50)return false;
  const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),nameSize=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42);
  if(flags&1||![0,8].includes(method)||!nameSize||cursor+46+nameSize+extra+comment>end||offset+30>start||buffer.readUInt32LE(offset)!==0x04034b50)return false;
  const rawName=buffer.subarray(cursor+46,cursor+46+nameSize),name=rawName.toString('utf8'),localNameSize=buffer.readUInt16LE(offset+26),localExtra=buffer.readUInt16LE(offset+28);
  if(names.has(name)||buffer.readUInt16LE(offset+6)!==flags||buffer.readUInt16LE(offset+8)!==method||localNameSize!==nameSize||offset+30+localNameSize+localExtra+compressed>start||!rawName.equals(buffer.subarray(offset+30,offset+30+localNameSize)))return false;
  names.add(name);cursor+=46+nameSize+extra+comment;
 }
 return cursor===end&&names.has('[Content_Types].xml')&&names.has('word/document.xml');
}
export function validDocumentMime(buffer:Buffer,mime:string){
 if(validMime(buffer,mime))return true;
 if(mime===docxMime)return validDocx(buffer);
 if(mime==='video/mp4'){
  if(buffer.length<16||buffer.toString('ascii',4,8)!=='ftyp')return false;
  const size=buffer.readUInt32BE(0);
  return size>=16&&size<=buffer.length&&size%4===0&&/^[\x20-\x7e]{4}$/.test(buffer.toString('ascii',8,12));
 }
 return false;
}
async function authorize(tx:any,actor:StaffActor,write=false){
 ensure(actor&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 const staff=await requireCurrentStaff(tx,actor,'vehicles',write);
 ensure(['ADMIN','OPERATIONS'].includes(staff.role),403,'FORBIDDEN','仅管理员和运营可访问车辆原件');
}
async function parent(tx:any,id:string){
 ensure(typeof id==='string'&&id.length>0,400,'VALIDATION','车辆编号无效');
 const row=await tx.vehicle.findUnique({where:{id}});ensure(row?.id===id,404,'NOT_FOUND','车辆不存在');return row;
}
function validateBinding(binding:any,vehicleId:string){
 ensure(binding.removedAt==null&&binding.removedBy==null,404,'NOT_FOUND','车辆原件不存在或已移除');
 const file=binding.file;
 ensure(binding.vehicleId===vehicleId&&file&&binding.fileId===file.id&&file.purpose==='vehicle-document'&&file.customerId===null&&!file.fieldTaskId&&typeof file.adminId==='string'&&file.adminId.length>0&&binding.uploadedBy===file.adminId&&typeof file.name==='string'&&file.name.length>0&&mimeTypes.includes(file.mimeType)&&Number.isInteger(file.size)&&file.size>0&&file.size<=limits.fileSize&&/^[a-f0-9]{64}$/.test(file.sha256)&&binding.sha256===file.sha256&&categories.includes(binding.category)&&typeof binding.sourceRelativePath==='string'&&validSourcePath(binding.sourceRelativePath),409,'VEHICLE_DOCUMENT_INVALID','原件归属、用途或摘要不一致');
 return file;
}
function metadata(binding:any){const file=binding.file;return{id:file.id,name:readableFileName(file.name),mimeType:file.mimeType,size:file.size,sha256:binding.sha256,category:binding.category,sourceRelativePath:binding.sourceRelativePath,createdAt:binding.createdAt};}

@Controller()
export class VehicleDocumentsController{
 constructor(@Inject(Db)private db:Db){}
 @Post('admin/vehicles/:vehicleId/documents/:fileId/remove')
 async remove(@Param('vehicleId')id:string,@Param('fileId')fileId:string,@Body()raw:unknown,@Req()request:any){
  const input=z.object({revision,vehicleRevision:revision,idempotencyKey:key}).strict().parse(raw),actor:StaffActor=request.admin,action='VEHICLE_DOCUMENT_REMOVE';
  return this.db.serial(async(tx:any)=>{
   await authorize(tx,actor,true);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:vehicles:${id}:${action}:${input.idempotencyKey}`},0))`;
   await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;const vehicle=await parent(tx,id);
   // Keep the active check inside the operation: an already committed request
   // must replay its original acknowledgement after the binding was removed.
   return archiveCommand(tx,actor,id,action,{...input,fileId},async()=>{
    ensure(vehicle.documentRevision===input.revision&&vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆或原件列表已变化，请刷新后核对');
    const binding=await tx.vehicleDocumentFile.findUnique({where:{fileId},include:{file:true}});ensure(binding?.vehicleId===id,404,'NOT_FOUND','车辆原件不存在');validateBinding(binding,id);
    const changed=await tx.vehicle.updateMany({where:{id,revision:input.vehicleRevision,documentRevision:input.revision},data:{documentRevision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','原件列表已变化');
    const removedAt=new Date();
    const removed=await tx.vehicleDocumentFile.updateMany({where:{fileId,vehicleId:id,removedAt:null},data:{removedAt,removedBy:actor.id}});ensure(removed.count===1,409,'REVISION_CONFLICT','原件列表已变化');
    // The row remains a permanent private-file boundary. Neither StoredFile nor
    // content-addressed bytes are deleted: other historical files may share them.
    await audit(tx,actor.id,action,'vehicles',id,{fileId,sha256:binding.sha256,category:binding.category,sourceRelativePath:binding.sourceRelativePath,removedAt,revision:input.revision+1,vehicleRevision:input.vehicleRevision});
    return{removed:true,fileId,revision:input.revision+1,vehicleRevision:input.vehicleRevision};
   });
  });
 }
 @Patch('admin/vehicles/:vehicleId/documents/:fileId/category')
 async category(@Param('vehicleId')id:string,@Param('fileId')fileId:string,@Body()raw:unknown,@Req()request:any){
  const input=z.object({revision,vehicleRevision:revision,idempotencyKey:key,category:z.enum(categories)}).strict().parse(raw),actor=request.admin,action='VEHICLE_DOCUMENT_CATEGORY';
  return this.db.serial(async(tx:any)=>{
   await authorize(tx,actor,true);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:vehicles:${id}:${action}:${input.idempotencyKey}`},0))`;
   await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;const vehicle=await parent(tx,id);
   return archiveCommand(tx,actor,id,action,{...input,fileId},async()=>{
    ensure(vehicle.documentRevision===input.revision&&vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆或原件列表已变化，请刷新后核对');
    const binding=await tx.vehicleDocumentFile.findUnique({where:{fileId},include:{file:true}});ensure(binding?.vehicleId===id,404,'NOT_FOUND','车辆原件不存在');validateBinding(binding,id);
    ensure(binding.category!==input.category,409,'CATEGORY_UNCHANGED','请选择不同的原件分类');
    const changed=await tx.vehicle.updateMany({where:{id,revision:input.vehicleRevision,documentRevision:input.revision},data:{documentRevision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','原件列表已变化');
    await tx.vehicleDocumentFile.update({where:{fileId},data:{category:input.category}});
    await audit(tx,actor.id,action,'vehicles',id,{fileId,beforeCategory:binding.category,category:input.category,revision:input.revision+1,vehicleRevision:input.vehicleRevision});
    return{...metadata({...binding,category:input.category}),revision:input.revision+1,vehicleRevision:input.vehicleRevision};
   });
  });
 }
 @Get('admin/vehicles/:vehicleId/documents')
 async list(@Param('vehicleId')id:string,@Req()request:any){
  return this.db.serial(async(tx:any)=>{
   await authorize(tx,request.admin);const vehicle=await parent(tx,id);
   const bindings=await tx.vehicleDocumentFile.findMany({where:{vehicleId:id,removedAt:null},include:{file:true},orderBy:[{createdAt:'asc'},{fileId:'asc'}]});
   for(const binding of bindings)validateBinding(binding,id);
   return{revision:vehicle.documentRevision,vehicleRevision:vehicle.revision,items:bindings.map(metadata)};
  });
 }
 @Get('admin/vehicles/:vehicleId/documents/:fileId')
 async read(@Param('vehicleId')id:string,@Param('fileId')fileId:string,@Req()request:any,@Res()response:any){
  return this.stream(await this.original(id,fileId,request),response,'attachment');
 }
 @Get('admin/vehicles/:vehicleId/documents/:fileId/open')
 async open(@Param('vehicleId')id:string,@Param('fileId')fileId:string,@Req()request:any,@Res()response:any){
  const file=await this.original(id,fileId,request);
  return this.stream(file,response,file.mimeType===docxMime?'attachment':'inline');
 }
 private async original(id:string,fileId:string,request:any){
  return this.db.serial(async(tx:any)=>{
   await authorize(tx,request.admin);await parent(tx,id);
   const binding=await tx.vehicleDocumentFile.findUnique({where:{fileId},include:{file:true}});
   ensure(binding&&binding.vehicleId===id,404,'NOT_FOUND','车辆原件不存在');return validateBinding(binding,id);
  });
 }
 private stream(file:any,response:any,disposition:'attachment'|'inline'){
  ensure(resolve(file.storagePath).startsWith(root+sep),500,'STORAGE_PATH','文件存储异常');
  response.setHeader('Content-Type',file.mimeType);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','private, no-store');response.setHeader('Content-Disposition',`${disposition}; filename*=UTF-8''${encodeURIComponent(readableFileName(file.name))}`);return response.sendFile(file.storagePath);
 }
 @Post('admin/vehicles/:vehicleId/documents') @UseInterceptors(FileInterceptor('file',{limits}))
 async upload(@Param('vehicleId')id:string,@Body()raw:unknown,@UploadedFile()file:Express.Multer.File,@Req()request:any){
  const input=inputSchema.parse(raw),actor:StaffActor=request.admin;
  ensure(file&&Buffer.isBuffer(file.buffer)&&file.buffer.length>0&&file.buffer.length<=limits.fileSize&&file.size===file.buffer.length&&validDocumentMime(file.buffer,file.mimetype),400,'VEHICLE_DOCUMENT_INVALID','仅支持32MiB以内有效PDF/JPEG/PNG/DOCX/MP4原件');
  await this.db.serial(async(tx:any)=>{await authorize(tx,actor,true);await parent(tx,id);});
  const stored=await saveFile(file),action='VEHICLE_DOCUMENT_UPLOAD';
  const command={...input,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:createHash('sha256').update(file.buffer).digest('hex')};
  return this.db.serial(async(tx:any)=>{
   await authorize(tx,actor,true);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.id}:vehicles:${id}:${action}:${input.idempotencyKey}`},0))`;
   await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;
   const vehicle=await parent(tx,id);
   return archiveCommand(tx,actor,id,action,command,async()=>{
    ensure(vehicle.documentRevision===input.revision&&vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆或原件列表已变化，请刷新后重试');
    const duplicate=await tx.vehicleDocumentFile.findUnique({where:{vehicleId_sourceRelativePath:{vehicleId:id,sourceRelativePath:input.sourceRelativePath}}});
    ensure(!duplicate,409,'VEHICLE_DOCUMENT_PATH_EXISTS','此来源路径已有原件，请核对原始上传请求');
    const changed=await tx.vehicle.updateMany({where:{id,revision:input.vehicleRevision,documentRevision:input.revision},data:{documentRevision:{increment:1}}});
    ensure(changed.count===1,409,'REVISION_CONFLICT','车辆或原件列表已变化，请刷新后重试');
    const created=await tx.storedFile.create({data:{...stored,purpose:'vehicle-document',customerId:null,adminId:actor.id}});
    const binding=await tx.vehicleDocumentFile.create({data:{fileId:created.id,vehicleId:id,category:input.category,sourceRelativePath:input.sourceRelativePath,sha256:created.sha256,uploadedBy:actor.id}});
    await audit(tx,actor.id,action,'vehicles',id,{fileId:created.id,sha256:created.sha256,category:input.category,sourceRelativePath:input.sourceRelativePath,revision:input.revision+1,vehicleRevision:input.vehicleRevision});
    return{...metadata({...binding,file:created}),revision:input.revision+1,vehicleRevision:input.vehicleRevision,url:`/api/admin/vehicles/${encodeURIComponent(id)}/documents/${encodeURIComponent(created.id)}`};
   });
  });
 }
}
