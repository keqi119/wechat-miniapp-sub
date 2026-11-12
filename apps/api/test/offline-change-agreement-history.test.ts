import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {requireHistoricalPreparedQuoteAgreement,readChangeAgreementReady} from '../src/order-changes/agreement-readiness';
import {agreementFixture} from './offline-change-agreement-fixture';
const rejected=(e:any)=>e.getStatus?.()===409;
function prepared(){
 const f=agreementFixture(),c=f.addChange();c.quote.financePreparedAt=new Date('2026-10-10T04:00:00Z');c.quote.approvedArchiveVersionId=c.version.id;c.quote.status='SUPERSEDED';
 const active={...structuredClone(c.quote),id:'replacement',revision:2,status:'REVIEWED',financePreparedAt:null,approvedArchiveVersionId:null,contract:null};f.quotes.push(active);c.change.activeQuoteId=active.id;c.change.status='REVIEW_PENDING';return{...f,...c,active};
}
test('an actual prepared historical quote validates its own pin while a different quote is current without changing either',async()=>{
 const f=prepared(),before=JSON.stringify({order:f.order,changes:f.changes,quotes:f.quotes,archives:f.archives});
 const result=await requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id);
 assert.deepEqual(result,{mode:'OFFLINE',contractId:f.contract.id,archiveId:f.archive.id,archiveVersionId:f.version.id,quoteId:f.quote.id,quoteRevision:1,commercialHash:f.quote.commercialHash,fileManifestHash:f.version.fileManifestHash});
 assert.equal((await readChangeAgreementReady(f.tx,f.change.id)).ready,false);assert.equal(f.change.activeQuoteId,f.active.id);assert.equal(JSON.stringify({order:f.order,changes:f.changes,quotes:f.quotes,archives:f.archives}),before);
});
test('never prepared, unpinned, invalid prepared time, unconfirmed and foreign quote cannot use the historical entry point',async()=>{
 for(const mutate of [(f:any)=>f.quote.financePreparedAt=null,(f:any)=>f.quote.financePreparedAt='invalid',(f:any)=>f.quote.financePreparedAt=new Date('2026-10-09'),(f:any)=>f.quote.approvedArchiveVersionId=null,(f:any)=>f.quote.status='REVIEWED',(f:any)=>f.quote.confirmedAt=null,(f:any)=>f.quote.confirmedAt=new Date(f.quote.snapshot.expiresAt),(f:any)=>f.quote.changeId='foreign',(f:any)=>f.change.customerId='foreign']){const f=prepared();mutate(f);await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id),rejected,mutate.toString());}
 const f=prepared();await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.active.id),rejected);await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,'missing',f.quote.id),rejected);
});
test('historical evidence retains exact contract template body archive scope ownership and immutable paper pin',async()=>{
 for(const mutate of [
  (f:any)=>f.contract.customerId='other',(f:any)=>f.contract.orderId='other',(f:any)=>f.contract.delayQuoteId=f.active.id,(f:any)=>f.contract.status='SIGNED',(f:any)=>f.contract.executionMode='ESIGN',(f:any)=>f.contract.providerTaskId='provider',
  (f:any)=>f.contract.documentId='wrong',(f:any)=>f.version.templateVersion=2,(f:any)=>f.quote.snapshot.document.bodyHash=hash('wrong'),(f:any)=>f.quote.snapshot.document.content='wrong',(f:any)=>f.contract.documentHash=hash('wrong'),
  (f:any)=>f.archive.quoteId=f.active.id,(f:any)=>f.archive.orderId='other',(f:any)=>f.archive.ownerId='other',(f:any)=>f.archive.subjectId=f.active.id,(f:any)=>f.version.scopeSnapshot.quoteId=f.active.id,(f:any)=>f.version.businessSnapshotHash=hash('wrong'),
  (f:any)=>f.quote.approvedArchiveVersionId=f.rental.versions[0].id,(f:any)=>f.version.status='INVALIDATED',(f:any)=>f.version.invalidatedAt=new Date(),(f:any)=>f.version.feedback=[{status:'OPEN'}],(f:any)=>f.version.files=[],(f:any)=>f.version.reviewedBy=null,(f:any)=>f.privateIds.add(f.version.sourceFileId),
 ]){const f=prepared();mutate(f);await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id),rejected,mutate.toString());}
});
test('a newer current archive cannot replace an invalid historical amendment pin',async()=>{
 const f=prepared(),newer=structuredClone(f.version);newer.id='newer-paper';newer.version=2;f.archive.versions.push(newer);f.archive.currentApprovedVersionId=newer.id;
 assert.equal((await requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id)).mode,'OFFLINE');f.version.status='INVALIDATED';await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id),rejected);
});
test('before any effective terms a historical quote reads its original rental pin even after current archive correction',async()=>{
 const f=prepared(),original=f.rental.versions[0],newer=structuredClone(original);newer.id='rental-current-correction';newer.version=2;newer.files=[];f.rental.versions.push(newer);f.rental.currentApprovedVersionId=newer.id;
 const result=await requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id);assert.equal(result.mode,'OFFLINE');assert.equal(f.change.originalArchiveVersionId,original.id);original.status='INVALIDATED';await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id),rejected);
});
test('a prepared applied quote still binds its actual previous snapshot after later effective amendments',async()=>{
 const f=agreementFixture(),first=f.addChange(true);first.quote.financePreparedAt=new Date('2026-10-10T04:00:00Z');f.addChange(true);
 assert.equal((await requireHistoricalPreparedQuoteAgreement(f.tx,first.change.id,first.quote.id)).mode,'OFFLINE');first.change.priorTermsVersionId=f.terms[1].id;await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,first.change.id,first.quote.id),rejected);
});
test('history requires the true original and prior chain and propagates unknown storage failures unchanged',async()=>{
 for(const mutate of [(f:any)=>f.change.originalContractId='other',(f:any)=>f.change.originalArchiveVersionId=f.version.id,(f:any)=>f.change.priorTermsVersionId='nonexistent',(f:any)=>f.change.priorTerms.months=99,(f:any)=>f.change.priorTermsHash=hash('wrong'),(f:any)=>f.original.customerId='foreign']){const f=prepared();mutate(f);await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id),rejected,mutate.toString());}
 const f=prepared(),failure=Object.assign(new Error('unavailable'),{code:'P1001'});f.tx.documentArchive.findUnique=async()=>{throw failure;};await assert.rejects(requireHistoricalPreparedQuoteAgreement(f.tx,f.change.id,f.quote.id),e=>e===failure);
});
