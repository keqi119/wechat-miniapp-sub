import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalFixture,renewalOps,renewalFinance,renewalNow,renewalPreviewInput} from './order-renewals-fixture';
import {renewalFinanceFixture} from './order-renewals-finance-fixture';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {renewalContext,renewalGoods} from '../src/order-renewals/context';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
async function workspace(){const m:any=await import('../src/order-renewals/workspace').catch(()=>({}));assert.equal(typeof m.readRenewalWorkspace,'function','renewal workspace read API exists');assert.equal(typeof m.listRenewalWorkspaces,'function','renewal list read API exists');return m;}

test('own draft context/goods can recover after initial creation; other or non-draft changes cannot be excluded',async()=>{
 const f=renewalFixture(),s=new OrderRenewalsService(f.db as any,()=>renewalNow),raw=renewalPreviewInput(f),p=await s.preview(f.order.id,raw,renewalOps),created=await s.create(f.order.id,{...raw,previewHash:p.previewHash,idempotencyKey:'workspace-create'},renewalOps),count=f.writes.length;
 const result=await (renewalContext as any)(f.tx,f.order.id,renewalNow,created.id);assert.equal(result.eligible,true);assert.equal(result.changeId,created.id);assert.equal(result.orderRevision,f.order.revision);
 const goods=await (renewalGoods as any)(f.tx,f.order.id,{},renewalNow,created.id);assert.equal(goods.items.length,1);assert.equal(f.writes.length,count);
 await assert.rejects((renewalGoods as any)(f.tx,f.order.id,{},renewalNow,'foreign'),code('NOT_FOUND'));
 f.changes[0].status='AWAITING_ARCHIVE';await assert.rejects((renewalGoods as any)(f.tx,f.order.id,{},renewalNow,created.id),code('RENEWAL_REQUOTE_BLOCKED'));assert.equal(f.writes.length,count);
});
test('workspace permissions precede reads and customer ownership never reveals another renewal',async()=>{
 const m=await workspace(),f=await renewalFinanceFixture(),writes=f.writes.length;
 await assert.rejects(m.readRenewalWorkspace(f.tx,f.change.id,{customerId:'foreign'},renewalNow),code('NOT_FOUND'));
 f.staff.set('support',{id:'support',role:'SUPPORT',active:true,authVersion:1});await assert.rejects(m.readRenewalWorkspace(f.tx,f.change.id,{actor:{id:'support',role:'SUPPORT',authVersion:1}},renewalNow),code('FORBIDDEN'));
 f.staff.get('ops')!.authVersion++;await assert.rejects(m.readRenewalWorkspace(f.tx,f.change.id,{actor:renewalOps},renewalNow),code('STAFF_SESSION_CHANGED'));assert.equal(f.writes.length,writes);
});
test('customer and finance receive explicit safe summaries without internal frozen sources or finance contract text',async()=>{
 const m=await workspace(),f=await renewalFinanceFixture(),writes=f.writes.length;
 const customer=await m.readRenewalWorkspace(f.tx,f.change.id,{customerId:f.customer.id},renewalNow);assert.equal(customer.kind,'SUBSCRIPTION_EXTENSION');assert.equal(customer.quote.document.content,f.contract.body);assert.equal(customer.quote.monthlyFeeAmount,20000);assert.equal(customer.canPrepareFinance,false);assert.equal(customer.canConfirm,false);
 const finance=await m.readRenewalWorkspace(f.tx,f.change.id,{actor:renewalFinance},renewalNow);assert.equal(finance.canPrepareFinance,true);assert.equal(finance.quote.document.content,undefined);assert.equal(finance.contract.offlineArchiveId,f.archive.id);
 for(const value of [customer,finance]){assert.equal(value.quote.source,undefined);assert.equal(value.quote.input,undefined);assert.equal(value.quote.renewalTerms,undefined);assert.equal(value.quote.revenueRuleSnapshot,undefined);assert.equal(value.quote.usagePricing.sourceHash,undefined);}
 assert.equal(f.writes.length,writes);
});
test('invalid paper blocks preparation while preserving safe accepted quote history; corrupt quote hides its document',async()=>{
 const m=await workspace(),f=await renewalFinanceFixture();f.version.status='INVALIDATED';let view=await m.readRenewalWorkspace(f.tx,f.change.id,{actor:renewalFinance},renewalNow);assert.equal(view.canPrepareFinance,false);assert.ok(view.blockers.length);assert.equal(view.quote.monthlyFeeAmount,20000);
 f.quote.snapshot.product.monthlyFeeAmount++;view=await m.readRenewalWorkspace(f.tx,f.change.id,{customerId:f.customer.id},renewalNow);assert.equal(view.quote,null);assert.equal(view.canConfirm,false);assert.ok(view.blockers.length);
});
test('list scopes the database query to kind/customer and never exposes unpublished customer quotes',async()=>{
 const m=await workspace(),f=await renewalFinanceFixture(),queries:any[]=[];
 f.tx.orderChange.findMany=async(args:any)=>{queries.push(args);return[f.change];};f.tx.orderChange.count=async()=>1;
 f.quote.status='DRAFT';f.change.status='REVIEW_PENDING';const result=await m.listRenewalWorkspaces(f.tx,{page:1,pageSize:12},{customerId:f.customer.id},renewalNow);assert.equal(result.items[0].quoteSummary,null);assert.equal(result.total,1);assert.equal(queries[0].where.kind,'SUBSCRIPTION_EXTENSION');assert.equal(queries[0].where.customerId,f.customer.id);assert.equal(queries[0].take,12);
 await assert.rejects(m.listRenewalWorkspaces(f.tx,{page:0},{customerId:f.customer.id},renewalNow));
});
test('prepared/scheduled workspaces retain read-only stage facts and never offer early activation or customer staff actions',async()=>{
 const m=await workspace(),f=await renewalFinanceFixture(),preview=await f.service.financePreview(f.change.id,renewalFinance);await f.service.prepare(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:preview.previewHash,idempotencyKey:'workspace-prepare'},renewalFinance);
 let view=await m.readRenewalWorkspace(f.tx,f.change.id,{actor:renewalFinance},renewalNow);assert.equal(view.stage.status,'PREPARED');assert.equal(view.canPrepareFinance,false);assert.equal(view.canSchedule,true);assert.equal(view.canActivate,false);
 const first=f.bills.find(b=>b.serviceStageId===view.stage.id&&b.sequence===view.stage.firstPeriodSequence)!;f.pay(first);const schedule=await f.service.schedulePreview(f.change.id,renewalFinance);await f.service.schedule(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,stageId:view.stage.id,stageRevision:view.stage.revision,previewHash:schedule.previewHash,idempotencyKey:'workspace-schedule'},renewalFinance);
 const writes=f.writes.length;view=await m.readRenewalWorkspace(f.tx,f.change.id,{actor:renewalOps},renewalNow);assert.equal(view.stage.status,'SCHEDULED');assert.equal(view.canActivate,false);
 view=await m.readRenewalWorkspace(f.tx,f.change.id,{actor:renewalOps},new Date(view.stage.startDate+'T00:00:00+08:00'));assert.equal(view.canActivate,true);
 const customer=await m.readRenewalWorkspace(f.tx,f.change.id,{customerId:f.customer.id},renewalNow);assert.equal(customer.canSchedule,false);assert.equal(customer.canActivate,false);assert.equal(f.writes.length,writes);assert.equal(f.order.effectiveTermsVersionId,null);
});
