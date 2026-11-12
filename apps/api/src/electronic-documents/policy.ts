import {ensure} from '../common/errors';
import {electronicDocumentKinds} from './types';
import {PLATFORM_SIGNING_GRANTEE,platformAutoDocumentKinds} from '../owner-signing/platform-scope';
import type {ElectronicAction,ElectronicDocumentKind,ElectronicTaskFacts,SignerRole,SigningContext,SigningModes,SigningPartyInput} from './types';

export const electronicHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const electronicId=(value:unknown):value is string=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
export const electronicInstant=(value:unknown):number=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const fresh=(value:unknown,now:Date,maxAgeMs=24*60*60*1000)=>{const time=electronicInstant(value);return Number.isFinite(time)&&time<=now.getTime()&&now.getTime()-time<maxAgeMs;};

export function requiredSignerRoles(kind:ElectronicDocumentKind):SignerRole[]{
  ensure(electronicDocumentKinds.includes(kind),409,'ELECTRONIC_KIND_INVALID','此类记录不属于电子合同签署范围');
  return kind.startsWith('COOPERATION')?['OWNER','PLATFORM']:['CUSTOMER','OWNER','PLATFORM'];
}
export function assertElectronicParties(parties:Array<{role:SignerRole;subjectId:string}>,kind:ElectronicDocumentKind){
  const roles=requiredSignerRoles(kind);
  ensure(Array.isArray(parties)&&parties.length===roles.length&&roles.every(role=>parties.filter(p=>p?.role===role&&electronicId(p.subjectId)).length===1),409,'ELECTRONIC_PARTIES_MISMATCH','本文件的必需签署主体不完整或重复');
}
export function electronicIdentityReady(p:SigningPartyInput,now:Date):boolean{
  const cert=p?.certificate,at=now.getTime();
  return Number.isFinite(at)&&p?.identityVerified===true&&['INDIVIDUAL','ENTERPRISE'].includes(p.subjectType)&&electronicId(p.providerCustomerId)&&Number.isSafeInteger(p.identityVersion)&&p.identityVersion>0&&electronicHash(p.identityHash)&&!!cert&&electronicId(cert.serialNo)&&cert.status==='VALID'&&electronicInstant(cert.validFrom)<=at&&electronicInstant(cert.validUntil)>at&&fresh(cert.checkedAt,now)&&(p.subjectType!=='ENTERPRISE'||electronicId(p.signatureId));
}
export function electronicAutoAuthorityReady(p:SigningPartyInput,context:SigningContext,now:Date):boolean{
  if(context.signaturePolicy==='MANUAL_ONLY')return false;
  const a=p.autoAuthority,at=now.getTime();
  if(context.autoSigningPolicyVersion===3&&a?.policyVersion!==3)return false;
  const delegateReady=a?.policyVersion===3?a.platformSubjectId===context.platformSubjectId&&a.delegateSubjectId===PLATFORM_SIGNING_GRANTEE.id&&electronicHash(a.applicationBinding)&&platformAutoDocumentKinds.includes(context.kind as any):a?.delegateSubjectId===context.platformSubjectId;
  return p.role!=='CUSTOMER'&&p.subjectType==='ENTERPRISE'&&!!a&&electronicId(a.id)&&a.subjectId===p.subjectId&&a.providerCustomerId===p.providerCustomerId&&a.signatureId===p.signatureId&&delegateReady&&a.enabled===true&&a.providerStatus==='AUTHORIZED'&&a.granteeVerified===true&&electronicHash(a.businessEvidenceHash)&&electronicHash(a.channelEvidenceHash)&&electronicInstant(a.validFrom)<=at&&electronicInstant(a.validUntil)>at&&fresh(a.checkedAt,now,60_000)&&Array.isArray(a.documentKinds)&&a.documentKinds.includes(context.kind)&&(a.cooperationVersionIds===null||Array.isArray(a.cooperationVersionIds)&&!!context.cooperationVersionId&&a.cooperationVersionIds.includes(context.cooperationVersionId))&&(a.vehicleIds===null||Array.isArray(a.vehicleIds)&&context.vehicleIds.every(id=>a.vehicleIds!.includes(id)));
}
function assertContext(parties:SigningPartyInput[],context:SigningContext){
  assertElectronicParties(parties,context.kind);
  ensure(electronicId(context.platformSubjectId)&&parties.find(p=>p.role==='PLATFORM')?.subjectId===context.platformSubjectId&&parties.find(p=>p.role==='PLATFORM')?.subjectType==='ENTERPRISE',409,'ELECTRONIC_PLATFORM_MISMATCH','平台签署主体必须为本项目宁达公司');
  ensure(Array.isArray(context.vehicleIds)&&context.vehicleIds.every(electronicId)&&new Set(context.vehicleIds).size===context.vehicleIds.length,409,'ELECTRONIC_SCOPE_INVALID','车辆签署范围不完整');
  ensure(!parties.some(p=>p.role==='CUSTOMER'&&p.subjectType!=='INDIVIDUAL'),409,'ELECTRONIC_PARTIES_MISMATCH','本版订阅客户须由自然人本人签署');
}
export function selectSigningModes(parties:SigningPartyInput[],now:Date,context:SigningContext):SigningModes{
  assertContext(parties,context);
  ensure(parties.every(p=>electronicIdentityReady(p,now)),409,'ELECTRONIC_IDENTITY_REQUIRED','请先完成各方实名、证书及印章核验');
  const cooperation=context.kind.startsWith('COOPERATION');
  const companies=parties.filter(p=>p.subjectType==='ENTERPRISE'&&(!cooperation||p.role==='PLATFORM'));
  const automatic=companies.length>0&&(context.kind==='SUBSCRIPTION'||companies.every(p=>p.autoAuthority?.policyVersion===3))&&companies.every(p=>electronicAutoAuthorityReady(p,context,now));
  return {modes:Object.fromEntries(parties.map(p=>[p.role,p.subjectType==='ENTERPRISE'&&(!cooperation||p.role==='PLATFORM')&&automatic?'AUTO':'MANUAL'])),reasonCodes:automatic?[]:['ELECTRONIC_AUTO_AUTHORITY_REQUIRED']};
}
export function nextSigningAction(task:ElectronicTaskFacts,now:Date):ElectronicAction{
  if(['WITHDRAWN','DECLINED','EXPIRED','RETIRED'].includes(task.status))return{kind:'NONE',reason:task.status};
  const blocked=(code:string):ElectronicAction=>({kind:'BLOCKED',code});
  assertContext(task.parties,task.context);
  if(task.kind!==task.context.kind||!electronicHash(task.sourceSha256)||!['PREPARED','SIGNING','SIGNED','FILING','ARCHIVING','ARCHIVED'].includes(task.status))return blocked('ELECTRONIC_TASK_INVALID');
  if(!task.businessApproved)return blocked('ELECTRONIC_BUSINESS_APPROVAL_REQUIRED');
  const parties=requiredSignerRoles(task.kind).map(role=>task.parties.find(p=>p.role===role)!);
  if(parties.some(p=>!['PENDING','ISSUED','UNKNOWN','SIGNED','DECLINED','EXPIRED'].includes(p.status)||!['MANUAL','AUTO'].includes(p.mode)||!electronicId(p.transactionId))||new Set(parties.map(p=>p.transactionId)).size!==parties.length)return blocked('ELECTRONIC_TASK_INVALID');
  const pendingIndex=parties.findIndex(p=>p.status!=='SIGNED');
  if(pendingIndex>=0&&parties.slice(pendingIndex+1).some(p=>p.status!=='PENDING'))return blocked('ELECTRONIC_SIGNING_ORDER_INVALID');
  if(task.status==='ARCHIVED')return pendingIndex===-1&&task.filingStatus==='CONFIRMED'?{kind:'DONE'}:blocked('ELECTRONIC_ARCHIVE_PROOF_REQUIRED');
  if(['REQUESTED','UNKNOWN'].includes(task.uploadStatus))return{kind:'QUERY_UPLOAD'};
  if(task.uploadStatus==='NOT_STARTED')return parties.every(p=>p.status==='PENDING')?{kind:'UPLOAD'}:blocked('ELECTRONIC_TASK_INVALID');
  if(task.uploadStatus!=='UPLOADED')return blocked('ELECTRONIC_TASK_INVALID');
  const enrich=parties.find(p=>p.status==='SIGNED'&&p.requiresEvidenceEnrichment);if(enrich)return{kind:'QUERY',role:enrich.role};
  if(pendingIndex>=0){
    if(task.filingStatus!=='NOT_STARTED')return blocked('ELECTRONIC_PREMATURE_FILING');
    const party=parties[pendingIndex];
    if(['ISSUED','UNKNOWN'].includes(party.status))return{kind:'QUERY',role:party.role};
    if(['DECLINED','EXPIRED'].includes(party.status))return{kind:'NONE',reason:party.status};
    if(!electronicIdentityReady(party,now))return blocked('ELECTRONIC_IDENTITY_REQUIRED');
    if(party.mode==='AUTO'&&(party.subjectType!=='ENTERPRISE'||party.role==='CUSTOMER'||task.kind==='COOPERATION_GRANT'||(task.kind.startsWith('COOPERATION')&&party.role==='OWNER')||(task.kind!=='SUBSCRIPTION'&&party.autoAuthority?.policyVersion!==3)))return blocked('ELECTRONIC_MANUAL_REQUIRED');
    if(party.mode==='AUTO'&&!electronicAutoAuthorityReady(party,task.context,now))return blocked('ELECTRONIC_AUTO_AUTHORITY_REQUIRED');
    return{kind:'SIGN',role:party.role,mode:party.mode};
  }
  if(task.filingStatus==='NOT_STARTED')return{kind:'FILE'};
  if(['REQUESTED','UNKNOWN'].includes(task.filingStatus))return{kind:'QUERY_FILING'};
  return task.filingStatus==='CONFIRMED'?{kind:'ARCHIVE'}:blocked('ELECTRONIC_TASK_INVALID');
}
