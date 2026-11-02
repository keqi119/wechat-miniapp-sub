import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {createElectronicTask,reserveElectronicOperation} from '../src/electronic-documents/repository';
import {finalizeElectronicArchive,loadElectronicArchiveProof} from '../src/electronic-documents/archive';
import {offlineOrder} from './offline-fixtures';
import {esignNow,sha,signingParties} from './electronic-fixtures';
const code=(value:string)=>(e:any)=>e?.getResponse?.().error?.code===value;

async function fixture(db:any){
  const base=await offlineOrder(db),owner=await db.vehicleOwner.create({data:{name:'合成电子签合作商',address:'合成地址',createdBy:'synthetic'}});
  await db.order.update({where:{id:base.order.id},data:{contractMode:'ELECTRONIC',status:'AWAITING_SIGNATURE'}});
  const source=await db.storedFile.create({data:{customerId:base.customer.id,name:'合成源文件.pdf',mimeType:'application/pdf',size:1024,sha256:sha('d'),storagePath:'synthetic-only',purpose:'electronic-source'}});
  await db.contract.update({where:{id:base.contract.id},data:{executionMode:'ELECTRONIC',sourceFileId:source.id}});
  const archive=await db.documentArchive.create({data:{kind:'RENTAL',subjectType:'ORDER',subjectId:base.order.id,orderId:base.order.id,ownerId:owner.id,createdBy:'synthetic'}});
  const parties=signingParties();parties[0].subjectId=base.customer.id;parties[1].subjectId=owner.id;parties[1].autoAuthority!.subjectId=owner.id;
  const context={kind:'SUBSCRIPTION' as const,platformSubjectId:'ninda',cooperationVersionId:'cooperation-v1',vehicleIds:['vehicle-a']};
  const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,executionMode:'ELECTRONIC',templateId:'synthetic-template',templateVersion:1,sourceFileId:source.id,businessSnapshotHash:sha('a'),requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType})),scopeSnapshot:{electronicContext:context}}});
  const input={archiveVersionId:version.id,contractId:base.contract.id,context,parties,approvedBy:'synthetic-operator',now:esignNow};
  return {...base,owner,source,archive,version,input};
}
test('one immutable task binds an archive version to its actual order, parties and original PDF; repeated prepare reuses provider IDs',async()=>{
  const db=new Db();try{
    const f=await fixture(db),first=await db.serial(tx=>createElectronicTask(tx,f.input)),second=await db.serial(tx=>createElectronicTask(tx,f.input));
    assert.equal(first.id,second.id);assert.equal(first.providerContractId,second.providerContractId);assert.deepEqual(first.parties.map((p:any)=>p.transactionId),second.parties.map((p:any)=>p.transactionId));
    assert.equal(first.parties.length,3);assert.equal(first.orderId,f.order.id);assert.equal(first.sourceSha256,f.source.sha256);
    const other=await offlineOrder(db);await assert.rejects(db.serial(tx=>createElectronicTask(tx,{...f.input,contractId:other.contract.id})),code('ELECTRONIC_REFERENCE_MISMATCH'));
    await assert.rejects(db.serial(tx=>createElectronicTask(tx,{...f.input,parties:f.input.parties.map((p:any)=>p.role==='OWNER'?{...p,subjectId:'another-owner'}:p)})),code('ELECTRONIC_PARTIES_MISMATCH'));
  }finally{await db.$disconnect();}
});
test('two competing operations persist a single upload intent and never return two dispatch permissions',async()=>{
  const db=new Db();try{
    const f=await fixture(db),task=await db.serial(tx=>createElectronicTask(tx,f.input));
    const input={taskId:task.id,revision:task.revision,kind:'UPLOAD' as const,now:esignNow};
    const results=await Promise.all([db.serial(tx=>reserveElectronicOperation(tx,input)),db.serial(tx=>reserveElectronicOperation(tx,input))]);
    assert.equal(results.filter(r=>r.dispatchRequired).length,1);assert.equal(results[0].operation.id,results[1].operation.id);
    assert.equal(await (db as any).electronicSigningOperation.count({where:{taskId:task.id}}),1);
    const saved=await (db as any).electronicSigningTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(saved.uploadStatus,'REQUESTED');
    const replay=await db.serial(tx=>reserveElectronicOperation(tx,input));assert.equal(replay.dispatchRequired,false);
  }finally{await db.$disconnect();}
});
test('an electronic archive needs Ningda signature and provider filing; it never fabricates a human reviewer',async()=>{
  const db=new Db();try{
    const f=await fixture(db),task=await db.serial(tx=>createElectronicTask(tx,f.input));
    await assert.rejects(db.serial(tx=>finalizeElectronicArchive(tx,task.id,esignNow)),code('ELECTRONIC_ARCHIVE_REQUIRED'));
    const final=await db.storedFile.create({data:{customerId:f.customer.id,name:'合成签署文件.pdf',mimeType:'application/pdf',size:2048,sha256:sha('f'),storagePath:'synthetic-final-only',purpose:'electronic-signed'}});
    await (db as any).electronicSigningTask.update({where:{id:task.id},data:{status:'ARCHIVING',uploadStatus:'UPLOADED',uploadedAt:new Date('2026-11-02T05:00:00Z'),filingStatus:'CONFIRMED',filedAt:new Date('2026-11-02T07:30:00Z'),filingEvidenceHash:sha('b'),finalFileId:final.id,finalSha256:final.sha256}});
    for(const party of task.parties.filter((p:any)=>p.mode==='MANUAL'))await db.electronicSigningParty.update({where:{id:party.id},data:{manualConsent:{taskId:task.id,role:party.role,actorId:party.subjectId,sourceSha256:task.sourceSha256},manualConsentHash:sha('a')}});
    for(const [i,party] of task.parties.entries())await (db as any).electronicSigningParty.update({where:{id:party.id},data:{status:i===2?'PENDING':'SIGNED',attemptedAt:i===2?null:new Date(`2026-11-02T06:${i}0:00Z`),verifiedAt:i===2?null:new Date(`2026-11-02T06:${i}5:00Z`),queryEvidenceHash:i===2?null:sha(String(i+1))}});
    await assert.rejects(db.serial(tx=>finalizeElectronicArchive(tx,task.id,esignNow)),code('ELECTRONIC_SIGNER_PROOF_REQUIRED'));
    await (db as any).electronicSigningParty.update({where:{id:task.parties[2].id},data:{status:'SIGNED',attemptedAt:new Date('2026-11-02T06:20:00Z'),verifiedAt:new Date('2026-11-02T06:25:00Z'),queryEvidenceHash:sha('3')}});
    const archived=await db.serial(tx=>finalizeElectronicArchive(tx,task.id,esignNow));assert.equal(archived.current,true);
    const v=await db.archiveVersion.findUniqueOrThrow({where:{id:f.version.id}});assert.equal(v.status,'ARCHIVED');assert.equal(v.reviewedBy,null);assert.equal(v.partyChecks,null);assert.equal(v.originalCustodian,null);
    const proof=await loadElectronicArchiveProof(db,f.version.id,esignNow);assert.equal(proof?.parties.length,3);assert.equal(proof?.finalFile.id,final.id);
    const replay=await db.serial(tx=>finalizeElectronicArchive(tx,task.id,esignNow));assert.equal(replay.taskId,task.id);
    assert.equal(await db.archiveFile.count({where:{versionId:f.version.id}}),1);
    await db.archiveFile.deleteMany({where:{versionId:f.version.id}});
    await assert.rejects(loadElectronicArchiveProof(db,f.version.id,esignNow),code('ELECTRONIC_ARCHIVE_MANIFEST_MISMATCH'));
    await assert.rejects(db.serial(tx=>finalizeElectronicArchive(tx,task.id,esignNow)),code('ELECTRONIC_ARCHIVE_MANIFEST_MISMATCH'));
  }finally{await db.$disconnect();}
});
test('database references and frozen signer bindings reject a foreign final file digest or identity replacement',async()=>{
  const db=new Db();try{
    const f=await fixture(db),task=await db.serial(tx=>createElectronicTask(tx,f.input));
    await assert.rejects((db as any).electronicSigningTask.update({where:{id:task.id},data:{sourceSha256:sha('0')}}));
    await assert.rejects((db as any).electronicSigningParty.update({where:{id:task.parties[1].id},data:{providerCustomerId:'foreign-account'}}));
    const version=await db.archiveVersion.create({data:{archiveId:f.archive.id,version:2,executionMode:'ELECTRONIC',templateId:'synthetic',templateVersion:1,businessSnapshotHash:sha('b'),requiredSigners:[],partiesSnapshot:[],scopeSnapshot:{}}});
    await assert.rejects((db as any).electronicSigningTask.update({where:{id:task.id},data:{archiveVersionId:version.id}}));
  }finally{await db.$disconnect();}
});
test('cooperation tasks bind both companies to the same partner agreement version, never a foreign owner or paper activation',async()=>{
  const db=new Db();try{
    const owner=await db.vehicleOwner.create({data:{name:'合成合作协议方',address:'合成地址',createdBy:'synthetic'}});
    const agreement=await db.partnerAgreement.create({data:{ownerId:owner.id,createdBy:'synthetic'}});
    const cooperation=await db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId:owner.id,version:1,contentHash:sha('a'),createdBy:'synthetic',partnerRateBps:8000}});
    const source=await db.storedFile.create({data:{name:'合成合作协议.pdf',mimeType:'application/pdf',size:1024,sha256:sha('d'),storagePath:'synthetic-cooperation',purpose:'electronic-source'}});
    const archive=await db.documentArchive.create({data:{kind:'OWNER_COOPERATION',subjectType:'PARTNER_AGREEMENT',subjectId:agreement.id,ownerId:owner.id,createdBy:'synthetic'}});
    const parties=signingParties().slice(1);parties[0].subjectId=owner.id;parties[0].autoAuthority!.subjectId=owner.id;
    const context={kind:'COOPERATION' as const,platformSubjectId:'ninda',cooperationVersionId:cooperation.id,vehicleIds:[]};
    const version=await (db as any).archiveVersion.create({data:{archiveId:archive.id,version:1,executionMode:'ELECTRONIC',templateId:'synthetic',templateVersion:1,sourceFileId:source.id,businessSnapshotHash:cooperation.contentHash,partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.subjectId,subjectType:p.subjectType})),requiredSigners:['OWNER','PLATFORM'],scopeSnapshot:{electronicContext:context}}});
    const task=await db.serial(tx=>createElectronicTask(tx,{archiveVersionId:version.id,cooperationVersionId:cooperation.id,context,parties,approvedBy:'synthetic',now:esignNow}));
    assert.equal(task.contractId,null);assert.equal(task.customerId,null);assert.equal(task.parties.length,2);assert(task.parties.every((p:any)=>p.mode==='MANUAL'));
    assert.equal((await db.partnerAgreement.findUniqueOrThrow({where:{id:agreement.id}})).status,'DRAFT');
    await assert.rejects((db as any).archiveVersion.update({where:{id:version.id},data:{status:'ARCHIVED',reviewedBy:'operator'}}));
    const foreign=await db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId:'foreign',version:2,contentHash:sha('a'),createdBy:'synthetic'}});
    await assert.rejects(db.serial(tx=>createElectronicTask(tx,{archiveVersionId:version.id,cooperationVersionId:foreign.id,context,parties,approvedBy:'synthetic',now:esignNow})),code('ELECTRONIC_REFERENCE_MISMATCH'));
  }finally{await db.$disconnect();}
});
test('database NULL semantics cannot mark an unverified signer or an unbound final file complete',async()=>{
  const db=new Db();try{
    const f=await fixture(db),task=await db.serial(tx=>createElectronicTask(tx,f.input));
    await assert.rejects((db as any).electronicSigningParty.update({where:{id:task.parties[0].id},data:{status:'SIGNED',attemptedAt:esignNow,verifiedAt:null,queryEvidenceHash:null}}));
    await assert.rejects((db as any).electronicSigningTask.update({where:{id:task.id},data:{finalFileId:f.source.id,finalSha256:null}}));
    await assert.rejects((db as any).archiveVersion.create({data:{archiveId:f.archive.id,version:2,executionMode:'ELECTRONIC',status:'ARCHIVED',templateId:'synthetic',templateVersion:1,businessSnapshotHash:sha('a'),partiesSnapshot:[],requiredSigners:[],scopeSnapshot:{}}}));
    await assert.rejects(db.serial(tx=>reserveElectronicOperation(tx,{taskId:task.id,revision:0,kind:'FILE',now:esignNow})),code('ELECTRONIC_OPERATION_NOT_AVAILABLE'));
    await (db as any).electronicSigningTask.update({where:{id:task.id},data:{status:'RETIRED',retiredAt:esignNow}});
    await assert.rejects(db.serial(tx=>reserveElectronicOperation(tx,{taskId:task.id,revision:0,kind:'UPLOAD',now:esignNow})),code('ELECTRONIC_OPERATION_NOT_AVAILABLE'));
  }finally{await db.$disconnect();}
});
