import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalFixture} from './order-renewals-fixture';
import {renewalPaperFixture} from './renewal-paper-fixture';
import {assertRenewalAgreementQuote} from '../src/order-changes/renewal-agreement';
import {parseStageSnapshot} from '../src/order-service-stages/source';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';
import {partnerProfileInput} from '../src/partners/types';

async function frozen(subjectType:string){
 const base=renewalFixture();Object.assign(base.owner,{subjectType,creditCode:subjectType==='INDIVIDUAL'?null:'91310000123456789X'});Object.assign(base.initial.lessorSnapshot,{subjectType,creditCode:base.owner.creditCode});
 base.stage.snapshot.source.originalTermsHash=canonicalHash(base.initial);base.stage.snapshot.source.agreement.priorTermsHash=hash(base.initial);base.stage.snapshotHash=canonicalHash(base.stage.snapshot);
 // The actual quote flow calls buildOfflineLessorSnapshot; this does not inject a substitute lessor DTO.
 const f=await renewalPaperFixture(base),s=f.quote.snapshot,refs=s.source;
 assert.equal(s.renewalTerms.lessorSnapshot.subjectType,subjectType);
 const snapshot={version:1,kind:'RENEWAL',identity:{serviceStageId:s.renewalTerms.serviceStageId,orderId:f.order.id,customerId:f.customer.id,sequence:refs.nextStageSequence,previousStageId:refs.currentStageId,vehicleId:refs.vehicleId,assignmentId:refs.assignmentId,ownerId:refs.ownerId},period:{startDate:s.startDate,endDate:s.endDate,months:s.months,firstPeriodSequence:s.periods[0].sequence,lastPeriodSequence:s.periods.at(-1).sequence},termsSnapshot:s.renewalTerms,usagePricing:s.usagePricing,swapPolicy:s.swapPolicy,billingSchedule:s.periods,source:{originalTermsHash:canonicalHash(f.initial),product:{listingId:refs.listingId,listingRevision:refs.listingRevision,productVersionId:refs.productVersionId,subscriptionPlanId:refs.subscriptionPlanId,sourceHash:refs.listingSourceHash},agreement:{originalContractId:f.change.originalContractId,originalArchiveVersionId:f.change.originalArchiveVersionId,originalArchiveHash:refs.originalArchiveHash,priorTermsVersionId:f.change.priorTermsVersionId??null,priorTermsHash:f.change.priorTermsHash,changeId:f.change.id,quoteId:f.quote.id,quoteRevision:f.quote.revision,commercialHash:f.quote.commercialHash,approvedArchiveVersionId:f.version.id,approvedArchiveHash:f.version.fileManifestHash,document:s.document}}};
 return{...f,snapshot};
}
for(const validator of ['paper','stage'])for(const subjectType of ['ENTERPRISE','INDIVIDUAL'])test(`real ${subjectType} owner profile and builder output pass the ${validator} validator`,async()=>{
 const f=await frozen(subjectType);assert.equal(partnerProfileInput.safeParse({subjectType,name:f.owner.name,address:f.owner.address,creditCode:f.owner.creditCode,contactPhone:f.owner.contactPhone}).success,true);
 if(validator==='paper')assert.doesNotThrow(()=>assertRenewalAgreementQuote(f.change,f.quote,f.contract,f.order));else assert.equal(parseStageSnapshot(f.snapshot,f.order).termsSnapshot.lessorSnapshot.subjectType,subjectType);
});
for(const validator of ['paper','stage'])for(const subjectType of ['COMPANY','PERSON','UNKNOWN'])test(`non-native ${subjectType} cannot become accepted renewal ${validator} evidence`,async()=>{
 const f=await frozen(subjectType);assert.equal(partnerProfileInput.safeParse({subjectType,name:f.owner.name,address:f.owner.address,creditCode:f.owner.creditCode,contactPhone:f.owner.contactPhone}).success,false);
 if(validator==='paper')assert.throws(()=>assertRenewalAgreementQuote(f.change,f.quote,f.contract,f.order),e=>(e as any).getResponse?.().error?.code==='AGREEMENT_RENEWAL_SOURCE');else assert.throws(()=>parseStageSnapshot(f.snapshot,f.order),e=>(e as any).getResponse?.().error?.code==='SERVICE_STAGE_SOURCE');
});
