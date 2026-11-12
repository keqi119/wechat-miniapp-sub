import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swapQuote} from '../src/vehicle-changes/quotes';
import {OrderChangesService} from '../src/order-changes/service';
import {buildOfflineSwapQuoteSource} from '../src/vehicle-changes/offline-quote-preview';
import {reserveCredit} from '../src/vehicle-changes/credits';
import {grantSwapCredit} from '../src/swap-purchases/ledger';
import {offlineSwapReservationFixture,swapV2Input,swapOps} from './offline-swap-quote-reservation-fixture';
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;

test('real read preview writes no rights; successful v2 quote lazily grants one FREE and reserves it without consumption',async()=>{
 const f=await offlineSwapReservationFixture(2147483647),input=swapV2Input(f),before=f.store.writes();await buildOfflineSwapQuoteSource(f.tx,f.change,input,swapOps,new Date('2026-10-31'));
 assert.equal(f.store.writes(),before);assert.equal(f.store.credits.length,0);assert.equal(f.holds.length,0);await swapQuote(f.tx,f.change,input,swapOps);
 assert.equal(f.store.credits.length,1);assert.equal(f.store.credits[0].termSequence,1);assert.equal(f.store.reservations.filter(r=>r.status==='RESERVED').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='CONSUME').length,0);
});
test('zero gifts quote reserves the real paid source and a new v2 reprice keeps one reservation instead of refusing its own credit',async()=>{
 const f=await offlineSwapReservationFixture(0,true),input=swapV2Input(f);await swapQuote(f.tx,f.change,input,swapOps);const first=f.quotes[0];
 assert.equal(f.store.reservations.length,1);assert.equal(f.store.reservations[0].creditId,f.store.credits[0].id);assert.equal(f.store.credits[0].source,'PAID');assert.equal(f.store.purchases[0].amount,50000);
 await swapQuote(f.tx,f.change,{...input,idempotencyKey:'new-quote-key',reason:'重新核对同一真实安排'},swapOps);
 assert.equal(first.status,'SUPERSEDED');assert.equal(f.quotes.length,2);assert.equal(f.store.reservations.filter(r=>r.status==='RESERVED').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='RELEASE').length,0);assert.equal(f.store.ledger.filter(l=>l.type==='CONSUME').length,0);
});
test('actual outer command replay does not add grant or reserve and still rejects revoked staff before replay',async()=>{
 const f=await offlineSwapReservationFixture(),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31')),input=swapV2Input(f);await service.act(f.change.id,'quotes',input,swapOps);const count=f.store.writes();
 await service.act(f.change.id,'quotes',input,swapOps);assert.equal(f.store.writes(),count);assert.equal(f.store.reservations.length,1);assert.equal(f.store.ledger.filter(l=>l.type==='RESERVE').length,1);
 f.tx.adminUser.findUnique=async()=>({...swapOps,active:false});await assert.rejects(service.act(f.change.id,'quotes',input,swapOps),code('STAFF_SESSION_CHANGED'));
});
test('actual cancel and customer rejection release quoted capacity and do not consume it',async()=>{
 for(const action of ['cancel','reject']){
  const f=await offlineSwapReservationFixture(),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));await service.act(f.change.id,'quotes',swapV2Input(f),swapOps);
  if(action==='reject'){f.change.status='AWAITING_CONFIRMATION';f.quotes[0].status='PUBLISHED';}
  await service.act(f.change.id,action,{revision:f.change.revision,idempotencyKey:'release-key',reason:'客户不继续此报价'},action==='cancel'?swapOps:undefined,action==='reject'?f.order.customerId:undefined);
  assert.equal(f.store.reservations.length,1);assert.equal(f.store.reservations[0].status,'RELEASED');assert.equal(f.store.ledger.filter(l=>l.type==='RELEASE').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='CONSUME').length,0);
 }
});
test('legacy or unknown reserved quote source remains explicitly blocked rather than being released by v2',async()=>{
 for(const shape of ['unknown','v1']){
  const f=await offlineSwapReservationFixture();await reserveCredit(f.tx,f.order,f.account,f.change.id,new Date('2026-11-01T10:00:00+08:00'));
  if(shape==='v1'){const active:any={id:'legacy-quote',changeId:f.change.id,status:'DRAFT',snapshot:{pricingVersion:1}};f.quotes.push(active);f.change.activeQuoteId=active.id;}
  const before=f.store.writes();await assert.rejects(swapQuote(f.tx,f.change,swapV2Input(f),swapOps),code('OFFLINE_SWAP_REPRICE_REQUIRED'));assert.equal(f.store.writes(),before);assert.equal(f.store.reservations[0].status,'RESERVED');assert.equal(f.holds.length,0);
 }
});
test('reprice beyond original PAID expiry rejects before writes and does not release the previous valid reservation',async()=>{
 const f=await offlineSwapReservationFixture(0,true);f.store.purchases[0].expiresAt=new Date('2026-11-02T00:00:00+08:00');await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);
 const before=f.store.writes(),quotes=f.quotes.length,hold=f.target.holdId;await assert.rejects(swapQuote(f.tx,f.change,{...swapV2Input(f),plannedReturnAt:'2026-11-03T09:00:00+08:00',plannedDeliveryAt:'2026-11-03T10:00:00+08:00'},swapOps),code('SWAP_CREDIT_UNAVAILABLE'));
 assert.equal(f.store.writes(),before);assert.equal(f.quotes.length,quotes);assert.equal(f.target.holdId,hold);assert.equal(f.store.reservations[0].status,'RESERVED');
});
test('multiple own reservations or a forged v2 active quote cannot be silently carried into a reprice',async()=>{
 for(const corrupt of ['multiple','source']){
  const f=await offlineSwapReservationFixture();await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);
  if(corrupt==='multiple')f.store.reservations.push({...f.store.reservations[0],id:'unknown-extra-reservation'});else f.quotes[0].snapshot.pricingHash='f'.repeat(64);
  const before=f.store.writes(),quotes=f.quotes.length;await assert.rejects(swapQuote(f.tx,f.change,{...swapV2Input(f),reason:'重新核对'},swapOps),code(corrupt==='multiple'?'OFFLINE_SWAP_REPRICE_REQUIRED':'SWAP_QUOTE_SOURCE_MISMATCH'));assert.equal(f.store.writes(),before);assert.equal(f.quotes.length,quotes);
 }
});

