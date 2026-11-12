import {PlatformAuthorizationService,platformAuthorityView} from './platform-authorization';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash,key} from '../common/data';
import {acceptConsents,consentInput,currentDocuments} from '../auth/consents';
import {OwnerService} from './owner.service';
import {FadadaOwnerClient,isOwnerH5Request} from './fadada-owner.client';
import {ownerAuthorizationMethod} from './authorization-method';
import {assertNewEsignAllowed,newOrderContractMode,assertEnterpriseOnboardingAllowed} from '../offline-documents/mode';
import {OwnerAuthorizationLetterService} from './unilateral-letter.service';
import {NINDA_AUTHORIZATION_GRANTEE,resolveUnilateralLetter} from './unilateral-letter-document';
import {ownerScope,ownerScopeHash,canonicalOwnerScope,currentOwnerDelegate,ownerAuthorizationScopeVersion} from './rules';
const requestInput=z.object({scope:ownerScope,sealId:z.string().min(1),accepted:z.literal(true),consents:consentInput,idempotencyKey:key}).strict();
const switchInput=z.object({enabled:z.boolean(),revision:z.number().int().min(0),scopeHash:z.string()}).strict();
// Existing installations retain their explicit auto-signing gate until the separate entry flag is configured.
export function ownerAuthorizationEntryEnabled(){return(process.env.OWNER_AUTHORIZATION_ENABLED??process.env.OWNER_AUTO_SIGNING_ENABLED)==='true';}
export class OwnerAuthorizationService {
 constructor(private db:Db,private owners:OwnerService,private api:FadadaOwnerClient,private letters?:OwnerAuthorizationLetterService,private platform?:PlatformAuthorizationService){}
 private platformService(){ensure(this.platform,503,'PLATFORM_AUTH_UNAVAILABLE','企业自动签授权尚未配置');return this.platform;}
 private letterService(){ensure(this.letters,503,'OWNER_LETTER_UNAVAILABLE','单方授权书签署能力尚未配置');return this.letters;}
 async callback(payload:unknown){const event=this.api.verifyCallback(payload),a=await this.db.ownerAutoAuthority.findUnique({where:{providerTransactionId:event.transactionId}});ensure(a&&a.providerContractId===event.providerContractId&&(!event.record.customer_id||event.record.customer_id===a.providerCustomerId),409,'OWNER_CALLBACK_BINDING','授权回调与原任务不匹配');if(a.method==='UNILATERAL_LETTER')await this.letterService().refreshTrusted(a.ownerId,a.id);else await this.refresh(a.requestedBy,a.ownerId,a.id);return{accepted:true};}
 private enabled(){if(newOrderContractMode()==='ELECTRONIC')assertEnterpriseOnboardingAllowed();else assertNewEsignAllowed();ensure(process.env.OWNER_AUTO_SIGNING_ENABLED==='true',503,'OWNER_AUTO_DISABLED','自动用印尚未开放，已办理的授权保持停用');}
 view(a:any){if(a.scope?.version===3)return platformAuthorityView(a);return{id:a.id,ownerId:a.ownerId,sealId:a.sealId,scope:a.scope,scopeHash:a.scopeHash,status:a.status,enabled:a.enabled,revision:a.revision,checkedAt:a.checkedAt,enabledAt:a.enabledAt,disabledAt:a.disabledAt,createdAt:a.createdAt,method:a.method??'PROVIDER_AUTO_GRANT',...(a.letter?{document:{state:a.letter.state,bodyHash:a.letter.bodyHash,sourceSha256:a.letter.sourceSha256,signedPdfHash:a.letter.signedPdfHash,sourceAvailable:!!a.letter.sourceFileId,signedAvailable:!!a.letter.signedFileId,withdrawnAt:a.letter.withdrawnAt,technicalAuthorizationStatus:'UNCONFIRMED'}}:{})};}
 private async grant(customerId:string,ownerId:string,id:string){await this.owners.member(customerId,ownerId);await this.owners.requireLegalSigningMember(customerId,ownerId);const a=await this.db.ownerAutoAuthority.findFirst({where:{id,ownerId},include:{letter:true,platformEvidence:true}});ensure(a,404,'NOT_FOUND','授权记录不存在');return a;}
 async list(customerId:string,ownerId:string){
  await this.owners.member(customerId,ownerId);
  const account=await this.db.ownerESignAccount.findUnique({where:{ownerId},select:{certStatus:true,certSerialNo:true,providerCustomerId:true,checkedAt:true}});
  const now=Date.now(),current=account?.certStatus==='BOUND'&&account.certSerialNo&&account.providerCustomerId&&account.checkedAt&&account.checkedAt.getTime()<=now&&account.checkedAt.getTime()>now-86400000;
  return(await this.db.ownerAutoAuthority.findMany({where:{ownerId},include:{letter:true,platformEvidence:true},orderBy:{createdAt:'desc'},take:100})).map(a=>({...this.view(a),certificateMatchesCurrent:current?account.certSerialNo===a.certificateSerialNo&&account.providerCustomerId===a.providerCustomerId:null}));
 }
 async request(customerId:string,ownerId:string,raw:unknown){
  if(ownerAuthorizationScopeVersion()===3)return this.platformService().request(customerId,ownerId,raw);
  if(newOrderContractMode()==='ELECTRONIC'){ensure(ownerAuthorizationMethod()==='PROVIDER_AUTO_GRANT',409,'V31_INDEPENDENT_GRANT_REQUIRED','请从独立附件三电子授权任务办理');assertEnterpriseOnboardingAllowed();}else assertNewEsignAllowed();
  ensure(ownerAuthorizationEntryEnabled(),503,'OWNER_AUTHORIZATION_DISABLED','企业用印授权办理入口尚未开放');const input=requestInput.parse(raw);ensure(input.scope.version===ownerAuthorizationScopeVersion(),409,'OWNER_SCOPE_VERSION','授权页面版本已变化，请重新打开法人中心');if(newOrderContractMode()==='ELECTRONIC')ensure(input.scope.version===2,409,'OWNER_SCOPE_VERSION','新电子合同须使用当前技术授权入口');input.scope=canonicalOwnerScope(input.scope);const requestHash=hash(input);await this.owners.requireSigningMember(customerId,ownerId);
  const method=ownerAuthorizationMethod(),unilateral=method==='UNILATERAL_LETTER';
  if(unilateral){ensure(isOwnerH5Request(),403,'OWNER_LEGAL_H5_REQUIRED','请由法人本人从企业车主中心办理单方授权书');ensure(input.scope.version===2,409,'OWNER_SCOPE_VERSION','单方授权书仅支持三项范围');this.letterService();}
  const grant=await this.db.serial(async tx=>{
   if(input.scope.version===2){const account=await tx.ownerESignAccount.findUnique({where:{ownerId},select:{consentSnapshot:true}});ensure((account?.consentSnapshot as any)?.channel==='OWNER_LEGAL_H5',403,'OWNER_LEGAL_H5_REQUIRED','请先由法人本人在法人中心办理并核验企业认证');}
   await this.owners.requireLegalSigningMember(customerId,ownerId,tx);
   const owner=await tx.vehicleOwner.findUniqueOrThrow({where:{id:ownerId},include:{esignAccount:true,legalRepresentative:true,members:{where:{customerId,status:'VERIFIED'}}}}),account=owner.esignAccount;
   const creditCode=owner.creditCode;ensure(owner.subjectType==='ENTERPRISE'&&typeof creditCode==='string'&&creditCode.trim().length>0,409,'OWNER_ENTERPRISE_REQUIRED','企业电子用印授权仅适用于已登记统一社会信用代码的企业合作商');
   const old=await tx.ownerAutoAuthority.findUnique({where:{ownerId_idempotencyKey:{ownerId,idempotencyKey:input.idempotencyKey}},include:{letter:true,platformEvidence:true}});if(old){ensure(old.requestedBy===customerId&&old.requestHash===requestHash&&old.method===method,409,'IDEMPOTENCY_CONFLICT','请求编号已用于不同授权内容或办理方式');return old;}
   ensure(owner.status==='VERIFIED'&&owner.members.length===1&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED'&&account.certStatus==='BOUND'&&account.certSerialNo&&account.providerCustomerId&&account.checkedAt&&Date.now()-account.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY','请先核验企业、本人经办权限及有效证书');
   const seal=await tx.ownerSeal.findFirst({where:{id:input.sealId,ownerId,status:'ACTIVE',providerCustomerId:account.providerCustomerId,checkedAt:{gt:new Date(Date.now()-86400000)}}});ensure(seal,409,'OWNER_SEAL_UNAVAILABLE','企业印章未就绪');
   if(input.scope.version===1){
    ensure(await tx.ownerVehicle.count({where:{ownerId,vehicleId:{in:input.scope.vehicleIds},status:'APPROVED'}})===input.scope.vehicleIds.length,409,'OWNER_VEHICLE_SCOPE','授权车辆未通过本企业归属审核');
    const template=await tx.legalDocument.findUnique({where:{id:input.scope.templateId}});ensure(template?.type==='owner-rental-contract'&&template.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&template.version===input.scope.templateVersion&&hash(template.content)===input.scope.templateHash,409,'OWNER_TEMPLATE_SCOPE','合同模板版本未核实');
   }else{
    ensure(input.scope.delegates.every(currentOwnerDelegate),409,'OWNER_DELEGATE_SCOPE','被授权主体与当前运营主体不一致，请重新读取');
    const notice=await tx.legalDocument.findFirst({where:{type:'owner-auto-sign',status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}});
    ensure(notice&&notice.version>=(unilateral?3:2)&&notice.confirmedBy,409,'OWNER_AUTHORIZATION_NOTICE','当前办理方式的用印授权说明尚未审定发布');
    ensure(await tx.legalDocument.count({where:{type:newOrderContractMode()==='ELECTRONIC'?'ELECTRONIC_V31_SUBSCRIPTION':'owner-rental-contract',status:'PUBLISHED',confirmedBy:{not:null},confirmedAt:{not:null}}}),409,'OWNER_TEMPLATE_SCOPE','授权文件种类尚无已审定的合同模板');
   }
   ensure(Date.parse(input.scope.validUntil)>Date.now(),409,'OWNER_SCOPE_EXPIRED','授权范围已过期');
   const authorityId=randomUUID();let letterData:any;
   if(unilateral){
    const template=await tx.legalDocument.findFirst({where:{type:'owner-authorization-letter',status:'PUBLISHED',confirmedAt:{not:null},confirmedBy:{not:null}},orderBy:{version:'desc'}});
    ensure(template,409,'OWNER_LETTER_TEMPLATE_REQUIRED','单方授权书正文尚未审定发布');
    ensure(input.scope.version===2&&input.scope.delegates[0].name===NINDA_AUTHORIZATION_GRANTEE&&owner.legalRepresentative,409,'OWNER_DELEGATE_SCOPE','单方授权书仅允许固定宁达被授权主体和当前法人办理');
    const snapshot={authorityId,ownerId,ownerName:owner.name,creditCode,ownerAddress:owner.address,legalName:owner.legalRepresentative.name,sealImageHash:seal.imageHash,grantee:NINDA_AUTHORIZATION_GRANTEE,validFrom:input.scope.validFrom,validUntil:input.scope.validUntil,documentKinds:input.scope.documentKinds,templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),templateContent:template.content};
    const resolved=resolveUnilateralLetter(snapshot);letterData={snapshot,bodyHash:resolved.bodyHash};
   }
   const consentTypes=['terms','privacy','owner-auto-sign',...(unilateral?['owner-authorization-letter']:[])];
   await acceptConsents(tx,customerId,input.consents,consentTypes,'OWNER_AUTO_SIGN');const docs=await currentDocuments(tx,consentTypes);
   await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
   const result=await tx.ownerAutoAuthority.create({data:{...(unilateral?{id:authorityId,letter:{create:letterData}}:{}),method,ownerId,sealId:seal.id,providerCustomerId:account.providerCustomerId,providerSignatureId:seal.providerSignatureId,certificateSerialNo:account.certSerialNo,providerContractId:randomUUID().replaceAll('-',''),providerTransactionId:randomUUID().replaceAll('-',''),requestedBy:customerId,idempotencyKey:input.idempotencyKey,requestHash,scope:input.scope,scopeHash:hash(input.scope),consentSnapshot:{customerId,ownerId,sealId:seal.id,scopeHash:hash(input.scope),documents:docs.map(d=>({id:d.id,version:d.version,type:d.type,hash:hash(d.content)}))}},include:{letter:true,platformEvidence:true}});
   await audit(tx,customerId,'OWNER_AUTH_REQUESTED','vehicle-owners',ownerId,{authorityId:result.id,scopeHash:result.scopeHash},'CUSTOMER');return result;
  });
  if(grant.method==='UNILATERAL_LETTER'){const entry=await this.letterService().requestEntry(customerId,ownerId,grant.id);return{...this.view(await this.grant(customerId,ownerId,grant.id)),...entry};}
  ensure(grant.status==='PENDING'||grant.status==='AUTHORIZED',409,'OWNER_AUTH_CLOSED','本次授权已经关闭，请重新确认新的授权范围');
  return{...this.view(grant),...this.api.createAuthorizationUrl({customerId:grant.providerCustomerId,signatureId:grant.providerSignatureId,contractId:grant.providerContractId,transactionId:grant.providerTransactionId})};
 }
 async refresh(customerId:string,ownerId:string,id:string){
  if(((await this.grant(customerId,ownerId,id)).scope as any).version===3)return this.platformService().refresh(customerId,ownerId,id);
  const a=await this.grant(customerId,ownerId,id);await this.owners.requireSigningMember(customerId,ownerId);
  if(a.method==='UNILATERAL_LETTER'){await this.letterService().refresh(customerId,ownerId,id);return this.view(await this.grant(customerId,ownerId,id));}
  if(await this.owners.usesLegalPolicy(ownerId))ensure(a.requestedBy===customerId,403,'OWNER_AUTH_ACTOR','原成员申请的授权只能停用或撤销，请由当前法人重新确认授权范围');
  this.api.assertAvailable();
  try{
   const proof=await this.api.queryAuthorization({customerId:a.providerCustomerId,contractId:a.providerContractId,transactionId:a.providerTransactionId});const cert=await this.api.queryCertificate(a.providerCustomerId);
   ensure(cert.bound&&cert.serialNo===a.certificateSerialNo,409,'OWNER_CERT_CHANGED','企业证书已失效或变化，请重新办理授权');
   await this.db.serial(async tx=>{
    await this.owners.requireLegalSigningMember(customerId,ownerId,tx);
    await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});
    const changed=await tx.ownerAutoAuthority.updateMany({where:{id:a.id,revision:a.revision},data:{status:proof.authorized?(a.status==='REVOKING'?'REVOKING':'AUTHORIZED'):'REVOKED',enabled:proof.authorized&&a.status!=='REVOKING'?a.enabled:false,checkedAt:new Date(),...(!proof.authorized?{disabledAt:new Date(),revokedAt:new Date()}:{}),revision:{increment:1}}});ensure(changed.count===1,409,'OWNER_AUTH_CHANGED','授权状态已变化，请重新读取');
    await audit(tx,customerId,'OWNER_AUTH_QUERIED','vehicle-owners',ownerId,{authorityId:id,authorized:proof.authorized},'CUSTOMER');
   });return this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}}));
  }catch(error){await this.db.serial(async tx=>{await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{id,revision:a.revision},data:{enabled:false,status:a.status==='REVOKING'?'REVOKING':'UNKNOWN',checkedAt:null,disabledAt:new Date(),revision:{increment:1}}});});throw error;}
 }
 async setEnabled(customerId:string,ownerId:string,id:string,raw:unknown){
  if(((await this.grant(customerId,ownerId,id)).scope as any).version===3)return this.platformService().setEnabled(customerId,ownerId,id,raw);
  const input=switchInput.parse(raw),a=await this.grant(customerId,ownerId,id);
  if(!input.enabled)return this.disable(ownerId,id,customerId,'CUSTOMER');
  ensure(a.method!=='UNILATERAL_LETTER',409,'OWNER_CHANNEL_AUTH_REQUIRED','单方授权书签署不等于渠道自动签权限，自动用印尚未开放');
  this.enabled();await this.owners.requireSigningMember(customerId,ownerId);
  ensure(a.requestedBy===customerId&&input.scopeHash===a.scopeHash&&ownerScopeHash(a.scope)===a.scopeHash,409,'OWNER_SCOPE_CHANGED','请由确认该范围的企业经办人核对完整授权范围');ensure(input.revision===a.revision,409,'OWNER_AUTH_CHANGED','授权版本已变化，请重新读取');
  const requestedScope=ownerScope.parse(a.scope);if(requestedScope.version===2)ensure(requestedScope.delegates.every(currentOwnerDelegate),409,'OWNER_DELEGATE_SCOPE','被授权主体已变化，请重新办理授权');
  const refreshed=await this.refresh(customerId,ownerId,id);ensure(refreshed.status==='AUTHORIZED',409,'OWNER_AUTH_NOT_READY','法大大尚未确认本次自动签署授权');
  await this.db.serial(async tx=>{
   await this.owners.requireLegalSigningMember(customerId,ownerId,tx);
   const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:{include:{esignAccount:true}}}}),acct=member?.owner.esignAccount;
   ensure(member?.status==='VERIFIED'&&member.owner.status==='VERIFIED'&&acct?.managerCustomerId===customerId&&acct.certStatus==='BOUND'&&acct.certSerialNo===a.certificateSerialNo&&acct.realNameStatus==='VERIFIED'&&acct.checkedAt&&Date.now()-acct.checkedAt.getTime()<86400000,409,'OWNER_NOT_READY','企业身份或经办权限已变化');
   ensure(await tx.ownerSeal.count({where:{id:a.sealId,ownerId,status:'ACTIVE',providerCustomerId:a.providerCustomerId,providerSignatureId:a.providerSignatureId,checkedAt:{gt:new Date(Date.now()-86400000)}}}),409,'OWNER_SEAL_UNAVAILABLE','授权印章已变化');
   const scope=ownerScope.parse(a.scope);ensure(Date.parse(scope.validFrom)<=Date.now()&&Date.now()<Date.parse(scope.validUntil),409,'OWNER_SCOPE_EXPIRED','授权当前不在有效期内');
   if(scope.version===2)ensure(scope.delegates.every(currentOwnerDelegate),409,'OWNER_DELEGATE_SCOPE','被授权主体已变化，请重新办理授权');
   await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true,id:{not:id}},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
   const changed=await tx.ownerAutoAuthority.updateMany({where:{id,revision:refreshed.revision,status:'AUTHORIZED',checkedAt:{gt:new Date(Date.now()-60000)}},data:{enabled:true,enabledAt:new Date(),revision:{increment:1}}});ensure(changed.count===1,409,'OWNER_AUTH_CHANGED','授权状态已变化');await audit(tx,customerId,'OWNER_AUTO_ENABLED','vehicle-owners',ownerId,{authorityId:id,scopeHash:a.scopeHash},'CUSTOMER');
  });return this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}}));
 }
 reviewPlatformScope(actorId:string,ownerId:string,id:string,raw:unknown){return this.platformService().reviewScope(actorId,ownerId,id,raw);}
 platformDocument(actorId:string,ownerId:string,id:string){return this.platformService().adminDocument(actorId,ownerId,id);}
 refreshPlatformScope(actorId:string,ownerId:string,id:string){return this.platformService().adminRefresh(actorId,ownerId,id);}
 private async disable(ownerId:string,id:string,actorId:string,actorType:string){await this.db.serial(async tx=>{if(actorType==='CUSTOMER')await this.owners.requireLegalSigningMember(actorId,ownerId,tx);await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.update({where:{id},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});await audit(tx,actorId,'OWNER_AUTO_DISABLED','vehicle-owners',ownerId,{authorityId:id},actorType);});return this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}}));}
 async pause(actorId:string,ownerId:string,id:string){if(((await this.db.ownerAutoAuthority.findFirst({where:{id,ownerId}}))?.scope as any)?.version===3)return this.platformService().pause(actorId,ownerId,id);const actor=await this.db.adminUser.findUnique({where:{id:actorId}});ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅运营或管理员可暂停');ensure(await this.db.ownerAutoAuthority.count({where:{id,ownerId}}),404,'NOT_FOUND','授权记录不存在');return this.disable(ownerId,id,actorId,'ADMIN');}
 async revoke(customerId:string,ownerId:string,id:string,raw:unknown={}){
  const a=await this.grant(customerId,ownerId,id);
  if((a.scope as any).version===3)return this.platformService().revoke(customerId,ownerId,id,raw);
  if(a.method==='UNILATERAL_LETTER'){await this.letterService().withdraw(customerId,ownerId,id);return this.view(await this.grant(customerId,ownerId,id));}
  // Fadada revocation is account-wide, including when entered through an old grant.
  await this.db.serial(async tx=>{
   await this.owners.requireLegalSigningMember(customerId,ownerId,tx);
   await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});
   const affected=await tx.ownerAutoAuthority.updateMany({where:{ownerId,method:"PROVIDER_AUTO_GRANT",OR:[{providerCustomerId:a.providerCustomerId},{enabled:true}]},data:{enabled:false,status:'REVOKING',disabledAt:new Date(),revision:{increment:1}}});
   await audit(tx,customerId,'OWNER_ACCOUNT_REVOCATION_REQUESTED','vehicle-owners',ownerId,{authorityId:id,disabledGrants:affected.count},'CUSTOMER');
  });
  return{...this.view(await this.db.ownerAutoAuthority.findUniqueOrThrow({where:{id}})),...this.api.createRevocationUrl(a.providerCustomerId)};
 }
 async resume(customerId:string,ownerId:string,id:string){
  if(((await this.grant(customerId,ownerId,id)).scope as any).version===3)return this.platformService().resume(customerId,ownerId,id);
  ensure(newOrderContractMode()!=='ELECTRONIC',409,'V31_INDEPENDENT_GRANT_REQUIRED','请从独立附件三电子授权任务办理');
  ensure(isOwnerH5Request(),403,'OWNER_LEGAL_H5_REQUIRED','请由法人本人从企业车主中心继续签署');
  ensure(ownerAuthorizationEntryEnabled(),503,'OWNER_AUTHORIZATION_DISABLED','企业用印授权办理入口尚未开放');
  const a=await this.grant(customerId,ownerId,id);ensure(a.method==='UNILATERAL_LETTER',404,'OWNER_LETTER_NOT_FOUND','本记录不支持单方授权书继续签署');
  const result=await this.letterService().requestEntry(customerId,ownerId,id);return{...this.view(await this.grant(customerId,ownerId,id)),...result};
 }
 async document(customerId:string,ownerId:string,id:string,variant:'source'|'signed'){if(((await this.grant(customerId,ownerId,id)).scope as any).version===3)return this.platformService().document(customerId,ownerId,id,variant);return this.letterService().document(customerId,ownerId,id,variant);}
}
