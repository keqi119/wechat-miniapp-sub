import {newHandoverMode,archiveOnlineCompletion} from '../operations/online-handover';
import {assertNotAssetFiles} from '../files/asset-files';
import {refreshSegmentPeriods} from './segments';
import {financeQuoteId} from './recovery';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {financeView} from '../order-changes/finance';
import {lockOrder} from '../order-changes/context';
import {lockAccount,shanghaiDay} from '../usage/rules';
import {boundaryAt,openSegments} from './assignments';
import {chooseCredit,consumeCredit,readSwapCreditAvailability} from './credits';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
import {bindSwapFieldTask,type SwapFieldContext} from './field-handover-source';
import {requireChangeAgreementReady} from '../order-changes/agreement-readiness';
import {assertOfflineSwapQuote,requireOfflineSwapTarget} from './offline-target';
import {requireOfflineSwapFacts} from './offline-facts';
import {assertOfflineSwapHandoverSource,offlineSwapHandoverHash,requireSwapFieldCompletion,readOfflineSwapReceiptReady} from './offline-physical-source';
import {requireOfflineHandoverReady} from '../offline-documents/handover';
import {readSwapStageScope} from './stage-source';
import {guardElectronicSwapReturn} from './electronic-return';
import {guardElectronicSwapDelivery} from './electronic-delivery';
import {completeElectronicSwapHandover} from './electronic-completion';

