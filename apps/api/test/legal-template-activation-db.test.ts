import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {AdminController} from '../src/operations/admin';
import {legalContentHash} from '../src/operations/legal-template';

test('real PostgreSQL activation locks, publishes one version and replays once without editing old content',async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),rollback=new Error('ROLLBACK_SYNTHETIC_ACTIVATION_TEST');
 try{
  await db.$transaction(async tx=>{
   const suffix=randomUUID(),type='OFFLINE_ACTIVATION_TEST_'+suffix;
   const staff=await tx.adminUser.create({data:{username:'legal-activation-'+suffix,name:'Synthetic operator',role:'OPERATIONS',passwordHash:'synthetic-no-login'}});
   const old=await tx.legalDocument.create({data:{type,version:1,title:'Previous',content:'Signed historical text',status:'PUBLISHED'}});
   const draft=await tx.legalDocument.create({data:{type,version:2,title:'Approved',content:'Approved new text',status:'DRAFT'}});
   const controller=new AdminController({serial:async(fn:any)=>fn(tx)} as any),request={admin:{id:staff.id,role:staff.role,authVersion:staff.authVersion}};
   const input={confirmed:true,expectedVersion:2,expectedContentHash:legalContentHash(draft),idempotencyKey:'activation-'+suffix};
   const result=await controller.activateLegal(draft.id,input,request);
   assert.equal(result.status,'PUBLISHED');assert.equal(result.confirmedBy,staff.id);
   assert.deepEqual(await controller.activateLegal(draft.id,input,request),result);
   const previous=await tx.legalDocument.findUniqueOrThrow({where:{id:old.id}});
   assert.equal(previous.status,'RETIRED');assert.equal(previous.content,old.content);
   assert.equal(await tx.legalDocument.count({where:{type,status:'PUBLISHED'}}),1);
   assert.equal(await tx.auditLog.count({where:{resourceId:draft.id,action:'ACTIVATE_TEMPLATE'}}),1);
   assert.equal(await tx.archiveCommand.count({where:{actorId:staff.id,resourceId:'legal-document:'+draft.id}}),1);
   await assert.rejects(controller.activateLegal(draft.id,{...input,expectedContentHash:'0'.repeat(64)},request),(error:any)=>error.getResponse?.().error.code==='IDEMPOTENCY_CONFLICT');
   throw rollback;
  },{timeout:15000});
  assert.fail('Synthetic transaction must roll back');
 }catch(error){if(error!==rollback)throw error;}
 finally{await db.$disconnect();}
});
