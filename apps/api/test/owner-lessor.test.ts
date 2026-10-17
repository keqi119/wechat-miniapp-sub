import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
import {buildLessorSnapshot,confirmLessor,lessorIdentityHash} from '../src/owner-signing/lessor';
let db:Db,f:any,snapshot:any;
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
before(async()=>{assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});process.env.OWNER_CONTRACTS_ENABLED='true';f=await ownerAuthorityFixture(db);const max=await db.legalDocument.aggregate({where:{type:'owner-data-sharing'},_max:{version:true}});await db.legalDocument.create({data:{type:'owner-data-sharing',version:(max._max.version||0)+1,title:'Synthetic notice',content:'向{{lessorName}}（{{lessorCreditCode}}，{{lessorAddress}}，{{lessorPhone}}）提供本单签约信息',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});const file=await db.storedFile.create({data:{name:'synthetic-evidence.pdf',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:'synthetic',purpose:'evidence',adminId:null}});await db.ownerVehicle.update({where:{vehicleId:f.vehicle.id},data:{evidenceFileId:file.id}});});
after(async()=>{delete process.env.OWNER_CONTRACTS_ENABLED;await db?.$disconnect();});
test('new final plans require approved owner vehicle and a verified actual lessor',async()=>{
 await db.ownerVehicle.update({where:{vehicleId:f.vehicle.id},data:{status:'DRAFT'}});await assert.rejects(buildLessorSnapshot(db,f.vehicle.id),error('OWNER_VEHICLE_REQUIRED'));
 await db.ownerVehicle.update({where:{vehicleId:f.vehicle.id},data:{status:'APPROVED'}});await db.vehicleOwner.update({where:{id:f.owner.id},data:{status:'DRAFT'}});await assert.rejects(buildLessorSnapshot(db,f.vehicle.id),error('OWNER_NOT_READY'));await db.vehicleOwner.update({where:{id:f.owner.id},data:{status:'VERIFIED'}});
 snapshot=await buildLessorSnapshot(db,f.vehicle.id);assert.equal(snapshot.name,f.owner.name);assert.equal(snapshot.ownerId,f.owner.id);assert.equal(snapshot.templateId,f.scope.templateId);assert.ok(!JSON.stringify(snapshot).includes('providerCustomerId'));assert.ok(!snapshot.sharingNotice.content.includes('{{'));
});
test('customer data sharing is a separate affirmative consent bound to this exact lessor and notice',async()=>{
 for(const input of [undefined,{accepted:false},{accepted:true,lessorHash:'forged'}])await assert.rejects(confirmLessor(db,f.customer.id,f.vehicle.id,snapshot,input));
 const result=await confirmLessor(db,f.customer.id,f.vehicle.id,snapshot,{accepted:true,lessorHash:lessorIdentityHash(snapshot),noticeHash:snapshot.sharingNotice.contentHash});assert.equal(result.ownerId,f.owner.id);assert.equal(result.customerId,f.customer.id);assert.equal(result.notice.contentHash,hash(result.notice.content));
});
test('owner authority toggles do not rewrite a proposal but changed recipient identity invalidates confirmation',async()=>{
 const input={accepted:true,lessorHash:lessorIdentityHash(snapshot),noticeHash:snapshot.sharingNotice.contentHash};await db.vehicleOwner.update({where:{id:f.owner.id},data:{revision:{increment:1}}});await confirmLessor(db,f.customer.id,f.vehicle.id,snapshot,input);
 await db.vehicleOwner.update({where:{id:f.owner.id},data:{contactPhone:'13800000000'}});await assert.rejects(confirmLessor(db,f.customer.id,f.vehicle.id,snapshot,input),error('OWNER_LESSOR_CHANGED'));
});
test('disabled owner contracts never silently route an owner-bound vehicle into Xiaolang signing',async()=>{process.env.OWNER_CONTRACTS_ENABLED='false';await assert.rejects(buildLessorSnapshot(db,f.vehicle.id),error('OWNER_CONTRACTS_DISABLED'));});
