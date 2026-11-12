import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageCreditFixture} from './stage-swap-credit-fixture';
import {readSwapSourceAt} from '../src/order-service-stages/swap-source';
import {freezeSwapPricing} from '../src/swap-purchases/policy';
import {purchaseView} from '../src/swap-purchases/view';
import {grantSwapCredit,guardSwapRefund} from '../src/swap-purchases/ledger';
import {restoreState} from '../src/swap-purchases/restore';
import {SwapPurchasesController} from '../src/swap-purchases/controller';
import {hash} from '../src/common/data';
async function fixture(){const f=await stageCreditFixture(),source=await readSwapSourceAt(f.tx,f.order,f.account,f.now),{p,bill,payment}=f.purchase();Object.assign(p,{serviceStageId:source.serviceStageId,pricingSnapshot:freezeSwapPricing(f.order,source),amount:34567,expiresAt:source.endAt,termsSnapshot:{version:'SWAP_CREDIT_V2',documentId:'terms',documentVersion:1,content:'原确认说明',hash:hash('原确认说明'),templateContent:'单次 {{extraFeeYuan}} 元',templateHash:hash('单次 {{extraFeeYuan}} 元')}});Object.assign(bill,{amount:34567,paidAmount:34567});payment.amount=34567;return{...f,p,bill,payment,source};}

test('purchase view reads exact own-stage price and original expiry with no expiry writes',async()=>{
 const f=await fixture();await grantSwapCredit(f.tx,f.bill,f.payment.id,f.now);const before=f.writes(),r=await purchaseView(f.tx,f.p,f.now,true,true);assert.equal(r.amount,34567);assert.equal(r.serviceStageId,'stage-2');assert.equal(r.stageSourceHash,f.source.stageSourceHash);assert.equal(r.expiresOn,'2028-01-30');assert.equal(f.writes(),before);
});
test('rejected refund restoration uses the original active stage and cannot restore after its frozen expiry',async()=>{
 const f=await fixture();await grantSwapCredit(f.tx,f.bill,f.payment.id,f.now);await guardSwapRefund(f.tx,f.payment,34567);(f.payment as any).refunds=[{id:'reject',status:'REJECTED',approvedBy:null,providerRefundId:null}];
 assert.equal((await restoreState(f.tx,f.p,f.now)).allowed,true);assert.equal((await restoreState(f.tx,f.p,new Date('2029-01-01'))).allowed,false);
});
test('actual admin purchase detail refreshes staff permission first and remains read-only for expired history',async()=>{
 const f=await fixture();await grantSwapCredit(f.tx,f.bill,f.payment.id,f.now);const actor={id:'finance',role:'FINANCE',authVersion:1};f.tx.adminUser={findUnique:async()=>({...actor,active:true})};const api=new SwapPurchasesController({serial:f.serial} as any,{} as any,()=>new Date('2029-01-01'));const before=f.writes();
 const view=await api.admin(f.p.id,{admin:actor});assert.equal(view.canPay,false);assert.equal(view.amount,34567);assert.equal(f.writes(),before);assert.equal(f.p.status,'ACTIVE');
 f.tx.adminUser.findUnique=async()=>({...actor,active:false});await assert.rejects(api.admin(f.p.id,{admin:actor}),(e:any)=>e.getResponse?.().error?.code==='STAFF_SESSION_CHANGED');assert.equal(f.writes(),before);
});
