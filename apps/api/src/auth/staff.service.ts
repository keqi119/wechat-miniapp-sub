import { Injectable, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Db } from '../common/db';
import { audit, pagination } from '../common/data';
import { ensure } from '../common/errors';
import { passwordHash } from './auth.service';
import { staffDigest } from './staff-command';
import { requireCurrentStaff } from './staff-session';
import { StaffActor, StaffUserView, staffCreateInput, staffRenameInput, staffActionInput, staffRoleInput, staffResetInput,staffCapabilitiesInput,staffPersonInput } from './staff.types';
import {getPartnerCapabilities} from '../partners/capabilities';

@Injectable()
export class StaffService {
 constructor(@Inject(Db) private db:Db){}
 private async view(tx:Prisma.TransactionClient,id:string):Promise<StaffUserView>{
  const row=await tx.adminUser.findUniqueOrThrow({where:{id},select:{id:true,username:true,name:true,role:true,active:true,revision:true,createdAt:true,updatedAt:true,partnerCapabilities:true,staffPersonId:true}});
  return {...row,partnerCapabilities:getPartnerCapabilities(row),pendingFieldTaskCount:await tx.fieldHandoverTask.count({where:{assigneeId:id,status:'ASSIGNED'}})};
 }
 async list(query:Record<string,unknown>,actor:StaffActor){return this.db.serial(async tx=>{
  await requireCurrentStaff(tx,actor,'users',false);const p=pagination(query);
  const where:Prisma.AdminUserWhereInput={};
  if(query.keyword)where.OR=['name','username'].map(field=>({[field]:{contains:String(query.keyword),mode:'insensitive'}}));
  if(query.role){ensure(['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD'].includes(String(query.role)),400,'VALIDATION','角色无效');where.role=query.role as any;}
  if(query.active!==undefined){ensure(['true','false',true,false].includes(query.active as any),400,'VALIDATION','启用状态无效');where.active=query.active===true||query.active==='true';}
  const rows=await tx.adminUser.findMany({where,select:{id:true},skip:p.skip,take:p.take,orderBy:{createdAt:'desc'}});
  return {items:await Promise.all(rows.map(row=>this.view(tx,row.id))),total:await tx.adminUser.count({where}),page:p.page,pageSize:p.pageSize};
 });}
 async detail(id:string,actor:StaffActor){return this.db.serial(async tx=>{await requireCurrentStaff(tx,actor,'users',false);ensure(await tx.adminUser.count({where:{id}}),404,'NOT_FOUND','人员不存在');return this.view(tx,id);});}
 create(body:unknown,actor:StaffActor){const input=staffCreateInput.parse(body);return this.command(actor,'users:create','CREATE',input,async tx=>{
  ensure(!await tx.adminUser.count({where:{username:input.username}}),409,'STAFF_USERNAME_TAKEN','登录名已被使用');
  const row=await tx.adminUser.create({data:{username:input.username,name:input.name,role:input.role,passwordHash:passwordHash(input.password),active:true}});return {id:row.id,before:null};
 });}
 rename(id:string,body:unknown,actor:StaffActor){return this.change(id,'RENAME',staffRenameInput.parse(body),actor);}
 changeRole(id:string,body:unknown,actor:StaffActor){return this.change(id,'ROLE',staffRoleInput.parse(body),actor);}
 setActive(id:string,active:boolean,body:unknown,actor:StaffActor){return this.change(id,active?'ENABLE':'DISABLE',staffActionInput.parse(body),actor);}
 resetPassword(id:string,body:unknown,actor:StaffActor){return this.change(id,'RESET_PASSWORD',staffResetInput.parse(body),actor);}
 revokeSessions(id:string,body:unknown,actor:StaffActor){return this.change(id,'REVOKE_SESSIONS',staffActionInput.parse(body),actor);}
 setPartnerCapabilities(id:string,body:unknown,actor:StaffActor){return this.change(id,'PARTNER_CAPABILITIES',staffCapabilitiesInput.parse(body),actor);}
 setStaffPerson(id:string,body:unknown,actor:StaffActor){return this.change(id,'STAFF_PERSON',staffPersonInput.parse(body),actor);}
 private change(id:string,action:string,input:any,actor:StaffActor){return this.command(actor,id,action,input,async tx=>{
  const before=await tx.adminUser.findUnique({where:{id}});ensure(before,404,'NOT_FOUND','人员不存在');
  ensure(before.revision===input.revision,409,'VERSION_CONFLICT','人员信息已更新，请刷新后重新确认');
  ensure(!(actor.id===id&&(action==='DISABLE'||action==='ROLE'&&input.role!=='ADMIN')),409,'SELF_LOCKOUT','不可停用或降级当前管理员');
  ensure(!(actor.id===id&&action==='RESET_PASSWORD'),409,'SELF_PASSWORD_ROUTE','请使用本人修改密码入口');
  if(before.active&&before.role==='ADMIN'&&(action==='DISABLE'||action==='ROLE'&&input.role!=='ADMIN'))ensure(await tx.adminUser.count({where:{active:true,role:'ADMIN'}})>1,409,'LAST_ACTIVE_ADMIN','必须保留至少一名有效管理员');
  const data:Prisma.AdminUserUpdateInput={revision:{increment:1}};
  if(action==='RENAME')data.name=input.name;
  else{
   data.authVersion={increment:1};
   if(action==='ROLE')data.role=input.role;
   if(action==='PARTNER_CAPABILITIES'){ensure(before.role!=='FIELD'||input.capabilities.length===0,403,'FORBIDDEN','现场员工不得获授合作运营能力');data.partnerCapabilities=input.capabilities;}
   if(action==='STAFF_PERSON'){ensure(!before.staffPersonId||before.staffPersonId===input.staffPersonId,409,'STAFF_PERSON_IMMUTABLE','已核实的实际人员归属不可改写，请核对人员及历史经办记录');data.staffPersonId=input.staffPersonId;}
   if(action==='ROLE'&&input.role==='FIELD')data.partnerCapabilities=[];
   if(action==='ENABLE'||action==='DISABLE')data.active=action==='ENABLE';
   if(action==='RESET_PASSWORD')data.passwordHash=passwordHash(input.newPassword);
  }
  await tx.adminUser.update({where:{id},data});
  const revoked=action==='RENAME'?0:(await tx.adminSession.deleteMany({where:{adminId:id}})).count;
  return {id,before:{role:before.role,active:before.active,revision:before.revision,partnerCapabilities:getPartnerCapabilities(before),staffPersonId:before.staffPersonId},revoked};
 });}
 private command(actor:StaffActor,targetKey:string,action:string,input:any,apply:(tx:Prisma.TransactionClient)=>Promise<{id:string;before:unknown;revoked?:number}>){
  return this.db.serial(async tx=>{
   // Serialize account-lifecycle operations, including two administrators disabling each other.
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(782640271)::text`;
   await requireCurrentStaff(tx,actor,'users');
   const existing=await tx.staffCommand.findUnique({where:{actorId_targetKey_action_idempotencyKey:{actorId:actor.id,targetKey,action,idempotencyKey:input.idempotencyKey}}});
   const digest=staffDigest(input,existing?.digestKeyVersion);
   if(existing){ensure(existing.requestDigest===digest.digest,409,'IDEMPOTENCY_CONFLICT','相同操作编号不可修改内容');return existing.responseSnapshot;}
   const result=await apply(tx),view=await this.view(tx,result.id);
   await audit(tx,actor.id,'STAFF_'+action,'users',result.id,{before:result.before,after:{role:view.role,active:view.active,revision:view.revision,partnerCapabilities:view.partnerCapabilities,staffPersonId:view.staffPersonId},reason:input.reason||null,revokedSessions:result.revoked||0,pendingFieldTaskCount:view.pendingFieldTaskCount});
   await tx.staffCommand.create({data:{actorId:actor.id,targetKey,targetId:result.id,action,idempotencyKey:input.idempotencyKey,requestDigest:digest.digest,digestKeyVersion:digest.keyVersion,responseSnapshot:JSON.parse(JSON.stringify(view))}});
   return view;
  });
 }
}
