import {createHmac,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,mobile} from '../common/data';
import {ensure} from '../common/errors';
import {token,tokenHash} from '../auth/auth.service';
import {consentInput,currentDocuments} from '../auth/consents';
import {archiveCommand} from '../offline-documents/command';
import {portalMobileHash,protectedPortalMobile} from './portal-access';
import {validPartnerScopes,validPortalGrants} from './portal-session';
import {requireSimplePartnerOperator} from './simple-access';
import {ownerH5EntryUrl} from '../common/platform-origins';
import type {PartnerActor} from './types';

const command={revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128)};
const inviteInput=z.object({...command,mobile,displayName:z.string().trim().max(100).optional().default('')}).strict();
const disableInput=z.object({...command}).strict();
const previewInput=z.object({mobile,invitationCode:z.string().regex(/^[A-Za-z0-9_-]{24}(?:[A-Za-z0-9_-]{19})?$/)}).strict();
const confirmInput=z.object({previewToken:z.string().regex(/^[a-f0-9]{64}$/),consents:consentInput}).strict();
const invitationLifetime=7*86400000,previewLifetime=10*60000,attemptWindow=15*60000;
function unavailable(value:unknown):asserts value {ensure(value,401,'INVITATION_UNAVAILABLE','邀请码无效或已失效，请核对手机号及邀请码或联系运营重新生成');}
function invitationHash(code:string){return tokenHash('partner-portal:invitation:'+code);}
function previewHash(value:string){return tokenHash('partner-portal:preview:'+value);}
function requestIpHash(ip?:string){
 if(!ip)return null;
 const secret=process.env.SESSION_SECRET||'';ensure(secret.length>=32,503,'PORTAL_UNAVAILABLE','查看授权配置尚未完成');
 return createHmac('sha256',secret).update('partner-portal:invitation-ip:'+ip.slice(0,200)).digest('hex');
}

