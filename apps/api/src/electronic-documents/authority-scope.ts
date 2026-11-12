import {z} from 'zod';
import {isVirtualVehicle} from '../virtual-acceptance/scope';
import {productVersionInclude} from '../products/types';
import {versionSnapshot} from '../products/snapshot';
import {assertV31ConfirmedProduct} from '../contract-terms/sources';
import {cooperationContentHash} from './cooperation';
import {canonicalHash} from '../customers/types';
import {hash} from '../common/data';
import {loadElectronicArchiveProof} from './archive';
import {evaluateV31AutoGrant} from './seal-authorization';
/** Exact scope is an explicit legal-actor statement about the ORIGINAL internal evidence.
 * Its signing window limits new dispatch, not the lifespan of an already signed service. */
export const internalAuthorityApplicability=z.object({
 kind:z.literal('EXACT_FROZEN_SCOPE'),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
 signingValidFrom:z.string().datetime(),signingValidUntil:z.string().datetime(),
}).strict().refine(s=>Date.parse(s.signingValidFrom)<Date.parse(s.signingValidUntil));
export function internalAuthorityAllowsSigning(value:unknown,sourceHash:string,now:Date){
 const p=internalAuthorityApplicability.safeParse(value);
 return p.success&&p.data.sourceHash===sourceHash&&Date.parse(p.data.signingValidFrom)<=now.getTime()&&now.getTime()<Date.parse(p.data.signingValidUntil);
}
/** Only server-resolved frozen order terms can select a grant; callers cannot submit a scope. */
export async function v31BusinessAuthorityReady(tx:any,row:any,subject:any,context:any,now:Date){
 const basis=row.basis;if(!basis||!context.orderId||!row.channelReview?.identityIsolated||!row.channelReview?.manualIsolated)return false;
 const g=await tx.electronicSealGrant.findUnique({where:{id:basis.grantId},include:{task:true}});
 if(!g||g.revokedAt||!g.signedAt||!g.archivedAt||g.sourceHash!==basis.sourceHash||canonicalHash(g.sourceSnapshot?.snapshot)!==g.sourceHash||!g.task)return false;
 const current=await tx.electronicSealGrant.findFirst({where:{cooperationVersionId:g.cooperationVersionId},orderBy:{version:'desc'}});if(current?.id!==g.id)return false;
 const proof=await loadElectronicArchiveProof(tx,g.task.archiveVersionId),av=await tx.archiveVersion.findUnique({where:{id:g.task.archiveVersionId}});
 if(proof?.kind!=='COOPERATION_GRANT'||proof.taskId!==g.task.id||av?.scopeSnapshot?.v31Sources?.hash!==g.sourceHash)return false;
 const main=await tx.electronicSigningTask.findUnique({where:{id:g.mainTaskId}}),mainProof=main?.status==='ARCHIVED'?await loadElectronicArchiveProof(tx,main.archiveVersionId):null;
 const version=await tx.partnerAgreementVersion.findUnique({where:{id:g.cooperationVersionId}}),agreement=version?await tx.partnerAgreement.findUnique({where:{id:version.agreementId}}):null;
 if(mainProof?.kind!=='COOPERATION'||mainProof.businessHash!==version?.contentHash||cooperationContentHash(version)!==version.contentHash||version?.status!=='ACTIVE'||agreement?.status!=='ACTIVE'||agreement.currentVersionId!==version.id)return false;
 const order=await tx.order.findUnique({where:{id:context.orderId}}),b=order?.finalPlanSnapshot,p=b?.productSnapshot,l=b?.lessorSnapshot;
 if(order&&await isVirtualVehicle(tx,order.vehicleId))return false;
 if(order?.contractMode!=='ELECTRONIC'||!p||l?.ownerId!==g.ownerId||l?.agreementVersionId!==g.cooperationVersionId||l?.agreementHash!==version.contentHash||context.cooperationVersionId!==g.cooperationVersionId||context.vehicleIds.length!==1||context.vehicleIds[0]!==order.vehicleId||b.acceptancePricing)return false;
 const binding=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId:order.vehicleId}});if(binding?.ownerId!==g.ownerId||binding.agreementVersionId!==g.cooperationVersionId)return false;
 const published=await tx.productVersion.findUnique({where:{id:p.productVersionId},include:productVersionInclude});if(published?.status!=='PUBLISHED')return false;
 try{assertV31ConfirmedProduct(b,versionSnapshot(published));}catch{return false;}
 const frozenVehicle=g.sourceSnapshot.snapshot.vehicles.find((v:any)=>v.id===order.vehicleId),currentScope=version.electronicTerms?.v31Sources?.vehicleScopes?.find((v:any)=>v.vehicleId===order.vehicleId);
 if(!frozenVehicle||!currentScope||canonicalHash(currentScope)!==canonicalHash(frozenVehicle.content.scope))return false;
 async function verifiedEvidence(refs:any){if(!Array.isArray(refs)||!refs.length)return false;for(const ref of refs){const file=await tx.storedFile.findUnique({where:{id:ref.fileId}});if(!file?.adminId||file.customerId||file.sha256!==ref.sha256)return false;}return true;}
 if(!await verifiedEvidence(frozenVehicle.content.authorityEvidence)||!await verifiedEvidence(frozenVehicle.content.rightsEvidence))return false;
 const vehicleAuthority={rightsRestrictions:currentScope.rightsRestrictions,authorityEvidence:frozenVehicle.content.authorityEvidence,rightsEvidence:frozenVehicle.content.rightsEvidence};
 const template=await tx.legalDocument.findUnique({where:{id:l.templateId}});if(template?.status!=='PUBLISHED'||!template.confirmedBy||!template.confirmedAt||hash(template.content)!==l.templateHash)return false;
 const scope=row.scope,platformId=g.sourceSnapshot.snapshot.parties.PLATFORM.id;
 if(scope.cooperationVersionIds?.length!==1||scope.cooperationVersionIds[0]!==g.cooperationVersionId||!Array.isArray(scope.vehicleIds)||scope.vehicleIds.length===0||scope.documentKinds?.length!==1||scope.documentKinds[0]!=='SUBSCRIPTION'||scope.delegateSubjectId!==platformId||row.channelReview.noticeOwnerId!==platformId||row.channelReview.archiveOwnerId!==platformId)return false;
 if(subject.role==='PLATFORM'){
  if(subject.subjectId!==platformId||basis.kind!=='PLATFORM_INTERNAL'||!row.channelReview.internalBasisVerified||!basis.original||!internalAuthorityAllowsSigning(basis.internalApplicability,g.sourceHash,now))return false;
  const file=await tx.storedFile.findUnique({where:{id:basis.original.fileId}});if(!file?.adminId||file.customerId||file.sha256!==basis.original.sha256)return false;
 }else if(subject.subjectId!==g.ownerId||basis.kind!=='PARTNER_SIGNED_GRANT')return false;
 const actual={kind:context.kind,vehicleAuthority,ownerId:l.ownerId,cooperationVersionId:l.agreementVersionId,cooperationHash:l.agreementHash,vehicleId:order.vehicleId,productVersionId:p.productVersionId,template:{id:template.id,version:template.version,hash:l.templateHash},startDate:l.leaseRange?.startDate,endDate:l.leaseRange?.endDate,creditBand:b.creditBand,creditPolicyVersion:b.creditRuleVersion,terms:{...p,...b,benefits:b.benefits??p.benefits,swapPolicy:p.swapPolicy,customerBaas:p.customerBaas}};
 return evaluateV31AutoGrant({subjectId:subject.subjectId,grant:{signed:true,archived:true,revoked:false,scope:g.sourceSnapshot.snapshot},channelAuthorized:true},actual,now).allowed;
}
