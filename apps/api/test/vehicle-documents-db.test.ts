import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../src/common/db';
import {JourneyHarness,command} from './seven-module-journey-fixtures';

test('archive migrations supply their own stored-file digest prerequisite on the production-era tables',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),schema='vehicle_doc_probe_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^vehicle_doc_probe_[a-f0-9]{32}$/);
 try{await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  await tx.$executeRawUnsafe('CREATE TABLE "Vehicle" (id TEXT PRIMARY KEY)');
  await tx.$executeRawUnsafe('CREATE TABLE "StoredFile" (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
  for(const name of ['202611030000_vehicle_document_stored_digest','202611030001_vehicle_document_files','202611030002_vehicle_document_digest_unique']){
   const sql=readFileSync(resolve(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8');
   for(const statement of sql.split(';').filter(part=>part.trim()))await tx.$executeRawUnsafe(statement);
  }
  const indexes=await tx.$queryRaw<any[]>`SELECT indexname FROM pg_indexes WHERE schemaname=${schema}`;
  assert.ok(indexes.some(row=>row.indexname==='StoredFile_vehicle_document_digest_key'));
  assert.ok(indexes.some(row=>row.indexname==='VehicleDocumentFile_vehicleId_sourceRelativePath_key'));
  await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
 },{timeout:20000});}finally{await db.$disconnect();}
});

test('vehicle original document schema isolates identity, digest and source path without changing business revision',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),suffix=randomUUID(),vehicleId='doc-schema-'+suffix,fileId='doc-file-'+suffix,hash='a'.repeat(64);
 try{
  await db.vehicle.create({data:{id:vehicleId,title:'合成档案车辆',brand:'合成',model:'EV',year:2026,city:'上海',mileageKm:100,status:'DRAFT'}});
  const baseline=await db.$queryRaw<any[]>`SELECT "revision","documentRevision","status","mileageKm" FROM "Vehicle" WHERE id=${vehicleId}`;
  assert.equal(baseline[0].documentRevision,0);
  await db.storedFile.create({data:{id:fileId,adminId:'synthetic-admin',name:'合成证件.pdf',mimeType:'application/pdf',size:10,sha256:hash,storagePath:'synthetic-not-read',purpose:'vehicle-document'}});
  await db.$executeRaw`INSERT INTO "VehicleDocumentFile" ("fileId","vehicleId","category","sourceRelativePath","sha256","uploadedBy") VALUES (${fileId},${vehicleId},'REGISTRATION','证件/合成.pdf',${hash},'synthetic-admin')`;
  const rejected=(error:any)=>error?.code==='P2010'&&['23503','23505','23514'].includes(error.meta?.code);
  await assert.rejects(db.$executeRaw`UPDATE "VehicleDocumentFile" SET "sha256"=${'b'.repeat(64)} WHERE "fileId"=${fileId}`,rejected);
  await assert.rejects(db.$executeRaw`UPDATE "VehicleDocumentFile" SET "vehicleId"='missing-vehicle' WHERE "fileId"=${fileId}`,rejected);
  await assert.rejects(db.$executeRaw`UPDATE "VehicleDocumentFile" SET category='PUBLIC' WHERE "fileId"=${fileId}`,rejected);
  for(const path of ['','../outside.pdf','/absolute.pdf','folder/../outside.pdf','C:/outside.pdf'])await assert.rejects(db.$executeRaw`UPDATE "VehicleDocumentFile" SET "sourceRelativePath"=${path} WHERE "fileId"=${fileId}`,rejected);
  await assert.rejects(db.$executeRaw`UPDATE "Vehicle" SET "documentRevision"=-1 WHERE id=${vehicleId}`,rejected);
  await db.$executeRaw`UPDATE "Vehicle" SET "documentRevision"="documentRevision"+1 WHERE id=${vehicleId}`;
  const after=await db.$queryRaw<any[]>`SELECT "revision","documentRevision","status","mileageKm" FROM "Vehicle" WHERE id=${vehicleId}`;
  assert.deepEqual(after[0],{...baseline[0],documentRevision:1});
  await assert.rejects(db.storedFile.delete({where:{id:fileId}}));
 }finally{
  await db.$executeRaw`DELETE FROM "VehicleDocumentFile" WHERE "vehicleId"=${vehicleId}`.catch(()=>{});
  await db.storedFile.deleteMany({where:{id:fileId}});
  await db.vehicle.deleteMany({where:{id:vehicleId}});
  await db.$disconnect();
 }
});

