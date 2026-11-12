import test from 'node:test';
import assert from 'node:assert/strict';
import {agreementFixture} from './offline-change-agreement-fixture';
import {readContractReady} from '../src/offline-documents/readiness';
import {readChangeAgreementReady} from '../src/order-changes/agreement-readiness';
import {OfflineWorkspaceService} from '../src/offline-documents/workspace.service';
import {BillingService} from '../src/billing/billing';

function fixture(previous=false){
 const f=agreementFixture(),tx=f.tx;Object.assign(f.initial.lessorSnapshot,{mode:'SIMPLE_AGREEMENT'});
 if(previous)f.addChange(true);const c=f.addChange();Object.assign(f.order,{status:'AWAITING_PAYMENT',revision:1});c.change.status='AWAITING_FINANCE';c.quote.financePreparedAt=new Date();c.quote.approvedArchiveVersionId=c.version.id;
 const bill:any={id:'adjustment',orderId:f.order.id,customerId:f.order.customerId,type:'DELAY_ADJUSTMENT',status:'PENDING',amount:10000,paidAmount:0,dueDate:new Date('2026-11-01')};f.order.bills=[bill];f.order.handovers=[];
 const money:any={id:'pending-payment',billId:bill.id,bill,customerId:f.order.customerId,status:'PENDING',amount:bill.amount,createdAt:new Date(),updatedAt:new Date(),reconciliationRequired:false};const calls={created:0,gateway:0,allocated:0,updates:0};
 const active=()=>f.changes.find(x=>!['APPLIED','CANCELLED','REJECTED'].includes(x.status));
 tx.orderChange.findFirst=async()=>active()??null;tx.orderChange.count=async()=>active()?1:0;
 tx.delayQuote.findUniqueOrThrow=async({where}:any)=>f.quotes.find(q=>q.id===where.id);
 tx.documentArchive.findFirst=async()=>f.rental;tx.documentArchive.findMany=async()=>f.archives.map(a=>({...a,quote:a.quoteId?{id:a.quoteId,commercialHash:f.quotes.find(q=>q.id===a.quoteId)?.commercialHash,change:{orderId:f.order.id}}:null}));
 tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>t.id===where.id)??null;
 tx.archiveFeedback={count:async()=>0};tx.order.findUniqueOrThrow=async()=>f.order;tx.order.findFirst=async()=>f.order;
 tx.order.update=async()=>{calls.updates++;return f.order;};tx.order.updateMany=async()=>{calls.updates++;return{count:1};};tx.$queryRaw=async()=>[];
 tx.bill={findFirst:async()=>bill,findUniqueOrThrow:async()=>bill,findMany:async()=>[bill],update:async({data}:any)=>Object.assign(bill,data)};
 const created:any[]=[];
 tx.payment={findUnique:async({where}:any)=>where.id===money.id?money:created.find(p=>p.id===where.id)??null,findFirst:async()=>null,findUniqueOrThrow:async({where}:any)=>created.find(p=>p.id===where.id),create:async({data}:any)=>{calls.created++;const p={id:'new-payment',status:'CREATING',updatedAt:new Date(),...data};created.push(p);return p;},update:async({where,data}:any)=>Object.assign(where.id===money.id?money:created.find(p=>p.id===where.id),data),updateMany:async({where,data}:any)=>{const p=created.find(p=>p.id===where.id);if(p)Object.assign(p,data);return{count:p?1:0};}};
 tx.vehicleReceiptEvent={findFirst:async()=>null,findMany:async()=>[]};tx.usageAccount={findUnique:async()=>null};
 tx.serviceObligation={count:async()=>1,findFirst:async()=>({id:'obligation',orderId:f.order.id,quoteId:c.quote.id,chargeAmount:bill.amount})};
 tx.paymentAllocation={upsert:async()=>{calls.allocated++;return{};}};tx.notification={create:async()=>({})};tx.auditLog={create:async()=>({}),findMany:async()=>[]};
 const db:any={...tx,serial:async(fn:any)=>fn(tx)},gateway:any={create:async()=>{calls.gateway++;return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic'};}};
 return{...f,c,bill,money,calls,db,billing:new BillingService(db,gateway,()=>new Date()),invalidate:()=>{c.version.status='INVALIDATED';c.version.invalidatedAt=new Date();}};
}
const errorCode=(value:string)=>(error:any)=>error?.getResponse?.().error?.code===value;
test('first or later active pinned amendment invalidation blocks payment before apply',async()=>{
 for(const previous of [false,true]){const f=fixture(previous);f.invalidate();assert.equal((await readChangeAgreementReady(f.tx,f.c.change.id)).ready,false);const gate=await readContractReady(f.tx,f.order.id,'PAYMENT');assert.equal(gate.ready,false);assert.ok(gate.blockers.includes('AGREEMENT_ARCHIVE_REQUIRED'));}
});
test('valid pinned agreement remains payable; missing pin or changed active quote is not silently accepted',async()=>{
 const ok=fixture();assert.equal((await readContractReady(ok.tx,ok.order.id,'PAYMENT')).ready,true);
 for(const mutation of [(f:any)=>f.c.quote.approvedArchiveVersionId=null,(f:any)=>f.c.quote.approvedArchiveVersionId='other-version',(f:any)=>f.c.quote.changeId='other-change']){const f=fixture();mutation(f);assert.equal((await readContractReady(f.tx,f.order.id,'PAYMENT')).ready,false);}
});
test('unprepared swap quote does not block independent credit pre-purchase; terminal history is excluded',async()=>{
 const f=fixture();f.c.change.kind='VEHICLE_CHANGE';f.c.change.status='DRAFT';f.c.quote.status='DRAFT';f.c.quote.financePreparedAt=null;f.c.quote.approvedArchiveVersionId=null;f.invalidate();assert.equal((await readContractReady(f.tx,f.order.id,'PAYMENT')).ready,true);
 f.c.change.status='CANCELLED';f.c.quote.financePreparedAt=new Date();assert.equal((await readContractReady(f.tx,f.order.id,'PAYMENT')).ready,true);
});
test('active quote id with a missing quote fails closed before treating it as an unprepared draft',async()=>{
 const f=fixture();f.c.change.activeQuoteId='missing-quote';const gate=await readContractReady(f.tx,f.order.id,'PAYMENT');assert.equal(gate.ready,false);assert.ok(gate.blockers.includes('AGREEMENT_QUOTE_NOT_CONFIRMED'));
});
test('an unprepared quote belonging to another change cannot pass the draft exception',async()=>{
 const f=fixture();f.c.change.kind='VEHICLE_CHANGE';f.c.change.status='DRAFT';f.c.quote.status='DRAFT';f.c.quote.financePreparedAt=null;f.c.quote.approvedArchiveVersionId=null;f.c.quote.changeId='another-change';
 const gate=await readContractReady(f.tx,f.order.id,'PAYMENT');assert.equal(gate.ready,false);assert.ok(gate.blockers.includes('AGREEMENT_QUOTE_NOT_CONFIRMED'));
});
test('real Billing.pay refuses invalid pinned paper before creating a payment or provider request',async()=>{
 const f=fixture();f.invalidate();await assert.rejects(f.billing.pay({id:f.order.customerId,openId:'synthetic-open-id'},f.bill.id,'new-payment-key'),errorCode('AGREEMENT_ARCHIVE_REQUIRED'));assert.equal(f.calls.created,0);assert.equal(f.calls.gateway,0);
});
test('real Billing.pay still reaches its synthetic provider when the pinned paper is valid',async()=>{
 const f=fixture();const result=await f.billing.pay({id:f.order.customerId,openId:'synthetic-open-id'},f.bill.id,'valid-payment-key');assert.equal(result.paymentId,'new-payment');assert.equal(f.calls.created,1);assert.equal(f.calls.gateway,1);
});
test('verified late arrival after invalidation is saved SUCCEEDED and flagged for reconciliation without allocation',async()=>{
 const f=fixture();f.invalidate();const result=await f.billing.settle(f.money.id,{status:'SUCCEEDED',amount:10000,transactionId:'synthetic-trusted-arrival'});
 assert.equal(result.status,'SUCCEEDED');assert.equal(result.providerTransactionId,'synthetic-trusted-arrival');assert.equal(result.reconciliationRequired,true);assert.equal(result.reconciliationReason,'AGREEMENT_ARCHIVE_REQUIRED');assert.equal(f.bill.status,'PAID');assert.equal(f.bill.paidAmount,10000);assert.equal(f.calls.allocated,0);
 await f.billing.settle(f.money.id,{status:'SUCCEEDED',amount:10000,transactionId:'synthetic-trusted-arrival'});assert.equal(f.calls.allocated,0);assert.equal(result.reconciliationRequired,true);
});
test('customer workspace loads the same payment readiness without writes or private snapshots in response',async()=>{
 const f=fixture();f.invalidate();const before=JSON.stringify({order:f.order,changes:f.changes});const result=await new OfflineWorkspaceService(f.db).order(f.order.id,{id:f.order.customerId,role:'CUSTOMER'});
 assert.equal(result.capabilities.canPay,false);assert.ok(result.blockers.includes('AGREEMENT_ARCHIVE_REQUIRED'));assert.equal(result.billing[0].amount,10000);assert.equal(f.calls.updates,0);assert.equal(JSON.stringify(result).includes('scopeSnapshot'),false);assert.equal(JSON.stringify(result).includes('partiesSnapshot'),false);
 // Projection may attach transient computed fields; it cannot mutate persisted business fields.
 assert.equal(f.c.change.status,'AWAITING_FINANCE');assert.equal(f.order.effectiveTermsVersionId,null);assert.ok(before.includes('AWAITING_FINANCE'));
});
