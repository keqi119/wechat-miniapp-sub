import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {exitResponseGroups} from '../src/orders/exit-amount-responses';

test('older disputed economic binding stays inspectable with its exact statement and original confirmation',async()=>{
 const source={bindingHash:'old-economic-binding',amounts:{remainingRentAmount:12345},paymentReferences:[{paymentId:'original-payment',amount:20000}]},other={...source,bindingHash:'new-economic-binding',paymentReferences:[...source.paymentReferences,{paymentId:'later-payment',amount:100}]};
 const first={id:'first',source,sourceHash:canonicalHash(source),decision:'CONFIRM',reason:'原确认',confirmedAt:new Date('2026-11-08T01:00:00Z'),responseVersion:null,predecessorId:null,bindingHash:null},objection={...first,id:'object',decision:'OBJECT',reason:'原金额仍存在异议',confirmedAt:new Date('2026-11-08T02:00:00Z'),responseVersion:2,predecessorId:first.id,bindingHash:source.bindingHash},later={...first,id:'new-source',source:other,sourceHash:canonicalHash(other),confirmedAt:new Date('2026-11-08T03:00:00Z'),responseVersion:1,bindingHash:other.bindingHash};
 const groups=await exitResponseGroups({orderExitAmountResponse:{findMany:async()=>[first,objection,later]}},'order'),old=groups.find(g=>g.bindingHash===source.bindingHash)!;
 assert.equal(old.first.id,first.id);assert.equal(old.view.history[0].legacy,true);assert.equal(old.view.headId,objection.id);assert.deepEqual((old.view.openObjection as any).source,source);assert.deepEqual((old.view.history[0] as any).source,source);assert.equal(old.view.openObjection?.undisputedAmount,null);assert.equal(old.view.openObjection?.doesNotSuspendUndisputedRefunds,true);
});
