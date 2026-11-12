import {syntheticSigningTime,syntheticFinalVerification} from './electronic-fixtures';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {offlineOrder} from './offline-fixtures';
import {signingParties,sha} from './electronic-fixtures';
import {createElectronicTask} from '../src/electronic-documents/repository';
import {finalizeElectronicArchive} from '../src/electronic-documents/archive';
import {activateElectronicSubscription,readElectronicSubscriptionReady} from '../src/electronic-documents/subscription';
import {readContractReady} from '../src/offline-documents/readiness';
import {assertNewEsignAllowed} from '../src/offline-documents/mode';
import {SignatureService} from '../src/orders/signature.service';
import {BillingService} from '../src/billing/billing';
import {canonicalHash} from '../src/customers/types';
const code=(s:string)=>(e:any)=>e?.getResponse?.().error?.code===s;

async function fixture(db:any){
 const f=await offlineOrder(db),now=new Date(),owner=await db.vehicleOwner.create({data:{name:'合成电子出租方',address:'合成地址',createdBy:'synthetic'}});
 const source=await db.storedFile.create({data:{customerId:f.customer.id,name:'合成原文.pdf',mimeType:'application/pdf',size:1024,sha256:sha('d'),storagePath:'synthetic-only',purpose:'electronic-source'}});
 const lessor={ownerId:owner.id,executionMode:'ELECTRONIC',vehicleId:f.vehicle.id};
 const parties=signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?f.customer.id:p.role==='OWNER'?owner.id:p.subjectId,autoAuthority:null,certificate:{...p.certificate,checkedAt:now.toISOString()}}));
 const context={kind:'SUBSCRIPTION' as const,platformSubjectId:'ninda',cooperationVersionId:'synthetic-cooperation',vehicleIds:[f.vehicle.id]};
 await db.order.update({where:{id:f.order.id},data:{contractMode:'ELECTRONIC',status:'AWAITING_SIGNATURE',finalPlanSnapshot:{...f.order.finalPlanSnapshot,lessorSnapshot:lessor,partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType}))}}});
 await db.contract.update({where:{id:f.contract.id},data:{executionMode:'ELECTRONIC',sourceFileId:source.id}});
 const archive=await db.documentArchive.create({data:{kind:'RENTAL',subjectType:'ORDER',subjectId:f.order.id,orderId:f.order.id,ownerId:owner.id,createdBy:'synthetic'}});
 const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,executionMode:'ELECTRONIC',templateId:'synthetic',templateVersion:1,sourceFileId:source.id,businessSnapshotHash:sha('a'),requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType})),scopeSnapshot:{electronicContext:context,vehicleId:f.vehicle.id,lessorHash:canonicalHash(lessor)}}});
 const task=await db.serial((tx:any)=>createElectronicTask(tx,{archiveVersionId:version.id,contractId:f.contract.id,context,parties,approvedBy:'synthetic',now}));
 const final=await db.storedFile.create({data:{customerId:f.customer.id,name:'合成签后.pdf',mimeType:'application/pdf',size:2048,sha256:sha('f'),storagePath:'synthetic-final',purpose:'electronic-final'}});
 return{...f,owner,source,archive,version,task,final};
}
async function signAll(db:any,f:any){
 const now=Date.now();
 await db.electronicSigningTask.update({where:{id:f.task.id},data:{status:'ARCHIVING',uploadStatus:'UPLOADED',uploadedAt:new Date(now-60000),filingStatus:'CONFIRMED',filedAt:new Date(now-5000),filingEvidenceHash:sha('b'),finalFileId:f.final.id,finalSha256:f.final.sha256,finalVerification:syntheticFinalVerification(f.task,f.final.sha256)}});
 for(const [i,p] of f.task.parties.entries()){
  const at=new Date(now-50000+i*10000),manualConsent={taskId:f.task.id,role:p.role,actorId:p.subjectId,sourceSha256:f.task.sourceSha256};
  await db.electronicSigningParty.update({where:{id:p.id},data:{manualConsent,manualConsentHash:canonicalHash(manualConsent)}});
  await db.electronicSigningParty.update({where:{id:p.id},data:{status:'SIGNED',attemptedAt:at,verifiedAt:new Date(at.getTime()+5000),...syntheticSigningTime(new Date(at.getTime()+1000)),queryEvidenceHash:sha(String(i+1))}});
 }
}

test('legacy dual-sign paths reject electronic contracts even when legacy flags are enabled',async()=>{
 assert.throws(()=>assertNewEsignAllowed({contractMode:'ELECTRONIC',executionMode:'ELECTRONIC',env:{ESIGN_NEW_REQUESTS_ENABLED:'true'}}),code('ELECTRONIC_WORKSPACE_REQUIRED'));
 const db=new Db();try{const f=await fixture(db);await assert.rejects(new SignatureService(db).settleContract(f.contract.id,{status:'SIGNED',documentHash:sha('a'),signedFileId:f.final.id}),code('ESIGN_MODE_MISMATCH'));}finally{await db.$disconnect();}
});
test('electronic payment requires all three verified signers and actual final archive, not a SIGNED flag',async()=>{
 const db=new Db();try{
  const f=await fixture(db);await db.contract.update({where:{id:f.contract.id},data:{status:'SIGNED'}});
  assert.equal((await readElectronicSubscriptionReady(db,f.order.id)).ready,false);
  let called=0;const gateway:any={create:async()=>{called++;throw new Error('Unexpected real payment dispatch');}};
  await assert.rejects(new BillingService(db,gateway).pay(f.customer,f.bill.id,randomUUID()),code('ELECTRONIC_ARCHIVE_REQUIRED'));assert.equal(called,0);
  await signAll(db,f);assert.equal((await readContractReady(db,f.order.id)).ready,false);
  await db.serial(tx=>finalizeElectronicArchive(tx,f.task.id));
  const result=await readContractReady(db,f.order.id);assert.equal(result.ready,true,JSON.stringify(result));
  await db.serial(tx=>activateElectronicSubscription(tx,f.task));
  const order=await db.order.findUniqueOrThrow({where:{id:f.order.id}}),contract=await db.contract.findUniqueOrThrow({where:{id:f.contract.id}});
  assert.equal(order.status,'AWAITING_PAYMENT');assert.equal(contract.status,'SIGNED');assert.equal(contract.signedFileId,f.final.id);assert.equal(await db.handover.count({where:{orderId:order.id}}),0);
  await db.serial(tx=>activateElectronicSubscription(tx,f.task));assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).revision,order.revision);
  await db.archiveVersion.update({where:{id:f.version.id},data:{invalidatedAt:new Date()}});assert.equal((await readContractReady(db,f.order.id)).ready,false);
 }finally{await db.$disconnect();}
});
test('archived subscription cannot activate a cancelled or changed order and rejects changed party bindings',async()=>{
 const db=new Db();try{
  const f=await fixture(db);await signAll(db,f);await db.serial(tx=>finalizeElectronicArchive(tx,f.task.id));
  await db.order.update({where:{id:f.order.id},data:{status:'CANCELLED'}});await assert.rejects(db.serial(tx=>activateElectronicSubscription(tx,f.task)),code('ELECTRONIC_BUSINESS_CHANGED'));
  await db.order.update({where:{id:f.order.id},data:{status:'AWAITING_SIGNATURE',finalPlanSnapshot:{...f.order.finalPlanSnapshot,lessorSnapshot:{ownerId:'foreign'}}}});
  assert.equal((await readElectronicSubscriptionReady(db,f.order.id)).ready,false);
 }finally{await db.$disconnect();}
});
