import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash,key} from '../common/data';
import {acceptConsents,consentInput,currentDocuments} from '../auth/consents';
import {OwnerService} from './owner.service';
import {FadadaOwnerClient} from './fadada-owner.client';
import {ownerScope,ownerScopeHash} from './rules';
const requestInput=z.object({scope:ownerScope,sealId:z.string().min(1),accepted:z.literal(true),consents:consentInput,idempotencyKey:key}).strict();
const switchInput=z.object({enabled:z.boolean(),revision:z.number().int().min(0),scopeHash:z.string()}).strict();
export class OwnerAuthorizationService {
 constructor(private db:Db,private owners:OwnerService,private api:FadadaOwnerClient){}
 async callback(payload:unknown){const event=this.api.verifyCallback(payload),a=await this.db.ownerAutoAuthority.findUnique({where:{providerTransactionId:event.transactionId}});ensure(a&&a.providerContractId===event.providerContractId&&(!event.record.customer_id||event.record.customer_id===a.providerCustomerId),409,'OWNER_CALLBACK_BINDING','授权回调与原任务不匹配');await this.refresh(a.requestedBy,a.ownerId,a.id);return{accepted:true};}
 private enabled(){ensure(process.env.OWNER_AUTO_SIGNING_ENABLED==='true',503,'OWNER_AUTO_DISABLED','企业自动签署授权入口尚未开放，可继续逐份签署');}
 view(a:any){return{id:a.id,ownerId:a.ownerId,sealId:a.sealId,scope:a.scope,scopeHash:a.scopeHash,status:a.status,enabled:a.enabled,revision:a.revision,checkedAt:a.checkedAt,enabledAt:a.enabledAt,disabledAt:a.disabledAt,createdAt:a.createdAt};}
 private async grant(customerId:string,ownerId:string,id:string){await this.owners.member(customerId,ownerId);const a=await this.db.ownerAutoAuthority.findFirst({where:{id,ownerId}});ensure(a,404,'NOT_FOUND','授权记录不存在');return a;}
 async list(customerId:string,ownerId:string){await this.owners.member(customerId,ownerId);return(await this.db.ownerAutoAuthority.findMany({where:{ownerId},orderBy:{createdAt:'desc'},take:100})).map(a=>this.view(a));}
 async request(customerId:string,ownerId:string,raw:unknown){
  this.enabled();const input=requestInput.parse(raw);input.scope.vehicleIds.sort();const requestHash=hash(input);await this.owners.requireSigningMember(customerId,ownerId);
  const grant=await this.db.serial(async tx=>{
   const old=await tx.ownerAutoAuthority.findUnique({where:{ownerId_idempotencyKey:{ownerId,idempotencyKey:input.idempotencyKey}}});if(old){ensure(old.requestedBy===customerId&&old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','请求编号已用于不同授权内容');return old;}
   const owner=await tx.vehicleOwner.findUniqueOrThrow({where:{id:ownerId},include:{esignAccount:true,members:{where:{customerId,status:'VERIFIED'}}}}),account=owner.esignAccount;
   ensure(owner.status==='VERIFIED'&&owner.members.length===1&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED'&&account.certStatus==='BOUND'&&account.certSerialNo&&account.providerCustomerId&&account.checkedAt&&Date.now()-account.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY','请先核验企业、本人经办权限及有效证书');
   const seal=await tx.ownerSeal.findFirst({where:{id:input.sealId,ownerId,status:'ACTIVE',providerCustomerId:account.providerCustomerId,checkedAt:{gt:new Date(Date.now()-86400000)}}});ensure(seal,409,'OWNER_SEAL_UNAVAILABLE','企业印章未就绪');
   ensure(await tx.ownerVehicle.count({where:{ownerId,vehicleId:{in:input.scope.vehicleIds},status:'APPROVED'}})===input.scope.vehicleIds.length,409,'OWNER_VEHICLE_SCOPE','授权车辆未通过本企业归属审核');
   const template=await tx.legalDocument.findUnique({where:{id:input.scope.templateId}});ensure(template?.type==='owner-rental-contract'&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&template.version===input.scope.templateVersion&&hash(template.content)===input.scope.templateHash,409,'OWNER_TEMPLATE_SCOPE','合同模板版本未核实');
   ensure(Date.parse(input.scope.validUntil)>Date.now(),409,'OWNER_SCOPE_EXPIRED','授权范围已过期');
   await acceptConsents(tx,customerId,input.consents,['terms','privacy','owner-auto-sign'],'OWNER_AUTO_SIGN');const docs=await currentDocuments(tx,['terms','privacy','owner-auto-sign']);
   await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
   const result=await tx.ownerAutoAuthority.create({data:{ownerId,sealId:seal.id,providerCustomerId:account.providerCustomerId,providerSignatureId:seal.providerSignatureId,certificateSerialNo:account.certSerialNo,providerContractId:randomUUID().replaceAll('-',''),providerTransactionId:randomUUID().replaceAll('-',''),requestedBy:customerId,idempotencyKey:input.idempotencyKey,requestHash,scope:input.scope,scopeHash:hash(input.scope),consentSnapshot:{customerId,ownerId,sealId:seal.id,scopeHash:hash(input.scope),documents:docs.map(d=>({id:d.id,version:d.version,type:d.type,hash:hash(d.content)}))}}});
   await audit(tx,customerId,'OWNER_AUTH_REQUESTED','vehicle-owners',ownerId,{authorityId:result.id,scopeHash:result.scopeHash},'CUSTOMER');return result;
  });
  ensure(grant.status==='PENDING'||grant.status==='AUTHORIZED',409,'OWNER_AUTH_CLOSED','本次授权已经关闭，请重新确认新的授权范围');
  return{...this.view(grant),...this.api.createAuthorizationUrl({customerId:grant.providerCustomerId,signatureId:grant.providerSignatureId,contractId:grant.providerContractId,transactionId:grant.providerTransactionId})};
 }
 async refresh(customerId:string,ownerId:string,id:string){
  const a=await this.grant(customerId,ownerId,id);await this.owners.requireSigningMember(customerId,ownerId);
  try{
   const proof=await this.api.queryAuthorization({customerId:a.providerCustomerId,contractId:a.providerContractId,transactionId:a.providerTransactionId});const cert=await this.api.queryCertificate(a.providerCustomerId);
   ensure(cert.bound&&cert.serialNo===a.certificateSerialNo,409,'OWNER_CERT_CHANGED','企业证书已失效或变化，请重新办理授权');
   await this.db.serial(async tx=>{
    await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});
    const changed=await tx.ownerAutoAuthority.updateMany({where:{id:a.id,revision:a.revision},data:{status:proof.authorized?(a.status==='REVOKING'?'REVOKING':'AUTHORIZED'):'REVOKED',enabled:proof.authorized&&a.status!=='REVOKING'?a.enabled:false,checkedAt:new Date(),...(!proof.authorized?{disabledAt:new Date(),revokedAt:new Date()}:{}),revision:{increment:1}}});ensure(changed.count===1,409,'OWNER_AUTH_CHANGED','授权状态已变化，请重新读取');
    await audit(tx,customerId,'OWNER_AUTH_QUERIED','vehicle-owners',ownerId,{authorityId:id,authorized:proof.authorized},'CUSTOMER');
   });return this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}}));
  }catch(error){await this.db.serial(async tx=>{await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{id,revision:a.revision},data:{enabled:false,status:'UNKNOWN',checkedAt:null,disabledAt:new Date(),revision:{increment:1}}});});throw error;}
 }
 async setEnabled(customerId:string,ownerId:string,id:string,raw:unknown){
  const input=switchInput.parse(raw),a=await this.grant(customerId,ownerId,id);
  if(!input.enabled)return this.disable(ownerId,id,customerId,'CUSTOMER');
  this.enabled();await this.owners.requireSigningMember(customerId,ownerId);
  ensure(a.requestedBy===customerId&&input.scopeHash===a.scopeHash&&ownerScopeHash(a.scope)===a.scopeHash,409,'OWNER_SCOPE_CHANGED','请由确认该范围的企业经办人核对完整授权范围');ensure(input.revision===a.revision,409,'OWNER_AUTH_CHANGED','授权版本已变化，请重新读取');
  const refreshed=await this.refresh(customerId,ownerId,id);ensure(refreshed.status==='AUTHORIZED',409,'OWNER_AUTH_NOT_READY','法大大尚未确认本次自动签署授权');
  await this.db.serial(async tx=>{
   const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:{include:{esignAccount:true}}}}),acct=member?.owner.esignAccount;
   ensure(member?.status==='VERIFIED'&&member.owner.status==='VERIFIED'&&acct?.managerCustomerId===customerId&&acct.certStatus==='BOUND'&&acct.certSerialNo===a.certificateSerialNo&&acct.realNameStatus==='VERIFIED'&&acct.checkedAt&&Date.now()-acct.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY','企业身份或经办权限已变化');
   ensure(await tx.ownerSeal.count({where:{id:a.sealId,ownerId,status:'ACTIVE',providerCustomerId:a.providerCustomerId,providerSignatureId:a.providerSignatureId,checkedAt:{gt:new Date(Date.now()-86400000)}}}),409,'OWNER_SEAL_UNAVAILABLE','授权印章已变化');
   const scope=ownerScope.parse(a.scope);ensure(Date.parse(scope.validFrom)<=Date.now()&&Date.now()<Date.parse(scope.validUntil),409,'OWNER_SCOPE_EXPIRED','授权当前不在有效期内');
   await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true,id:{not:id}},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
   const changed=await tx.ownerAutoAuthority.updateMany({where:{id,revision:refreshed.revision,status:'AUTHORIZED',checkedAt:{gt:new Date(Date.now()-60000)}},data:{enabled:true,enabledAt:new Date(),revision:{increment:1}}});ensure(changed.count===1,409,'OWNER_AUTH_CHANGED','授权状态已变化');await audit(tx,customerId,'OWNER_AUTO_ENABLED','vehicle-owners',ownerId,{authorityId:id,scopeHash:a.scopeHash},'CUSTOMER');
  });return this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}}));
 }
 private async disable(ownerId:string,id:string,actorId:string,actorType:string){await this.db.serial(async tx=>{await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.update({where:{id},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});await audit(tx,actorId,'OWNER_AUTO_DISABLED','vehicle-owners',ownerId,{authorityId:id},actorType);});return this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}}));}
 async pause(actorId:string,ownerId:string,id:string){const actor=await this.db.adminUser.findUnique({where:{id:actorId}});ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅运营或管理员可暂停');ensure(await this.db.ownerAutoAuthority.count({where:{id,ownerId}}),404,'NOT_FOUND','授权记录不存在');return this.disable(ownerId,id,actorId,'ADMIN');}
 async revoke(customerId:string,ownerId:string,id:string){const a=await this.grant(customerId,ownerId,id);await this.disable(ownerId,id,customerId,'CUSTOMER');await this.db.ownerAutoAuthority.update({where:{id},data:{status:'REVOKING',revision:{increment:1}}});return{...this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}})),...this.api.createRevocationUrl(a.providerCustomerId)};}
}
