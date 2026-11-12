import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageSwapSourceFixture} from './stage-swap-source-fixture';
import {canonicalHash} from '../src/customers/types';
async function implementation(){const api:any=await import('../src/vehicle-changes/stage-source').catch(()=>({}));assert.equal(typeof api.readSwapStageScope,'function');return api;}
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('renewal swap scope proves real stage and immutable usage/product while allowing a prior upgrade monthly fee',async()=>{
 const api=await implementation(),f=await stageSwapSourceFixture(2);f.order.contractMode='OFFLINE';const terms={...f.terms,monthlyFeeAmount:260000};
 const scope=await api.readSwapStageScope(f.tx,f.order,terms);assert.deepEqual(scope,{version:1,serviceStageId:'stage-2',stageSourceHash:canonicalHash(f.snap),startDate:'2027-01-31',endDate:'2028-01-31',months:12,firstPeriodSequence:13,lastPeriodSequence:24});assert.equal(f.writes,0);
});
test('unmarked original INITIAL stays null without inventing a new pricing source; explicit unknown markers never fall back',async()=>{
 const api=await implementation(),f=await stageSwapSourceFixture();f.order.contractMode='OFFLINE';assert.equal(await api.readSwapStageScope(f.tx,f.order,f.order.finalPlanSnapshot,{historical:true}),null);await assert.rejects(api.readSwapStageScope(f.tx,f.order,f.order.finalPlanSnapshot),code('SWAP_STAGE_SOURCE'));f.tx.orderServiceStage.findMany=async()=>[];assert.equal(await api.readSwapStageScope(f.tx,f.order,f.order.finalPlanSnapshot),null);
 for(const serviceStageId of [null,'','missing','bad\0id'])await assert.rejects(api.readSwapStageScope(f.tx,f.order,{...f.terms,serviceStageId}));
});
test('current stage must be ACTIVE; immutable history may read ENDED but never a future or voided stage',async()=>{
 const api=await implementation(),f=await stageSwapSourceFixture();f.order.contractMode='OFFLINE';f.stages[1]=f.row(f.snap,'ENDED');await assert.rejects(api.readSwapStageScope(f.tx,f.order,f.terms),code('SWAP_STAGE_SOURCE'));assert.equal((await api.readSwapStageScope(f.tx,f.order,f.terms,{historical:true})).serviceStageId,'stage-2');
 for(const state of ['PREPARED','SCHEDULED','VOIDED']){f.stages[1]=f.row(f.snap,state);await assert.rejects(api.readSwapStageScope(f.tx,f.order,f.terms,{historical:true}),code('SWAP_STAGE_SOURCE'));}
});
test('a target product or changed usage policy cannot replace stage rights and the original stage dates cannot shift',async()=>{
 const api=await implementation();for(const patch of [{productSnapshot:{configurationVersion:2}},{usagePolicyVersion:'USAGE_V1'},{usagePolicy:{}},{startDate:'2027-02-01'},{months:13},{mileagePerMonthKm:9999}]){const f=await stageSwapSourceFixture();f.order.contractMode='OFFLINE';await assert.rejects(api.readSwapStageScope(f.tx,f.order,{...f.terms,...patch}),code('SWAP_STAGE_SOURCE'));}
});
