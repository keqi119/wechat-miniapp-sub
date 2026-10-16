import {TechnicalAcceptanceSigning} from '../technical-acceptance/signing';
import {MINIAPP_RETURN,runNativeSigning,nativeRealnameUrl} from './native-signing';
import {realnameInput,recordRealnameConsent} from './realname-consent';
import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit, pagination } from '../common/data';
import { SignatureService } from '../orders/signature.service';
import { CustomerESignOnboardingService } from './customer-esign-onboarding.service';
import { SignaturePolicyService } from './enterprise-seal/signature-policy.service';
import { FadadaESignGateway } from './fadada/fadada-esign.provider';
import { FadadaSettings,ESIGN_SETTINGS } from './esign.settings';
export {ESIGN_SETTINGS} from './esign.settings';
@Controller()
export class ESignCustomerController {
  constructor(@Inject(CustomerESignOnboardingService)private accounts:CustomerESignOnboardingService,@Inject(Db)private db:Db){}
  @Get('customer/esign/readiness')readiness(@Req()request:any){return this.accounts.readiness(request.customer.id);}
  @Post('customer/esign/register')register(@Req()request:any,@Body()body:any){z.object({}).strict().parse(body);return runNativeSigning(()=>this.accounts.register(request.customer.id));}
  @Post('customer/esign/verify')async verify(@Req()request:any,@Body()body:any){ensure(body?.consent!==undefined,400,'ESIGN_CLIENT_UPDATE','请重新打开最新版小程序并单独同意实名说明');const input=realnameInput.parse(body);await recordRealnameConsent(this.db,request.customer.id,input.consent,'MINIAPP');return runNativeSigning(async()=>{const result=await this.accounts.verify(request.customer.id,{name:input.name,idCardNo:input.idCardNo},MINIAPP_RETURN);return{...result,url:nativeRealnameUrl(result.url)};});}
  @Post('customer/esign/refresh')refresh(@Req()request:any,@Body()body:any){z.object({}).strict().parse(body);return runNativeSigning(()=>this.accounts.refresh(request.customer.id));}
  @Get('admin/customers/:id/esign-readiness')adminReadiness(@Param('id')id:string){return this.accounts.readiness(id);}
}
@Controller()
export class EnterpriseSealController {
  constructor(@Inject(Db)private db:Db,@Inject(ESIGN_SETTINGS)private settings:FadadaSettings){}
  private read(request:any){ensure(['ADMIN','OPERATIONS'].includes(request.admin?.role),403,'SEAL_READ_PERMISSION','无印章管理读取权限');}
  private async listing(delegate:any,request:any,fields:string[]){this.read(request);const p=pagination(request.query);const where:any={};if(request.query.status)where.status=String(request.query.status);if(request.query.keyword)where.OR=fields.map(field=>({[field]:{contains:String(request.query.keyword).slice(0,200),mode:'insensitive'}}));const[items,total]=await Promise.all([delegate.findMany({where,skip:p.skip,take:p.take,orderBy:{createdAt:'desc'}}),delegate.count({where})]);return{items,total,page:p.page,pageSize:p.pageSize};}
  @Get('admin/enterprise-seals/:id')async sealDetail(@Param('id')id:string,@Req()request:any){this.read(request);return this.db.enterpriseSeal.findUniqueOrThrow({where:{id}});}
  @Get('admin/seal-authorities/:id')async authorityDetail(@Param('id')id:string,@Req()request:any){this.read(request);return this.db.sealAuthority.findUniqueOrThrow({where:{id}});}
  @Get('admin/signature-policies/:id')async policyDetail(@Param('id')id:string,@Req()request:any){this.read(request);return this.db.signaturePolicy.findUniqueOrThrow({where:{id}});}
  private admin(request:any){ensure(request.admin?.role==='ADMIN',403,'SEAL_MANAGEMENT_PERMISSION','印章和授权仅管理员可维护');}
  @Get('admin/enterprise-seals')async seals(@Req()request:any){return this.listing(this.db.enterpriseSeal,request,['sealName','organizationName']);}
  @Post('admin/enterprise-seals')async create(@Req()request:any,@Body()body:any){this.admin(request);const input=z.object({sealName:z.string().trim().min(1).max(100),organizationName:z.literal('上海晓浪网络科技有限公司'),providerCustomerId:z.string().min(1).max(200),providerSignatureId:z.string().min(1).max(200),evidenceFileId:z.string().min(1)}).strict().parse(body);ensure(await this.db.storedFile.count({where:{id:input.evidenceFileId,customerId:null}}),400,'SEAL_EVIDENCE','请上传企业与印章授权证明');const item=await this.db.enterpriseSeal.create({data:{...input,status:'DRAFT',confirmedBy:request.admin.id}});await audit(this.db,request.admin.id,'SEAL_DRAFT_CREATED','enterprise-seals',item.id,{});return item;}
  @Post('admin/enterprise-seals/:id/activate')async activate(@Param('id')id:string,@Req()request:any,@Body()body:any){this.admin(request);ensure(body?.identityConfirmed===true,400,'SEAL_CONFIRMATION','请核对企业与供应商印章映射');const seal=await this.db.enterpriseSeal.findUnique({where:{id}});ensure(seal&&seal.status==='DRAFT',409,'SEAL_STATE','印章不在待核验状态');ensure(seal.confirmedBy!==request.admin.id,403,'TWO_PERSON_REQUIRED','印章建档与启用需由不同管理员完成');ensure(this.settings.platformCustomerId&&this.settings.platformSignatureId&&seal.providerCustomerId===this.settings.platformCustomerId&&seal.providerSignatureId===this.settings.platformSignatureId,409,'SEAL_PROVIDER_MAPPING','企业与印章映射不符合已配置的供应商账号');const updated=await this.db.enterpriseSeal.update({where:{id},data:{status:'ACTIVE',confirmedBy:request.admin.id,confirmedAt:new Date()}});await audit(this.db,request.admin.id,'SEAL_ACTIVATED','enterprise-seals',id,{});return updated;}
  @Post('admin/enterprise-seals/:id/disable')async disable(@Param('id')id:string,@Req()request:any){this.admin(request);const item=await this.db.enterpriseSeal.update({where:{id},data:{status:'DISABLED'}});await audit(this.db,request.admin.id,'SEAL_DISABLED','enterprise-seals',id,{});return item;}
  @Get('admin/seal-authorities')async authorities(@Req()request:any){return this.listing(this.db.sealAuthority,request,['subjectId','authorityType']);}
  @Post('admin/seal-authorities')async authority(@Req()request:any,@Body()body:any){this.admin(request);const input=z.object({sealId:z.string().min(1),subjectType:z.enum(['USER','ROLE']),subjectId:z.string().min(1),authorityType:z.enum(['REQUEST_USE','APPROVE_USE'])}).strict().parse(body);ensure(await this.db.enterpriseSeal.count({where:{id:input.sealId,status:'ACTIVE'}}),409,'SEAL_STATE','印章未启用');if(input.subjectType==='USER')ensure(await this.db.adminUser.count({where:{id:input.subjectId,active:true,role:{in:['ADMIN','OPERATIONS']}}}),400,'SEAL_SUBJECT','授权人员不可用');else ensure(['ADMIN','OPERATIONS'].includes(input.subjectId),400,'SEAL_SUBJECT','授权角色不可用');const item=await this.db.sealAuthority.upsert({where:{sealId_subjectType_subjectId_authorityType:input},create:{...input,status:'ACTIVE',requiresTwoPersonApproval:true},update:{status:'ACTIVE',requiresTwoPersonApproval:true}});await audit(this.db,request.admin.id,'SEAL_AUTHORITY_GRANTED','seal-authorities',item.id,{sealId:input.sealId,authorityType:input.authorityType});return item;}
  @Post('admin/seal-authorities/:id/revoke')async revoke(@Param('id')id:string,@Req()request:any){this.admin(request);const item=await this.db.sealAuthority.update({where:{id},data:{status:'DISABLED'}});await audit(this.db,request.admin.id,'SEAL_AUTHORITY_REVOKED','seal-authorities',id,{});return item;}
  @Get('admin/signature-policies')async policies(@Req()request:any){const delegate={findMany:(args:any)=>this.db.signaturePolicy.findMany({...args,where:{...args.where,...(request.query.kind?{kind:z.enum(['SUBSCRIPTION','HANDOVER','AMENDMENT','TECHNICAL_ACCEPTANCE']).parse(request.query.kind)}:{})}}),count:(args:any)=>this.db.signaturePolicy.count({...args,where:{...args.where,...(request.query.kind?{kind:z.enum(['SUBSCRIPTION','HANDOVER','AMENDMENT','TECHNICAL_ACCEPTANCE']).parse(request.query.kind)}:{})}})};return this.listing(delegate,request,['policyCode','policyName']);}
  @Post('admin/signature-policies')async policy(@Req()request:any,@Body()body:any){this.admin(request);const input=z.object({policyCode:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),policyName:z.string().trim().min(1).max(100),kind:z.enum(['SUBSCRIPTION','HANDOVER','AMENDMENT','TECHNICAL_ACCEPTANCE']),sealId:z.string().min(1),executionMode:z.literal('SEQUENTIAL').default('SEQUENTIAL')}).strict().parse(body);const item=await this.db.signaturePolicy.create({data:{...input,status:'DRAFT'}});await audit(this.db,request.admin.id,'SIGNATURE_POLICY_DRAFT','signature-policies',item.id,{});return item;}
  @Post('admin/signature-policies/:id/activate')async activatePolicy(@Param('id')id:string,@Req()request:any){this.admin(request);const policy=await this.db.signaturePolicy.findUniqueOrThrow({where:{id}});ensure(await this.db.enterpriseSeal.count({where:{id:policy.sealId,status:'ACTIVE'}}),409,'SEAL_STATE','印章未启用');const item=await this.db.signaturePolicy.update({where:{id},data:{status:'ACTIVE'}});await audit(this.db,request.admin.id,'SIGNATURE_POLICY_ACTIVATED','signature-policies',id,{});return item;}
  @Post('admin/signature-policies/:id/disable')async disablePolicy(@Param('id')id:string,@Req()request:any){this.admin(request);const item=await this.db.signaturePolicy.update({where:{id},data:{status:'DISABLED'}});await audit(this.db,request.admin.id,'SIGNATURE_POLICY_DISABLED','signature-policies',id,{});return item;}
}
@Controller()
export class ESignApprovalController {
  constructor(@Inject(Db)private db:Db,@Inject(SignaturePolicyService)private policies:SignaturePolicyService){}
  @Post('admin/contracts/:id/prepare-signature')prepareContract(@Param('id')id:string,@Req()request:any,@Body()body:any){return this.policies.prepare('SUBSCRIPTION',id,z.object({policyId:z.string().min(1)}).strict().parse(body).policyId,request.admin.id);}
  @Post('admin/handovers/:id/prepare-signature')prepareHandover(@Param('id')id:string,@Req()request:any,@Body()body:any){return this.policies.prepare('HANDOVER',id,z.object({policyId:z.string().min(1)}).strict().parse(body).policyId,request.admin.id);}
  @Get('admin/esign-approvals')async list(@Req()request:any){const p=pagination(request.query);const where:any={};for(const key of ['resourceId','kind','status'])if(request.query[key])where[key]=String(request.query[key]).slice(0,200);const [items,total]=await Promise.all([this.db.eSignApproval.findMany({where,skip:p.skip,take:p.take,orderBy:{createdAt:'desc'}}),this.db.eSignApproval.count({where})]);return{items,total,page:p.page,pageSize:p.pageSize};}
  @Get('admin/esign-approvals/:id')async detail(@Param('id')id:string){return{...await this.db.eSignApproval.findUniqueOrThrow({where:{id}}),renewalEligibility:await this.policies.renewalEligibility(id)};}
  @Post('admin/esign-approvals/:id/renew')renew(@Param('id')id:string,@Req()request:any,@Body()body:any){return this.policies.renew(id,z.object({policyId:z.string().min(1)}).strict().parse(body).policyId,request.admin.id);}
  @Post('admin/esign-approvals/:id/approve')approve(@Param('id')id:string,@Req()request:any,@Body()body:any){return this.policies.approve(id,request.admin.id,z.object({planHash:z.string().min(1)}).strict().parse(body).planHash);}
  @Post('admin/esign-approvals/:id/reject')reject(@Param('id')id:string,@Req()request:any,@Body()body:any){return this.policies.reject(id,request.admin.id,z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(body).reason);}
}
@Controller()
export class FadadaCallbacksController {
  constructor(@Inject(FadadaESignGateway)private gateway:FadadaESignGateway,@Inject(CustomerESignOnboardingService)private accounts:CustomerESignOnboardingService,@Inject(SignatureService)private signatures:SignatureService,@Inject(TechnicalAcceptanceSigning)private technical:TechnicalAcceptanceSigning){}
  @Post('callbacks/fadada-sign')sign(@Body()body:unknown){return this.gateway.callback(body,(task,event)=>{if(task.kind==='TECHNICAL_ACCEPTANCE')return this.technical.settle(task.resourceId,{...event,taskId:task.id});if(task.kind==='HANDOVER')return this.signatures.settleHandover(task.resourceId,{...event,taskId:task.id});ensure(['SUBSCRIPTION','AMENDMENT'].includes(task.kind),409,'SIGNATURE_KIND','不支持的签署业务类型');return this.signatures.settleContract(task.resourceId,{...event,taskId:task.id});});}
  @Post('callbacks/fadada-identity')identity(@Body()body:unknown){return this.accounts.callback(body);}
}
@Controller()
export class ESignPublicController {
  @Get('public/esign-return')returnPage(@Res()response:any){response.type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>返回小程序</title><body style="font-family:sans-serif;padding:32px"><h2>请返回小程序查询结果</h2><p>点击左上角返回，签署与实名状态以服务端查询为准。</p></body></html>');}
}
