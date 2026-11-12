import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {loadElectronicArchiveProof} from './archive';
/** Independent grant facts never activate a cooperation relationship. */
export async function archiveSealGrant(tx:any,task:any){
 const grant=task.sealGrantId?await tx.electronicSealGrant.findUnique({where:{id:task.sealGrantId}}):null;
 const proof=await loadElectronicArchiveProof(tx,task.archiveVersionId);
 ensure(task.kind==='COOPERATION_GRANT'&&grant&&grant.ownerId===task.ownerId&&proof&&proof.taskId===task.id&&proof.kind==='COOPERATION_GRANT',409,'ELECTRONIC_ARCHIVE_REQUIRED','独立授权须完成双方真实签署与归档');
 await tx.electronicSealGrant.update({where:{id:grant.id},data:{signedAt:new Date(Math.max(...proof.parties.map((p:any)=>Date.parse(p.providerSignedAt)))),archivedAt:new Date(proof.archivedAt)}});
 await audit(tx,'ELECTRONIC_ARCHIVE','ELECTRONIC_SEAL_GRANT_ARCHIVED','electronic-seal-grants',grant.id,{taskId:task.id,sourceHash:grant.sourceHash},'SYSTEM');
}

import {canonicalHash} from '../customers/types';
/** All scope values come from the immutable signed 02 source; absent scope never means unlimited. */
export function evaluateV31AutoGrant(party:any,context:any,now=new Date()):{allowed:boolean;reasons:string[]}{
 const reasons:string[]=[],deny=(condition:any,code:string)=>{if(!condition)reasons.push(code);};
 const grant=party?.grant,s=grant?.scope;
 deny(context?.kind==='SUBSCRIPTION','V31_MANUAL_DOCUMENT');
 deny(grant?.signed===true&&grant?.archived===true&&!grant.revoked,'V31_INDEPENDENT_GRANT_REQUIRED');
 deny(party?.channelAuthorized===true,'V31_CHANNEL_AUTHORITY_REQUIRED');
 if(!s||!context)return{allowed:false,reasons:[...reasons,'V31_EXPLICIT_SCOPE_REQUIRED']};
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
 deny(s.cooperation?.id===context.cooperationVersionId&&s.cooperation?.hash===context.cooperationHash,'V31_COOPERATION_SCOPE');
 deny(s.parties?.OWNER?.id===context.ownerId,'V31_OWNER_SCOPE');
 deny(s.cooperation?.validFrom<=today&&today<=s.cooperation?.validUntil&&s.cooperation.validFrom<=context.startDate&&context.endDate<=s.cooperation.validUntil,'V31_PERIOD_SCOPE');
 const vehicle=Array.isArray(s.vehicles)?s.vehicles.find((v:any)=>v.id===context.vehicleId):null,vs=vehicle?.content?.scope;
 deny(vs&&vs.validFrom<=context.startDate&&context.endDate<=vs.validUntil&&['NONE','DISCLOSED'].includes(vs.rightsRestrictions?.status),'V31_VEHICLE_SCOPE');
 if(vs?.rightsRestrictions?.status==='DISCLOSED'){const actual=context.vehicleAuthority,content=vehicle.content;deny(actual&&Array.isArray(content.authorityEvidence)&&content.authorityEvidence.length>0&&Array.isArray(content.rightsEvidence)&&content.rightsEvidence.length>0&&canonicalHash(actual.rightsRestrictions)===canonicalHash(vs.rightsRestrictions)&&canonicalHash(actual.authorityEvidence)===canonicalHash(content.authorityEvidence)&&canonicalHash(actual.rightsEvidence)===canonicalHash(content.rightsEvidence),'V31_DISCLOSED_AUTHORITY_EVIDENCE_REQUIRED');}
 const product=Array.isArray(s.products)?s.products.find((p:any)=>p.id===context.productVersionId)?.content:null,terms=context.terms;
 deny(product&&terms,'V31_PRODUCT_SCOPE');
 if(product&&terms){
  deny(Number.isSafeInteger(terms.monthlyFeeAmount)&&terms.monthlyFeeAmount===product.monthlyFeeAmount&&terms.agreedFeeComponents?.baseFeeAmount===product.baseFeeAmount&&terms.agreedFeeComponents?.mileageMonthlyFeeAmount===product.mileageMonthlyFeeAmount&&terms.agreedFeeComponents.baseFeeAmount+terms.agreedFeeComponents.mileageMonthlyFeeAmount===terms.monthlyFeeAmount,'V31_PRICE_SCOPE');
  deny(terms.months===product.months&&product.minimumTermMonths>=3&&terms.months>=product.minimumTermMonths,'V31_TERM_SCOPE');
  for(const key of ['benefits','swapPolicy','customerBaas','mileagePerMonthKm','excessMileagePriceAmount'])deny(canonicalHash(terms[key]??null)===canonicalHash(product[key]??null),'V31_RIGHTS_SCOPE');
  const deposit=Array.isArray(s.depositAuthorizations)?s.depositAuthorizations.find((d:any)=>d.productVersionId===context.productVersionId):null;
  let expected:number|undefined;
  if(deposit?.rule?.kind==='FIXED')expected=deposit.rule.amount;
  if(deposit?.rule?.kind==='CREDIT_POLICY'&&deposit.rule.policyVersion==='ZHIMA_MANUAL_V1'&&context.creditPolicyVersion==='ZHIMA_MANUAL_V1'){
   const multiplier:Record<string,number>={GE750:0,B700_749:1,B650_699:2};if(context.creditBand in multiplier)expected=terms.monthlyFeeAmount*multiplier[context.creditBand];
  }
  deny(Number.isSafeInteger(expected)&&Number.isSafeInteger(terms.depositAmount)&&terms.depositAmount===expected,'V31_DEPOSIT_SCOPE');
 }
 deny(Array.isArray(s.templates)&&s.templates.some((t:any)=>t.id===context.template?.id&&t.version===context.template?.version&&t.hash===context.template?.hash),'V31_TEMPLATE_SCOPE');
 // Free-text exceptions are never a machine-readable authorization to enlarge financial rights.
 deny(!s.cooperation?.terms?.exceptions?.length,'V31_EXCEPTION_MANUAL_REVIEW');
 return{allowed:reasons.length===0,reasons:[...new Set(reasons)]};
}

import {freezeV31Preparation,assertV31PreparationSourcesCurrent} from '../contract-terms/preparation';
import {assertV31SourcesCurrent} from '../contract-terms/sources';
export async function assertGrantSourcesCurrent(tx:any,frozen:any){
 ensure(frozen?.context?.kind==='COOPERATION'&&canonicalHash(frozen.snapshot)===frozen.hash,409,'V31_GRANT_SCOPE_REQUIRED','独立授权来源凭据不完整');
 const version=await tx.partnerAgreementVersion.findUnique({where:{id:frozen.context.resourceId}}),agreement=version?await tx.partnerAgreement.findUnique({where:{id:version.agreementId}}):null;
 ensure(version&&agreement&&agreement.currentVersionId===version.id&&!['STOPPED','RETIRED'].includes(agreement.status),409,'V31_SOURCES_CHANGED','独立授权引用的合作版本已变更');
 const current=await freezeV31Preparation(tx,{...frozen.context,revision:agreement.revision});
 // Activation only advances the agreement bookkeeping revision. All actual frozen sources remain exact.
 const snapshot:any=current.snapshot;
 snapshot.business.revision=frozen.snapshot.business.revision;
 assertV31PreparationSourcesCurrent(frozen,{snapshot,hash:canonicalHash(snapshot)});
}
