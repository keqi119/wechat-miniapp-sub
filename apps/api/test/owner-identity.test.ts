import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';

let db:Db,service:OwnerService,admin:any,owner:any,customer:any,other:any,invitation:any;
const suffix=randomUUID().replaceAll('-','').slice(0,10),mobile='138'+String(Date.now()).slice(-8);
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
before(async()=>{
 assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;db=new Db();
 admin=await db.adminUser.create({data:{username:'owner'+suffix,name:'Synthetic owner operator',passwordHash:'not-a-real-password',role:'OPERATIONS'}});
 customer=await db.customer.create({data:{mobile}});other=await db.customer.create({data:{mobile:'137'+String(Date.now()).slice(-8)}});
 service=new OwnerService(db);owner=await service.create(admin.id,{name:'合成车主公司'+suffix,creditCode:'TESTCODE'+suffix.toUpperCase(),address:'合成注册地址'});
});
after(async()=>{
 if(db){await db.ownerInvitation.deleteMany({where:{ownerId:owner?.id}});await db.ownerMember.deleteMany({where:{ownerId:owner?.id}});await db.ownerESignAccount.deleteMany({where:{ownerId:owner?.id}});await db.vehicleOwner.deleteMany({where:{id:owner?.id}});await db.auditLog.deleteMany({where:{OR:[{actorId:admin?.id},{resourceId:owner?.id}]}});await db.adminUser.deleteMany({where:{id:admin?.id}});await db.customer.deleteMany({where:{id:{in:[customer?.id,other?.id].filter(Boolean)}}});await db.$disconnect();}
});
test('operator may prepare an enterprise owner but cannot certify it or supply arbitrary provider IDs',async()=>{
 assert.equal(owner.status,'DRAFT');assert.equal((await service.adminDetail(owner.id)).readyForSigning,false);
 await assert.rejects(service.create(admin.id,{name:'恶意',creditCode:'TEST00000000000001',address:'地址',providerCustomerId:'OtherProviderAccount'} as any));
});
test('invitation is bound to one verified phone and stored as a hash, with no owner permission before claim',async()=>{
 invitation=await service.invite(admin.id,owner.id,{mobile});
 const stored=await db.ownerInvitation.findUniqueOrThrow({where:{id:invitation.id}});assert.notEqual(stored.tokenHash,invitation.token);assert.equal(stored.mobile,undefined);
 await assert.rejects(service.claim(other.id,{token:invitation.token}),code('OWNER_INVITATION_PHONE'));
 assert.equal((await service.memberships(customer.id)).length,0);
 await service.claim(customer.id,{token:invitation.token});
 const view=await service.memberDetail(customer.id,owner.id);assert.equal(view.memberStatus,'CLAIMED');assert.equal(view.readyForSigning,false);assert.equal(view.autoSigningEnabled,false);
});
test('claim does not grant enterprise signing authority and another customer cannot see the enterprise',async()=>{
 await assert.rejects(service.requireSigningMember(customer.id,owner.id),code('OWNER_MEMBER_NOT_VERIFIED'));
 await assert.rejects(service.memberDetail(other.id,owner.id),code('NOT_FOUND'));
 const replay=await service.claim(customer.id,{token:invitation.token});assert.equal(replay.ownerId,owner.id);assert.equal(await db.ownerMember.count({where:{ownerId:owner.id,customerId:customer.id}}),1);
});
test('expired invite is not redeemable and a suspended member cannot read private enterprise records',async()=>{
 const pending=await service.invite(admin.id,owner.id,{mobile:other.mobile});await db.ownerInvitation.update({where:{id:pending.id},data:{expiresAt:new Date(0)}});
 await assert.rejects(service.claim(other.id,{token:pending.token}),code('OWNER_INVITATION_EXPIRED'));
 await service.suspendMember(admin.id,owner.id,customer.id);
 await assert.rejects(service.memberDetail(customer.id,owner.id),code('NOT_FOUND'));
});
