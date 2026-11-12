import {ensure} from '../common/errors';
import {electronicSwapBusiness} from './electronic-agreement';
import {assertOfflineSwapHandoverSource} from './offline-physical-source';
import {currentSwapReceipt} from './swap-receipt';

/** Physical return never represents agreement to charges or delivery of a replacement. */
export async function guardElectronicSwapReturn(tx:any,h:any){
 const {order,change,q,s}=await electronicSwapBusiness(tx,h.changeId);
 ensure(h.type==='SWAP_RETURN'&&h.orderId===order.id&&h.customerId===order.customerId&&q.status==='CONFIRMED'&&q.confirmedAt&&['AWAITING_SIGNATURE','AWAITING_FINANCE','SWAP_RETURNED'].includes(change.status),409,'SWAP_STATE','须为本单当前已确认的换车归还');
 const assignment=await tx.vehicleAssignment.findUnique({where:{id:s.originalAssignmentId}}),receipt=await currentSwapReceipt(tx,change.id);
 ensure(assignment&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&h.assignmentId===assignment.id&&h.vehicleId===assignment.vehicleId&&(!change.returnHandoverId||!h.id||change.returnHandoverId===h.id),409,'SWAP_OWNERSHIP','旧车归还来源不一致');
 if(h.id)assertOfflineSwapHandoverSource(h,change,q);
 if(receipt){ensure(assignment.status==='CLOSED'&&assignment.returnHandoverId===receipt.handoverId&&!order.currentAssignmentId,409,'SWAP_RECEIPT_SOURCE_CHANGED','已收回车辆来源已变化');}
 else{
  const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:h.vehicleId}});
  ensure(assignment.status==='ACTIVE'&&order.currentAssignmentId===assignment.id&&order.vehicleId===h.vehicleId&&vehicle.status==='IN_USE'&&vehicle.reservedOrderId===order.id,409,'VEHICLE_OWNERSHIP','旧车不属于当前实际分配');
  if(h.actualAt){const readings=await tx.usageSegment.aggregate({where:{assignmentId:assignment.id},_max:{endReadingKm:true}});ensure(h.actualAt>=assignment.startAt&&h.actualAt<=new Date(Date.now()+300000)&&h.readingKm>=Math.max(assignment.startReadingKm,vehicle.mileageKm,readings._max.endReadingKm||0),409,'RECEIPT_DATE_INVALID','归还时间或里程与已核验事实冲突');}
 }
 return{order,change,q};
}
