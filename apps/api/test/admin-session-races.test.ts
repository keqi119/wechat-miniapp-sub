import '../src/common/config';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/common/db';
import { StaffService } from '../src/auth/staff.service';
import { requireCurrentStaff } from '../src/auth/staff-session';
import { passwordHash } from '../src/auth/auth.service';
import {requirePartnerCapability,assertIndependentStaffReview} from '../src/partners/capabilities';
let db:Db,service:StaffService;
before(()=>{process.env.NODE_ENV='test';process.env.STAFF_COMMAND_DIGEST_KEY='synthetic-staff-key-not-for-production-0001';db=new Db();service=new StaffService(db);});
after(async()=>{await db?.$disconnect();});
const command=(revision:number)=>({revision,reason:'合成人员管理验收',idempotencyKey:randomUUID()});
async function admin(){return db.adminUser.create({data:{username:randomUUID(),name:'合成管理员',role:'ADMIN',passwordHash:passwordHash('synthetic-long-password')}});}
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;

test('staff commands are idempotent, private and revoke every prior session',async()=>{
 const actor=await admin(),input={username:randomUUID(),name:'现场员工',role:'FIELD',password:'synthetic-field-password',idempotencyKey:randomUUID()};
 const [one,two]=await Promise.all([service.create(input,actor),service.create(input,actor)]) as any[];
 assert.equal(one.id,two.id);assert.equal(one.authVersion,undefined);assert.equal(one.passwordHash,undefined);
 await assert.rejects(service.create({...input,password:'another-private-password'},actor),code('IDEMPOTENCY_CONFLICT'));
 assert.throws(()=>service.rename(one.id,{name:'提权',role:'ADMIN',revision:0,idempotencyKey:randomUUID()},actor));
 await db.adminSession.createMany({data:[1,2].map(()=>({id:randomUUID(),adminId:one.id,authVersion:0,csrfToken:randomUUID(),expiresAt:new Date(Date.now()+60000)}))});
 const change=await service.changeRole(one.id,{...command(0),role:'OPERATIONS'},actor) as any;
 assert.equal(change.revision,1);assert.equal(await db.adminSession.count({where:{adminId:one.id}}),0);
 await assert.rejects(service.setActive(one.id,false,command(0),actor),code('VERSION_CONFLICT'));
 const records=await db.staffCommand.findMany({where:{actorId:actor.id}}),audit=await db.auditLog.findMany({where:{actorId:actor.id}});
 assert.equal(JSON.stringify([records,audit]).includes(input.password),false);
 assert.equal(JSON.stringify([records,audit]).includes('passwordHash'),false);
});

test('two administrators cannot concurrently deactivate each other and reuse stale authority',async()=>{
 const left=await admin(),right=await admin();
 const results=await Promise.allSettled([service.setActive(right.id,false,command(0),left),service.setActive(left.id,false,command(0),right)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const remaining=await db.adminUser.findMany({where:{id:{in:[left.id,right.id]},active:true}});assert.equal(remaining.length,1);
 const disabled=remaining[0].id===left.id?right:left;
 await assert.rejects(service.detail(remaining[0].id,disabled),code('STAFF_SESSION_CHANGED'));
 await assert.rejects(service.setActive(remaining[0].id,false,command(remaining[0].revision),remaining[0]),code('SELF_LOCKOUT'));
});

test('password reset invalidates captured staff authority even before request completes',async()=>{
 const actor=await admin(),target=await admin();
 await service.resetPassword(target.id,{...command(0),newPassword:'replacement-synthetic-password'},actor);
 await assert.rejects(db.serial(tx=>requireCurrentStaff(tx,target,'users')),code('STAFF_SESSION_CHANGED'));
 const updated=await db.adminUser.findUniqueOrThrow({where:{id:target.id}});assert.equal(updated.authVersion,target.authVersion+1);
});
test('ADMIN verified actual-person mapping and explicit grants revoke captured sessions without FINANCE defaults',async()=>{
 const actor=await admin(),target=await db.adminUser.create({data:{username:randomUUID(),name:'合成运营',role:'OPERATIONS',passwordHash:passwordHash('synthetic-long-password')}});
 const finance=await db.adminUser.create({data:{username:randomUUID(),name:'合成原财务',role:'FINANCE',passwordHash:passwordHash('synthetic-long-password')}});assert.deepEqual(finance.partnerCapabilities,[]);
 await assert.rejects(db.serial(tx=>requirePartnerCapability(tx,finance,'partner.rules.read')),code('FORBIDDEN'));
 await assert.rejects(db.serial(tx=>requirePartnerCapability(tx,target,'partner.rules.write')),code('FORBIDDEN'));
 const grant={...command(0),capabilities:['partner.rules.write','partner.rules.read']};
 const granted=await service.setPartnerCapabilities(target.id,grant,actor) as any;
 assert.deepEqual([...granted.partnerCapabilities].sort(),[...grant.capabilities].sort());assert.equal((await service.setPartnerCapabilities(target.id,grant,actor) as any).revision,granted.revision);
 await assert.rejects(db.serial(tx=>requirePartnerCapability(tx,target,'partner.rules.write')),code('STAFF_SESSION_CHANGED'));
 const fresh=await db.adminUser.findUniqueOrThrow({where:{id:target.id}});await db.serial(tx=>requirePartnerCapability(tx,fresh,'partner.rules.write'));
 await db.adminSession.create({data:{id:randomUUID(),adminId:target.id,authVersion:fresh.authVersion,csrfToken:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
 const person='person-'+randomUUID(),mapped=await service.setStaffPerson(target.id,{...command(granted.revision),staffPersonId:person},actor) as any;
 assert.equal(mapped.staffPersonId,person);assert.equal(await db.adminSession.count({where:{adminId:target.id}}),0);
 await assert.rejects(service.setStaffPerson(target.id,{...command(mapped.revision),staffPersonId:'other-'+randomUUID()},actor),code('STAFF_PERSON_IMMUTABLE'));
 const other=await admin();await service.setStaffPerson(other.id,{...command(0),staffPersonId:person},actor);
 await assert.rejects(db.serial(tx=>assertIndependentStaffReview(tx,other.id,[target.id])),code('SETTLEMENT_SELF_REVIEW'));
 const unmapped=await admin();await assert.rejects(db.serial(tx=>assertIndependentStaffReview(tx,unmapped.id,[target.id])),code('STAFF_PERSON_UNVERIFIED'));
 const now=await db.adminUser.findUniqueOrThrow({where:{id:target.id}});await service.setPartnerCapabilities(target.id,{...command(now.revision),capabilities:[]},actor);
 await assert.rejects(db.serial(tx=>requirePartnerCapability(tx,now,'partner.rules.write')),code('STAFF_SESSION_CHANGED'));
 const field=await service.create({username:randomUUID(),name:'合成现场',role:'FIELD',password:'synthetic-long-password',idempotencyKey:randomUUID()},actor) as any;
 await assert.rejects(service.setPartnerCapabilities(field.id,{...command(0),capabilities:['partner.rules.read']},actor),code('FORBIDDEN'));
});
