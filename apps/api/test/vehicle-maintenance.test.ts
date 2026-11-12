import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkOrdersService} from '../src/asset-work-orders/service';
import {MaintenanceService} from '../src/vehicle-maintenance/service';
import {workOrderFixture,woActor,woFinance,woNow,woCommand,woError,woInput} from './work-orders-fixture';
test('manual reminder thresholds do not invent completion or overwrite mileage, current permission and two revisions protect updates',async()=>{
 const f=workOrderFixture(),service=new MaintenanceService(()=>woNow),initial=await service.detail(f.tx,woActor,'vehicle');assert.equal(initial.registered,false);assert.equal(initial.lastCompletedOn,null);
 const body={...woCommand(),vehicleRevision:3,nextDueDate:'2026-12-01',nextDueMileageKm:500,reason:'明确未来提醒'};
 const row=await f.serial(tx=>service.patch(tx,woActor,'vehicle',body));assert.equal(row.registered,true);assert.equal(row.lastCompletedOn,null);assert.equal(f.rows('vehicle')[0].mileageKm,100);const count=f.writes.length;assert.deepEqual(await f.serial(tx=>service.patch(tx,woActor,'vehicle',body)),row);assert.equal(f.writes.length,count);
 await assert.rejects(service.detail(f.tx,woFinance,'vehicle'),woError('FORBIDDEN'));await assert.rejects(f.serial(tx=>service.patch(tx,woActor,'vehicle',{...woCommand(),vehicleRevision:3,nextDueDate:null,nextDueMileageKm:null,reason:'旧版本'})),woError('REVISION_CONFLICT'));
 const cleared=await f.serial(tx=>service.patch(tx,woActor,'vehicle',{...woCommand(row.revision),vehicleRevision:3,nextDueDate:null,nextDueMileageKm:null,reason:'取消未来提醒'}));assert.equal(cleared.registered,false);assert.equal(cleared.lastCompletedOn,null);
});
test('maintenance submission freezes a candidate; only acceptance updates schedule and stale candidate cannot overwrite a newer rule',async()=>{
 const f=workOrderFixture(),service=new WorkOrdersService(()=>woNow),maintenance=new MaintenanceService(()=>woNow);let row=await f.serial(tx=>service.create(tx,woActor,woInput({kind:'MAINTENANCE',costConfirmationRequired:false,noCostReason:'保修内'})));
 row=await f.serial(tx=>service.action(tx,woActor,row.id,'start',{...woCommand(row.revision),reason:'开始保养'}));const file=f.attach(row.id),completion={completedOn:'2026-10-30',mileageKm:200,nextDueDate:'2027-04-30',nextDueMileageKm:10000,scheduleRevision:0,reason:'明确保养计划'};
 await assert.rejects(f.serial(tx=>service.action(tx,woActor,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'保养完成',fileIds:[file],maintenance:{...completion,mileageKm:99}})),woError('MILEAGE_REGRESSION'));
 row=await f.serial(tx=>service.action(tx,woActor,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'保养完成',fileIds:[file],maintenance:completion}));assert.equal(f.rows('vehicleMaintenanceSchedule').length,0);
 await f.serial(tx=>maintenance.patch(tx,woActor,'vehicle',{...woCommand(),vehicleRevision:3,nextDueDate:'2027-05-01',nextDueMileageKm:null,reason:'同期人工调整'}));
 await assert.rejects(f.serial(tx=>service.action(tx,woActor,row.id,'accept',{...woCommand(row.revision),reason:'旧候选',fileIds:[file]})),woError('REVISION_CONFLICT'));assert.equal(f.rows('assetWorkOrder').find(w=>w.id===row.id).status,'PENDING_ACCEPTANCE');
 row=await f.serial(tx=>service.action(tx,woActor,row.id,'return-for-work',{...woCommand(row.revision),reason:'重新核对提醒'}));row=await f.serial(tx=>service.action(tx,woActor,row.id,'submit-acceptance',{...woCommand(row.revision),solution:'保养完成复核',fileIds:[file],maintenance:{...completion,scheduleRevision:1}}));row=await f.serial(tx=>service.action(tx,woActor,row.id,'accept',{...woCommand(row.revision),reason:'核对完成',fileIds:[file]}));
 const schedule=await maintenance.detail(f.tx,woActor,'vehicle');assert.equal(schedule.lastCompletedOn,'2026-10-30');assert.equal(schedule.lastMileageKm,200);assert.equal(schedule.sourceWorkOrderId,row.id);assert.equal(f.rows('vehicle')[0].mileageKm,100);assert.equal(f.rows('mileage').length,0);
});
test('approved assignment mileage constrains maintenance without using another vehicle or pending customer readings',async()=>{
 const f=workOrderFixture(),service=new MaintenanceService(()=>woNow);f.seed('vehicleAssignment',{id:'assigned',vehicleId:'vehicle',orderId:'order',customerId:'customer'});
 f.seed('mileage',{id:'valid',assignmentId:'assigned',orderId:'order',customerId:'customer',status:'APPROVED',recordedAt:new Date('2026-10-30'),readingKm:500});f.seed('mileage',{id:'pending',assignmentId:'assigned',orderId:'order',customerId:'customer',status:'SUBMITTED',recordedAt:new Date('2026-10-30'),readingKm:9999});f.seed('mileage',{id:'other',assignmentId:'assigned',orderId:'other-order',customerId:'customer',status:'APPROVED',recordedAt:new Date('2026-10-30'),readingKm:9999});
 assert.equal((await service.detail(f.tx,woActor,'vehicle')).readingKm,500);
 await assert.rejects(f.serial(tx=>service.patch(tx,woActor,'vehicle',{...woCommand(),vehicleRevision:3,nextDueDate:null,nextDueMileageKm:500,reason:'必须高于可信读数'})),woError('MILEAGE_REGRESSION'));
 assert.equal(f.rows('vehicleMaintenanceSchedule').length,0);assert.equal(f.rows('mileage').length,3);
});
