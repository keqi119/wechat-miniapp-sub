import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageCreditFixture} from './stage-swap-credit-fixture';
import {chooseCredit,consumeCredit,creditView,readSwapCreditAvailability} from '../src/vehicle-changes/credits';
const code=(v:string)=>(e:any)=>e.getResponse?.().error?.code===v;
test('new ACTIVE stage grants only its own independent TERM sequence and never carries original gifts',async()=>{
 const f=await stageCreditFixture();f.credits.push({id:'original-free',orderId:f.order.id,source:'FREE',cycleSequence:1,termSequence:null,serviceStageId:null,policySnapshot:null,status:'ACTIVE',consumedChangeId:'old-swap'});
 const before=f.writes();await readSwapCreditAvailability(f.tx,f.order,f.account,'swap-1',f.now);assert.equal(f.writes(),before);
 await consumeCredit(f.tx,f.order,f.account,'swap-1',f.now);await consumeCredit(f.tx,f.order,f.account,'swap-1',f.now);await consumeCredit(f.tx,f.order,f.account,'swap-2',f.now);
 const current=f.credits.filter(c=>c.serviceStageId==='stage-2');assert.deepEqual(current.map(c=>c.termSequence),[1,2]);assert.equal(current[0].policySnapshot.includedCount,2);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,2);
 await assert.rejects(chooseCredit(f.tx,f.order,f.account,'swap-3',f.now),code('SWAP_CREDIT_UNAVAILABLE'));const view=await creditView(f.tx,f.order,f.account,f.now);assert.ok('term'in view);assert.equal(view.term.includedCount,2);assert.equal(view.term.remaining,0);assert.equal(view.serviceStageId,'stage-2');
});

test('an unactivated stage and a confirmed future renewal block all new gift materialization',async()=>{
 for(const future of [false,true]){const f=await stageCreditFixture();if(future){f.tx.orderChange.findMany=async()=>[{id:'future',orderId:'order',customerId:'customer',kind:'SUBSCRIPTION_EXTENSION',status:'AWAITING_ARCHIVE',activeQuoteId:'future-quote'}];f.tx.delayQuote.findUnique=async()=>({id:'future-quote',changeId:'future',confirmedAt:new Date(),status:'CONFIRMED'});}else f.stage.stages[1]=f.stage.row(f.stage.snap,'SCHEDULED');
  await assert.rejects(chooseCredit(f.tx,f.order,f.account,'swap',f.now),code(future?'SWAP_FUTURE_STAGE_CONFIRMED':'SWAP_FUTURE_STAGE_CONFIRMED'));assert.equal(f.credits.length,0);assert.equal(f.ledger.length,0);
 }
});

test('original consumption replay remains historical after renewal activation and does not allocate another gift',async()=>{
 const f=await stageCreditFixture();f.credits.push({id:'old',orderId:'order',source:'FREE',cycleSequence:1,termSequence:null,policySnapshot:null,serviceStageId:null,consumedChangeId:'old-swap',status:'ACTIVE'});f.ledger.push({orderId:'order',changeId:'old-swap',creditId:'old',sourceKey:'consume:old-swap',type:'CONSUME'});
 const writes=f.writes();await consumeCredit(f.tx,f.order,f.account,'old-swap',f.now);assert.equal(f.writes(),writes);assert.equal(f.credits.length,1);
});
