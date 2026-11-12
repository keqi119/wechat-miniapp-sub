import test from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {runRenewalJourney,seedRenewalProduct} from './v31-renewal-journey';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {terminationSource,terminationAmounts} from '../src/orders/termination-source';
test('termination after genuine05 preserves original31 and current-stage prices',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2027-01-31T02:00:00Z')});const db=new Db(),saved={...process.env};try{let selected:any;const fixture=await activeSwapFixture(db,{initialMonths:3,actualDeliveryAt:'2027-01-31T01:00:00Z',configureSources:async(db,f)=>{selected=await seedRenewalProduct(db,f);}});await runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-04-30',end:'2027-07-31',firstEnd:'2027-05-31',secondEnd:'2027-06-30',expiresAt:'2027-02-10T00:00:00Z',startAt:'2027-04-29T16:00:00Z'});const source=await terminationSource(db,fixture.sub.order.id);assert.equal(source.pin.serviceAnchor.anchorDay,31);assert.equal(source.pin.periods[4].endDate,'2027-06-30');assert.equal(source.pin.periods[5].endDate,'2027-07-31');const amounts=terminationAmounts(source.pin,new Date('2027-06-15T12:00:00+08:00'),'PERSONAL');assert.equal(amounts.remainingRentAmount,29667);assert.equal(amounts.compensationAmount,20000);
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
