import {changeIdentityMaterials} from '../owner-signing/identity-materials';
import {createHmac} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,mobile} from '../common/data';
import {ensure} from '../common/errors';
import {tokenHash} from '../auth/auth.service';
import {ownerInvitationToken} from '../owner-signing/invitation-token';
import {newOrderContractMode} from '../offline-documents/mode';
import {partnerLoginEligibility} from './offline-access';
import {assertNotAssetFiles} from '../files/asset-files';
import {virtualActorScope} from '../virtual-acceptance/actors';
export {ownerInvitationToken} from '../owner-signing/invitation-token';

type Database=Db|Prisma.TransactionClient;
export function ownerMobileHash(value:string){
 const secret=process.env.SESSION_SECRET;
 ensure(secret&&secret.length>=32,503,'OWNER_KEY_MISSING','企业邀请校验配置未就绪');
 return createHmac('sha256',secret).update('owner-invitation:'+mobile.parse(value)).digest('hex');
}
const masked=(value:string)=>value.slice(0,3)+'****'+value.slice(-4);

export async function requireOwnerLegalRepresentative(db:Database,customerId:string,ownerId:string){
 const member=await db.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{customer:true,owner:{include:{legalRepresentative:true,esignAccount:true}}}});
 const profile=member?.owner.legalRepresentative;
 ensure(member&&member.status!=='SUSPENDED'&&member.owner.status!=='SUSPENDED'&&profile&&profile.mobileHash===ownerMobileHash(member.customer.mobile),
  403,'OWNER_LEGAL_REQUIRED','请使用当前登记法人本人的手机号登录，或联系运营核对法人资料');
 return{profile,member,customer:member.customer,owner:member.owner};
}

// This check is intentionally repeated after OTP consumption, inside the login
// transaction. Neither a Customer row nor an invitation alone proves legal status.
export async function ownerLegalLoginEligibility(db:Database,value:string,invitationToken?:string){
 const customer=await db.customer.findUnique({where:{mobile:value}}),mobileHash=ownerMobileHash(value);
 const scoped=customer?await virtualActorScope(db,customer.id,{current:false}):null,scopedOwnerId=scoped?.ownerActorCustomerId===customer?.id?scoped?.ownerId:scoped?.platformActorCustomerId===customer?.id?scoped?.platformId:null;
 if(newOrderContractMode()==='OFFLINE'&&!scopedOwnerId)return partnerLoginEligibility(db,value);
 if(invitationToken!==undefined){
  const invite=await db.ownerInvitation.findUnique({where:{tokenHash:tokenHash(invitationToken)},include:{owner:{include:{legalRepresentative:true}}}});
  const profile=invite?.owner.legalRepresentative;
  if(!invite||(newOrderContractMode()==='OFFLINE'&&invite.ownerId!==scopedOwnerId)||invite.revokedAt||invite.expiresAt<=new Date()||invite.mobileHash!==mobileHash||invite.owner.status==='SUSPENDED'||
   !profile||profile.mobileHash!==mobileHash||(invite.claimedBy&&invite.claimedBy!==customer?.id))return null;
  const member=customer?await db.ownerMember.findUnique({where:{ownerId_customerId:{ownerId:invite.ownerId,customerId:customer.id}}}):null;
  if(member?.status==='SUSPENDED'||(invite.claimedBy&&!member))return null;
  return{customer,invite,choices:[{ownerId:invite.ownerId,revision:profile.revision,ownerRevision:invite.owner.revision}]};
 }
 if(!customer)return null;
 const members=await db.ownerMember.findMany({where:{customerId:customer.id,status:{not:'SUSPENDED'},owner:{status:{not:'SUSPENDED'},legalRepresentative:{is:{mobileHash}}}},include:{owner:{include:{legalRepresentative:true}}}});
 if(!members.length)return null;
 return{customer,invite:null,choices:members.filter(member=>newOrderContractMode()!=='OFFLINE'||member.ownerId===scopedOwnerId).map(member=>({ownerId:member.ownerId,revision:member.owner.legalRepresentative!.revision,ownerRevision:member.owner.revision}))};
}

export async function claimOwnerLegalInvitation(db:Db,customerId:string,raw:unknown,expectedOwnerId?:string){
 const input=z.object({token:ownerInvitationToken}).strict().parse(raw);
 return db.serial(async tx=>{
  if(expectedOwnerId)ensure(await virtualActorScope(tx,customerId,{ownerId:expectedOwnerId}),403,'VIRTUAL_OWNER_REQUIRED','请使用本次指定企业账户');
  const customer=await tx.customer.findUnique({where:{id:customerId}});
  ensure(customer,401,'UNAUTHENTICATED','请登录法人中心');
  const eligible=await ownerLegalLoginEligibility(tx,customer.mobile,input.token);
  ensure(eligible?.invite&&eligible.customer?.id===customerId,403,'OWNER_LEGAL_REQUIRED','邀请或法人资料不可用，请联系运营核对');
  ensure(!expectedOwnerId||eligible.invite.ownerId===expectedOwnerId,403,'VIRTUAL_OWNER_REQUIRED','邀请不属于本次指定企业');
  return claimEligibleOwnerInvitation(tx,customerId,eligible.invite);
 });
}

