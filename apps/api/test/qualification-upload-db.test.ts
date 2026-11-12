import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {Db} from '../src/common/db';
import {QualificationService,customerProfileHash,requireCurrentQualification} from '../src/customers/qualifications';
import {CustomerRiskController} from '../src/customers/controller';
const enabled={skip:process.env.NODE_ENV!=='test'};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;

test('database qualification upload and replacement preserve atomicity, historical evidence and replay',enabled,async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test');
 assert.equal(resolve(process.env.UPLOAD_DIR||''),resolve('../../.runtime/qualification-upload-fix-20261110/uploads'),'synthetic file bytes must stay in this task workspace');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),svc=new QualificationService(),nonce=randomUUID();
 try{
  const staff=await db.adminUser.create({data:{username:'qualification-'+nonce,passwordHash:'synthetic-no-login',name:'合成资格经办',role:'ADMIN'}}),actor={id:staff.id,role:staff.role,authVersion:staff.authVersion};
  let customer=await db.customer.create({data:{mobile:'qualification-'+nonce,name:'合成资格客户',drivingYears:3}});
  const old=await Promise.all([1,2,3].map(n=>db.storedFile.create({data:{customerId:customer.id,name:'synthetic-old-'+n+'.jpg',purpose:'identity',mimeType:'image/jpeg',size:4,sha256:String(n).repeat(64),storagePath:'synthetic-never-read'}})));
  customer=await db.customer.update({where:{id:customer.id},data:{profile:{revision:2,identityFrontFileId:old[0].id,identityBackFileId:old[1].id,drivingLicenseFileId:old[2].id}}});
  const firstInput={revision:0,idempotencyKey:randomUUID(),profileHash:customerProfileHash(customer),verificationSource:'MANUAL',identityFileIds:[old[0].id,old[1].id],drivingLicenseFileIds:[old[2].id],identityLongTerm:true,drivingLicenseLongTerm:true};
  const first=await db.serial(tx=>svc.submit(tx,actor,customer.id,firstInput));
  await db.serial(tx=>svc.review(tx,actor,customer.id,{revision:1,idempotencyKey:randomUUID(),qualificationId:first.id,decision:'APPROVED'}));
  const frozen=await db.customerQualificationVersion.findUniqueOrThrow({where:{id:first.id}}),oldRows=await db.storedFile.findMany({where:{id:{in:old.map(f=>f.id)}},orderBy:{id:'asc'}});
  const controller=new CustomerRiskController(db),newFiles:any[]=[];
  for(let n=4;n<=6;n++){
   const file={buffer:Buffer.from([0xff,0xd8,0xff,n]),size:4,mimetype:'image/jpeg',originalname:'synthetic-new-'+n+'.jpg'} as Express.Multer.File,key=randomUUID();
   const a=await controller.uploadQualificationFile(customer.id,{idempotencyKey:key},file,{admin:actor});newFiles.push(a);
   assert.deepEqual(await controller.uploadQualificationFile(customer.id,{idempotencyKey:key},file,{admin:actor}),a);
   await assert.rejects(controller.uploadQualificationFile(customer.id,{idempotencyKey:key},{...file,buffer:Buffer.from([0xff,0xd8,0xff,n+10])},{admin:actor}),code('IDEMPOTENCY_CONFLICT'));
   const row=await db.storedFile.findUniqueOrThrow({where:{id:a.id}});assert.equal(row.customerId,customer.id);assert.equal(row.adminId,actor.id);assert.equal(row.purpose,'identity');
  }
  assert.equal(await db.storedFile.count({where:{customerId:customer.id,adminId:actor.id}}),3);
  assert.deepEqual((await db.customer.findUniqueOrThrow({where:{id:customer.id}})).profile,customer.profile,'upload alone must not change classified profile');
  const input={...firstInput,revision:1,idempotencyKey:randomUUID(),identityFileIds:[newFiles[0].id,newFiles[1].id],drivingLicenseFileIds:[newFiles[2].id],documents:{identityFrontFileId:newFiles[0].id,identityBackFileId:newFiles[1].id,drivingLicenseFileId:newFiles[2].id}};
  await assert.rejects(db.serial(async tx=>{await svc.submit(tx,actor,customer.id,input);throw new Error('synthetic rollback after qualification create');}),/synthetic rollback/);
  assert.deepEqual((await db.customer.findUniqueOrThrow({where:{id:customer.id}})).profile,customer.profile);assert.equal(await db.customerQualificationVersion.count({where:{customerId:customer.id}}),1);assert.equal(await db.archiveCommand.count({where:{actorId:actor.id,key:input.idempotencyKey}}),0);assert.equal(await db.auditLog.count({where:{resourceId:customer.id,action:'QUALIFICATION_PROFILE_UPDATED'}}),0);
  await assert.rejects(db.serial(tx=>svc.submit(tx,actor,customer.id,{...input,profileHash:'f'.repeat(64)})),code('REVISION_CONFLICT'));
  const other=await db.customer.create({data:{mobile:'qualification-other-'+nonce}});await db.storedFile.update({where:{id:newFiles[0].id},data:{customerId:other.id}});
  await assert.rejects(db.serial(tx=>svc.submit(tx,actor,customer.id,input)),code('PROFILE_FILE_INVALID'));await db.storedFile.update({where:{id:newFiles[0].id},data:{customerId:customer.id}});
  const results=await Promise.all([db.serial(tx=>svc.submit(tx,actor,customer.id,input)),db.serial(tx=>svc.submit(tx,actor,customer.id,input))]);assert.deepEqual(results[0],results[1]);assert.equal(await db.customerQualificationVersion.count({where:{customerId:customer.id}}),2);
  const current=await db.customer.findUniqueOrThrow({where:{id:customer.id}}),q=results[0];assert.equal((current.profile as any).revision,3);assert.equal(q.profileHash,customerProfileHash(current));assert.equal(q.status,'SUBMITTED');assert.deepEqual(q.identityFileIds,input.identityFileIds);await assert.rejects(db.serial(tx=>requireCurrentQualification(tx,customer.id)),code('CUSTOMER_QUALIFICATION_REQUIRED'));
  assert.deepEqual(await db.customerQualificationVersion.findUniqueOrThrow({where:{id:first.id}}),frozen);assert.deepEqual(await db.storedFile.findMany({where:{id:{in:old.map(f=>f.id)}},orderBy:{id:'asc'}}),oldRows);
  const duplicates=await Promise.all(newFiles.map(async f=>{const original=await db.storedFile.findUniqueOrThrow({where:{id:f.id}});const {id,createdAt,...data}=original;return db.storedFile.create({data:{...data,name:'synthetic-identical.jpg'}});}));
  const same={...input,revision:2,idempotencyKey:randomUUID(),profileHash:customerProfileHash(current),identityFileIds:[duplicates[0].id,duplicates[1].id],drivingLicenseFileIds:[duplicates[2].id],documents:{identityFrontFileId:duplicates[0].id,identityBackFileId:duplicates[1].id,drivingLicenseFileId:duplicates[2].id}};
  const sameQ=await db.serial(tx=>svc.submit(tx,actor,customer.id,same));assert.equal(sameQ.profileHash,q.profileHash);assert.deepEqual(sameQ.identityFileIds,q.identityFileIds);assert.deepEqual((await db.customer.findUniqueOrThrow({where:{id:customer.id}})).profile,current.profile);
 }finally{await db.$disconnect();}
});
