import {Body,Controller,Get,Inject,Param,Post,Query,Req,Res,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {saveFile,streamFile,validMime} from '../files/storage';
import {RevenueRuleService,PartnerAccountService} from './revenue-rules';
import {SettlementService} from './settlements';
import {SettlementPaymentService} from './settlement-payments';
import {getSettlementSources} from './settlement-sources';
import {financeCommand,lockFinanceOwner,maskedAccount,requireFinance,requireRuleOperator} from './revenue-types';
import {requirePartnerReadAccess} from './portal-session';
import {getPartnerCapabilities,requirePartnerCapability} from './capabilities';
import {financialReadCapability} from './revenue-types';
const upload=FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:3}});
const ownerBody=z.object({ownerId:z.string().min(1)}).passthrough();
async function uploadEvidence(tx:any,actor:any,ownerId:string,raw:unknown,file:Express.Multer.File,rule:boolean){const input=z.object({idempotencyKey:z.string().min(8).max(128),kind:z.enum(['RULE','ACCOUNT','SETTLEMENT','PAYMENT'])}).strict().parse(raw);ensure(rule?input.kind==='RULE':input.kind!=='RULE',400,'VALIDATION','材料类别与上传入口不匹配');ensure(file&&file.buffer.length===file.size&&file.size>0&&file.size<=10*1024*1024&&validMime(file.buffer,file.mimetype),400,'FILE_TYPE','请上传10MiB以内的PDF、JPEG或PNG材料');return financeCommand(tx,actor,ownerId,`file.upload:${input.kind}`,{...input,digest:hash(file.buffer.toString('base64')),name:file.originalname,mime:file.mimetype} as any,async()=>{const saved=await saveFile(file),row=await tx.storedFile.create({data:{...saved,purpose:'partner-settlement',adminId:actor.id}});await tx.partnerSettlementFile.create({data:{ownerId,fileId:row.id,kind:input.kind,uploadedBy:actor.id}});await audit(tx,actor.id,'PARTNER_FINANCE_FILE','partner-settlements',row.id,{ownerId,kind:input.kind});return{id:row.id,name:row.name,mimeType:row.mimeType,size:row.size,sha256:row.sha256};},rule);}
async function readEvidence(tx:any,actor:any,ownerId:string,fileId:string){const binding=await tx.partnerSettlementFile.findUnique({where:{fileId}});ensure(binding?.ownerId===ownerId,404,'NOT_FOUND','文件不存在');await requirePartnerCapability(tx,actor,financialReadCapability(binding.kind));const file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(file?.purpose==='partner-settlement',404,'NOT_FOUND','文件不存在');return file;}
@Controller('admin/partner-revenue-rules')
export class PartnerRevenueRuleController{
 private service=new RevenueRuleService();
 constructor(@Inject(Db)private db:Db){}
 @Get()list(@Req()r:any,@Query('ownerId')ownerId:string){ensure(ownerId,400,'VALIDATION','请选择合作商');return this.db.serial(tx=>this.service.list(tx,r.admin,ownerId));}
 @Post()create(@Req()r:any,@Body()raw:unknown){const {ownerId,...body}=ownerBody.parse(raw);return this.db.serial(tx=>this.service.create(tx,r.admin,ownerId,body));}
 @Post('owners/:ownerId/files')@UseInterceptors(upload)upload(@Req()r:any,@Param('ownerId')ownerId:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File){return this.db.serial(tx=>uploadEvidence(tx,r.admin,ownerId,body,file,true));}
 @Get('owners/:ownerId/files/:fileId')async file(@Req()r:any,@Param('ownerId')ownerId:string,@Param('fileId')fileId:string,@Res()res:any){return streamFile(await this.db.serial(tx=>readEvidence(tx,r.admin,ownerId,fileId)),res);}
 @Get(':id')detail(@Req()r:any,@Param('id')id:string){return this.db.serial(tx=>this.service.detail(tx,r.admin,id));}
 @Post(':id/versions')version(@Req()r:any,@Param('id')id:string,@Body()raw:unknown){const{ownerId,...body}=ownerBody.parse(raw);return this.db.serial(tx=>this.service.create(tx,r.admin,ownerId,body,id));}
 @Post('versions/:id/submit')submit(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.service.submit(tx,r.admin,id,body));}
 @Post('versions/:id/review')review(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.service.review(tx,r.admin,id,body));}
}
@Controller('admin/partner-settlements')
export class PartnerSettlementController{
 private settlements=new SettlementService();private payments=new SettlementPaymentService();private accounts=new PartnerAccountService();
 constructor(@Inject(Db)private db:Db){}
 @Get()list(@Req()r:any,@Query('ownerId')ownerId?:string){return this.db.serial(tx=>this.settlements.list(tx,r.admin,ownerId));}
 @Get('partners')partners(@Req()r:any){return this.db.serial(async tx=>{const staff=await tx.adminUser.findUnique({where:{id:r.admin.id}}),capability=getPartnerCapabilities(staff).find(key=>['partner.rules.read','partner.accounts.read','partner.settlements.read','partner.payments.read'].includes(key));ensure(capability,403,'FORBIDDEN','未获授合作资料查询权限');await requirePartnerCapability(tx,r.admin,capability);return tx.vehicleOwner.findMany({orderBy:{createdAt:'desc'},take:200,select:{id:true,name:true,subjectType:true,status:true}});});}
 @Post()create(@Req()r:any,@Body()raw:unknown){const{ownerId,...body}=ownerBody.parse(raw);return this.db.serial(tx=>this.settlements.create(tx,r.admin,ownerId,body));}
 @Get('sources')sources(@Req()r:any,@Query()raw:unknown){const q=z.object({ownerId:z.string().min(1),start:z.iso.date(),end:z.iso.date()}).strict().parse(raw);return this.db.serial(async tx=>{await requireFinance(tx,r.admin,false);return getSettlementSources(tx,q.ownerId,q);});}
 @Get('accounts/:ownerId')accountList(@Req()r:any,@Param('ownerId')id:string){return this.db.serial(tx=>this.accounts.list(tx,r.admin,id));}
 @Post('accounts/:ownerId')accountSubmit(@Req()r:any,@Param('ownerId')id:string,@Body()body:unknown){return this.db.serial(tx=>this.accounts.submit(tx,r.admin,id,body));}
 @Post('accounts/:id/review')accountReview(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.accounts.review(tx,r.admin,id,body));}
 @Post('owners/:ownerId/files')@UseInterceptors(upload)upload(@Req()r:any,@Param('ownerId')ownerId:string,@Body()body:unknown,@UploadedFile()file:Express.Multer.File){return this.db.serial(tx=>uploadEvidence(tx,r.admin,ownerId,body,file,false));}
 @Get('owners/:ownerId/files/:fileId')async file(@Req()r:any,@Param('ownerId')ownerId:string,@Param('fileId')fileId:string,@Res()res:any){return streamFile(await this.db.serial(tx=>readEvidence(tx,r.admin,ownerId,fileId)),res);}
 @Post('feedback/:id/resolve')resolve(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.settlements.resolveFeedback(tx,r.admin,id,body));}
 @Get(':id')detail(@Req()r:any,@Param('id')id:string){return this.db.serial(tx=>this.settlements.detail(tx,r.admin,id));}
 @Post(':id/feedback')feedback(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.settlements.recordFeedback(tx,r.admin,id,body));}
 @Post(':id/submit')submit(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.settlements.submit(tx,r.admin,id,body));}
 @Post(':id/review')review(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.settlements.review(tx,r.admin,id,body));}
 @Post(':id/payments')record(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.payments.record(tx,r.admin,id,body));}
 @Post(':id/payments/reconcile')reconcile(@Req()r:any,@Param('id')id:string,@Body()body:unknown){return this.db.serial(tx=>this.payments.reconcile(tx,r.admin,id,body));}
}
@Controller('owner-h5/owners/:ownerId')
export class PartnerFinanceWorkspaceController{
 constructor(@Inject(Db)private db:Db){}
 @Get('revenue-rules')rules(@Req()r:any,@Param('ownerId')ownerId:string){return this.db.serial(async(tx:any)=>{await requirePartnerReadAccess(tx,r.partnerPortalSession,ownerId);const versions=await tx.partnerRevenueRuleVersion.findMany({where:{ownerId,status:'APPROVED'},orderBy:{createdAt:'desc'},take:100});return versions.map((v:any)=>({id:v.id,ruleId:v.ruleId,version:v.version,validFrom:v.validFrom,validUntil:v.validUntil,vehicleIds:v.vehicleIds,terms:v.terms}));});}
 @Get('settlements')settlements(@Req()r:any,@Param('ownerId')ownerId:string){return this.db.serial(async(tx:any)=>{await requirePartnerReadAccess(tx,r.partnerPortalSession,ownerId);return tx.partnerSettlement.findMany({where:{ownerId,status:{in:['APPROVED','PAYMENT_RECORDED','PAID','OFFSET_REQUIRED']}},select:{id:true,status:true,periodStart:true,periodEnd:true,payableAmount:true,explanation:true,createdAt:true},orderBy:{createdAt:'desc'},take:100});});}
 @Get('settlements/:id')settlement(@Req()r:any,@Param('ownerId')ownerId:string,@Param('id')id:string){return this.db.serial(async(tx:any)=>{await requirePartnerReadAccess(tx,r.partnerPortalSession,ownerId);const row=await tx.partnerSettlement.findUnique({where:{id}});ensure(row?.ownerId===ownerId&&['APPROVED','PAYMENT_RECORDED','PAID','OFFSET_REQUIRED'].includes(row.status),404,'NOT_FOUND','结算单不存在');const lines=await tx.partnerSettlementLine.findMany({where:{settlementId:id},select:{id:true,orderId:true,category:true,payableAmount:true,explanation:true}});return{id:row.id,status:row.status,periodStart:row.periodStart,periodEnd:row.periodEnd,payableAmount:row.payableAmount,explanation:row.explanation,account:maskedAccount(row.accountSnapshot),lines,feedback:await tx.partnerSettlementFeedback.findMany({where:{settlementId:id},select:{id:true,status:true,message:true,resolution:true,createdAt:true}})};});}
 @Post('settlements/:id/feedback')feedback(@Req()r:any,@Param('ownerId')ownerId:string,@Param('id')_id:string,@Body()_raw:unknown){return this.db.serial(async(tx:any)=>{await requirePartnerReadAccess(tx,r.partnerPortalSession,ownerId);ensure(false,403,'PARTNER_READ_ONLY','合作商中心仅提供只读查看，请联系平台运营登记反馈');});}
}