export async function claimEligibleOwnerInvitation(db:Database,customerId:string,invite:{id:string;ownerId:string;claimedBy:string|null}){
 const existing=await db.ownerMember.findUnique({where:{ownerId_customerId:{ownerId:invite.ownerId,customerId}}});
 ensure(existing?.status!=='SUSPENDED',403,'OWNER_MEMBER_SUSPENDED','企业成员权限已停用');
 // Login auto-claims share this transaction boundary with the explicit claim.
 // Historical membership recovery writes nothing; a fresh invitation still does.
 if(newOrderContractMode()==='OFFLINE'&&(!existing||!invite.claimedBy))
  ensure(await virtualActorScope(db,customerId,{ownerId:invite.ownerId}),403,'VIRTUAL_OWNER_REQUIRED','请使用本次指定企业账户');
 const member=existing||await db.ownerMember.create({data:{ownerId:invite.ownerId,customerId}});
 if(!invite.claimedBy){
  const claimed=await db.ownerInvitation.updateMany({where:{id:invite.id,claimedBy:null,revokedAt:null,expiresAt:{gt:new Date()}},data:{claimedBy:customerId,claimedAt:new Date()}});
  ensure(claimed.count===1,409,'OWNER_INVITATION_CHANGED','邀请已失效，请联系运营重新邀请');
  await audit(db,customerId,'OWNER_INVITATION_CLAIMED','vehicle-owners',invite.ownerId,{invitationId:invite.id},'CUSTOMER');
 }else ensure(invite.claimedBy===customerId,409,'OWNER_INVITATION_USED','邀请已使用');
 return{ownerId:invite.ownerId,memberStatus:member.status};
}

const profileInput=z.object({
 name:z.string().trim().min(2).max(100),mobile,evidenceFileId:z.string().min(1),
 revision:z.number().int().min(0),accepted:z.literal(true)
}).strict();
export async function setOwnerLegalRepresentative(db:Db,actorId:string,ownerId:string,raw:unknown){
 const input=profileInput.parse(raw);
 return db.serial(async tx=>{
  const actor=await tx.adminUser.findUnique({where:{id:actorId}});
  ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅运营或管理员可核验法人资料');
  const owner=await tx.vehicleOwner.findUnique({where:{id:ownerId},include:{legalRepresentative:true,esignAccount:true}});
  ensure(owner&&owner.status!=='SUSPENDED',404,'NOT_FOUND','企业档案不可用');
  ensure((owner as any).subjectType!=='INDIVIDUAL',409,'PARTNER_SUBJECT_INDIVIDUAL','个人合作商请使用本人身份核验，不登记企业法人');
  await assertNotAssetFiles(tx,[input.evidenceFileId]);
  const file=await tx.storedFile.findUnique({where:{id:input.evidenceFileId}});
  ensure(file&&file.adminId&&!file.customerId&&file.purpose==='evidence'&&['application/pdf','image/jpeg','image/png'].includes(file.mimeType)&&/^[a-f0-9]{64}$/.test(file.sha256),
   409,'OWNER_LEGAL_EVIDENCE_REQUIRED','请上传并核验企业营业执照凭据');
  const previous=owner.legalRepresentative;
  ensure((previous?.revision||0)===input.revision,409,'REVISION_CONFLICT','法人档案已变化，请重新读取');
  const data={name:input.name,mobileHash:ownerMobileHash(input.mobile),maskedMobile:masked(input.mobile),evidenceHash:file.sha256,updatedBy:actorId};
  if(previous&&previous.name===data.name&&previous.mobileHash===data.mobileHash&&previous.evidenceHash===data.evidenceHash)return{ownerId,name:previous.name,maskedMobile:previous.maskedMobile,evidenceHash:previous.evidenceHash,revision:previous.revision};
  await changeIdentityMaterials(tx,actorId,ownerId,{}, {...previous,...data,revision:(previous?.revision||0)+1});
  const changed=await tx.vehicleOwner.updateMany({where:{id:ownerId,revision:owner.revision,status:{not:'SUSPENDED'}},data:{revision:{increment:1}}});
  ensure(changed.count===1,409,'REVISION_CONFLICT','企业资料已变化，请重新读取');
  if(previous){
   const updated=await tx.ownerLegalRepresentative.updateMany({where:{ownerId,revision:input.revision},data:{...data,revision:{increment:1}}});
   ensure(updated.count===1,409,'REVISION_CONFLICT','法人档案已变化，请重新读取');
  }else await tx.ownerLegalRepresentative.create({data:{...data,ownerId,createdBy:actorId}});
  await tx.ownerESignAccount.updateMany({where:{ownerId},data:{checkedAt:null,leaseUntil:null,leaseToken:null}});
  await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});
  await audit(tx,actorId,'OWNER_LEGAL_REPRESENTATIVE_UPDATED','vehicle-owners',ownerId,{revision:input.revision+1,evidenceFileId:file.id,evidenceHash:file.sha256,previousRevision:previous?.revision||0});
  return{ownerId,name:data.name,maskedMobile:data.maskedMobile,evidenceHash:data.evidenceHash,revision:input.revision+1};
 });
}
