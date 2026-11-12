import {readV31Readiness} from '../contract-terms/readiness';
import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {Db} from '../common/db';
import {PartnerAdmissionService} from './admission';
import {PartnerIdentityService} from './identity';
import {VehicleBindingService} from './vehicle-binding';
import {requirePartnerOperator} from './types';
import {ensure} from '../common/errors';
import {SimpleAgreementService} from './simple-agreements';
import {requireSimplePartnerOperator} from './simple-access';
import {resolve,sep} from 'node:path';
import {projectRoot} from '../common/config';
@Controller('admin/partners')
export class PartnerAdminController{
 private service=new PartnerAdmissionService();
 private simple=new SimpleAgreementService();
 constructor(@Inject(Db)private db:Db){}
 @Get()list(@Req()req:any){return this.db.serial(tx=>this.simple.list(tx,req.admin));}
 @Get(':id')detail(@Req()req:any,@Param('id')id:string){return this.db.serial(tx=>this.simple.detail(tx,req.admin,id));}
 @Get(':id/agreements/:versionId/contract-readiness')contractReadiness(@Req()req:any,@Param('id')id:string,@Param('versionId')versionId:string){return this.db.serial(tx=>readV31Readiness(tx,req.admin,id,versionId));}
 @Get(':id/agreements')agreements(@Req()req:any,@Param('id')id:string){return this.db.serial(tx=>this.simple.agreements(tx,req.admin,id));}
 @Post(':id/agreements')saveAgreement(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.simple.save(tx,req.admin,id,body));}
 @Post(':id/agreements/:agreementId/stop')stopAgreement(@Req()req:any,@Param('id')id:string,@Param('agreementId')agreementId:string,@Body()body:unknown){return this.db.serial(tx=>this.simple.stop(tx,req.admin,id,agreementId,body));}
 @Get(':id/agreements/:agreementId/files/:fileId')async agreementFile(@Req()req:any,@Param('id')id:string,@Param('agreementId')agreementId:string,@Param('fileId')fileId:string,@Res()response:any){
  const file=await this.db.serial(async tx=>{await requireSimplePartnerOperator(tx,req.admin);return this.simple.readFile(tx,id,agreementId,fileId);});
  const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));ensure(resolve(file.storagePath).startsWith(root+sep),500,'STORAGE_PATH','文件存储异常');response.setHeader('Content-Type',file.mimeType);response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);return response.sendFile(file.storagePath);
 }
 @Get(':id/cooperation-draft')draft(@Req()req:any,@Param('id')id:string){return this.db.serial(tx=>this.service.draft(tx,req.admin,id));}
 @Post(':id/cooperation-draft')saveDraft(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.service.saveDraft(tx,req.admin,id,body));}
 @Post()create(@Req()req:any,@Body()body:unknown){return this.db.serial(tx=>this.simple.create(tx,req.admin,body));}
 @Post(':id/profile')update(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.simple.update(tx,req.admin,id,body));}
 @Post(':id/submit')submit(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.service.submit(tx,req.admin,id,body));}
 @Post(':id/review')review(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.service.review(tx,req.admin,id,body));}
}
@Controller('admin/partners/:ownerId/identities')
export class PartnerIdentityController{
 private service=new PartnerIdentityService();
 constructor(@Inject(Db)private db:Db){}
 @Post()submit(@Req()req:any,@Param('ownerId')id:string,@Body()body:unknown){ensure(false,409,'PARTNER_IDENTITY_LEGACY_READONLY','旧客户身份关系仅保留历史记录，请使用纸质合作资料办理');}
 @Post(':bindingId/review')review(@Req()req:any,@Param('ownerId')id:string,@Param('bindingId')bindingId:string,@Body()body:unknown){ensure(false,409,'PARTNER_IDENTITY_LEGACY_READONLY','旧客户身份关系仅保留历史记录，请使用纸质合作资料办理');}
 @Post(':bindingId/revoke')revoke(@Req()req:any,@Param('ownerId')id:string,@Param('bindingId')bindingId:string,@Body()body:unknown){ensure(false,409,'PARTNER_IDENTITY_LEGACY_READONLY','旧客户身份关系仅保留历史记录，请使用独立查看授权停用访问');}
}
@Controller('admin/partners/:ownerId/vehicles')
export class PartnerVehicleController{
 private service=new VehicleBindingService();
 constructor(@Inject(Db)private db:Db){}
 @Post(':vehicleId/submit')submit(@Req()req:any,@Param('ownerId')id:string,@Param('vehicleId')vehicleId:string,@Body()body:unknown){return this.db.serial(tx=>this.service.submit(tx,req.admin,id,vehicleId,body));}
 @Post(':vehicleId/review')review(@Req()req:any,@Param('ownerId')ownerId:string,@Param('vehicleId')vehicleId:string,@Body()body:any){return this.db.serial(tx=>this.service.rebind(tx,req.admin,vehicleId,{...body,ownerId}));}
}
