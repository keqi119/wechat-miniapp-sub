import {purchaseAccount} from '../swap-purchases/view';
import {ensure} from '../common/errors';
import {terminal} from '../order-changes/context';
import {ensureAssignments,currentAssignment,assignmentView} from './assignments';
import {creditView} from './credits';
import {day} from '../usage/rules';
import {orderChangeScopeEnabled} from '../offline-documents/change-mode';
import {offlineSwapEligibility} from './offline-facts';
import {readOfflineSwapPurchases} from './offline-account';
import {refreshLegacySwapExpiry} from '../swap-purchases/ledger';
export async function swapAccountView(tx:any,orderId:string,now:Date,customerId?:string){
 const order=await tx.order.findFirst({where:{id:orderId,...(customerId?{customerId}:{})}});ensure(order,404,'NOT_FOUND','用车订单不存在');
 const account=await tx.usageAccount.findUnique({where:{orderId}});ensure(account,409,'USAGE_NOT_ACTIVE','尚未实际交车');
 await refreshLegacySwapExpiry(tx,order,now);
 if(order.contractMode!=='OFFLINE')await ensureAssignments(tx,order);
 const current=await tx.order.findUniqueOrThrow({where:{id:orderId}}),a=await currentAssignment(tx,current),active=await tx.orderChange.findFirst({where:{orderId,status:{notIn:terminal}}});
 const last=await tx.usagePeriod.findFirstOrThrow({where:{orderId},orderBy:{sequence:'desc'}}),changesEnabled=orderChangeScopeEnabled(order,'VEHICLE_CHANGE');
 const manualBlocker='本版订单变更请联系平台人工核对并另行签署线下材料',blockers:string[]=[];
 if(!changesEnabled)blockers.push(manualBlocker);
 if(now>=new Date(day(last.endDate)+'T00:00:00+08:00'))blockers.push('原订阅期限已结束');
 if(order.status!=='ACTIVE'||account.returnedOn)blockers.push('订单未处于用车中');
 if(!a)blockers.push('当前没有已交付车辆');
 if(active)blockers.push('已有未完成变更');
 if(['OFFLINE','ELECTRONIC'].includes(order.contractMode)){const facts=await offlineSwapEligibility(tx,current,now);blockers.push(...facts.blockers);}
 const credits=await creditView(tx,order,account,now);blockers.push(...credits.creditBlockers);
 const purchases=order.contractMode==='OFFLINE'?await readOfflineSwapPurchases(tx,order,account,now):await purchaseAccount(tx,order,account,now);
 // Purchase capability has its own rollout and verified order facts; change request gates stay independent.
 return{orderId,contractMode:order.contractMode??'ESIGN',startedOn:day(account.startedOn),endDate:day(new Date(last.endDate.getTime()-86400000)),currentAssignment:assignmentView(a),assignments:(await tx.vehicleAssignment.findMany({where:{orderId},include:{vehicle:true},orderBy:{startAt:'asc'}})).map(assignmentView),...credits,canRequest:blockers.length===0,blockers,...purchases};
}
