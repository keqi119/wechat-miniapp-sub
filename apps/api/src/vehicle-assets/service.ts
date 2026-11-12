import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {assetCommand} from '../asset-costs/command';
import {dateOnly,storedDate} from '../asset-costs/types';
import {mileageCorrectionInput,profilePatchInput} from './types';
import {normalizeBatteryCapacity} from '../residual-market/dimensions';

export const assetVehicleSelect={id:true,title:true,brand:true,model:true,vin:true,plateNumber:true,revision:true};
export function assetVehicleView(vehicle:any){return Object.fromEntries(['id','title','brand','model','vin','plateNumber'].map(field=>[field,vehicle[field]??null]));}
function inventoryFactsView(profile:any){
 return{engineNumber:profile?.engineNumber??null,bodyColor:profile?.bodyColor??null,initialMileageKm:profile?.initialMileageKm??null,purchaseAmount:profile?.purchaseAmount??null,purchaseDate:profile?.purchaseDate?dateOnly(profile.purchaseDate):null,nextInspectionDate:profile?.nextInspectionDate?dateOnly(profile.nextInspectionDate):null};
}
export class VehicleAssetsService{
 async correctMileage(tx:any,actor:StaffActor,vehicleId:string,raw:unknown){
  const input=mileageCorrectionInput.parse(raw),current=await requireCurrentStaff(tx,actor,'vehicle-assets');
  ensure(current.role==='ADMIN',403,'FORBIDDEN','仅当前管理员可更正库存里程');
  // Delivery and swap commands lock Order before Vehicle; keep that order even on replay.
  if(input.expectedReservedOrderId)await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${input.expectedReservedOrderId} FOR UPDATE`;
  return assetCommand(tx,actor,'vehicle-assets',vehicleId,'CORRECT_INVENTORY_MILEAGE',input,[vehicleId],[],async()=>{
   const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');
   ensure(vehicle.revision===input.vehicleRevision&&vehicle.mileageKm===input.previousMileageKm,409,'REVISION_CONFLICT','车辆版本或原里程已变化，请重新核对');
   ensure((vehicle.reservedOrderId??null)===input.expectedReservedOrderId&&!vehicle.holdId,409,'MILEAGE_CORRECTION_STATE','车辆占用或预留状态已变化');
   const orders=await tx.order.findMany({where:{vehicleId},select:{id:true,vehicleId:true,status:true,currentAssignmentId:true,confirmedMileageKm:true}}),reserved=orders.find((order:any)=>order.id===input.expectedReservedOrderId);
   if(input.expectedReservedOrderId)ensure(vehicle.status==='RESERVED'&&reserved?.vehicleId===vehicleId&&reserved.status===input.expectedOrderStatus&&reserved.status==='AWAITING_PAYMENT'&&!reserved.currentAssignmentId,409,'MILEAGE_CORRECTION_STATE','仅明确绑定且尚未交付的待支付订单允许更正库存里程');
   else ensure(['DRAFT','PUBLISHED','UNPUBLISHED'].includes(vehicle.status),409,'MILEAGE_CORRECTION_STATE','当前车辆不属于可维护库存');
   ensure(orders.every((order:any)=>order.id===input.expectedReservedOrderId||['CANCELLED','COMPLETED'].includes(order.status)&&!order.currentAssignmentId),409,'MILEAGE_CORRECTION_STATE','车辆存在其他有效订单或交付占用');
   ensure(!await tx.vehicleHold.count({where:{vehicleId,status:'HELD'}}),409,'MILEAGE_CORRECTION_STATE','车辆仍存在有效换车预留');
   const orderIds=orders.map((order:any)=>order.id),ownership={OR:[{vehicleId},{orderId:{in:orderIds}}]};
   ensure(!await tx.vehicleAssignment.count({where:ownership}),409,'MILEAGE_CORRECTION_FACTS','车辆或关联订单已有真实分配记录，不能通过库存命令改写里程');
   ensure(!await tx.handover.count({where:{AND:[ownership,{OR:[{type:{in:['DELIVERY','SWAP_DELIVERY']}},{status:'COMPLETED'},{completedAt:{not:null}}]}]}}),409,'MILEAGE_CORRECTION_FACTS','车辆已有交付或交接证据，须按业务里程流程处理');
   ensure(!await tx.mileage.count({where:{orderId:{in:orderIds},status:'APPROVED'}}),409,'MILEAGE_CORRECTION_FACTS','关联订单已有审核里程事实，不能通过库存命令修改');
   ensure(orders.every((order:any)=>input.mileageKm>=order.confirmedMileageKm),409,'MILEAGE_REGRESSION','更正读数不可低于关联订单已确认里程');
   const changed=await tx.vehicle.updateMany({where:{id:vehicleId,revision:input.vehicleRevision,mileageKm:input.previousMileageKm,status:vehicle.status,reservedOrderId:input.expectedReservedOrderId,holdId:null},data:{mileageKm:input.mileageKm,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','车辆资料已变化，请重新核对');
   const before={vehicleRevision:vehicle.revision,mileageKm:vehicle.mileageKm,status:vehicle.status,reservedOrderId:vehicle.reservedOrderId??null,holdId:vehicle.holdId??null},after={...before,vehicleRevision:vehicle.revision+1,mileageKm:input.mileageKm};
   await audit(tx,actor.id,'CORRECT_INVENTORY_MILEAGE','vehicle-assets',vehicleId,{before,after,reason:input.reason,sourceReference:input.sourceReference,reservation:{orderId:input.expectedReservedOrderId,orderStatus:input.expectedOrderStatus}});
   return{vehicleId,...after,previousMileageKm:before.mileageKm};
  });
 }
 async detail(tx:any,actor:StaffActor,vehicleId:string){
  const current=await requireCurrentStaff(tx,actor,'vehicle-assets',false),vehicle=await tx.vehicle.findUnique({where:{id:vehicleId},select:assetVehicleSelect});ensure(vehicle,404,'NOT_FOUND','车辆不存在');
  const profile=await tx.vehicleAssetProfile.findUnique({where:{vehicleId}});
  return{vehicleId,vehicle:assetVehicleView(vehicle),vehicleRevision:vehicle.revision,registered:!!profile,revision:profile?.revision??0,batteryOwnership:profile?.batteryOwnership??'UNKNOWN',batteryCapacityKwh:normalizeBatteryCapacity(profile?.batteryCapacityKwh?.toString()),firstRegistrationDate:profile?.firstRegistrationDate?dateOnly(profile.firstRegistrationDate):null,...inventoryFactsView(profile),...(current.role==='FINANCE'?{}:{registeredOwnerName:profile?.registeredOwnerName??null,purchaserName:profile?.purchaserName??null,notes:profile?.notes??''})};
 }
 async patch(tx:any,actor:StaffActor,vehicleId:string,raw:unknown){
  const input=profilePatchInput.parse(raw);
  return assetCommand(tx,actor,'vehicle-assets',vehicleId,'PATCH_ASSET_PROFILE',input,[vehicleId],[{table:'VehicleAssetProfile',id:vehicleId}],async()=>{
   const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId},select:assetVehicleSelect});ensure(vehicle,404,'NOT_FOUND','车辆不存在');
   const profile=await tx.vehicleAssetProfile.findUnique({where:{vehicleId}});
   ensure(vehicle.revision===input.vehicleRevision&&(profile?.revision??0)===input.revision,409,'REVISION_CONFLICT','车辆或资产资料已变化，请刷新核对');
   if(input.batteryOwnership!==undefined&&input.batteryOwnership!=='BAAS')ensure(!await tx.vehicleBaasContract.count({where:{vehicleId,status:'ACTIVE'}}),409,'ACTIVE_BAAS_CONTRACT','有效 BAAS 合同存在时不能改为非 BAAS 电池');
   const data:any={updatedBy:actor.id};
   if(Object.hasOwn(input,'batteryOwnership'))data.batteryOwnership=input.batteryOwnership;
   if(Object.hasOwn(input,'firstRegistrationDate'))data.firstRegistrationDate=input.firstRegistrationDate===null?null:storedDate(input.firstRegistrationDate!);
   if(Object.hasOwn(input,'batteryCapacityKwh'))data.batteryCapacityKwh=input.batteryCapacityKwh;
   if(Object.hasOwn(input,'registeredOwnerName'))data.registeredOwnerName=input.registeredOwnerName;
   if(Object.hasOwn(input,'notes'))data.notes=input.notes;
   for(const field of ['engineNumber','bodyColor','initialMileageKm','purchaseAmount','purchaserName'] as const)if(Object.hasOwn(input,field))data[field]=input[field];
   for(const field of ['purchaseDate','nextInspectionDate'] as const)if(Object.hasOwn(input,field))data[field]=input[field]===null?null:storedDate(input[field]!);
   if(profile){const changed=await tx.vehicleAssetProfile.updateMany({where:{vehicleId,revision:input.revision},data:{...data,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','资产资料已变化，请刷新');}
   else await tx.vehicleAssetProfile.create({data:{vehicleId,revision:1,batteryOwnership:'UNKNOWN',firstRegistrationDate:null,notes:'',createdBy:actor.id,...data}});
   const result=await this.detail(tx,actor,vehicleId);await audit(tx,actor.id,'PATCH_ASSET_PROFILE','vehicle-assets',vehicleId,{before:profile?{revision:profile.revision,batteryOwnership:profile.batteryOwnership,batteryCapacityKwh:normalizeBatteryCapacity(profile.batteryCapacityKwh?.toString()),firstRegistrationDate:profile.firstRegistrationDate?dateOnly(profile.firstRegistrationDate):null,registeredOwnerName:profile.registeredOwnerName??null,...inventoryFactsView(profile),purchaserName:profile.purchaserName??null,notes:profile.notes}:null,after:result});return result;
  });
 }
}
