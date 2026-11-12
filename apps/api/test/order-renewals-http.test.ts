import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokenHash} from '../src/auth/auth.service';
import {renewalPreviewInput} from './order-renewals-fixture';
import {withRenewalHttp,expectHttp,createThroughHttp,publishThroughHttp} from './order-renewals-http-fixture';

test('real HTTP context/goods/preview are read-only and fixed ADMIN/OPERATIONS/FINANCE can read while SUPPORT/FIELD cannot',async()=>withRenewalHttp(async(f,call)=>{
 const before=f.snapshot(),raw=renewalPreviewInput(f);
 for(const actor of ['admin','ops','finance'] as const){
  const context=await call(actor,'/admin/orders/order/renewal-context');assert.equal(expectHttp(context,200).eligible,true);assert.equal(context.headers.get('cache-control'),'private, no-store');
  const goods=expectHttp(await call(actor,'/admin/orders/order/renewal-goods?page=1&pageSize=1'),200);assert.equal(goods.items[0].listingId,f.plan.listing.id);assert.equal(goods.pageSize,1);
  const preview=expectHttp(await call(actor,'/admin/orders/order/renewals/preview',raw),201);assert.equal(preview.totalAmount,240000);assert.equal(preview.periods[0].sequence,13);
 }
 for(const actor of ['support','field'] as const)for(const path of ['/admin/orders/order/renewal-context','/admin/orders/order/renewal-goods','/admin/order-renewals'])expectHttp(await call(actor,path),403,'FORBIDDEN');
 for(const actor of ['support','field'] as const)expectHttp(await call(actor,'/admin/orders/order/renewals/preview',raw),403,'FORBIDDEN');
 const preview=expectHttp(await call('ops','/admin/orders/order/renewals/preview',raw),201);expectHttp(await call('finance','/admin/orders/order/renewals',{...raw,previewHash:preview.previewHash,idempotencyKey:'finance-cannot-create'}),403,'FORBIDDEN');
 assert.equal(f.snapshot(),before);
}));

test('real Access rejects absent session, CSRF and Origin before preview/create; current session and in-transaction staff versions are both checked',async()=>withRenewalHttp(async(f,call)=>{
 const raw=renewalPreviewInput(f),before=f.snapshot();expectHttp(await call('anonymous','/admin/orders/order/renewal-context'),401,'UNAUTHENTICATED');
 expectHttp(await call('ops','/admin/orders/order/renewals/preview',raw,{csrf:null}),403,'CSRF_DENIED');expectHttp(await call('ops','/admin/orders/order/renewals/preview',raw,{origin:'http://untrusted.invalid'}),403,'ORIGIN_DENIED');
 f.staff.get('ops').authVersion=2;expectHttp(await call('ops','/admin/orders/order/renewal-context'),401,'SESSION_EXPIRED');f.staff.get('ops').authVersion=1;
 f.afterAuthentication(()=>{f.staff.get('ops').authVersion=2;});expectHttp(await call('ops','/admin/orders/order/renewal-context'),403,'STAFF_SESSION_CHANGED');f.staff.get('ops').authVersion=1;
 f.sessions.get(tokenHash('renewal-http-ops')).expiresAt=new Date(0);expectHttp(await call('ops','/admin/order-renewals'),401,'SESSION_EXPIRED');assert.equal(f.snapshot(),before);
}));

