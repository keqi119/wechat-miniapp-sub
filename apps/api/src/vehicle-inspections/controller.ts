import {Body,Controller,Get,HttpException,Inject,Param,Patch,Post,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {z,ZodError} from 'zod';
import {Db} from '../common/db';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {saveFile,streamFile,validMime} from '../files/storage';
import {listedProductSnapshot} from '../products/snapshot';
import {productVersionInclude} from '../products/types';
import {InspectionService,authorizeWorkspace,workspaceVehicle,workspaceCommand,inspectionFileView,requireInspectionFiles,validateInspectionBinding,readInspectionSnapshots,publicInspectionViews} from './service';
export const imageLimits={files:1,fileSize:10*1024*1024};
export function validateImageUpload(file:Express.Multer.File){ensure(file&&Buffer.isBuffer(file.buffer)&&file.buffer.length>0&&file.buffer.length<=imageLimits.fileSize&&file.size===file.buffer.length&&['image/png','image/jpeg'].includes(file.mimetype)&&validMime(file.buffer,file.mimetype),400,'IMAGE_INVALID','仅支持10MiB以内内容有效的PNG/JPEG图片');}
@Controller()
export class VehicleInspectionsController{
 private service=new InspectionService();
 constructor(@Inject(Db)private db:Db){}
 @Get('admin/vehicles/:vehicleId/inspections')list(@Param('vehicleId')id:string,@Req()request:any){return this.db.serial(tx=>this.service.list(tx,request.admin,id));}
 @Post('admin/vehicles/:vehicleId/inspections')create(@Param('vehicleId')id:string,@Body()raw:unknown,@Req()request:any){return this.db.serial(tx=>this.service.create(tx,request.admin,id,raw));}
 @Patch('admin/vehicles/:vehicleId/inspections/:inspectionId')update(@Param('vehicleId')id:string,@Param('inspectionId')inspectionId:string,@Body()raw:unknown,@Req()request:any){return this.db.serial(tx=>this.service.update(tx,request.admin,id,inspectionId,raw));}
 @Get('admin/vehicles/:vehicleId/inspection-files')files(@Param('vehicleId')id:string,@Req()request:any){return this.db.serial(async tx=>{
  await authorizeWorkspace(tx,request.admin);await workspaceVehicle(tx,id);
  const rows=await tx.vehicleInspectionFile.findMany({where:{vehicleId:id},include:{file:true},orderBy:[{createdAt:'asc'},{fileId:'asc'}]});
  return{vehicleId:id,items:rows.map(row=>inspectionFileView(validateInspectionBinding(row,id),id))};
 });}
 @Post('admin/vehicles/:vehicleId/inspection-files')@UseInterceptors(FileInterceptor('file',{limits:imageLimits}))
 async upload(@Param('vehicleId')id:string,@Body()raw:unknown,@UploadedFile()file:Express.Multer.File,@Req()request:any){
  const body=z.object({idempotencyKey:key}).strict().parse(raw);validateImageUpload(file);
  await this.db.serial(async tx=>{await authorizeWorkspace(tx,request.admin,true);await workspaceVehicle(tx,id);});
  const stored=await saveFile(file),command={...body,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:stored.sha256};
  return this.db.serial(tx=>workspaceCommand(tx,request.admin,id,`inspection-file:${id}`,'INSPECTION_FILE_UPLOAD',command,async()=>{
   const created=await tx.storedFile.create({data:{...stored,purpose:'vehicle-inspection',customerId:null,adminId:request.admin.id}});
   await tx.vehicleInspectionFile.create({data:{vehicleId:id,fileId:created.id,sha256:created.sha256,uploadedBy:request.admin.id}});
   await audit(tx,request.admin.id,'INSPECTION_FILE_UPLOAD','vehicles',id,{fileId:created.id,sha256:created.sha256});return inspectionFileView(created,id);
  }));
 }
 @Get('admin/vehicles/:vehicleId/inspection-files/:fileId')async image(@Param('vehicleId')id:string,@Param('fileId')fileId:string,@Req()request:any,@Res()response:any){
  const file=await this.db.serial(async tx=>{await authorizeWorkspace(tx,request.admin);await workspaceVehicle(tx,id);const binding=await tx.vehicleInspectionFile.findUnique({where:{fileId}});ensure(binding?.vehicleId===id,404,'NOT_FOUND','图片不存在');return(await requireInspectionFiles(tx,id,[fileId]))[0];});return streamFile(file,response);
 }
 @Get('public/goods/:listingId/inspection-images/:fileId')async publicImage(@Param('listingId')listingId:string,@Param('fileId')fileId:string,@Res()response:any){
  let file:any;
  try{file=await this.db.serial(async tx=>{
   const listing=await tx.vehicleListing.findUnique({where:{id:listingId},include:{vehicle:true,subscriptionPlan:true,productVersion:{include:productVersionInclude}}});
   ensure(listing&&!listing.vehicle.virtualAcceptanceScopeId&&listing.vehicle.status==='PUBLISHED',404,'NOT_FOUND','图片未发布');
   listedProductSnapshot({...listing.subscriptionPlan,listing,vehicle:listing.vehicle,productVersion:listing.productVersion});
   await publicInspectionViews(tx,listing,listing.vehicleId);
   const snapshots=readInspectionSnapshots(listing.inspectionSnapshots,listing.vehicleId);ensure(snapshots.some(s=>s.images.some(f=>f.fileId===fileId)),404,'NOT_FOUND','图片未发布');
   return(await requireInspectionFiles(tx,listing.vehicleId,[fileId]))[0];
  });}catch(error){if(error instanceof HttpException||error instanceof ZodError)ensure(false,404,'NOT_FOUND','图片不存在或未发布');throw error;}
  return streamFile(file,response);
 }
}
