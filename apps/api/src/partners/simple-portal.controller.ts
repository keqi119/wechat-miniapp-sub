import {Controller,Get,Inject,Param,Query,Req,Res} from '@nestjs/common';
import {OwnerH5Service} from '../owner-h5/service';
import {streamFile} from '../files/storage';
import {readableFileName} from '../files/filename';

@Controller('owner-h5/owners/:ownerId')
export class PartnerSimplePortalController {
 constructor(@Inject(OwnerH5Service)private service:OwnerH5Service){}
 @Get('agreements')async agreements(@Req()request:any,@Param('ownerId')ownerId:string){const result=await this.service.portalAgreements(request.partnerPortalSession,ownerId);return{...result,items:result.items.map(item=>({...item,title:readableFileName(item.title),files:item.files.map((file:any)=>({...file,name:readableFileName(file.name)}))}))};}
 @Get('cooperation-vehicles')async vehicles(@Req()request:any,@Param('ownerId')ownerId:string,@Query()query:any){const result=await this.service.portalVehicles(request.partnerPortalSession,ownerId,query);return{...result,items:result.items.map(item=>({...item,agreementTitle:readableFileName(item.agreementTitle)})),agreements:result.agreements.map(item=>({...item,title:readableFileName(item.title)}))};}
 @Get('agreements/:agreementId/files/:fileId')async file(@Req()request:any,@Param('ownerId')ownerId:string,@Param('agreementId')agreementId:string,@Param('fileId')fileId:string,@Res()response:any){
  const file=await this.service.portalAgreementFile(request.partnerPortalSession,ownerId,agreementId,fileId);return streamFile(file,response);
 }
}
