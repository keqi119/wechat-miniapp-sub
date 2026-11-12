import {hasActualSigningEvidence} from './signing-evidence';
import {randomUUID} from 'node:crypto';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {assertElectronicParties,electronicHash,electronicId,nextSigningAction,requiredSignerRoles,selectSigningModes} from './policy';
import type {ElectronicPartyBinding,ElectronicTaskFacts,SigningContext,SigningPartyInput,SignerRole} from './types';

export interface PrepareElectronicTaskInput {
  archiveVersionId:string;contractId?:string;cooperationVersionId?:string;sealGrantId?:string;
  context:SigningContext;parties:SigningPartyInput[];approvedBy:string;now:Date;
}
type FrozenParty=Omit<ElectronicPartyBinding,'mode'|'authorityEvidenceHash'>;
export interface ElectronicTaskSnapshot {
  schema:'NINDA_ELECTRONIC_V1';sealGrantId?:string;archiveVersionId:string;contractId:string|null;cooperationVersionId:string|null;
  context:SigningContext;businessHash:string;sourceFileId:string;sourceSha256:string;parties:FrozenParty[];
}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value));
const providerId=()=>`ND${randomUUID().replace(/-/g,'').slice(0,30)}`;
export function hasElectronicDocumentConsent(task:any,party:any){const c=party.documentConsent;return!!c&&party.documentConsentHash===canonicalHash(c)&&c.taskId===task.id&&c.role===party.role&&c.actorId&&c.sourceSha256===task.sourceSha256&&c.businessHash===task.businessHash&&c.identityHash===party.identityHash;}
export function frozenParty(p:any):FrozenParty{
  return {role:p.role,subjectId:p.subjectId,subjectType:p.subjectType,providerCustomerId:p.providerCustomerId,identityVersion:p.identityVersion,identityHash:p.identityHash,certSerialNo:p.certSerialNo??p.certificate?.serialNo,...((p.certSubjectHash??p.certificate?.subjectHash??p.identitySnapshot?.certificate?.subjectHash)?{certSubjectHash:p.certSubjectHash??p.certificate?.subjectHash??p.identitySnapshot?.certificate?.subjectHash}:{}),...(p.signatureId?{signatureId:p.signatureId}:{}),transactionId:p.transactionId};
}
export function assertElectronicTaskSnapshot(task:any):ElectronicTaskSnapshot{
  const s=task?.snapshot as ElectronicTaskSnapshot;
  ensure(s?.schema==='NINDA_ELECTRONIC_V1'&&canonicalHash(s)===task.snapshotHash&&s.archiveVersionId===task.archiveVersionId&&(s.sealGrantId??null)===(task.sealGrantId??null)&&s.contractId===(task.contractId??null)&&s.cooperationVersionId===(task.cooperationVersionId??null)&&s.context.kind===task.kind&&(!s.context.orderId||s.context.orderId===task.orderId)&&s.context.platformSubjectId===task.platformSubjectId&&s.businessHash===task.businessHash&&s.sourceFileId===task.sourceFileId&&s.sourceSha256===task.sourceSha256,409,'ELECTRONIC_SNAPSHOT_MISMATCH','签署任务冻结资料不匹配');
  assertElectronicParties(s.parties,s.context.kind);assertElectronicParties(task.parties,s.context.kind);
  for(const p of task.parties)ensure(canonicalHash(frozenParty(p))===canonicalHash(s.parties.find(b=>b.role===p.role)),409,'ELECTRONIC_SNAPSHOT_MISMATCH','签署主体冻结资料不匹配');
  const owner=task.parties.find((p:any)=>p.role==='OWNER');if(task.kind.startsWith('COOPERATION')&&owner?.mode==='AUTO'&&owner.attemptedAt)ensure(hasElectronicDocumentConsent(task,owner),409,'ELECTRONIC_COOPERATION_ACCEPTANCE_REQUIRED','本版合作协议缺少本人确认凭据');
  return s;
}
export function electronicTaskFacts(task:any):ElectronicTaskFacts{
  const snapshot=assertElectronicTaskSnapshot(task);
  return {id:task.id,kind:task.kind,context:snapshot.context,status:task.status,uploadStatus:task.uploadStatus,filingStatus:task.filingStatus,businessApproved:!!task.approvedAt&&electronicId(task.approvedBy),sourceSha256:task.sourceSha256,
    parties:task.parties.map((p:any)=>({...p.identitySnapshot,...frozenParty(p),certificate:{...p.identitySnapshot?.certificate,serialNo:p.certSerialNo},mode:p.mode,status:p.status,requiresEvidenceEnrichment:p.status==='SIGNED'&&!hasActualSigningEvidence(p),documentAccepted:hasElectronicDocumentConsent(task,p)}))};
}
export async function lockElectronicTask(tx:any,id:string){
  const binding=await tx.electronicSigningTask.findUnique({where:{id},select:{kind:true,orderId:true}});
  if(binding&&['PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION'].includes(binding.kind)&&binding.orderId){
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${binding.orderId} FOR UPDATE`;
    if(binding.kind==='PRE_DELIVERY_CANCELLATION')await tx.$queryRaw`SELECT id FROM "OrderPreDeliveryCancellation" WHERE "orderId"=${binding.orderId} ORDER BY id FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "OrderTermination" WHERE "orderId"=${binding.orderId} ORDER BY id FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT id FROM "ElectronicSigningTask" WHERE id=${id} FOR UPDATE`;
  const task=await tx.electronicSigningTask.findUnique({where:{id},include:{parties:true}});
  ensure(task,404,'NOT_FOUND','电子签任务不存在');assertElectronicTaskSnapshot(task);return task;
}
export async function createElectronicTask(tx:any,input:PrepareElectronicTaskInput){
  ensure(electronicId(input.archiveVersionId)&&electronicId(input.approvedBy)&&Number.isFinite(input.now.getTime()),400,'ELECTRONIC_PREPARATION_INVALID','签署准备信息不完整');
  await tx.$queryRaw`SELECT id FROM "ArchiveVersion" WHERE id=${input.archiveVersionId} FOR UPDATE`;
  const version=await tx.archiveVersion.findUnique({where:{id:input.archiveVersionId},include:{archive:true}});
  ensure(version?.executionMode==='ELECTRONIC'&&!version.invalidatedAt&&version.sourceFileId&&electronicHash(version.businessSnapshotHash),409,'ELECTRONIC_SOURCE_REQUIRED','请先准备本版电子合同原文');
  await assertNoUnclosedSigning(tx,version.archive.subjectType,version.archive.subjectId);
  const archive=version.archive,roles=requiredSignerRoles(input.context.kind);
  assertElectronicParties(input.parties,input.context.kind);
  ensure(Array.isArray(version.requiredSigners)&&version.requiredSigners.length===roles.length&&roles.every(role=>version.requiredSigners.includes(role))&&Array.isArray(version.partiesSnapshot)&&version.partiesSnapshot.length===roles.length&&input.parties.every(p=>version.partiesSnapshot.filter((v:any)=>v.role===p.role&&v.partyId===p.subjectId&&v.subjectType===p.subjectType).length===1)&&input.parties.find(p=>p.role==='OWNER')!.subjectId===archive.ownerId,409,'ELECTRONIC_PARTIES_MISMATCH','实际签署主体与本版业务文件不一致');
  ensure(version.scopeSnapshot?.electronicContext&&canonicalHash(version.scopeSnapshot.electronicContext)===canonicalHash(input.context),409,'ELECTRONIC_SCOPE_MISMATCH','签署文件范围与业务版本不一致');
  const source=await tx.storedFile.findUnique({where:{id:version.sourceFileId}});
  ensure(source&&source.mimeType==='application/pdf'&&source.size>0&&electronicHash(source.sha256),409,'ELECTRONIC_SOURCE_REQUIRED','电子合同原文件尚未核验');
  let orderId:string|null=null,customerId:string|null=null;
  if(input.contractId&&!input.cooperationVersionId){
    const contract=await tx.contract.findUnique({where:{id:input.contractId},include:{order:true}});
    ensure(contract?.executionMode==='ELECTRONIC'&&contract.order.contractMode==='ELECTRONIC'&&contract.orderId===archive.orderId&&(!input.context.orderId||input.context.orderId===contract.orderId)&&contract.customerId===input.parties.find(p=>p.role==='CUSTOMER')?.subjectId&&contract.documentHash===version.businessSnapshotHash&&contract.sourceFileId===source.id&&source.customerId===contract.customerId&&!input.context.kind.startsWith('COOPERATION'),409,'ELECTRONIC_REFERENCE_MISMATCH','电子签合同与订单归属不匹配');
    orderId=contract.orderId;customerId=contract.customerId;
  }else if(input.sealGrantId){
    const grant=await tx.electronicSealGrant.findUnique({where:{id:input.sealGrantId}}),main=grant?await tx.electronicSigningTask.findUnique({where:{id:grant.mainTaskId}}):null;
    ensure(!input.contractId&&!input.cooperationVersionId&&grant&&main&&input.context.kind==='COOPERATION_GRANT'&&grant.ownerId===archive.ownerId&&archive.subjectType==='ELECTRONIC_SEAL_GRANT'&&archive.subjectId===grant.id&&main.businessHash===version.businessSnapshotHash&&!source.customerId,409,'ELECTRONIC_REFERENCE_MISMATCH','独立授权归属不匹配');
  }else{
    const cooperation=input.cooperationVersionId?await tx.partnerAgreementVersion.findUnique({where:{id:input.cooperationVersionId}}):null;
    ensure(!input.contractId&&cooperation&&input.context.kind.startsWith('COOPERATION')&&cooperation.ownerId===archive.ownerId&&cooperation.agreementId===archive.subjectId&&archive.subjectType==='PARTNER_AGREEMENT'&&!archive.orderId&&cooperation.contentHash===version.businessSnapshotHash&&!source.customerId,409,'ELECTRONIC_REFERENCE_MISMATCH','电子合作协议与合作商归属不匹配');
  }
  const existing=await tx.electronicSigningTask.findUnique({where:{archiveVersionId:version.id},include:{parties:true}});
  if(existing){
    const snapshot=assertElectronicTaskSnapshot(existing);
    ensure(snapshot.contractId===(input.contractId??null)&&snapshot.cooperationVersionId===(input.cooperationVersionId??null)&&snapshot.sourceFileId===source.id&&snapshot.sourceSha256===source.sha256&&snapshot.businessHash===version.businessSnapshotHash,409,'ELECTRONIC_REFERENCE_MISMATCH','已有电子签任务不可改绑');
    for(const p of input.parties){const saved=existing.parties.find((s:any)=>s.role===p.role);ensure(canonicalHash(frozenParty({...p,transactionId:saved.transactionId}))===canonicalHash(frozenParty(saved)),409,'ELECTRONIC_IDENTITY_CHANGED','已准备任务的实名身份或印章已变更，请处理原任务');}
    return existing;
  }
  ensure(['DRAFT','PREPARED'].includes(version.status),409,'ELECTRONIC_PREPARATION_STATE','当前文件版本不可准备新签署');
  const modes=selectSigningModes(input.parties,input.now,input.context);
  const parties=roles.map(role=>{const p=input.parties.find(p=>p.role===role)!;return{role:p.role,subjectId:p.subjectId,subjectType:p.subjectType,providerCustomerId:p.providerCustomerId,identityVersion:p.identityVersion,identityHash:p.identityHash,certSerialNo:p.certificate.serialNo,signatureId:p.signatureId??null,transactionId:providerId(),mode:modes.modes[role]!,identitySnapshot:json(p),authorityEvidenceHash:modes.modes[role]==='AUTO'?canonicalHash(p.autoAuthority):null};});
  const snapshot:ElectronicTaskSnapshot={schema:'NINDA_ELECTRONIC_V1',...(input.sealGrantId?{sealGrantId:input.sealGrantId}:{}),archiveVersionId:version.id,contractId:input.contractId??null,cooperationVersionId:input.cooperationVersionId??null,context:input.context,businessHash:version.businessSnapshotHash,sourceFileId:source.id,sourceSha256:source.sha256,parties:parties.map(frozenParty)};
  const task=await tx.electronicSigningTask.create({data:{sealGrantId:input.sealGrantId??null,archiveVersionId:version.id,contractId:input.contractId??null,cooperationVersionId:input.cooperationVersionId??null,orderId,customerId,ownerId:archive.ownerId,platformSubjectId:input.context.platformSubjectId,kind:input.context.kind,businessHash:version.businessSnapshotHash,sourceFileId:source.id,sourceSha256:source.sha256,providerContractId:providerId(),snapshot:json(snapshot),snapshotHash:canonicalHash(snapshot),approvedBy:input.approvedBy,approvedAt:input.now,parties:{create:parties}},include:{parties:true}});
  await tx.archiveVersion.update({where:{id:version.id},data:{status:'SIGNING'}});return task;
}
export interface ReserveElectronicOperationInput {taskId:string;revision:number;kind:'UPLOAD'|'SIGN'|'FILE'|'DOWNLOAD';role?:SignerRole;now:Date;}
export async function reserveElectronicOperation(tx:any,input:ReserveElectronicOperationInput){
  const task=await lockElectronicTask(tx,input.taskId);let operationKey=`${task.id}:${input.kind}:${input.role??''}`;
  const existing=input.kind==='FILE'?await tx.electronicSigningOperation.findFirst({where:{taskId:task.id,kind:'FILE'},orderBy:{requestedAt:'desc'}}):await tx.electronicSigningOperation.findUnique({where:{operationKey}});
  if(existing){
    if(!(input.kind==='FILE'&&existing.status==='FAILED'&&task.filingStatus==='NOT_STARTED'&&task.lastErrorCode==='ELECTRONIC_FILING_RETRYABLE'))return{task,operation:existing,dispatchRequired:false};
    operationKey+=':retry:'+await tx.electronicSigningOperation.count({where:{taskId:task.id,kind:'FILE'}});
  }
  ensure(task.revision===input.revision,409,'VERSION_CONFLICT','签署任务已变化，请刷新');
  const action=nextSigningAction(electronicTaskFacts(task),input.now),wanted=input.kind==='DOWNLOAD'?'ARCHIVE':input.kind;
  ensure(action.kind===wanted&&(action.kind!=='SIGN'||action.role===input.role),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','当前签署阶段不允许此操作');
  const party=input.kind==='SIGN'?task.parties.find((p:any)=>p.role===input.role):null;
  const requestHash=canonicalHash({snapshotHash:task.snapshotHash,kind:input.kind,role:input.role??null,transactionId:party?.transactionId??null,mode:party?.mode??null});
  const operation=await tx.electronicSigningOperation.create({data:{taskId:task.id,partyId:party?.id??null,operationKey,kind:input.kind,token:randomUUID(),requestHash,requestedAt:input.now}});
  const data:any={revision:{increment:1},processingToken:operation.token,processingUntil:new Date(input.now.getTime()+60000)};
  if(input.kind==='UPLOAD'){data.uploadStatus='REQUESTED';data.status='SIGNING';}
  if(input.kind==='FILE'){data.filingStatus='REQUESTED';data.status='FILING';}
  if(input.kind==='DOWNLOAD')data.status='ARCHIVING';
  if(party){data.status='SIGNING';await tx.electronicSigningParty.update({where:{id:party.id},data:{attemptedAt:input.now,status:party.mode==='AUTO'?'UNKNOWN':'ISSUED'}});}
  const claimed=await tx.electronicSigningTask.update({where:{id:task.id},data,include:{parties:true}});
  return{task:claimed,operation,dispatchRequired:true};
}

/** A local stop never releases a business resource with accepted external transactions. */
export async function assertNoUnclosedSigning(tx:any,subjectType:string,subjectId:string){
 const pending=await tx.electronicSigningTask.findFirst({where:{status:{in:['WITHDRAWN','RETIRED','DECLINED','EXPIRED']},OR:[{stopStatus:null},{stopStatus:{not:'PROVIDER_CLOSED'}}],parties:{some:{attemptedAt:{not:null}}},archiveVersion:{archive:{subjectType,subjectId}}},select:{id:true}});
 ensure(!pending,409,'ELECTRONIC_STOP_REVIEW_REQUIRED','原业务版本存在尚未证明渠道关闭的签署交易');
}
