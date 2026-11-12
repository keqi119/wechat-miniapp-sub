import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';

test('014 preserves old task evidence and resolves only provable delivery and return batches',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL||'http://invalid');assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const schema='field_batch_migration_'+randomUUID().replaceAll('-','');assert.match(schema,/^field_batch_migration_[a-f0-9]{32}$/);
 const root=resolve('../..'),tmpRoot=resolve(root,'tmp'),temp=mkdtempSync(join(tmpRoot,'field-batch-migration-')),migration='202610310014_field_handover_batches';
 const schemaFile=join(temp,'schema.prisma');writeFileSync(schemaFile,readFileSync(resolve('prisma/schema.prisma')));mkdirSync(join(temp,'migrations'));
 for(const entry of readdirSync(resolve('prisma/migrations'),{withFileTypes:true}))if(entry.isDirectory()&&entry.name<migration)cpSync(resolve('prisma/migrations',entry.name),join(temp,'migrations',entry.name),{recursive:true});
 cpSync(resolve('prisma/migrations/migration_lock.toml'),join(temp,'migrations/migration_lock.toml'));
 const admin=new PrismaClient({datasourceUrl:url.toString()});url.searchParams.set('schema',schema);const db=new PrismaClient({datasourceUrl:url.toString()});let created=false;
 const deploy=()=>{const r=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',schemaFile],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url.toString()},windowsHide:true,encoding:'utf8',timeout:120000});assert.equal(r.error?.name,undefined);assert.equal(r.status,0,'isolated migration CLI must succeed');};
 try{
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);created=true;deploy();
  const actor=await db.adminUser.create({data:{username:'field-legacy-'+randomUUID(),name:'合成员工',role:'FIELD',passwordHash:'synthetic-not-a-login'}}),customer=await db.customer.create({data:{mobile:'field-legacy-'+randomUUID()}}),vehicle=await db.vehicle.create({data:{brand:'测试',model:'测试',title:'合成交接车',year:2026,city:'测试',mileageKm:100}});
  const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成迁移',months:2,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'测试'}});
  const orderFor=async()=>{const app=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:{},idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});return db.order.create({data:{applicationId:app.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{},confirmedMileageKm:100}});};
  const initial=await orderFor(),changed=await orderFor(),returned=await orderFor(),unresolved=await orderFor(),stamp=new Date('2026-10-01T00:00:00Z');
  const task=async(orderId:string,type:string,status='ASSIGNED',assignmentId:string|null=null)=>{const id=randomUUID();await db.$executeRaw`INSERT INTO "FieldHandoverTask" (id,"orderId",type,status,"vehicleId","vehicleAssignmentId","assigneeId","createdBy","updatedBy","updatedAt",note,draft,version,"materialGeneration") VALUES (${id},${orderId},${type},${status},${vehicle.id},${assignmentId},${actor.id},${actor.id},${actor.id},${stamp},'原备注','{"fieldEvidence":"preserved"}'::jsonb,7,3)`;return id;};
  const initialTask=await task(initial.id,'DELIVERY'),changedTask=await task(changed.id,'DELIVERY'),unresolvedTask=await task(unresolved.id,'RETURN','CANCELLED','unknown-legacy-assignment');
  const change=await db.orderChange.create({data:{orderId:changed.id,customerId:customer.id,originalContractId:'synthetic',priorTermsHash:'a'.repeat(64),priorTerms:{},reason:'合成',createdBy:actor.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}}),quote=await db.delayQuote.create({data:{changeId:change.id,revision:1,commercialHash:'a'.repeat(64),snapshot:{},fundsSnapshot:[],createdBy:actor.id}}),terms=await db.orderTermsVersion.create({data:{orderId:changed.id,quoteId:quote.id,version:1,snapshot:{},hash:'a'.repeat(64),effectiveAt:stamp}});
  await db.order.update({where:{id:changed.id},data:{effectiveTermsVersionId:terms.id}});
  const delivery=await db.handover.create({data:{orderId:returned.id,customerId:customer.id,vehicleId:vehicle.id,type:'DELIVERY',status:'COMPLETED',readingKm:100,actualAt:stamp,fileIds:[],checklist:[],manifestHash:'b'.repeat(64)}}),assignment=await db.vehicleAssignment.create({data:{orderId:returned.id,customerId:customer.id,vehicleId:vehicle.id,deliveryHandoverId:delivery.id,startAt:stamp,startReadingKm:100}});
  await db.handover.update({where:{id:delivery.id},data:{assignmentId:assignment.id}});const returnTask=await task(returned.id,'RETURN','COMPLETED');
  const end=new Date('2026-10-20T00:00:00Z'),handover=await db.handover.create({data:{orderId:returned.id,customerId:customer.id,vehicleId:vehicle.id,fieldTaskId:returnTask,type:'RETURN',status:'COMPLETED',readingKm:200,actualAt:end,fileIds:[],checklist:[],manifestHash:'c'.repeat(64)}});
  // Old tasks/handover may lack assignment pointers, but the actual assignment's return link is authoritative.
  await db.vehicleAssignment.update({where:{id:assignment.id},data:{status:'CLOSED',endAt:end,endReadingKm:200,returnHandoverId:handover.id}});await db.$executeRaw`UPDATE "FieldHandoverTask" SET "currentHandoverId"=${handover.id} WHERE id=${returnTask}`;
  const before=await db.$queryRawUnsafe<any[]>('SELECT * FROM "FieldHandoverTask" ORDER BY id'),factBefore=await db.handover.findMany({orderBy:{id:'asc'}});
  cpSync(resolve('prisma/migrations',migration),join(temp,'migrations',migration),{recursive:true});deploy();
  const after=await db.fieldHandoverTask.findMany({orderBy:{id:'asc'}});assert.equal(after.length,4);
  for(const old of before){const row=after.find(t=>t.id===old.id)!;for(const [key,value] of Object.entries(old))if(key!=='vehicleAssignmentId')assert.deepEqual((row as any)[key],value,'preserve original '+key);assert.equal(row.changeId,null);assert.equal(row.quoteId,null);assert.equal(row.termsVersionId,null);}
  const byId=(id:string)=>after.find(t=>t.id===id)!;
  assert.equal(byId(initialTask).batchKey,'DELIVERY:INITIAL');assert.equal(byId(changedTask).batchKey,'LEGACY:'+changedTask);assert.equal(byId(unresolvedTask).batchKey,'LEGACY:'+unresolvedTask);assert.equal(byId(unresolvedTask).vehicleAssignmentId,'unknown-legacy-assignment');
  assert.equal(byId(returnTask).batchKey,'FINAL_RETURN:'+assignment.id);assert.equal(byId(returnTask).vehicleAssignmentId,assignment.id);assert.deepEqual(await db.handover.findMany({orderBy:{id:'asc'}}),factBefore);
 }finally{
  await db.$disconnect();if(created)await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await admin.$disconnect();
  const rel=relative(tmpRoot,temp);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&rel.startsWith('field-batch-migration-'));rmSync(temp,{recursive:true,force:true});
 }
});
