import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {freezeSwapPricing,validateSwapCredit,validateSwapPurchase,validateSwapPurchaseCredit,swapProduct} from '../src/swap-purchases/policy';
import {stageSwapSourceFixture} from './stage-swap-source-fixture';
import {readHistoricalSwapSource,readSwapSourceAt} from '../src/order-service-stages/swap-source';
const code=(v:string)=>(e:any)=>e.getResponse?.().error?.code===v;

test('renewal price consent freezes the real stage as well as its policy, while INITIAL hash stays byte-for-byte unchanged',async()=>{
 const f=await stageSwapSourceFixture(),stage=await readSwapSourceAt(f.tx,f.order,f.account,new Date('2027-02-01'));
 const pricing=(freezeSwapPricing as any)(f.order,stage);assert.equal(pricing.amount,34567);assert.equal(pricing.serviceStageId,'stage-2');assert.equal(pricing.stageSourceHash,f.stages[1].snapshotHash);
 assert.equal((swapProduct as any)(f.order,stage).pricingHash,canonicalHash(pricing));
 const original=await readHistoricalSwapSource(f.tx,f.order,f.account,null);assert.deepEqual((freezeSwapPricing as any)(f.order,original),freezeSwapPricing(f.order));
 const next={...stage,serviceStageId:'stage-3',stageSourceHash:'a'.repeat(64)};assert.notEqual((swapProduct as any)(f.order,next).pricingHash,(swapProduct as any)(f.order,stage).pricingHash);
});

test('renewal credit and purchase are checked against their own stage, including same-price foreign-stage rejection',async()=>{
 const f=await stageSwapSourceFixture(),source=await readSwapSourceAt(f.tx,f.order,f.account,new Date('2027-02-01')),pricing={policyVersion:source.policy!.policyVersion,sourceHash:source.policy!.sourceHash,quantity:1,amount:34567,currency:'CNY',serviceStageId:source.serviceStageId,stageSourceHash:source.stageSourceHash};
 const p={id:'p',orderId:f.order.id,customerId:f.order.customerId,serviceStageId:source.serviceStageId,quantity:1,amount:34567,currency:'CNY',pricingSnapshot:pricing,expiresAt:source.endAt,billId:'b',paymentId:'pay',creditId:'c'};
 const c={id:'c',orderId:f.order.id,serviceStageId:source.serviceStageId,source:'PAID',sourcePaymentId:'pay',termSequence:null,cycleSequence:null,policySnapshot:source.policy};
 assert.equal((validateSwapPurchase as any)(f.order,p,undefined,undefined,source),34567);(validateSwapCredit as any)(f.order,c,source);(validateSwapPurchaseCredit as any)(f.order,p,c,source);
 assert.throws(()=>(validateSwapPurchase as any)(f.order,{...p,serviceStageId:'stage-foreign'},undefined,undefined,source),code('SWAP_PURCHASE_SOURCE'));
 assert.throws(()=>(validateSwapCredit as any)(f.order,{...c,serviceStageId:null},source),code('SWAP_CREDIT_SOURCE'));
 assert.throws(()=>(validateSwapPurchase as any)(f.order,{...p,expiresAt:new Date('2030-01-01')},undefined,undefined,source),code('SWAP_PURCHASE_SOURCE'));
});

test('a legacy paid amount and original frozen expiry survive a different current renewal policy',async()=>{
 const f=await stageSwapSourceFixture(),source=await readHistoricalSwapSource(f.tx,f.order,f.account,null),expiresAt=new Date('2026-12-01T00:00:00+08:00');
 const p={id:'legacy',orderId:f.order.id,customerId:f.order.customerId,serviceStageId:null,quantity:1,amount:80000,currency:'CNY',pricingSnapshot:null,expiresAt};const before=JSON.stringify(p);
 assert.equal((validateSwapPurchase as any)(f.order,p,undefined,undefined,source),80000);assert.equal(JSON.stringify(p),before);
});
