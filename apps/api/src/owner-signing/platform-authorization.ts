import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {HttpException} from '@nestjs/common';
import {Db} from '../common/db';
import {audit,key} from '../common/data';
import {canonicalHash as hash} from '../customers/types';
import {ensure} from '../common/errors';
import {OwnerService} from './owner.service';
import {FadadaOwnerClient,isOwnerH5Request} from './fadada-owner.client';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {assertEnterpriseOnboardingAllowed} from '../offline-documents/mode';
import {platformOwnerScope,PLATFORM_SIGNING_GRANTEE} from './platform-scope';
import {currentPlatformScope,platformAuthorizationIdentity,platformProofReady,platformScopeReviewHash,platformSignatureProofMatches} from './platform-authorization-evidence';

const requestInput=z.object({scope:platformOwnerScope,sealId:z.string().min(1),accepted:z.literal(true),idempotencyKey:key}).strict();
const switchInput=z.object({enabled:z.boolean(),revision:z.number().int().nonnegative(),scopeHash:z.string()}).strict();
const revokeInput=z.object({reason:z.string().trim().min(2).max(1000),revision:z.number().int().nonnegative()}).strict();
const reviewInput=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key.optional(),signedSha256:z.string().regex(/^[a-f0-9]{64}$/),granteeName:z.literal(PLATFORM_SIGNING_GRANTEE.name),platformContracts:z.literal(true),dualRepresentation:z.literal(true),accepted:z.literal(true)}).strict();
const closed=(a:any)=>!!a.revokedAt||['REVOKED','REVOKING','SUPERSEDED','INVALIDATED'].includes(a.status);
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function platformAuthorityView(a:any){
 const e=a.platformEvidence;return{id:a.id,ownerId:a.ownerId,sealId:a.sealId,scope:a.scope,scopeHash:a.scopeHash,status:a.status,enabled:a.enabled,revision:a.revision,checkedAt:a.checkedAt,enabledAt:a.enabledAt,disabledAt:a.disabledAt,createdAt:a.createdAt,method:a.method,pausedAt:e?.pausedAt??null,signedAt:e?.signedAt??null,scopeReviewStatus:e?.scopeReviewedAt?'VERIFIED':'PENDING',lastErrorCode:e?.lastErrorCode??null,document:{state:e?.signedFileId?'ARCHIVED':'PENDING',sourceAvailable:false,signedAvailable:!!e?.signedFileId,signedPdfHash:e?.signedSha256??null}};
}
export class PlatformAuthorizationService {
 constructor(private db:Db,private owners:OwnerService,private api:FadadaOwnerClient,private writer:ContractPdfArtifactWriterService){}
 private async operator(id:string){const actor=await this.db.adminUser.findUnique({where:{id}});ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅运营或管理员可核验企业授权');}
 async adminDocument(actorId:string,ownerId:string,id:string){
  await this.operator(actorId);const a:any=await this.db.ownerAutoAuthority.findFirst({where:{id,ownerId,scope:{path:['version'],equals:3}},include:{platformEvidence:true}}),e=a?.platformEvidence;
  ensure(e?.signedFileId&&e.signedSha256,404,'NOT_FOUND','授权文件尚未归档');
  return{buffer:await this.writer.readVerified(e.signedFileId,e.signedSha256),sha256:e.signedSha256,fileName:'企业自动签授权书.pdf'};
 }
 async adminRefresh(actorId:string,ownerId:string,id:string){await this.operator(actorId);const a=await this.db.ownerAutoAuthority.findFirst({where:{id,ownerId,scope:{path:['version'],equals:3}}});ensure(a,404,'NOT_FOUND');return this.refresh(a.requestedBy,ownerId,id);}
 private entry(){assertEnterpriseOnboardingAllowed();ensure(process.env.OWNER_AUTHORIZATION_ENABLED==='true'&&process.env.OWNER_AUTHORIZATION_METHOD==='PROVIDER_AUTO_GRANT'&&process.env.OWNER_AUTHORIZATION_SCOPE_VERSION==='3',503,'PLATFORM_AUTH_DISABLED','企业自动签授权入口尚未开放');}
 private async load(customerId:string,ownerId:string,id:string,tx:any=this.db){
  await requireOwnerLegalRepresentative(tx,customerId,ownerId);
  const a=await tx.ownerAutoAuthority.findFirst({where:{id,ownerId},include:{platformEvidence:true}});
  ensure(a?.scope?.version===3&&a.platformEvidence&&a.method==='PROVIDER_AUTO_GRANT',404,'PLATFORM_AUTH_NOT_FOUND','本企业自动签授权记录不存在');
  ensure(a.requestedBy===customerId,403,'PLATFORM_AUTH_ACTOR','请由本次授权的登记法人本人办理');return a;
 }
 private async current(a:any,tx:any=this.db){
  ensure(hash(await currentPlatformScope(tx,a.ownerId))===a.scopeHash,409,'PLATFORM_AUTH_BINDING_CHANGED','平台或授权应用已变化，请重新办理授权');
  const current=await platformAuthorizationIdentity(tx,a.requestedBy,a.ownerId,a.sealId);
  ensure(hash(current.snapshot)===hash(a.platformEvidence.identitySnapshot)&&a.providerCustomerId===current.account.providerCustomerId&&a.providerSignatureId===current.seal.providerSignatureId&&a.certificateSerialNo===current.account.certSerialNo,409,'PLATFORM_AUTH_IDENTITY_CHANGED','本次授权的企业、法人、证书或印章已变化');return current;
 }
 async request(customerId:string,ownerId:string,raw:unknown){
  this.entry();ensure(isOwnerH5Request(),403,'OWNER_LEGAL_H5_REQUIRED','请由法人本人在原企业服务入口办理授权');const input=requestInput.parse(raw);
  const a=await this.db.serial(async(tx:any)=>{
   await tx.$queryRaw`SELECT "id" FROM "VehicleOwner" WHERE "id"=${ownerId} FOR UPDATE`;
   const current=await platformAuthorizationIdentity(tx,customerId,ownerId,input.sealId),scope=await currentPlatformScope(tx,ownerId),scopeHash=hash(scope);
   ensure(hash(input.scope)===scopeHash,409,'PLATFORM_AUTH_SCOPE_CHANGED','授权主体或应用已变化，请刷新页面');
   const requestHash=hash(input),old=await tx.ownerAutoAuthority.findUnique({where:{ownerId_idempotencyKey:{ownerId,idempotencyKey:input.idempotencyKey}},include:{platformEvidence:true}});
   if(old){ensure(old.requestedBy===customerId&&old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','请求编号已用于不同授权');ensure(!closed(old),409,'PLATFORM_AUTH_CLOSED','本授权已关闭，请查看原记录');return old;}
   const live=await tx.ownerAutoAuthority.findFirst({where:{ownerId,method:'PROVIDER_AUTO_GRANT',scope:{path:['version'],equals:3},status:{notIn:['REVOKED','SUPERSEDED','INVALIDATED']},revokedAt:null},include:{platformEvidence:true},orderBy:{createdAt:'desc'}});
   if(live){
    ensure(live.status!=='REVOKING',409,'PLATFORM_AUTH_REVOCATION_PENDING','请先查询并完成原授权撤销');
    if(live.scopeHash===scopeHash&&hash(live.platformEvidence?.identitySnapshot)===hash(current.snapshot))return live;
    await tx.ownerAutoAuthority.update({where:{id:live.id},data:{enabled:false,status:'SUPERSEDED',disabledAt:new Date(),revision:{increment:1}}});
   }
   await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
   const a=await tx.ownerAutoAuthority.create({data:{ownerId,sealId:current.seal.id,providerCustomerId:current.account.providerCustomerId,providerSignatureId:current.seal.providerSignatureId,certificateSerialNo:current.account.certSerialNo,providerContractId:randomUUID().replaceAll('-',''),providerTransactionId:randomUUID().replaceAll('-',''),requestedBy:customerId,idempotencyKey:input.idempotencyKey,requestHash,scope,scopeHash,method:'PROVIDER_AUTO_GRANT',consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId,ownerId,scopeHash,action:'OPEN_PROVIDER_AUTHORIZATION'},platformEvidence:{create:{identitySnapshot:current.snapshot}}},include:{platformEvidence:true}});
   await audit(tx,customerId,'PLATFORM_AUTH_REQUESTED','vehicle-owners',ownerId,{authorityId:a.id,scopeHash},'CUSTOMER');return a;
  });
  if(a.status==='AUTHORIZED'||a.status==='UNKNOWN'||a.platformEvidence.signedFileId)return platformAuthorityView(a);
  ensure(!closed(a),409,'PLATFORM_AUTH_CLOSED','本授权不能继续办理');
  return{...platformAuthorityView(a),...this.api.createAuthorizationUrl({customerId:a.providerCustomerId,signatureId:a.providerSignatureId,contractId:a.providerContractId,transactionId:a.providerTransactionId})};
 }
 async resume(customerId:string,ownerId:string,id:string){
  this.entry();ensure(isOwnerH5Request(),403,'OWNER_LEGAL_H5_REQUIRED','请在企业服务入口继续办理');
  const a=await this.load(customerId,ownerId,id);ensure(!closed(a)&&!a.platformEvidence.signedFileId,409,'PLATFORM_AUTH_CLOSED','本授权已签署或关闭，请刷新原记录');await this.current(a);
  const checked=await this.refresh(customerId,ownerId,id);ensure(checked.status==='PENDING',409,'PLATFORM_AUTH_QUERY_REQUIRED','请先核对原授权状态');
  return{...checked,...this.api.createAuthorizationUrl({customerId:a.providerCustomerId,signatureId:a.providerSignatureId,contractId:a.providerContractId,transactionId:a.providerTransactionId})};
 }
 async refresh(customerId:string,ownerId:string,id:string){
  const initial=await this.load(customerId,ownerId,id),token=randomUUID(),now=new Date();
  if(initial.revokedAt||['SUPERSEDED','INVALIDATED'].includes(initial.status))return platformAuthorityView(initial);
  const claim=await this.db.ownerPlatformAuthority.updateMany({where:{authorityId:id,OR:[{processingUntil:null},{processingUntil:{lte:now}}]},data:{processingToken:token,processingUntil:new Date(now.getTime()+120000)}});
  ensure(claim.count===1,409,'PLATFORM_AUTH_PROCESSING','授权状态正在刷新，请稍后查看');
  try{
   const proof=await this.api.queryAuthorization({customerId:initial.providerCustomerId,contractId:initial.providerContractId,transactionId:initial.providerTransactionId});
   let archived:any=null;
   if(proof.authorized){
    await this.current(initial);const cert=await this.api.queryCertificate(initial.providerCustomerId);
    ensure(cert.bound&&cert.serialNo===initial.certificateSerialNo&&cert.subjectHash===initial.platformEvidence.identitySnapshot.certificate.subjectHash,409,'OWNER_CERT_CHANGED','原授权证书已变化，请刷新企业状态后重新办理授权');
    if(initial.platformEvidence.signedFileId)await this.writer.readVerified(initial.platformEvidence.signedFileId,initial.platformEvidence.signedSha256);
    else archived=await this.api.signedEvidence(initial);
   }
   return await this.db.serial(async(tx:any)=>{
    await tx.$queryRaw`SELECT "id" FROM "VehicleOwner" WHERE "id"=${ownerId} FOR UPDATE`;
    let a=await this.load(customerId,ownerId,id,tx),e=a.platformEvidence,at=new Date();
    ensure(e.processingToken===token&&e.processingUntil>at&&a.revision===initial.revision,409,'PLATFORM_AUTH_CHANGED','授权状态已变化，请重新刷新');
    if(proof.authorized)await this.current(a,tx);
    if(archived){
     const p=archived.evidence;
     ensure(archived.signedAt instanceof Date&&archived.signedAt<=at&&digest(archived.bytes)===archived.sha256&&platformSignatureProofMatches(a,{...e,signedAt:archived.signedAt,signedSha256:archived.sha256,signatureEvidence:p}),502,'PLATFORM_AUTH_PROOF_INVALID','授权书与原交易证据不匹配');
     const file=await this.writer.persistPdf(archived.bytes,{customerId,name:'企业自动签授权书.pdf',purpose:'owner-authorization'},tx);
     e=await tx.ownerPlatformAuthority.update({where:{authorityId:id},data:{signedFileId:file.id,signedSha256:file.sha256,signedAt:archived.signedAt,signatureEvidence:p}});a={...a,platformEvidence:e};
     await audit(tx,'fadada','PLATFORM_AUTH_ARCHIVED','vehicle-owners',ownerId,{authorityId:id,sha256:file.sha256},'PROVIDER');
    }
    const status=proof.authorized?(a.status==='REVOKING'?'REVOKING':'AUTHORIZED'):(proof.status==='0'?(a.platformEvidence.signedFileId||a.status==='REVOKING'?'REVOKED':'PENDING'):'UNKNOWN');
    const enabled=status==='AUTHORIZED'&&!e.pausedAt&&platformProofReady(a,at),revokedAt=status==='REVOKED'?at:a.revokedAt;
    await tx.ownerPlatformAuthority.update({where:{authorityId:id},data:{providerEvidenceHash:hash(proof),lastErrorCode:null}});
    const updated=await tx.ownerAutoAuthority.update({where:{id},data:{status,enabled,checkedAt:at,revokedAt,enabledAt:enabled?(a.enabledAt??at):a.enabledAt,...(!enabled&&a.enabled?{disabledAt:at}:{}),revision:{increment:1}},include:{platformEvidence:true}});
    return platformAuthorityView(updated);
   });
  }catch(error){
   await this.db.serial(async(tx:any)=>{
    const a=await tx.ownerAutoAuthority.findUnique({where:{id},include:{platformEvidence:true}});
    if(a?.platformEvidence?.processingToken!==token)return;
    const code=error instanceof HttpException?(error.getResponse() as any)?.error?.code:null;
    const changed=['PLATFORM_AUTH_BINDING_CHANGED','PLATFORM_AUTH_IDENTITY_CHANGED','OWNER_CERT_CHANGED','OWNER_MATERIALS_CHANGED'].includes(code);
    if(a.revision===initial.revision)await tx.ownerAutoAuthority.update({where:{id},data:{enabled:false,...(!closed(a)?{status:changed?'INVALIDATED':'UNKNOWN'}:{}),revision:{increment:1}}});
    await tx.ownerPlatformAuthority.update({where:{authorityId:id},data:{lastErrorCode:changed?code:'PLATFORM_AUTH_QUERY_UNCONFIRMED'}});
   });throw error;
  }finally{await this.db.ownerPlatformAuthority.updateMany({where:{authorityId:id,processingToken:token},data:{processingToken:null,processingUntil:null}});}
 }
 async reviewScope(actorId:string,ownerId:string,id:string,raw:unknown){
  const input=reviewInput.parse(raw);
  return this.db.serial(async(tx:any)=>{
   const actor=await tx.adminUser.findUnique({where:{id:actorId}});ensure(actor?.active&&actor.role==='ADMIN',403,'FORBIDDEN','仅管理员可记录渠道授权全文核验');
   await tx.$queryRaw`SELECT "id" FROM "VehicleOwner" WHERE "id"=${ownerId} FOR UPDATE`;
   const a=await tx.ownerAutoAuthority.findFirst({where:{id,ownerId},include:{platformEvidence:true}}),e=a?.platformEvidence;
   ensure(a?.scope?.version===3&&a.revision===input.revision,409,'PLATFORM_AUTH_CHANGED','授权记录已变化');
   ensure(e?.signedFileId&&e.signedSha256===input.signedSha256&&e.signatureEvidence?.verified,409,'PLATFORM_AUTH_FILE_CHANGED','请先核对本次渠道授权全文');
   ensure(a.status==='AUTHORIZED'&&!closed(a)&&a.checkedAt&&Date.now()-a.checkedAt.getTime()<60000,409,'PLATFORM_AUTH_QUERY_REQUIRED','请先刷新当前渠道授权状态');await this.current(a,tx);
   await this.writer.readVerified(e.signedFileId,e.signedSha256);const at=new Date(),scopeReviewHash=platformScopeReviewHash(a,actorId,at);
   await tx.ownerPlatformAuthority.update({where:{authorityId:id},data:{scopeReviewedBy:actorId,scopeReviewedAt:at,scopeReviewHash}});
   const updated=await tx.ownerAutoAuthority.update({where:{id},data:{enabled:!e.pausedAt,enabledAt:e.pausedAt?a.enabledAt:at,revision:{increment:1}},include:{platformEvidence:true}});
   ensure(platformProofReady(updated,at),409,'PLATFORM_AUTH_PROOF_INVALID','授权证据核验不完整');
   await audit(tx,actorId,'PLATFORM_AUTH_SCOPE_REVIEWED','vehicle-owners',ownerId,{authorityId:id,signedSha256:e.signedSha256,scopeReviewHash,platformContracts:true,dualRepresentation:true});return platformAuthorityView(updated);
  });
 }
 async setEnabled(customerId:string,ownerId:string,id:string,raw:unknown){
  const input=switchInput.parse(raw),a=await this.load(customerId,ownerId,id);
  ensure(a.revision===input.revision&&a.scopeHash===input.scopeHash,409,'PLATFORM_AUTH_CHANGED','授权记录已变化，请刷新');
  if(!input.enabled)return this.pause(customerId,ownerId,id,'CUSTOMER',input.revision);
  const refreshed=await this.refresh(customerId,ownerId,id);
  return this.db.serial(async(tx:any)=>{
   await tx.$queryRaw`SELECT "id" FROM "VehicleOwner" WHERE "id"=${ownerId} FOR UPDATE`;
   const a=await this.load(customerId,ownerId,id,tx);ensure(a.revision===refreshed.revision&&!closed(a)&&a.status==='AUTHORIZED'&&platformProofReady(a),409,'PLATFORM_AUTH_NOT_READY','本次授权尚不可恢复');await this.current(a,tx);
   await tx.ownerPlatformAuthority.update({where:{authorityId:id},data:{pausedAt:null}});
   const updated=await tx.ownerAutoAuthority.update({where:{id},data:{enabled:true,enabledAt:new Date(),revision:{increment:1}},include:{platformEvidence:true}});
   await audit(tx,customerId,'PLATFORM_AUTH_RESUMED','vehicle-owners',ownerId,{authorityId:id},'CUSTOMER');return platformAuthorityView(updated);
  });
 }
 async pause(actorId:string,ownerId:string,id:string,actorType='ADMIN',revision?:number){
  return this.db.serial(async(tx:any)=>{
   if(actorType==='ADMIN'){const actor=await tx.adminUser.findUnique({where:{id:actorId}});ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN');}else await this.load(actorId,ownerId,id,tx);
   await tx.$queryRaw`SELECT "id" FROM "VehicleOwner" WHERE "id"=${ownerId} FOR UPDATE`;
   const a=await tx.ownerAutoAuthority.findFirst({where:{id,ownerId},include:{platformEvidence:true}});ensure(a?.platformEvidence&&(revision===undefined||revision===a.revision),409,'PLATFORM_AUTH_CHANGED','授权记录已变化');
   await tx.ownerPlatformAuthority.update({where:{authorityId:id},data:{pausedAt:new Date()}});
   const updated=await tx.ownerAutoAuthority.update({where:{id},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}},include:{platformEvidence:true}});
   await audit(tx,actorId,'PLATFORM_AUTH_PAUSED','vehicle-owners',ownerId,{authorityId:id},actorType);return platformAuthorityView(updated);
  });
 }
 async revoke(customerId:string,ownerId:string,id:string,raw:unknown){
  const input=revokeInput.parse(raw),a=await this.load(customerId,ownerId,id);
  await this.db.serial(async(tx:any)=>{
   await tx.$queryRaw`SELECT "id" FROM "VehicleOwner" WHERE "id"=${ownerId} FOR UPDATE`;
   const current=await this.load(customerId,ownerId,id,tx);ensure(current.revision===input.revision,409,'PLATFORM_AUTH_CHANGED','授权记录已变化');
   const where={ownerId,method:'PROVIDER_AUTO_GRANT',providerCustomerId:a.providerCustomerId,revokedAt:null},at=new Date();
   await tx.ownerPlatformAuthority.updateMany({where:{authority:where},data:{pausedAt:at,revokeReason:input.reason}});
   await tx.ownerAutoAuthority.updateMany({where,data:{enabled:false,status:'REVOKING',disabledAt:at,revision:{increment:1}}});
   await audit(tx,customerId,'PLATFORM_AUTH_REVOCATION_REQUESTED','vehicle-owners',ownerId,{authorityId:id,reason:input.reason},'CUSTOMER');
  });
  return{...platformAuthorityView(await this.load(customerId,ownerId,id)),...this.api.createRevocationUrl(a.providerCustomerId)};
 }
 async document(customerId:string,ownerId:string,id:string,variant:'source'|'signed'){
  const a=await this.load(customerId,ownerId,id),e=a.platformEvidence;
  ensure(variant==='signed'&&e.signedFileId&&e.signedSha256,404,'PLATFORM_AUTH_FILE_PENDING','授权书尚未签署归档');
  return{buffer:await this.writer.readVerified(e.signedFileId,e.signedSha256),sha256:e.signedSha256,fileName:'企业自动签授权书.pdf'};
 }
}
