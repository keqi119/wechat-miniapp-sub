import {assertMaterialsCurrent} from './identity-materials';
import {ownerH5EntryUrl} from '../common/platform-origins';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash,mobile} from '../common/data';
import {tokenHash} from '../auth/auth.service';
import {claimOwnerLegalInvitation,claimEligibleOwnerInvitation,ownerLegalLoginEligibility,requireOwnerLegalRepresentative,setOwnerLegalRepresentative,ownerMobileHash} from '../owner-h5/legal-representative';
import {ownerLegalPolicy} from './fadada-owner.client';
import {createOwnerInvitationToken,ownerInvitationToken} from './invitation-token';
import {ownerAuthorizationOptions} from './scope-options';
import {partnerProfileInput} from '../partners/types';
import {newOrderContractMode} from '../offline-documents/mode';

const ownerInput=partnerProfileInput;
export class OwnerService {
 constructor(private readonly db:Db){}
 async usesLegalPolicy(ownerId:string,db:any=this.db){
  if(await db.virtualAcceptanceScope.findFirst({where:{OR:[{ownerId},{platformId:ownerId}]},select:{id:true}}))return true;
  if(newOrderContractMode()==='OFFLINE')return false;
  if(ownerLegalPolicy())return true;
  const account=await db.ownerESignAccount.findUnique({where:{ownerId},select:{consentSnapshot:true}});
  return(account?.consentSnapshot as any)?.channel==='OWNER_LEGAL_H5'||!!(account?.consentSnapshot as any)?.materials;
 }
 async setLegalRepresentative(actorId:string,ownerId:string,raw:unknown){return setOwnerLegalRepresentative(this.db,actorId,ownerId,raw);}
 async requireLegalSigningMember(customerId:string,ownerId:string,db:any=this.db){
  if(!await this.usesLegalPolicy(ownerId,db))return;
  const {profile,member,owner}=await requireOwnerLegalRepresentative(db,customerId,ownerId),account=owner.esignAccount,consent=account?.consentSnapshot as any;
  assertMaterialsCurrent(owner,profile,account,customerId);
  ensure(!account?.leaseUntil||account.leaseUntil<=new Date(),409,'OWNER_PROCESSING','企业认证正在处理中，请稍后重试');
  ensure(member.status==='VERIFIED'&&account?.managerCustomerId===customerId&&account.realNameStatus==='VERIFIED'&&member.verifiedSerialNo===account.verificationTransactionNo&&consent?.channel==='OWNER_LEGAL_H5'&&consent.customerId===customerId&&consent.legalRevision===profile.revision&&consent.legalName===profile.name&&consent.legalMobileHash===profile.mobileHash,403,'OWNER_LEGAL_NOT_VERIFIED','请先由当前法人本人办理并核验企业认证');
 }
 private async operator(id:string,db:any=this.db){const actor=await db.adminUser.findUnique({where:{id}});ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅运营或管理员可管理企业车主');return actor;}
 private phoneHash(value:string){const secret=process.env.SESSION_SECRET;ensure(secret&&secret.length>=32,503,'OWNER_KEY_MISSING','企业邀请校验配置未就绪');return createHmac('sha256',secret).update('owner-invitation:'+value).digest('hex');}
 async create(actorId:string,raw:unknown){await this.operator(actorId);ensure(process.env.MVP_V2_ENABLED!=='true',409,'PARTNER_WORKSPACE_REQUIRED','请通过 /admin/partners 创建合作商，统一维护主体资料与准入版本');const input=ownerInput.parse({subjectType:'ENTERPRISE',...(raw as any)});return this.db.serial(async tx=>{await this.operator(actorId,tx);const owner=await tx.vehicleOwner.create({data:{...input,createdBy:actorId}});await audit(tx,actorId,'OWNER_DRAFT_CREATED','vehicle-owners',owner.id);return owner;});}
 async list(actorId:string){await this.operator(actorId);return this.db.vehicleOwner.findMany({take:100,orderBy:{createdAt:'desc'},select:{id:true,name:true,subjectType:true,creditCode:true,address:true,contactPhone:true,status:true,revision:true,createdAt:true}});}
 async contact(actorId:string,id:string,raw:unknown){await this.operator(actorId);ensure(process.env.MVP_V2_ENABLED!=='true',409,'PARTNER_WORKSPACE_REQUIRED','请通过 /admin/partners 更新合作商，资料变更须重新审核');const input=z.object({contactPhone:z.string().regex(/^[+\d ()-]{5,30}$/),revision:z.number().int().min(0)}).strict().parse(raw);return this.db.serial(async tx=>{const changed=await tx.vehicleOwner.updateMany({where:{id,revision:input.revision},data:{contactPhone:input.contactPhone,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','企业资料已变化，请重新读取');await audit(tx,actorId,'OWNER_CONTACT_UPDATED','vehicle-owners',id);return{id,contactPhone:input.contactPhone};});}
 async vehicles(actorId:string,ownerId:string){await this.operator(actorId);return this.db.ownerVehicle.findMany({where:{ownerId},include:{vehicle:{select:{id:true,title:true,status:true}}}});}
 async bindVehicle(actorId:string,ownerId:string,raw:unknown){await this.operator(actorId);ensure(false,409,'PARTNER_INDEPENDENT_REVIEW_REQUIRED','直接关联车辆入口已关闭，请提交合作商车辆权属材料并按岗位权限审核');}

 async options(customerId:string,ownerId:string){await this.requireSigningMember(customerId,ownerId);return ownerAuthorizationOptions(this.db,ownerId);}
 async adminDetail(id:string){const owner=await this.db.vehicleOwner.findUnique({where:{id},include:{legalRepresentative:{select:{name:true,maskedMobile:true,revision:true,evidenceHash:true}},authorities:{where:{enabled:true},select:{id:true}},esignAccount:true,members:{select:{id:true,customerId:true,status:true,verifiedAt:true}},seals:{select:{id:true,status:true,checkedAt:true,imageHash:true}}}});ensure(owner,404,'NOT_FOUND','车主企业不存在');return{...this.view(owner),legalRepresentative:owner.legalRepresentative};}
 private view(owner:any){const account=owner.esignAccount;const recent=account?.checkedAt&&new Date(account.checkedAt).getTime()>Date.now()-24*3600_000;return{id:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode,address:owner.address,contactPhone:owner.contactPhone,status:owner.status,revision:owner.revision,members:owner.members,seals:owner.seals,realNameStatus:account?.realNameStatus||'NOT_STARTED',certStatus:account?.certStatus||'UNKNOWN',readyForSigning:!!(owner.status==='VERIFIED'&&account?.realNameStatus==='VERIFIED'&&account?.certStatus==='BOUND'&&recent&&owner.seals?.some((s:any)=>s.status==='ACTIVE')),autoAuthorizationEnabled:!!owner.authorities?.length,autoSigningEnabled:process.env.OWNER_AUTO_SIGNING_ENABLED==='true'&&!!owner.authorities?.length};}
 async invite(actorId:string,ownerId:string,raw:unknown){
  await this.operator(actorId);const input=z.object({mobile}).strict().parse(raw),token=createOwnerInvitationToken();
  const item=await this.db.serial(async tx=>{ensure(await tx.vehicleOwner.count({where:{id:ownerId,status:{not:'SUSPENDED'}}}),404,'NOT_FOUND','车主企业不可用');if(await this.usesLegalPolicy(ownerId,tx)){const profile=await tx.ownerLegalRepresentative.findUnique({where:{ownerId}});ensure(profile&&profile.mobileHash===ownerMobileHash(input.mobile),409,'OWNER_LEGAL_REQUIRED','仅可邀请当前登记法人本人，请先核对法人资料');}const invitation=await tx.ownerInvitation.create({data:{ownerId,mobileHash:this.phoneHash(input.mobile),tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+7*86400_000),createdBy:actorId}});await audit(tx,actorId,'OWNER_INVITED','vehicle-owners',ownerId,{invitationId:invitation.id});return invitation;});
  // Returned once to the initiating operator. It is not a login session or signing authority.
  return{id:item.id,ownerId,token,expiresAt:item.expiresAt,entryUrl:ownerH5EntryUrl()};
 }
 async claim(customerId:string,raw:unknown){
  if(newOrderContractMode()!=='OFFLINE'&&ownerLegalPolicy())return claimOwnerLegalInvitation(this.db,customerId,raw);
  const input=z.object({token:ownerInvitationToken}).strict().parse(raw);
  return this.db.serial(async tx=>{
   const invite=await tx.ownerInvitation.findUnique({where:{tokenHash:tokenHash(input.token)},include:{owner:true}});
   ensure(invite&&!invite.revokedAt&&invite.owner.status!=='SUSPENDED',404,'NOT_FOUND','邀请不存在或已撤销');
   const customer=await tx.customer.findUnique({where:{id:customerId}});ensure(customer&&this.phoneHash(customer.mobile)===invite.mobileHash,403,'OWNER_INVITATION_PHONE','请使用收到邀请的本人手机号登录');
   if(await this.usesLegalPolicy(invite.ownerId,tx)){
    const eligible=await ownerLegalLoginEligibility(tx,customer.mobile,input.token);
    ensure(eligible?.invite&&eligible.customer?.id===customerId,403,'OWNER_LEGAL_REQUIRED','邀请或法人资料不可用，请联系运营核对');
    return claimEligibleOwnerInvitation(tx,customerId,eligible.invite);
   }
   if(invite.claimedBy){ensure(invite.claimedBy===customerId,409,'OWNER_INVITATION_USED','邀请已使用');const member=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId:invite.ownerId,customerId}}});ensure(member?.status!=='SUSPENDED'&&member,403,'OWNER_MEMBER_SUSPENDED','企业成员权限已停用');return{ownerId:invite.ownerId,memberStatus:member.status};}
   ensure(invite.expiresAt>new Date(),409,'OWNER_INVITATION_EXPIRED','邀请已过期，请联系运营重新邀请');
   const existing=await tx.ownerMember.findUnique({where:{ownerId_customerId:{ownerId:invite.ownerId,customerId}}});ensure(existing?.status!=='SUSPENDED',403,'OWNER_MEMBER_SUSPENDED','企业成员权限已停用，不能通过新邀请恢复');
   const member=existing||await tx.ownerMember.create({data:{ownerId:invite.ownerId,customerId}});
   await tx.ownerInvitation.update({where:{id:invite.id},data:{claimedBy:customerId,claimedAt:new Date()}});
   await audit(tx,customerId,'OWNER_INVITATION_CLAIMED','vehicle-owners',invite.ownerId,{invitationId:invite.id},'CUSTOMER');return{ownerId:invite.ownerId,memberStatus:member.status};
  });
 }
 async member(customerId:string,ownerId:string){const member=await this.db.ownerMember.findUnique({where:{ownerId_customerId:{ownerId,customerId}},include:{owner:{include:{authorities:{where:{enabled:true},select:{id:true}},esignAccount:true,seals:{select:{id:true,status:true,checkedAt:true,imageHash:true}}}}}});ensure(member&&member.status!=='SUSPENDED'&&member.owner.status!=='SUSPENDED',404,'NOT_FOUND','企业成员记录不存在');return member;}
 async memberDetail(customerId:string,ownerId:string){const member=await this.member(customerId,ownerId);return{...this.view(member.owner),memberStatus:member.status};}
 async memberships(customerId:string){const members=await this.db.ownerMember.findMany({where:{customerId,status:{not:'SUSPENDED'},owner:{status:{not:'SUSPENDED'}}},include:{owner:{select:{id:true,name:true,status:true}}}});return members.map(m=>({ownerId:m.owner.id,name:m.owner.name,status:m.owner.status,memberStatus:m.status}));}
 async requireSigningMember(customerId:string,ownerId:string){const member=await this.member(customerId,ownerId);await this.requireLegalSigningMember(customerId,ownerId);ensure(member.status==='VERIFIED'&&member.verifiedAt&&member.verifiedSerialNo&&member.owner.esignAccount?.managerCustomerId===customerId&&member.owner.esignAccount.verificationTransactionNo===member.verifiedSerialNo,403,'OWNER_MEMBER_NOT_VERIFIED','请先完成本人代表企业的实名认证核验');return member;}
 async suspendMember(actorId:string,ownerId:string,customerId:string){await this.operator(actorId);return this.db.serial(async tx=>{const item=await tx.ownerMember.update({where:{ownerId_customerId:{ownerId,customerId}},data:{status:'SUSPENDED'}});await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});await audit(tx,actorId,'OWNER_MEMBER_SUSPENDED','vehicle-owners',ownerId,{memberId:item.id});return{id:item.id,status:item.status};});}
}
