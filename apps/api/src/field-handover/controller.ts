import {Body,Controller,Get,Inject,Param,Post,Query,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {z} from 'zod';
import {FieldHandoverService} from './service';
const actor=(r:any)=>({id:r.admin.id,role:r.admin.role,authVersion:r.admin.authVersion});
@Controller('admin')
export class FieldHandoverController {
 constructor(@Inject(FieldHandoverService) private service:FieldHandoverService){}
 @Get('handover-tasks/assignees') assignees(@Query()q:any,@Req()r:any){return this.service.assignees(q,actor(r));}
 @Get('handover-tasks') list(@Query()q:any,@Req()r:any){return this.service.list(q,actor(r));}
 @Post('handover-tasks') create(@Body()b:any,@Req()r:any){return this.service.create(b,actor(r));}
 @Get('handover-tasks/:id') detail(@Param('id')id:string,@Req()r:any){return this.service.detail(id,actor(r));}
 @Post('handover-tasks/:id/reassign') reassign(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.manage(id,b,actor(r));}
 @Post('handover-tasks/:id/cancel') cancel(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.manage(id,b,actor(r),true);}
 @Post('handover-tasks/:id/restart') restart(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.restart(id,b,actor(r));}
 @Get('field-tasks') mine(@Query()q:any,@Req()r:any){return this.service.list(q,actor(r),true);}
 @Get('field-tasks/:id') one(@Param('id')id:string,@Req()r:any){return this.service.detail(id,actor(r),true);}
 @Post('field-tasks/:id/draft') save(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.save(id,b,actor(r));}
 @Post('field-tasks/:id/publish') publish(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.service.publish(id,b,actor(r));}
 @Post('field-tasks/:id/files') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1}})) upload(@Param('id')id:string,@Body()b:any,@UploadedFile()f:Express.Multer.File,@Req()r:any){return this.service.upload(id,z.coerce.number().int().nonnegative().parse(b.version),f,actor(r));}
 @Get('field-tasks/:id/files/:fileId') read(@Param('id')id:string,@Param('fileId')fileId:string,@Req()r:any,@Res()s:any){return this.service.readFile(id,fileId,actor(r),s);}
}
