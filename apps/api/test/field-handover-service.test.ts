import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FieldHandoverController} from '../src/field-handover/controller';
import {fieldServiceFixture} from './field-handover-service-fixture';
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
test('service derives every required task source and locks Order before writing the task',async()=>{
 const f=fieldServiceFixture(),r=await f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},f.manager as any);
 assert.equal(r.batchKey,'DELIVERY:INITIAL');assert.equal(r.quoteId,null);assert.equal(r.termsVersionId,null);assert.equal(r.changeId,null);
 const row=f.data.fieldHandoverTask[0];assert.equal(row.batchKey,r.batchKey);assert.ok(f.calls.findIndex(s=>s.startsWith('lock:')&&s.includes('Order'))<f.calls.indexOf('write:fieldHandoverTask'));
 assert.throws(()=>f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field',batchKey:'forged'},f.manager as any));assert.equal(f.data.fieldHandoverTask.length,1);
 await assert.rejects(f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},f.manager as any),code('TASK_EXISTS'));assert.equal(f.data.fieldHandoverTask.length,1);
});
test('revoked authVersion rejects even a successful publish key before task reads or writes',async()=>{
 const f=fieldServiceFixture(),t=f.task({lastPublishKey:'replayed-success',lastPublishVersion:0});f.field.authVersion=1;
 await assert.rejects(f.service.publish(t.id,{version:0,idempotencyKey:'replayed-success',checked:true},{...f.field,authVersion:0} as any),code('STAFF_SESSION_CHANGED'));
 assert.equal(f.calls.includes('read:fieldHandoverTask'),false);assert.equal(f.calls.some(s=>s.startsWith('write:')),false);
});
test('new terms make old materials read-only and require a distinct task batch after explicit cancellation',async()=>{
 const f=fieldServiceFixture(),t=f.task({draft:{fileIds:['old-file']}});f.order.effectiveTermsVersionId='terms';f.data.orderTermsVersion.push({id:'terms',orderId:'order',version:1,snapshot:{commercialTerms:{vehicleIdentification:'真实延期车辆'}}});
 const d=await f.service.detail(t.id,f.field as any,true as any);assert.equal(d.canEdit,false);assert.equal(d.contextChanged,true);
 await assert.rejects(f.service.save(t.id,{version:0,draft:{fileIds:[]}},f.field as any),code('VEHICLE_CONTEXT_CHANGED'));
 await assert.rejects(f.service.restart(t.id,{version:0,assigneeId:'field',note:'重新核对',reset:true},f.manager as any),code('FIELD_BATCH_CHANGED'));assert.deepEqual(t.draft,{fileIds:['old-file']});
 await f.service.manage(t.id,{version:0,note:'旧预约取消'},f.manager as any,true);
 const next=await f.service.create({orderId:'order',type:'DELIVERY',assigneeId:'field'},f.manager as any);assert.equal(next.batchKey,'DELIVERY:terms');assert.equal(next.termsVersionId,'terms');assert.notEqual(next.id,t.id);
});
test('COMPLETED tasks can never be restarted even if old vehicle no longer matches',async()=>{
 const f=fieldServiceFixture(),t=f.task({status:'COMPLETED',vehicleId:'old-car'}),before=JSON.stringify(t);
 await assert.rejects(f.service.restart(t.id,{version:0,assigneeId:'field',note:'不得覆盖历史',reset:true},f.manager as any),code('COMPLETED_TASK'));assert.equal(JSON.stringify(t),before);
});
test('unresolved legacy terms never rebind to current sources or become writable',async()=>{
 const f=fieldServiceFixture(),t=f.task({batchKey:'LEGACY:old',draft:{fileIds:['old']}});f.order.effectiveTermsVersionId='terms';f.data.orderTermsVersion.push({id:'terms',orderId:'order',version:1,snapshot:{}});
 assert.equal((await f.service.detail(t.id,f.manager as any)).canEdit,false);
 await assert.rejects(f.service.restart(t.id,{version:0,assigneeId:'field',note:'核对',reset:true},f.manager as any),code('FIELD_BATCH_LEGACY_REVIEW_REQUIRED'));assert.equal(t.batchKey,'LEGACY:old');assert.deepEqual(t.draft,{fileIds:['old']});
});
test('pending swap delivery uses target vehicle mileage and receipt side without final-return action',async()=>{
 const f=fieldServiceFixture();f.swap(true);const t=f.task({type:'SWAP_DELIVERY',batchKey:'CHANGE:change:DELIVERY',changeId:'change',quoteId:'quote',vehicleId:'target',vehicleAssignmentId:null});
 const d=await f.service.detail(t.id,f.manager as any);assert.equal(d.minReadingKm,50);assert.equal(d.contextChanged,false);assert.equal(d.canEdit,true);assert.equal(d.vehicleTitle,'目标车辆');assert.equal(d.canRecordPhysicalReceipt,false);assert.equal(d.vehicleAssignmentId,null);
});
test('changed swap quote blocks old draft and publish while retaining original source and files',async()=>{
 const f=fieldServiceFixture();const s=f.swap(),t=f.task({type:'SWAP_RETURN',batchKey:'CHANGE:change:RETURN',changeId:'change',quoteId:'old-quote',vehicleAssignmentId:'assignment',draft:{fileIds:['old']}});
 assert.equal((await f.service.detail(t.id,f.manager as any)).contextChanged,true);
 await assert.rejects(f.service.save(t.id,{version:0,draft:{fileIds:[]}},f.field as any),code('VEHICLE_CONTEXT_CHANGED'));
 await assert.rejects(f.service.publish(t.id,{version:0,idempotencyKey:'publish-stale-quote',checked:true},f.field as any),code('VEHICLE_CONTEXT_CHANGED'));assert.equal(t.quoteId,'old-quote');assert.deepEqual(t.draft,{fileIds:['old']});assert.equal(s.change.activeQuoteId,'quote');
});
test('OFFLINE swap assignment still hits the existing shared agreement guard',async()=>{
 const f=fieldServiceFixture();f.swap();f.order.contractMode='OFFLINE';
 await assert.rejects(f.service.create({orderId:'order',type:'SWAP_RETURN',changeId:'change',assigneeId:'field'},f.manager as any),code('SWAP_STATE'));assert.equal(f.data.fieldHandoverTask.length,0);
});
test('controller passes actual role and session version for admin and FIELD routes',()=>{
 const calls:any[]=[];const service=new Proxy({}, {get:(_,name)=> (...args:any[])=>calls.push({name,args})});const c=new FieldHandoverController(service as any),admin={id:'manager',role:'ADMIN',authVersion:3},field={id:'field',role:'FIELD',authVersion:4};
 (c as any).create({},{admin});(c as any).list({},{admin});(c as any).mine({},{admin:field});(c as any).one('task',{admin:field});(c as any).publish('task',{},{admin:field});
 assert.deepEqual(calls[0].args[1],admin);assert.deepEqual(calls[1].args[1],admin);assert.deepEqual(calls[2].args,[{},field,true]);assert.deepEqual(calls[3].args,['task',field,true]);assert.deepEqual(calls[4].args[2],field);
});
test('successful normal publish replays once, then a reassigned employee loses even that old key',async()=>{
 const f=fieldServiceFixture(),t=f.task(),file={id:'file',fieldTaskId:t.id,fieldTaskGeneration:0,name:'现场照片',mimeType:'image/png',size:1};f.data.storedFile.push(file);
 const saved=await f.service.save(t.id,{version:0,draft:{actualAt:new Date(Date.now()-1000).toISOString(),readingKm:100,batteryPercent:80,place:'现场',accessories:'无',condition:'完好',openItems:'无',resolutionPlan:'无',fileIds:[file.id]}},f.field);
 const input={version:saved.version,idempotencyKey:'publish-successful-batch',checked:true},published=await f.service.publish(t.id,input,f.field),before=JSON.stringify(f.data);
 const replay=await f.service.publish(t.id,input,f.field);assert.equal(replay.handover?.id,published.handover?.id);assert.equal(JSON.stringify(f.data),before);assert.equal(f.data.notification.length,1);
 const next={id:'second',role:'FIELD',authVersion:0,active:true,name:'另一现场员工'};f.data.adminUser.push(next);await f.service.manage(t.id,{version:t.version,assigneeId:next.id,note:'正式改派'},f.manager);
 await assert.rejects(f.service.publish(t.id,input,f.field),code('NOT_FOUND'));assert.equal(f.data.handover.length,1);
});
test('explicit cancelled-task restart preserves its old audit facts and invalidates prior file generation',async()=>{
 const f=fieldServiceFixture(),t=f.task({status:'CANCELLED',draft:{fileIds:['old']},materialGeneration:3}),before={...t};
 f.data.storedFile.push({id:'old',fieldTaskId:t.id,fieldTaskGeneration:3,purpose:'handover'});
 const r=await f.service.restart(t.id,{version:0,assigneeId:f.field.id,note:'重新采集',reset:true},f.manager);assert.equal(r.status,'ASSIGNED');assert.deepEqual(r.draft.fileIds,[]);assert.equal(t.materialGeneration,4);assert.equal(t.batchKey,before.batchKey);
 const log=f.data.auditLog.find((a:any)=>a.action==='RESTART');assert.deepEqual(log.data.previousDraft,{fileIds:['old']});assert.equal(log.data.previousGeneration,3);
 await assert.rejects(f.service.readFile(t.id,'old',f.field,{}),code('NOT_FOUND'));await assert.rejects(f.service.save(t.id,{version:t.version,draft:{fileIds:['old']}},f.field),code('FILE_OWNERSHIP'));
});
test('SWAP_RETURN reads RETURN_RECEIPT but cannot record a final physical receipt',async()=>{
 const f=fieldServiceFixture(),s=f.swap(),t=f.task({type:'SWAP_RETURN',batchKey:'CHANGE:change:RETURN',changeId:s.change.id,quoteId:s.quote.id,vehicleAssignmentId:'assignment'});
 const h={id:'pending-return',orderId:'order',customerId:'customer',vehicleId:'car',assignmentId:'assignment',changeId:s.change.id,type:'SWAP_RETURN',status:'OBJECTION_SUBMITTED',executionMode:'OFFLINE',actualAt:new Date(),readingKm:150,fieldTaskId:t.id};f.data.handover.push(h);s.change.returnHandoverId=h.id;t.currentHandoverId=h.id;f.order.contractMode='OFFLINE';
 let where:any;f.tx.documentArchive.findFirst=async(args:any)=>{where=args.where;return null;};let receipts=0;f.tx.vehicleReceiptEvent.findFirst=async()=>{receipts++;return null;};
 const result=await f.service.detail(t.id,f.manager);assert.equal(where.kind,'RETURN_RECEIPT');assert.equal(result.canEdit,true);assert.equal(result.canRecordPhysicalReceipt,false);assert.equal(receipts,0);
});
test('a task cannot expose or revise another customer or task handover through a forged current pointer',async()=>{
 for(const patch of [{customerId:'foreign'},{fieldTaskId:'another-task'},{vehicleId:'another-car'}]){
  const f=fieldServiceFixture(),t=f.task({currentHandoverId:'foreign-handover'});f.data.handover.push({id:'foreign-handover',orderId:'order',customerId:'customer',vehicleId:'car',assignmentId:null,changeId:null,type:'DELIVERY',status:'OBJECTION_SUBMITTED',fieldTaskId:t.id,...patch});
  await assert.rejects(f.service.detail(t.id,f.field,true),code('FIELD_TASK_FACTS_MISMATCH'));
  await assert.rejects(f.service.save(t.id,{version:0,draft:{}},f.field),code('FIELD_TASK_FACTS_MISMATCH'));assert.equal(f.calls.some(s=>s.startsWith('write:')),false);
 }
});

test('FIELD DTO only returns assigned staff identity fields even if source rows contain internal account data',async()=>{const f=fieldServiceFixture();const task=f.task();Object.assign(f.field,{account:'PRIVATE_ACCOUNT',riskSnapshot:'PRIVATE_RISK',revenueRuleSnapshot:'PRIVATE_REVENUE'});const v=await f.service.detail(task.id,f.field,true);assert.doesNotMatch(JSON.stringify(v),/PRIVATE_ACCOUNT|PRIVATE_RISK|PRIVATE_REVENUE/);assert.deepEqual(v.assignee,{id:f.field.id,name:f.field.name});});
