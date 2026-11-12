import type {Prisma} from '@prisma/client';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {platformLegalEntity} from '../common/platform-legal-entity';
import {OwnerService} from '../owner-signing/owner.service';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {FadadaSettings} from './esign.settings';
import {hashSigningPlanPayload} from './enterprise-seal/signing-plan-hash';
type Database=Db|Prisma.TransactionClient;
export function newPlatformSigningMode(kind:string,env:NodeJS.ProcessEnv=process.env):'MANUAL'|'AUTO'{
 if(kind!=='HANDOVER')return'AUTO';
 const value=env.HANDOVER_PLATFORM_SIGNING_MODE??'AUTO';
 ensure(value==='AUTO'||value==='MANUAL',503,'PLATFORM_SIGNING_MODE','平台交接签署模式配置无效');return value;
}
export function manualHandoverEnabled(config:FadadaSettings){return config.enabled&&config.signingEnabled&&process.env.HANDOVER_PLATFORM_SIGNING_MODE==='MANUAL';}
export function manualHandoverTask(task:any){return task.kind==='HANDOVER'&&task.platformSigningMode==='MANUAL';}
export async function platformLegalIdentity(db:Database,config:FadadaSettings,customerId:string,ownerId:string){
 const identity=await requireOwnerLegalRepresentative(db,customerId,ownerId);
 await new OwnerService(db as Db).requireLegalSigningMember(customerId,ownerId,db);
 const {owner,member}=identity,account=owner.esignAccount;
 ensure(member.status==='VERIFIED'&&member.verifiedAt&&account?.verifiedAt&&account.realNameStatus==='VERIFIED'&&owner.status==='VERIFIED',403,'OWNER_LEGAL_NOT_VERIFIED','请先完成当前法人及企业认证核验');
 return{...identity,account:account!,isPlatform:!!config.platformCustomerId&&account.providerCustomerId===config.platformCustomerId&&owner.name===platformLegalEntity()};
}
export async function platformHandoverRecord(db:Database,config:FadadaSettings,customerId:string,ownerId:string,id:string){
 const identity=await platformLegalIdentity(db,config,customerId,ownerId);
 ensure(identity.isPlatform,404,'NOT_FOUND','本企业交接单不存在');
 const task=await db.fadadaTask.findFirst({where:{id,kind:'HANDOVER',platformSigningMode:'MANUAL',platformProviderId:config.platformCustomerId}});
 ensure(task,404,'NOT_FOUND','本企业交接单不存在');
 const approval=await db.eSignApproval.findUnique({where:{id:task.approvalId}}),seal=approval?await db.enterpriseSeal.findUnique({where:{id:approval.sealId}}):null;
 ensure(approval?.kind==='HANDOVER'&&approval.resourceId===task.resourceId&&approval.customerId===task.customerId&&approval.documentHash===task.documentHash&&approval.sourcePdfHash===task.sourcePdfHash&&approval.sourceFileId===task.sourceFileId&&seal?.providerCustomerId===task.platformProviderId&&seal.organizationName===identity.owner.name,409,'DOCUMENT_MISMATCH','交接审批文档或原签署平台企业归属已变化');
 const resource=await db.handover.findUnique({where:{id:task.resourceId},include:{order:{include:{vehicle:{select:{title:true}}}}}});
 ensure(resource&&resource.providerTaskId===id&&resource.customerId===task.customerId&&resource.order.customerId===task.customerId&&resource.manifestHash===task.documentHash&&resource.confirmedAt,409,'DOCUMENT_MISMATCH','交接事实、签署任务或文件归属已变化');
 return{identity,task,resource};
}
export async function platformManualIdentityEvidence(db:Database,config:FadadaSettings,customerId:string,ownerId:string){
 const identity=await platformLegalIdentity(db,config,customerId,ownerId),{owner,member,profile,account}=identity;
 ensure(identity.isPlatform&&config.platformSignatureId,403,'PLATFORM_LEGAL_REQUIRED','仅当前平台企业已核验法人可以签署');
 const recent=(date:Date|null)=>!!date&&date.getTime()>Date.now()-24*3600_000&&date.getTime()<=Date.now();
 ensure(account.certStatus==='BOUND'&&account.certSerialNo&&account.evidenceHash&&recent(account.checkedAt),409,'PLATFORM_CERTIFICATE','企业证书或认证核验已过期');
 const seal=await db.ownerSeal.findFirst({where:{ownerId,providerCustomerId:config.platformCustomerId,providerSignatureId:config.platformSignatureId,status:'ACTIVE'}});
 ensure(seal?.selectedAt&&seal.selectedBy&&recent(seal.checkedAt),409,'PLATFORM_SEAL','请重新核验并选择当前平台印章');
 const evidence={role:'PLATFORM',ownerId,ownerRevision:owner.revision,signerId:customerId,memberId:member.id,verifiedSerialNo:member.verifiedSerialNo,legalRevision:profile.revision,legalName:profile.name,legalMobileHash:profile.mobileHash,legalEvidenceHash:profile.evidenceHash,providerCustomerId:account.providerCustomerId,certificateSerialNo:account.certSerialNo,identityEvidenceHash:account.evidenceHash,identityConsentHash:hash(account.consentSnapshot),sealId:seal.id,providerSignatureId:seal.providerSignatureId,sealImageHash:seal.imageHash};
 return{identity,seal,evidence};
}
export function assertPlatformManualTrace(task:any){
 const e=task.platformManualEvidence;
 ensure(manualHandoverTask(task)&&task.platformManualRequestedAt&&task.platformManualSignerId&&task.platformManualOwnerId&&e?.accepted===true&&e.role==='PLATFORM'&&e.signerId===task.platformManualSignerId&&e.ownerId===task.platformManualOwnerId&&e.documentHash===task.documentHash&&e.sourcePdfHash===task.sourcePdfHash&&e.sourceFileId===task.sourceFileId&&e.providerCustomerId===task.platformProviderId&&e.providerEnvelopeId===task.providerEnvelopeId&&e.platformTransactionId===task.platformTransactionId&&typeof e.approvalId==='string'&&typeof e.planHash==='string'&&typeof e.certificateSerialNo==='string'&&typeof e.providerSignatureId==='string'&&Number.isInteger(e.legalRevision),409,'PLATFORM_MANUAL_TRACE','平台签署缺少法人本人确认及已批准手动发起记录');
}
/** A fresh approval may replace an expired approval only through the existing
 * two-person renewal chain. General owner revisions are audit data, not identity. */
