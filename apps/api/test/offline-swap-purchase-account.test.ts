import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swapAccountView} from '../src/vehicle-changes/account';
import {offlineSwapPurchaseFixture,withSwapPurchaseFlags} from './offline-swap-purchases-fixture';

test('actual account exposes independently authorized OFFLINE purchase with zero included credits and leaves new change readiness intact',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture(),before=f.writesCount(),view=await swapAccountView(f.tx,f.order.id,f.now,f.order.customerId);
 assert.equal(view.canPurchase,true);assert.deepEqual(view.purchaseBlockers,[]);assert.equal(view.canRequest,true);assert.deepEqual(view.blockers,[]);
 assert('term' in view);assert.equal(view.term.includedCount,0);assert.equal(view.term.available,0);assert.equal(view.purchases.length,0);assert.equal(f.writesCount(),before);
}));
test('account independently stops new purchases when rollout is off without shutting a valid OFFLINE change request',()=>withSwapPurchaseFlags('true','false',async()=>{
 const f=await offlineSwapPurchaseFixture(),view=await swapAccountView(f.tx,f.order.id,f.now,f.order.customerId);
 assert.equal(view.canRequest,true);assert.equal(view.canPurchase,false);assert(view.purchaseBlockers.includes('付费换车购买暂未开放'));
}));
test('account does not advertise either new capability when the verified paper or current assignment source is broken',()=>withSwapPurchaseFlags('true','true',async()=>{
 for(const damage of [(f:any)=>{f.rental.versions[0].status='INVALIDATED';},(f:any)=>{f.assignment.customerId='foreign';}]){
  const f=await offlineSwapPurchaseFixture();damage(f);const before=f.writesCount(),view=await swapAccountView(f.tx,f.order.id,f.now,f.order.customerId);
  assert.equal(view.canRequest,false);assert.equal(view.canPurchase,false);assert(view.blockers.some((v:string)=>/AGREEMENT|ASSIGNMENT/.test(v)));assert(view.purchaseBlockers.some((v:string)=>/AGREEMENT|ASSIGNMENT/.test(v)));assert.equal(f.writesCount(),before);
 }
}));
