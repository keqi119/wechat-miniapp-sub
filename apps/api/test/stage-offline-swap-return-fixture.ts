import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command,type Login} from './seven-module-journey-fixtures';
import {readTerminationContext} from '../src/offline-documents/termination';
import {readSimpleRevenue} from '../src/partners/simple-revenue';
import {serviceBillSequences} from '../src/order-changes/obligations';

type Scope={customer:Login;orderId:string;ownerId:string;oldAssignmentId:string;newAssignmentId:string;targetVehicleId:string;stageId:string;swapQuoteId:string;upgradePaymentId:string;originalSnapshot:unknown;stageSnapshot:unknown};

/** Continues the existing real renewal/swap journey. Never seeds settlement, receipt or refund results. */
export async function verifyStageSwapFinalReturn(h:JourneyHarness,s:Scope){
 const {customer,orderId,stageId}=s,actualAt='2027-10-31T10:00:00+08:00',readingKm=3150;
 const grantsBefore=await h.db.swapLedger.count({where:{orderId,type:'GRANT'}}),stageCountBefore=await h.db.orderServiceStage.count({where:{orderId}});
 const paidPurchaseBefore=await h.db.swapCreditPurchase.findFirstOrThrow({where:{orderId,serviceStageId:null}});
 const revenueBefore=await h.db.partnerRevenueEvent.findMany({where:{orderId},orderBy:{id:'asc'}});
 let task=await h.post('/admin/handover-tasks',{orderId,type:'RETURN',assigneeId:h.field.id,note:'换入车最终归还，不能复用旧车换出查验'});
 const upload=await h.post(`/admin/field-tasks/${task.id}/files`,h.form({version:task.version},'final-return',true),h.field);task=upload.task;
 task=await h.post(`/admin/field-tasks/${task.id}/draft`,{version:task.version,draft:{actualAt,readingKm,batteryPercent:70,place:'合成最终归还车位',accessories:'钥匙及随车物品齐全',condition:'按实际换入车查验',openItems:'无',resolutionPlan:'无',fileIds:[upload.id]}},h.field);
 const publish= {version:task.version,idempotencyKey:randomUUID(),checked:true};
 task=await h.post(`/admin/field-tasks/${task.id}/publish`,publish,h.field);
 assert.equal((await h.post(`/admin/field-tasks/${task.id}/publish`,publish,h.field)).handover.id,task.handover.id);
 const returned=await h.get('/customer/handovers/'+task.handover.id,customer);
 assert.equal(returned.type,'RETURN');assert.equal(returned.vehicleId,s.targetVehicleId);assert.equal(returned.assignmentId,s.newAssignmentId);
 await h.post(`/customer/handovers/${returned.id}/confirm`,{manifestHash:returned.manifestHash,readFileIds:returned.fileIds,fileIds:[],reason:'',idempotencyKey:randomUUID()},customer);
 await h.reject(`/admin/handovers/${returned.id}/complete`,command(returned.revision),h.maker,'OFFLINE_ARCHIVE_REQUIRED');
 const returnPaper=await h.archive('RETURN_RECEIPT','HANDOVER',returned.id,undefined,{id:task.id,version:task.version});
 const opsProof=await h.proof(h.maker,'evidence',true),receiptInput={...command(),receivedAt:actualAt,readingKm,storageLocation:'合成最终收车场地',evidenceFileIds:[opsProof.id]};
 const receipt=await h.post(`/admin/handovers/${returned.id}/received`,receiptInput);
 assert.equal((await h.post(`/admin/handovers/${returned.id}/received`,receiptInput)).id,receipt.id);
 const completion=command(returned.revision);
 const completed=await Promise.all([h.post(`/admin/handovers/${returned.id}/complete`,completion),h.post(`/admin/handovers/${returned.id}/complete`,completion)]);
 assert.equal(completed[0].id,completed[1].id);
 const settling=await h.db.order.findUniqueOrThrow({where:{id:orderId}}),closed=await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:s.newAssignmentId}});
 assert.equal(settling.status,'SETTLING');assert.equal(settling.currentAssignmentId,null);assert.equal(settling.vehicleId,s.targetVehicleId);
 assert.equal(closed.status,'CLOSED');assert.equal(closed.returnHandoverId,returned.id);assert.equal(closed.endReadingKm,3150);
 assert.equal(closed.endAt!.toISOString(),new Date(actualAt).toISOString());
 const taskAfter=await h.db.fieldHandoverTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(taskAfter.status,'COMPLETED');assert.equal(taskAfter.currentHandoverId,returned.id);
 const receipts=await h.db.vehicleReceiptEvent.findMany({where:{orderId}});assert.equal(receipts.length,1);assert.equal(receipts[0].handoverId,returned.id);assert.equal(receipts[0].assignmentId,s.newAssignmentId);
 assert.equal((await h.db.documentArchive.findUniqueOrThrow({where:{id:returnPaper.archiveId}})).currentApprovedVersionId,returnPaper.versionId);
 const account=await h.db.usageAccount.findUniqueOrThrow({where:{orderId}});assert.equal(account.returnedOn!.toISOString().slice(0,10),'2027-10-31');assert.equal(account.returnReadingKm,3150);assert.equal(account.packStatus,'FROZEN');
 assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:s.targetVehicleId}})).reservedOrderId,orderId,'physical return keeps the vehicle held until financial closure');

 const stagePeriod=await h.db.usagePeriod.findUniqueOrThrow({where:{orderId_sequence:{orderId,sequence:13}}});
 assert.equal(stagePeriod.serviceStageId,stageId);assert.equal(stagePeriod.stageSequence,1);assert.equal(stagePeriod.status,'READY');
 await h.reject(`/admin/usage-periods/${stagePeriod.id}/settle`,command(stagePeriod.revision),h.finance,'MISSING_PRIOR_READING');
 assert.equal(await h.db.bill.count({where:{orderId,type:'MILEAGE_EXCESS'}}),0);
 const oldPeriods=await h.db.usagePeriod.findMany({where:{orderId,sequence:{lte:12}},orderBy:{sequence:'asc'}});assert.equal(oldPeriods.length,12);
 // Twelve actual boundary photos are submitted and independently checked. No SETTLED fixtures.
 for(const p of oldPeriods){
  const segment=await h.db.usageSegment.findFirstOrThrow({where:{periodId:p.id,assignmentId:s.oldAssignmentId}});
  assert.equal(segment.status,'OPEN');assert.equal(segment.endHandoverId,null);
  const photo=await h.proof(customer,'mileage',true),endReading=p.sequence===12?200:100;
  const input={readingKm:endReading,recordedAt:p.effectiveEndDate.toISOString(),fileIds:[photo.id],idempotencyKey:randomUUID()};
  const reading=await h.post(`/customer/usage-segments/${segment.id}/readings`,input,customer);
  assert.equal((await h.post(`/customer/usage-segments/${segment.id}/readings`,input,customer)).id,reading.id);
  await h.post(`/admin/mileages/${reading.id}/review`,{decision:'APPROVED',note:`独立核对原期第 ${p.sequence} 月实际月界照片`,boundaryConfirmed:true});
  const ready=await h.get(`/admin/usage-periods/${p.id}`,h.finance);assert.equal(ready.status,'READY');assert.equal(ready.baseAllowanceKm,1500);assert.equal(ready.excessPriceAmount,150);
  const inputToSettle=command(ready.revision),settled=await h.post(`/admin/usage-periods/${p.id}/settle`,inputToSettle,h.finance);
  assert.deepEqual(await h.post(`/admin/usage-periods/${p.id}/settle`,inputToSettle,h.finance),settled);
  assert.equal(settled.usedKm,p.sequence===12?100:0);assert.equal(settled.excessAmount,0);
  const frozen=await h.db.usageSegment.findUniqueOrThrow({where:{id:segment.id}});assert.equal(frozen.status,'FROZEN');assert.equal(frozen.readingId,reading.id);assert.equal(frozen.endReadingKm,endReading);
 }
 const current=await h.get(`/admin/usage-periods/${stagePeriod.id}`,h.finance);assert.equal(current.baseAllowanceKm,2400);assert.equal(current.excessPriceAmount,230);
 const stageSettlementInput=command(current.revision),settled=await h.post(`/admin/usage-periods/${stagePeriod.id}/settle`,stageSettlementInput,h.finance);
 assert.deepEqual(await h.post(`/admin/usage-periods/${stagePeriod.id}/settle`,stageSettlementInput,h.finance),settled);
 assert.equal(settled.usedKm,3000);assert.equal(settled.baseUsedKm,2400);assert.equal(settled.packUsedKm,0);assert.equal(settled.excessKm,600);assert.equal(settled.excessAmount,138000);
 const segments=await h.db.usageSegment.findMany({where:{periodId:stagePeriod.id},orderBy:{startAt:'asc'}});assert.equal(segments.length,2);
 assert.deepEqual(segments.map(row=>[row.assignmentId,row.startReadingKm,row.endReadingKm,row.status]),[[s.oldAssignmentId,200,300,'FROZEN'],[s.newAssignmentId,250,3150,'FROZEN']]);
 assert(segments.every(row=>!!row.endHandoverId&&!!row.frozenHash));
 const excess=await h.db.bill.findUniqueOrThrow({where:{id:settled.billId}});assert.equal(excess.amount,138000);assert.equal(excess.sequence,13);assert.equal(excess.status,'DRAFT');assert.match(excess.description,/600公里×230分/);
 assert.equal(await h.db.bill.count({where:{orderId,type:'MILEAGE_EXCESS'}}),1);assert.equal(excess.evidenceFileIds.length,2);
 await h.reject(`/admin/bills/${excess.id}/publish`,{},h.finance,'STATE_CONFLICT');
 await h.reject(`/admin/bills/${excess.id}/review`,{decision:'APPROVED',note:'原创建人不可自审'},h.finance,'DUAL_APPROVAL');
 await h.post(`/admin/bills/${excess.id}/review`,{decision:'APPROVED',note:'核验两车真实读数与续期冻结 2400 公里、230 分；不采用换入商品 900 公里、999 分'},h.reviewer);
 await h.post(`/admin/bills/${excess.id}/publish`,{},h.finance);
 const excessPay=await h.post(`/customer/bills/${excess.id}/pay`,{idempotencyKey:randomUUID()},customer);h.payment.capture(excessPay.paymentId);
 const paid=await h.post(`/admin/payments/${excessPay.paymentId}/sync`,{},h.finance);assert.equal(paid.status,'SUCCEEDED');assert.equal(paid.amount,138000);
 await h.post(`/admin/payments/${excessPay.paymentId}/sync`,{},h.finance);assert.equal((await h.db.bill.findUniqueOrThrow({where:{id:excess.id}})).paidAmount,138000);

 // The terminating paper references the actual original and both effective amendments.
 const termination=await readTerminationContext(h.db,await h.db.order.findUniqueOrThrow({where:{id:orderId}}));
 assert.deepEqual(termination.blockers,[]);assert.equal(termination.amendments?.length,2);assert.equal(termination.vehicle?.id,s.targetVehicleId);
 assert.equal(termination.delivery.state,'RETURNED');assert.equal(termination.delivery.source,'PHYSICAL_RECEIPT');assert.equal(termination.delivery.returnId,receipt.id);assert.equal(termination.delivery.readingKm,3150);
 const initial=s.originalSnapshot as any;assert.deepEqual(termination.relevantTerms,{earlyTerminationRule:initial.commercialTerms.earlyTerminationRule,depositRefundRule:initial.commercialTerms.depositRefundRule});
 assert.equal(termination.funds.depositReceivedAmount,50000);assert.equal(termination.funds.depositRefundedAmount,0);
 const rental=await h.db.archiveVersion.findUniqueOrThrow({where:{id:termination.originalContract!.versionId}});assert.equal(termination.originalContract!.number,rental.contractNumber);
 for(const paper of termination.amendments!){const version=await h.db.archiveVersion.findUniqueOrThrow({where:{id:paper.versionId}});assert.equal(paper.number,version.contractNumber);assert.equal(version.status,'ARCHIVED');}
 assert(termination.amendments!.some(paper=>paper.quoteId===s.swapQuoteId));
 const endPaper=await h.archive('TERMINATION','ORDER',orderId);assert.equal((await h.db.documentArchive.findUniqueOrThrow({where:{id:endPaper.archiveId}})).currentApprovedVersionId,endPaper.versionId);
 const deposit=await h.db.bill.findFirstOrThrow({where:{orderId,type:'DEPOSIT'},include:{payments:true}}),depositPayment=deposit.payments.find(row=>row.status==='SUCCEEDED');assert(depositPayment);assert.equal(depositPayment.amount,50000);
 const refundInput={paymentId:depositPayment.id,amount:50000,reason:'合成已核清费用，按原冻结押金条款全额退回',idempotencyKey:randomUUID()};
 const refund=await h.post('/admin/refunds',refundInput,h.finance);assert.equal((await h.post('/admin/refunds',refundInput,h.finance)).id,refund.id);
 await h.reject(`/admin/refunds/${refund.id}/approve`,{},h.finance,'DUAL_APPROVAL');
 assert.equal((await h.post(`/admin/refunds/${refund.id}/approve`,{},h.reviewer)).status,'SUCCEEDED');
 const depositRefunds=await h.db.depositEntry.findMany({where:{orderId,type:'REFUND'}});assert.equal(depositRefunds.length,1);assert.equal(depositRefunds[0].amount,50000);
 const returnSettlement=await h.db.returnSettlement.findUniqueOrThrow({where:{orderId}}),state=await h.get(`/admin/return-settlements/${returnSettlement.id}`,h.finance);
 assert.equal(state.canComplete,true,JSON.stringify(state));assert.equal(state.depositRefundRequiredAmount,0);assert.deepEqual(state.unsettledPeriodIds,[]);assert.deepEqual(state.documentBlockers,[]);
 const closeInput=command(state.revision);await h.post(`/admin/return-settlements/${returnSettlement.id}/complete`,closeInput,h.finance);await h.post(`/admin/return-settlements/${returnSettlement.id}/complete`,closeInput,h.finance);
 const final=await h.db.order.findUniqueOrThrow({where:{id:orderId}}),vehicle=await h.db.vehicle.findUniqueOrThrow({where:{id:s.targetVehicleId}});
 assert.equal(final.status,'COMPLETED');assert.equal(final.currentAssignmentId,null);assert.equal(vehicle.status,'UNPUBLISHED');assert.equal(vehicle.reservedOrderId,null);assert.deepEqual(final.finalPlanSnapshot,s.originalSnapshot);
 const periods=await h.db.usagePeriod.findMany({where:{orderId},orderBy:{sequence:'asc'}});assert.equal(periods.length,24);assert(periods.slice(0,13).every(p=>p.status==='SETTLED'));assert(periods.slice(13).every(p=>p.status==='CANCELLED'&&p.serviceStageId===stageId));
 const billSequences=await serviceBillSequences(h.db,orderId),futureIds=[...billSequences].filter(([,sequence])=>sequence>13).map(([id])=>id);
 assert(futureIds.length>0);assert((await h.db.bill.findMany({where:{id:{in:futureIds}}})).every(b=>b.status==='VOID'&&b.paidAmount===0));
 assert.deepEqual((await h.db.orderServiceStage.findUniqueOrThrow({where:{id:stageId}})).snapshot,s.stageSnapshot);assert.equal(await h.db.orderServiceStage.count({where:{orderId}}),stageCountBefore);
 assert.equal(await h.db.swapLedger.count({where:{orderId,type:'GRANT'}}),grantsBefore);assert.equal(await h.db.swapLedger.count({where:{orderId,type:'CONSUME'}}),1);assert.equal(await h.db.swapCredit.count({where:{orderId,status:'ACTIVE',consumedChangeId:null}}),0,'no unused materialized credit remains usable after final return');
 const consumedCredits=await h.db.swapCredit.findMany({where:{orderId,consumedChangeId:{not:null}}});assert.equal(consumedCredits.length,1);assert.equal(consumedCredits[0].serviceStageId,stageId);assert.equal(consumedCredits[0].source,'FREE');assert.equal(consumedCredits[0].consumedChangeId,(await h.db.delayQuote.findUniqueOrThrow({where:{id:s.swapQuoteId}})).changeId);
 const paidPurchaseAfter=await h.db.swapCreditPurchase.findUniqueOrThrow({where:{id:paidPurchaseBefore.id}});assert.deepEqual(paidPurchaseAfter.pricingSnapshot,paidPurchaseBefore.pricingSnapshot);assert.deepEqual(paidPurchaseAfter.expiresAt,paidPurchaseBefore.expiresAt);
 assert.deepEqual(await h.db.partnerRevenueEvent.findMany({where:{orderId},orderBy:{id:'asc'}}),revenueBefore,'deposit refund and excess payment do not invent subscription revenue');
 const revenue=await readSimpleRevenue(h.db,s.ownerId,{from:'2027-10-01',to:'2027-11-30',vehicleId:s.targetVehicleId});assert(revenue.items.some((row:any)=>row.sourceId===s.upgradePaymentId&&row.amount===645&&row.partnerAmount===516));assert(!revenue.items.some((row:any)=>row.sourceId===excessPay.paymentId));
 const usage=await h.get(`/customer/orders/${orderId}/usage-account`,customer),rights=await h.get(`/customer/orders/${orderId}/swap-account`,customer);
 assert.equal(usage.canPurchase,false);assert.equal(rights.canPurchase,false);assert.equal(rights.canRequest,false);
 const renewal=await h.get(`/admin/orders/${orderId}/renewal-context`);assert.equal(renewal.eligible,false);assert(renewal.blockers.includes('SWAP_STATE'));
 assert.equal(await h.db.orderServiceStage.count({where:{orderId}}),stageCountBefore,'post-return reads never activate or grant another period');
}
