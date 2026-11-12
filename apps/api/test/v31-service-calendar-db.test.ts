import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/common/db';
test('database stage shape accepts three-month renewal while preserving lifecycle checks',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=new Db();try{await db.$transaction(async tx=>{
  // Clone actual CHECK/default constraints, without touching business rows or foreign keys.
  await tx.$executeRawUnsafe('CREATE TEMP TABLE v31_stage_check (LIKE "OrderServiceStage" INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP');
  await tx.$executeRawUnsafe(`INSERT INTO v31_stage_check (id,"orderId","customerId",sequence,kind,status,"previousStageId","changeId","quoteId","approvedArchiveVersionId","vehicleId","assignmentId","ownerId","listingId","productVersionId","subscriptionPlanId","startDate","endDate",months,"firstPeriodSequence","lastPeriodSequence",snapshot,"snapshotHash","createdBy","updatedAt") VALUES ('stage','order','customer',2,'RENEWAL','PREPARED','previous','change','quote','archive','vehicle','assignment','owner','listing','product','plan','2027-01-31','2027-04-30',3,13,15,'{}',repeat('a',64),'ops',now())`);
  const rows=await tx.$queryRawUnsafe<any[]>('SELECT months FROM v31_stage_check');assert.equal(rows[0].months,3);
  for(const statement of ["UPDATE v31_stage_check SET months=2,\"lastPeriodSequence\"=14", "UPDATE v31_stage_check SET status='ACTIVE'", "UPDATE v31_stage_check SET \"quoteId\"=NULL"]){
   await tx.$executeRawUnsafe('SAVEPOINT invalid_stage');
   await assert.rejects(()=>tx.$executeRawUnsafe(statement));
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_stage');
  }
 });}finally{await db.$disconnect();}
});
