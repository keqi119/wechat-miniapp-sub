import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageCreditFixture} from './stage-swap-credit-fixture';
import {freezeSwapPricing} from '../src/swap-purchases/policy';
import {readSwapSourceAt} from '../src/order-service-stages/swap-source';
import {grantSwapCredit,guardSwapRefund,settleSwapRefund} from '../src/swap-purchases/ledger';

async function purchase(){const f=await stageCreditFixture(),source=await readSwapSourceAt(f.tx,f.order,f.account,f.now),{p,bill,payment}=f.purchase();Object.assign(p,{serviceStageId:source.serviceStageId,pricingSnapshot:freezeSwapPricing(f.order,source),amount:34567,expiresAt:source.endAt});Object.assign(bill,{amount:34567,paidAmount:34567});payment.amount=34567;return{...f,p,bill,payment,source};}
test('verified renewal payment grants exactly one paid credit on its own stage and replays without another grant',async()=>{
 const f=await purchase();await grantSwapCredit(f.tx,f.bill,f.payment.id,f.now);await grantSwapCredit(f.tx,f.bill,f.payment.id,f.now);
 assert.equal(f.credits.length,1);assert.equal(f.credits[0].serviceStageId,'stage-2');assert.equal(f.credits[0].policySnapshot.extraFeeAmount,34567);assert.equal(f.p.status,'ACTIVE');assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);
});
test('late original payment after renewal keeps the old amount and expiry and is frozen for reconciliation',async()=>{
 const f=await stageCreditFixture(),{p,bill,payment}=f.purchase();p.expiresAt=new Date('2027-01-31T00:00:00+08:00');const expiry=p.expiresAt.toISOString();await grantSwapCredit(f.tx,bill,payment.id,f.now);
 assert.equal(p.status,'PAYMENT_REVIEW');assert.equal(f.credits[0].status,'FROZEN');assert.equal(f.credits[0].serviceStageId??null,null);assert.equal(p.amount,80000);assert.equal(p.expiresAt.toISOString(),expiry);
});
test('refund of an ended renewal validates original price and paper-stage source rather than current original policy',async()=>{
 const f=await purchase();await grantSwapCredit(f.tx,f.bill,f.payment.id,f.now);f.stage.stages[1]=f.stage.row(f.stage.snap,'ENDED');f.p.status='EXPIRED';
 await guardSwapRefund(f.tx,f.payment,34567);assert.equal(f.p.status,'REFUND_PENDING');assert.equal(f.credits[0].status,'FROZEN');
 await settleSwapRefund(f.tx,{id:'refund',paymentId:f.payment.id,customerId:f.order.customerId,amount:34567,payment:{...f.payment,bill:f.bill}});assert.equal(f.p.status,'REFUNDED');assert.equal(f.ledger.filter(l=>l.type==='REFUND').length,1);
});
test('activation helper only expires old FREE facts and does not grant new gifts, mutate paid history or increment order/account versions',async()=>{
 const api:any=await import('../src/swap-purchases/ledger');assert.equal(typeof api.expireSwapStageFreeCredits,'function');const f=await stageCreditFixture();f.credits.push({id:'old-free',orderId:'order',source:'FREE',cycleSequence:1,termSequence:null,serviceStageId:null,policySnapshot:null,status:'ACTIVE',consumedChangeId:null});const {p}=f.purchase();p.status='ACTIVE';const before=JSON.stringify(p),revision=f.order.revision,accountRevision=f.account.revision;
 await api.expireSwapStageFreeCredits(f.tx,f.order,f.account,f.now);await api.expireSwapStageFreeCredits(f.tx,f.order,f.account,f.now);
 assert.equal(f.credits.length,1);assert.equal(f.credits[0].status,'EXPIRED');assert.equal(f.ledger.filter(l=>l.type==='EXPIRE').length,1);assert.equal(JSON.stringify(p),before);assert.equal(f.order.revision,revision);assert.equal(f.account.revision,accountRevision);
});
