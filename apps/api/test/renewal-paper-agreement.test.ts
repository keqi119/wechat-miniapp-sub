import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalPaperFixture} from './renewal-paper-fixture';
import {offlineChangeScope,assertConfirmedQuote,assertHistoricalPreparedQuote} from '../src/order-changes/agreement-facts';
import {readChangeAgreementReady,readEffectiveContractChain,requireHistoricalPreparedQuoteAgreement} from '../src/order-changes/agreement-readiness';
import {resolveAmendmentContext} from '../src/offline-documents/amendment-context';
import {canonicalHash} from '../src/customers/types';
import {agreementFixture} from './offline-change-agreement-fixture';
import {renewalAfterSwapFixture} from './order-renewals-fixture';
import {hash} from '../src/common/data';
const archiveInput=(f:any)=>({kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:f.quote.id});
async function bound(){const f=await renewalPaperFixture();f.version.scopeSnapshot=offlineChangeScope(f.change,f.quote,f.contract);return f;}

test('confirmed renewal generates the exact accepted paper and freezes stage, same-car assignment and incremental periods',async()=>{
 const f=await bound(),before=canonicalHash(f.order),r=await resolveAmendmentContext(f.tx,archiveInput(f));
 assert.equal(r.amendmentContext.body,f.contract.body);assert.equal(r.amendmentContext.kind,'SUBSCRIPTION_EXTENSION');assert(r.amendmentContext.rows.some(r=>r.value==='原单续期'));
 assert.equal((r.scopeSnapshot as any).policy,'OFFLINE_RENEWAL_V1');assert.equal((r.scopeSnapshot as any).serviceStageId,'renewal:order:2');assert.equal((r.scopeSnapshot as any).currentStageId,'initial:order');assert.equal((r.scopeSnapshot as any).originalAssignmentId,f.assignment.id);assert.equal((r.scopeSnapshot as any).periodsHash,canonicalHash(f.quote.snapshot.periods));assert.equal(canonicalHash(f.order),before);
 assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,true);
});
test('only renewal SCHEDULED is eligible and a real prepared pin survives historical active-quote replacement',async()=>{
 const f=await bound();f.prepare();assert.doesNotThrow(()=>assertConfirmedQuote(f.change,f.quote,f.contract,f.order));assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,true);
 f.change.activeQuoteId='newer-quote';f.quote.status='SUPERSEDED';assert.doesNotThrow(()=>assertHistoricalPreparedQuote(f.change,f.quote,f.contract,f.order));assert.equal((await requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id)).mode,'OFFLINE');
 f.quote.approvedArchiveVersionId='wrong-version';await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id));
});
test('renewal evidence rejects semantic tampering even after source and commercial hashes are recomputed',async()=>{
 const mutations=[(f:any)=>f.quote.snapshot.renewalTerms.vehicleId='foreign',(f:any)=>f.quote.snapshot.source.assignmentId='foreign',(f:any)=>f.quote.snapshot.periods[1].startDate='2027-10-01',(f:any)=>f.quote.snapshot.periods[0].amount++,(f:any)=>f.quote.snapshot.depositAmount++,(f:any)=>f.quote.snapshot.usagePricing.baseAllowanceKm++,(f:any)=>f.quote.snapshot.swapPolicy.includedCount++,(f:any)=>f.quote.snapshot.product.baseFeeAmount++,(f:any)=>f.quote.snapshot.renewalTerms.serviceStageId='foreign',(f:any)=>f.quote.snapshot.source.ownerId='foreign',(f:any)=>f.quote.snapshot.source.productVersionId='foreign',(f:any)=>f.quote.snapshot.customerAcceptance.bodyHash='f'.repeat(64)];
 for(const mutate of mutations){const f=await bound();mutate(f);f.reseal();assert.throws(()=>assertConfirmedQuote(f.change,f.quote,f.contract,f.order));}
});
test('paper readiness rechecks the actual previous stage and actual assignment without rewriting history',async()=>{
 for(const mutate of [(f:any)=>f.stage.snapshotHash='f'.repeat(64),(f:any)=>f.assignment.customerId='other',(f:any)=>f.assignment.vehicleId='other',(f:any)=>f.order.currentAssignmentId='other',(f:any)=>f.quote.snapshot.source.currentStageHash='f'.repeat(64)]){
  const f=await bound();mutate(f);if(f.quote.snapshot.source.currentStageHash==='f'.repeat(64)){f.reseal();f.version.scopeSnapshot=offlineChangeScope(f.change,f.quote,f.contract);}assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,false);await assert.rejects(resolveAmendmentContext(f.tx,archiveInput(f)),(e:any)=>e.getStatus?.()===409);
 }
});
test('applied renewal remains real historical paper after later assignment changes but its terms must equal the frozen renewal',async()=>{
 const f=await bound(),terms=f.apply();f.assignment.status='CLOSED';f.assignment.endAt=new Date('2027-11-01');f.order.currentAssignmentId='later-car-assignment';assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).ready,true);
 terms.snapshot.monthlyFeeAmount++;assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).ready,false);
});
test('missing acceptance, original manifest, changed pin or incomplete paper never become renewal readiness',async()=>{
 for(const mutate of [(f:any)=>delete f.quote.snapshot.customerAcceptance,(f:any)=>f.quote.snapshot.offlineSource.originalArchiveHash='f'.repeat(64),(f:any)=>f.rental.versions[0].fileManifestHash='f'.repeat(64),(f:any)=>f.version.status='REVIEWED',(f:any)=>f.version.partyChecks[0].passed=false]){const f=await bound();mutate(f);assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,false);}
});
test('financially prepared renewal requires its actual immutable pin and actual account source',async()=>{
 for(const mutate of [(f:any)=>f.quote.approvedArchiveVersionId=null,(f:any)=>f.quote.financePreparedAt=null,(f:any)=>f.account.id='other',(f:any)=>f.account.customerId='other']){const f=await bound();f.prepare();mutate(f);assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,false);}
});
test('the real applied renewal node remains historical evidence without a fabricated current quote pointer',async()=>{
 const f=await bound();f.apply();f.change.activeQuoteId='replacement';f.quote.status='SUPERSEDED';assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).ready,true);assert.equal((await requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id)).mode,'OFFLINE');assert.equal(f.change.activeQuoteId,'replacement');
});
test('an INITIAL stage keeps its original car when the real same-car renewal follows an applied swap',async()=>{
 const base=renewalAfterSwapFixture(),f=await renewalPaperFixture(base);f.version.scopeSnapshot=offlineChangeScope(f.change,f.quote,f.contract);
 assert.notEqual(f.stage.snapshot.identity.vehicleId,f.quote.snapshot.source.vehicleId);assert.equal(f.quote.snapshot.source.assignmentId,base.currentAssignment.id);assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,true);assert.equal((await resolveAmendmentContext(f.tx,archiveInput(f))).scopeSnapshot.vehicleId,base.target.id);
});
test('SCHEDULED is not an extra capability for old delay or swap evidence and live catalog changes cannot rewrite accepted paper',async()=>{
 const old=agreementFixture(),change=old.addChange();change.change.status='SCHEDULED';assert.throws(()=>assertConfirmedQuote(change.change,change.quote,change.contract,old.order));
 const f=await bound();for(const model of ['legalDocument','vehicleListing','productVersion','vehicleOwner'])f.tx[model].findUnique=async()=>{throw Error('LIVE_SOURCE_MUST_NOT_REPLACE_FROZEN_PAPER');};f.tx.legalDocument.findFirst=async()=>{throw Error('NO_LIVE_TEMPLATE');};
 assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,true);assert.equal((await resolveAmendmentContext(f.tx,archiveInput(f))).amendmentContext.body,f.quote.snapshot.document.content);
});
test('a renewal cannot detach its prior stage marker or omit frozen lessor fields even with new hashes',async()=>{
 for(const mutate of [(f:any)=>{f.change.priorTerms.serviceStageId='other-stage';f.change.priorTermsHash=hash(f.change.priorTerms);f.quote.snapshot.source.priorTermsHash=f.change.priorTermsHash;f.quote.snapshot.offlineSource.priorTermsHash=f.change.priorTermsHash;},(f:any)=>delete f.quote.snapshot.renewalTerms.lessorSnapshot.phone]){const f=await bound();mutate(f);f.reseal();assert.throws(()=>assertConfirmedQuote(f.change,f.quote,f.contract,f.order));}
});