test('vehicle originals API persists bytes with replay protection and keeps private documents outside public media',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();
  const vehicle=await h.db.vehicle.create({data:{title:'合成原件归档车辆',brand:'合成',model:'EV',year:2026,city:'上海',mileageKm:123,status:'DRAFT'}});
  const other=await h.db.vehicle.create({data:{title:'合成其他车辆',brand:'合成',model:'EV',year:2026,city:'上海',mileageKm:456,status:'DRAFT'}});
  const path='/admin/vehicles/'+vehicle.id+'/documents',input={...command(),vehicleRevision:vehicle.revision,category:'REGISTRATION',sourceRelativePath:'证件/登记证.pdf'};
  const before=await h.get(path);assert.equal(before.revision,0);assert.deepEqual(before.items,[]);
  const bytes='%PDF-1.4\nsynthetic vehicle-original-bytes\n%%EOF';
  const body=()=>{const form=new FormData();for(const[k,v]of Object.entries(input))form.set(k,String(v));form.set('file',new Blob([bytes],{type:'application/pdf'}),'synthetic-original.pdf');return form;};
  const uploaded=await h.post(path,body());
  const replay=await h.post(path,body());assert.deepEqual(replay,uploaded);
  assert.equal(uploaded.revision,1);assert.equal(uploaded.vehicleRevision,vehicle.revision);
  const list=await h.get(path);assert.equal(list.items.length,1);assert.equal(list.items[0].sourceRelativePath,input.sourceRelativePath);
  const actual=await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}});assert.equal(actual.revision,vehicle.revision);assert.equal(actual.documentRevision,1);assert.equal(actual.mileageKm,123);assert.deepEqual(actual.mediaFileIds,[]);
  const download=await fetch(h.base+'/api'+path+'/'+uploaded.id,{headers:h.maker.headers});assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition')||'',/^attachment;/);assert.match(download.headers.get('Cache-Control')||'',/no-store/);
  assert.equal(Buffer.from(await download.arrayBuffer()).toString(),'%PDF-1.4\nsynthetic vehicle-original-bytes\n%%EOF');
  for(const actor of [h.finance,h.support,h.field])assert.equal((await h.raw(path,undefined,actor)).status,403);
  assert.equal((await h.raw('/admin/vehicles/'+other.id+'/documents/'+uploaded.id,undefined)).status,404);
  assert.equal((await h.raw('/admin/files/'+uploaded.id,undefined)).status,403);
  assert.equal((await h.raw(path,h.form({...input,idempotencyKey:randomUUID(),sourceRelativePath:'证件/第二份.pdf'},'different'))).status,409);
  assert.equal((await h.raw(path,h.form(input,'changed-bytes'))).status,409);
  await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'PUBLISHED',coverFileId:uploaded.id,mediaFileIds:[uploaded.id]}});
  await h.db.storedFile.update({where:{id:uploaded.id},data:{purpose:'vehicle',mimeType:'image/png'}});
  assert.equal((await fetch(h.base+'/api/public/media/'+uploaded.id)).status,404);
  assert.equal((await h.raw('/admin/files/'+uploaded.id,undefined)).status,403);
  assert.equal(await h.db.vehicleDocumentFile.count({where:{vehicleId:vehicle.id}}),1);
  assert.equal(h.externalCalls,0);assert.equal(h.payment.providerCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});
