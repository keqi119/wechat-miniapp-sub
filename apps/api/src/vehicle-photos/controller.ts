import {Body,Controller,Get,Inject,Param,Patch,Post,Req,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {saveFile} from '../files/storage';
import {readableFileName} from '../files/filename';
import {assertNotAssetFiles} from '../files/asset-files';
import {authorizeWorkspace,workspaceVehicle,workspaceCommand,imageIds,revision} from '../vehicle-inspections/service';
import {imageLimits,validateImageUpload} from '../vehicle-inspections/controller';
const multipartRevision=z.preprocess(v=>typeof v==='string'&&/^\d+$/.test(v)?Number(v):v,revision);
const uploadInput=z.object({revision:multipartRevision,idempotencyKey:key}).strict();
const updateInput=z.object({revision,idempotencyKey:key,mediaFileIds:imageIds,coverFileId:z.string().min(1).nullable()}).strict().refine(v=>v.coverFileId===null||v.mediaFileIds.includes(v.coverFileId),'封面必须为本相册中的照片');
async function gallery(tx:any,vehicle:any){
 const ids=[...new Set<string>([...vehicle.mediaFileIds,...(vehicle.coverFileId?[vehicle.coverFileId]:[])])];await assertNotAssetFiles(tx,ids);
 const files=ids.length?await tx.storedFile.findMany({where:{id:{in:ids},purpose:'vehicle',customerId:null}}):[];
 ensure(files.length===ids.length&&files.every((f:any)=>['image/png','image/jpeg'].includes(f.mimeType)&&!f.fieldTaskId),409,'PHOTO_FILE_INVALID','相册文件类型或用途无效');
 return{vehicleId:vehicle.id,vehicleRevision:vehicle.revision,coverFileId:vehicle.coverFileId,mediaFileIds:vehicle.mediaFileIds,items:ids.map(id=>{const f=files.find((f:any)=>f.id===id);return{id:f.id,name:readableFileName(f.name),mimeType:f.mimeType,size:f.size,sha256:f.sha256,url:`/api/admin/files/${encodeURIComponent(f.id)}`};})};
}
function writable(v:any,expected:number){ensure(v.revision===expected,409,'REVISION_CONFLICT','车辆照片已变化，请刷新后核对');ensure(!v.reservedOrderId&&!v.holdId,409,'VEHICLE_RESERVED','订单占用中的车辆不可修改公开照片');}
@Controller('admin/vehicles/:vehicleId/photos')
export class VehiclePhotosController{
 constructor(@Inject(Db)private db:Db){}
 @Get()list(@Param('vehicleId')id:string,@Req()request:any){return this.db.serial(async tx=>{await authorizeWorkspace(tx,request.admin);return gallery(tx,await workspaceVehicle(tx,id));});}
 @Post()@UseInterceptors(FileInterceptor('file',{limits:imageLimits}))
 async upload(@Param('vehicleId')id:string,@Body()raw:unknown,@UploadedFile()file:Express.Multer.File,@Req()request:any){
  const input=uploadInput.parse(raw);validateImageUpload(file);
  await this.db.serial(async tx=>{await authorizeWorkspace(tx,request.admin,true);await workspaceVehicle(tx,id);});
  const stored=await saveFile(file),command={...input,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:stored.sha256};
  return this.db.serial(tx=>workspaceCommand(tx,request.admin,id,`photos:${id}`,'VEHICLE_PHOTO_UPLOAD',command,async()=>{
   await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;const vehicle=await workspaceVehicle(tx,id);writable(vehicle,input.revision);ensure(vehicle.mediaFileIds.length<20,409,'PHOTO_LIMIT','车辆相册最多20张照片');await gallery(tx,vehicle);
   const created=await tx.storedFile.create({data:{...stored,purpose:'vehicle',customerId:null,adminId:request.admin.id}}),ids=[...vehicle.mediaFileIds,created.id],cover=vehicle.coverFileId||created.id;
   const changed=await tx.vehicle.updateMany({where:{id,revision:input.revision,reservedOrderId:null,holdId:null},data:{mediaFileIds:ids,coverFileId:cover,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','车辆已变化');await audit(tx,request.admin.id,'VEHICLE_PHOTO_UPLOAD','vehicles',id,{fileId:created.id,sha256:created.sha256,revision:input.revision+1,coverFileId:cover});return gallery(tx,await workspaceVehicle(tx,id));
  }));
 }
 @Patch()update(@Param('vehicleId')id:string,@Body()raw:unknown,@Req()request:any){const input=updateInput.parse(raw);return this.db.serial(tx=>workspaceCommand(tx,request.admin,id,`photos:${id}`,'VEHICLE_PHOTO_UPDATE',input,async()=>{
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;const vehicle=await workspaceVehicle(tx,id);writable(vehicle,input.revision);
  const existing=await gallery(tx,vehicle),allowed=new Set(existing.items.map(f=>f.id));ensure(input.mediaFileIds.every(f=>allowed.has(f)),409,'PHOTO_FILE_INVALID','只能使用本车已绑定的相册照片');
  const changed=await tx.vehicle.updateMany({where:{id,revision:input.revision,reservedOrderId:null,holdId:null},data:{mediaFileIds:input.mediaFileIds,coverFileId:input.coverFileId,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','车辆照片已变化');await audit(tx,request.admin.id,'VEHICLE_PHOTO_UPDATE','vehicles',id,{revision:input.revision+1,mediaFileIds:input.mediaFileIds,coverFileId:input.coverFileId});return gallery(tx,await workspaceVehicle(tx,id));
 }));}
}
