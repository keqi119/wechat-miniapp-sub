import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalFixture,renewalPreviewInput,renewalNow,renewalOps,renewalFinance} from './order-renewals-fixture';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {buildRenewalPreview,publicRenewalPreview} from '../src/order-renewals/context';
import {renewalSourceHash,renewalCommercialHash,assertRenewalFrozenQuote} from '../src/order-renewals/types';
import {hash} from '../src/common/data';

const malicious='取消扣除新增租期全部实收作为违约金，另收取消费5000元';
const code=(v:string)=>(e:any)=>e.getStatus?.()===409&&e.getResponse?.().error?.code===v;
async function quoted(){const f=renewalFixture(),service=new OrderRenewalsService(f.db as any,()=>renewalNow);const legal=f.tx.legalDocument.findFirst;f.tx.legalDocument.findFirst=async(args:any)=>{const d=await legal(args);return d&&args.where.type==='owner-data-sharing'?{...d,title:'本单出租方资料提供告知'}:d;};let input={...renewalPreviewInput(f),cancellationTerms:malicious},p=await service.preview(f.order.id,input,renewalOps);const created=await service.create(f.order.id,{...input,previewHash:p.previewHash,idempotencyKey:'fixed-policy-create'},renewalOps);input={...renewalPreviewInput(f),cancellationTerms:malicious};p=await service.preview(f.order.id,input,renewalOps,created.id);await service.act(created.id,'quotes',{...input,previewHash:p.previewHash,revision:created.revision,idempotencyKey:'fixed-policy-quote'},renewalOps);return{...f,service,change:f.changes[0],quote:f.quotes[0]};}
async function published(){const f=await quoted();await f.service.act(f.change.id,'review',{revision:f.change.revision,idempotencyKey:'fixed-policy-review',decision:'APPROVED',note:'独立核对真实新期条款'},renewalFinance);await f.service.act(f.change.id,'publish',{revision:f.change.revision,idempotencyKey:'fixed-policy-publish'},renewalOps);return{...f,contract:f.contracts.find(c=>c.delayQuoteId===f.quote.id)!};}
const acceptance=(f:any)=>({revision:f.change.revision,idempotencyKey:'fixed-policy-confirm',quoteId:f.quote.id,quoteRevision:f.quote.revision,commercialHash:f.quote.commercialHash,bodyHash:f.quote.snapshot.document.bodyHash,lessorHash:f.quote.snapshot.source.lessorHash,noticeHash:f.quote.snapshot.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingAccepted:true});
function assertFixed(text:any){assert.equal(typeof text,'string');for(const clause of ['上海','零点','双方','开始前','全额','原路','不收取消费','晚到','不生效','原押金','已激活','实际使用'])assert.ok(text.includes(clause),clause);assert.equal(text.includes(malicious),false);}

test('context and public preview expose the full server rule; request cancellation text cannot change new frozen source or hash',async()=>{
 const f=renewalFixture(),service=new OrderRenewalsService(f.db as any,()=>renewalNow),context=await service.context(f.order.id,renewalOps);assert.ok('cancellationTerms' in context);assertFixed(context.cancellationTerms);
 const a=await buildRenewalPreview(f.tx,f.order.id,{...renewalPreviewInput(f),cancellationTerms:malicious},renewalNow),b=await buildRenewalPreview(f.tx,f.order.id,{...renewalPreviewInput(f),cancellationTerms:'另一份任意取消安排'},renewalNow);
 assert.equal(a.value.input.cancellationTerms,context.cancellationTerms);assert.equal(a.previewHash,b.previewHash);assert.equal(renewalSourceHash(a.value),renewalSourceHash(b.value));assert.equal(publicRenewalPreview(a.value,a.previewHash).cancellationTerms,context.cancellationTerms);assert.equal(f.writes.length,0);
});

test('new real quote, published body and customer confirmation freeze the rule rather than malicious legacy input',async()=>{
 const f=await published(),s=f.quote.snapshot;assertFixed(s.input.cancellationTerms);assert.ok(f.contract.body.includes(s.input.cancellationTerms));assert.equal(f.contract.body.includes(malicious),false);const body=f.contract.body,bodyHash=s.document.bodyHash;
 await f.service.customerAct(f.change.id,'confirm',acceptance(f),f.customer.id);assert.equal(f.quote.status,'CONFIRMED');assert.equal(f.quote.snapshot.customerAcceptance.bodyHash,bodyHash);assert.equal(f.contract.body,body);assert.equal(f.quote.snapshot.input.cancellationTerms,s.input.cancellationTerms);
});

/** Represents a previously persisted, internally consistent quote, not a new permission to author this text. */
function historical(f:any){const s=f.quote.snapshot,old='旧版双方按原已签约定另行核算取消事项';if(s.document){s.document.content=s.document.content.replace(s.input.cancellationTerms,old);s.document.bodyHash=hash(s.document.content);f.contract.body=s.document.content;}s.input.cancellationTerms=old;s.sourceHash=renewalSourceHash(s);if(s.offlineSource){s.offlineSource.renewalSourceHash=s.sourceHash;f.quote.commercialHash=renewalCommercialHash(f.change,s,s.document.templateHash,f.contract.id,s.offlineSource);s.renewalTerms.commercialHash=f.quote.commercialHash;f.contract.documentHash=f.quote.commercialHash;}return old;}

test('legacy unconfirmed draft and published quotes require recheck and never silently rewrite their frozen text',async()=>{
 const draft=await quoted();historical(draft);const before=JSON.stringify(draft.quote);await assert.rejects(draft.service.act(draft.change.id,'review',{revision:draft.change.revision,idempotencyKey:'old-policy-review',decision:'APPROVED',note:'要求核对旧版本'},renewalFinance),code('RENEWAL_SOURCE_CHANGED'));assert.equal(JSON.stringify(draft.quote),before);
 const f=await published();historical(f);const frozen=JSON.stringify({quote:f.quote,contract:f.contract});await assert.rejects(f.service.customerAct(f.change.id,'confirm',acceptance(f),f.customer.id),code('RENEWAL_SOURCE_CHANGED'));assert.equal(JSON.stringify({quote:f.quote,contract:f.contract}),frozen);assert.equal(f.quote.status,'PUBLISHED');
});

test('already confirmed historical source and public projection keep their original text and hashes',async()=>{
 const f=await published();await f.service.customerAct(f.change.id,'confirm',acceptance(f),f.customer.id);const old=historical(f);f.quote.snapshot.customerAcceptance.bodyHash=f.quote.snapshot.document.bodyHash;const frozen=JSON.stringify({quote:f.quote,contract:f.contract}),writes=f.writes.length;
 f.tx.orderServiceStage.findFirst=async({where}:any)=>f.stages.find((s:any)=>Object.entries(where).every(([k,v])=>s[k]===v))??null;
 f.tx.delayQuote.findMany=async({where}:any)=>f.quotes.filter(q=>q.changeId===where.changeId).map(q=>({...q,contract:f.contracts.find(c=>c.delayQuoteId===q.id)}));
 assert.equal(assertRenewalFrozenQuote(f.change,f.quote),f.quote.snapshot);assert.equal(publicRenewalPreview(f.quote.snapshot,f.quote.snapshot.previewHash).cancellationTerms,old);const view=await f.service.detail(f.change.id,undefined,f.customer.id);assert.equal(view.quote?.cancellationTerms,old);assert.equal(view.quote?.document?.content,f.contract.body);assert.equal(JSON.stringify({quote:f.quote,contract:f.contract}),frozen);assert.equal(f.writes.length,writes);
});
