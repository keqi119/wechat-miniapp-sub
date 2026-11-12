import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {swapTerms} from '../src/swap-purchases/rules';
import {termSwapFixture} from './term-swap-fixture';
async function helper(){const m:any=await import('../src/swap-purchases/policy').catch(()=>({}));assert.equal(typeof m.freezeSwapPolicy,'function');return m;}
test('original product policy freezes term counts and exact purchase cents, including zero gifts and huge allowance without rows',async()=>{
 const m=await helper();for(const n of [0,2,2147483647]){const f=termSwapFixture(n);assert.deepEqual(m.freezeSwapPolicy(f.order),f.policy);assert.deepEqual(m.freezeSwapPricing(f.order),f.pricing);assert.equal(m.swapProduct(f.order).id,'SWAP_CREDIT_TERM_1');assert.equal(m.swapProduct(f.order).amount,50000);assert.equal(f.writes(),0);}
 assert.equal(m.freezeSwapPolicy(termSwapFixture(2,80000,true).order),null);
});
test('unsupported, incomplete or forged v2 policy and purchases never fall back to legacy annual or 800 yuan rules',async()=>{
 const m=await helper();for(const edit of [{configurationVersion:9},{productVersionId:null},{swapPolicy:null},{swapPolicy:{version:2,period:'YEAR',includedCount:2,extraFeeAmount:50000}},{swapPolicy:{version:2,period:'TERM',includedCount:-1,extraFeeAmount:50000}},{swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:0}}]){const f=termSwapFixture();Object.assign(f.product,edit);assert.throws(()=>m.freezeSwapPolicy(f.order));}
 const f=termSwapFixture(),{p,bill,payment}=f.purchase();assert.equal(m.validateSwapPurchase(f.order,p,bill,payment),50000);
 for(const bad of [null,{...f.pricing,amount:80000},{...f.pricing,sourceHash:'a'.repeat(64)}])assert.throws(()=>m.validateSwapPurchase(f.order,{...p,pricingSnapshot:bad},bill,payment));
 for(const bad of [{...bill,customerId:'other'},{...bill,amount:80000}])assert.throws(()=>m.validateSwapPurchase(f.order,p,bad,payment));
});
test('v2 purchase text requires an approved exact-price template and preserves its original and rendered hashes',async()=>{
 const f=termSwapFixture(2,175),template='合同期内额外换车一次 {{extraFeeYuan}} 元（{{extraFeeAmount}} 分）。',doc={id:'doc',type:'swap-credit-v2',version:2,status:'PUBLISHED',confirmedBy:'reviewer',confirmedAt:new Date(),content:template};
 const tx={legalDocument:{findFirst:async({where}:any)=>{assert.equal(where.type,'swap-credit-v2');return doc;}}};
 const terms=await (swapTerms as any)(tx,f.order);assert.equal(terms.version,'SWAP_CREDIT_V2');assert.equal(terms.templateContent,template);assert.equal(terms.templateHash,hash(template));assert.equal(terms.content,'合同期内额外换车一次 1.75 元（175 分）。');assert.equal(terms.hash,hash(terms.content));
 for(const content of ['固定800元','{{extraFeeYuan}} {{unknown}}','{{extraFeeYuan}} {{broken'])await assert.rejects((swapTerms as any)({legalDocument:{findFirst:async()=>({...doc,content})}},f.order));
 assert.equal(await (swapTerms as any)({legalDocument:{findFirst:async()=>null}},f.order),null);
});

test('an explicitly v2 final plan without its original product cannot fall back to legacy prices',async()=>{
 const m=await helper(),f=termSwapFixture();f.order.finalPlanSnapshot.usagePolicyVersion='USAGE_V2';delete f.order.finalPlanSnapshot.productSnapshot;
 assert.throws(()=>m.freezeSwapPolicy(f.order));assert.throws(()=>m.swapProduct(f.order));
 f.order.finalPlanSnapshot.productSnapshot={...f.product,configurationVersion:undefined};assert.throws(()=>m.freezeSwapPolicy(f.order));
 const old=termSwapFixture(1,80000,true);old.order.finalPlanSnapshot.usagePolicyVersion='USAGE_V1';assert.equal(m.freezeSwapPolicy(old.order),null);
});
test('v2 plan evidence cannot be paired with an incomplete legacy-looking product snapshot',async()=>{
 const m=await helper();for(const marker of [{usagePolicyVersion:'USAGE_V2'},{usagePolicy:{policyVersion:'USAGE_V2'}}]){const f=termSwapFixture();Object.assign(f.order.finalPlanSnapshot,marker,{productSnapshot:{productId:'historical',productVersionId:'historical-version',version:1}});assert.throws(()=>m.freezeSwapPolicy(f.order));}
});
