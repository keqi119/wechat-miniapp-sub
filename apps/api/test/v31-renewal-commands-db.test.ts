import test from 'node:test';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {runRenewalJourney,seedRenewalProduct} from './v31-renewal-journey';

test('electronic05 manual signing, original31 anchor and actual stage activation',{skip:process.env.NODE_ENV!=='test'},async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2027-01-31T02:00:00Z')});
 const db=new Db(),saved={...process.env};
 try{
  let selected:any;
  const fixture=await activeSwapFixture(db,{initialMonths:3,actualDeliveryAt:'2027-01-31T01:00:00Z',configureSources:async(db,f)=>{selected=await seedRenewalProduct(db,f);}});
  await runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-04-30',end:'2027-07-31',firstEnd:'2027-05-31',secondEnd:'2027-06-30',expiresAt:'2027-02-10T00:00:00Z',startAt:'2027-04-29T16:00:00Z'});
 }finally{await db.$disconnect();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);ctx.mock.timers.reset();}
});
