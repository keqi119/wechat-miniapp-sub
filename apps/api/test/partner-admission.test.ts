import {test} from 'node:test';
import assert from 'node:assert/strict';
import {partnerProfileInput,assertPartnerMaterials,assertIndependentReview} from '../src/partners/types';
import {assertVehicleUnoccupied} from '../src/partners/vehicle-binding';
import {OwnerService} from '../src/owner-signing/owner.service';
import {PartnerAdmissionService} from '../src/partners/admission';
import {PartnerIdentityService} from '../src/partners/identity';
import {VehicleBindingService} from '../src/partners/vehicle-binding';
import {Db} from '../src/common/db';
import {randomUUID} from 'node:crypto';
import {PartnerIdentityController} from '../src/partners/controller';
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
test('enterprise requires real credit code while individual never stores document number as enterprise code',()=>{
 const base={name:'测试主体',address:'测试地址',contactPhone:'13800000000'};
 assert.throws(()=>partnerProfileInput.parse({...base,subjectType:'ENTERPRISE'}));
 assert.equal(partnerProfileInput.parse({...base,subjectType:'INDIVIDUAL'}).creditCode,null);
 assert.throws(()=>partnerProfileInput.parse({...base,subjectType:'INDIVIDUAL',creditCode:'123456199001011234'}));
});
test('subject specific admission materials and independent uploader review are mandatory',()=>{
 assert.throws(()=>assertPartnerMaterials({subjectType:'ENTERPRISE',creditCode:null},[],{}),error('PARTNER_MATERIALS_REQUIRED'));
 assert.throws(()=>assertIndependentReview('reviewer','submitter',[{adminId:'reviewer'}]),error('PARTNER_SELF_REVIEW'));
 assert.throws(()=>assertIndependentReview('submitter','submitter',[]),error('PARTNER_SELF_REVIEW'));
 assertIndependentReview('reviewer','submitter',[{adminId:'uploader'}]);
});
test('vehicle owner cannot change while reserved, assigned, held or in an unfinished order',async()=>{
 for(const condition of ['reserved','assigned','held','ordered','handover','legacyHandover']){
  const tx:any={vehicle:{findUnique:async()=>({id:'v',reservedOrderId:condition==='reserved'?'o':null})},vehicleAssignment:{count:async()=>condition==='assigned'?1:0},vehicleHold:{count:async()=>condition==='held'?1:0},order:{count:async()=>condition==='ordered'?1:0},fieldHandoverTask:{count:async()=>condition==='handover'?1:0},handover:{count:async()=>condition==='legacyHandover'?1:0}};
  await assert.rejects(assertVehicleUnoccupied(tx,'v'),error('PARTNER_VEHICLE_OCCUPIED'));
 }
});
test('legacy direct bindVehicle cannot mark evidence approved',async()=>{const tx:any={adminUser:{findUnique:async()=>({id:'operator',active:true,role:'OPERATIONS'})}};await assert.rejects(new OwnerService(tx).bindVehicle('operator','owner',{vehicleId:'v',evidenceFileId:'e',accepted:true}),error('PARTNER_INDEPENDENT_REVIEW_REQUIRED'));});
test('MVP legacy profile writers direct operators to the single partners source',async()=>{const previous=process.env.MVP_V2_ENABLED;process.env.MVP_V2_ENABLED='true';try{const legacy=new OwnerService({adminUser:{findUnique:async()=>({id:'operator',active:true,role:'OPERATIONS'})}} as any);await assert.rejects(legacy.create('operator',{name:'合成企业',creditCode:'A'.repeat(18),address:'测试地址'}),error('PARTNER_WORKSPACE_REQUIRED'));await assert.rejects(legacy.contact('operator','owner',{contactPhone:'13800000000',revision:0}),error('PARTNER_WORKSPACE_REQUIRED'));}finally{if(previous===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=previous;}});
test('partner mutation rechecks the current staff role and authVersion inside transaction',async()=>{const tx:any={adminUser:{findUnique:async()=>({id:'actor',active:true,role:'ADMIN',authVersion:2})}};const input={profile:{subjectType:'INDIVIDUAL',name:'测试本人',address:'测试地址',contactPhone:'13800000000'},idempotencyKey:'create-key'};await assert.rejects(new PartnerAdmissionService().create(tx,{id:'actor',role:'ADMIN',authVersion:1},input),error('STAFF_SESSION_CHANGED'));await assert.rejects(new PartnerAdmissionService().create(tx,{id:'actor',role:'OPERATIONS',authVersion:2},input),error('STAFF_SESSION_CHANGED'));});
test('retired identity HTTP commands cannot create new legacy approvals',async()=>{
 const controller=new PartnerIdentityController({serial:async()=>({status:'APPROVED'})} as any);
 for(const operation of [()=>controller.submit({admin:{id:'operator'}},'owner',{}),()=>controller.review({admin:{id:'operator'}},'owner','binding',{}),()=>controller.revoke({admin:{id:'operator'}},'owner','binding',{})])await assert.rejects(async()=>operation(),error('PARTNER_IDENTITY_LEGACY_READONLY'));
});

test('database draft preparation preserves legacy identity audit, rejects old admission DTO and enforces concurrent binding versions',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});const service=new PartnerAdmissionService(),identity=new PartnerIdentityService(),vehicles=new VehicleBindingService();
 try{
  const seed=randomUUID(),maker=await db.adminUser.create({data:{username:'partner-maker-'+seed,name:'合成经办',role:'OPERATIONS',staffPersonId:'maker-'+seed,partnerCapabilities:['partner.cooperation.read','partner.cooperation.write','partner.cooperation.review'],passwordHash:'synthetic-unused'}}),reviewer=await db.adminUser.create({data:{username:'partner-reviewer-'+seed,name:'合成复核',role:'ADMIN',staffPersonId:'reviewer-'+seed,partnerCapabilities:['partner.cooperation.read','partner.cooperation.write','partner.cooperation.review'],passwordHash:'synthetic-unused'}});
  const actor=(u:any)=>({id:u.id,role:u.role,authVersion:u.authVersion}),evidence=await db.storedFile.create({data:{adminId:maker.id,name:'合成核验.pdf',purpose:'evidence',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:'synthetic-no-real-document'}});
  const create={profile:{subjectType:'INDIVIDUAL',name:'合成本人',address:'合成地址',contactPhone:'13800000000'},idempotencyKey:randomUUID()};
  const owner=await db.serial(tx=>service.create(tx,actor(maker),create));assert.equal(owner.creditCode,null);
  assert.equal((await db.serial(tx=>service.create(tx,actor(maker),create))).id,owner.id);
  await assert.rejects(db.serial(tx=>service.create(tx,actor(maker),{...create,profile:{...create.profile,name:'变更姓名'}})),error('IDEMPOTENCY_CONFLICT'));
  const customer=await db.customer.create({data:{mobile:'partner-account-'+seed}});
  const bound=await db.serial(tx=>identity.submit(tx,actor(maker),owner.id,{revision:0,idempotencyKey:randomUUID(),customerId:customer.id,relationship:'SELF',evidenceFileIds:[evidence.id],identityChecked:true}));
  const relationReview={revision:bound.revision,idempotencyKey:randomUUID(),decision:'APPROVE',reason:'合成本人核验'};
  await assert.rejects(db.serial(tx=>identity.review(tx,actor(maker),owner.id,bound.id,relationReview)),error('PARTNER_SELF_REVIEW'));
  await db.serial(tx=>identity.review(tx,actor(reviewer),owner.id,bound.id,relationReview));
  await assert.rejects(db.serial(tx=>service.submit(tx,actor(maker),owner.id,{revision:0,idempotencyKey:randomUUID(),identityBindingId:bound.id,evidenceFileIds:[evidence.id],identityChecked:true,ownershipChecked:true})));
  const vehicle=await db.vehicle.create({data:{title:'合成个人车辆',brand:'Synthetic',model:'Test',year:2026,city:'上海',mileageKm:0}});
  const proposal=await db.serial(tx=>vehicles.submit(tx,actor(maker),owner.id,vehicle.id,{revision:0,idempotencyKey:randomUUID(),evidenceFileId:evidence.id}));
  const bindingReview={ownerId:owner.id,revision:0,idempotencyKey:randomUUID(),proposalId:proposal.id};
  await assert.rejects(db.serial(tx=>vehicles.rebind(tx,actor(maker),vehicle.id,bindingReview)),error('PARTNER_SELF_REVIEW'));
  const binding=await db.serial(tx=>vehicles.rebind(tx,actor(reviewer),vehicle.id,bindingReview));assert.equal(binding.status,'APPROVED');assert.equal(await db.ownerVehicle.count({where:{vehicleId:vehicle.id}}),1);
  const competitors=await Promise.all(['合成竞争主体甲','合成竞争主体乙'].map(name=>db.serial(tx=>service.create(tx,actor(maker),{profile:{...create.profile,name},idempotencyKey:randomUUID()}))));
  const proposals=await Promise.all(competitors.map(partner=>db.serial(tx=>vehicles.submit(tx,actor(maker),partner.id,vehicle.id,{revision:binding.revision,idempotencyKey:randomUUID(),evidenceFileId:evidence.id}))));
  const changes=await Promise.allSettled(competitors.map((partner,index)=>db.serial(tx=>vehicles.rebind(tx,actor(reviewer),vehicle.id,{ownerId:partner.id,proposalId:proposals[index].id,revision:binding.revision,idempotencyKey:randomUUID()}))));
  assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);assert.equal(changes.filter(r=>r.status==='rejected').length,1);assert.equal((await db.ownerVehicle.findUnique({where:{vehicleId:vehicle.id}}))!.revision,binding.revision+1);
  await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:'synthetic-held-'+seed}});
  await assert.rejects(db.serial(tx=>vehicles.submit(tx,actor(maker),owner.id,vehicle.id,{revision:binding.revision,idempotencyKey:randomUUID(),evidenceFileId:evidence.id})),error('PARTNER_VEHICLE_OCCUPIED'));
  await db.serial(tx=>service.update(tx,actor(maker),owner.id,{revision:0,idempotencyKey:randomUUID(),profile:{...create.profile,name:'合成修改后'}}));assert.equal((await (db as any).partnerIdentityBinding.findUnique({where:{id:bound.id}})).status,'STALE');
 }finally{await db.$disconnect();}
});


