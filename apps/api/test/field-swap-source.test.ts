import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSwapFieldTask} from '../src/vehicle-changes/field-handover-source';
function fixture(side='RETURN'){
 const actor={id:'field',role:'FIELD',authVersion:3},change={id:'change',orderId:'order',customerId:'customer',activeQuoteId:'quote'},quote={id:'quote',changeId:'change',snapshot:{originalAssignmentId:'assignment'}},facts={orderId:'order',customerId:'customer',changeId:'change',type:'SWAP_'+side,vehicleId:side==='RETURN'?'old-car':'new-car',assignmentId:side==='RETURN'?'assignment':null,fileIds:['proof']};
 const task:any={id:'task',orderId:'order',type:facts.type,changeId:'change',quoteId:'quote',batchKey:'CHANGE:change:'+side,termsVersionId:null,vehicleId:facts.vehicleId,vehicleAssignmentId:facts.assignmentId,status:'ASSIGNED',assigneeId:actor.id,currentHandoverId:null,materialGeneration:4};let fileCount=1;
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({...actor,active:true})},fieldHandoverTask:{findUnique:async()=>task},storedFile:{count:async({where}:any)=>{assert.equal(where.fieldTaskId,'task');assert.equal(where.fieldTaskGeneration,4);return fileCount;}}};
 return{tx,actor,change,quote,facts,task,context:{taskId:'task',quoteId:'quote'},expireFiles:()=>{fileCount=0;}};
}
test('swap source binds exact task, quote, side and current file generation without changing task state',async()=>{
 for(const side of ['RETURN','DELIVERY']){const f=fixture(side),before=JSON.stringify(f.task);assert.deepEqual(await bindSwapFieldTask(f.tx,f.context,f.change,f.quote,f.facts,f.actor),{fieldTaskId:'task'});assert.equal(JSON.stringify(f.task),before);}
});
test('revoked field session and changed task or quote cannot publish old materials',async()=>{
 for(const mutate of [(f:any)=>f.tx.adminUser.findUnique=async()=>({...f.actor,active:false}),(f:any)=>f.tx.adminUser.findUnique=async()=>({...f.actor,active:true,authVersion:4}),(f:any)=>f.task.assigneeId='other',(f:any)=>f.task.status='COMPLETED',(f:any)=>f.task.quoteId='old-quote',(f:any)=>f.change.activeQuoteId='new-quote',(f:any)=>f.task.vehicleId='wrong-car',(f:any)=>f.task.batchKey='CHANGE:other:RETURN',(f:any)=>f.task.currentHandoverId='existing',(f:any)=>f.task.termsVersionId='unexpected',(f:any)=>f.context.quoteId='wrong']){
  const f=fixture();mutate(f);await assert.rejects(bindSwapFieldTask(f.tx,f.context,f.change,f.quote,f.facts,f.actor),(e:any)=>[403,409].includes(e.getStatus?.()));
 }
});
test('swap source rejects previous-generation or unrelated files and a fabricated incoming assignment',async()=>{
 const f=fixture();f.expireFiles();await assert.rejects(bindSwapFieldTask(f.tx,f.context,f.change,f.quote,f.facts,f.actor),(e:any)=>e.getResponse?.().error.code==='FILE_OWNERSHIP');
 const incoming=fixture('DELIVERY');incoming.task.vehicleAssignmentId='fabricated';await assert.rejects(bindSwapFieldTask(incoming.tx,incoming.context,incoming.change,incoming.quote,incoming.facts,incoming.actor),(e:any)=>e.getResponse?.().error.code==='FIELD_SWAP_SOURCE_CHANGED');
});
