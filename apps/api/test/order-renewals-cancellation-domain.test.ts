import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {renewalOps,renewalFinance} from './order-renewals-fixture';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {addRenewalCancellationArchive} from './renewal-cancellation-paper-fixture';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
function methods(f:any){for(const name of ['cancellationPreview','openCancellation','verifyCancellationSignature','cancelPrepared','requestCancellationRefund'])assert.equal(typeof f.service[name],'function',name+' must use the real cancellation command');return f.service as any;}
async function open(f:any,key='cancel-open-once'){const s=methods(f),p=await s.cancellationPreview(f.change.id,renewalOps),input={revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,reason:'双方协商取消尚未开始的新增续期',idempotencyKey:key};return{result:await s.openCancellation(f.change.id,input,renewalOps),input};}
async function verify(f:any,state='UNSIGNED'){const s=methods(f),p=await s.cancellationPreview(f.change.id,renewalOps);return s.verifyCancellationSignature(f.change.id,{cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision,revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,signatureState:state,evidenceFileIds:[f.evidence.id],note:'双方已明确同意取消；运营核对所有历史签署记录及实际原件',idempotencyKey:'cancel-signature-'+state},renewalOps);}
async function finalInput(f:any){const s=methods(f),p=await s.cancellationPreview(f.change.id,renewalOps);return{cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision,revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,reason:'已逐项核清本次新增续期及取消证据',idempotencyKey:'cancel-complete-once'};}
async function agree(f:any,service:any=f.service,at='2026-10-31T02:00:00Z'){const p=await service.cancellationPreview(f.change.id,renewalOps),input={cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision,revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,mutuallyAgreedAt:at,evidenceFileIds:[f.evidence.id],note:'原客户与本次真实出租方已在所记时间共同同意取消本次续期，已核对原始证据',idempotencyKey:'mutual-agreement-once'};return{input,result:await service.confirmCancellationAgreement(f.change.id,input,renewalOps)};}

