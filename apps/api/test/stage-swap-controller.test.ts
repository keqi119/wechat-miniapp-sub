import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageCreditFixture} from './stage-swap-credit-fixture';
import {readSwapSourceAt} from '../src/order-service-stages/swap-source';
import {swapProduct} from '../src/swap-purchases/policy';
import {swapTerms} from '../src/swap-purchases/rules';
import {SwapPurchasesController} from '../src/swap-purchases/controller';
import {readOfflineSwapPurchases} from '../src/vehicle-changes/offline-account';
import {hash} from '../src/common/data';
const code=(wanted:string)=>(e:any)=>e.getResponse?.().error?.code===wanted;
async function fixture(){
 const f=await stageCreditFixture(),source=await readSwapSourceAt(f.tx,f.order,f.account,f.now),session={id:'session',customerId:f.order.customerId,expiresAt:new Date('2099-01-01')};
 f.tx.customerSession={findUnique:async()=>session};f.tx.legalDocument={findFirst:async({where}:any)=>({id:where.type,type:where.type,version:1,status:'PUBLISHED',confirmedBy:'legal',confirmedAt:new Date('2026-01-01'),content:'原服务期内单次 {{extraFeeYuan}} 元'})};f.tx.customerConsent={count:async()=>1};
 const originalFind=f.tx.swapCreditPurchase.findUnique;f.tx.swapCreditPurchase.findUnique=async({where}:any)=>where.orderId_idempotencyKey?f.purchases.find((p:any)=>p.orderId===where.orderId_idempotencyKey.orderId&&p.idempotencyKey===where.orderId_idempotencyKey.idempotencyKey):originalFind({where});
 const originalCreate=f.tx.swapCreditPurchase.create;f.tx.swapCreditPurchase.create=async({data}:any)=>originalCreate({data:{status:'PENDING_PAYMENT',...data}});
 const terms=(await swapTerms(f.tx,f.order,source))!,product=swapProduct(f.order,source),input:any={productId:product.id,termsVersion:terms.version,termsDocumentId:terms.documentId,termsDocumentVersion:terms.documentVersion,termsHash:terms.hash,pricingHash:'pricingHash'in product?product.pricingHash:null,accepted:true,idempotencyKey:'stage-purchase-1'};
 const api=new SwapPurchasesController({serial:f.serial} as any,{} as any,()=>f.now);return{...f,source,session,input,api,request:{customer:{id:f.order.customerId},session}};
}
async function enabled(fn:()=>Promise<void>){const old=[process.env.MVP_V2_ENABLED,process.env.SWAP_CREDIT_PURCHASE_ENABLED];process.env.MVP_V2_ENABLED='false';process.env.SWAP_CREDIT_PURCHASE_ENABLED='true';try{await fn();}finally{for(const [i,k] of ['MVP_V2_ENABLED','SWAP_CREDIT_PURCHASE_ENABLED'].entries())if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}}
test('actual purchase freezes ACTIVE stage amount and expiry, rejects stale same-product pricing, and replays before current source after current session check',()=>enabled(async()=>{
 const f=await fixture(),stale={...f.input,pricingHash:'f'.repeat(64)};await assert.rejects(f.api.purchase(f.order.id,stale,f.request),code('SWAP_PURCHASE_PRICE'));assert.equal(f.purchases.length,0);
 const revisions=[f.order.revision,f.account.revision];const first=await f.api.purchase(f.order.id,f.input,f.request);assert.deepEqual([f.order.revision,f.account.revision],revisions.map(v=>(v||0)+1));assert.equal(first.purchase.amount,34567);assert.equal(f.purchases[0].serviceStageId,'stage-2');assert.equal(f.purchases[0].expiresAt.getTime(),f.source.endAt.getTime());assert.equal(f.purchases[0].pricingSnapshot.stageSourceHash,f.source.stageSourceHash);
 f.stage.stages[1].status='ENDED';f.stage.stages[1].endedAt=new Date('2028-01-31');const before=f.writes();assert.equal((await f.api.purchase(f.order.id,f.input,f.request)).purchase.id,first.purchase.id);assert.equal(f.writes(),before);await assert.rejects(f.api.purchase(f.order.id,{...f.input,termsHash:'e'.repeat(64)},f.request),code('IDEMPOTENCY_CONFLICT'));
 f.tx.customerSession.findUnique=async()=>null;await assert.rejects(f.api.purchase(f.order.id,f.input,f.request),code('SESSION_EXPIRED'));assert.equal(f.writes(),before);
}));
test('new purchase refuses a customer-confirmed future stage and OFFLINE projection preserves source without writes',()=>enabled(async()=>{
 const f=await fixture();f.tx.orderChange.findMany=async()=>[{id:'next',orderId:f.order.id,customerId:f.order.customerId,kind:'SUBSCRIPTION_EXTENSION',status:'AWAITING_ARCHIVE',activeQuoteId:'next-q'}];f.tx.delayQuote.findUnique=async()=>({id:'next-q',changeId:'next',confirmedAt:new Date()});
 await assert.rejects(f.api.purchase(f.order.id,f.input,f.request),code('SWAP_FUTURE_STAGE_CONFIRMED'));assert.equal(f.purchases.length,0);
 const before=f.writes();f.order.contractMode='OFFLINE';const view=await readOfflineSwapPurchases(f.tx,f.order,f.account,f.now);assert.equal(view.product.amount,34567);assert.equal(view.canPurchase,false);assert.ok(view.purchaseBlockers.some(v=>v.includes('未来')));assert.equal(f.writes(),before);
}));
test('a historical INITIAL purchase key preserves the exact old body hash and null source after renewal',()=>enabled(async()=>{
 const f=await fixture(),legacy:any={productId:'SWAP_CREDIT_1',termsVersion:'SWAP_CREDIT_V1',termsDocumentId:'old-doc',termsDocumentVersion:1,termsHash:hash('original'),accepted:true,idempotencyKey:'old-key-1'},p=f.purchase().p;
 Object.assign(p,{expiresAt:new Date('2027-01-31T00:00:00+08:00'),idempotencyKey:legacy.idempotencyKey,requestHash:hash({termsDocumentId:legacy.termsDocumentId,termsDocumentVersion:legacy.termsDocumentVersion,termsHash:legacy.termsHash,accepted:legacy.accepted,idempotencyKey:legacy.idempotencyKey,productId:legacy.productId,termsVersion:legacy.termsVersion}),termsSnapshot:{version:'SWAP_CREDIT_V1',documentId:'old-doc',documentVersion:1,hash:hash('original')}});const before=f.writes();const view=await f.api.purchase(f.order.id,legacy,f.request);assert.equal(view.purchase.amount,80000);assert.equal(view.purchase.serviceStageId,null);assert.equal(f.writes(),before);
}));