export type SwapReservationFacts={orderId:string;customerId:string;changeId:string;type:'SWAP_RETURN'|'SWAP_DELIVERY';vehicleId:string;assignmentId:string|null};
/** A task reservation is not a physical handover. No locks, writes or invented actualAt. */
export async function guardSwapHandoverReservation(tx:any,h:SwapReservationFacts){
 if(h.type==='SWAP_DELIVERY'&&(await tx.order.findUniqueOrThrow({where:{id:h.orderId}})).contractMode==='ELECTRONIC')return guardElectronicSwapDelivery(tx,h);
 if(h.type==='SWAP_RETURN'&&(await tx.order.findUniqueOrThrow({where:{id:h.orderId}})).contractMode==='ELECTRONIC')return guardElectronicSwapReturn(tx,h);
 const change=await tx.orderChange.findUnique({where:{id:h.changeId}});ensure(change?.kind==='VEHICLE_CHANGE'&&change.orderId===h.orderId&&change.customerId===h.customerId,409,'SWAP_OWNERSHIP','换车交接归属不一致');
 const order=await tx.order.findUniqueOrThrow({where:{id:h.orderId}}),q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId},include:{contract:true}}),s=q.snapshot;
 ensure(order.status==='ACTIVE'&&q.financePreparedAt,409,'SWAP_STATE','换车订单或资金安排未就绪');
 if(order.contractMode==='OFFLINE'){assertOfflineSwapQuote(change,q);const agreement=await requireChangeAgreementReady(tx,change.id);ensure(agreement.mode==='OFFLINE'&&q.approvedArchiveVersionId===agreement.archiveVersionId,409,'AGREEMENT_ARCHIVE_PIN_REQUIRED','当前资金安排缺少一致的纸质协议版本');}
 else ensure(q.contract?.status==='SIGNED',409,'SWAP_STATE','换车补充协议未完成');
 const financial=await financeView(tx,change);ensure(!financial.blockers.length,409,'FINANCE_UNRESOLVED',financial.blockers.join('；'));
 const vehicle=await tx.vehicle.findUnique({where:{id:h.vehicleId}});ensure(vehicle,409,'VEHICLE_OWNERSHIP','交接车辆不存在');
 if(h.type==='SWAP_RETURN'){
  const a=await tx.vehicleAssignment.findUnique({where:{id:s.originalAssignmentId}});ensure(change.status==='AWAITING_FINANCE'&&a?.status==='ACTIVE'&&a.orderId===order.id&&a.customerId===order.customerId&&order.currentAssignmentId===a.id&&h.assignmentId===a.id&&h.vehicleId===a.vehicleId&&vehicle.reservedOrderId===order.id&&vehicle.status==='IN_USE',409,'VEHICLE_OWNERSHIP','旧车不属于本单当前实际分配');
 }else{
  ensure(h.type==='SWAP_DELIVERY'&&change.status==='SWAP_RETURNED'&&!order.currentAssignmentId&&h.assignmentId===null&&h.vehicleId===change.targetVehicleId,409,'SWAP_STATE','须先完成旧车归还才能预约新车交付');
  const old=await tx.handover.findUnique({where:{id:change.returnHandoverId}}),hold=vehicle.holdId?await tx.vehicleHold.findUnique({where:{id:vehicle.holdId}}):null;
  ensure(old?.status==='COMPLETED'&&old.type==='SWAP_RETURN'&&old.changeId===change.id&&old.orderId===order.id&&old.customerId===order.customerId&&hold?.changeId===change.id&&hold.quoteId===q.id&&hold.status==='HELD'&&!vehicle.reservedOrderId&&vehicle.status==='PUBLISHED',409,'VEHICLE_OWNERSHIP','目标车预留或归还事实不符合当前方案');
  await requireVehicleUnrestricted(tx,h.vehicleId,'DELIVERY');
  if(order.contractMode==='OFFLINE'){await requireOfflineSwapFacts(tx,order,change,new Date(),true);await requireOfflineSwapTarget(tx,order,change,q,new Date(s.plannedDeliveryAt),true);}
  await readSwapCreditAvailability(tx,order,await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),change.id,new Date(s.plannedDeliveryAt),h.vehicleId);
 }
 return{change,order,q};
}
export async function guardSwapHandover(tx:any,h:any){
 await assertNotAssetFiles(tx,[...(h.fileIds||[]),...(h.responseFileIds||[]),...(h.signedFileId?[h.signedFileId]:[])]);
 if(h.type==='SWAP_DELIVERY'&&(await tx.order.findUniqueOrThrow({where:{id:h.orderId}})).contractMode==='ELECTRONIC'){await lockOrder(tx,h.orderId);await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${h.vehicleId} FOR UPDATE`;return guardElectronicSwapDelivery(tx,h);}
 if(h.type==='SWAP_RETURN'&&(await tx.order.findUniqueOrThrow({where:{id:h.orderId}})).contractMode==='ELECTRONIC'){await assertNotAssetFiles(tx,[...(h.fileIds||[]),...(h.responseFileIds||[])]);await lockOrder(tx,h.orderId);return guardElectronicSwapReturn(tx,h);}
 const change=await tx.orderChange.findUnique({where:{id:h.changeId}});ensure(change?.kind==='VEHICLE_CHANGE'&&change.orderId===h.orderId&&change.customerId===h.customerId,409,'SWAP_OWNERSHIP','换车交接归属不一致');await assertNotAssetFiles(tx,[...(h.fileIds||[]),...(h.responseFileIds||[]),...(h.signedFileId?[h.signedFileId]:[])]);await lockOrder(tx,h.orderId);
 const order=await tx.order.findUniqueOrThrow({where:{id:h.orderId}}),q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId},include:{contract:true}}),s=q.snapshot;
 ensure(order.status==='ACTIVE'&&q.financePreparedAt,409,'SWAP_STATE','换车订单或资金安排未就绪');
 if(order.contractMode==='OFFLINE'){assertOfflineSwapQuote(change,q);const agreement=await requireChangeAgreementReady(tx,change.id);ensure(agreement.mode==='OFFLINE'&&q.approvedArchiveVersionId===agreement.archiveVersionId,409,'AGREEMENT_ARCHIVE_PIN_REQUIRED','实际交接须使用资金准备时固定的纸质协议版本');}
 else ensure(order.contractMode==='ESIGN'&&q.contract?.status==='SIGNED',409,'SWAP_STATE','换车补充协议未完成');
 ensure(h.actualAt&&Number.isFinite(new Date(h.actualAt).getTime())&&h.actualAt<=new Date(Date.now()+300000),409,'HANDOVER_DATE_REQUIRED','须如实记录已发生时间');
 ensure(shanghaiDay(h.actualAt)===shanghaiDay(new Date(h.type==='SWAP_RETURN'?s.plannedReturnAt:s.plannedDeliveryAt)),409,'SWAP_DATE_AMENDMENT_REQUIRED','实际交接日期与已签方案不同，请先确认新的补充安排');
 if(order.contractMode==='OFFLINE'&&h.id)assertOfflineSwapHandoverSource(h,change,q);
 const financial=await financeView(tx,change);ensure(!financial.blockers.length,409,'FINANCE_UNRESOLVED',financial.blockers.join('；'));
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${h.vehicleId} FOR UPDATE`;
 let coverageEvidence:any;const vehicle=await tx.vehicle.findUnique({where:{id:h.vehicleId}});ensure(vehicle,409,'VEHICLE_OWNERSHIP','交接车辆不存在');
 if(h.type==='SWAP_DELIVERY')await requireVehicleUnrestricted(tx,h.vehicleId,'DELIVERY');
 if(h.type==='SWAP_RETURN'){
  ensure(change.status==='AWAITING_FINANCE'&&(!change.returnHandoverId||change.returnHandoverId===h.id),409,'SWAP_STATE','旧侧交接不是当前有效版本');const a=await tx.vehicleAssignment.findUnique({where:{id:s.originalAssignmentId}});
  ensure(a?.status==='ACTIVE'&&order.currentAssignmentId===a.id&&h.assignmentId===a.id&&h.vehicleId===a.vehicleId&&vehicle.reservedOrderId===order.id&&vehicle.status==='IN_USE'&&(order.contractMode!=='OFFLINE'||a.orderId===order.id&&a.customerId===order.customerId),409,'VEHICLE_OWNERSHIP','旧车不属于当前分配');
  const readings=await tx.usageSegment.aggregate({where:{assignmentId:a.id},_max:{endReadingKm:true}});ensure(h.actualAt>=a.startAt&&h.readingKm>=Math.max(a.startReadingKm,vehicle.mileageKm,readings._max.endReadingKm||0),409,'MILEAGE_REGRESSION','旧车实际读数低于当前有效同车证据');
 }else{
  ensure(h.type==='SWAP_DELIVERY'&&change.status==='SWAP_RETURNED'&&(!change.deliveryHandoverId||change.deliveryHandoverId===h.id)&&!order.currentAssignmentId,409,'SWAP_STATE','须先完成旧车归还且只能交付一辆新车');const old=await tx.handover.findUnique({where:{id:change.returnHandoverId}}),hold=vehicle.holdId?await tx.vehicleHold.findUnique({where:{id:vehicle.holdId}}):null;
  ensure(old?.status==='COMPLETED'&&h.actualAt>=old.actualAt&&hold?.changeId===change.id&&hold.quoteId===q.id&&hold.status==='HELD'&&vehicle.id===change.targetVehicleId&&!vehicle.reservedOrderId&&vehicle.status==='PUBLISHED',409,'VEHICLE_OWNERSHIP','目标车预留或交接顺序不符合当前方案');ensure(h.readingKm>=vehicle.mileageKm,409,'MILEAGE_REGRESSION','新车读数不可低于本车已确认读数');
  if(order.contractMode==='OFFLINE'){await requireOfflineSwapFacts(tx,order,change,h.actualAt,true);const checked=await requireOfflineSwapTarget(tx,order,change,q,h.actualAt,true);coverageEvidence={checkedAt:new Date(h.actualAt).toISOString(),vehicleId:h.vehicleId,productVersionId:s.targetSource.product.productVersionId,policyVersionIds:checked.coverage?.policyVersionIds,requirementIds:checked.coverage?.requirementIds};await readSwapCreditAvailability(tx,order,await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),change.id,h.actualAt,h.vehicleId);}
  else await chooseCredit(tx,order,await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),change.id,h.actualAt,h.vehicleId);
 }
 ensure(await tx.usagePeriod.count({where:{orderId:order.id,status:'SETTLED',effectiveEndDate:{gt:new Date(shanghaiDay(h.actualAt))}}})===0,409,'SETTLED_USAGE_IMMUTABLE','不能改变已经结算的月份');return{change,order,q,coverageEvidence};
}
export async function createSwapHandover(tx:any,change:any,input:any,actor:any,fieldContext?:SwapFieldContext){const q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}}),old=await tx.vehicleAssignment.findUniqueOrThrow({where:{id:(q.snapshot as any).originalAssignmentId}});const type=input.side==='RETURN'?'SWAP_RETURN':'SWAP_DELIVERY',field=input.side==='RETURN'?'returnHandoverId':'deliveryHandoverId';ensure(!change[field],409,'HANDOVER_EXISTS','该侧已有交接事实，请从原记录处理');const data={orderId:change.orderId,customerId:change.customerId,changeId:change.id,type,vehicleId:input.side==='RETURN'?old.vehicleId:change.targetVehicleId,assignmentId:input.side==='RETURN'?old.id:null,actualAt:new Date(input.actualAt),readingKm:input.readingKm,fileIds:input.fileIds,checklist:[...input.checklist.filter((x:any)=>x.label!=='车辆身份'),{label:'车辆身份',value:input.side==='RETURN'?(q.snapshot as any).oldVehicleIdentification:(q.snapshot as any).targetVehicleIdentification}]};const {order}=await guardSwapHandover(tx,data);const fieldBinding=fieldContext?await bindSwapFieldTask(tx,fieldContext,change,q,data,actor):{};ensure(await tx.storedFile.count({where:{id:{in:input.fileIds},OR:[{customerId:change.customerId},{customerId:null}]}})===new Set(input.fileIds).size,403,'FILE_OWNERSHIP','交接证据归属无效');await assertNotAssetFiles(tx,input.fileIds);const h=await tx.handover.create({data:{...data,...fieldBinding,...await newHandoverMode(tx,order.contractMode),executionMode:order.contractMode,manifestHash:hash({...data,quoteId:q.id,commercialHash:q.commercialHash})}});await tx.orderChange.update({where:{id:change.id},data:{[field]:h.id}});await audit(tx,actor.id,'CREATE_SWAP_HANDOVER','handovers',h.id,{changeId:change.id,vehicleId:h.vehicleId,side:input.side});return h;}
/** Revise only a real current OFFLINE fact; the old hash is checked before evaluating new facts. */
export async function offlineSwapRevisionFacts(tx:any,old:any,input:any,requiredFieldTaskId?:string){
 ensure(old.executionMode==='OFFLINE'&&old.status==='OBJECTION_SUBMITTED',409,'HANDOVER_NOT_READY','须先由客户提出当前版本事实异议');
 const {change,q}=await guardSwapHandover(tx,old);
 if(requiredFieldTaskId)ensure(old.fieldTaskId===requiredFieldTaskId,409,'FIELD_SWAP_SOURCE_CHANGED','只能修订本任务当前换车事实');
 await requireSwapFieldCompletion(tx,old,change,q);
 const checklist=[...input.checklist.filter((x:any)=>x.label!=='车辆身份'),{label:'车辆身份',value:old.type==='SWAP_RETURN'?q.snapshot.oldVehicleIdentification:q.snapshot.targetVehicleIdentification}];
 const candidate={...old,onlineRecordSnapshot:null,actualAt:new Date(input.actualAt),readingKm:input.readingKm,fileIds:input.fileIds,checklist};
 candidate.manifestHash=offlineSwapHandoverHash(candidate,q);await guardSwapHandover(tx,candidate);
 return{checklist,manifestHash:candidate.manifestHash};
}
export async function closeAssignment(tx:any,a:any,h:any){
 const segments=await tx.usageSegment.findMany({where:{assignmentId:a.id},include:{period:true},orderBy:{startAt:'asc'}});
 for(const s of segments){if(s.startAt>h.actualAt){ensure(s.status==='OPEN'&&!s.readingId,409,'FUTURE_READING_CONFLICT','归还时间与后续已申报用量冲突');await tx.usageSegment.delete({where:{id:s.id}});continue;}if(boundaryAt(s.period.effectiveEndDate)<h.actualAt)continue;if(s.period.status==='SETTLED'&&boundaryAt(s.period.effectiveEndDate).getTime()===h.actualAt.getTime()){ensure(s.status==='FROZEN'&&s.endReadingKm===h.readingKm,409,'SETTLED_USAGE_IMMUTABLE','归还月界与已结读数不一致，不可改写历史');continue;}ensure(s.period.status!=='SETTLED',409,'SETTLED_USAGE_IMMUTABLE','不可改写已结月份');ensure(!s.endReadingKm||h.readingKm>=s.endReadingKm,409,'MILEAGE_REGRESSION','归还低于同车读数');await tx.usageSegment.update({where:{id:s.id},data:{endAt:h.actualAt,endReadingKm:h.readingKm,endHandoverId:h.id,status:'READY',revision:{increment:1}}});await tx.usagePeriod.update({where:{id:s.periodId},data:{status:'AWAITING_READING',revision:{increment:1}}});}
 await tx.vehicleAssignment.update({where:{id:a.id},data:{endAt:h.actualAt,endReadingKm:h.readingKm,returnHandoverId:h.id,status:'CLOSED'}});await tx.order.update({where:{id:a.orderId},data:{currentAssignmentId:null}});await tx.vehicle.update({where:{id:a.vehicleId},data:{status:'UNPUBLISHED',reservedOrderId:null,mileageKm:h.readingKm}});
}
export async function completeSwapHandover(tx:any,h:any,actorId:string){
 await lockOrder(tx,h.orderId);const current=await tx.handover.findUniqueOrThrow({where:{id:h.id}});ensure(current.orderId===h.orderId&&current.customerId===h.customerId&&current.changeId===h.changeId,409,'SWAP_OWNERSHIP','实际交接归属已变化');h=current;
 await assertNotAssetFiles(tx,[...(h.fileIds||[]),...(h.responseFileIds||[]),...(h.signedFileId?[h.signedFileId]:[])]);if(h.status==='COMPLETED')return h;
 const mode=(await tx.order.findUniqueOrThrow({where:{id:h.orderId}})).contractMode;
 if(mode==='ELECTRONIC')return completeElectronicSwapHandover(tx,h,actorId);
 if(mode==='OFFLINE'){ensure(h.executionMode==='OFFLINE',409,'HANDOVER_NOT_READY','交接执行方式不一致');await requireOfflineHandoverReady(tx,h);}
 else ensure(mode==='ESIGN'&&h.status==='CUSTOMER_CONFIRMED'&&h.signatureStatus==='SIGNED'&&h.signedFileId,409,'HANDOVER_NOT_READY','须双方确认本车事实并完成独立签署归档');
 const guarded=await guardSwapHandover(tx,h),{change,order,q}=guarded,coverageEvidence='coverageEvidence'in guarded?guarded.coverageEvidence:undefined;if(mode==='OFFLINE')ensure(await readOfflineSwapReceiptReady(tx,h),409,'OFFLINE_ARCHIVE_REQUIRED','当前纸质交接版本已失效或仍有反馈');
 const task=await requireSwapFieldCompletion(tx,h,change,q),a=await lockAccount(tx,order.id),stageScope=mode==='OFFLINE'?await readSwapStageScope(tx,order,change.priorTerms):null;let deliveredAssignmentId:string|null=null;
 if(h.type==='SWAP_RETURN'){const assignment=await tx.vehicleAssignment.findUniqueOrThrow({where:{id:h.assignmentId}});await closeAssignment(tx,assignment,h);await tx.orderChange.update({where:{id:change.id},data:{status:'SWAP_RETURNED',revision:{increment:1}}});}
 else{
  await consumeCredit(tx,order,a,change.id,h.actualAt,h.vehicleId);const assignment=await tx.vehicleAssignment.create({data:{orderId:order.id,customerId:order.customerId,vehicleId:h.vehicleId,changeId:change.id,deliveryHandoverId:h.id,startAt:h.actualAt,startReadingKm:h.readingKm}});deliveredAssignmentId=assignment.id;await openSegments(tx,assignment);await tx.handover.update({where:{id:h.id},data:{assignmentId:assignment.id}});
  const version=((await tx.orderTermsVersion.aggregate({where:{orderId:order.id},_max:{version:true}}))._max.version||0)+1,s=q.snapshot,snapshot={...change.priorTerms,...(mode==='OFFLINE'?{vehicleId:h.vehicleId,currentVehicleProductSnapshot:s.targetSource.product,lessorSnapshot:s.targetLessorSnapshot,revenueRuleSnapshot:s.targetRevenueRuleSnapshot}:{}),monthlyFeeAmount:s.newMonthlyFeeAmount,depositAmount:s.depositAmount,monthlyAmounts:s.periods.map((p:any)=>p.amount),billingSchedule:s.periods,commercialTerms:{...change.priorTerms.commercialTerms,vehicleIdentification:s.targetVehicleIdentification,insuranceDetails:s.insuranceResponsibility},commercialHash:q.commercialHash,amendmentContractId:q.contract.id};
  const terms=await tx.orderTermsVersion.create({data:{orderId:order.id,quoteId:q.id,version,snapshot,hash:q.commercialHash,effectiveAt:h.actualAt,...(mode==='OFFLINE'?{offlineArchiveVersionId:q.approvedArchiveVersionId}:{})}});await tx.serviceObligation.updateMany({where:{orderId:order.id,active:true,...(stageScope?{serviceStageId:stageScope.serviceStageId}:{})},data:{active:false}});await tx.serviceObligation.updateMany({where:{quoteId:financeQuoteId(q),...(stageScope?{serviceStageId:stageScope.serviceStageId}:{})},data:{active:true}});
  const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:h.vehicleId}});await tx.vehicleHold.update({where:{id:vehicle.holdId},data:{status:'CONSUMED',releasedAt:new Date()}});await tx.vehicle.update({where:{id:h.vehicleId},data:{holdId:null,status:'IN_USE',reservedOrderId:order.id,mileageKm:h.readingKm}});await tx.order.update({where:{id:order.id},data:{vehicleId:h.vehicleId,currentAssignmentId:assignment.id,effectiveTermsVersionId:terms.id,confirmedMileageKm:h.readingKm}});await tx.orderChange.update({where:{id:change.id},data:{status:'APPLIED',actualCompletedAt:h.actualAt,appliedAt:new Date(),revision:{increment:1}}});
 }
 const completedAt=new Date();await archiveOnlineCompletion(tx,h,actorId,completedAt);
 const done=await tx.handover.update({where:{id:h.id},data:{status:'COMPLETED',completedAt}});
 if(task){const updated=await tx.fieldHandoverTask.updateMany({where:{id:task.id,version:task.version,status:'ASSIGNED',currentHandoverId:h.id},data:{status:'COMPLETED',version:{increment:1},updatedBy:actorId,...(deliveredAssignmentId?{vehicleAssignmentId:deliveredAssignmentId}:{})}});ensure(updated.count===1,409,'FIELD_SWAP_SOURCE_CHANGED','当前现场任务已变化');}
 if(mode==='OFFLINE'&&h.type==='SWAP_DELIVERY')await requireChangeAgreementReady(tx,change.id);
 await refreshSegmentPeriods(tx,order.id,stageScope?{serviceStageId:stageScope.serviceStageId}:undefined);await audit(tx,actorId,'COMPLETE_SWAP_HANDOVER','handovers',h.id,{changeId:change.id,actualAt:h.actualAt,vehicleId:h.vehicleId,...(coverageEvidence?{coverageEvidence}:{})});return done;
}
