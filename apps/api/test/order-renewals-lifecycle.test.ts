import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalFixture,renewalPreviewInput,renewalNow,renewalOps,renewalFinance} from './order-renewals-fixture';
async function service(f:ReturnType<typeof renewalFixture>){const m:any=await import('../src/order-renewals/service').catch(()=>({}));assert.equal(typeof m.OrderRenewalsService,'function','independent renewal command service exists');return new m.OrderRenewalsService(f.db,()=>renewalNow);}
const code=(v:string)=>(e:any)=>e.getResponse?.().error?.code===v;
async function draft(f:ReturnType<typeof renewalFixture>){const s=await service(f),raw=renewalPreviewInput(f),p=await s.preview(f.order.id,raw,renewalOps),created=await s.create(f.order.id,{...raw,previewHash:p.previewHash,idempotencyKey:'renewal-create-once'},renewalOps);return{s,created};}
async function quoted(f:ReturnType<typeof renewalFixture>){const {s,created}=await draft(f),raw=renewalPreviewInput(f),p=await s.preview(f.order.id,raw,renewalOps,created.id);await s.act(created.id,'quotes',{...raw,previewHash:p.previewHash,revision:created.revision,idempotencyKey:'renewal-quote-once'},renewalOps);return{s,change:f.changes[0],q:f.quotes[0]};}
async function published(f:ReturnType<typeof renewalFixture>){const {s,change,q}=await quoted(f);await s.act(change.id,'review',{revision:change.revision,idempotencyKey:'renewal-review-once',decision:'APPROVED',note:'独立核对新商品与逐期金额'},renewalFinance);await s.act(change.id,'publish',{revision:change.revision,idempotencyKey:'renewal-publish-once'},renewalOps);return{s,change,q};}
function consent(change:any,q:any){return{revision:change.revision,idempotencyKey:'renewal-confirm-once',quoteId:q.id,quoteRevision:q.revision,commercialHash:q.commercialHash,bodyHash:q.snapshot.document.bodyHash,lessorHash:q.snapshot.source.lessorHash,noticeHash:q.snapshot.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingAccepted:true};}