test('create receipt has a GET workspace, changeId reaches all three recovery routes, query/body validation is strict and every read is zero-write',async()=>withRenewalHttp(async(f,call)=>{
 const {receipt}=await createThroughHttp(f,call);assert.deepEqual(Object.keys(receipt).sort(),['id','quoteId','revision','status']);assert.equal(receipt.status,'DRAFT');
 const before=f.snapshot(),view=expectHttp(await call('ops','/admin/order-renewals/'+receipt.id),200);assert.equal(view.id,receipt.id);assert.equal(view.revision,receipt.revision);assert.equal(view.canQuote,true);
 const customerDraft=expectHttp(await call('customer','/customer/order-renewals/'+receipt.id),200);assert.equal(customerDraft.quote,null);assert.equal(customerDraft.canQuote,false);assert.equal(customerDraft.canReview,false);
 assert.equal(expectHttp(await call('ops','/admin/orders/order/renewal-context'),200).eligible,false);
 const context=expectHttp(await call('ops','/admin/orders/order/renewal-context?changeId='+receipt.id),200);assert.equal(context.changeId,receipt.id);assert.equal(context.eligible,true);assert.equal(context.canCreate,false);
 assert.equal(expectHttp(await call('ops','/admin/orders/order/renewal-goods?changeId='+receipt.id+'&page=1&pageSize=1'),200).items.length,1);
 const raw=renewalPreviewInput(f);assert.equal(expectHttp(await call('ops','/admin/orders/order/renewals/preview?changeId='+receipt.id,raw),201).monthlyFeeAmount,20000);
 for(const tail of ['renewal-context','renewal-goods','renewals/preview']){const body=tail.endsWith('preview')?raw:undefined;expectHttp(await call('ops','/admin/orders/order/'+tail+'?changeId=foreign-change',body),404,'NOT_FOUND');expectHttp(await call('ops','/admin/orders/order/'+tail+'?changeId=%20bad',body),400,'VALIDATION');expectHttp(await call('ops','/admin/orders/order/'+tail+'?changeId='+receipt.id+'&changeId=other',body),400,'VALIDATION');}
 expectHttp(await call('ops','/admin/orders/order/renewal-goods?changeId='+receipt.id+'&unexpected=1'),400,'VALIDATION');expectHttp(await call('ops','/admin/orders/order/renewals/preview?changeId='+receipt.id,{...raw,monthlyFeeAmount:1}),400,'VALIDATION');
 const list=expectHttp(await call('ops','/admin/order-renewals?page=1&pageSize=1&keyword='+receipt.id+'&status=DRAFT'),200);assert.equal(list.total,1);assert.equal(list.items[0].id,receipt.id);assert.equal(list.pageSize,1);assert.equal(list.items[0].quoteSummary,null);
 const next=expectHttp(await call('ops','/admin/order-renewals?page=2&pageSize=1'),200);assert.equal(next.items.length,0);assert.equal(next.total,1);expectHttp(await call('ops','/admin/order-renewals?page=0'),400,'VALIDATION');assert.equal(f.snapshot(),before);
}));

test('unknown delivery of a successful create replays only under current authority; altered body and revoked/changed sessions cannot reuse old keys',async()=>withRenewalHttp(async(f,call)=>{
 const {receipt,input}=await createThroughHttp(f,call),before=f.snapshot();assert.deepEqual(expectHttp(await call('ops','/admin/orders/order/renewals',input),201),receipt);assert.equal(f.snapshot(),before);
 expectHttp(await call('ops','/admin/orders/order/renewals',{...input,reason:'不同正文'}),409,'IDEMPOTENCY_CONFLICT');
 f.staff.get('ops').active=false;expectHttp(await call('ops','/admin/orders/order/renewals',input),401,'SESSION_EXPIRED');f.staff.get('ops').active=true;
 f.staff.get('ops').role='SUPPORT';expectHttp(await call('ops','/admin/orders/order/renewals',input),403,'FORBIDDEN');f.staff.get('ops').role='OPERATIONS';
 f.afterAuthentication(()=>{f.staff.get('ops').role='FINANCE';});expectHttp(await call('ops','/admin/orders/order/renewals',input),403,'STAFF_SESSION_CHANGED');assert.equal(f.snapshot(),before);
}));

test('published admin/customer HTTP views expose exact safe fields; foreign customer list/detail/confirm/reject never sees or mutates another renewal',async()=>withRenewalHttp(async(f,call)=>{
 const {receipt,view,confirm}=await publishThroughHttp(f,call),before=f.snapshot();assert.equal(view.canConfirm,true);assert.equal(view.quote.document.content,f.quotes[0].snapshot.document.content);assert.equal(view.contract.delayQuoteId,view.quote.id);assert.equal(view.contract.offlineArchiveId,null);
 for(const actor of ['admin','ops','finance'] as const){const result=expectHttp(await call(actor,'/admin/order-renewals/'+receipt.id),200);assert.equal(result.quote.monthlyFeeAmount,20000);assert.equal(result.quote.source,undefined);assert.equal(result.quote.renewalTerms,undefined);assert.equal(result.quote.revenueRuleSnapshot,undefined);assert.equal(result.quote.document.content===undefined,actor==='finance');assert.equal(result.canConfirm,false);}
 const list=expectHttp(await call('customer','/customer/order-renewals?page=1&pageSize=12'),200);assert.equal(list.items[0].id,receipt.id);assert.equal(list.items[0].quoteSummary.monthlyFeeAmount,20000);
 assert.deepEqual(expectHttp(await call('foreign','/customer/order-renewals'),200).items,[]);
 expectHttp(await call('foreign','/customer/order-renewals/'+receipt.id),404,'NOT_FOUND');expectHttp(await call('foreign',`/customer/order-renewals/${receipt.id}/confirm`,confirm),404,'NOT_FOUND');expectHttp(await call('foreign',`/customer/order-renewals/${receipt.id}/reject`,{revision:receipt.revision,idempotencyKey:'foreign-reject-key',reason:'外客户不应操作'}),404,'NOT_FOUND');
 for(const actor of ['support','field'] as const)expectHttp(await call(actor,'/admin/order-renewals/'+receipt.id),403,'FORBIDDEN');
 expectHttp(await call('finance',`/admin/order-renewals/${receipt.id}/confirm`,confirm),404,'NOT_FOUND');expectHttp(await call('finance',`/customer/order-renewals/${receipt.id}/confirm`,confirm),401,'UNAUTHENTICATED');assert.equal(f.snapshot(),before);
}));

