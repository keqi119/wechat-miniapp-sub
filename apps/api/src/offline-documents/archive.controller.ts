import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {ArchiveService} from './archive.service';
import {ArchiveActor} from './schemas';
import {ensure} from '../common/errors';
export function adminActor(r:any):ArchiveActor{return{id:r.admin.id,role:r.admin.role,authVersion:r.admin.authVersion};}
export function customerActor(r:any):ArchiveActor{return{id:r.customer.id,role:'CUSTOMER',customerId:r.customer.id};}
export function ownerActor(r:any,ownerId:string):ArchiveActor{
 const session=r.partnerPortalSession;
 ensure(session?.id&&session.mode==='PARTNER_READONLY',401,'PARTNER_SESSION_REQUIRED','请通过合作商中心登录后读取档案');
 return{id:session.id,role:'OWNER',ownerId,partnerSession:session};
}
@Controller()
export class ArchiveController {
 constructor(@Inject(ArchiveService)private service:ArchiveService){}
 @Get('admin/offline-archives') list(@Query()q:unknown,@Req()r:any){return this.service.list(q,adminActor(r));}
 @Get('admin/offline-archives/:id') detail(@Param('id')id:string,@Req()r:any){return this.service.detail(id,adminActor(r));}
 @Get('customer/offline-archives/:id') detailCustomer(@Param('id')id:string,@Req()r:any){return this.service.detail(id,customerActor(r));}
 @Get('owner-h5/owners/:ownerId/offline-archives/:id') detailOwner(@Param('ownerId')o:string,@Param('id')id:string,@Req()r:any){return this.service.detail(id,ownerActor(r,o));}
 @Get('owner-h5/owners/:ownerId/offline-archives') listOwner(@Param('ownerId')o:string,@Query()q:unknown,@Req()r:any){return this.service.partnerList(q,ownerActor(r,o));}
 @Post('admin/offline-archives') create(@Body()b:unknown,@Req()r:any){return this.service.create(b,adminActor(r));}
 @Post('admin/offline-archives/:id/versions') version(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.newVersion(id,b,adminActor(r));}
 @Post('admin/offline-archives/:id/versions/:versionId/prepare') prepare(@Param('id')id:string,@Param('versionId')v:string,@Body()b:unknown,@Req()r:any){return this.service.prepare(id,v,b,adminActor(r));}
 @Post('admin/offline-archives/:id/versions/:versionId/confirm-print') confirmPrint(@Param('id')id:string,@Param('versionId')v:string,@Body()b:unknown,@Req()r:any){return this.service.confirmPrint(id,v,b,adminActor(r));}
 @Post('admin/offline-archives/:id/archive') archive(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.archive(id,b,adminActor(r));}
 @Patch('admin/offline-archives/:id/versions/:versionId') patch(@Param('id')id:string,@Param('versionId')v:string,@Body()b:unknown,@Req()r:any){return this.service.patch(id,v,b,adminActor(r));}
 @Post('admin/offline-archives/:id/versions/:versionId/files') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1}})) upload(@Param('id')id:string,@Param('versionId')v:string,@Body()b:unknown,@UploadedFile()f:Express.Multer.File,@Req()r:any){return this.service.upload(id,v,b,f,adminActor(r));}
 @Post('admin/offline-archives/:id/submit') submit(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.submit(id,b,adminActor(r));}
 @Post('admin/offline-archives/:id/review') review(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.review(id,b,adminActor(r));}
 @Post('admin/offline-archives/:id/invalidate') invalidate(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.invalidate(id,b,adminActor(r));}
 @Get('admin/offline-archives/:id/versions/:versionId/files/:fileId') readAdmin(@Param('id')id:string,@Param('versionId')v:string,@Param('fileId')f:string,@Req()r:any,@Res()s:any){return this.service.readFile(id,v,f,adminActor(r),s);}
 @Get('customer/offline-archives/:id/versions/:versionId/files/:fileId') readCustomer(@Param('id')id:string,@Param('versionId')v:string,@Param('fileId')f:string,@Req()r:any,@Res()s:any){return this.service.readFile(id,v,f,customerActor(r),s);}
 @Get('owner-h5/owners/:ownerId/offline-archives/:id/versions/:versionId/files/:fileId') readOwner(@Param('ownerId')o:string,@Param('id')id:string,@Param('versionId')v:string,@Param('fileId')f:string,@Req()r:any,@Res()s:any){return this.service.readFile(id,v,f,ownerActor(r,o),s);}
 @Post('customer/offline-archives/:id/feedback') feedbackCustomer(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.feedback(id,b,customerActor(r));}
 @Post('owner-h5/owners/:ownerId/offline-archives/:id/feedback') feedbackOwner(@Param('ownerId')o:string,@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.feedback(id,b,ownerActor(r,o));}
 @Post('admin/offline-archives/:id/feedback') feedbackAdmin(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.service.recordFeedback(id,b,adminActor(r));}
 @Post('admin/offline-archives/:id/feedback/:feedbackId/resolve') resolve(@Param('id')id:string,@Param('feedbackId')f:string,@Body()b:unknown,@Req()r:any){return this.service.resolveFeedback(id,f,b,adminActor(r));}
}
