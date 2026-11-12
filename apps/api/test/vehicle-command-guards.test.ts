import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVin,vehicleCommand} from '../src/vehicles/commands';
test('VIN normalization accepts exactly one canonical 17-character identity',()=>{
 assert.equal(normalizeVin(' lndtest0000000001 '),'LNDTEST0000000001');
 for(const vin of ['', 'LNDTEST0000000000I','short'])assert.throws(()=>normalizeVin(vin));
});
test('stale vehicle metadata never overwrites a newer revision and command retry reuses original result',async()=>{
 const original=process.env.MVP_V2_ENABLED;process.env.MVP_V2_ENABLED='true';try{
  let writes=0,revision=2;const saved=new Map<string,any>(),actor={id:'op',role:'OPERATIONS',authVersion:0},tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},vehicle:{findUnique:async()=>({id:'car',revision})},archiveCommand:{findUnique:async({where}:any)=>saved.get(where.actorId_resourceId_action_key.key),create:async({data}:any)=>saved.set(data.key,data)}};
  const mutate=async()=>{writes++;revision++;return{revision};};
  await assert.rejects(vehicleCommand(tx,actor,'car','UPDATE',{revision:1,idempotencyKey:'vehicle-old-key'},mutate),(e:any)=>e.getResponse?.().error?.code==='REVISION_CONFLICT');assert.equal(writes,0);
  const input={revision:2,idempotencyKey:'vehicle-new-key'};assert.equal((await vehicleCommand(tx,actor,'car','UPDATE',input,mutate)).revision,3);assert.equal((await vehicleCommand(tx,actor,'car','UPDATE',input,mutate)).revision,3);assert.equal(writes,1);
 }finally{if(original===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=original;}
});
