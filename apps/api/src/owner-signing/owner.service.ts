import {createHmac,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,mobile} from '../common/data';
import {tokenHash} from '../auth/auth.service';

const ownerInput=z.object({name:z.string().trim().min(2).max(200),creditCode:z.string().regex(/^[A-Z0-9]{18}$/),address:z.string().trim().min(2).max(300),contactPhone:z.string().regex(/^[+\d ()-]{5,30}$/).optional()}).strict();
export class OwnerService {
 constructor(private readonly db:Db){}
 private async operator(id:string){const actor=await this.db.adminUser.findUnique({where:{id}});ensure(actor?.active&&['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅运营或管理员可管理企业车主');return actor;}
 private phoneHash(value:string){const secret=process.env.SESSION_SECRET;ensure(secret&&secret.length>=32,503,'OWNER_KEY_MISSING','企业邀请校验配置未就绪');return createHmac('sha256',secret).update('owner-invitation:'+value).digest('hex');}
 async create(actorId:string,raw:unknown){await this.operator(actorId);const input=ownerInput.parse(raw);return this.db.serial(async tx=>{const owner=await tx.vehicleOwner.create({data:{...input,createdBy:actorId}});await audit(tx,actorId,'OWNER_DRAFT_CREATED','vehicle-owners',owner.id);return owner;});}
 async list(actorId:string){await this.operator(actorId);return this.db.vehicleOwner.findMany({take:100,orderBy:{createdAt:'desc'},select:{id:true,name:true,creditCode:true,address:true,contactPhone:true,status:true,revision:true,createdAt:true}});}
 async adminDetail(id:string){const owner=await this.db.vehicleOwner.findUnique({where:{id},include:{authorities:{where:{enabled:true},select:{id:true}},esignAccount:true,members:{select:{id:true,customerId:true,status:true,verifiedAt:true}},seals:{select:{id:true,status:true,checkedAt:true,imageHash:true}}}});ensure(owner,404,'NOT_FOUND','车主企业不存在');return this.view(owner);}
 private view(owner:any){const account=owner.esignAccount;const recent=account?.checkedAt&&new Date(account.checkedAt).getTime()>Date.now()-24*3600_000;return{id:owner.id,name:owner.name,creditCode:owner.creditCode,address:owner.address,status:owner.status,revision:owner.revision,members:owner.members,seals:owner.seals,realNameStatus:account?.realNameStatus||'NOT_STARTED',certStatus:account?.certStatus||'UNKNOWN',readyForSigning:!!(owner.status==='VERIFIED'&&account?.realNameStatus==='VERIFIED'&&account?.certStatus==='BOUND'&&recent&&owner.seals?.some((s:any)=>s.status==='ACTIVE')),autoSigningEnabled:!!owner.authorities?.length};}
 async invite(actorId:string,ownerId:string,raw:unknown){
  await this.operator(actorId);const input=z.object({mobile}).strict().parse(raw),token=randomBytes(32).toString('base64url');
  const item=await this.db.serial(async tx=>{ensure(await tx.vehicleOwner.count({where:{id:ownerId,status:{not:'SUSPENDED'}}}),404,'NOT_FOUND','车主企业不可用');const invitation=await tx.ownerInvitation.create({data:{ownerId,mobileHash:this.phoneHash(input.mobile),tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+7*86400_000),createdBy:actorId}});await audit(tx,actorId,'OWNER_INVITED','vehicle-owners',ownerId,{invitationId:invitation.id});return invitation;});
  // Returned once to the initiating operator. It is not a login session or signing authority.
  return{id:item.id,ownerId,token,expiresAt:item.expiresAt};
 }
 async claim(customerId:string,raw:unknown){
  const input=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(raw);
  return this.db.serial(async tx=>{
   const invite=await tx.ownerInvitation.findUnique({where:{tokenHash:tokenHash(input.token)},include:{owner:true}});
   ensure(invite&&!invite.revokedAt&&invite.owner.status!=='SUSPENDED',404,'NOT_FOUND','邀请不存在或已撤销');
   const customer=await tx.customer.findUnique({where:{id:customerId}});ensure(customer&&this.phoneHash(customer.mobile)===invite.mobileHash,403,'OWNER_INVITATION_PHONE','请使用收到邀请的本人手机号登录');
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
 async requireSigningMember(customerId:string,ownerId:string){const member=await this.member(customerId,ownerId);ensure(member.status==='VERIFIED'&&member.verifiedAt&&member.verifiedSerialNo&&member.owner.esignAccount?.managerCustomerId===customerId&&member.owner.esignAccount.verificationTransactionNo===member.verifiedSerialNo,403,'OWNER_MEMBER_NOT_VERIFIED','请先完成本人代表企业的实名认证核验');return member;}
 async suspendMember(actorId:string,ownerId:string,customerId:string){await this.operator(actorId);return this.db.serial(async tx=>{const item=await tx.ownerMember.update({where:{ownerId_customerId:{ownerId,customerId}},data:{status:'SUSPENDED'}});await tx.vehicleOwner.update({where:{id:ownerId},data:{revision:{increment:1}}});await tx.ownerAutoAuthority.updateMany({where:{ownerId,enabled:true},data:{enabled:false,disabledAt:new Date(),revision:{increment:1}}});await audit(tx,actorId,'OWNER_MEMBER_SUSPENDED','vehicle-owners',ownerId,{memberId:item.id});return{id:item.id,status:item.status};});}
}
