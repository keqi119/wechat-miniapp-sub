import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldServiceFixture} from './field-handover-service-fixture';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
const race=()=>Object.assign(new Error('unique batch race'),{code:'P2002',meta:{modelName:'FieldHandoverTask',target:['orderId','batchKey']}});
test('a future genuine swap reservation creates only the task without inventing actual time or changing order facts',async()=>{
 const f=fieldServiceFixture(),s=f.swap(),planned=new Date(Date.now()+7*86400000);s.quote.contract.status='SIGNED';s.quote.financePreparedAt=new Date();
 Object.assign(s.quote.snapshot,{plannedReturnAt:planned.toISOString(),plannedDeliveryAt:planned.toISOString(),periods:[{refundAmount:0}],affectedSequence:1,depositRefundAmount:0,depositAmount:0});
 f.tx.serviceObligation={findMany:async()=>[{sequence:1,startDate:new Date('2026-10-01'),endDate:new Date('2026-11-01'),dueDate:new Date('2026-10-01'),amount:10000,allocations:[{amount:10000}],chargeAmount:0}]};f.tx.refund={findMany:async()=>[]};f.tx.bill={findMany:async()=>[]};
 const before=JSON.stringify({order:f.order,assignments:f.data.vehicleAssignment,handovers:f.data.handover,quote:s.quote});
 const task=await f.service.create({orderId:'order',type:'SWAP_RETURN',changeId:s.change.id,assigneeId:'field'},f.manager);
 assert.equal(task.batchKey,'CHANGE:change:RETURN');assert.equal(task.quoteId,s.quote.id);assert.equal(task.draft.actualAt,'');assert.equal(task.draft.readingKm,null);assert.equal(f.data.fieldHandoverTask.length,1);
 assert.equal(JSON.stringify({order:f.order,assignments:f.data.vehicleAssignment,handovers:f.data.handover,quote:s.quote}),before);assert.equal(f.calls.includes('write:order'),false);assert.equal(f.calls.includes('write:handover'),false);
});
test('only the exact task-batch unique race restarts the whole command and resolves to the real existing batch',async()=>{
 const f=fieldServiceFixture();let attempts=0;f.db.serial=async(fn:any)=>{attempts++;if(attempts===1){f.task();throw race();}return fn(f.tx);};
 await assert.rejects(f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},f.manager),code('TASK_EXISTS'));assert.equal(attempts,2);assert.equal(f.data.fieldHandoverTask.length,1);
});
test('batch-race retry rechecks the actual current session before accessing the existing task',async()=>{
 const f=fieldServiceFixture(),actor={...f.manager};let attempts=0;f.db.serial=async(fn:any)=>{attempts++;if(attempts===1){f.manager.authVersion++;throw race();}return fn(f.tx);};
 await assert.rejects(f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},actor),code('STAFF_SESSION_CHANGED'));assert.equal(attempts,2);assert.equal(f.calls.some(s=>s.startsWith('write:')),false);
});
test('unrelated unique constraints and unknown database failures are never retried or relabeled',async()=>{
 for(const e of [Object.assign(new Error('different field unique'),{code:'P2002',meta:{modelName:'FieldHandoverTask',target:['id']}}),Object.assign(new Error('another model'),{code:'P2002',meta:{modelName:'Other',target:['orderId','batchKey']}}),Object.assign(new Error('unknown'),{code:'P1001'})]){const f=fieldServiceFixture();let attempts=0;f.db.serial=async()=>{attempts++;throw e;};await assert.rejects(f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},f.manager),error=>error===e);assert.equal(attempts,1);}
});
test('the exact race has one bounded whole-transaction retry and still preserves an unresolvable error',async()=>{
 const f=fieldServiceFixture(),e=race();let attempts=0;f.db.serial=async()=>{attempts++;throw e;};await assert.rejects(f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},f.manager),error=>error===e);assert.equal(attempts,2);
});
test('a re-quoted swap restarts the same batch only after old facts were superseded and clears its old material generation',async()=>{
 const f=fieldServiceFixture(),s=f.swap(),planned=new Date(Date.now()+7*86400000);s.quote.contract.status='SIGNED';s.quote.financePreparedAt=new Date();Object.assign(s.quote.snapshot,{plannedReturnAt:planned.toISOString(),plannedDeliveryAt:planned.toISOString(),periods:[{refundAmount:0}],affectedSequence:1,depositRefundAmount:0,depositAmount:0});
 f.tx.serviceObligation={findMany:async()=>[{sequence:1,startDate:new Date('2026-10-01'),endDate:new Date('2026-11-01'),dueDate:new Date('2026-10-01'),amount:10000,allocations:[{amount:10000}],chargeAmount:0}]};f.tx.refund={findMany:async()=>[]};f.tx.bill={findMany:async()=>[]};
 const t=f.task({type:'SWAP_RETURN',batchKey:'CHANGE:change:RETURN',changeId:s.change.id,quoteId:'earlier-quote',vehicleAssignmentId:'assignment',currentHandoverId:'old-return',materialGeneration:2,draft:{fileIds:['old-file']},lastPublishKey:'previous-success',lastPublishVersion:0});
 const h={id:'old-return',orderId:'order',customerId:'customer',vehicleId:'car',assignmentId:'assignment',changeId:s.change.id,type:'SWAP_RETURN',status:'PUBLISHED',fieldTaskId:t.id};f.data.handover.push(h);
 await assert.rejects(f.service.restart(t.id,{version:0,assigneeId:'field',note:'重新核对新报价',reset:true},f.manager),code('PUBLISHED_TASK'));
 h.status='SUPERSEDED';const prior=JSON.stringify(h),r=await f.service.restart(t.id,{version:0,assigneeId:'field',note:'重新核对新报价',reset:true},f.manager);
 assert.equal(r.id,t.id);assert.equal(r.batchKey,'CHANGE:change:RETURN');assert.equal(r.quoteId,s.quote.id);assert.equal(t.materialGeneration,3);assert.deepEqual(r.draft.fileIds,[]);assert.equal(t.lastPublishKey,null);assert.equal(t.currentHandoverId,null);assert.equal(JSON.stringify(h),prior);assert.equal(f.data.fieldHandoverTask.length,1);
});