test('OPEN holds an unprepared confirmed renewal with UNKNOWN signature; same-key replay is write-free and current permission is rechecked',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();const s=methods(f),original=structuredClone({terms:f.terms,initial:f.initial,assignment:f.assignment,quote:f.quote});const {result,input}=await open(f);
 assert.equal(f.cases.length,1);assert.equal(f.cases[0].status,'OPEN');assert.equal(f.cases[0].signatureState,'UNKNOWN');assert.equal(f.cases[0].serviceStageId,null);assert.equal(f.stages.length,1);
 const writes=f.writes.length,revision=f.order.revision;assert.deepEqual(await s.openCancellation(f.change.id,input,renewalOps),result);assert.equal(f.writes.length,writes);assert.equal(f.order.revision,revision);assert.deepEqual({terms:f.terms,initial:f.initial,assignment:f.assignment,quote:f.quote},original);
 await assert.rejects(s.openCancellation(f.change.id,{...input,reason:'另一个正文'},renewalOps),code('IDEMPOTENCY_CONFLICT'));f.staff.get('ops')!.authVersion++;await assert.rejects(s.openCancellation(f.change.id,input,renewalOps),code('STAFF_SESSION_CHANGED'));
});
test('unpaid no-stage cancellation requires explicit verified UNSIGNED evidence and retains quote, contract and initial period',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();const s=methods(f);await open(f);await assert.rejects(s.cancelPrepared(f.change.id,await finalInput(f),renewalOps));assert.equal(f.change.status,'AWAITING_ARCHIVE');
 await verify(f);await assert.rejects(s.cancelPrepared(f.change.id,await finalInput(f),renewalOps),code('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'));await agree(f);const old=structuredClone({bills:f.bills,initial:f.initial,account:f.account,assignment:f.assignment,contracts:f.contracts}),input=await finalInput(f),result=await s.cancelPrepared(f.change.id,input,renewalOps);
 assert.equal(f.change.status,'CANCELLED');assert.equal(f.cases[0].status,'COMPLETED');assert.equal(f.quote.status,'CONFIRMED');assert.equal(f.stages.length,1);assert.deepEqual({bills:f.bills,initial:f.initial,account:f.account,assignment:f.assignment,contracts:f.contracts},old);const count=f.writes.length;assert.deepEqual(await s.cancelPrepared(f.change.id,input,renewalOps),result);assert.equal(f.writes.length,count);
 const read=await s.cancellationPreview(f.change.id,renewalOps);assert.equal(read.status,'COMPLETED');assert.equal(read.cancellationId,f.cases[0].id);assert.equal(f.writes.length,count);
});
test('historical signed amendment cannot be relabelled UNSIGNED, nor may private asset evidence be borrowed',async()=>{
 const f=await renewalCancellationFixture();const s=methods(f);await open(f);await assert.rejects(verify(f));assert.equal(f.cases[0].signatureState,'UNKNOWN');f.assetIds.add(f.evidence.id);await assert.rejects(verify(f,'SIGNED'),code('ASSET_FILE_ROUTE_REQUIRED'));assert.equal(f.cases[0].signatureState,'UNKNOWN');
 await assert.rejects(s.verifyCancellationSignature(f.change.id,{...(await finalInput(f)),signatureState:'SIGNED',evidenceFileIds:[f.evidence.id],note:'核对'},renewalFinance));
});
test('OPEN and final commands reject service start, current source changes and stale previews without touching original money',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();const s=methods(f),p=await s.cancellationPreview(f.change.id,renewalOps),before=structuredClone(f.bills);f.order.revision++;
 await assert.rejects(s.openCancellation(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision-1,previewHash:p.previewHash,reason:'双方取消',idempotencyKey:'stale-cancel-open'},renewalOps),code('VERSION_CONFLICT'));assert.equal(f.cases.length,0);assert.deepEqual(f.bills,before);
 const onStart=new OrderRenewalsService(f.db as any,()=>new Date(f.quote.snapshot.startDate+'T00:00:00+08:00')),late=await (onStart as any).cancellationPreview(f.change.id,renewalOps);assert(late.blockers.includes('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'));await assert.rejects((onStart as any).openCancellation(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,previewHash:late.previewHash,reason:'无期前同意证明',idempotencyKey:'late-open-without-proof'},renewalOps),code('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'));
 f.quote.snapshot.renewalTerms.monthlyFeeAmount++;await assert.rejects(s.cancellationPreview(f.change.id,renewalOps),code('RENEWAL_CANCELLATION_SOURCE'));assert.equal(f.cases.length,0);assert.deepEqual(f.bills,before);
});
test('refund command rejects caller amount and non-finance actors before creating any refund',async()=>{
 const f=await renewalCancellationFixture(true),s=methods(f);await open(f);const p=await s.cancellationPreview(f.change.id,renewalFinance),input={...(await finalInput(f)),previewHash:p.previewHash,paymentId:'foreign-original-payment',reason:'全额退新增实收',idempotencyKey:'cancel-refund-once'};
 await assert.rejects(s.requestCancellationRefund(f.change.id,{...input,amount:1},renewalFinance));await assert.rejects(s.requestCancellationRefund(f.change.id,input,renewalOps),code('FORBIDDEN'));assert.equal(f.refunds.length,0);
});
test('signature correction retains all private evidence IDs while only newly added files must belong to the current submitter',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();const s=methods(f);await open(f);await verify(f);const old=f.evidence.id;
 f.staff.set('ops-two',{id:'ops-two',role:'OPERATIONS',authVersion:1,active:true});const actor={id:'ops-two',role:'OPERATIONS',authVersion:1};
 const next={...f.evidence,id:'new-signature-evidence',adminId:'ops-two'};f.files.push(next);let p=await s.cancellationPreview(f.change.id,actor);
 const input={cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision,revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,signatureState:'UNSIGNED',evidenceFileIds:[next.id],note:'另一运营人员补充核对双方未签及取消意愿',idempotencyKey:'cancel-evidence-append'};
 await s.verifyCancellationSignature(f.change.id,input,actor);assert.deepEqual(new Set(f.cases[0].signatureEvidenceFileIds),new Set([old,next.id]));
 const correction=f.audits.filter((a:any)=>a.action==='RENEWAL_CANCELLATION_VERIFY_SIGNATURE').at(-1);assert.equal(correction.data.before?.signatureState,'UNSIGNED');assert.equal(correction.data.before?.verifiedBy,'ops');assert.equal(correction.data.after?.verifiedBy,'ops-two');assert.deepEqual(correction.data.inputFileIds,[next.id]);
 const foreign={...f.evidence,id:'unrelated-admin-file',adminId:'another'};f.files.push(foreign);p=await s.cancellationPreview(f.change.id,actor);
 await assert.rejects(s.verifyCancellationSignature(f.change.id,{...input,cancellationRevision:f.cases[0].revision,revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,evidenceFileIds:[foreign.id],idempotencyKey:'reject-foreign-evidence'},actor),code('FILE_OWNERSHIP'));
 const finance=await s.cancellationPreview(f.change.id,renewalFinance);assert.equal('signatureEvidenceFileIds'in finance,false);assert.equal('signatureNote'in finance,false);
});

