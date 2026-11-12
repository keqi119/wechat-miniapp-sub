import {isOnlineHandover,requireOnlineConfirmation} from '../operations/online-handover';
import {electronicReturnPeriod} from '../usage/electronic-return-period';
import {HttpException} from '@nestjs/common';
import {assertUsagePolicyUnchanged} from '../usage/pricing';
import {shanghaiDay} from '../usage/rules';
import {requireReceiptMatchesHandover} from '../offline-documents/vehicle-receipt';
import {readDeliveryBusinessReady} from './business-gates';

/** Mirrors the read conditions of completion, without running its revision/usage writes. */
export async function readHandoverCompletion(tx:any,f:any,h:any){
 const blockers:{code:string;label:string}[]=[],add=(code:string,label:string)=>blockers.push({code,label});
 const inspect=(fn:()=>unknown)=>{try{fn();}catch(e){if(!(e instanceof HttpException))throw e;const r=(e.getResponse() as any).error;add(r.code,r.message);}};
 if(h.status==='COMPLETED')return{ready:true,blockers};
 if(isOnlineHandover(h)&&h.status==='CUSTOMER_CONFIRMED'){try{await requireOnlineConfirmation(tx,h);}catch(e){if(!(e instanceof HttpException))throw e;const r=(e.getResponse() as any).error;add(r.code,r.message);}}
 const {order,vehicle,snapshot,usage,now}=f,delivery=h.type==='DELIVERY';
 if(order.status!==(delivery?'AWAITING_HANDOVER':'ACTIVE'))add('HANDOVER_ORDER_STATE','当前订单阶段不允许完成本次交接');
 if(h.customerId!==order.customerId||h.executionMode!==order.contractMode)add('HANDOVER_OWNERSHIP','交接客户或执行方式与订单不一致');
 if(f.changes.length)add('ORDER_CHANGE_PENDING','订单变更尚未完成');
 if(vehicle?.reservedOrderId!==order.id||vehicle?.status!==(delivery?'RESERVED':'IN_USE'))add('VEHICLE_OWNERSHIP','车辆已不归属当前订单');
 if(h.readingKm<Math.max(order.confirmedMileageKm,vehicle?.mileageKm||0))add('MILEAGE_REGRESSION','交接里程低于已确认里程');
 if(f.archives.some((a:any)=>a.versions.some((v:any)=>v.feedback?.length)))add('ARCHIVE_FEEDBACK_OPEN','本单仍有未解决的合同或交接资料反馈');
 const actual=h.actualAt&&new Date(h.actualAt),validTime=actual&&actual<=new Date(now.getTime()+300000);
 if(!validTime)add(delivery?'HANDOVER_DATE_REQUIRED':'RETURN_DATE_REQUIRED','请核对真实交接时间，不可使用未来时间');
 if(delivery){
  if(order.contractMode!=='ELECTRONIC'&&actual&&shanghaiDay(actual)!==String(snapshot.startDate).slice(0,10))add('DELIVERY_DATE_AMENDMENT_REQUIRED','实际交车日与已确认起租日不一致');
  inspect(()=>assertUsagePolicyUnchanged(order.finalPlanSnapshot,snapshot));
  if(usage)add('USAGE_EXISTS','本单用量账户已存在，请核对交付记录');
  if(actual&&validTime){const gate=await readDeliveryBusinessReady(tx,order.id,actual);blockers.push(...gate.blockers.map(b=>({code:b.code,label:'实际交车日：'+b.label})));}
 }else{
  if(order.contractMode==='ELECTRONIC'&&!f.receipts[0])add('RETURN_CUSTODY_REQUIRED','请先在本版还车查验记录真实车辆接收');
  inspect(()=>requireReceiptMatchesHandover(f.receipts[0]||null,h));
  if(!usage)add('USAGE_NOT_ACTIVE','未建立本单用量账户');
  else if(usage.returnedOn||actual&&new Date(shanghaiDay(actual))<usage.startedOn)add('RETURN_DATE_REQUIRED','归还时间早于交车或本单已归还');
  if(await tx.vehicleAssignment.count({where:{orderId:order.id}})&&!order.currentAssignmentId)add('NO_CURRENT_VEHICLE','当前没有已交付车辆');
  const known=order.currentAssignmentId?await tx.usageSegment.aggregate({where:{assignmentId:order.currentAssignmentId},_max:{endReadingKm:true}}):await tx.usagePeriod.aggregate({where:{orderId:order.id},_max:{endReadingKm:true}});
  if(h.readingKm<(known._max.endReadingKm||0))add('RETURN_READING_CONFLICT','归还读数低于当前有效月读数');
  if(usage&&actual){
   const rows=await tx.usagePeriod.findMany({where:{accountId:usage.id},orderBy:{sequence:'asc'}}),at=new Date(shanghaiDay(actual));
   let selection:any=null;try{if(order.contractMode==='ELECTRONIC')selection=await electronicReturnPeriod(tx,order,rows,actual);}catch(e){if(!(e instanceof HttpException))throw e;const r=(e.getResponse() as any).error;add(r.code,r.message);}
   const last=selection?.last??rows.find((p:any)=>p.startDate<=at&&at<p.endDate)??rows.find((p:any)=>p.endDate.getTime()===at.getTime());
   if(!last)add('RETURN_OUTSIDE_TERM','超出约定订阅期，须先确认续期与费用');
   else if(last.status==='SETTLED'||(selection?.live??rows).some((p:any)=>p.sequence>last.sequence&&p.status!=='OPEN'))add('RETURN_PERIOD_CONFLICT','归还时间与已提交或结算月份冲突');
  }
  if(order.currentAssignmentId){
   const assignment=await tx.vehicleAssignment.findUnique({where:{id:order.currentAssignmentId}});
   if(!assignment||h.vehicleId!==assignment.vehicleId||h.assignmentId!==assignment.id)add('VEHICLE_OWNERSHIP','归还交接不是当前车辆分配');
   const segments=await tx.usageSegment.findMany({where:{assignmentId:order.currentAssignmentId},include:{period:true}});
   if(actual)for(const s of segments){
    const boundary=new Date(`${s.period.effectiveEndDate.toISOString().slice(0,10)}T00:00:00+08:00`);
    if(s.startAt>actual){if(s.status!=='OPEN'||s.readingId)add('FUTURE_READING_CONFLICT','归还时间与后续已申报用量冲突');continue;}
    if(boundary<actual)continue;
    if(s.period.status==='SETTLED'){if(!(boundary.getTime()===actual.getTime()&&s.status==='FROZEN'&&s.endReadingKm===h.readingKm))add('SETTLED_USAGE_IMMUTABLE','归还与已结月份或读数冲突');}
    else if(s.endReadingKm&&h.readingKm<s.endReadingKm)add('MILEAGE_REGRESSION','归还低于同车已核读数');
   }
  }
 }
 return{ready:!blockers.length,blockers:[...new Map(blockers.map(b=>[b.code,b])).values()]};
}
