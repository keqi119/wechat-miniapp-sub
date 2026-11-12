import {ensure} from '../common/errors';
import {readServiceStage} from '../order-service-stages/readiness';
import {stageDay} from '../order-service-stages/source';
import {readPreparedRenewalSource} from './source';

/** Null means a later applied swap remains the current vehicle authority. No GET creates stage facts. */
export async function readCurrentRenewalVehicleSource(tx:any,order:any,terms:any){
 const id=terms?.snapshot?.serviceStageId;if(id==null)return null;
 ensure(typeof id==='string'&&id.length>0,409,'CURRENT_VEHICLE_SOURCE_INVALID','当前车辆的续期来源缺失');
 const stage=await readServiceStage(tx,order,id);
 ensure(stage.snapshot.kind==='RENEWAL'&&stage.stage.status==='ACTIVE',409,'CURRENT_VEHICLE_SOURCE_INVALID','当前车辆不属于已生效续期');
 if(stage.stage.termsVersionId!==terms.id)return null;
 const source=await readPreparedRenewalSource(tx,id),{assignment,snapshot,vehicle}=source;
 const startsAt=new Date(snapshot.period.startDate+'T00:00:00+08:00').getTime();
 ensure(new Date(terms.effectiveAt).getTime()===startsAt&&new Date(stage.stage.activatedAt).getTime()>=startsAt,409,'CURRENT_VEHICLE_SOURCE_INVALID','续期有效条款须从已确认起租日生效');
 ensure(['OFFLINE','ELECTRONIC'].includes(order.contractMode)&&source.agreement.mode===order.contractMode&&terms.id===order.effectiveTermsVersionId&&terms.orderId===order.id&&terms.quoteId===source.quote.id&&terms.offlineArchiveVersionId===source.agreement.archiveVersionId&&source.change.status==='APPLIED',409,'CURRENT_VEHICLE_SOURCE_INVALID','当前有效条款与续期纸档不一致');
 ensure(order.currentAssignmentId===assignment.id&&assignment.status==='ACTIVE'&&!assignment.endAt&&!assignment.returnHandoverId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===order.vehicleId&&vehicle.id===order.vehicleId&&vehicle.status==='IN_USE'&&vehicle.reservedOrderId===order.id,409,'CURRENT_VEHICLE_SOURCE_INVALID','续期的真实在用车辆或分配已变化');
 return{product:snapshot.termsSnapshot.currentVehicleProductSnapshot,range:{startDate:snapshot.period.startDate,endDate:stageDay(new Date(new Date(snapshot.period.endDate+'T00:00:00Z').getTime()-86400000))},assignment,quote:source.quote};
}
