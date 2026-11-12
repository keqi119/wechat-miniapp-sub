import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handoverCommand} from '../src/offline-documents/handover-command';
test('offline handover commands reject missing or stale material revisions before changing facts',async()=>{
 const actor={id:'ops',role:'OPERATIONS'},order={id:'order',contractMode:'OFFLINE',revision:4},item={id:'handover',orderId:'order',executionMode:'OFFLINE',revision:2};let writes=0;
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},order:{findUnique:async()=>order},handover:{findUnique:async()=>item},archiveCommand:{findUnique:async()=>null,create:async()=>{}}};const change=async()=>{writes++;return{};};
 await assert.rejects(handoverCommand(tx,actor,item.id,'PUBLISH',{},change));
 await assert.rejects(handoverCommand(tx,actor,item.id,'PUBLISH',{revision:1,idempotencyKey:'handover-stale'},change),(e:any)=>e.getResponse?.().error?.code==='REVISION_CONFLICT');assert.equal(writes,0);
 await handoverCommand(tx,actor,item.id,'PUBLISH',{revision:2,idempotencyKey:'handover-current'},change);assert.equal(writes,1);
 await assert.rejects(handoverCommand(tx,actor,order.id,'CREATE_DELIVERY',{revision:3,idempotencyKey:'handover-old-order'},change,true),(e:any)=>e.getResponse?.().error?.code==='REVISION_CONFLICT');assert.equal(writes,1);
});
