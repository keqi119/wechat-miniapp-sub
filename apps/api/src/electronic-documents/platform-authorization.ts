import {canonicalHash} from '../customers/types';
import {currentPlatformScope,platformAuthorizationIdentity,platformProofReady} from '../owner-signing/platform-authorization-evidence';
import {platformAutoDocumentKinds} from '../owner-signing/platform-scope';
import {electronicAutoAuthorityReady} from './policy';
import type {AutoAuthorityEvidence,SigningContext,SigningPartyInput} from './types';

/** Signing authority only. Business approvals and cooperation terms are checked separately by service.business(). */
export async function readPlatformAutomaticAuthority(tx:any,subject:SigningPartyInput,context:SigningContext,now:Date):Promise<AutoAuthorityEvidence|null>{
 if(process.env.OWNER_AUTHORIZATION_SCOPE_VERSION!=='3'||context.autoSigningPolicyVersion!==3||!context.authorityCreatedBefore||!Number.isFinite(Date.parse(context.authorityCreatedBefore))||subject.subjectType!=='ENTERPRISE'||context.signaturePolicy==='MANUAL_ONLY'||context.kind==='COOPERATION_GRANT'||context.kind.startsWith('COOPERATION')&&subject.role!=='PLATFORM')return null;
 const rows=await tx.ownerAutoAuthority.findMany({where:{ownerId:subject.subjectId,method:'PROVIDER_AUTO_GRANT',enabled:true,status:'AUTHORIZED',revokedAt:null,scope:{path:['version'],equals:3}},include:{platformEvidence:{include:{signedFile:true}}},orderBy:{createdAt:'desc'},take:5});
 for(const a of rows){
  const e=a.platformEvidence,cutoff=Date.parse(context.authorityCreatedBefore);
  if(a.createdAt.getTime()>cutoff||!e?.signedAt||!e.scopeReviewedAt||e.signedAt.getTime()>cutoff||e.scopeReviewedAt.getTime()>cutoff)continue;
  try{
   if(!e||e.pausedAt||!a.checkedAt||a.providerCustomerId!==subject.providerCustomerId||a.providerSignatureId!==subject.signatureId||a.certificateSerialNo!==subject.certificate.serialNo||!platformProofReady(a,now)||e.signedFile?.sha256!==e.signedSha256||e.signedFile?.purpose!=='owner-authorization')continue;
   const scope=await currentPlatformScope(tx,subject.subjectId);if(scope.platformSubjectId!==context.platformSubjectId||canonicalHash(scope)!==a.scopeHash)continue;
   const current=await platformAuthorizationIdentity(tx,a.requestedBy,a.ownerId,a.sealId,now);if(canonicalHash(current.snapshot)!==canonicalHash(e.identitySnapshot))continue;
   const evidence:AutoAuthorityEvidence={policyVersion:3,id:a.id,subjectId:a.ownerId,providerCustomerId:a.providerCustomerId,signatureId:a.providerSignatureId,platformSubjectId:scope.platformSubjectId,delegateSubjectId:scope.granteeSubjectId,applicationBinding:scope.applicationBinding,enabled:true,providerStatus:'AUTHORIZED',granteeVerified:true,businessEvidenceHash:e.scopeReviewHash!,channelEvidenceHash:e.signedSha256!,validFrom:e.signedAt!.toISOString(),validUntil:current.account.certValidUntil!.toISOString(),checkedAt:a.checkedAt.toISOString(),documentKinds:[...platformAutoDocumentKinds],cooperationVersionIds:null,vehicleIds:null};
   if(electronicAutoAuthorityReady({...subject,autoAuthority:evidence},context,now))return evidence;
  }catch(error:any){if(!error?.getResponse)throw error;}
 }
 return null;
}
