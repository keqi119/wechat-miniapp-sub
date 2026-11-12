import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OrderChangesService} from '../src/order-changes/service';
import {publish,confirm} from '../src/order-changes/quotes';
import {prepareFinance} from '../src/order-changes/finance';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
import {swapOps} from './offline-swap-quotes-fixture';

test('a real v2 paper quote exposes publication, exact customer consent and archive-pinned finance while physical completion remains closed',async()=>{
 const f=await offlineSwapLifecycleFixture(),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));
 let view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.canPublish,true);assert.equal(view.canCreateReturn,false);assert.equal(view.canComplete,false);
 await publish(f.tx,f.change);view=await service.view(f.tx,f.change.id,undefined,f.order.customerId);assert.equal(view.canConfirm,true);assert.equal(view.canSign,false);
 await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});view=await service.view(f.tx,f.change.id,{id:'finance',role:'FINANCE',authVersion:1});assert.equal(view.canPrepareFinance,false);
 f.archiveQuote();view=await service.view(f.tx,f.change.id,{id:'finance',role:'FINANCE',authVersion:1});assert.equal(view.canPrepareFinance,true);assert.equal(view.canCreateReturn,false);
});

test('prepared v2 price exposes automatic net reprice even after a late real receipt, while unresolved payment channels block it',async()=>{
 const f=await offlineSwapLifecycleFixture(),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});f.archiveQuote();await prepareFinance(f.tx,f.change,{id:'finance'});
 f.bills[0].payments.push({id:'late-real',billId:f.bills[0].id,customerId:f.order.customerId,status:'SUCCEEDED',amount:100,refunds:[]});
 let view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.canQuote,true);assert.equal(view.recoveryOnly,false);assert.equal(view.canPrepareSignature,false);assert.equal(view.canCreateDelivery,false);
 f.bills[0].payments.at(-1)!.status='PENDING';view=await service.view(f.tx,f.change.id,swapOps);assert.equal(view.canQuote,false);
});
