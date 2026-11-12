import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {shanghaiDay} from '../usage/rules';
import {assertElectronicArchiveProof} from './proof';
import {assertElectronicTaskSnapshot,frozenParty,lockElectronicTask} from './repository';
import type {ElectronicArchiveProof,ElectronicBinding,ElectronicSignerProof,SigningMode} from './types';

const iso=(value:Date|null|undefined)=>value?.toISOString()??'';
const manifestHash=(file:ElectronicArchiveProof['finalFile'])=>canonicalHash([{fileId:file.id,sha256:file.sha256,size:file.size}]);
export async function proofFor(tx:any,task:any,archivedAt:Date,now:Date){
  const snapshot=assertElectronicTaskSnapshot(task);
  ensure(task.uploadStatus==='UPLOADED'&&task.filingStatus==='CONFIRMED'&&task.finalFileId&&task.finalSha256,409,'ELECTRONIC_ARCHIVE_REQUIRED','签署及归档步骤尚未齐备');
  const [source,final]=await Promise.all([tx.storedFile.findUnique({where:{id:task.sourceFileId}}),tx.storedFile.findUnique({where:{id:task.finalFileId}})]);
  ensure(source&&final&&source.customerId===(task.customerId??null)&&final.customerId===(task.customerId??null),409,'ELECTRONIC_FINAL_PDF_REQUIRED','电子签文件归属不匹配');
  const parties:ElectronicSignerProof[]=task.parties.map((p:any)=>({...frozenParty(p),providerContractId:task.providerContractId,sourceSha256:task.sourceSha256,status:p.status,mode:p.mode,attemptedAt:iso(p.attemptedAt),verifiedAt:iso(p.verifiedAt),providerSignedAt:iso(p.providerSignedAt),providerSignedAtRaw:p.providerSignedAtRaw,providerSignedAtPrecisionMs:p.providerSignedAtPrecisionMs,queryEvidenceHash:p.enrichmentQueryEvidenceHash??p.queryEvidenceHash,...(p.authorityEvidenceHash?{authorityEvidenceHash:p.authorityEvidenceHash}:{})}));
  const proof:ElectronicArchiveProof={taskId:task.id,archiveVersionId:task.archiveVersionId,kind:task.kind,businessHash:task.businessHash,providerContractId:task.providerContractId,status:'ARCHIVED',finalVerification:task.finalVerification,sourceFile:{id:source.id,sha256:source.sha256},finalFile:{id:final.id,sha256:final.sha256,mimeType:final.mimeType,size:final.size},uploadedAt:iso(task.uploadedAt),parties,filing:{status:task.filingStatus,providerContractId:task.providerContractId,responseHash:task.filingEvidenceHash,confirmedAt:iso(task.filedAt)},archivedAt:iso(archivedAt)};
  const expected:ElectronicBinding={taskId:task.id,archiveVersionId:task.archiveVersionId,kind:task.kind,businessHash:snapshot.businessHash,providerContractId:task.providerContractId,sourceFileId:snapshot.sourceFileId,sourceSha256:snapshot.sourceSha256,finalFileId:task.finalFileId,finalSha256:task.finalSha256,now,parties:snapshot.parties.map(p=>{const actual=task.parties.find((v:any)=>v.role===p.role)!;return{...p,mode:actual.mode as SigningMode,...(actual.authorityEvidenceHash?{authorityEvidenceHash:actual.authorityEvidenceHash}:{})};})};
  assertElectronicArchiveProof(proof,expected);return proof;
}
export async function loadElectronicArchiveProof(tx:any,archiveVersionId:string,now=new Date()):Promise<ElectronicArchiveProof|null>{
  const version=await tx.archiveVersion.findUnique({where:{id:archiveVersionId},include:{electronicTask:{include:{parties:true}}}});
  if(!version?.electronicTask)return null;
  const task=version.electronicTask;
  ensure(version.executionMode==='ELECTRONIC'&&version.status==='ARCHIVED'&&!version.invalidatedAt&&task.status==='ARCHIVED'&&task.archivedAt&&version.businessSnapshotHash===task.businessHash&&version.sourceFileId===task.sourceFileId,409,'ELECTRONIC_ARCHIVE_REQUIRED','电子合同归档证据不完整或已失效');
  const proof=await proofFor(tx,task,task.archivedAt,now),files=await tx.archiveFile.findMany({where:{versionId:version.id}});
  ensure(files.length===1&&files[0].fileId===proof.finalFile.id&&files[0].position===0&&files[0].uploadedRole==='PROVIDER'&&version.fileManifestHash===manifestHash(proof.finalFile),409,'ELECTRONIC_ARCHIVE_MANIFEST_MISMATCH','电子归档文件清单缺失或发生变化');
  return proof;
}
export async function finalizeElectronicArchive(tx:any,taskId:string,now=new Date()){
  const task=await lockElectronicTask(tx,taskId);
  ensure(['ARCHIVING','ARCHIVED'].includes(task.status)&&!task.retiredAt&&!task.withdrawnAt,409,'ELECTRONIC_ARCHIVE_REQUIRED','当前任务不允许完成归档');
  const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}});
  ensure(version?.executionMode==='ELECTRONIC'&&!version.invalidatedAt&&version.businessSnapshotHash===task.businessHash&&version.sourceFileId===task.sourceFileId,409,'ELECTRONIC_BINDING_MISMATCH','签署文件业务版本已变更');
  const proof=await proofFor(tx,task,task.archivedAt??now,now);
  if(task.status!=='ARCHIVED'){
    await tx.electronicSigningTask.update({where:{id:task.id},data:{status:'ARCHIVED',legalCompletedAt:new Date(Math.max(...proof.parties.map(p=>Date.parse(p.providerSignedAt)))),archivedAt:now,revision:{increment:1},processingToken:null,processingUntil:null,lastErrorCode:null}});
    const file=await tx.archiveFile.findUnique({where:{fileId:proof.finalFile.id}});
    ensure(!file||file.versionId===version.id,409,'ELECTRONIC_FILE_ALREADY_BOUND','签后文件已归属于其他合同版本');
    if(!file)await tx.archiveFile.create({data:{versionId:version.id,fileId:proof.finalFile.id,position:0,uploadedBy:'FADADA_VERIFIED',uploadedRole:'PROVIDER'}});
    const lastSignedAt=Math.max(...proof.parties.map(p=>Date.parse(p.providerSignedAt)));
    await tx.archiveVersion.update({where:{id:version.id},data:{status:'ARCHIVED',signedOn:shanghaiDay(new Date(lastSignedAt)),fileManifestHash:manifestHash(proof.finalFile)}});
  }else await loadElectronicArchiveProof(tx,version.id,now);
  await tx.$queryRaw`SELECT id FROM "DocumentArchive" WHERE id=${version.archiveId} FOR UPDATE`;
  const latest=await tx.archiveVersion.findFirst({where:{archiveId:version.archiveId},orderBy:{version:'desc'},select:{id:true}}),current=latest?.id===version.id;
  if(current&&version.archive.currentApprovedVersionId!==version.id)await tx.documentArchive.update({where:{id:version.archiveId},data:{currentApprovedVersionId:version.id,revision:{increment:1}}});
  return{taskId:task.id,archiveVersionId:version.id,current};
}

