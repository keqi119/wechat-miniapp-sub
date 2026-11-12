import {test} from 'node:test';
import assert from 'node:assert/strict';
import {vehicleCommand} from '../src/vehicles/commands';
const denied=(e:any)=>e.getResponse?.().error?.code==='PLATE_BINDING_REQUIRED';
test('ordinary vehicle plate changes are rejected even with guarded vehicle feature disabled',async()=>{
 const saved={mvp:process.env.MVP_V2_ENABLED,mode:process.env.NEW_ORDER_CONTRACT_MODE};process.env.MVP_V2_ENABLED='false';process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';
 try{let writes=0;const actor={id:'operator',role:'OPERATIONS',authVersion:1},tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},vehicle:{findUnique:async()=>({id:'car',revision:2,plateNumber:'沪A12345'})}};const write=async()=>{writes++;return{};};
 await assert.rejects(vehicleCommand(tx,actor,undefined,'CREATE',{plateNumber:'沪A12345'},write),denied);
 for(const plateNumber of ['沪B12345',null,''])await assert.rejects(vehicleCommand(tx,actor,'car','UPDATE',{plateNumber},write),denied);
 assert.equal(writes,0);await vehicleCommand(tx,actor,'car','UPDATE',{plateNumber:'沪A12345'},write);await vehicleCommand(tx,actor,'car','UPDATE',{title:'new title'},write);await vehicleCommand(tx,actor,undefined,'CREATE',{plateNumber:null},write);assert.equal(writes,3);
 }finally{for(const [key,value]of Object.entries({MVP_V2_ENABLED:saved.mvp,NEW_ORDER_CONTRACT_MODE:saved.mode}))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('a successful ordinary edit replays after dedicated binding changes the plate, while new edits cannot bypass binding',async()=>{
 const actor={id:'operator',role:'OPERATIONS',authVersion:1},row={id:'car',revision:2,plateNumber:'沪A12345'},saved=new Map<string,any>();let writes=0,active=true;
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active})},vehicle:{findUnique:async()=>({...row})},archiveCommand:{findUnique:async({where}:any)=>saved.get(where.actorId_resourceId_action_key.key),create:async({data}:any)=>saved.set(data.key,data)}};
 const input={revision:2,idempotencyKey:'ordinary-success-replay',plateNumber:'沪A12345',title:'新描述'},write=async()=>{writes++;row.revision++;return{...row,title:input.title};};
 const first=await vehicleCommand(tx,actor,'car','UPDATE',input,write);row.plateNumber='沪B12345';row.revision++;
 assert.deepEqual(await vehicleCommand(tx,actor,'car','UPDATE',input,write),first);assert.equal(writes,1);assert.equal(row.plateNumber,'沪B12345');
 await assert.rejects(vehicleCommand(tx,actor,'car','UPDATE',{...input,revision:row.revision,idempotencyKey:'ordinary-new-attempt'},write),denied);assert.equal(writes,1);
 active=false;await assert.rejects(vehicleCommand(tx,actor,'car','UPDATE',input,write),(e:any)=>e.getResponse?.().error?.code==='STAFF_SESSION_CHANGED');
});
