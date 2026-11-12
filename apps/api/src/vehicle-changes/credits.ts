import {ensure} from '../common/errors';
import {periods,day,shanghaiDay} from '../usage/rules';
import {validateSwapCredit,validateSwapPurchase,validateSwapPurchaseCredit,swapPurchaseTargetMatches} from '../swap-purchases/policy';
import {readHistoricalSwapSource,readSwapSourceAt,readSwapSourceProjection,requireNoConfirmedFutureSwap,withinSwapSource} from '../order-service-stages/swap-source';
// Shared order -> account lock order, without changing optimistic business revisions.
async function lockCredits(tx:any,orderId:string){
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "UsageAccount" WHERE "orderId" = ${orderId} FOR UPDATE`;
 const account=await tx.usageAccount.findUnique({where:{orderId}});ensure(account,409,'USAGE_NOT_ACTIVE','请先完成交车并建立用量账户');return account;
}
export function cycleAt(startedOn:Date,months:number,actualAt:Date){const date=shanghaiDay(actualAt),all=periods(day(startedOn),months),index=all.findIndex(p=>day(p.startDate)<=date&&date<day(p.endDate));ensure(index>=0,409,'SWAP_OUTSIDE_TERM','换车实际完成日必须在原订阅期内');const first=Math.floor(index/12)*12,last=Math.min(first+11,all.length-1);return{sequence:Math.floor(index/12)+1,startDate:day(all[first].startDate),endDate:day(all[last].endDate)};}
async function ownCreditSource(tx:any,order:any,account:any,credit:any){const source=await readHistoricalSwapSource(tx,order,account,credit.serviceStageId);validateSwapCredit(order,credit,source);return source;}
export async function creditView(tx:any,order:any,account:any,now:Date){
 const {source,blockers}=await readSwapSourceProjection(tx,order,account,now),policy=source.policy,reservations=await tx.swapReservation.findMany({where:{orderId:order.id},include:{credit:true},orderBy:{createdAt:'asc'}}),ledger=await tx.swapLedger.findMany({where:{orderId:order.id},orderBy:{recordedAt:'asc'}}),credits=await tx.swapCredit.findMany({where:{orderId:order.id}});
 for(const c of credits)await ownCreditSource(tx,order,account,c);
 const sameStage=(c:any)=>(c.serviceStageId??null)===source.serviceStageId,available=!blockers.length&&withinSwapSource(order,account,source,now);
 const scope=(creditId:string)=>{const c=credits.find((c:any)=>c.id===creditId);ensure(c,409,'SWAP_CREDIT_SOURCE','次数流水缺少原来源');return{serviceStageId:c.serviceStageId??null,...(c.policySnapshot?{scope:'TERM',termSequence:c.termSequence??null}:{cycleSequence:c.cycleSequence??null})};};
 const history={serviceStageId:source.serviceStageId,stageSourceHash:source.stageSourceHash,creditBlockers:blockers,paidAvailable:0,reservations:reservations.map((r:any)=>({id:r.id,changeId:r.changeId,source:r.credit.source,status:r.status,...scope(r.creditId)})),ledger:ledger.map((l:any)=>({id:l.id,purchaseId:l.purchaseId,type:l.type,source:l.source,changeId:l.changeId,actualAt:l.actualAt,recordedAt:l.recordedAt,...scope(l.creditId)}))};
 if(policy){const free=credits.filter((c:any)=>sameStage(c)&&c.source==='FREE'),consumed=free.filter((c:any)=>c.consumedChangeId).length,reserved=reservations.filter((r:any)=>r.status==='RESERVED'&&r.credit.source==='FREE'&&sameStage(r.credit)).length;
  ensure(free.length<=policy.includedCount&&consumed+reserved<=policy.includedCount,409,'SWAP_CREDIT_SOURCE','本服务租期次数账本超出已确认额度');
  return{...history,policyVersion:policy.policyVersion,term:{startDate:shanghaiDay(source.startAt),endDate:shanghaiDay(source.endAt),includedCount:policy.includedCount,remaining:policy.includedCount-consumed,reserved,consumed,available:available?policy.includedCount-consumed-reserved:0}};
 }
 const at=now<source.startAt?source.startAt:now>=source.endAt?new Date(source.endAt.getTime()-1):now,cycle=cycleAt(account.startedOn,order.finalPlanSnapshot.months,at),credit=credits.find((c:any)=>c.source==='FREE'&&sameStage(c)&&c.cycleSequence===cycle.sequence);
 return{...history,cycle:{...cycle,freeAvailable:order.contractMode==='OFFLINE'||!available||credit?.consumedChangeId?0:reservations.some((r:any)=>r.creditId===credit?.id&&r.status==='RESERVED')?0:1,freeReserved:reservations.filter((r:any)=>r.creditId===credit?.id&&r.status==='RESERVED').length,freeConsumed:credit?.consumedChangeId?1:0}};
}
async function purchaseTargetMatches(tx:any,order:any,purchase:any,changeId:string,targetVehicleId?:string){
 if(purchase.pricingSnapshot?.version!==3)return true;
 const change=await tx.orderChange.findUnique({where:{id:changeId}});
 ensure(change?.kind==='VEHICLE_CHANGE'&&change.orderId===order.id&&change.customerId===order.customerId,409,'SWAP_CREDIT_TARGET','目标车辆变更归属无效');
 const vehicleId=targetVehicleId??change.targetVehicleId;
 ensure(typeof vehicleId==='string'&&vehicleId,409,'SWAP_CREDIT_TARGET','须明确实际目标车辆');
 const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId}}),model=vehicle?.modelDefinitionId?await tx.modelDefinition.findUnique({where:{id:vehicle.modelDefinitionId}}):null;
 ensure(vehicle?.id===vehicleId&&model?.id===vehicle.modelDefinitionId,409,'SWAP_CREDIT_TARGET','实际目标车辆缺少真实车型');
 return swapPurchaseTargetMatches(purchase,model);
}
// Selection only reads. The mutating caller locks, re-reads and materializes a lazy gift.
async function selectCredit(tx:any,order:any,account:any,changeId:string,actualAt:Date,targetVehicleId?:string):Promise<{credit?:any;grant?:any}>{
 await requireNoConfirmedFutureSwap(tx,order);const source=await readSwapSourceAt(tx,order,account,actualAt),policy=source.policy;
 if(source.serviceStageId){const stage=await tx.orderServiceStage.findUnique({where:{id:source.serviceStageId}});if(stage?.changeId)await(await import('../order-renewals/cancellation-state')).assertRenewalNotCancelling(tx,stage.changeId);}
 ensure(account.orderId===order.id&&account.customerId===order.customerId&&withinSwapSource(order,account,source,actualAt),409,'SWAP_OUTSIDE_TERM','换车实际完成须在本单有效用车期内');
 if(policy){
  const rows=await tx.swapCredit.findMany({where:{orderId:order.id}});for(const c of rows)await ownCreditSource(tx,order,account,c);
  const free=rows.filter((c:any)=>c.source==='FREE'&&(c.serviceStageId??null)===source.serviceStageId),reservations=await tx.swapReservation.findMany({where:{orderId:order.id,status:'RESERVED'}});
  ensure(free.length<=policy.includedCount,409,'SWAP_CREDIT_SOURCE','合同期赠送次数超过政策总额');
  const reusable=free.filter((c:any)=>c.status==='ACTIVE'&&(!c.consumedChangeId||c.consumedChangeId===changeId)&&!reservations.some((r:any)=>r.creditId===c.id&&r.changeId!==changeId)).sort((a:any,b:any)=>a.termSequence-b.termSequence)[0];
  if(reusable)return{credit:reusable};
  if(free.length<policy.includedCount){const next=free.reduce((max:number,c:any)=>Math.max(max,c.termSequence),0)+1;ensure(next<=policy.includedCount,409,'SWAP_CREDIT_SOURCE','合同期赠送序号超出额度');return{grant:{orderId:order.id,source:'FREE',termSequence:next,policySnapshot:policy,...(source.serviceStageId?{serviceStageId:source.serviceStageId}:{})}};}
 }else if(order.contractMode!=='OFFLINE'){
  const cycle=cycleAt(account.startedOn,order.finalPlanSnapshot.months,actualAt),free=await tx.swapCredit.findUnique({where:{orderId_cycleSequence:{orderId:order.id,cycleSequence:cycle.sequence}}});
  if(!free)return{grant:{orderId:order.id,source:'FREE',cycleSequence:cycle.sequence}};
  await ownCreditSource(tx,order,account,free);
  if(free.status==='ACTIVE'&&(!free.consumedChangeId||free.consumedChangeId===changeId)&&!await tx.swapReservation.count({where:{creditId:free.id,status:'RESERVED',changeId:{not:changeId}}}))return{credit:free};
 }
 const paid=await tx.swapCredit.findMany({where:{orderId:order.id,source:'PAID',consumedChangeId:null,status:'ACTIVE',reservations:{none:{status:'RESERVED',changeId:{not:changeId}}}},orderBy:{createdAt:'asc'}});
 for(const credit of paid){const own=await ownCreditSource(tx,order,account,credit);const purchase=await tx.swapCreditPurchase.findFirst({where:{creditId:credit.id,paymentId:credit.sourcePaymentId,status:'ACTIVE'}}),payment=await tx.payment.findUnique({where:{id:credit.sourcePaymentId},include:{bill:true,refunds:true}});if(!purchase||!payment||payment.status!=='SUCCEEDED'||payment.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)))continue;validateSwapPurchase(order,purchase,payment.bill,payment,own);validateSwapPurchaseCredit(order,purchase,credit,own);if(!withinSwapSource(order,account,own,actualAt)||actualAt>=purchase.expiresAt||!await purchaseTargetMatches(tx,order,purchase,changeId,targetVehicleId))continue;return{credit};}
 ensure(false,409,'SWAP_CREDIT_UNAVAILABLE','赠送次数已用完或被预占，当前没有真实已付可用次数');
}
export async function readSwapCreditAvailability(tx:any,order:any,account:any,changeId:string,actualAt:Date,targetVehicleId?:string){await selectCredit(tx,order,account,changeId,actualAt,targetVehicleId);return true;}
export async function readSwapServiceFeeSource(tx:any,order:any,account:any,changeId:string,actualAt:Date,targetVehicleId:string){
 const selected=await selectCredit(tx,order,account,changeId,actualAt,targetVehicleId),credit=selected.credit??selected.grant;
 if(credit.source==='FREE')return{kind:'INCLUDED' as const,serviceStageId:credit.serviceStageId??null,termSequence:credit.termSequence??null,cycleSequence:credit.cycleSequence??null,amount:0,alreadyPaidAmount:0,purchaseId:null,paymentId:null};
 const purchase=await tx.swapCreditPurchase.findFirst({where:{creditId:credit.id,paymentId:credit.sourcePaymentId,status:'ACTIVE'}});
 ensure(purchase&&Number.isSafeInteger(purchase.amount)&&purchase.amount>0,409,'SWAP_CREDIT_SOURCE','单次服务费须来自本单真实已购权益');
 return{kind:'PAID_CREDIT' as const,serviceStageId:credit.serviceStageId??null,termSequence:null,cycleSequence:null,amount:purchase.amount,alreadyPaidAmount:purchase.amount,purchaseId:purchase.id,paymentId:purchase.paymentId};
}
export async function chooseCredit(tx:any,original:any,account:any,changeId:string,actualAt:Date,targetVehicleId?:string){
 account=await lockCredits(tx,original.id);const order=await tx.order.findUniqueOrThrow({where:{id:original.id}}),selected=await selectCredit(tx,order,account,changeId,actualAt,targetVehicleId);
 if(selected.credit)return selected.credit;
 const credit=await tx.swapCredit.create({data:selected.grant});
 if(selected.grant.termSequence)await tx.swapLedger.create({data:{orderId:order.id,creditId:credit.id,source:'FREE',type:'GRANT',sourceKey:selected.grant.serviceStageId?`stage-term-grant:${selected.grant.serviceStageId}:${selected.grant.termSequence}`:`term-grant:${order.id}:${selected.grant.termSequence}`}});
 return credit;
}
export async function releaseCredits(tx:any,changeId:string){
 const before=await tx.swapReservation.findMany({where:{changeId,status:'RESERVED'}});for(const orderId of [...new Set(before.map((r:any)=>r.orderId))].sort())await lockCredits(tx,orderId as string);
 const rows=await tx.swapReservation.findMany({where:{changeId,status:'RESERVED'},include:{credit:true}});for(const r of rows){await ownCreditSource(tx,await tx.order.findUniqueOrThrow({where:{id:r.orderId}}),await tx.usageAccount.findUniqueOrThrow({where:{orderId:r.orderId}}),r.credit);await tx.swapReservation.update({where:{id:r.id},data:{status:'RELEASED'}});await tx.swapLedger.create({data:{orderId:r.orderId,changeId,creditId:r.creditId,source:r.credit.source,cycleSequence:r.credit.cycleSequence,type:'RELEASE',sourceKey:`release:${r.id}`}});}
}
export async function reserveCredit(tx:any,order:any,account:any,changeId:string,at:Date,targetVehicleId?:string){const credit=await chooseCredit(tx,order,account,changeId,at,targetVehicleId);const same=await tx.swapReservation.findFirst({where:{changeId,creditId:credit.id,status:'RESERVED'}});if(same)return same;await releaseCredits(tx,changeId);const r=await tx.swapReservation.create({data:{orderId:order.id,changeId,creditId:credit.id}});await tx.swapLedger.create({data:{orderId:order.id,changeId,creditId:credit.id,source:credit.source,cycleSequence:credit.cycleSequence,type:'RESERVE',sourceKey:`reserve:${r.id}`}});return r;}
export async function consumeCredit(tx:any,order:any,account:any,changeId:string,actualAt:Date,targetVehicleId?:string){
 await lockCredits(tx,order.id);order=await tx.order.findUniqueOrThrow({where:{id:order.id}});const prior=await tx.swapLedger.findUnique({where:{sourceKey:`consume:${changeId}`}});if(prior){ensure(prior.orderId===order.id&&prior.changeId===changeId,409,'SWAP_CREDIT_SOURCE','消费流水与订单不符');const credit=await tx.swapCredit.findUniqueOrThrow({where:{id:prior.creditId}}),source=await ownCreditSource(tx,order,account,credit);if(credit.source==='PAID'){const p=await tx.swapCreditPurchase.findFirst({where:{creditId:credit.id}});ensure(p,409,'SWAP_CREDIT_SOURCE','已消费付费次数缺少原购买');validateSwapPurchase(order,p,undefined,undefined,source);validateSwapPurchaseCredit(order,p,credit,source);ensure(await purchaseTargetMatches(tx,order,p,changeId,targetVehicleId),409,'SWAP_CREDIT_TARGET','购买权益不适用于本次实际目标车型');}return prior;}
 const r=await reserveCredit(tx,order,account,changeId,actualAt,targetVehicleId),credit=await tx.swapCredit.findUniqueOrThrow({where:{id:r.creditId}});ensure(!credit.consumedChangeId,409,'SWAP_CREDIT_UNAVAILABLE','次数已被消耗');await tx.swapCredit.update({where:{id:credit.id},data:{consumedChangeId:changeId}});if(credit.source==='PAID')await tx.swapCreditPurchase.updateMany({where:{creditId:credit.id,status:'ACTIVE'},data:{status:'CONSUMED'}});await tx.swapReservation.update({where:{id:r.id},data:{status:'CONSUMED'}});return tx.swapLedger.create({data:{orderId:order.id,changeId,creditId:credit.id,source:credit.source,cycleSequence:credit.cycleSequence,type:'CONSUME',sourceKey:`consume:${changeId}`,actualAt}});
}