test('ordinary contact updates reject an omitted contact revision before touching persistence',async()=>{
 await assert.rejects(new PartnerAdmissionService().update({} as any,{id:'maker',role:'ADMIN'},'owner',{revision:0,idempotencyKey:'ordinary-missing-version',contactKind:'ORDINARY',profile:{subjectType:'INDIVIDUAL',name:'合成主体',address:'合成地址',contactPhone:'13900000000'}}),(e:any)=>e.issues?.some((issue:any)=>issue.path.includes('contactRevision')));
});
test('database ordinary contact CAS prevents sequential and concurrent stale overwrites without changing legal facts',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});try{
  const seed=randomUUID(),maker=await db.adminUser.create({data:{username:'ordinary-cas-'+seed,name:'合成经办',role:'ADMIN',staffPersonId:'ordinary-person-'+seed,partnerCapabilities:['partner.cooperation.write'],passwordHash:'synthetic-unused'}}),actor={id:maker.id,role:maker.role,authVersion:maker.authVersion},service=new PartnerAdmissionService(),profile={subjectType:'INDIVIDUAL',name:'合成联系主体',address:'合成地址',contactPhone:'13800000000'};
  const owner=await db.serial(tx=>service.create(tx,actor,{profile,idempotencyKey:randomUUID()})),body=(phone:string,revision:number)=>({revision:owner.revision,contactRevision:revision,idempotencyKey:randomUUID(),contactKind:'ORDINARY',profile:{...profile,contactPhone:phone}});
  await assert.rejects(db.serial(tx=>service.update(tx,actor,owner.id,{...body('13900000000',0),contactRevision:undefined})),(e:any)=>e.issues?.some((issue:any)=>issue.path.includes('contactRevision')));
  const first=await db.serial(tx=>service.update(tx,actor,owner.id,body('13900000001',0)));assert.equal(first.contactRevision,1);
  await assert.rejects(db.serial(tx=>service.update(tx,actor,owner.id,body('13900000002',0))),error('REVISION_CONFLICT'));
  const changes=await Promise.allSettled(['13900000003','13900000004'].map(phone=>db.serial(tx=>service.update(tx,actor,owner.id,body(phone,1)))));assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);assert.equal(changes.filter(r=>r.status==='rejected'&&error('REVISION_CONFLICT')(r.reason)).length,1);
  const current=await db.vehicleOwner.findUnique({where:{id:owner.id}});assert.equal(current!.revision,owner.revision);assert.equal(current!.contactPhone,owner.contactPhone);assert.equal(current!.address,owner.address);assert.equal(current!.contactRevision,2);assert.ok(['13900000003','13900000004'].includes(current!.ordinaryContactPhone!));
 }finally{await db.$disconnect();}
});
