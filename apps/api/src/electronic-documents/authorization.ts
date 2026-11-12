import {v31BusinessAuthorityReady} from './authority-scope';
import {readPlatformAutomaticAuthority} from './platform-authorization';
import {requireElectronicOwnerActor} from './identities';
import {z} from 'zod';
import {canonicalHash} from '../customers/types';
import {NINDA_PLATFORM_LEGAL_ENTITY} from '../common/platform-legal-entity';
import {electronicAutoAuthorityReady,electronicHash} from './policy';
import {electronicDocumentKinds} from './types';
import type {AutoAuthorityEvidence,SigningContext,SigningPartyInput} from './types';

const ids=z.array(z.string().min(1).max(200)).min(1).max(1000).refine(a=>new Set(a).size===a.length);
export const electronicAuthorityScope=z.object({version:z.literal(1),subjectId:z.string().min(1),delegateSubjectId:z.string().min(1),documentKinds:z.array(z.enum(electronicDocumentKinds)).min(1).refine(a=>new Set(a).size===a.length),cooperationVersionIds:ids.nullable(),vehicleIds:ids.nullable(),validFrom:z.string().datetime(),validUntil:z.string().datetime()}).strict().refine(s=>Date.parse(s.validFrom)<Date.parse(s.validUntil));
/** The provider grant is technical permission; a separately accepted scope limits business use. */
export async function readAutomaticSigningAuthority(tx:any,subject:SigningPartyInput,context:SigningContext,now=new Date()):Promise<AutoAuthorityEvidence|null>{
 if(process.env.OWNER_AUTO_SIGNING_ENABLED==='false')return null;
 const platform=await readPlatformAutomaticAuthority(tx,subject,context,now);if(platform||context.autoSigningPolicyVersion===3)return platform;
 if(subject.subjectType!=='ENTERPRISE'||context.kind!=='SUBSCRIPTION'||!context.orderId)return null;
 const rows=await tx.electronicAutoAuthority.findMany({where:{ownerId:subject.subjectId,enabled:true,revokedAt:null},include:{providerAuthority:true,channelEvidenceFile:true},orderBy:{acceptedAt:'desc'},take:20});
 for(const row of rows){
  const parsed=electronicAuthorityScope.safeParse(row.scope),grant=row.providerAuthority;if(!parsed.success)continue;const s=parsed.data;
  if(!row.enabled||row.revokedAt||!row.acceptedAt||row.acceptedAt>now||!row.acceptedBy||canonicalHash({scope:s,basis:row.basis})!==row.scopeHash||canonicalHash({scope:s,basis:row.basis,acceptedBy:row.acceptedBy,acceptedAt:row.acceptedAt.toISOString()})!==row.businessEvidenceHash||s.subjectId!==subject.subjectId||s.delegateSubjectId!==context.platformSubjectId)continue;
  if(!grant||row.providerAuthorityId!==grant.id||grant.ownerId!==subject.subjectId||grant.method!=='PROVIDER_AUTO_GRANT'||!grant.enabled||grant.status!=='AUTHORIZED'||grant.revokedAt||grant.requestedBy!==row.acceptedBy||grant.providerCustomerId!==subject.providerCustomerId||grant.providerSignatureId!==subject.signatureId||grant.certificateSerialNo!==subject.certificate.serialNo||!grant.checkedAt)continue;
  // An uploaded unilateral letter or local display name does not establish the channel grantee.
  if(row.channelGranteeOwnerId!==context.platformSubjectId||row.channelGranteeName!==NINDA_PLATFORM_LEGAL_ENTITY||!row.channelReviewedBy||!row.channelReviewedAt||row.channelReviewedAt>now||!electronicHash(row.channelEvidenceHash)||row.channelEvidenceFile?.sha256!==row.channelEvidenceHash)continue;
  const owner=await tx.vehicleOwner.findUnique({where:{id:subject.subjectId},include:{esignAccount:true}});
  if(owner?.status!=='VERIFIED'||owner.esignAccount?.managerCustomerId!==row.acceptedBy)continue;
  let legal;try{legal=await requireElectronicOwnerActor(tx,row.acceptedBy,subject.subjectId,now);}catch{continue;}
  if(legal.profile.revision!==row.basis?.legalRevision||!await v31BusinessAuthorityReady(tx,row,subject,context,now))continue;
  const internal=subject.role==='PLATFORM'?row.basis.internalApplicability:null;
  const validFrom=internal?new Date(Math.max(Date.parse(s.validFrom),Date.parse(internal.signingValidFrom))).toISOString():s.validFrom,validUntil=internal?new Date(Math.min(Date.parse(s.validUntil),Date.parse(internal.signingValidUntil))).toISOString():s.validUntil;
  const evidence:AutoAuthorityEvidence={id:row.id,subjectId:subject.subjectId,providerCustomerId:subject.providerCustomerId,signatureId:subject.signatureId!,delegateSubjectId:s.delegateSubjectId,enabled:true,providerStatus:grant.status,granteeVerified:true,businessEvidenceHash:row.businessEvidenceHash,channelEvidenceHash:row.channelEvidenceHash,validFrom,validUntil,checkedAt:grant.checkedAt.toISOString(),documentKinds:s.documentKinds,cooperationVersionIds:s.cooperationVersionIds,vehicleIds:s.vehicleIds};
  if(electronicAutoAuthorityReady({...subject,autoAuthority:evidence},context,now))return evidence;
 }
 return null;
}
