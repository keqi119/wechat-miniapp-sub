import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResidualObservationsService,observationForCurve} from '../src/residual-market/observations';
import {observationCreateInput} from '../src/residual-market/observation-types';
import {residualTransaction} from '../src/residual-market/observation-command';
import {actor,finance,cmd,code,observation,fixture} from './residual-observations-fixture';
const service=new ResidualObservationsService();

test('observation freezes real model facts, money in fen and explicit zero without guessing age',async()=>{
 const f=fixture(),input={...cmd(),...observation({batteryCapacityKwh:'075.500',sourceUrl:'https://example.invalid/source'})};const result=await f.serial(tx=>service.create(tx,actor,input));
 assert.equal(result.priceAmount,1234500);assert.equal(result.mileageKm,0);assert.equal(result.vehicleAgeMonths,null);assert.equal(result.batteryCapacityKwh,'75.5');assert.deepEqual(result.modelSnapshot,{id:'model',revision:2,brand:'合成品牌',name:'合成车型',modelYear:2026});
 const before=f.writes.length;assert.deepEqual(await f.serial(tx=>service.create(tx,actor,input)),result);assert.equal(f.writes.length,before);
 assert.equal(observationForCurve(f.rows('marketPriceObservation')[0]).model,'合成车型');assert.equal(observationForCurve(f.rows('marketPriceObservation')[0]).series,null);
 assert(f.writes.every(write=>['marketPriceObservation','archiveCommand','auditLog'].includes(write.table)));
});

test('ignore/restore/void are CAS commands; void releases key and correction never edits old facts',async()=>{
 const f=fixture(),input={...cmd(),...observation()},created=await f.serial(tx=>service.create(tx,actor,input));const before=structuredClone(f.rows('marketPriceObservation')[0]);
 const ignored=await f.serial(tx=>service.transition(tx,actor,created.id,'ignore',{...cmd(),reason:'暂不纳入'}));assert.equal(ignored.status,'IGNORED');
 await assert.rejects(f.serial(tx=>service.create(tx,actor,{...cmd(),...observation()})),code('RESIDUAL_DUPLICATE'));
 await assert.rejects(f.serial(tx=>service.transition(tx,actor,created.id,'restore',{...cmd(),reason:'过期'})),code('REVISION_CONFLICT'));
 const restored=await f.serial(tx=>service.transition(tx,actor,created.id,'restore',{...cmd(1),reason:'核对后恢复'}));assert.equal(restored.status,'ACTIVE');
 const voided=await f.serial(tx=>service.transition(tx,actor,created.id,'void',{...cmd(2),reason:'观察错误'}));assert.equal(voided.status,'VOIDED');
 await assert.rejects(f.serial(tx=>service.transition(tx,actor,created.id,'restore',{...cmd(3),reason:'不可复活'})),code('RESIDUAL_STATE'));
 const correction=await f.serial(tx=>service.create(tx,actor,{...cmd(),...observation({correctionOfId:created.id})}));assert.equal(correction.correctionOfId,created.id);
 for(const key of ['modelSnapshot','priceAmount','observedOn','sourceNote','dedupeKey'])assert.deepEqual(f.rows('marketPriceObservation')[0][key],before[key]);
});

test('model revision, correction state, forbidden fields, finite dimensions and current roles fail closed',async()=>{
 const f=fixture();await assert.rejects(f.serial(tx=>service.create(tx,actor,{...cmd(),...observation({modelRevision:1})})),code('REVISION_CONFLICT'));
 await assert.rejects(f.serial(tx=>service.create(tx,actor,{...cmd(),...observation({correctionOfId:'missing'})})),code('RESIDUAL_CORRECTION'));
 for(const change of [{priceAmount:0},{priceAmount:1.5},{modelYear:2020},{status:'ACTIVE'},{sourceUrl:'file:///private'},{batteryCapacityKwh:'NaN'},{batteryCapacityKwh:'100000'},{observedOn:'2026-02-30'}])assert.equal(observationCreateInput.safeParse({...cmd(),...observation(change)}).success,false);
 for(const field of ['modelDefinitionId','sourceListingId','sourceNote','province','city','trim','conditionGrade','correctionOfId'])assert.equal(observationCreateInput.safeParse({...cmd(),...observation({[field]:'text\u0000'})}).success,false,field+' rejects PostgreSQL NUL');
 const input={...cmd(),...observation()},saved=await f.serial(tx=>service.create(tx,actor,input));await assert.rejects(f.serial(tx=>service.create(tx,finance,{...cmd(),...observation()})),code('FORBIDDEN'));
 const read=await service.detail(f.tx,finance,saved.id);assert.equal(read.priceAmount,1234500);assert.deepEqual(read.files,[]);
 f.rows('adminUser')[0].active=false;await assert.rejects(f.serial(tx=>service.create(tx,actor,input)),code('STAFF_SESSION_CHANGED'));
});

test('list and detail are read-only whitelist projections and share the exact filtered count',async()=>{
 const f=fixture(),saved=await f.serial(tx=>service.create(tx,actor,{...cmd(),...observation()}));Object.assign(f.rows('marketPriceObservation')[0],{storagePath:'private',customer:{phone:'private'}});const before=f.writes.length;
 const listed=await service.list(f.tx,finance,{source:'MANUAL',modelDefinitionId:'model',status:'ACTIVE',observedFrom:'2026-10-01',observedTo:'2026-10-31'});assert.equal(listed.total,1);assert.equal(listed.items.length,1);assert.equal('storagePath'in listed.items[0],false);assert.equal('customer'in(await service.detail(f.tx,finance,saved.id)),false);assert.equal(f.writes.length,before);
});

test('only the real observation uniqueness race starts a fresh transaction for replay; unrelated P2002 is never swallowed',async()=>{
 let attempts=0;const db={serial:async(fn:any)=>{attempts++;if(attempts===1)throw Object.assign(new Error('same-key snapshot race'),{code:'P2002',meta:{modelName:'MarketPriceObservation',target:['dedupeKey']}});return fn({});}};
 assert.equal(await residualTransaction(db as any,async()=>({id:'original-result'})).then(row=>row.id),'original-result');assert.equal(attempts,2);
 for(const meta of [{modelName:'MarketPriceObservation',target:['unrelatedField']},{modelName:'OtherTable',target:['dedupeKey']}]){
  let calls=0;const error=Object.assign(new Error('infrastructure constraint'),{code:'P2002',meta});await assert.rejects(residualTransaction({serial:async()=>{calls++;throw error;}} as any,async()=>null),caught=>caught===error);assert.equal(calls,1);
 }
});
