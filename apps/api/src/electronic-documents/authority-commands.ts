import {internalAuthorityApplicability} from './authority-scope';
import {platformAuthorityView} from '../owner-signing/platform-authorization';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {assertEnterpriseOnboardingAllowed} from '../offline-documents/mode';
import {requireElectronicOwnerActor} from './identities';
import {loadElectronicArchiveProof} from './archive';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import type {ElectronicActor} from './access';
const id=z.string().min(1).max(128),digest=z.string().regex(/^[a-f0-9]{64}$/),command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128)});
const confirm=command.extend({grantId:id,sourceHash:digest,providerAuthorityId:id,internalEvidenceFileId:id.optional(),internalEvidenceHash:digest.optional(),internalApplicability:internalAuthorityApplicability.optional()}).strict();
const review=command.extend({channelEvidenceFileId:id,channelEvidenceHash:digest,granteeName:z.literal(NINDA_PLATFORM_LEGAL_ENTITY),noticeOwnerId:id,archiveOwnerId:id,identityIsolated:z.literal(true),manualIsolated:z.literal(true),internalBasisVerified:z.boolean()}).strict();
export async function signedSealGrant(tx:any,id:string){
 const grant=await tx.electronicSealGrant.findUnique({where:{id},include:{task:true}}),proof=grant?.signedAt&&grant?.archivedAt&&grant?.task?.status==='ARCHIVED'?await loadElectronicArchiveProof(tx,grant.task.archiveVersionId):null;
 ensure(grant&&!grant.revokedAt&&grant.signedAt&&grant.archivedAt&&proof?.kind==='COOPERATION_GRANT'&&proof.taskId===grant.task.id&&grant.sourceHash===canonicalHash(grant.sourceSnapshot?.snapshot),409,'V31_INDEPENDENT_GRANT_REQUIRED','须先独立签署并归档完整用印授权');
 return grant;
}
async function operator(tx:any,actor:ElectronicActor){const staff=actor.kind==='ADMIN'?await tx.adminUser.findUnique({where:{id:actor.id}}):null;ensure(staff?.active&&['ADMIN','OPERATIONS'].includes(staff.role),403,'FORBIDDEN','仅当前运营或管理员可核验或暂停');}
export async function confirmV31Authority(tx:any,actor:ElectronicActor,raw:unknown){
 ensure(actor.kind==='OWNER'&&actor.ownerId,403,'ELECTRONIC_PERSONAL_SIGNER_REQUIRED','请由企业登记本人确认具体用印范围');
 const input=confirm.parse(raw);
 await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${actor.ownerId} FOR UPDATE`;
 const legal=await requireElectronicOwnerActor(tx,actor.id,actor.ownerId);
 return archiveCommand(tx,{id:actor.id,role:actor.kind},actor.ownerId,'V31_AUTHORITY_CONFIRM',input,async()=>{
  const g=await signedSealGrant(tx,input.grantId),s=g.sourceSnapshot.snapshot,platformId=s.parties.PLATFORM.id;
  ensure(!s.virtualAcceptance,409,'VIRTUAL_MANUAL_ONLY','本次测试逐份本人确认，不启用技术自动用印；独立文书归档与自动用印授权是不同事实');
  ensure([g.ownerId,platformId].includes(actor.ownerId),403,'FORBIDDEN','本企业不属于授权文件');
  ensure(input.revision===g.revision&&input.sourceHash===g.sourceHash,409,'VERSION_CONFLICT','独立授权范围已变化');
  const platform=actor.ownerId===platformId;
  let original:any=null;if(platform){original=await tx.storedFile.findUnique({where:{id:input.internalEvidenceFileId??''}});ensure(original&&original.adminId&&!original.customerId&&original.sha256===input.internalEvidenceHash,409,'V31_INTERNAL_BASIS_REQUIRED','宁达自身用印须确认已核验原始内部授权文件及摘要');}
  else ensure(!input.internalEvidenceFileId&&!input.internalEvidenceHash&&!input.internalApplicability,400,'VALIDATION','合作商以已签附件三为依据');
  if(platform)ensure(input.internalApplicability?.sourceHash===g.sourceHash,409,'V31_INTERNAL_APPLICABILITY_REQUIRED','宁达有权人须依原始内部依据明确确认完整冻结范围及独立签发有效期；部分范围不支持自动用印');
  const technical=await tx.ownerAutoAuthority.findUnique({where:{id:input.providerAuthorityId}});
  ensure(technical?.ownerId===actor.ownerId&&technical.requestedBy===actor.id&&technical.method==='PROVIDER_AUTO_GRANT'&&!technical.revokedAt,409,'V31_CHANNEL_AUTHORITY_REQUIRED','须绑定本企业本人办理的真实渠道授权');
  const basis={version:1,grantId:g.id,sourceHash:g.sourceHash,kind:platform?'PLATFORM_INTERNAL':'PARTNER_SIGNED_GRANT',legalRevision:legal.profile.revision,original:original?{fileId:original.id,sha256:original.sha256}:null,...(platform?{internalApplicability:input.internalApplicability}:{})};
  const scope={version:1,subjectId:actor.ownerId,delegateSubjectId:platformId,documentKinds:['SUBSCRIPTION'],cooperationVersionIds:[g.cooperationVersionId],vehicleIds:s.vehicles.map((v:any)=>v.id),validFrom:new Date(s.cooperation.validFrom+'T00:00:00+08:00').toISOString(),validUntil:new Date(s.cooperation.validUntil+'T23:59:59+08:00').toISOString()};
  const scopeHash=canonicalHash({scope,basis}),acceptedAt=new Date();
  const row=await tx.electronicAutoAuthority.create({data:{ownerId:actor.ownerId,providerAuthorityId:technical.id,scope,scopeHash,basis,acceptedBy:actor.id,acceptedAt,businessEvidenceHash:canonicalHash({scope,basis,acceptedBy:actor.id,acceptedAt:acceptedAt.toISOString()}),enabled:false}});
  await audit(tx,actor.id,'V31_AUTHORITY_CONFIRMED','electronic-authorities',row.id,{grantId:g.id,sourceHash:g.sourceHash,scopeHash},'OWNER');return authorityView(row);
 });
}
export const authorityView=(r:any)=>({id:r.id,ownerId:r.ownerId,revision:r.revision,enabled:r.enabled,revokedAt:r.revokedAt,scopeHash:r.scopeHash,grantId:r.basis?.grantId,sourceHash:r.basis?.sourceHash,basisKind:r.basis?.kind,internalApplicability:r.basis?.internalApplicability??null,internalEvidence:r.basis?.original??null,reviewed:!!r.channelReviewedAt,automaticReady:null,readinessReasons:['V31_CURRENT_ORDER_CHECK_REQUIRED',...(!r.basis?['V31_INTERNAL_BASIS_REQUIRED']:[]),...(!r.channelReviewedAt?['V31_CHANNEL_REVIEW_REQUIRED']:[]),...(!r.enabled?['V31_AUTHORITY_DISABLED']:[])]});
async function rowFor(tx:any,actor:ElectronicActor,id:string){const r=await tx.electronicAutoAuthority.findUnique({where:{id}});ensure(r,404,'NOT_FOUND','用印授权不存在');if(actor.kind==='ADMIN')await operator(tx,actor);else{ensure(actor.kind==='OWNER'&&actor.ownerId===r.ownerId,404,'NOT_FOUND','本企业授权不存在');await requireElectronicOwnerActor(tx,actor.id,r.ownerId);}return r;}
export async function reviewV31Authority(tx:any,actor:ElectronicActor,id:string,raw:unknown){
 await operator(tx,actor);const input=review.parse(raw),old=await rowFor(tx,actor,id);await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${old.ownerId} FOR UPDATE`;
 return archiveCommand(tx,{id:actor.id,role:actor.kind},id,'V31_AUTHORITY_REVIEW',input,async()=>{
  const r=await rowFor(tx,actor,id),scope=r.scope,g=await signedSealGrant(tx,r.basis?.grantId??'');
  ensure(r.revision===input.revision&&!r.revokedAt&&!r.enabled,409,'VERSION_CONFLICT','请先暂停并刷新授权');
  ensure(input.noticeOwnerId===scope.delegateSubjectId&&input.archiveOwnerId===scope.delegateSubjectId&&scope.delegateSubjectId===g.sourceSnapshot.snapshot.parties.PLATFORM.id,409,'V31_CHANNEL_SUBJECT_MISMATCH','渠道受权人、通知及归档办理主体须为宁达');
  const file=await tx.storedFile.findUnique({where:{id:input.channelEvidenceFileId}});ensure(file?.adminId&&!file.customerId&&file.sha256===input.channelEvidenceHash,409,'V31_CHANNEL_REVIEW_REQUIRED','须核验真实渠道样张及通知路由凭据');
  ensure(r.basis.kind!=='PLATFORM_INTERNAL'||input.internalBasisVerified&&r.basis.original&&internalAuthorityApplicability.safeParse(r.basis.internalApplicability).success&&r.basis.internalApplicability.sourceHash===g.sourceHash,409,'V31_INTERNAL_BASIS_REQUIRED','须核验宁达内部用印原始依据及有权人员');
  const result=await tx.electronicAutoAuthority.update({where:{id},data:{channelGranteeOwnerId:scope.delegateSubjectId,channelGranteeName:input.granteeName,channelEvidenceFileId:file.id,channelEvidenceHash:file.sha256,channelReviewedBy:actor.id,channelReviewedAt:new Date(),channelReview:{noticeOwnerId:input.noticeOwnerId,archiveOwnerId:input.archiveOwnerId,identityIsolated:true,manualIsolated:true,internalBasisVerified:input.internalBasisVerified},revision:{increment:1}}});
  await audit(tx,actor.id,'V31_AUTHORITY_REVIEWED','electronic-authorities',id,{evidenceHash:file.sha256});return authorityView(result);
 });
}
export async function switchV31Authority(tx:any,actor:ElectronicActor,id:string,raw:unknown){
 const input=command.extend({enabled:z.boolean(),scopeHash:digest}).strict().parse(raw),old=await rowFor(tx,actor,id);
 ensure(!input.enabled||actor.kind==='OWNER',403,'ELECTRONIC_PERSONAL_SIGNER_REQUIRED','后台不能代企业启用授权');
 await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${old.ownerId} FOR UPDATE`;
 return archiveCommand(tx,{id:actor.id,role:actor.kind},id,'V31_AUTHORITY_SWITCH',input,async()=>{
  const r=await rowFor(tx,actor,id);ensure(r.revision===input.revision&&r.scopeHash===input.scopeHash,409,'VERSION_CONFLICT','授权版本已变化');
  if(input.enabled){const grant=await signedSealGrant(tx,r.basis?.grantId??'');ensure(!grant.sourceSnapshot.snapshot.virtualAcceptance,409,'VIRTUAL_MANUAL_ONLY','本次测试逐份本人确认，不启用自动用印');assertEnterpriseOnboardingAllowed();ensure(r.acceptedBy===actor.id&&!r.revokedAt&&r.channelReviewedAt&&r.channelReview,409,'V31_CHANNEL_REVIEW_REQUIRED','本人确认或渠道核验尚未齐备');}
  const result=await tx.electronicAutoAuthority.update({where:{id},data:{enabled:input.enabled,revision:{increment:1}}});await audit(tx,actor.id,input.enabled?'V31_AUTHORITY_ENABLED':'V31_AUTHORITY_PAUSED','electronic-authorities',id,{scopeHash:r.scopeHash},actor.kind);return authorityView(result);
 });
}
export async function listV31Authorities(tx:any,actor:ElectronicActor,ownerId:string){
 if(actor.kind==='ADMIN')await operator(tx,actor);else{ensure(actor.ownerId===ownerId,403,'FORBIDDEN','只能读取本企业授权');await requireElectronicOwnerActor(tx,actor.id,ownerId);}
 if(process.env.OWNER_AUTHORIZATION_SCOPE_VERSION==='3')return{scopeVersion:3,executionEnabled:process.env.OWNER_AUTO_SIGNING_ENABLED==='true',items:(await tx.ownerAutoAuthority.findMany({where:{ownerId,scope:{path:['version'],equals:3}},include:{platformEvidence:true},orderBy:{createdAt:'desc'},take:100})).map(platformAuthorityView)};
 return{items:(await tx.electronicAutoAuthority.findMany({where:{ownerId},orderBy:{acceptedAt:'desc'},take:100})).map(authorityView)};
}