export async function assertPlatformManualContinuation(db:Database,task:any,evidence:any,approval:any){
 assertPlatformManualTrace(task);
 const prior=task.platformManualEvidence;
 const identity=({approvalId,planHash,ownerRevision,...frozen}:any)=>frozen;
 ensure(hashSigningPlanPayload(identity(evidence))===hashSigningPlanPayload(identity(prior)),409,'PLATFORM_MANUAL_IDENTITY_CHANGED','手动签署发起后的法人、证书、印章或文件已变化，请联系运营核对');
 let current=approval;const visited=new Set<string>();
 for(;;){
  ensure(current&&!visited.has(current.id)&&visited.size<50&&current.kind==='HANDOVER'&&current.resourceId===task.resourceId&&current.customerId===task.customerId&&current.documentHash===task.documentHash&&current.sourceFileId===task.sourceFileId&&current.sourcePdfHash===task.sourcePdfHash&&current.sealId===approval.sealId&&current.status==='APPROVED'&&current.approvedAt&&current.approverId&&current.requesterId!==current.approverId&&current.planHash===hashSigningPlanPayload({compiledPlan:current.plan,documentHash:current.documentHash,sourcePdfHash:current.sourcePdfHash,slotCoordinates:current.slotCoordinates}),409,'PLATFORM_MANUAL_RENEWAL','手动签署审批承接链无效');
  if(current.id===prior.approvalId){ensure(current.planHash===prior.planHash,409,'PLATFORM_MANUAL_RENEWAL','原始手动签署审批证据已变化');return;}
  visited.add(current.id);const renewal=current.plan?.renewal;
  ensure(renewal&&Object.keys(renewal).length===2&&renewal.taskId===task.id&&typeof renewal.priorApprovalId==='string',409,'PLATFORM_MANUAL_RENEWAL','手动签署审批不能被直接替换');
  current=await db.eSignApproval.findUnique({where:{id:renewal.priorApprovalId}});
 }
}

