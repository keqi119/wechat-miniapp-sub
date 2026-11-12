import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineDelayFixture} from './offline-delivery-delay-fixture';
import {hash} from '../src/common/data';
import {publish,confirm,quote,review} from '../src/order-changes/quotes';
import {prepareFinance,applyDelay} from '../src/order-changes/finance';
import * as context from '../src/order-changes/context';
import {OrderChangesService} from '../src/order-changes/service';

const ops={id:'ops',role:'OPERATIONS',authVersion:1},finance={id:'finance',role:'FINANCE',authVersion:1};
const code=(expected:string)=>(error:any)=>error?.getResponse?.().error?.code===expected;
test('OFFLINE publishes approved paper text using frozen names and archive evidence without eSign',async()=>{
 const f=offlineDelayFixture();await publish(f.tx,f.change);
 assert.equal(f.quote.status,'PUBLISHED');const c=f.contracts.at(-1)!;assert.equal(c.executionMode,'OFFLINE');assert.equal(c.status,'DRAFT');assert.equal(c.kind,'AMENDMENT');assert.equal(c.providerTaskId,undefined);
 assert.match(c.body,/原签约客户 \/ 原出租方/);assert.match(c.body,new RegExp(f.rental.currentApprovedVersionId));assert.match(c.body,new RegExp(f.rental.versions[0].fileManifestHash));
 assert.equal(f.quote.snapshot.document.type,'OFFLINE_ORDER_AMENDMENT');assert.equal(f.quote.snapshot.document.bodyHash,hash(c.body));assert.equal(f.quote.snapshot.document.templateHash,hash(f.legal.content));assert.equal(c.documentHash,f.quote.commercialHash);
 assert.equal(f.quote.snapshot.originalArchiveHash,f.rental.versions[0].fileManifestHash);assert.equal(f.change.status,'AWAITING_CONFIRMATION');
});
test('missing frozen ID plaintext or customer profile never falls back to current customer or eSign',async()=>{
 const f=offlineDelayFixture();f.legal.content='客户身份证 {{customerIdentityNo}}';await assert.rejects(publish(f.tx,f.change),code('LEGAL_PLACEHOLDERS'));assert.equal(f.writes.length,0);
 const g=offlineDelayFixture();delete(g.initial as any).customerProfileSnapshot;g.change.priorTerms=structuredClone(g.initial);g.change.priorTermsHash=hash(g.initial);await assert.rejects(publish(g.tx,g.change),code('OFFLINE_CUSTOMER_SNAPSHOT_REQUIRED'));assert.equal(g.writes.length,0);
});
test('OFFLINE eligibility opens only from an actual DRAFT main archive and complete source',async()=>{
 const f=offlineDelayFixture();f.changes.length=0;const inspect=(context as any).offlineDelayEligibility;assert.equal(typeof inspect,'function');
 const eligible=await inspect(f.tx,f.order);assert.equal(eligible.ready,true);assert.equal(eligible.originalArchiveVersionId,f.rental.currentApprovedVersionId);
 const view=await context.delayContext(f.tx,f.order.id);assert.equal(view.public.canCreate,true);assert.equal(view.contract.id,'original');assert.equal(view.public.blockers.some((x:string)=>x.includes('主合同尚未签署')),false);
});
test('actual delivery and invalid frozen qualification block OFFLINE publication before mutations',async()=>{
 const f=offlineDelayFixture();f.tx.handover.count=async({where}:any)=>where.status==='COMPLETED'?1:0;await assert.rejects(publish(f.tx,f.change),code('ALREADY_DELIVERED'));assert.equal(f.writes.length,0);
 const g=offlineDelayFixture();g.risk.decision='REJECTED';await assert.rejects(publish(g.tx,g.change),code('ORDER_RISK_SNAPSHOT_MISMATCH'));assert.equal(g.writes.length,0);
});
test('customer confirmation remains independent of electronic signing and advances only to paper archive',async()=>{
 const f=offlineDelayFixture();await publish(f.tx,f.change);const service=new OrderChangesService(f.db as any,()=>new Date());
 const view=await service.view(f.tx,f.change.id,undefined,'customer');assert.equal(view.canConfirm,true);assert.equal(view.canSign,false);assert.equal(view.canSync,false);
 await confirm(f.tx,f.change,{commercialHash:f.quote.commercialHash});assert.equal(f.change.status,'AWAITING_ARCHIVE');assert.equal(f.quote.status,'CONFIRMED');assert.equal(f.contracts.at(-1)!.status,'DRAFT');
});
test('finance pins real approved archive and apply stores same paper evidence while keeping contract DRAFT',async()=>{
 const f=offlineDelayFixture(true);await prepareFinance(f.tx,f.change,finance);assert.equal(f.quote.approvedArchiveVersionId,f.version.id);assert.equal(f.obligations.length,3);assert.equal(f.allocations.reduce((n,a)=>n+a.amount,0),30000);assert.equal(f.refunds.length,0);
 await applyDelay(f.tx,f.change);assert.equal(f.change.status,'APPLIED');assert.equal(f.terms[0].offlineArchiveVersionId,f.version.id);assert.equal(f.terms[0].snapshot.startDate,'2026-11-01');assert.equal(f.contract.status,'DRAFT');assert.equal(f.original.status,'DRAFT');
 assert.deepEqual(f.bills.map(b=>[b.amount,b.status]),[[10000,'PAID'],[10000,'PAID'],[10000,'PAID']]);
});
test('paper readiness rejects unarchived, wrong pin, stale previous terms and invalidated evidence before money changes',async()=>{
 for(const mutate of [(f:any)=>f.version.status='REVIEWED',(f:any)=>f.quote.approvedArchiveVersionId='wrong',(f:any)=>f.change.priorTermsVersionId='wrong',(f:any)=>f.version.invalidatedAt=new Date()]){
  const f=offlineDelayFixture(true);mutate(f);await assert.rejects(prepareFinance(f.tx,f.change,finance));assert.equal(f.obligations.length,0);assert.equal(f.allocations.length,0);
 }
});
test('changed real funds fail before preparing allocations; applied later uses the original pinned paper version',async()=>{
 const f=offlineDelayFixture(true);f.bills[0].payments[0].refunds.push({status:'SUCCEEDED',amount:100});await assert.rejects(prepareFinance(f.tx,f.change,finance),code('FUNDS_CHANGED'));assert.equal(f.obligations.length,0);
 const g=offlineDelayFixture(true);await prepareFinance(g.tx,g.change,finance);g.version.invalidatedAt=new Date();await assert.rejects(applyDelay(g.tx,g.change));assert.equal(g.terms.length,0);
});
test('current staff authorization precedes create/action replay and customer ownership is enforced',async()=>{
 const f=offlineDelayFixture();const service=new OrderChangesService(f.db as any,()=>new Date());const input={idempotencyKey:'replayed',revision:1};f.tx.adminUser.findUnique=async()=>({id:'ops',role:'OPERATIONS',active:false});
 f.tx.orderChange.findUnique=async()=>({...f.change,requestHash:hash(input),createdBy:ops.id});await assert.rejects(service.create('order',input,ops),code('STAFF_SESSION_CHANGED'));
 f.audits.push({resourceType:'order-changes',resourceId:f.change.id,action:'DELAY_cancel_replayed',actorId:ops.id,data:{requestHash:hash(input)}});await assert.rejects(service.act(f.change.id,'cancel',input,ops),code('STAFF_SESSION_CHANGED'));
 await assert.rejects(service.act(f.change.id,'confirm',input,undefined,'another-customer'),code('NOT_FOUND'));
});
test('quote retains same number of periods, later date, integer money and independent financial reviewer',async()=>{
 const f=offlineDelayFixture();f.change.status='DRAFT';const input={...f.quote.snapshot,periods:f.quote.snapshot.periods.map((r:any)=>({sequence:r.sequence,dueDate:r.dueDate,amount:r.amount,calculationBasis:r.calculationBasis}))};
 await assert.rejects(quote(f.tx,f.change,{...input,newStartDate:'2026-09-01'},ops),code('DELAY_DATE'));
 await assert.rejects(quote(f.tx,f.change,{...input,periods:input.periods.slice(1)},ops),code('PERIODS_REQUIRED'));
 await assert.rejects(quote(f.tx,f.change,{...input,periods:input.periods.map((r:any)=>({...r,amount:1.5}))},ops),code('AMOUNT_INVALID'));
 f.change.status='REVIEW_PENDING';await assert.rejects(review(f.tx,f.change,{decision:'APPROVED',note:'核对'},ops),code('TWO_PERSON_REQUIRED'));
});
test('a second delay uses the complete effective chain and true prior terms id/hash',async()=>{
 const f=offlineDelayFixture(true);await prepareFinance(f.tx,f.change,finance);await applyDelay(f.tx,f.change);
 const second=f.addChange();Object.assign(second.change,{status:'REVIEWED',revision:1});Object.assign(second.quote,{status:'REVIEWED',createdBy:'ops',reviewedBy:'finance',snapshot:{...structuredClone(f.quote.snapshot),document:null,newStartDate:'2026-12-01',newEndDate:'2027-02-28'}});
 f.contracts.splice(f.contracts.indexOf(second.contract),1);second.quote.contract=null;
 const domain=await (context as any).offlineDelayEligibility(f.tx,f.order);assert.equal(domain.ready,true);assert.equal(domain.priorTermsVersionId,f.terms[0].id);
 await publish(f.tx,second.change);assert.equal(second.quote.snapshot.offlineSource.priorTermsVersionId,f.terms[0].id);assert.equal(second.quote.snapshot.offlineSource.priorTermsHash,hash(f.terms[0].snapshot));assert.notEqual(second.quote.snapshot.offlineSource.priorTermsHash,f.terms[0].hash);
 f.version.invalidatedAt=new Date();await assert.rejects(context.requireOfflineDelayFacts(f.tx,f.order,second.change));
});
test('OFFLINE create still refuses an unfinished change and customer confirmation replay does not publish or confirm twice',async()=>{
 const f=offlineDelayFixture();f.tx.$queryRaw=async()=>[];const service=new OrderChangesService(f.db as any,()=>new Date());await assert.rejects(service.create(f.order.id,{expectedOrderRevision:f.order.revision,priorTermsHash:f.change.priorTermsHash,reason:'延期',idempotencyKey:'gate'},ops),code('CHANGE_BLOCKED'));assert.equal(f.writes.length,0);
 await publish(f.tx,f.change);const input={revision:f.change.revision,commercialHash:f.quote.commercialHash,idempotencyKey:'customer-confirm'};
 await service.act(f.change.id,'confirm',input,undefined,'customer');const confirmedAt=f.quote.confirmedAt;const writes=f.writes.filter(w=>w.table==='quote').length;
 await service.act(f.change.id,'confirm',input,undefined,'customer');assert.equal(f.quote.confirmedAt,confirmedAt);assert.equal(f.writes.filter(w=>w.table==='quote').length,writes);
 await assert.rejects(service.act(f.change.id,'confirm',{...input,commercialHash:'a'.repeat(64)},undefined,'customer'),code('IDEMPOTENCY_CONFLICT'));
});
test('confirmation rejects expired or changed template and is rechecked against actual delivery and qualification',async()=>{
 for(const [mutate,error] of [
  [(f:any)=>f.quote.snapshot.expiresAt='2020-01-01T00:00:00.000Z','QUOTE_EXPIRED'],
  [(f:any)=>f.legal.content+=' amended','LEGAL_UNAVAILABLE'],
  [(f:any)=>f.tx.vehicleAssignment.count=async()=>1,'ALREADY_DELIVERED'],
  [(f:any)=>f.qualification.status='REJECTED','CUSTOMER_QUALIFICATION_REQUIRED'],
 ] as const){const f=offlineDelayFixture();await publish(f.tx,f.change);mutate(f);const count=f.writes.length;await assert.rejects(confirm(f.tx,f.change,{commercialHash:f.quote.commercialHash}),code(error));assert.equal(f.quote.status,'PUBLISHED');assert.equal(f.writes.length,count);}
});
test('unapproved or wrong-purpose legal text and frozen party mismatch are never published',async()=>{
 for(const [mutate,error] of [
  [(f:any)=>f.legal.confirmedBy=null,'LEGAL_NOT_APPROVED'],
  [(f:any)=>f.legal.type='OFFLINE_RENTAL','LEGAL_UNAVAILABLE'],
  [(f:any)=>{f.initial.partiesSnapshot[0].name='另一个人';f.change.priorTerms=structuredClone(f.initial);f.change.priorTermsHash=hash(f.initial);},'OFFLINE_PARTIES_SNAPSHOT_REQUIRED'],
 ] as const){const f=offlineDelayFixture();mutate(f);await assert.rejects(publish(f.tx,f.change),code(error));assert.equal(f.writes.length,0);}
});
test('published JSON template freezes exact body but hashes original template content',async()=>{
 const f=offlineDelayFixture();f.legal.content=JSON.stringify({body:'纸质补充 {{customerName}} / {{lessorName}}\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}',requiredSigners:['CUSTOMER','OWNER','PLATFORM']});await publish(f.tx,f.change);
 assert.ok(f.quote.snapshot.document.content.startsWith('纸质补充 原签约客户 / 原出租方\n'));assert.match(f.quote.snapshot.document.content,/未交付延期/);assert.equal(f.quote.snapshot.document.templateHash,hash(f.legal.content));
});
test('a borrowed active quote cannot publish a paper amendment for another change',async()=>{
 const f=offlineDelayFixture();f.quote.changeId='someone-else';await assert.rejects(publish(f.tx,f.change),code('QUOTE_MISMATCH'));assert.equal(f.writes.length,0);
});
