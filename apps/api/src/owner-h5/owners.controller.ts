import {Db} from '../common/db';
import {readInternalEvidence} from './internal-evidence';
import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {OwnerH5Service} from './service';
import {ensure} from '../common/errors';

@Controller('owner-h5/owners')
export class OwnerH5OwnersController {
 constructor(@Inject(OwnerH5Service) private service:OwnerH5Service,@Inject(Db)private db:Db){}
 @Get() list(@Req() req:any){return req.ownerH5Customer?this.service.list(req.ownerH5Customer.id):this.service.portalList(req.partnerPortalSession);}
 @Post('claim') claim(@Req() req:any,@Body() body:unknown){return this.service.claim(req.ownerH5Customer.id,body);}
 @Get(':id') detail(@Req() req:any,@Param('id') id:string){return req.ownerH5Customer?this.service.detail(req.ownerH5Customer.id,id):this.service.portalDetail(req.partnerPortalSession,id);}
 @Post(':id/verification') verify(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.verification(req.ownerH5Customer.id,id,body);}
 @Post(':id/refresh') refresh(@Req() req:any,@Param('id') id:string){return this.service.refresh(req.ownerH5Customer.id,id);}
 @Get(':id/internal-evidence/:fileId')async internal(@Req()req:any,@Param('id')id:string,@Param('fileId')fileId:string,@Res()res:any){const {file,bytes}=await readInternalEvidence(this.db,req.ownerH5Customer.id,id,fileId);res.set({'Content-Type':file.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});return res.send(bytes);}
 @Get(':id/seals/:sealId/image') image(@Req() req:any,@Param('id') id:string,@Param('sealId') sealId:string){return this.service.sealImage(req.ownerH5Customer.id,id,sealId);}
 @Post(':id/seal') seal(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.selectSeal(req.ownerH5Customer.id,id,body);}
 @Get(':id/authority-options') options(@Req() req:any,@Param('id') id:string){return this.service.options(req.ownerH5Customer.id,id);}
 @Get(':id/authorities') authorities(@Req() req:any,@Param('id') id:string){return this.service.authorities(req.ownerH5Customer.id,id);}
 @Get(':id/authorities/:authorityId/document/:variant') async document(@Req() req:any,@Res() res:any,@Param('id') id:string,@Param('authorityId') authorityId:string,@Param('variant') variant:string){
  ensure(variant==='source'||variant==='signed',404,'NOT_FOUND','文件不存在');
  const file=await this.service.document(req.ownerH5Customer.id,id,authorityId,variant);
  res.set({'Content-Type':'application/pdf','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`});return res.send(file.buffer);
 }
 @Post(':id/authorities') requestAuthority(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.requestAuthority(req.ownerH5Customer.id,id,body);}
 @Post(':id/authorities/:authorityId/refresh') refreshAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string){return this.service.refreshAuthority(req.ownerH5Customer.id,id,authorityId);}
 @Post(':id/authorities/:authorityId/resume') resumeAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string){return this.service.resumeAuthority(req.ownerH5Customer.id,id,authorityId);}
 @Post(':id/authorities/:authorityId/switch') switchAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string,@Body() body:unknown){return this.service.switchAuthority(req.ownerH5Customer.id,id,authorityId,body);}
 @Post(':id/authorities/:authorityId/revoke') revokeAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string,@Body() body:unknown){return this.service.revokeAuthority(req.ownerH5Customer.id,id,authorityId,body);}
}
