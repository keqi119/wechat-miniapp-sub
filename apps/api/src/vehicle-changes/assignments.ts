import {requireOfflineHandoverReady} from '../offline-documents/handover';
import {assertRealVehicle} from '../virtual-acceptance/scope';
import {ensure} from '../common/errors';
import {day} from '../usage/rules';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
export const boundaryAt=(date:Date)=>new Date(day(date)+'T00:00:00+08:00');
export function assignmentView(a:any){return a?{id:a.id,vehicle:{id:a.vehicleId,title:a.vehicle?.title||'',plateNumber:a.vehicle?.plateNumber??null,vin:a.vehicle?.vin??null},startAt:a.startAt,endAt:a.endAt,startReadingKm:a.startReadingKm,endReadingKm:a.endReadingKm,status:a.status}:null;}
// Bootstrap only from the recorded, completed physical handover; never infer an odometer.
export async function ensureAssignments(tx:any,order:any){
 const count=await tx.vehicleAssignment.count({where:{orderId:order.id}});if(count)return;await assertRealVehicle(tx,order.vehicleId);await tx.order.update({where:{id:order.id},data:{revision:{increment:1}}});
 const delivery=await tx.handover.findFirst({where:{orderId:order.id,type:'DELIVERY',status:'COMPLETED',...(order.contractMode==='ELECTRONIC'?{executionMode:'ELECTRONIC',confirmationMode:'ONLINE_RECORD'}:order.contractMode==='OFFLINE'?{executionMode:'OFFLINE'}:{signatureStatus:'SIGNED'})},orderBy:{createdAt:'asc'}});
 ensure(delivery?.actualAt,409,'ASSIGNMENT_EVIDENCE_REQUIRED','缺少已完成交车事实，须先核对原始交接证据');
 if(order.contractMode==='OFFLINE')await requireOfflineHandoverReady(tx,delivery,true);
 const returned=await tx.handover.findFirst({where:{orderId:order.id,type:'RETURN',status:'COMPLETED'}});
 const a=await tx.vehicleAssignment.create({data:{orderId:order.id,vehicleId:order.vehicleId,customerId:order.customerId,deliveryHandoverId:delivery.id,startAt:delivery.actualAt,startReadingKm:delivery.readingKm,...(returned?{returnHandoverId:returned.id,endAt:returned.actualAt,endReadingKm:returned.readingKm,status:'CLOSED'}:{})}});
 await tx.handover.update({where:{id:delivery.id},data:{vehicleId:a.vehicleId,assignmentId:a.id}});
 if(returned)await tx.handover.update({where:{id:returned.id},data:{vehicleId:a.vehicleId,assignmentId:a.id}});
 if(!returned)await tx.order.update({where:{id:order.id},data:{currentAssignmentId:a.id}});
 await openSegments(tx,a,true);
}
export async function openSegments(tx:any,a:any,legacy=false,scope?:{serviceStageId:string;swapSettlementId?:string}){
 let scoped:{}|{serviceStageId:string;accountId:string}={};
 if(scope!==undefined){
  ensure(scope&&typeof scope.serviceStageId==='string'&&scope.serviceStageId.length>0&&scope.serviceStageId.trim()===scope.serviceStageId&&!scope.serviceStageId.includes('\0')&&!legacy,409,'USAGE_STAGE_SCOPE','续期用量分段范围无效');
  const stage=await tx.orderServiceStage.findUnique({where:{id:scope.serviceStageId}}),account=await tx.usageAccount.findUnique({where:{orderId:a.orderId}});
  let actualSwap=false;
  if(scope.swapSettlementId){
   const source=await(await import('./fact-settlement')).requireSwapSettlement(tx,scope.swapSettlementId);
   const {order,change,q,h,serviceStageScope}=source;
   actualSwap=order.contractMode==='ELECTRONIC'&&order.id===a.orderId&&change.status==='SWAP_RETURNED'&&change.id===a.changeId&&serviceStageScope?.serviceStageId===stage?.id&&h.status==='CUSTOMER_CONFIRMED'&&h.id===a.deliveryHandoverId&&h.vehicleId===a.vehicleId&&q.snapshot.targetVehicleId===a.vehicleId&&h.actualAt.getTime()===a.startAt.getTime()&&h.readingKm===a.startReadingKm;
   ensure(actualSwap,409,'USAGE_STAGE_SCOPE','新车分段须来自本段真实03、事实结算及本人确认交付');
  }
  ensure(stage?.kind==='RENEWAL'&&stage.status==='ACTIVE'&&stage.orderId===a.orderId&&stage.customerId===a.customerId&&(actualSwap||stage.assignmentId===a.id&&stage.vehicleId===a.vehicleId)&&account?.orderId===a.orderId&&account.customerId===a.customerId,409,'USAGE_STAGE_SCOPE','用量分段须属于本单真实已生效租期及同车分配');
  scoped={serviceStageId:scope.serviceStageId,accountId:account.id};
 }
 const periods=await tx.usagePeriod.findMany({where:{orderId:a.orderId,...scoped,status:{not:'CANCELLED'}},orderBy:{sequence:'asc'}});
 for(let i=0;i<periods.length;i++){const p=periods[i],start=boundaryAt(p.startDate),end=boundaryAt(p.effectiveEndDate);if(end<=a.startAt||(a.endAt&&start>a.endAt))continue;
 const startsHere=a.startAt>=start,endsHere=a.endAt&&a.endAt<=end;
 await assertRealVehicle(tx,a.vehicleId);
 await tx.usageSegment.upsert({where:{periodId_assignmentId:{periodId:p.id,assignmentId:a.id}},create:{periodId:p.id,assignmentId:a.id,vehicleId:a.vehicleId,startAt:startsHere?a.startAt:start,endAt:endsHere?a.endAt:null,startReadingKm:startsHere?a.startReadingKm:legacy?p.startReadingKm:null,endReadingKm:endsHere?a.endReadingKm:legacy?p.endReadingKm:null,readingId:legacy?p.readingId:null,endHandoverId:endsHere?a.returnHandoverId:null,status:p.status==='SETTLED'?'FROZEN':endsHere||legacy&&p.status==='READY'?'READY':legacy&&p.status==='REVIEW_PENDING'?'REVIEW_PENDING':'OPEN'},update:{}});
 }
}
export async function currentAssignment(tx:any,order:any){return order.currentAssignmentId?tx.vehicleAssignment.findFirst({where:{id:order.currentAssignmentId,orderId:order.id,status:'ACTIVE'},include:{vehicle:true}}):null;}
export async function availableVehicle(tx:any,id:string){await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;await assertRealVehicle(tx,id);const v=await tx.vehicle.findUnique({where:{id}});ensure(v?.status==='PUBLISHED'&&!v.reservedOrderId&&!v.holdId,409,'VEHICLE_UNAVAILABLE','车辆已有占用或换车预留');await requireVehicleUnrestricted(tx,id,'ALLOCATION');return v;}
