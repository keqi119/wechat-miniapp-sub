import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {cancellationFactsFixture,renewalNow} from './renewal-cancellation-facts-fixture';

async function read(f:Awaited<ReturnType<typeof cancellationFactsFixture>>,now=renewalNow){
 const module=await import('../src/order-renewals/cancellation-facts');
 assert.equal(typeof module.readRenewalCancellationFacts,'function','internal read-only cancellation facts export required');
 return module.readRenewalCancellationFacts(f.tx,{changeId:f.change.id,customerId:f.customer.id},now);
}
test('confirmed without prepared stage has complete frozen source, zero money and no writes/current eligibility reads',async()=>{
 const f=await cancellationFactsFixture();f.forbidToday();const v=await read(f);
 assert.equal(v.stage,null);assert.equal(v.quote.document.bodyHash,f.quote.snapshot.document.bodyHash);assert.equal(v.funding.receivedAmount,0);assert.equal(v.funding.fundsClear,true);assert.equal(v.signature.canDeclareUnsigned,true);assert.equal(v.sourceSnapshot.frozenQuoteSource.quoteId,f.quote.id);assert.equal(f.writes.length,f.writesBefore);
});
test('prepared source remains readable after original renewal paper invalidated; historical signed files forbid unsigned',async()=>{
 const f=await cancellationFactsFixture(true);f.version.status='INVALIDATED';f.version.invalidatedAt=renewalNow;Object.assign(f.archive,{currentApprovedVersionId:null});f.forbidToday();const v=await read(f);
 assert.equal(v.stage?.status,'PREPARED');assert.equal(v.signature.hasHistoricalSignedUpload,true);assert.equal(v.signature.canDeclareUnsigned,false);assert.equal(v.funding.bills.length,12);assert.equal(f.writes.length,f.writesBefore);
});
test('rejected and removed upload history is not unsigned, while a generated print alone is not a signature',async()=>{
 const f=await cancellationFactsFixture();f.archives.push(f.archive);f.contract.offlineArchiveId=f.archive.id;f.version.files=[];f.version.status='DRAFT';Object.assign(f.version,{submittedAt:null,reviewedAt:null,signedOn:null,fileManifestHash:null});Object.assign(f.archive,{currentApprovedVersionId:null});
 let v=await read(f);assert.equal(v.signature.canDeclareUnsigned,true);
 f.archiveCommands.push({id:'upload-record',resourceId:f.archive.id,action:'FIELD_UPLOAD:'+f.version.id,requestHash:'a'.repeat(64),resultSnapshot:{id:'removed-signature',versionId:f.version.id},createdAt:renewalNow});
 v=await read(f);assert.equal(v.signature.hasHistoricalSignedUpload,true);assert.equal(v.signature.canDeclareUnsigned,false);
});
test('legacy all-null refund ownership counts actual money; only new stage cash is included',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay();f.refund(p,123);const v=await read(f);
 assert.equal(v.funding.receivedAmount,p.amount);assert.equal(v.funding.refundedAmount,123);assert.equal(v.funding.remainingRefundAmount,p.amount-123);assert.equal(v.funding.fundsClear,false);assert.equal(v.funding.payments.length,1);
});
test('full real refunds clear amounts, but reconciliation remains a blocker until reviewed fact clears the flag',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay();f.refund(p);p.reconciliationRequired=true;let v=await read(f);
 assert.equal(v.funding.remainingRefundAmount,0);assert.equal(v.funding.fundsClear,false);assert.ok(v.funding.blockers.includes('PAYMENT_RECONCILIATION_REQUIRED'));
 p.reconciliationRequired=false;v=await read(f);assert.equal(v.funding.fundsClear,true);
});
test('pending channel outcomes and pending refunds do not erase succeeded receipts or fabricate zero outstanding',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay();f.refund(p,100,'PROCESSING');f.newBills[1].payments.push({id:'pending',billId:f.newBills[1].id,customerId:f.customer.id,status:'PENDING',amount:f.newBills[1].amount,revision:1,reconciliationRequired:false,refunds:[]});const v=await read(f);
 assert.equal(v.funding.receivedAmount,p.amount);assert.equal(v.funding.remainingRefundAmount,p.amount);assert.equal(v.funding.fundsClear,false);assert.ok(v.funding.blockers.includes('PAYMENT_UNRESOLVED'));assert.ok(v.funding.blockers.includes('REFUND_UNRESOLVED'));
});
test('refund four-column ownership must be all-null or this exact cancellation/stage/bill',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay(),r=f.refund(p);Object.assign(r,{renewalCancellationId:'cancel',renewalCancellationOrderId:f.order.id,renewalCancellationStageId:f.stage.id,renewalCancellationBillId:p.billId});
 f.openingCase(await read(f));
 assert.equal((await read(f)).funding.fundsClear,true);r.renewalCancellationBillId='old-bill';const v=await read(f);assert.equal(v.funding.fundsClear,false);assert.equal(v.funding.refundedAmount,null);assert.ok(v.funding.blockers.includes('REFUND_SOURCE_MISMATCH'));
});
test('unproved successful refund, mismatched payer and duplicate channel facts cannot clear funding',async()=>{
 for(const mutation of [(f:any,p:any)=>{f.refund(p).providerRefundId=null;},(f:any,p:any)=>{p.customerId='other';},(f:any,p:any)=>{const x=f.pay(f.newBills[1]);x.providerTransactionId=p.providerTransactionId;}]){
  const f=await cancellationFactsFixture(true),p=f.pay();mutation(f,p);const v=await read(f);assert.equal(v.funding.fundsClear,false);assert.ok(v.funding.blockers.length>0);
 }
});
test('late receipt or successful refund changes live funding hash and overall source hash',async()=>{
 const f=await cancellationFactsFixture(true),before=await read(f),p=f.pay(),paid=await read(f);f.refund(p);const refunded=await read(f);
 assert.notEqual(before.funding.sourceHash,paid.funding.sourceHash);assert.notEqual(paid.funding.sourceHash,refunded.funding.sourceHash);assert.notEqual(paid.sourceHash,refunded.sourceHash);assert.deepEqual(before.sourceSnapshot.frozenQuoteSource,refunded.sourceSnapshot.frozenQuoteSource);
});
test('boundary date, active stage, another customer and corrupted confirmed body fail closed',async()=>{
 const f=await cancellationFactsFixture(true);await assert.rejects(read(f,new Date('2027-09-30T16:00:00Z')));f.stage.status='ACTIVE';await assert.rejects(read(f));
 const g=await cancellationFactsFixture();g.change.customerId='other';await assert.rejects(read(g));const h=await cancellationFactsFixture();h.contract.body+='tampered';await assert.rejects(read(h));
});
test('same stage exact bills, obligations and original archive parents are checked even at zero cash',async()=>{
 for(const mutation of [(f:any)=>f.newBills[0].amount++,(f:any)=>f.obligations.find((o:any)=>o.serviceStageId===f.stage.id).stageSequence++,(f:any)=>f.rental.ownerId='other']){
  const f=await cancellationFactsFixture(true);mutation(f);await assert.rejects(read(f));
 }
});
test('unknown storage exceptions propagate instead of presenting missing source or zero money',async()=>{
 const f=await cancellationFactsFixture();const failure=new Error('storage unavailable');f.tx.documentArchive.findMany=async()=>{throw failure;};await assert.rejects(read(f),e=>e===failure);
});
test('same cancellation upload history forbids unsigned and manual evidence changes observed hash only',async()=>{
 const f=await cancellationFactsFixture();const c=f.openingCase(await read(f));
 const before=await read(f);c.signatureEvidenceFileIds=['manual-evidence'];const after=await read(f);assert.notEqual(before.sourceHash,after.sourceHash);assert.deepEqual(before.sourceSnapshot.frozenQuoteSource,after.sourceSnapshot.frozenQuoteSource);
 const a:any={id:'cancel-paper',kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:c.id,renewalCancellationId:c.id,orderId:f.order.id,ownerId:f.owner.id,versions:[{id:'cancel-v1',archiveId:'cancel-paper',version:1,status:'REJECTED',sourceFileId:'unsigned-print',files:[{versionId:'cancel-v1',fileId:'physical-signed'}],feedback:[]}]};f.archives.push(a);
 const v=await read(f);assert.equal(v.signature.hasCancellationSignedUpload,true);assert.equal(v.signature.canDeclareUnsigned,false);
});
test('duplicate receipt blocks both payments, malformed signatures cannot prove unsigned, and unknown bill status blocks finish',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay(),p2=f.pay(f.newBills[1]);p2.providerTransactionId=p.providerTransactionId;const v=await read(f);assert.ok(v.funding.payments.every(p=>p.blockers.includes('MONEY_DUPLICATE_FACT')));
 const g=await cancellationFactsFixture();g.archives.push(g.archive);g.contract.offlineArchiveId=g.archive.id;Object.assign(g.version,{status:'UNRECOGNIZED',files:[],signedOn:null,submittedAt:null,reviewedAt:null,fileManifestHash:null});Object.assign(g.archive,{currentApprovedVersionId:null});assert.equal((await read(g)).signature.canDeclareUnsigned,false);
 const h=await cancellationFactsFixture(true);h.newBills[0].status='UNRECOGNIZED';assert.equal((await read(h)).funding.fundsClear,false);
});
test('known anomalous receipt needs real independent REFUNDED review, not only a cleared flag',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay();f.refund(p);p.reconciliationReason='late receipt';
 assert.equal((await read(f)).funding.fundsClear,false);
 const r:any={id:'review',paymentId:p.id,status:'APPROVED',resolution:'REFUNDED',note:'实际原路全额退款',evidenceFileIds:['finance-evidence'],submittedBy:'first-finance',reviewedBy:'second-finance',createdAt:renewalNow,reviewedAt:renewalNow,paymentSnapshot:{paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,providerTransactionId:p.providerTransactionId,status:p.status}};f.reconciliations.push(r);
 assert.equal((await read(f)).funding.fundsClear,true);
 for(const field of ['resolution','reviewedBy','paymentSnapshot']){const before=structuredClone(r[field]);r[field]=field==='resolution'?'APPLY_TO_BILL':field==='reviewedBy'?r.submittedBy:{...r.paymentSnapshot,customerId:'other'};assert.equal((await read(f)).funding.fundsClear,false);r[field]=before;}
});
test('closed original assignment stays a frozen fact, but wrong delivery or future-start assignment cannot be invented',async()=>{
 const f=await cancellationFactsFixture();f.assignment.status='CLOSED';f.assignment.endAt=renewalNow;assert.equal((await read(f)).stage,null);
 f.assignment.startAt=new Date('2028-01-01');await assert.rejects(read(f));
 const g=await cancellationFactsFixture();g.handovers[0].customerId='other';await assert.rejects(read(g));
});
test('observed snapshot freezes real signature and money summaries without aliasing live ORM objects',async()=>{
 const f=await cancellationFactsFixture(true),p=f.pay(),v=await read(f);
 assert.equal(v.sourceSnapshot.observed.funding.receivedAmount,p.amount);assert.equal(v.sourceSnapshot.observed.signature.hasHistoricalSignedUpload,true);
 const before=structuredClone(v.sourceSnapshot.frozenQuoteSource);f.quote.snapshot.renewalTerms.conditions='later mutation';assert.deepEqual(v.sourceSnapshot.frozenQuoteSource,before);
});
test('scheduled is still future-only; stage-less orphan bills and partial cancellation refund columns never prove zero',async()=>{
 const f=await cancellationFactsFixture(true);Object.assign(f.stage,{status:'SCHEDULED',scheduledBy:'finance',scheduledAt:renewalNow});f.change.status='SCHEDULED';assert.equal((await read(f)).stage?.status,'SCHEDULED');
 const g=await cancellationFactsFixture();g.bills.push({id:'orphan',serviceStageId:g.quote.snapshot.renewalTerms.serviceStageId,idempotencyKey:`renewal:${g.quote.id}:13`,payments:[]});await assert.rejects(read(g));
 const h=await cancellationFactsFixture(true),p=h.pay(),r=h.refund(p);r.renewalCancellationId='partial';assert.equal((await read(h)).funding.refundedAmount,null);
});
test('known invalid original contract evidence is a source conflict, not an internal 500',async()=>{
 const f=await cancellationFactsFixture();f.original.providerTaskId='unexpected-electronic-provider';await assert.rejects(read(f),(e:any)=>e.getStatus?.()===409&&e.getResponse?.().error?.code==='RENEWAL_CANCELLATION_SOURCE');
});
test('after start a missing mutual agreement permits safe preview only, never default refund/finish reads',async()=>{
 const f=await cancellationFactsFixture(true),now=new Date('2027-10-02T02:00:00Z'),{readRenewalCancellationFacts}=await import('../src/order-renewals/cancellation-facts');
 for(const timingPurpose of ['PREVIEW','RECORD_MUTUAL_AGREEMENT'] as const){const v=await readRenewalCancellationFacts(f.tx,{changeId:f.change.id,timingPurpose},now);assert.deepEqual(v.timing,{requiresMutualAgreement:true,mutualAgreementVerified:false,blockers:['RENEWAL_CANCELLATION_AGREEMENT_REQUIRED']});assert.ok(v.blockers.includes('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'));assert.equal(v.funding.receivedAmount,0);}
 await assert.rejects(read(f,now),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_CANCELLATION_AGREEMENT_REQUIRED');assert.equal(f.writes.length,f.writesBefore);
});
test('preview cannot bypass an actual activated timestamp or materialized new-stage usage periods',async()=>{
 const {readRenewalCancellationFacts}=await import('../src/order-renewals/cancellation-facts');
 for(const mutate of [(f:any)=>{f.stage.activatedAt=renewalNow;},(f:any)=>{f.tx.usagePeriod.count=async()=>1;}]){const f=await cancellationFactsFixture(true);mutate(f);await assert.rejects(readRenewalCancellationFacts(f.tx,{changeId:f.change.id,timingPurpose:'PREVIEW'},renewalNow));}
});
test('real verified pre-start mutual agreement lets late paper/refund facts continue, without changing frozen quote',async()=>{
 const f=await cancellationFactsFixture(true),before=await read(f),c=f.openingCase(before);await f.agree(c);const after=await read(f,new Date('2027-10-02T02:00:00Z'));
 assert.deepEqual(after.timing,{requiresMutualAgreement:true,mutualAgreementVerified:true,blockers:[]});assert.equal(after.sourceSnapshot.observed.mutualAgreementProof.hash,c.mutualAgreementHash);assert.deepEqual(after.sourceSnapshot.frozenQuoteSource,before.sourceSnapshot.frozenQuoteSource);
});
test('bad mutual evidence and changed opening frozen source cannot use read-only timing to bypass validation',async()=>{
 const{readRenewalCancellationFacts}=await import('../src/order-renewals/cancellation-facts'),now=new Date('2027-10-02T02:00:00Z');
 const f=await cancellationFactsFixture(),c=f.openingCase(await read(f));await f.agree(c);c.mutualAgreementHash='a'.repeat(64);await assert.rejects(readRenewalCancellationFacts(f.tx,{changeId:f.change.id,timingPurpose:'PREVIEW'},now),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_CANCELLATION_AGREEMENT_INVALID');
 const g=await cancellationFactsFixture(),changed=g.openingCase(await read(g));changed.sourceSnapshot.facts.frozenQuoteSource.quoteId='different-quote';changed.sourceHash=canonicalHash(changed.sourceSnapshot);await g.agree(changed);await assert.rejects(read(g,now));
});
test('historical rejected/submitted archive state still proves a signature conflict when legacy upload command is absent',async()=>{
 const f=await cancellationFactsFixture();f.archives.push(f.archive);f.contract.offlineArchiveId=f.archive.id;Object.assign(f.archive,{currentApprovedVersionId:null});Object.assign(f.version,{files:[],signedOn:null,submittedAt:null,reviewedAt:null,fileManifestHash:null});
 for(const status of ['SUBMITTED','REVIEWED','ARCHIVED','REJECTED','INVALIDATED']){f.version.status=status;assert.equal((await read(f)).signature.canDeclareUnsigned,false,status);}
});
