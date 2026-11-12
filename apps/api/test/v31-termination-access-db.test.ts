import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {TerminationService} from '../src/orders/termination';
test('support exit read does not bypass existing financial permissions',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-13T04:00:00Z')});const db=new Db(),saved={...process.env};try{const {sub}=await activeSwapFixture(db),support=await db.adminUser.create({data:{username:randomUUID(),name:'合成客服',role:'SUPPORT',passwordHash:'synthetic-disabled'}}),view:any=await new TerminationService(db).read(sub.order.id,support);assert.deepEqual(view.payments,[]);assert.equal(view.financialSourceHash,null);assert.equal(view.settlementSource,null);assert.equal(view.canPropose,false);assert.equal(view.reviewSource,null);
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
