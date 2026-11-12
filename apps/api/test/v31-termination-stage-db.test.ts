import test from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {runRenewalJourney,seedRenewalProduct} from './v31-renewal-journey';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {terminationSource,terminationAmounts} from '../src/orders/termination-source';
test('termination source after actual upgraded03 then genuine05 keeps each stage applicable frozen fee',async ctx=>{let selected:any;await runSwapCommandJourney(ctx,'upgrade',{configureSources:async(db,f,target)=>{selected=await seedRenewalProduct(db,f,target.id);},run:async(ctx,db,fixture)=>{await runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-05-12',end:'2027-08-12',firstEnd:'2027-06-12',secondEnd:'2027-07-12',expiresAt:'2026-11-20T00:00:00Z',startAt:'2027-05-11T16:00:00Z'});const source=await terminationSource(db,fixture.sub.order.id);assert.equal(source.pin.monthlyFeeAmount,20000);assert.ok(source.pin.periods.filter((p:any)=>p.stageKind==='INITIAL').every((p:any)=>p.amount===30000));assert.ok(source.pin.periods.filter((p:any)=>p.stageKind==='RENEWAL').every((p:any)=>p.amount===20000));}});});
