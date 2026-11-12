import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';

test('basic condition migration leaves historical vehicles unknown and requires explicit facts',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');assert.equal(target.protocol,'postgresql:');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55449');assert.equal(target.pathname,'/ninda_admin_ui_20261104');assert.equal(target.username,'ninda_admin_ui_20261104');assert.equal(target.search,'');assert.equal(target.hash,'');
 const db=new PrismaClient({datasourceUrl:target.href}),schema='condition_probe_'+randomUUID().replaceAll('-','');
 try{await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await tx.$executeRawUnsafe('CREATE TABLE "Vehicle" (id TEXT PRIMARY KEY)');await tx.$executeRawUnsafe('INSERT INTO "Vehicle" VALUES (\'historical\')');
  const sql=readFileSync(resolve(__dirname,'../prisma/migrations/202611040030_vehicle_condition_assessment/migration.sql'),'utf8');await tx.$executeRawUnsafe(sql);
  assert.deepEqual(await tx.$queryRaw`SELECT count(*)::int AS count FROM "VehicleConditionAssessment"`,[{count:0}]);
  const reject=async(sql:string)=>{await tx.$executeRawUnsafe('SAVEPOINT invalid_condition');try{await assert.rejects(tx.$executeRawUnsafe(sql));}finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_condition');}};
  await reject('INSERT INTO "VehicleConditionAssessment"("vehicleId","fireDamage","floodDamage","assessedBy","createdBy") VALUES (\'historical\',false,false,\'op\',\'op\')');
  await tx.$executeRawUnsafe('INSERT INTO "VehicleConditionAssessment"("vehicleId","fireDamage","floodDamage","structuralDamage","assessedBy","createdBy") VALUES (\'historical\',false,true,false,\'op\',\'op\')');
  assert.deepEqual(await tx.$queryRaw`SELECT revision,"fireDamage","floodDamage","structuralDamage" FROM "VehicleConditionAssessment"`,[{revision:1,fireDamage:false,floodDamage:true,structuralDamage:false}]);
  await reject('DELETE FROM "Vehicle" WHERE id=\'historical\'');await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
 },{timeout:20000});}finally{await db.$disconnect();}
});