/** Separate evidence record: never marks a version approved or calls business activation. */
export async function captureStoppedSigningEvidence(tx:any,taskId:string,proof:ElectronicArchiveProof):Promise<{evidenceId:string;finalFileId:string}>{
 const task=await lockElectronicTask(tx,taskId);
 ensure(task.withdrawnAt||task.retiredAt,409,'ELECTRONIC_STOP_REQUIRED','只有停派任务可独立保全证据');
 const checked=await proofFor(tx,task,new Date(proof.archivedAt),new Date());
 ensure(canonicalHash(checked)===canonicalHash(proof),409,'ELECTRONIC_BINDING_MISMATCH','保全证据与冻结任务不匹配');
 const saved=await tx.electronicStoppedEvidence.upsert({where:{taskId},create:{taskId,finalFileId:proof.finalFile.id,proof},update:{}});
 ensure(saved.finalFileId===proof.finalFile.id,409,'ELECTRONIC_BINDING_MISMATCH','已有保全文件不可替换');
 await tx.electronicSigningTask.update({where:{id:taskId},data:{stoppedEvidenceId:saved.id,legalCompletedAt:new Date(Math.max(...proof.parties.map(p=>Date.parse(p.providerSignedAt))))}});
 return{evidenceId:saved.id,finalFileId:saved.finalFileId};
}
