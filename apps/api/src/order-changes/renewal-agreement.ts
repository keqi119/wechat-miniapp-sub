import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {renewalSourceHash,renewalCommercialHash,assertRenewalFrozenQuote,renewalPreviewInput} from '../order-renewals/types';
import {stagePeriods,stageDay} from '../order-service-stages/source';
import {productV2DraftInput,benefitInput,SELF_PAID_ENERGY} from '../products/types';
import {usagePolicyAppendix} from '../usage/policy';
import {freezeSwapPolicy} from '../swap-purchases/policy';

const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=500&&v.trim()===v&&!v.includes('\0');
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:any,min=0)=>Number.isInteger(v)&&v>=min&&v<=2147483647;
const equal=(a:any,b:any)=>a!==undefined&&b!==undefined&&canonicalHash(a)===canonicalHash(b);
const fact=(v:unknown)=>ensure(v,409,'AGREEMENT_RENEWAL_SOURCE','续期冻结车辆、租期或协议来源不一致');
const text=(v:any)=>typeof v==='string'&&!!v.trim()&&!v.includes('\0');
const vehicle=(t:any)=>{fact(object(t)&&object(t.lessorSnapshot)&&id(t.lessorSnapshot.vehicleId)&&(t.vehicleId==null||t.vehicleId===t.lessorSnapshot.vehicleId));return t.lessorSnapshot.vehicleId;};

