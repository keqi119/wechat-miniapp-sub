import {ensure} from '../common/errors';
import {day} from '../usage/rules';
export const boundaryAt=(date:Date)=>new Date(day(date)+'T00:00:00+08:00');
export function assignmentView(a:any){return a?{id:a.id,vehicle:{id:a.vehicleId,title:a.vehicle?.title||'',plateNumber:a.vehicle?.plateNumber??null,vin:a.vehicle?.vin??null},startAt:a.startAt,endAt:a.endAt,startReadingKm:a.startReadingKm,endReadingKm:a.endReadingKm,status:a.status}:null;}
// Bootstrap only from the recorded, completed physical handover; never infer an odometer.
export async function ensureAssignments(tx:any,order:any){
 const count=await tx.vehicleAssignment.count({where:{orderId:order.id}});if(count)return;await tx.order.update({where:{id:order.id},data:{revision:{increment:1}}});
 const delivery=await tx.handover.findFirst({where:{orderId:order.id,type:'DELIVERY',status:'COMPLETED',signatureStatus:'SIGNED'},orderBy:{createdAt:'asc'}});
 ensure(delivery?.actualAt,409,'ASSIGNMENT_EVIDENCE_REQUIRED','缺少已完成交车事实，须先核对原始交接证据');
 const returned=await tx.handover.findFirst({where:{orderId:order.id,type:'RETURN',status:'COMPLETED'}});
 const a=await tx.vehicleAssignment.create({data:{orderId:order.id,vehicleId:order.vehicleId,customerId:order.customerId,deliveryHandoverId:delivery.id,startAt:delivery.actualAt,startReadingKm:delivery.readingKm,...(returned?{returnHandoverId:returned.id,endAt:returned.actualAt,endReadingKm:returned.readingKm,status:'CLOSED'}:{})}});
 await tx.handover.update({where:{id:delivery.id},data:{vehicleId:a.vehicleId,assignmentId:a.id}});
 if(returned)await tx.handover.update({where:{id:returned.id},data:{vehicleId:a.vehicleId,assignmentId:a.id}});
 if(!returned)await tx.order.update({where:{id:order.id},data:{currentAssignmentId:a.id}});
 await openSegments(tx,a,true);
}
export async function openSegments(tx:any,a:any,legacy=false){
 const periods=await tx.usagePeriod.findMany({where:{orderId:a.orderId,status:{not:'CANCELLED'}},orderBy:{sequence:'asc'}});
 for(let i=0;i<periods.length;i++){const p=periods[i],start=boundaryAt(p.startDate),end=boundaryAt(p.effectiveEndDate);if(end<=a.startAt||(a.endAt&&start>a.endAt))continue;
 const startsHere=a.startAt>=start,endsHere=a.endAt&&a.endAt<=end;
 await tx.usageSegment.upsert({where:{periodId_assignmentId:{periodId:p.id,assignmentId:a.id}},create:{periodId:p.id,assignmentId:a.id,vehicleId:a.vehicleId,startAt:startsHere?a.startAt:start,endAt:endsHere?a.endAt:null,startReadingKm:startsHere?a.startReadingKm:legacy?p.startReadingKm:null,endReadingKm:endsHere?a.endReadingKm:legacy?p.endReadingKm:null,readingId:legacy?p.readingId:null,endHandoverId:endsHere?a.returnHandoverId:null,status:p.status==='SETTLED'?'FROZEN':endsHere||legacy&&p.status==='READY'?'READY':legacy&&p.status==='REVIEW_PENDING'?'REVIEW_PENDING':'OPEN'},update:{}});
 }
}
export async function currentAssignment(tx:any,order:any){return order.currentAssignmentId?tx.vehicleAssignment.findFirst({where:{id:order.currentAssignmentId,orderId:order.id,status:'ACTIVE'},include:{vehicle:true}}):null;}
export async function availableVehicle(tx:any,id:string){const v=await tx.vehicle.findUnique({where:{id}});ensure(v?.status==='PUBLISHED'&&!v.reservedOrderId&&!v.holdId,409,'VEHICLE_UNAVAILABLE','车辆已有占用或换车预留');return v;}
