import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldServiceFixture} from './field-handover-service-fixture';
// Narrow read/dispatch projection tests; real lifecycle receipt is covered by v31-return-custody-db.
test('electronic ordinary FIELD receipt capability remains available with customer objection',async()=>{
 const f=fieldServiceFixture();f.swap().change.kind='SUBSCRIPTION_EXTENSION';f.order.contractMode='ELECTRONIC';const t=f.task({type:'RETURN',batchKey:'FINAL_RETURN:assignment',vehicleAssignmentId:'assignment',currentHandoverId:'return'});f.data.handover.push({id:'return',orderId:'order',customerId:'customer',vehicleId:'car',assignmentId:'assignment',changeId:null,type:'RETURN',status:'OBJECTION_SUBMITTED',executionMode:'ELECTRONIC',confirmationMode:'ONLINE_RECORD',actualAt:new Date(),readingKm:150,fieldTaskId:t.id,revision:1,manifestHash:'a'.repeat(64)});const result=await f.service.detail(t.id,f.field,true);assert.equal(result.canRecordPhysicalReceipt,true);assert.equal(result.handover?.manifestHash,'a'.repeat(64));
});
test('electronic FIELD return task creation is not blocked by pending future renewal',async()=>{
 const f=fieldServiceFixture(),s=f.swap();f.order.contractMode='ELECTRONIC';s.change.kind='SUBSCRIPTION_EXTENSION';s.change.status='SCHEDULED';const result=await f.service.create({orderId:'order',type:'RETURN',assigneeId:f.field.id,note:'实际收车派发'},f.manager);assert.equal(result.type,'RETURN');assert.equal(result.vehicleAssignmentId,'assignment');assert.equal(s.change.status,'SCHEDULED');
});
