import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req,Res,UploadedFile,UploadedFiles,UseInterceptors} from '@nestjs/common';
import {FileInterceptor,FilesInterceptor} from '@nestjs/platform-express';
import type {Response} from 'express';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {streamFile} from '../files/storage';
import {InsuranceService} from './service';
import type {InsuranceActor,InsuranceTx,PageQuery} from './types';
type InsuranceRequest={admin:InsuranceActor};
const upload=FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:4}});
const registrationUpload=FilesInterceptor('files',20,{limits:{fileSize:10*1024*1024,files:20,fields:1,fieldSize:128*1024,parts:21}});
function registrationBody(raw:unknown){
 ensure(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===1&&'input' in raw&&typeof raw.input==='string',400,'VALIDATION','登记须使用唯一input JSON字段');
 try{return JSON.parse(raw.input);}catch{ensure(false,400,'VALIDATION','登记input须为有效JSON');}
}
export async function insuranceTransaction<T>(db:Db,operation:(tx:InsuranceTx)=>Promise<T>):Promise<T>{try{return await db.serial(operation);}catch(error:unknown){if(error&&typeof error==='object'&&'code' in error&&error.code==='P2002')return db.serial(operation);throw error;}}
@Controller('admin/insurance-policies')
export class InsuranceController {
 constructor(@Inject(Db) private db:Db,@Inject(InsuranceService) private insurance:InsuranceService){}
 @Get() list(@Req() req:InsuranceRequest,@Query() query:PageQuery){return this.db.serial(tx=>this.insurance.list(tx,req.admin,query));}
 @Get('renewal-reminders') reminders(@Req() req:InsuranceRequest,@Query() query:PageQuery){return this.db.serial(tx=>this.insurance.reminders(tx,req.admin,query));}
 @Post('renewal-reminders/refresh') refresh(@Req() req:InsuranceRequest,@Body() input:unknown){return insuranceTransaction(this.db,tx=>this.insurance.refreshReminders(tx,req.admin,input));}
 @Post('registrations') @UseInterceptors(registrationUpload) register(@Req() req:InsuranceRequest,@Body() raw:unknown,@UploadedFiles() files:Express.Multer.File[]){return insuranceTransaction(this.db,tx=>this.insurance.register(tx,req.admin,registrationBody(raw),files));}
 @Post(':id/registrations') @UseInterceptors(registrationUpload) registerUpdate(@Req() req:InsuranceRequest,@Param('id') id:string,@Body() raw:unknown,@UploadedFiles() files:Express.Multer.File[]){return insuranceTransaction(this.db,tx=>this.insurance.register(tx,req.admin,registrationBody(raw),files,id));}
 @Post() create(@Req() req:InsuranceRequest,@Body() input:unknown){return insuranceTransaction(this.db,tx=>this.insurance.createDraft(tx,req.admin,input));}
 @Get(':id') detail(@Req() req:InsuranceRequest,@Param('id') id:string){return this.db.serial(tx=>this.insurance.detail(tx,req.admin,id));}
 @Post(':id/versions') version(@Req() req:InsuranceRequest,@Param('id') id:string,@Body() input:unknown){return insuranceTransaction(this.db,tx=>this.insurance.createDraft(tx,req.admin,input,id));}
 @Post(':id/renewals') renewal(@Req() req:InsuranceRequest,@Param('id') id:string,@Body() input:unknown){return insuranceTransaction(this.db,tx=>this.insurance.createDraft(tx,req.admin,input,undefined,id));}
 @Patch(':id/versions/:versionId') update(@Req() req:InsuranceRequest,@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:unknown){return insuranceTransaction(this.db,async tx=>{await this.owned(tx,req.admin,id,versionId);return this.insurance.updateDraft(tx,req.admin,versionId,input);});}
 @Post(':id/versions/:versionId/draft') draft(@Req() req:InsuranceRequest,@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:unknown){return this.update(req,id,versionId,input);}
 @Post(':id/versions/:versionId/submit') submit(@Req() req:InsuranceRequest,@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:unknown){return insuranceTransaction(this.db,async tx=>{await this.owned(tx,req.admin,id,versionId);return this.insurance.submit(tx,req.admin,versionId,input);});}
 @Post(':id/versions/:versionId/review') review(@Req() req:InsuranceRequest,@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:unknown){return insuranceTransaction(this.db,async tx=>{await this.owned(tx,req.admin,id,versionId);return this.insurance.review(tx,req.admin,versionId,input);});}
 @Post(':id/files') @UseInterceptors(upload) upload(@Req() req:InsuranceRequest,@Param('id') id:string,@Body() raw:{revision?:unknown;idempotencyKey?:unknown;vehicleIds?:unknown},@UploadedFile() file:Express.Multer.File){
  let vehicleIds:unknown=raw.vehicleIds;try{if(typeof vehicleIds==='string')vehicleIds=JSON.parse(vehicleIds);}catch{ensure(false,400,'VALIDATION','被保车辆编号须为JSON数组');}
  const revision=typeof raw.revision==='string'&&/^\d+$/.test(raw.revision)?Number(raw.revision):raw.revision;
  return insuranceTransaction(this.db,tx=>this.insurance.uploadFile(tx,req.admin,id,{revision,idempotencyKey:raw.idempotencyKey,vehicleIds},file));
 }
 @Get(':id/files/:fileId') async file(@Req() req:InsuranceRequest,@Param('id') id:string,@Param('fileId') fileId:string,@Res() response:Response){return streamFile(await this.db.serial(tx=>this.insurance.readFile(tx,req.admin,id,fileId)),response);}
 @Get(':id/files/:fileId/open') async open(@Req() req:InsuranceRequest,@Param('id') id:string,@Param('fileId') fileId:string,@Res() response:Response){return this.file(req,id,fileId,response);}
 private async owned(tx:InsuranceTx,actor:InsuranceActor,id:string,versionId:string){const policy=await this.insurance.detail(tx,actor,id);ensure(policy.versions.some(v=>v.id===versionId),404,'NOT_FOUND','版本不属于该保单');}
}
@Controller('admin/coverage-requirements')
export class CoverageRequirementsController {
 constructor(@Inject(Db) private db:Db,@Inject(InsuranceService) private insurance:InsuranceService){}
 @Get() list(@Req() req:InsuranceRequest){return this.db.serial(tx=>this.insurance.requirements(tx,req.admin));}
 @Get('review-tasks') reviewTasks(@Req() req:InsuranceRequest,@Query() query:PageQuery){return this.db.serial(tx=>this.insurance.reviewTasks(tx,req.admin,query));}
 @Get('check') check(@Req() req:InsuranceRequest,@Query() _query:{vehicleId?:string;productVersionId?:string;at?:string}){return this.db.serial(tx=>this.insurance.retiredRequirements(tx,req.admin));}
 @Get(':id') detail(@Req() req:InsuranceRequest,@Param('id') _id:string){return this.db.serial(tx=>this.insurance.retiredRequirements(tx,req.admin));}
 @Post() configure(@Req() req:InsuranceRequest,@Body() _input:unknown){return this.db.serial(tx=>this.insurance.retiredRequirements(tx,req.admin,true));}
 @Post(':id/versions') version(@Req() req:InsuranceRequest,@Param('id') _id:string,@Body() _input:unknown){return this.db.serial(tx=>this.insurance.retiredRequirements(tx,req.admin,true));}
}
