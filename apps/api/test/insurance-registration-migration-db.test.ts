import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

test('registration migration snapshots known legacy identity and does not forge reviewers or policy types',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');assert.ok(['postgres:','postgresql:'].includes(target.protocol)&&target.hostname==='127.0.0.1'&&target.port==='55449'&&target.pathname==='/ninda_admin_ui_20261104'&&target.username==='ninda_admin_ui_20261104'&&!target.hash&&[...target.searchParams].every(([k,v])=>k==='schema'&&v==='public'));
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),schema='insurance_registration_'+randomUUID().replaceAll('-','');assert.match(schema,/^insurance_registration_[a-f0-9]{32}$/);
 try{await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await tx.$executeRawUnsafe('CREATE TABLE "InsurancePolicy" (id TEXT PRIMARY KEY,insurer TEXT NOT NULL,"policyNumber" TEXT NOT NULL)');
  await tx.$executeRawUnsafe('CREATE TABLE "InsurancePolicyVersion" (id TEXT PRIMARY KEY,"policyId" TEXT NOT NULL,status TEXT NOT NULL,"reviewedBy" TEXT,"reviewedAt" TIMESTAMP(3),"startAt" TIMESTAMP(3),"endAt" TIMESTAMP(3))');
  await tx.$executeRawUnsafe(`INSERT INTO "InsurancePolicy" VALUES ('p','历史机构','OLD-001')`);
  await tx.$executeRawUnsafe(`INSERT INTO "InsurancePolicyVersion" VALUES ('approved','p','APPROVED','real-reviewer','2026-01-01','2026-01-01','2027-01-01'),('draft','p','DRAFT',NULL,NULL,'2026-01-01','2027-01-01')`);
  for(const sql of readFileSync(resolve(__dirname,'../prisma/migrations/202611040020_insurance_registration/migration.sql'),'utf8').split(';').filter(part=>part.trim()))await tx.$executeRawUnsafe(sql);
  const versions=await tx.$queryRaw<any[]>`SELECT id,status,"insurerSnapshot","policyNumberSnapshot","policyType","reviewedBy","registeredBy","registrationSnapshot" FROM "InsurancePolicyVersion" ORDER BY id`;
  assert.deepEqual(versions,[{id:'approved',status:'APPROVED',insurerSnapshot:'历史机构',policyNumberSnapshot:'OLD-001',policyType:null,reviewedBy:'real-reviewer',registeredBy:null,registrationSnapshot:null},{id:'draft',status:'DRAFT',insurerSnapshot:'历史机构',policyNumberSnapshot:'OLD-001',policyType:null,reviewedBy:null,registeredBy:null,registrationSnapshot:null}]);
  await tx.$executeRawUnsafe(`UPDATE "InsurancePolicy" SET insurer='更正机构',"policyNumber"='CORRECTED' WHERE id='p'`);assert.equal((await tx.$queryRaw<any[]>`SELECT "policyNumberSnapshot" FROM "InsurancePolicyVersion" WHERE id='approved'`)[0].policyNumberSnapshot,'OLD-001');
  const reject=async(sql:string)=>{await tx.$executeRawUnsafe('SAVEPOINT bad_registration');try{await assert.rejects(tx.$executeRawUnsafe(sql),(e:any)=>e.code==='P2010'&&e.meta?.code==='23514');}finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT bad_registration');await tx.$executeRawUnsafe('RELEASE SAVEPOINT bad_registration');}};
  await reject(`UPDATE "InsurancePolicyVersion" SET status='REGISTERED' WHERE id='draft'`);
  await reject(`UPDATE "InsurancePolicyVersion" SET "policyType"='GUESSED' WHERE id='draft'`);
  await tx.$executeRawUnsafe(`UPDATE "InsurancePolicyVersion" SET status='REGISTERED',"policyType"='COMMERCIAL',"registeredBy"='actual-operator',"registeredAt"=CURRENT_TIMESTAMP,"registrationSnapshot"='{"confirmed":true}'::jsonb WHERE id='draft'`);
  await reject(`UPDATE "InsurancePolicyVersion" SET "reviewedBy"='fake-reviewer' WHERE id='draft'`);
  await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
 },{timeout:20000});}finally{await db.$disconnect();}
});