export class CompanyAdminService {
 constructor(private db:Db){}
 async get(actor:PartnerActor,ownerId:string){return this.db.serial(async(tx:any)=>{await requireSimplePartnerOperator(tx,actor);await this.owner(tx,ownerId);return this.dto(tx,ownerId);});}
 private async owner(tx:any,ownerId:string){const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});ensure(owner,404,'NOT_FOUND','合作商不存在');return owner;}
 private async dto(tx:any,ownerId:string){
  const row=await tx.partnerPortalAccess.findUnique({where:{ownerId}}),latest=row&&await tx.partnerPortalInvitation.findFirst({where:{accessId:row.id},orderBy:{accessVersion:'desc'}});
  const bound=row&&(await validPortalGrants(tx,[row])).length>0;
  const status: 'UNSET'|'PENDING'|'BOUND'|'DISABLED'=!row?.mobileHash?'UNSET':bound?'BOUND':row.status==='PENDING'?'PENDING':'DISABLED';
  return{ownerId,revision:row?.revision||0,status,entryUrl:ownerH5EntryUrl(),current:row?.mobileHash?{id:row.id,accessVersion:row.accessVersion,displayName:row.displayName,maskedMobile:row.maskedMobile,bindingMethod:row.bindingMethod||(bound?'REVIEWED':null),boundAt:row.boundAt,lastLoginAt:row.lastLoginAt,disabledAt:row.disabledAt}:null,invitation:latest?{id:latest.id,status:latest.status==='PENDING'&&latest.expiresAt<=new Date()?'EXPIRED':latest.status,expiresAt:latest.expiresAt}:null,allowedActions:status==='UNSET'||status==='DISABLED'?['INVITE']:['INVITE','DISABLE']};
 }
 private async revoke(tx:any,row:any){
  await tx.partnerPortalInvitation.updateMany({where:{accessId:row.id,status:{in:['PENDING','BOUND']}},data:{status:'REVOKED',previewTokenHash:null,previewExpiresAt:null}});
  await tx.partnerPortalCandidate.updateMany({where:{accessId:row.id,status:{in:['DRAFT','SUBMITTED']}},data:{status:'SUPERSEDED',revision:{increment:1}}});
  // A revoked scope cannot be reintroduced by an OTP issued before this change.
  if(row.mobileHash)await tx.partnerPortalChallenge.updateMany({where:{mobileHash:row.mobileHash,status:{in:['SENDING','PENDING','VERIFYING']}},data:{status:'REJECTED',consumedAt:new Date()}});
 }
 async invite(actor:PartnerActor,ownerId:string,raw:unknown){
  const input=inviteInput.parse(raw);
  return this.db.serial(async(tx:any)=>{
   await requireSimplePartnerOperator(tx,actor);await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;
   const owner=await this.owner(tx,ownerId);ensure(owner.status!=='SUSPENDED',409,'PARTNER_DISABLED','合作商已停用');
   // Kept outside the persisted command result; a retry never recovers an old secret.
   let invitationCode:string|undefined;
   const result=await archiveCommand(tx,actor,`partner-company-admin:${ownerId}`,'INVITE',input,async()=>{
    let row=await tx.partnerPortalAccess.findUnique({where:{ownerId}});ensure((row?.revision||0)===input.revision,409,'REVISION_CONFLICT','公司管理员已变化，请刷新');
    if(!row)row=await tx.partnerPortalAccess.create({data:{ownerId}});
    await this.revoke(tx,row);invitationCode=randomBytes(18).toString('base64url');
    const accessVersion=row.accessVersion+1,protectedMobile=protectedPortalMobile(input.mobile),expiresAt=new Date(Date.now()+invitationLifetime);
    await tx.partnerPortalAccess.update({where:{id:row.id},data:{...protectedMobile,displayName:input.displayName,status:'PENDING',accessVersion,revision:{increment:1},bindingMethod:'INVITATION',boundAt:null,boundInvitationId:null,reviewedBy:null,reviewedAt:null,lastLoginAt:null,disabledAt:null}});
    const invitation=await tx.partnerPortalInvitation.create({data:{accessId:row.id,ownerId,mobileHash:protectedMobile.mobileHash,codeHash:invitationHash(invitationCode),status:'PENDING',accessVersion,expiresAt,createdBy:actor.id}});
    await audit(tx,actor.id,'PARTNER_COMPANY_ADMIN_INVITED','partners',ownerId,{accessId:row.id,invitationId:invitation.id,accessVersion,revision:input.revision+1});
    return this.dto(tx,ownerId);
   });
   return{...result,...(invitationCode?{invitationCode}:{requiresRegeneration:true})};
  });
 }
 async disable(actor:PartnerActor,ownerId:string,raw:unknown){
  const input=disableInput.parse(raw);
  return this.db.serial(async(tx:any)=>{
   await requireSimplePartnerOperator(tx,actor);await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;await this.owner(tx,ownerId);
   return archiveCommand(tx,actor,`partner-company-admin:${ownerId}`,'DISABLE',input,async()=>{
    const row=await tx.partnerPortalAccess.findUnique({where:{ownerId}});ensure(row&&row.revision===input.revision,409,'REVISION_CONFLICT','公司管理员已变化，请刷新');
    ensure(['PENDING','ENABLED'].includes(row.status),409,'PORTAL_NOT_ENABLED','当前公司管理员已停用');await this.revoke(tx,row);
    await tx.partnerPortalAccess.update({where:{id:row.id},data:{status:'DISABLED',accessVersion:{increment:1},revision:{increment:1},disabledAt:new Date()}});
    await audit(tx,actor.id,'PARTNER_COMPANY_ADMIN_DISABLED','partners',ownerId,{accessId:row.id,accessVersion:row.accessVersion+1,revision:input.revision+1});return this.dto(tx,ownerId);
   });
  });
 }
 private async attempt(mobileHash:string,codeHash:string,ip?:string){
  const ipHash=requestIpHash(ip),now=new Date(),since=new Date(now.getTime()-attemptWindow);
  const limited=await this.db.serial(async(tx:any)=>{
   // Stable order avoids deadlock where a shared phone and shared IP overlap.
   for(const key of [mobileHash,codeHash,...(ipHash?[ipHash]:[])].sort())await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
   const phoneCount=await tx.partnerPortalInvitationAttempt.count({where:{mobileHash,createdAt:{gt:since}}}),codeCount=await tx.partnerPortalInvitationAttempt.count({where:{codeHash,createdAt:{gt:since}}}),ipCount=ipHash?await tx.partnerPortalInvitationAttempt.count({where:{ipHash,createdAt:{gt:since}}}):0;
   if(phoneCount>=10||codeCount>=10||ipCount>=60)return true;
   await tx.partnerPortalInvitationAttempt.create({data:{mobileHash,codeHash,ipHash}});return false;
  });
  ensure(!limited,429,'INVITATION_RATE_LIMITED','尝试次数过多，请稍后再试');
 }
 async preview(raw:unknown,ip?:string,legalPreview?:(input:{mobile:string;invitationCode:string})=>Promise<any>){
  const input=previewInput.parse(raw),mobileHash=portalMobileHash(input.mobile),codeHash=invitationHash(input.invitationCode);await this.attempt(mobileHash,codeHash,ip);
  const legal=await legalPreview?.(input);if(legal)return legal;
  const previewToken=token();
  return this.db.serial(async(tx:any)=>{
   const found=await tx.partnerPortalInvitation.findUnique({where:{codeHash}});unavailable(found);
   await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${found.ownerId} FOR UPDATE`;
   const invitation=await tx.partnerPortalInvitation.findUnique({where:{id:found.id}}),access=await tx.partnerPortalAccess.findUnique({where:{id:found.accessId}}),owner=await tx.vehicleOwner.findUnique({where:{id:found.ownerId}}),now=new Date();
   unavailable(invitation?.status==='PENDING'&&invitation.mobileHash===mobileHash&&invitation.expiresAt>now&&access?.status==='PENDING'&&access.ownerId===invitation.ownerId&&access.mobileHash===mobileHash&&access.accessVersion===invitation.accessVersion&&owner&&owner.status!=='SUSPENDED');
   const expiresAt=new Date(Math.min(now.getTime()+previewLifetime,invitation.expiresAt.getTime()));
   await tx.partnerPortalInvitation.update({where:{id:invitation.id},data:{previewTokenHash:previewHash(previewToken),previewExpiresAt:expiresAt}});
   return{previewToken,companyName:owner.name,ownerId:owner.id,maskedMobile:access.maskedMobile,expiresAt};
  });
 }
 async confirm(raw:unknown,previousCookie?:string){
  const input=confirmInput.parse(raw),previewTokenHash=previewHash(input.previewToken),rawToken=token(),csrfToken=token(),expiresAt=new Date(Date.now()+8*3600000);
  const session=await this.db.serial(async(tx:any)=>{
   const found=await tx.partnerPortalInvitation.findUnique({where:{previewTokenHash}});unavailable(found);
   await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${found.ownerId} FOR UPDATE`;
   const invitation=await tx.partnerPortalInvitation.findUnique({where:{id:found.id}}),access=await tx.partnerPortalAccess.findUnique({where:{id:found.accessId}}),owner=await tx.vehicleOwner.findUnique({where:{id:found.ownerId}}),now=new Date();
   ensure(invitation?.status!=='BOUND',409,'INVITATION_ALREADY_BOUND','邀请码已绑定，请使用手机号和短信验证码登录');
   unavailable(invitation?.status==='PENDING'&&invitation.previewTokenHash===previewTokenHash&&invitation.previewExpiresAt&&invitation.previewExpiresAt>now&&invitation.expiresAt>now&&access?.status==='PENDING'&&access.ownerId===invitation.ownerId&&access.mobileHash===invitation.mobileHash&&access.accessVersion===invitation.accessVersion&&owner&&owner.status!=='SUSPENDED');
   const docs=await currentDocuments(tx,['terms','privacy']);for(const doc of docs)ensure(input.consents.some(c=>c.documentId===doc.id&&c.version===doc.version),409,'CONSENT_VERSION','请阅读并同意当前用户协议及隐私政策');
   const prior=typeof previousCookie==='string'&&/^[a-f0-9]{64}$/.test(previousCookie)?await tx.partnerPortalSession.findUnique({where:{id:tokenHash(previousCookie)}}):null;
   const existing=prior?.mode==='PARTNER_READONLY'&&prior.expiresAt>now&&prior.mobileHash===invitation.mobileHash?await validPartnerScopes(tx,prior):[];
   await tx.partnerPortalInvitation.update({where:{id:invitation.id},data:{status:'BOUND',boundAt:now}});
   await tx.partnerPortalAccess.update({where:{id:access.id},data:{status:'ENABLED',bindingMethod:'INVITATION',boundAt:now,boundInvitationId:invitation.id,lastLoginAt:now,revision:{increment:1}}});
   const scopeSnapshot=[...existing.filter(s=>s.ownerId!==invitation.ownerId),{accessId:access.id,ownerId:invitation.ownerId,accessVersion:invitation.accessVersion}].sort((a,b)=>a.ownerId.localeCompare(b.ownerId));
   if(prior)await tx.partnerPortalSession.deleteMany({where:{id:prior.id}});
   if(previousCookie)await tx.ownerH5Session.deleteMany({where:{id:tokenHash(previousCookie)}});
   const created=await tx.partnerPortalSession.create({data:{id:tokenHash(rawToken),mode:'PARTNER_READONLY',mobileHash:invitation.mobileHash,maskedMobile:access.maskedMobile,scopeSnapshot,csrfToken,expiresAt,consentSnapshot:docs.map(doc=>({documentId:doc.id,type:doc.type,version:doc.version,acceptedAt:now.toISOString(),source:'PARTNER_PORTAL_INVITATION'}))}});
   await audit(tx,created.id,'PARTNER_COMPANY_ADMIN_BOUND','partners',invitation.ownerId,{accessId:access.id,invitationId:invitation.id,accessVersion:invitation.accessVersion},'PARTNER_PORTAL');return created;
  });
  return{session,rawToken};
 }
}