/** Pure frozen evidence, shared by paper readiness and the customer-owned projection. No live sources or writes. */
export function assertRenewalAgreementQuote(change:any,q:any,contract:any,order:any,requireAcceptance=true){
 const s=assertRenewalFrozenQuote(change,q),source=s.source,t=s.renewalTerms,p=s.product,prior=change.priorTerms;
 fact(order?.contractMode==='OFFLINE'&&change.orderId===order.id&&change.customerId===order.customerId&&contract?.orderId===order.id&&contract.customerId===order.customerId&&contract.kind==='AMENDMENT'&&contract.executionMode==='OFFLINE'&&contract.status==='DRAFT'&&!contract.providerTaskId&&!contract.signedFileId&&contract.delayQuoteId===q.id);
 fact(source.version===1&&['orderId','customerId','accountId','currentStageId','assignmentId','vehicleId','ownerId','originalContractId','originalArchiveVersionId','qualificationId','listingId','productVersionId','subscriptionPlanId'].every(k=>id(source[k]))&&['orderRevision','accountRevision','vehicleRevision','qualificationRevision','listingRevision'].every(k=>integer(source[k]))&&integer(source.nextStageSequence,2)&&typeof source.initialCandidate==='boolean');
 fact(['currentStageHash','originalArchiveHash','priorTermsHash','listingSourceHash','lessorHash','revenueHash'].every(k=>digest(source[k]))&&text(source.originalContractNumber)&&source.initialCandidate===false);
 fact(source.assignmentId===s.originalAssignmentId&&source.originalArchiveVersionId===s.originalArchiveVersionId&&(source.priorTermsVersionId??null)===(s.priorTermsVersionId??null)&&(source.priorTermsVersionId==null||id(source.priorTermsVersionId))&&change.targetVehicleId==null);
 fact(!Object.hasOwn(prior,'serviceStageId')||id(prior.serviceStageId)&&prior.serviceStageId===source.currentStageId);
 fact(renewalPreviewInput.safeParse(s.input).success&&s.expiresAt===s.input.expiresAt&&s.input.listingId===source.listingId&&s.input.listingRevision===source.listingRevision&&s.input.productVersionId===source.productVersionId&&s.input.listingSourceHash===source.listingSourceHash&&s.input.accountRevision===source.accountRevision);
 fact(object(p)&&Array.isArray(p.benefits)&&p.benefits.length<=50&&integer(p.version,1)&&id(p.productId)&&id(p.productVersionId));
 const benefits=new Set<string>();for(const b of p.benefits){fact(object(b)&&id(b.benefitVersionId)&&id(b.definitionId)&&integer(b.version,1)&&!benefits.has(b.benefitVersionId));benefits.add(b.benefitVersionId);const{benefitVersionId,definitionId,version,...fields}=b;fact(benefitInput.safeParse(fields).success&&b.kind==='DESCRIPTION');}
 fact(productV2DraftInput.safeParse({configurationVersion:p.configurationVersion,name:p.name,months:p.months,baseFeeAmount:p.baseFeeAmount,mileageMonthlyFeeAmount:p.mileageMonthlyFeeAmount,mileagePerMonthKm:p.mileagePerMonthKm,excessMileagePriceAmount:p.excessMileagePriceAmount,swapPolicy:p.swapPolicy,conditions:p.conditions,vehicleIds:p.vehicleIds,modelDefinitionIds:p.modelDefinitionIds,items:[{kind:'BASE_SUBSCRIPTION'},...p.benefits.map((b:any)=>({kind:'BENEFIT',benefitVersionId:b.benefitVersionId}))]}).success);
 fact(p.monthlyFeeAmount===p.baseFeeAmount+p.mileageMonthlyFeeAmount&&p.energyDescription===SELF_PAID_ENERGY&&p.listingId===source.listingId&&p.listingRevision===source.listingRevision&&p.productVersionId===source.productVersionId&&p.sourceHash===source.listingSourceHash&&equal(t.productSnapshot,p)&&equal(t.currentVehicleProductSnapshot,p));
 const{listingId,listingRevision,sourceHash,...configuration}=p;fact(sourceHash===canonicalHash({listingId,listingRevision,vehicleId:source.vehicleId,subscriptionPlanId:source.subscriptionPlanId,product:configuration}));
 fact(vehicle(prior)===source.vehicleId&&vehicle(t)===source.vehicleId&&t.lessorSnapshot.ownerId===source.ownerId&&prior.lessorSnapshot.ownerId===source.ownerId&&['name','subjectType','creditCode'].every(k=>t.lessorSnapshot[k]===prior.lessorSnapshot[k]));
 fact(t.serviceStageId===`renewal:${order.id}:${source.nextStageSequence}`&&t.serviceStageId!==source.currentStageId&&t.startDate===s.startDate&&t.months===s.months&&s.months===p.months&&t.monthlyFeeAmount===s.monthlyFeeAmount&&s.monthlyFeeAmount===p.monthlyFeeAmount&&integer(s.depositAmount)&&s.depositAmount===prior.depositAmount&&t.depositAmount===s.depositAmount);
 fact(['mileagePerMonthKm','excessMileagePriceAmount','energyDescription','conditions'].every(k=>t[k]===p[k])&&t.usagePolicyVersion==='USAGE_V2'&&object(t.usagePolicy));usagePolicyAppendix(t.usagePolicy);
 fact(t.usagePolicy.policyVersion==='USAGE_V2'&&t.usagePolicy.baseAllowanceKm===p.mileagePerMonthKm&&t.usagePolicy.excessPriceAmount===p.excessMileagePriceAmount&&equal(s.usagePricing,{policyVersion:'USAGE_V2',baseAllowanceKm:p.mileagePerMonthKm,excessPriceAmount:p.excessMileagePriceAmount,sourceHash:canonicalHash(t.usagePolicy)})&&equal(s.swapPolicy,freezeSwapPolicy({finalPlanSnapshot:t})));
 fact(Array.isArray(s.periods)&&s.periods.length===s.months&&integer(s.periods[0]?.sequence,1));const schedule=stagePeriods(s.startDate,s.months,s.periods[0].sequence,s.monthlyFeeAmount);
 fact(equal(s.periods,schedule)&&s.endDate===schedule.at(-1)!.endDate&&s.newStartDate===s.startDate&&s.newEndDate===stageDay(new Date(new Date(s.endDate+'T00:00:00Z').getTime()-86400000))&&equal(t.billingSchedule,s.periods)&&equal(t.monthlyAmounts,s.periods.map((r:any)=>r.amount))&&Number.isSafeInteger(s.totalAmount)&&BigInt(s.totalAmount)===BigInt(s.months)*BigInt(s.monthlyFeeAmount));
 const l=t.lessorSnapshot,r=t.revenueRuleSnapshot;fact(l.executionMode==='OFFLINE'&&['ENTERPRISE','INDIVIDUAL'].includes(l.subjectType)&&l.platformLegalEntityName==='上海宁达信息科技有限公司'&&integer(l.profileRevision)&&integer(l.bindingRevision)&&id(l.templateId)&&integer(l.templateVersion,1)&&digest(l.templateHash)&&l.leaseRange?.startDate===s.startDate&&l.leaseRange?.endDate===s.newEndDate);
 fact(['creditCode','address','phone'].every(k=>Object.hasOwn(l,k)&&(l[k]===null||typeof l[k]==='string')));
 fact(object(l.sharingNotice)&&id(l.sharingNotice.id)&&integer(l.sharingNotice.version,1)&&text(l.sharingNotice.title)&&text(l.sharingNotice.content)&&l.sharingNotice.contentHash===hash(l.sharingNotice.content)&&digest(l.sharingNotice.templateHash)&&object(r)&&r.ownerId===source.ownerId&&r.vehicleId===source.vehicleId&&id(r.versionId)&&digest(r.contentHash)&&canonicalHash(r)===source.revenueHash);
 if(l.mode==='SIMPLE_AGREEMENT')fact(l.version===4&&r.mode==='SIMPLE_AGREEMENT'&&id(l.agreementId)&&id(l.agreementVersionId)&&r.agreementId===l.agreementId&&r.agreementVersionId===l.agreementVersionId&&r.versionId===l.agreementVersionId&&l.agreementHash===r.contentHash&&integer(r.partnerRateBps)&&r.partnerRateBps<=10000&&l.partnerRateBps===r.partnerRateBps&&(r.validFrom==null||stageDay(r.validFrom)<=s.startDate)&&(r.validUntil==null||stageDay(r.validUntil)>=s.newEndDate));
 else fact(l.version===3&&id(l.cooperationVersionId)&&id(l.cooperationArchiveId)&&id(l.cooperationSubmissionId)&&integer(l.cooperationSubmissionRevision)&&digest(l.cooperationSubmissionHash)&&id(l.bindingId)&&digest(l.evidenceHash)&&r.cooperationVersionId===l.cooperationVersionId&&object(r.terms)&&r.terms.cooperationVersionId===l.cooperationVersionId&&Array.isArray(r.terms.vehicleIds)&&r.terms.vehicleIds.includes(source.vehicleId)&&stageDay(r.terms.validFrom)<=s.startDate&&stageDay(r.terms.validUntil)>=s.newEndDate);
 const d=s.document;fact(object(d)&&id(d.id)&&d.type==='OFFLINE_ORDER_AMENDMENT'&&integer(d.version,1)&&digest(d.templateHash)&&text(d.content)&&d.bodyHash===hash(d.content)&&contract.documentId===d.id&&contract.templateVersion===d.version&&contract.body===d.content);
 const expectedSource={policy:'OFFLINE_RENEWAL_V1',originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:source.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash,renewalSourceHash:renewalSourceHash(s),serviceStageId:t.serviceStageId};
 fact(equal(s.offlineSource,expectedSource)&&digest(q.commercialHash)&&contract.documentHash===q.commercialHash&&t.commercialHash===q.commercialHash&&t.amendmentContractId===contract.id&&renewalCommercialHash(change,s,d.templateHash,contract.id,s.offlineSource)===q.commercialHash);
 if(requireAcceptance){const a=s.customerAcceptance;fact(object(a)&&a.customerId===order.customerId&&a.sharingAccepted===true&&a.bodyHash===d.bodyHash&&a.lessorHash===source.lessorHash&&a.noticeHash===l.sharingNotice.contentHash&&z.iso.datetime({offset:true}).safeParse(a.confirmedAt).success&&q.confirmedAt!=null&&new Date(a.confirmedAt).getTime()===new Date(q.confirmedAt).getTime());}
 return s;
}

export function renewalAgreementScope(change:any,q:any,contract:any){
 const s=assertRenewalAgreementQuote(change,q,contract,{id:contract?.orderId,customerId:contract?.customerId,contractMode:contract?.executionMode});
 return{policy:'OFFLINE_RENEWAL_V1' as const,serviceStageId:s.renewalTerms.serviceStageId,currentStageId:s.source.currentStageId,currentStageHash:s.source.currentStageHash,renewalSourceHash:s.sourceHash,startDate:s.startDate,endDate:s.endDate,periodsHash:canonicalHash(s.periods)};
}
