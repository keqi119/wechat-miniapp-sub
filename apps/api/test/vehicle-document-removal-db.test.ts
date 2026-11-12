import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';

// Dedicated disposable container only; the exact URL is checked before client
// construction. This test creates and drops only its own transaction-local schema.
test('soft-remove migration keeps existing documents active and enforces paired removal evidence',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');assert.ok(target.hostname==='127.0.0.1'&&target.port==='55449'&&target.pathname==='/ninda_admin_ui_20261104'&&target.username==='ninda_admin_ui_20261104');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),schema='material_remove_probe_'+randomUUID().replaceAll('-','');assert.match(schema,/^material_remove_probe_[a-f0-9]{32}$/);
 try{await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await tx.$executeRawUnsafe('CREATE TABLE "Vehicle" (id TEXT PRIMARY KEY)');await tx.$executeRawUnsafe('CREATE TABLE "StoredFile" (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
  const migrate=async(name:string)=>{for(const sql of readFileSync(resolve(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8').split(';').filter(part=>part.trim()))await tx.$executeRawUnsafe(sql);};
  for(const name of ['202611030000_vehicle_document_stored_digest','202611030001_vehicle_document_files','202611030002_vehicle_document_digest_unique'])await migrate(name);
  await tx.$executeRawUnsafe('INSERT INTO "Vehicle"(id) VALUES (\'old-vehicle\')');await tx.$executeRawUnsafe('INSERT INTO "StoredFile"(id,sha256) VALUES (\'old-file\',repeat(\'a\',64))');
  await tx.$executeRawUnsafe('INSERT INTO "VehicleDocumentFile"("fileId","vehicleId",category,"sourceRelativePath",sha256,"uploadedBy") VALUES (\'old-file\',\'old-vehicle\',\'REGISTRATION\',\'historical/original.pdf\',repeat(\'a\',64),\'original-uploader\')');
  await migrate('202611040010_vehicle_document_soft_remove');
  const active=await tx.$queryRaw<any[]>`SELECT "removedAt","removedBy","sourceRelativePath" FROM "VehicleDocumentFile" WHERE "fileId"='old-file'`;
  assert.deepEqual(active,[{removedAt:null,removedBy:null,sourceRelativePath:'historical/original.pdf'}]);
  const reject=async(sql:string,expected='23514')=>{await tx.$executeRawUnsafe('SAVEPOINT invalid_remove');try{await assert.rejects(tx.$executeRawUnsafe(sql),(e:any)=>e.code==='P2010'&&e.meta?.code===expected);}finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_remove');await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_remove');}};
  await reject('UPDATE "VehicleDocumentFile" SET "removedAt"=CURRENT_TIMESTAMP WHERE "fileId"=\'old-file\'');
  await reject('UPDATE "VehicleDocumentFile" SET "removedBy"=\'operator\' WHERE "fileId"=\'old-file\'');
  await reject('UPDATE "VehicleDocumentFile" SET "removedAt"=CURRENT_TIMESTAMP,"removedBy"=\'  \' WHERE "fileId"=\'old-file\'');
  await tx.$executeRawUnsafe('UPDATE "VehicleDocumentFile" SET "removedAt"=CURRENT_TIMESTAMP,"removedBy"=\'operator\' WHERE "fileId"=\'old-file\'');
  const removed=await tx.$queryRaw<any[]>`SELECT "fileId","removedAt","removedBy","sourceRelativePath",sha256 FROM "VehicleDocumentFile" WHERE "fileId"='old-file'`;
  assert(removed[0].removedAt instanceof Date);assert.equal(removed[0].removedBy,'operator');assert.equal(removed[0].sourceRelativePath,'historical/original.pdf');assert.equal(removed[0].sha256,'a'.repeat(64));
  await reject('DELETE FROM "StoredFile" WHERE id=\'old-file\'','23503');
  await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
 },{timeout:20000});}finally{await db.$disconnect();}
});