test('same Shanghai service day with a new actual time preserves the priced periods and the one reserved credit',async()=>{
 const f=await offlineSwapReservationFixture(0,true);await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);const prior=f.quotes[0],reservation=structuredClone(f.store.reservations[0]),count=f.store.writes();
 await swapQuote(f.tx,f.change,{...swapV2Input(f),idempotencyKey:'same-day-time-change',plannedReturnAt:'2026-11-01T09:30:00+08:00',plannedDeliveryAt:'2026-11-01T15:00:00+08:00'},swapOps);const next=f.quotes[1];
 assert.notEqual(next.id,prior.id);assert.notEqual(next.commercialHash,prior.commercialHash);assert.deepEqual(next.snapshot.periods,prior.snapshot.periods);assert.equal(next.snapshot.plannedDeliveryAt,'2026-11-01T15:00:00+08:00');assert.deepEqual(f.store.reservations,[reservation]);assert.equal(f.store.writes(),count);assert.equal(f.store.ledger.filter(l=>l.type==='CONSUME').length,0);
});

test('a later quoted date may select another genuinely paid valid credit, releasing only the old reservation without changing either purchase',async()=>{
 const f=await offlineSwapReservationFixture(0,true);f.store.purchases[0].expiresAt=new Date('2026-11-02T00:00:00+08:00');
 const bill={...f.store.bills[0],id:'second-paid-bill',sequence:2},payment={...f.store.payments[0],id:'second-paid-payment',billId:bill.id,providerTransactionId:'second-synthetic-paid-source'};
 const purchase={...structuredClone(f.store.purchases[0]),id:'second-paid-purchase',billId:bill.id,status:'PENDING_PAYMENT',creditId:null,paymentId:null,activatedAt:null,expiresAt:new Date('2027-01-01T00:00:00+08:00')};f.store.bills.push(bill);f.store.payments.push(payment);f.store.purchases.push(purchase);await grantSwapCredit(f.tx,bill,payment.id,new Date('2026-10-31T00:00:00Z'));
 await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);const original=f.store.reservations[0],purchases=structuredClone(f.store.purchases);assert.equal(original.creditId,f.store.purchases[0].creditId);
 await swapQuote(f.tx,f.change,{...swapV2Input(f),idempotencyKey:'later-valid-paid-source',plannedReturnAt:'2026-11-03T09:00:00+08:00',plannedDeliveryAt:'2026-11-03T10:00:00+08:00'},swapOps);
 assert.equal(original.status,'RELEASED');const current=f.store.reservations.filter(r=>r.status==='RESERVED');assert.equal(current.length,1);assert.equal(current[0].creditId,purchase.creditId);assert.deepEqual(f.store.purchases,purchases);assert.equal(f.store.ledger.filter(l=>l.type==='GRANT').length,2);assert.equal(f.store.ledger.filter(l=>l.type==='RESERVE').length,2);assert.equal(f.store.ledger.filter(l=>l.type==='RELEASE').length,1);assert.equal(f.store.ledger.filter(l=>l.type==='CONSUME').length,0);
});
