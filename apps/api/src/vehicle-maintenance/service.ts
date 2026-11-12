import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {storedDate} from '../asset-costs/types';
import {workOrderCommand} from '../asset-work-orders/command';
import {date,workDay,trustedVehicleReading} from '../asset-work-orders/facts';
import {maintenanceCompletionInput,maintenancePatchInput,workId} from '../asset-work-orders/types';

export async function validateMaintenanceCompletion(tx:any,vehicle:any,raw:unknown,now:Date){
 const completion=maintenanceCompletionInput.parse(raw),current=await tx.vehicleMaintenanceSchedule.findUnique({where:{vehicleId:vehicle.id}});
 ensure((current?.revision??0)===completion.scheduleRevision,409,'REVISION_CONFLICT','保养提醒已变化，请核对后重新提交验收');
 ensure(completion.completedOn<=workDay(now)&&(!current?.lastCompletedOn||completion.completedOn>=date(current.lastCompletedOn)!),409,'MAINTENANCE_DATE','保养完成日期不能在未来或早于已确认完成事实');
 const trusted=await trustedVehicleReading(tx,vehicle,now);ensure(completion.mileageKm>=trusted.readingKm,409,'MILEAGE_REGRESSION','保养里程低于车辆已确认可信读数');
 return completion;
}
/** Caller already owns Vehicle -> WorkOrder; only an accepted maintenance may call this. */
export async function completeMaintenance(tx:any,actor:StaffActor,workOrder:any,vehicle:any,raw:unknown,now:Date){
 await tx.$queryRaw`SELECT "vehicleId" FROM "VehicleMaintenanceSchedule" WHERE "vehicleId"=${vehicle.id} FOR UPDATE`;
 const completion=await validateMaintenanceCompletion(tx,vehicle,raw,now),current=await tx.vehicleMaintenanceSchedule.findUnique({where:{vehicleId:vehicle.id}});
 const data={sourceWorkOrderId:workOrder.id,lastCompletedOn:storedDate(completion.completedOn),lastMileageKm:completion.mileageKm,nextDueDate:completion.nextDueDate===null?null:storedDate(completion.nextDueDate),nextDueMileageKm:completion.nextDueMileageKm,reason:completion.reason,updatedBy:actor.id,updatedAt:now};
 if(current){const updated=await tx.vehicleMaintenanceSchedule.updateMany({where:{vehicleId:vehicle.id,revision:completion.scheduleRevision},data:{...data,revision:{increment:1}}});ensure(updated.count===1,409,'REVISION_CONFLICT','保养提醒已变化');}
 else await tx.vehicleMaintenanceSchedule.create({data:{vehicleId:vehicle.id,revision:1,...data}});
 return{...completion,revision:completion.scheduleRevision+1};
}
export class MaintenanceService{
 constructor(private readonly now:()=>Date=()=>new Date()){}
 async detail(tx:any,actor:StaffActor,id:string){
  await requireCurrentStaff(tx,actor,'vehicle-maintenance',false);const vehicleId=workId.parse(id),vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');
  const row=await tx.vehicleMaintenanceSchedule.findUnique({where:{vehicleId}}),reading=await trustedVehicleReading(tx,vehicle,this.now()),nextDueDate=date(row?.nextDueDate),nextDueMileageKm=row?.nextDueMileageKm??null;
  return{vehicleId,vehicleRevision:vehicle.revision,vehicle:{id:vehicle.id,title:vehicle.title,vin:vehicle.vin??null,plateNumber:vehicle.plateNumber??null},registered:nextDueDate!==null||nextDueMileageKm!==null,revision:row?.revision??0,lastCompletedOn:date(row?.lastCompletedOn),lastMileageKm:row?.lastMileageKm??null,nextDueDate,nextDueMileageKm,dueByDate:nextDueDate!==null&&nextDueDate<=workDay(this.now()),dueByMileage:nextDueMileageKm!==null&&reading.readingKm>=nextDueMileageKm,readingKm:reading.readingKm,readingAsOf:reading.readingAsOf,sourceWorkOrderId:row?.sourceWorkOrderId??null,reason:row?.reason??'',updatedAt:row?.updatedAt??null};
 }
 async patch(tx:any,actor:StaffActor,id:string,body:unknown){
  const vehicleId=workId.parse(id),input=maintenancePatchInput.parse(body);
  return workOrderCommand(tx,actor,'vehicle-maintenance',vehicleId,'PATCH_MAINTENANCE',input,async()=>{
   await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;
   await tx.$queryRaw`SELECT "vehicleId" FROM "VehicleMaintenanceSchedule" WHERE "vehicleId"=${vehicleId} FOR UPDATE`;
   const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');const row=await tx.vehicleMaintenanceSchedule.findUnique({where:{vehicleId}});
   ensure(vehicle.revision===input.vehicleRevision&&(row?.revision??0)===input.revision,409,'REVISION_CONFLICT','车辆或保养提醒已变化');
   const now=this.now(),reading=await trustedVehicleReading(tx,vehicle,now);
   ensure(input.nextDueDate===null||input.nextDueDate>workDay(now)&&(!row?.lastCompletedOn||input.nextDueDate>date(row.lastCompletedOn)!),400,'MAINTENANCE_DATE','人工维护的下次日期须在未来且晚于上次保养');
   ensure(input.nextDueMileageKm===null||input.nextDueMileageKm>reading.readingKm,400,'MILEAGE_REGRESSION','下次里程阈值须高于可信读数');
   const data={nextDueDate:input.nextDueDate===null?null:storedDate(input.nextDueDate),nextDueMileageKm:input.nextDueMileageKm,reason:input.reason,updatedBy:actor.id,updatedAt:now};
   if(row){const changed=await tx.vehicleMaintenanceSchedule.updateMany({where:{vehicleId,revision:input.revision},data:{...data,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','保养提醒已变化');}
   else await tx.vehicleMaintenanceSchedule.create({data:{vehicleId,revision:1,sourceWorkOrderId:null,lastCompletedOn:null,lastMileageKm:null,...data}});
   await audit(tx,actor.id,'PATCH_MAINTENANCE','vehicle-maintenance',vehicleId,{before:row?{revision:row.revision,nextDueDate:date(row.nextDueDate),nextDueMileageKm:row.nextDueMileageKm}:null,after:{revision:input.revision+1,nextDueDate:input.nextDueDate,nextDueMileageKm:input.nextDueMileageKm},reason:input.reason});
   return this.detail(tx,actor,vehicleId);
  });
 }
}
