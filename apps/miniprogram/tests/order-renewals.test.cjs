const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renewal,summary,setup,confirmInput}=require('./fixtures/order-renewals.cjs');

test('electronic renewal accepts a three-month frozen quote and leads to electronic signing without paper',async()=>{
 const e=setup(),v=renewal();v.executionMode='ELECTRONIC';v.contract.executionMode='ELECTRONIC';v.quote.document.type='ELECTRONIC_V31_RENEWAL';v.quote.months=3;v.quote.periods=v.quote.periods.slice(0,3);v.quote.endDate='2097-04-01';v.quote.totalAmount=60000;e.set(v);
 const result=await e.api.getOrderRenewal(v.id);assert.equal(result.isOffline,false);assert.equal(result.isElectronic,true);assert.equal(result.quote.months,3);
 const receipt=await e.api.confirmOrderRenewal(v.id,confirmInput(v));assert.equal(receipt.status,'AWAITING_SIGNATURE');assert.equal((await e.api.getOrderRenewal(v.id)).isElectronic,true);
});
test('renewal list/detail use dedicated routes and frozen zero-valued terms without changing current order',async()=>{
 const e=setup(),list=await e.api.getOrderRenewals({page:1,pageSize:12}),v=await e.api.getOrderRenewal('renewal1');
 assert.equal(list.items[0].isRenewal,true);assert.equal(v.isRenewal,true);assert.equal(v.quote.periods[0].sequence,13);assert.equal(v.quote.usagePricing.baseAllowanceKm,0);assert.equal(v.quote.swapPolicy.includedCount,0);assert.equal(v.quote.lessor.name,'实际出租方');assert.match(v.quote.periodText,/末日不含/);assert.equal(v.canSign,false);assert.equal(v.canSync,false);assert.equal(e.calls.some(c=>c.method==='POST'),false);
});
test('unknown source, malformed money, calendar, period, policy, lessor and paper cannot authorize confirmation',async()=>{
 const e=setup();for(const mutate of [v=>v.kind='DELIVERY_DELAY',v=>v.status='MAGIC',v=>v.quote.monthlyFeeAmount=-1,v=>v.quote.totalAmount=240001,v=>v.quote.periods[1].sequence=13,v=>v.quote.periods[1].startDate='2097-02-30',v=>v.quote.usagePricing.policyVersion='FUTURE',v=>v.quote.swapPolicy.policyVersion='ANNUAL',v=>v.quote.lessor.subjectType='COMPANY',v=>v.quote.sharingNotice.contentHash='0'.repeat(64),v=>v.contract.delayQuoteId='foreign',v=>v.quote.document.type='electronic',v=>v.quote.document.content='{{unknown}}']){const v=renewal();mutate(v);e.set(v);await assert.rejects(e.api.getOrderRenewal('renewal1'),{code:'RESPONSE'});}
 assert.equal(e.calls.some(c=>c.method==='POST'),false);
});
test('confirmation binds every accepted frozen identity and requires separate notice acceptance',async()=>{
 const e=setup(),input=confirmInput(renewal());await assert.rejects(e.api.confirmOrderRenewal('renewal1',{...input,sharingAccepted:false}),{code:'VALIDATION'});
 for(const field of ['quoteId','quoteRevision','commercialHash','bodyHash','lessorHash','noticeHash']){await assert.rejects(e.api.confirmOrderRenewal('renewal1',{...input,[field]:typeof input[field]==='number'?2:'0'.repeat(64)}));}
 assert.equal(e.calls.some(c=>c.method==='POST'),false);const receipt=await e.api.confirmOrderRenewal('renewal1',input);assert.equal(receipt.status,'AWAITING_ARCHIVE');assert.equal('quote' in receipt,false);
 const post=e.calls.find(c=>c.method==='POST');assert.deepEqual(Object.keys(post.data).sort(),['revision','quoteId','quoteRevision','commercialHash','bodyHash','lessorHash','noticeHash','sharingAccepted','idempotencyKey'].sort());assert.equal(post.data.read,undefined);assert.ok(post.data.idempotencyKey);
});
test('unknown submission preserves exact body/key and cannot change reason/action until resolved',async()=>{
 const e=setup(),input=confirmInput(renewal());e.fail(503);await assert.rejects(e.api.confirmOrderRenewal('renewal1',input));await assert.rejects(e.api.rejectOrderRenewal('renewal1',{revision:3,reason:'希望调整期限'}),{code:'RENEWAL_UNKNOWN'});
 e.fail(null);await e.api.confirmOrderRenewal('renewal1',input);const posts=e.calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);assert.deepEqual(posts[0].data,posts[1].data);
});
test('published expiry blocks confirmation, while confirmed historical text remains readable',async()=>{
 const e=setup(),v=renewal();v.quote.expiresAt='2020-01-01T00:00:00Z';e.set(v);assert.equal((await e.api.getOrderRenewal('renewal1')).canConfirm,false);await assert.rejects(e.api.confirmOrderRenewal('renewal1',confirmInput(v)),{code:'RENEWAL_UNAVAILABLE'});
 e.set({...v,status:'AWAITING_ARCHIVE',canConfirm:false,quote:{...v.quote,status:'CONFIRMED'}});assert.ok((await e.api.getOrderRenewal('renewal1')).quote.document);
});
test('unpublished draft and future scheduled stage stay separate from an activated rental',async()=>{
 const e=setup();e.set(renewal({status:'DRAFT',revision:0,quote:null,contract:null,canConfirm:false,canReject:false}));const draft=await e.api.getOrderRenewal('renewal1');assert.equal(draft.quote,null);assert.equal(draft.canConfirm,false);
 const v=renewal({status:'SCHEDULED',canConfirm:false,canReject:false,stage:{id:'stage1',status:'SCHEDULED',revision:2,startDate:'2097-01-01',endDate:'2098-01-01',firstPeriodSequence:13,lastPeriodSequence:24,scheduledAt:'2096-10-31T00:00:00Z',activatedAt:null}});v.quote.status='CONFIRMED';e.set(v);const scheduled=await e.api.getOrderRenewal('renewal1');assert.equal(scheduled.stage.status,'SCHEDULED');assert.match(scheduled.statusText,/待生效/);assert.equal(scheduled.isEffective,false);
});
test('session changes discard late private reads and old-session commands',async()=>{
 const e=setup();e.hold(true);const pending=e.api.getOrderRenewal('renewal1');e.switchSession();e.deferred[0].success({statusCode:200,data:renewal()});await assert.rejects(pending,{code:'SESSION_CHANGED'});
});
test('renewal pagination validates totals and keeps the selected page instead of truncating at first dozen',async()=>{
 const e=setup();e.rows(Array.from({length:14},(_,i)=>summary(renewal({id:'r'+i}))));const result=await e.api.getOrderRenewals({page:2,pageSize:12});assert.equal(result.total,14);assert.equal(result.items.length,2);assert.equal(result.items[0].id,'r12');assert.equal(result.page,2);
 await assert.rejects(e.api.getOrderRenewals({page:0}),{code:'VALIDATION'});
});
