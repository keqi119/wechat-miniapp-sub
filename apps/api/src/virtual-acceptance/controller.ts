import {Body,Controller,Get,Inject,Post,Req,Param} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {VIRTUAL_NOTICE,VIRTUAL_NOTICE_HASH,requireCurrentVirtualScope} from './scope';
import {saveElectronicCooperationDraft} from '../electronic-documents/cooperation';
import {hash} from '../common/data';
import {VIRTUAL_FACTS_HASH,virtualConfigurationHash,validateVirtualConfiguration} from './configuration';
import {VIRTUAL_WRAPPER_VERSION,VIRTUAL_WRAPPER_HASH} from './wrapper';
import {createVirtualQuote,reviewVirtualQuote} from './quotes';
import {virtualActorScope} from './actors';
import {customerIdentityConfig,nativeSigningConfig} from '../esign/native-signing';
import {claimOwnerLegalInvitation} from '../owner-h5/legal-representative';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().min(1).max(128);
const bootstrap=z.object({revision:z.literal(0),idempotencyKey:z.string().min(8).max(128),customerId:id,ownerId:id,ownerActorCustomerId:id,platformId:id,platformActorCustomerId:id,expiresAt:z.iso.datetime()}).strict();
@Controller()
export class VirtualAcceptanceController{
 constructor(@Inject(Db) private db:Db){}
 @Post('customer/virtual-acceptance/owners/:ownerId/claim') async claim(@Req()r:any,@Param('ownerId')ownerId:string,@Body()raw:unknown){ensure(await virtualActorScope(this.db,r.customer.id,{ownerId}),403,'VIRTUAL_OWNER_REQUIRED','请使用此测试企业指定的本人账户');return claimOwnerLegalInvitation(this.db,r.customer.id,raw,ownerId);}
 @Get('customer/virtual-acceptance/capabilities') async capabilities(@Req()r:any){
  const scope=await virtualActorScope(this.db,r.customer.id,{current:false});
  if(!scope)return{entry:null};
  const recovery={identity:true};
  if(scope.status!=='READY'||scope.expiresAt<=new Date())return{entry:null,recovery};
  try{await requireCurrentVirtualScope(this.db,{vehicleId:scope.vehicle.id,action:'CAPABILITY'});}catch(error){if(String((error as any).getResponse?.()?.error?.code||'').startsWith('VIRTUAL_'))return{entry:null,recovery};throw error;}
  const identity=customerIdentityConfig(true),native=nativeSigningConfig(),ownerId=scope.ownerActorCustomerId===r.customer.id?scope.ownerId:scope.platformActorCustomerId===r.customer.id?scope.platformId:null;
  return{recovery,entry:{vehicleId:scope.customerId===r.customer.id?scope.vehicle.id:null,ownerId,notice:VIRTUAL_NOTICE},identity:{...identity,enabled:identity.enabled&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true'},signing:{...native,newOrderContractMode:'ELECTRONIC',newElectronicRequestsEnabled:process.env.ELECTRONIC_SIGNING_ENABLED==='true'&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true',electronicEnabled:process.env.ELECTRONIC_SIGNING_ENABLED==='true'&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true'&&process.env.MINIAPP_SIGNING_ENABLED==='true'},companyEntry:ownerId?native.ownerPortal.entryUrl+'?purpose=legal':null};
 }
 @Post('admin/applications/:applicationId/virtual-quote') quote(@Param('applicationId')id:string,@Body()raw:unknown,@Req()r:any){return this.db.serial(tx=>createVirtualQuote(tx,r.admin,id,raw));}
 @Post('admin/applications/:applicationId/virtual-review') review(@Param('applicationId')id:string,@Body()raw:unknown,@Req()r:any){return this.db.serial(tx=>reviewVirtualQuote(tx,r.admin,id,raw));}
 private async admin(tx:any,r:any){await requireCurrentStaff(tx,r.admin,'vehicles');ensure(r.admin.role==='ADMIN',403,'FORBIDDEN','仅管理员可维护指定验收范围');}
 @Post('admin/virtual-acceptance/:id/cooperation') async cooperation(@Param('id')scopeId:string,@Body()raw:unknown,@Req()r:any){
  const input=z.object({revision:z.literal(0),idempotencyKey:z.string().min(8).max(128),productVersionId:id,subscriptionTemplateId:id,validFrom:z.iso.date(),validUntil:z.iso.date()}).strict().parse(raw);
  return this.db.serial(async tx=>{await this.admin(tx,r);const scope=await tx.virtualAcceptanceScope.findUnique({where:{id:scopeId},include:{vehicle:true}});ensure(scope?.status==='DRAFT'&&scope.vehicle&&scope.expiresAt>new Date(),409,'VIRTUAL_SCOPE_INACTIVE','须使用未到期的准备范围');
   const template=await tx.legalDocument.findUnique({where:{id:input.subscriptionTemplateId}});ensure(template?.type==='ELECTRONIC_V31_SUBSCRIPTION'&&template.status==='PUBLISHED',409,'VIRTUAL_TEMPLATE_CHANGED','须选择已批准初始订阅正文');
   return saveElectronicCooperationDraft(tx,r.admin,scope.ownerId,{revision:0,idempotencyKey:input.idempotencyKey,status:'DRAFT',title:'虚拟流程验收合作协议',referenceNumber:'',vehicleIds:[scope.vehicle.id],partnerRateBps:0,validFrom:input.validFrom,validUntil:input.validUntil,notes:VIRTUAL_NOTICE,v31Sources:{virtualAcceptanceScopeId:scope.id,productVersionIds:[input.productVersionId],productDepositRules:[{productVersionId:input.productVersionId,rule:{kind:'FIXED',amount:100}}],templateRefs:[{id:template.id,hash:hash(template.content)}],vehicleScopes:[{vehicleId:scope.vehicle.id,validFrom:input.validFrom,validUntil:input.validUntil,authorityEvidenceFileIds:[],rightsRestrictions:{status:'NOT_APPLICABLE'}}]}});
  });
 }
 @Post('admin/virtual-acceptance/:id/freeze') async freeze(@Param('id')scopeId:string,@Body()raw:unknown,@Req()r:any){
  const input=z.object({revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128),productVersionId:id,productHash:digest,cooperationVersionId:id,cooperationHash:digest,subscriptionTemplateId:id,subscriptionTemplateHash:digest,cooperationTemplateId:id,cooperationTemplateHash:digest,grantTemplateId:id,grantTemplateHash:digest,wrapperHash:z.literal(VIRTUAL_WRAPPER_HASH),wrapperApproved:z.literal(true)}).strict().parse(raw);
  return this.db.serial(async tx=>{await this.admin(tx,r);await tx.$queryRaw`SELECT id FROM "VirtualAcceptanceScope" WHERE id=${scopeId} FOR UPDATE`;
   return archiveCommand(tx,r.admin,scopeId,'VIRTUAL_FREEZE',input,async()=>{
    const scope=await tx.virtualAcceptanceScope.findUnique({where:{id:scopeId},include:{vehicle:true}});ensure(scope?.status==='DRAFT'&&scope.vehicle&&scope.expiresAt>new Date(),409,'VIRTUAL_SCOPE_INACTIVE','范围非有效准备状态');ensure(scope.revision===input.revision,409,'REVISION_CONFLICT','验收范围版本已变化');
    const {idempotencyKey,wrapperApproved,revision,...refs}=input;
    const content={...scope,...refs,revision:revision+1,vehicleId:scope.vehicle.id,wrapperVersion:VIRTUAL_WRAPPER_VERSION,wrapperApprovedBy:r.admin.id,wrapperApprovedAt:new Date(),testFactsHash:VIRTUAL_FACTS_HASH};const configurationHash=virtualConfigurationHash(content);
    const {product}=await validateVirtualConfiguration(tx,{...content,configurationHash});
    ensure(!await tx.subscriptionPlan.count({where:{vehicleId:scope.vehicle.id}}),409,'VIRTUAL_PLAN_EXISTS','指定虚拟车辆已有套餐，禁止重复绑定');
    await tx.subscriptionPlan.create({data:{vehicleId:scope.vehicle.id,productVersionId:product.id,name:product.name,months:12,monthlyFeeAmount:100,mileagePerMonthKm:product.mileagePerMonthKm,excessMileagePriceAmount:product.excessMileagePriceAmount,energyDescription:product.energyDescription,benefits:[],conditions:product.conditions,active:true}});
    const saved=await tx.virtualAcceptanceScope.update({where:{id:scopeId},data:{...refs,status:'READY',revision:content.revision,wrapperVersion:content.wrapperVersion,wrapperApprovedBy:content.wrapperApprovedBy,wrapperApprovedAt:content.wrapperApprovedAt,testFactsHash:VIRTUAL_FACTS_HASH,configurationHash}});
    await audit(tx,r.admin.id,'VIRTUAL_FREEZE','virtual-acceptance',scopeId,{configurationHash,wrapperHash:content.wrapperHash,revision:saved.revision});return{id:saved.id,status:saved.status,revision:saved.revision,configurationHash};
   });
  });
 }
 @Post('admin/virtual-acceptance/:id/revoke') async revoke(@Param('id')scopeId:string,@Body()raw:unknown,@Req()r:any){const input=z.object({revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128),reason:z.string().trim().min(1).max(1000)}).strict().parse(raw);return this.db.serial(async tx=>{await this.admin(tx,r);return archiveCommand(tx,r.admin,scopeId,'VIRTUAL_REVOKE',input,async()=>{const s=await tx.virtualAcceptanceScope.findUniqueOrThrow({where:{id:scopeId}});ensure(s.revision===input.revision,409,'REVISION_CONFLICT');await tx.virtualAcceptanceScope.update({where:{id:scopeId},data:{status:'REVOKED'}});await audit(tx,r.admin.id,'VIRTUAL_REVOKE','virtual-acceptance',scopeId,{reason:input.reason});return{status:'REVOKED'};});});}
 @Post('admin/virtual-acceptance/bootstrap') async bootstrap(@Body()raw:unknown,@Req()r:any){
  const input=bootstrap.parse(raw);return this.db.serial(async tx=>{
   await requireCurrentStaff(tx,r.admin,'vehicles');ensure(r.admin.role==='ADMIN',403,'FORBIDDEN','仅管理员可准备指定虚拟验收范围');
   return archiveCommand(tx,r.admin,'NINDA_INITIAL_VIRTUAL_20261109','VIRTUAL_BOOTSTRAP',input,async()=>{
    ensure(!await tx.virtualAcceptanceScope.count(),409,'VIRTUAL_SCOPE_EXISTS','仅允许一个明确指定的虚拟验收范围');
    ensure(new Date(input.expiresAt)>new Date(),400,'VIRTUAL_EXPIRY_REQUIRED','验收截止时间必须晚于当前时间');
    ensure(new Set([input.customerId,input.ownerActorCustomerId,input.platformActorCustomerId]).size===3&&input.ownerId!==input.platformId,400,'VIRTUAL_ROLES_DISTINCT','客户、出租方经办与平台经办须使用分别指定账户');
    ensure(await tx.customer.count({where:{id:{in:[input.customerId,input.ownerActorCustomerId,input.platformActorCustomerId]}}})===3,400,'VIRTUAL_ACCOUNT_REQUIRED','指定账户不存在');
    const platform=await tx.vehicleOwner.findUnique({where:{id:input.platformId}}),owner=await tx.vehicleOwner.findUnique({where:{id:input.ownerId}});
    ensure(owner?.subjectType==='ENTERPRISE'&&platform?.subjectType==='ENTERPRISE'&&platform.name===NINDA_PLATFORM_LEGAL_ENTITY,400,'VIRTUAL_ENTERPRISE_REQUIRED','须指定真实企业记录及宁达平台主体');
    const {idempotencyKey,revision,...binding}=input;
    const scope=await tx.virtualAcceptanceScope.create({data:{...binding,expiresAt:new Date(input.expiresAt),noticeHash:VIRTUAL_NOTICE_HASH,createdBy:r.admin.id}});
    const vehicle=await tx.vehicle.create({data:{virtualAcceptanceScopeId:scope.id,brand:'虚拟验收',model:'非真实车辆',title:'虚拟流程验收车辆（不可交付）',year:new Date().getFullYear(),city:'不适用',mileageKm:0,description:VIRTUAL_NOTICE,conditionDisclosure:'虚拟资产；VIN、登记权属、保险、实际车况及交付均不适用。'}});
    await audit(tx,r.admin.id,'VIRTUAL_BOOTSTRAP','vehicles',vehicle.id,{scopeId:scope.id,noticeHash:VIRTUAL_NOTICE_HASH});
    return{id:scope.id,vehicleId:vehicle.id,status:scope.status,revision:scope.revision,notice:VIRTUAL_NOTICE};
   });
  });
 }
 @Get('customer/virtual-acceptance') async entry(@Req()r:any){
  const scope=await this.db.virtualAcceptanceScope.findFirst({where:{customerId:r.customer.id,status:'READY',expiresAt:{gt:new Date()}},include:{vehicle:true}});
  if(scope?.vehicle)await requireCurrentVirtualScope(this.db,{vehicleId:scope.vehicle.id,customerId:r.customer.id,action:'ENTRY'});
  const plan=scope?.vehicle?await this.db.subscriptionPlan.findFirst({where:{vehicleId:scope.vehicle.id,active:true},select:{id:true,name:true,months:true,monthlyFeeAmount:true}}):null;
  return{entry:scope?{vehicleId:scope.vehicle?.id,title:scope.vehicle?.title,plan,applicationId:scope.applicationId,orderId:scope.orderId,notice:VIRTUAL_NOTICE,contractMode:'ELECTRONIC',identityPolicy:'SIGNING_REQUIRED'}:null};
 }
}
