import {assertOrdinaryStaffReview} from '../auth/ordinary-review';
import {createCipheriv,createHmac,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,mobile} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {requirePartnerCapability,getPartnerCapabilities} from './capabilities';
import type {PartnerActor} from './types';
const command={revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128)},reason=z.string().trim().min(1).max(500),candidateId=z.string().min(1).max(128);
const saveInput=z.object({...command,displayName:z.string().trim().min(1).max(100),mobile,reason}).strict();
const submitInput=z.object({...command,candidateId}).strict();
const reviewInput=z.object({...command,candidateId,decision:z.enum(['APPROVE','REJECT']),reason}).strict();
const disableInput=z.object({...command,reason}).strict();
function secret(){const value=process.env.SESSION_SECRET||'';ensure(value.length>=32,503,'PORTAL_UNAVAILABLE','查看授权配置尚未完成');return value;}
export function portalMobileHash(value:string){return createHmac('sha256',secret()).update('partner-portal:mobile:'+mobile.parse(value)).digest('hex');}
export function protectedPortalMobile(value:string){
 const mobileHash=portalMobileHash(value),key=createHmac('sha256',secret()).update('partner-portal:encryption:v1').digest(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return{mobileHash,mobileCiphertext:['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.'),maskedMobile:value.slice(0,3)+'****'+value.slice(-4)};
}
export class PortalAccessService{
 constructor(private db:Db){}
 async get(actor:PartnerActor,ownerId:string){await requirePartnerCapability(this.db,actor,'partner.portal.read');ensure(await this.db.vehicleOwner.findUnique({where:{id:ownerId}}),404,'NOT_FOUND','合作商不存在');return this.dto(this.db,actor,ownerId);}
 private async dto(tx:any,actor:PartnerActor,ownerId:string){
  const row=await tx.partnerPortalAccess.findUnique({where:{ownerId}}),latest=row&&await tx.partnerPortalCandidate.findFirst({where:{accessId:row.id},orderBy:{createdAt:'desc'}}),candidate=latest&&latest.status!=='APPROVED'?latest:null,staff=await tx.adminUser.findUnique({where:{id:actor.id}}),caps=getPartnerCapabilities(staff);
  const allowedActions=[];if(caps.includes('partner.portal.write')){if(!candidate||candidate.status!=='SUBMITTED')allowedActions.push('SAVE');if(candidate?.status==='DRAFT')allowedActions.push('SUBMIT');}if(candidate?.status==='SUBMITTED'&&caps.includes('partner.portal.review'))allowedActions.push('REVIEW');if(row?.status==='ENABLED'&&caps.includes('partner.portal.disable'))allowedActions.push('DISABLE');
  return{ownerId,revision:row?.revision||0,current:row?.accessVersion?{id:row.id,accessVersion:row.accessVersion,status:row.status,displayName:row.displayName,maskedMobile:row.maskedMobile,reviewedBy:row.reviewedBy,reviewedAt:row.reviewedAt,lastLoginAt:row.lastLoginAt,disabledAt:row.disabledAt}:null,candidate:candidate?{id:candidate.id,revision:candidate.revision,status:candidate.status,displayName:candidate.displayName,maskedMobile:candidate.maskedMobile,createdBy:candidate.createdBy,submittedBy:candidate.submittedBy,reviewReason:candidate.reviewReason}:null,allowedActions};
 }
 private async run(actor:PartnerActor,ownerId:string,action:string,capability:string,input:any,operation:(tx:any,row:any)=>Promise<void>){
  return this.db.serial(async tx=>{
   await requirePartnerCapability(tx,actor,capability);
   // Owner lock serializes initial creation too, without altering its business revision.
   await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;
   ensure(await tx.vehicleOwner.findUnique({where:{id:ownerId}}),404,'NOT_FOUND','合作商不存在');
   const existing=await (tx as any).partnerPortalAccess.findUnique({where:{ownerId}});
   ensure(existing?.bindingMethod!=='INVITATION'&&!await (tx as any).partnerPortalInvitation.count({where:{ownerId}}),409,'PARTNER_PORTAL_LEGACY_READONLY','此公司已使用本人邀请码绑定，请通过公司管理员入口办理');
   return archiveCommand(tx,actor,`partner-portal:${ownerId}`,action,input,async()=>{
    let row=await (tx as any).partnerPortalAccess.findUnique({where:{ownerId}});
    ensure((row?.revision||0)===input.revision,409,'REVISION_CONFLICT','查看授权已变化，请刷新');
    if(!row)row=await (tx as any).partnerPortalAccess.create({data:{ownerId}});
    await operation(tx,row);
    await (tx as any).partnerPortalAccess.update({where:{id:row.id},data:{revision:{increment:1}}});
    await audit(tx,actor.id,'PARTNER_PORTAL_'+action,'partners',ownerId,{accessId:row.id,revision:input.revision+1});
    return this.dto(tx,actor,ownerId);
   });
  });
 }
 save(actor:PartnerActor,ownerId:string,raw:unknown){const input=saveInput.parse(raw);return this.run(actor,ownerId,'SAVE','partner.portal.write',input,async(tx,row)=>{
  const pending=await tx.partnerPortalCandidate.findFirst({where:{accessId:row.id,status:{in:['DRAFT','SUBMITTED']}}});
  ensure(pending?.status!=='SUBMITTED',409,'PORTAL_CANDIDATE_FROZEN','已提交的候选不可修改');
  const data={displayName:input.displayName,...protectedPortalMobile(input.mobile),reason:input.reason};
  if(pending)await tx.partnerPortalCandidate.update({where:{id:pending.id},data:{...data,editedByIds:[...new Set([...(pending.editedByIds||[]),pending.createdBy,actor.id])],revision:{increment:1}}});else await tx.partnerPortalCandidate.create({data:{...data,accessId:row.id,ownerId,createdBy:actor.id,editedByIds:[actor.id]}});
 });}
 submit(actor:PartnerActor,ownerId:string,raw:unknown){const input=submitInput.parse(raw);return this.run(actor,ownerId,'SUBMIT','partner.portal.write',input,async(tx,row)=>{
  const candidate=await tx.partnerPortalCandidate.findUnique({where:{id:input.candidateId}});ensure(candidate?.accessId===row.id&&candidate.status==='DRAFT',409,'REVISION_CONFLICT','候选资料已变化');
  await tx.partnerPortalCandidate.update({where:{id:candidate.id},data:{status:'SUBMITTED',submittedBy:actor.id,revision:{increment:1}}});
 });}
 review(actor:PartnerActor,ownerId:string,raw:unknown){const input=reviewInput.parse(raw);return this.run(actor,ownerId,'REVIEW','partner.portal.review',input,async(tx,row)=>{
  const candidate=await tx.partnerPortalCandidate.findUnique({where:{id:input.candidateId}});ensure(candidate?.accessId===row.id&&candidate.status==='SUBMITTED',409,'REVISION_CONFLICT','待复核候选已变化');
  await assertOrdinaryStaffReview(tx,actor,[candidate.createdBy,candidate.submittedBy,...(candidate.editedByIds||[])],'PARTNER_SELF_REVIEW');const reviewedAt=new Date();
  await tx.partnerPortalCandidate.update({where:{id:candidate.id},data:{status:input.decision==='APPROVE'?'APPROVED':'REJECTED',reviewedBy:actor.id,reviewedAt,reviewReason:input.reason,revision:{increment:1}}});
  if(input.decision==='APPROVE')await tx.partnerPortalAccess.update({where:{id:row.id},data:{status:'ENABLED',accessVersion:{increment:1},displayName:candidate.displayName,mobileHash:candidate.mobileHash,mobileCiphertext:candidate.mobileCiphertext,maskedMobile:candidate.maskedMobile,reviewedBy:actor.id,reviewedAt,lastLoginAt:null,disabledAt:null}});
 });}
 disable(actor:PartnerActor,ownerId:string,raw:unknown){const input=disableInput.parse(raw);return this.run(actor,ownerId,'DISABLE','partner.portal.disable',input,async(tx,row)=>{
  ensure(row.status==='ENABLED'&&row.accessVersion>0,409,'PORTAL_NOT_ENABLED','当前查看授权未启用');
  await tx.partnerPortalAccess.update({where:{id:row.id},data:{status:'DISABLED',accessVersion:{increment:1},disabledAt:new Date()}});
  await audit(tx,actor.id,'PARTNER_PORTAL_DISABLED','partners',ownerId,{reason:input.reason,accessVersion:row.accessVersion+1});
 });}
}