test('prepared SIGNED full refund uses exact new-stage money, preserves original deposit and paid bills, then voids only future unpaid receivables',async()=>{
 const f=await renewalCancellationFixture(true,{depositAmount:50000}),s=methods(f),first=f.bills.find(b=>b.serviceStageId===f.stage!.id)!,payment=f.pay(first),deposit=f.bills.find(b=>b.type==='DEPOSIT')!;f.pay(deposit);
 const scheduled=await f.service.schedulePreview(f.change.id,renewalFinance);await f.service.schedule(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,stageId:f.stage!.id,stageRevision:f.stage!.revision,previewHash:scheduled.previewHash,idempotencyKey:'real-schedule-before-cancel'},renewalFinance);assert.equal(f.stage!.status,'SCHEDULED');
 const original=structuredClone({bills:f.bills.filter(b=>!b.serviceStageId),initial:f.initial,assignment:f.assignment,account:f.account,terms:f.terms});await open(f);await verify(f,'SIGNED');const paper=await addRenewalCancellationArchive(f,f.cases[0]);
 let unconfirmed=await s.cancellationPreview(f.change.id,renewalFinance);await assert.rejects(s.requestCancellationRefund(f.change.id,{...(await finalInput(f)),paymentId:payment.id,previewHash:unconfirmed.previewHash,reason:'还未独立核对双方同意',idempotencyKey:'no-mutual-refund'},renewalFinance),code('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'));await agree(f);
 let p=await s.cancellationPreview(f.change.id,renewalFinance);const input={...(await finalInput(f)),paymentId:payment.id,previewHash:p.previewHash,reason:'本次新增续期实收原路全退，无取消费',idempotencyKey:'full-new-renewal-refund'};
 const result=await s.requestCancellationRefund(f.change.id,input,renewalFinance);assert.equal(result.amount,20000);assert.equal(f.refunds.length,1);assert.equal(f.refunds[0].status,'PENDING_APPROVAL');assert.deepEqual([f.refunds[0].renewalCancellationId,f.refunds[0].renewalCancellationOrderId,f.refunds[0].renewalCancellationStageId,f.refunds[0].renewalCancellationBillId],[f.cases[0].id,f.order.id,f.stage!.id,first.id]);assert.equal(f.refunds[0].approvedBy,undefined);
 const writes=f.writes.length;assert.deepEqual(await s.requestCancellationRefund(f.change.id,input,renewalFinance),result);assert.equal(f.writes.length,writes);await assert.rejects(s.cancelPrepared(f.change.id,await finalInput(f),renewalOps),code('RENEWAL_CANCELLATION_FUNDS_UNRESOLVED'));
 Object.assign(f.refunds[0],{status:'SUCCEEDED',approvedBy:'independent-finance',providerRefundId:'verified-new-stage-refund',succeededAt:new Date('2026-10-31T02:10:00Z')});
 const complete=await s.cancelPrepared(f.change.id,await finalInput(f),renewalOps);assert.equal(complete.status,'COMPLETED');assert.equal(f.stage!.status,'VOIDED');assert.equal(first.status,'PAID');assert.equal(first.paidAmount,20000);assert(f.bills.filter(b=>b.serviceStageId===f.stage!.id&&b.id!==first.id).every(b=>b.status==='VOID'));assert(f.allocations.filter(a=>a.paymentId===payment.id).every(a=>a.releasedAt));assert.equal(f.cases[0].approvedArchiveVersionId,paper.version.id);
 assert.deepEqual({bills:f.bills.filter(b=>!b.serviceStageId),initial:f.initial,assignment:f.assignment,account:f.account,terms:f.terms},original);assert.equal(f.bills.at(-1)!.sequence,24);assert.equal(f.quotes.length,1);assert.equal(f.refunds[0].status,'SUCCEEDED');
});

test('new money after a cancellation preview invalidates finalization and pending payment cannot be silently voided',async()=>{
 const f=await renewalCancellationFixture(true),s=methods(f);await open(f);await verify(f,'SIGNED');await agree(f);await addRenewalCancellationArchive(f,f.cases[0]);const input=await finalInput(f),first=f.bills.find(b=>b.serviceStageId===f.stage!.id)!;
 first.payments.push({id:'in-flight',billId:first.id,customerId:f.customer.id,status:'PENDING',revision:0,amount:first.amount,reconciliationRequired:false,refunds:[]});
 await assert.rejects(s.cancelPrepared(f.change.id,input,renewalOps),code('PREVIEW_CHANGED'));await assert.rejects(s.cancelPrepared(f.change.id,await finalInput(f),renewalOps),code('RENEWAL_CANCELLATION_FUNDS_UNRESOLVED'));assert.equal(f.stage!.status,'PREPARED');assert.equal(first.status,'PENDING');assert.equal(f.cases[0].status,'OPEN');
});