test('customer confirm requires current consents and exact published facts then receipt GET stays AWAITING_ARCHIVE without money/rights effects',async()=>withRenewalHttp(async(f,call)=>{
 const {receipt,confirm}=await publishThroughHttp(f,call);f.tx.customerConsent.count=async()=>0;const before=f.snapshot();expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/confirm`,confirm),409,'CONSENT_REQUIRED');assert.equal(f.snapshot(),before);
 f.tx.customerConsent.count=async()=>1;expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/confirm`,{...confirm,bodyHash:'f'.repeat(64)}),409,'QUOTE_MISMATCH');
 const confirmed=expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/confirm`,confirm),201);assert.equal(confirmed.status,'AWAITING_ARCHIVE');assert.equal(confirmed.revision,receipt.revision+1);
 const after=f.snapshot();const detail=expectHttp(await call('customer','/customer/order-renewals/'+receipt.id),200);assert.equal(detail.status,'AWAITING_ARCHIVE');assert.equal(detail.quote.status,'CONFIRMED');assert.equal(detail.canConfirm,false);assert.equal(detail.canSign,false);assert.equal(detail.canSync,false);
 assert.deepEqual(expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/confirm`,confirm),201),confirmed);assert.equal(f.snapshot(),after);assert.equal(f.obligations.length,0);assert.equal(f.credits.length,0);assert.equal(f.terms.length,0);assert.equal(f.stages.length,1);
 f.customerSessions.get(tokenHash('renewal-http-customer')).expiresAt=new Date(0);expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/confirm`,confirm),401,'SESSION_EXPIRED');assert.equal(f.snapshot(),after);
}));

test('customer reject receipt GET is read-only and static finance/activation routes retain fixed role boundaries instead of generic dispatch',async()=>withRenewalHttp(async(f,call)=>{
 const {receipt}=await publishThroughHttp(f,call);const body={revision:receipt.revision,idempotencyKey:'http-reject-once',reason:'合成客户选择不续期'},rejected=expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/reject`,body),201);assert.equal(rejected.status,'REJECTED');
 const before=f.snapshot();assert.equal(expectHttp(await call('customer','/customer/order-renewals/'+receipt.id),200).canReject,false);assert.deepEqual(expectHttp(await call('customer',`/customer/order-renewals/${receipt.id}/reject`,body),201),rejected);
 const common={revision:rejected.revision,orderRevision:f.order.revision,accountRevision:f.account.revision,previewHash:'a'.repeat(64),idempotencyKey:'http-role-boundary'},schedule={...common,stageId:'stage',stageRevision:0},activate={...schedule,previousStageRevision:0,assignmentId:f.assignment.id};
 for(const [actor,path,payload]of [['finance','activate',activate],['ops','schedule',schedule],['ops','finance/prepare',common]] as const)expectHttp(await call(actor,`/admin/order-renewals/${receipt.id}/${path}`,payload),403,'FORBIDDEN');
 expectHttp(await call('finance',`/admin/order-renewals/${receipt.id}/activation-preview`),403,'FORBIDDEN');expectHttp(await call('ops',`/admin/order-renewals/${receipt.id}/finance-preview`),403,'FORBIDDEN');expectHttp(await call('ops',`/admin/order-renewals/${receipt.id}/schedule-preview`),403,'FORBIDDEN');assert.equal(f.snapshot(),before);
}));

test('actual finance-preview HTTP reads the archived source; prepare receipt is recoverable by GET without implicitly preparing twice',async()=>withRenewalHttp(async(f,call)=>{
 const id=f.change.id,before=f.snapshot(),preview=expectHttp(await call('finance',`/admin/order-renewals/${id}/finance-preview`),200);assert.equal(f.snapshot(),before);
 const input={revision:f.change.revision,orderRevision:f.order.revision,accountRevision:f.account.revision,previewHash:preview.previewHash,idempotencyKey:'http-prepare-once'};
 const receipt=expectHttp(await call('finance',`/admin/order-renewals/${id}/finance/prepare`,input),201);assert.equal(receipt.status,'PREPARED');assert.equal(receipt.changeId,id);
 const after=f.snapshot(),detail=expectHttp(await call('finance',`/admin/order-renewals/${id}`),200);assert.equal(detail.stage.id,receipt.stageId);assert.equal(detail.stage.revision,receipt.stageRevision);assert.equal(detail.canPrepareFinance,false);assert.equal(detail.canSchedule,true);
 assert.deepEqual(expectHttp(await call('finance',`/admin/order-renewals/${id}/finance/prepare`,input),201),receipt);assert.equal(f.snapshot(),after);assert.equal(f.order.effectiveTermsVersionId,null);
},true));
