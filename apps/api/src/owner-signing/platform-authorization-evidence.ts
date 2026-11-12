import {canonicalHash as hash} from '../customers/types';
import {ensure} from '../common/errors';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {requireElectronicOwnerActor} from '../electronic-documents/identities';
import {identityMaterials} from './identity-materials';
import {platformScope,platformOwnerScope,platformApplicationBinding} from './platform-scope';

export function platformSignatureProofMatches(a:any,e:any){
 const p=e?.signatureEvidence,c=e?.identitySnapshot?.certificate,at=Date.parse(p?.signedAt);
 return p?.version===1&&p.verified===true&&/^[a-f0-9]{64}$/.test(p.queryHash??'')&&/^[a-f0-9]{64}$/.test(p.verificationHash??'')&&
  [1,10,100,1000].includes(p.signedAtPrecisionMs)&&Number.isFinite(at)&&e.signedAt instanceof Date&&at===e.signedAt.getTime()&&at+p.signedAtPrecisionMs>a.createdAt.getTime()&&
  p.contractId===a.providerContractId&&p.transactionId===a.providerTransactionId&&p.customerId===a.providerCustomerId&&p.certificateSerialNo===a.certificateSerialNo&&p.finalSha256===e.signedSha256&&p.subjectHash===c?.subjectHash;
}

export async function currentPlatformScope(tx:any,ownerId:string){
 ensure(process.env.FADADA_PLATFORM_CUSTOMER_ID,503,'PLATFORM_AUTH_PLATFORM','宁达签署账号尚未配置');
 const account=await tx.ownerESignAccount.findUnique({where:{providerCustomerId:process.env.FADADA_PLATFORM_CUSTOMER_ID},include:{owner:true}});
 ensure(account?.owner?.name===NINDA_PLATFORM_LEGAL_ENTITY&&account.owner.subjectType==='ENTERPRISE',409,'PLATFORM_AUTH_PLATFORM','宁达签署主体不匹配');
 return platformScope(account.ownerId,ownerId);
}
export async function platformAuthorizationIdentity(tx:any,customerId:string,ownerId:string,sealId:string,now=new Date()){
 const {owner,profile}=await requireElectronicOwnerActor(tx,customerId,ownerId,now),account=owner.esignAccount;
 ensure(account&&account.certValidFrom&&account.certValidUntil,409,'OWNER_CERT_REFRESH_REQUIRED','请先刷新企业证书状态');
 ensure(owner.subjectType==='ENTERPRISE',409,'PLATFORM_AUTH_ENTERPRISE','自然人须逐份本人签署');
 const seals=await tx.ownerSeal.findMany({where:{ownerId,status:'ACTIVE',providerCustomerId:account.providerCustomerId},take:2}),seal=seals[0];
 ensure(seals.length===1&&seal.id===sealId&&seal.selectedBy===customerId&&seal.selectedAt&&seal.selectedAt<=now&&seal.checkedAt&&seal.checkedAt<=now&&now.getTime()-seal.checkedAt.getTime()<86400000,409,'OWNER_SEAL_UNAVAILABLE','请先刷新企业状态并确认本企业印章');
 ensure(account.certStatus==='BOUND'&&account.certSerialNo&&/^[a-f0-9]{64}$/.test(account.certSubjectHash||'')&&account.certValidFrom<=now&&account.certValidUntil>now&&account.certCheckedAt&&account.certCheckedAt<=now&&now.getTime()-account.certCheckedAt.getTime()<86400000,409,'OWNER_CERT_REFRESH_REQUIRED','请先刷新企业证书状态');
 return{owner,account,seal,snapshot:{version:1,ownerId,customerId,materialsHash:identityMaterials(owner,profile).hash,legalRevision:profile.revision,providerCustomerId:account.providerCustomerId,sealId:seal.id,signatureId:seal.providerSignatureId,sealImageHash:seal.imageHash,certificate:{serialNo:account.certSerialNo,subjectHash:account.certSubjectHash,validFrom:account.certValidFrom.toISOString(),validUntil:account.certValidUntil.toISOString()}}};
}
export function platformScopeReviewHash(a:any,reviewedBy:string,reviewedAt:Date){const e=a.platformEvidence;return hash({scopeHash:a.scopeHash,signedSha256:e.signedSha256,signatureEvidenceHash:hash(e.signatureEvidence),reviewedBy,reviewedAt:reviewedAt.toISOString()});}
export function platformProofReady(a:any,now=new Date()){
 const e=a?.platformEvidence,s=platformOwnerScope.safeParse(a?.scope),proof=e?.signatureEvidence;
 if(!s.success||hash(s.data)!==a.scopeHash||s.data.applicationBinding!==platformApplicationBinding()||s.data.grantorSubjectId!==a.ownerId||!e?.signedFileId||!e.signedSha256||!e.signedAt||e.signedAt>now||!e.scopeReviewedAt||e.scopeReviewedAt>now||!e.scopeReviewedBy)return false;
 return platformSignatureProofMatches(a,e)&&e.scopeReviewHash===platformScopeReviewHash(a,e.scopeReviewedBy,e.scopeReviewedAt);
}