test('mutual agreement confirmation is an explicit immutable command; OPEN time never authorizes cancellation after start',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();const s=methods(f);await open(f);assert.equal(typeof s.confirmCancellationAgreement,'function','a distinct, evidence-backed mutual-agreement command is required');
 const{input,result}=await agree(f),hash=f.cases[0].mutualAgreementHash,writes=f.writes.length;assert.equal(typeof hash,'string');assert.equal(hash.length,64);assert.deepEqual(await s.confirmCancellationAgreement(f.change.id,input,renewalOps),result);assert.equal(f.writes.length,writes);
 const p=await s.cancellationPreview(f.change.id,renewalOps);await assert.rejects(s.confirmCancellationAgreement(f.change.id,{...input,revision:f.change.revision,orderRevision:f.order.revision,cancellationRevision:f.cases[0].revision,previewHash:p.previewHash,idempotencyKey:'must-not-replace-mutual'},renewalOps),code('RENEWAL_CANCELLATION_AGREEMENT_INVALID'));
 const after=new OrderRenewalsService(f.db as any,()=>new Date('2027-10-02T02:00:00Z'));const valid=await (after as any).cancellationPreview(f.change.id,renewalOps);assert.equal(valid.mutualAgreementVerified,true);assert(!valid.blockers.includes('RENEWAL_CANCELLATION_AGREEMENT_REQUIRED'));
});

test('late opening atomically records true pre-start mutual agreement and never uses case creation time as consent',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();const s:any=new OrderRenewalsService(f.db as any,()=>new Date('2027-10-02T02:00:00Z')),p=await s.cancellationPreview(f.change.id,renewalOps);
 const input={revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,reason:'期前双方已同意，现补录原始证据继续退款核清',idempotencyKey:'late-open-real-proof',mutualAgreement:{mutuallyAgreedAt:'2027-09-30T15:59:00Z',evidenceFileIds:[f.evidence.id],note:'双方在上海9月30日23:59同意取消，原始联系记录已核对'}};
 const result=await s.openCancellation(f.change.id,input,renewalOps);assert.equal(result.status,'OPEN');assert.equal(f.cases.length,1);assert.equal(f.cases[0].mutuallyAgreedAt.toISOString(),'2027-09-30T15:59:00.000Z');assert.equal(f.cases[0].mutualAgreementVerifiedAt.toISOString(),'2027-10-02T02:00:00.000Z');assert.equal(f.cases[0].signatureState,'UNKNOWN');
});

test('a late anomalous receipt can request its whole refund, but completed refund without an independent REFUNDED review cannot finalize',async()=>{
 const f=await renewalCancellationFixture(true),s=methods(f);await open(f);await verify(f,'SIGNED');await agree(f);await addRenewalCancellationArchive(f,f.cases[0]);const first=f.bills.find(b=>b.serviceStageId===f.stage!.id)!,payment=f.pay(first);Object.assign(payment,{reconciliationRequired:true,reconciliationReason:'取消OPEN之后的可信晚到实收'});
 let p=await s.cancellationPreview(f.change.id,renewalFinance);const request=await s.requestCancellationRefund(f.change.id,{...(await finalInput(f)),paymentId:payment.id,previewHash:p.previewHash,reason:'晚到新增续期实收全额退款',idempotencyKey:'late-money-refund'},renewalFinance);assert.equal(request.amount,20000);
 Object.assign(f.refunds[0],{status:'SUCCEEDED',providerRefundId:'late-money-refund-receipt',succeededAt:new Date('2026-10-31T02:10:00Z'),approvedBy:'reviewer'});payment.reconciliationRequired=false;await assert.rejects(s.cancelPrepared(f.change.id,await finalInput(f),renewalOps),code('RENEWAL_CANCELLATION_FUNDS_UNRESOLVED'));assert.equal(f.cases[0].status,'OPEN');
 f.reconciliations.push({id:'late-money-refunded-review',paymentId:payment.id,status:'APPROVED',resolution:'REFUNDED',submittedBy:'finance',reviewedBy:'independent-finance',createdAt:new Date('2026-10-31T02:11:00Z'),reviewedAt:new Date('2026-10-31T02:12:00Z'),evidenceFileIds:['financial-refund-proof'],paymentSnapshot:{paymentId:payment.id,billId:payment.billId,customerId:payment.customerId,amount:payment.amount,providerTransactionId:payment.providerTransactionId,status:payment.status}});
 await s.cancelPrepared(f.change.id,await finalInput(f),renewalOps);assert.equal(f.cases[0].status,'COMPLETED');assert.equal(f.refunds[0].status,'SUCCEEDED');
});