test('new renewal changes and quotes never write money, rights or the current terms and require independent review',async()=>{
 const f=renewalFixture(),before=structuredClone({initial:f.initial,account:f.account,assignment:f.assignment,bills:f.bills}),{s,change,q}=await quoted(f);
 assert.equal(change.kind,'SUBSCRIPTION_EXTENSION');assert.equal(change.status,'REVIEW_PENDING');assert.equal(q.snapshot.renewalTerms.serviceStageId,'renewal:order:2');assert.equal(q.snapshot.monthlyFeeAmount,20000);assert.equal(f.obligations.length,0);assert.equal(f.refunds.length,0);assert.equal(f.terms.length,0);assert.equal(f.credits.length,0);assert.deepEqual({initial:f.initial,account:f.account,assignment:f.assignment,bills:f.bills},before);
 await assert.rejects(s.act(change.id,'review',{revision:change.revision,idempotencyKey:'self-review-denied',decision:'APPROVED',note:'本人复核'},renewalOps),code('FORBIDDEN'));
});
test('current staff and customer scope are rechecked before stable command replay with no extra order revision or audit',async()=>{
 const f=renewalFixture(),s=await service(f),raw=renewalPreviewInput(f),p=await s.preview(f.order.id,raw,renewalOps),input={...raw,previewHash:p.previewHash,idempotencyKey:'stable-create-key'};
 const created=await s.create(f.order.id,input,renewalOps),revision=f.order.revision,count=f.audits.length;assert.deepEqual(await s.create(f.order.id,input,renewalOps),created);assert.equal(f.order.revision,revision);assert.equal(f.audits.length,count);assert.equal(f.changes.length,1);
 await assert.rejects(s.create(f.order.id,{...input,reason:'同键变正文'},renewalOps),code('IDEMPOTENCY_CONFLICT'));f.staff.get('ops')!.authVersion=2;await assert.rejects(s.create(f.order.id,input,renewalOps),code('STAFF_SESSION_CHANGED'));
 await assert.rejects(s.detail(created.id,undefined,'foreign'),code('NOT_FOUND'));
});
test('publication freezes exact shared paper text and customer acceptance waits for archive without providers',async()=>{
 const f=renewalFixture(),{s,change,q}=await published(f),contract=f.contracts.find(c=>c.delayQuoteId===q.id)!;
 assert.equal(contract.executionMode,'OFFLINE');assert.equal(contract.status,'DRAFT');assert.equal(contract.providerTaskId,undefined);assert.equal(q.snapshot.document.content,contract.body);for(const text of ['原押金','原免费','已付费','2400','321.00','同一','显式','2027-10-01',q.snapshot.input.reason])assert(contract.body.includes(text),text);assert.equal(q.snapshot.renewalTerms.commercialHash,q.commercialHash);
 const input=consent(change,q);await assert.rejects(s.customerAct(change.id,'confirm',{...input,bodyHash:'f'.repeat(64)},f.customer.id),code('QUOTE_MISMATCH'));
 await s.customerAct(change.id,'confirm',input,f.customer.id);assert.equal(change.status,'AWAITING_ARCHIVE');assert.equal(q.status,'CONFIRMED');const revision=f.order.revision;await s.customerAct(change.id,'confirm',input,f.customer.id);assert.equal(f.order.revision,revision);assert.equal(f.terms.length,0);assert.equal(f.stages.length,1);assert.equal(f.obligations.length,0);
});
test('changed source before customer acceptance is rejected and an expired original term cannot be backdated',async()=>{
 const f=renewalFixture(),{s,change,q}=await published(f);f.plan.listing.revision++;await assert.rejects(s.customerAct(change.id,'confirm',consent(change,q),f.customer.id),code('GOODS_SOURCE_CHANGED'));assert.equal(q.status,'PUBLISHED');
 const g=renewalFixture(),p=await published(g);p.s.clock=()=>new Date('2027-09-30T16:00:00Z');await assert.rejects(p.s.customerAct(p.change.id,'confirm',consent(p.change,p.q),g.customer.id));assert.equal(p.q.status,'PUBLISHED');
});
test('customer rejection closes only the unconfirmed renewal and missing common template groups never publish',async()=>{
 const f=renewalFixture(),{s,change,q}=await published(f);await s.customerAct(change.id,'reject',{revision:change.revision,idempotencyKey:'renewal-reject-key',reason:'本次不续期'},f.customer.id);assert.equal(change.status,'REJECTED');assert.equal(q.status,'REJECTED');assert.equal(f.terms.length,0);
 const g=renewalFixture(),v=await quoted(g);await v.s.act(v.change.id,'review',{revision:v.change.revision,idempotencyKey:'review-for-bad-template',decision:'APPROVED',note:'核对'},renewalFinance);g.legal.content='{{changeFacts}} {{periodSchedule}}';await assert.rejects(v.s.act(v.change.id,'publish',{revision:v.change.revision,idempotencyKey:'bad-template-key'},renewalOps),code('LEGAL_PLACEHOLDERS'));assert.equal(v.q.status,'REVIEWED');
});
test('preview proposes INITIAL without writing, while create materializes its verified original source exactly once',async()=>{
 const f=renewalFixture();f.stages.length=0;const s=await service(f),raw=renewalPreviewInput(f),before=structuredClone({initial:f.initial,account:f.account,assignment:f.assignment,bills:f.bills});
 const p=await s.preview(f.order.id,raw,renewalOps);assert.equal(f.stages.length,0);assert.equal(f.writes.length,0);const input={...raw,previewHash:p.previewHash,idempotencyKey:'initial-and-renewal-once'};
 const result=await s.create(f.order.id,input,renewalOps);assert.equal(f.stages.length,1);assert.equal(f.stages[0].id,'initial:order');assert.equal(f.stages[0].kind,'INITIAL');assert.equal(f.stages[0].assignmentId,f.assignment.id);assert.equal(f.changes[0].id,result.id);assert.equal(f.stages[0].status,'ACTIVE');assert.deepEqual({initial:f.initial,account:f.account,assignment:f.assignment,bills:f.bills},before);
 const revision=f.order.revision;await s.create(f.order.id,input,renewalOps);assert.equal(f.stages.length,1);assert.equal(f.changes.length,1);assert.equal(f.order.revision,revision);
});
test('source changes between preview and create leave no INITIAL or change behind',async()=>{
 const f=renewalFixture();f.stages.length=0;const s=await service(f),raw=renewalPreviewInput(f),p=await s.preview(f.order.id,raw,renewalOps);f.owner.revision++;
 await assert.rejects(s.create(f.order.id,{...raw,previewHash:p.previewHash,idempotencyKey:'initial-stale-preview'},renewalOps),code('PREVIEW_CHANGED'));assert.equal(f.stages.length,0);assert.equal(f.changes.length,0);assert.equal(f.writes.length,0);
});
test('published commercial source is reproducible without borrowing the old amendment identity',async()=>{
 const f=renewalFixture(),{s,change,q}=await published(f),m:any=await import('../src/order-renewals/types');assert.equal(typeof m.renewalCommercialHash,'function');
 const contract=f.contracts.find(c=>c.delayQuoteId===q.id)!;assert.equal(m.renewalCommercialHash(change,q.snapshot,q.snapshot.document.templateHash,contract.id,q.snapshot.offlineSource),q.commercialHash);
 await s.customerAct(change.id,'confirm',consent(change,q),f.customer.id);assert.equal(m.renewalCommercialHash(change,q.snapshot,q.snapshot.document.templateHash,contract.id,q.snapshot.offlineSource),q.commercialHash);
});
test('frozen renewal evidence validates historical quote ownership without pretending it is current',async()=>{
 const f=renewalFixture(),{change,q}=await published(f),m:any=await import('../src/order-renewals/types');assert.equal(typeof m.assertRenewalFrozenQuote,'function');
 change.activeQuoteId='later-quote';assert.equal(m.assertRenewalFrozenQuote(change,q),q.snapshot);assert.throws(()=>m.assertRenewalQuote(change,q),code('RENEWAL_QUOTE_SOURCE'));
 for(const patch of [{changeId:'another-change'},{snapshot:{...q.snapshot,source:{...q.snapshot.source,customerId:'another-customer'}}},{snapshot:{...q.snapshot,source:{...q.snapshot.source,originalArchiveVersionId:'another-original'}}},{snapshot:{...q.snapshot,renewalTerms:null}},{snapshot:{...q.snapshot,input:null}}])assert.throws(()=>m.assertRenewalFrozenQuote(change,{...q,...patch}),code('RENEWAL_QUOTE_SOURCE'));
 assert.equal(f.changes[0].activeQuoteId,'later-quote');
});
test('materializing the INITIAL candidate permits a fresh quote and an expired published quote returns a conflict',async()=>{
 const f=renewalFixture();f.stages.length=0;const {s,change,q}=await quoted(f);assert.equal(f.stages.length,1);assert.equal(q.snapshot.source.initialCandidate,false);assert.equal(q.snapshot.source.currentStageId,'initial:order');
 await s.act(change.id,'review',{revision:change.revision,idempotencyKey:'review-initial-quote',decision:'APPROVED',note:'核对初始化后的真实来源'},renewalFinance);await s.act(change.id,'publish',{revision:change.revision,idempotencyKey:'publish-initial-quote'},renewalOps);
 s.clock=()=>new Date(q.snapshot.expiresAt);await assert.rejects(s.customerAct(change.id,'confirm',consent(change,q),f.customer.id),(e:any)=>code('QUOTE_EXPIRED')(e)&&e.getStatus()===409);assert.equal(q.status,'PUBLISHED');
});
test('even an administrator cannot approve their own quote and a retired published template cannot silently change customer text',async()=>{
 const f=renewalFixture(),{s,change,q}=await quoted(f),admin={...renewalOps,role:'ADMIN'};f.staff.set('ops',{...admin,active:true});
 await assert.rejects(s.act(change.id,'review',{revision:change.revision,idempotencyKey:'admin-self-review-no',decision:'APPROVED',note:'同人不得复核'},admin),code('TWO_PERSON_REQUIRED'));assert.equal(q.status,'DRAFT');
 const g=renewalFixture(),p=await published(g),body=p.q.snapshot.document.content;g.legal.content+=' 后来新内容';await assert.rejects(p.s.customerAct(p.change.id,'confirm',consent(p.change,p.q),g.customer.id),code('DOCUMENT_MISMATCH'));assert.equal(p.q.status,'PUBLISHED');assert.equal(p.q.snapshot.document.content,body);
});
