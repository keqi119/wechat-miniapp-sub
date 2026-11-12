import test from 'node:test';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {runRenewalJourney,seedRenewalProduct} from './v31-renewal-journey';

test('real01 delivery then applied03 then manual05 retains authentic electronic chain',{skip:process.env.NODE_ENV!=='test'},async ctx=>{
 let selected:any;
 await runSwapCommandJourney(ctx,'delay',{
  configureSources:async(db,f,target)=>{selected=await seedRenewalProduct(db,f,target.id);},
  run:async(ctx,db,fixture)=>runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-05-12',end:'2027-08-12',firstEnd:'2027-06-12',secondEnd:'2027-07-12',expiresAt:'2026-11-20T00:00:00Z',startAt:'2027-05-11T16:00:00Z'}),
 });
});
