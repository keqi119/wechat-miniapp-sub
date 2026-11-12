import {hasRefundReceipt,refundCashState} from '../billing/refund-proof';
import {readElectronicSwapStage} from './stage-source';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {calculateSwapFacts} from '../contract-terms/swap';
import {financialContext,lockOrder} from '../order-changes/context';
import {day,shanghaiDay} from '../usage/rules';
import {requireOnlineConfirmation} from '../operations/online-handover';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {requireElectronicSwapAgreement} from './electronic-archive';
import {guardElectronicSwapDelivery} from './electronic-delivery';
import {currentSwapReceipt} from './swap-receipt';
import {readSwapServiceFeeSource} from './credits';
import {assertOfflineSwapHandoverSource,requireSwapFieldCompletion} from './offline-physical-source';

const json=(v:any)=>JSON.parse(JSON.stringify(v));
/** A fixed measured delivery version, not assignment completion and not a second ledger. */
export async function settleSwapFacts(tx:any,swapId:string,returnEventId:string,deliveryEventId:string,actorId:string){
 const change=await tx.orderChange.findUnique({where:{id:swapId}});ensure(change,404,'NOT_FOUND');await lockOrder(tx,change.orderId);
 const h=await tx.handover.findUnique({where:{id:deliveryEventId}});ensure(h&&h.changeId===change.id&&change.deliveryHandoverId===h.id,409,'SWAP_FACT_SOURCE_CHANGED');
 const {order,q,receipt}=await guardElectronicSwapDelivery(tx,h);ensure(receipt.id===returnEventId,409,'SWAP_FACT_SOURCE_CHANGED','须引用当前核验过的实际收车版本');
 ensure(h.status==='CUSTOMER_CONFIRMED',409,'ONLINE_CONFIRMATION_REQUIRED');await requireOnlineConfirmation(tx,h);await requireSwapFieldCompletion(tx,h,change,q);
 const account=await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),fee=await readSwapServiceFeeSource(tx,order,account,change.id,h.actualAt,h.vehicleId);
 ensure(canonicalHash(fee)===canonicalHash(q.snapshot.serviceFeeSource)&&fee.amount===q.snapshot.electronicTerms.snapshot.serviceFeeAmount&&fee.alreadyPaidAmount===fee.amount,409,'SWAP_SERVICE_FEE_SOURCE_CHANGED','单次服务费须引用当前已付次数，不可重复收费');
 const serviceStageScope=await readElectronicSwapStage(tx,order,change,q);
 const sourceKey=canonicalHash({quoteId:q.id,termsHash:q.snapshot.electronicTerms.hash,receiptEventId:receipt.id,receiptHash:receipt.factHash,deliveryHandoverId:h.id,deliveryRevision:h.revision,deliveryManifestHash:h.manifestHash});
 const prior=await tx.swapFactSettlement.findUnique({where:{sourceKey}});if(prior)return prior;
 ensure(!await tx.swapFactFinance.findUnique({where:{quoteId:q.id}}),409,'SWAP_FACT_FINANCE_IMMUTABLE','已准备资金的实际版本不可覆盖，请核验原来源');
 const zero=q.snapshot.electronicTerms.snapshot.periods.map((p:any)=>({sequence:p.sequence,netPaidAmount:0,paymentIds:[]})),gross=calculateSwapFacts(q.snapshot.electronicTerms,receipt.receivedAt.toISOString(),h.actualAt.toISOString(),zero);
 const sourceSnapshot=json({version:1,...(serviceStageScope?{serviceStageScope}:{}),orderId:order.id,customerId:order.customerId,changeId:change.id,quoteId:q.id,commercialHash:q.commercialHash,terms:q.snapshot.electronicTerms,receipt:{id:receipt.id,revision:receipt.revision,factHash:receipt.factHash,receivedAt:receipt.receivedAt,readingKm:receipt.readingKm,assignmentId:receipt.assignmentId,evidence:receipt.evidence},delivery:{id:h.id,revision:h.revision,manifestHash:h.manifestHash,actualAt:h.actualAt,readingKm:h.readingKm,vehicleId:h.vehicleId,evidence:h.onlineRecordSnapshot.evidence,confirmation:h.onlineConfirmation},serviceFeeSource:fee,gross});
 const row=await tx.swapFactSettlement.create({data:{orderId:order.id,customerId:order.customerId,changeId:change.id,quoteId:q.id,receiptEventId:receipt.id,deliveryHandoverId:h.id,deliveryRevision:h.revision,deliveryManifestHash:h.manifestHash,termsHash:q.snapshot.electronicTerms.hash,sourceKey,sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot),createdBy:actorId,createdAt:new Date()}});
 await audit(tx,actorId,'PREPARE_SWAP_FACT_SETTLEMENT','order-changes',change.id,{settlementId:row.id,sourceHash:row.sourceHash});return row;
}

export async function requireSwapSettlement(tx:any,id:string,current=false){
 const row=await tx.swapFactSettlement.findUnique({where:{id}});ensure(row&&row.sourceHash===canonicalHash(row.sourceSnapshot),409,'SWAP_FACT_SOURCE_CHANGED');
 const change=await tx.orderChange.findUniqueOrThrow({where:{id:row.changeId}}),q=await tx.delayQuote.findUniqueOrThrow({where:{id:row.quoteId},include:{contract:true}}),order=await tx.order.findUniqueOrThrow({where:{id:row.orderId}}),h=await tx.handover.findUniqueOrThrow({where:{id:row.deliveryHandoverId}}),receipt=await tx.swapReceiptEvent.findUniqueOrThrow({where:{id:row.receiptEventId}}),s=row.sourceSnapshot;
 ensure(order.contractMode==='ELECTRONIC'&&change.orderId===order.id&&change.customerId===row.customerId&&q.changeId===change.id&&q.id===change.activeQuoteId&&s.quoteId===q.id&&s.commercialHash===q.commercialHash&&canonicalHash(s.terms)===canonicalHash(q.snapshot.electronicTerms)&&row.termsHash===s.terms.hash&&receipt.factHash===s.receipt.factHash&&receipt.quoteId===q.id&&h.id===change.deliveryHandoverId&&h.revision===row.deliveryRevision&&h.manifestHash===row.deliveryManifestHash&&h.actualAt?.toISOString()===s.delivery.actualAt&&h.readingKm===s.delivery.readingKm,409,'SWAP_FACT_SOURCE_CHANGED');
 await requireElectronicSwapAgreement(tx,change,q);assertOfflineSwapHandoverSource(h,change,q);await requireOnlineConfirmation(tx,h);
 if(current){ensure(change.status==='SWAP_RETURNED'&&h.status==='CUSTOMER_CONFIRMED'&&(await currentSwapReceipt(tx,change.id))?.id===receipt.id&&(await currentSwapReceipt(tx,change.id,true))?.id===receipt.id,409,'SWAP_FACT_SOURCE_CHANGED');await guardElectronicSwapDelivery(tx,h);}
 const serviceStageScope=await readElectronicSwapStage(tx,order,change,q);
 if(serviceStageScope)ensure(canonicalHash(s.serviceStageScope)===canonicalHash(serviceStageScope),409,'SWAP_STAGE_SOURCE');
 return{row,change,q,order,h,receipt,serviceStageScope};
}

async function settlementFunds(tx:any,source:any){
 const {order,q}=source,current=await financialContext(tx,order);ensure(!current.blockers.length,409,'FUNDS_CHANGED',current.blockers.join('；'));
 const frozen=q.snapshot.electronicTerms.snapshot.periods;
 ensure(current.rows.length===frozen.length&&current.rows.every((r:any)=>frozen.some((p:any)=>p.sequence===r.sequence&&p.startDate===r.startDate&&p.endDate===r.endDate&&p.amount===r.amount)),409,'SWAP_PAYMENT_SOURCE','原期间资金来源已变化');
 for(const row of current.rows)for(const p of row.payments){const paid=await tx.payment.findUniqueOrThrow({where:{id:p.id},include:{bill:true,refunds:true}});ensure(paid.customerId===order.customerId&&paid.bill.customerId===order.customerId&&paid.bill.orderId===order.id&&!['DEPOSIT','DEPOSIT_ADJUSTMENT','SWAP_CREDIT','SWAP_HANDOVER_FEE'].includes(paid.bill.type)&&row.sourceBillIds.includes(paid.billId)&&paid.status==='SUCCEEDED'&&paid.providerTransactionId&&!paid.reconciliationRequired&&paid.refunds.filter((r:any)=>r.status==='SUCCEEDED').every((r:any)=>r.customerId===order.customerId&&r.paymentId===paid.id&&hasRefundReceipt(r)),409,'SWAP_PAYMENT_SOURCE','须核对本期真实租金实收，押金及单次费不可抵用租金');}
 return current.rows;
}
export async function swapSettlementAmounts(tx:any,id:string){
 const source=await requireSwapSettlement(tx,id),posted=await tx.swapFactFinance.findUnique({where:{settlementId:id}});
 const responseHistory=await tx.swapFactAmountResponse.findMany({where:{settlementId:id},orderBy:{revision:'asc'},select:{id:true,revision:true,previousResponseId:true,decision:true,reason:true,sourceHash:true,fundsHash:true,amountHash:true,createdAt:true}}),currentResponse=responseHistory.at(-1)??null,versions={responseRevision:currentResponse?.revision??0,currentResponse,responseHistory};
 if(posted){ensure(canonicalHash(posted.plan)===posted.planHash,409,'SWAP_FACT_SOURCE_CHANGED');return{...source.row,...versions,result:posted.plan.result,fundsHash:posted.plan.fundsHash,amountHash:posted.plan.amountHash,prepared:true,responseId:posted.responseId};}
 const funds=await settlementFunds(tx,source),s=source.row.sourceSnapshot,result=calculateSwapFacts(s.terms,s.receipt.receivedAt,s.delivery.actualAt,funds.map((f:any)=>({sequence:f.sequence,netPaidAmount:f.netPaidAmount,paymentIds:f.payments.map((p:any)=>p.id)}))),fundsHash=canonicalHash(funds),amountHash=canonicalHash({sourceHash:source.row.sourceHash,fundsHash,result});
 return{...source.row,...versions,result,fundsHash,amountHash,prepared:false};
}
export async function respondSwapSettlement(tx:any,id:string,customerId:string,input:any){
 const source=await requireSwapSettlement(tx,id);ensure(source.row.customerId===customerId,404,'NOT_FOUND');await lockOrder(tx,source.order.id);await requireElectronicCustomerIdentity(tx,customerId);
 const requestHash=canonicalHash({id,...input}),action='SWAP_AMOUNT_RESPONSE_'+input.idempotencyKey,record=await tx.auditLog.findFirst({where:{actorId:customerId,actorType:'CUSTOMER',resourceType:'order-changes',resourceId:source.change.id,action}});
 if(record){ensure(record.data.requestHash===requestHash&&record.data.settlementId===id,409,'IDEMPOTENCY_CONFLICT');return tx.swapFactAmountResponse.findUniqueOrThrow({where:{id:record.data.responseId}});}
 const previous=await tx.swapFactAmountResponse.findUnique({where:{customerId_idempotencyKey:{customerId,idempotencyKey:input.idempotencyKey}}});if(previous){ensure(previous.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT');return previous;}
 ensure(!await tx.swapFactFinance.findUnique({where:{settlementId:id}}),409,'SWAP_FACT_FINANCE_IMMUTABLE');await requireSwapSettlement(tx,id,true);
 const current=await swapSettlementAmounts(tx,id);ensure(current.sourceHash===input.sourceHash&&current.fundsHash===input.fundsHash&&current.amountHash===input.amountHash,409,'SWAP_AMOUNT_CHANGED','实际资金或金额已变化，请重新核对');
 const latest=current.currentResponse;
 ensure(input.responseRevision===(latest?.revision??0)&&input.previousResponseId===(latest?.id??null),409,'SWAP_AMOUNT_RESPONSE_CONFLICT','回复版本已变化，请重新查看当前异议或确认');
 if(latest?.amountHash===input.amountHash){
  if(latest.decision===input.decision&&latest.reason===input.reason){await audit(tx,customerId,action,'order-changes',source.change.id,{settlementId:id,responseId:latest.id,requestHash},'CUSTOMER');return tx.swapFactAmountResponse.findUniqueOrThrow({where:{id:latest.id}});}
  ensure(latest.decision==='OBJECT'&&input.decision==='CONFIRM',409,'SWAP_AMOUNT_RESPONSE_FROZEN','当前确认不可覆盖；本人可在核对说明后追加解决当前异议');
  ensure(input.reason.trim(),400,'RESOLUTION_REASON_REQUIRED','请说明已核对的异议及不变金额');
 }
 ensure(input.decision!=='OBJECT'||input.reason.trim(),400,'OBJECTION_REASON_REQUIRED');
 const funds=await settlementFunds(tx,source);ensure(canonicalHash(funds)===current.fundsHash,409,'SWAP_AMOUNT_CHANGED');
 const payments=await tx.payment.findMany({where:{id:{in:funds.flatMap((f:any)=>f.payments.map((p:any)=>p.id))}},include:{refunds:{where:{status:'SUCCEEDED'}}}});
 const fundsSnapshot=json({version:1,funds,paymentReferences:payments.map((p:any)=>({paymentId:p.id,billId:p.billId,customerId:p.customerId,amount:p.amount,transactionId:p.providerTransactionId,succeededAt:p.succeededAt,baselineRefundIds:p.refunds.map((r:any)=>r.id)}))});
 const response=await tx.swapFactAmountResponse.create({data:{settlementId:id,customerId,revision:(latest?.revision??0)+1,previousResponseId:latest?.id??null,sourceHash:input.sourceHash,fundsHash:input.fundsHash,fundsSnapshot,amounts:json(current.result),amountHash:input.amountHash,decision:input.decision,reason:input.reason,idempotencyKey:input.idempotencyKey,requestHash,createdAt:new Date()}});
 await audit(tx,customerId,action,'order-changes',source.change.id,{settlementId:id,responseId:response.id,requestHash},'CUSTOMER');
 await audit(tx,customerId,'RESPOND_SWAP_FACT_AMOUNT','order-changes',source.change.id,{settlementId:id,responseId:response.id,decision:response.decision,amountHash:response.amountHash},'CUSTOMER');return response;
}

/** Two-person financial posting, using only existing obligations, bills and allocations. */
export async function prepareSwapFactFinance(tx:any,change:any,actor:any){
 const staff=await requireCurrentStaff(tx,actor,'order-changes',true);
 ensure(['ADMIN','FINANCE'].includes(staff.role),403,'FORBIDDEN');
 const row=await tx.swapFactSettlement.findFirst({where:{changeId:change.id},orderBy:{createdAt:'desc'}});ensure(row,409,'SWAP_FACT_SETTLEMENT_REQUIRED','须先核验实际收车及本人确认的新车交付版本');
 const source=await requireSwapSettlement(tx,row.id,true),{q,order}=source;
 await assertIndependentStaffReview(tx,staff.id,[row.createdBy,q.createdBy],'TWO_PERSON_REQUIRED');
 const existing=await tx.swapFactFinance.findUnique({where:{quoteId:q.id}});if(existing){ensure(existing.settlementId===row.id&&canonicalHash(existing.plan)===existing.planHash,409,'SWAP_FACT_FINANCE_IMMUTABLE');return existing;}
 const current=await swapSettlementAmounts(tx,row.id),response=await tx.swapFactAmountResponse.findFirst({where:{settlementId:row.id},orderBy:{revision:'desc'}});
 ensure(response?.decision==='CONFIRM'&&response.sourceHash===row.sourceHash&&response.fundsHash===current.fundsHash&&response.amountHash===current.amountHash&&canonicalHash(response.amounts)===canonicalHash(current.result),409,'SWAP_AMOUNT_CONFIRMATION_REQUIRED','须由本人核对当前真实逐期补退金额');
 const scope=source.serviceStageScope;
 const funds=await settlementFunds(tx,source),original=await tx.serviceObligation.findMany({where:{orderId:order.id,active:true,serviceStageId:scope?.serviceStageId??null}}),plan=json({version:1,...(scope?{serviceStageScope:scope}:{}),settlementId:row.id,sourceHash:row.sourceHash,funds,fundsHash:current.fundsHash,result:current.result,amountHash:current.amountHash,responseId:response.id,amountConfirmedAt:response.createdAt,originalObligationIds:original.map((o:any)=>o.id)});
 const posted=await tx.swapFactFinance.create({data:{settlementId:row.id,quoteId:q.id,responseId:response.id,plan,planHash:canonicalHash(plan),preparedBy:actor.id,preparedAt:new Date()}});
 await tx.paymentAllocation.updateMany({where:{obligationId:{in:original.map((o:any)=>o.id)},releasedAt:null},data:{releasedAt:new Date()}});
 let sequence=(await tx.bill.aggregate({where:{orderId:order.id,type:'SWAP_ADJUSTMENT'},_max:{sequence:true}}))._max.sequence??0;
 for(const p of current.result.periods){const fund=funds.find((f:any)=>f.sequence===p.sequence),previous=original.find((o:any)=>o.sequence===p.sequence);ensure(fund,409,'SWAP_PAYMENT_SOURCE');
  const obligation=await tx.serviceObligation.create({data:{orderId:order.id,...(scope?{serviceStageId:scope.serviceStageId,stageSequence:p.sequence-scope.firstPeriodSequence+1}:{}),quoteId:q.id,swapSettlementId:row.id,supersedesObligationId:previous?.id??null,sequence:p.sequence,startDate:new Date(p.startDate),endDate:new Date(p.endDate),dueDate:new Date(p.dueDate),amount:p.amount,sourceBillIds:fund.sourceBillIds,chargeAmount:p.chargeAmount}});
  let carry=p.alreadyPaidCreditAmount;for(const payment of fund.payments){const amount=Math.min(carry,payment.net);carry-=amount;if(amount)await tx.paymentAllocation.create({data:{paymentId:payment.id,obligationId:obligation.id,amount}});}ensure(carry===0,409,'SWAP_PAYMENT_SOURCE');
  await tx.bill.updateMany({where:{id:{in:fund.sourceBillIds},status:{in:['PENDING','DRAFT','REVIEWED']},paidAmount:0},data:{status:'VOID'}});
  if(p.chargeAmount){const bill=await tx.bill.create({data:{orderId:order.id,...(scope?{serviceStageId:scope.serviceStageId}:{}),customerId:order.customerId,type:'SWAP_ADJUSTMENT',sequence:++sequence,amount:p.chargeAmount,dueDate:new Date(p.dueDate),status:'PENDING',description:`实际换车第${p.sequence}期租金：升级${p.upgradeRentAmount}分、无车减租${p.gapReductionAmount}分；单次服务费另有已付来源`,createdBy:row.createdBy,reviewedBy:actor.id,reviewedAt:new Date(),reviewNote:'本人确认真实事实金额，独立财务复核',idempotencyKey:`swap-fact-${row.id}-${p.sequence}`}});await tx.serviceObligation.update({where:{id:obligation.id},data:{chargeBillId:bill.id}});}
 }
 await tx.delayQuote.update({where:{id:q.id},data:{financePreparedAt:posted.preparedAt}});
 await audit(tx,actor.id,'PREPARE_SWAP_FACT_FINANCE','order-changes',change.id,{settlementId:row.id,financeId:posted.id,planHash:posted.planHash,responseId:response.id});return posted;
}

export async function swapFactFinanceView(tx:any,change:any){
 const posted=change.activeQuoteId?await tx.swapFactFinance.findUnique({where:{quoteId:change.activeQuoteId}}):null;
 if(!posted)return{obligations:[],refunds:[],blockers:['尚未核验实际收车、交付及本人确认的逐期金额'],canRetryRefund:false};
 const {row,order,q,serviceStageScope:scope}=await requireSwapSettlement(tx,posted.settlementId),plan=posted.plan;ensure(canonicalHash(plan)===posted.planHash&&plan.sourceHash===row.sourceHash&&canonicalHash(plan.serviceStageScope??null)===canonicalHash(scope),409,'SWAP_FACT_SOURCE_CHANGED');
 const rows=await tx.serviceObligation.findMany({where:{quoteId:q.id},include:{allocations:{where:{releasedAt:null},include:{payment:{include:{refunds:true,bill:true}}}}} as any,orderBy:{sequence:'asc'}});
 const blockers:string[]=[],actualDay=shanghaiDay(new Date(row.sourceSnapshot.delivery.actualAt)),obligations=[];
 ensure(rows.length===plan.result.periods.length,409,'SWAP_FACT_OBLIGATION_CHANGED');
 for(const o of rows){const p=plan.result.periods.find((p:any)=>p.sequence===o.sequence),fund=plan.funds.find((f:any)=>f.sequence===o.sequence);ensure((o.serviceStageId??null)===(scope?.serviceStageId??null)&&(!scope||o.stageSequence===o.sequence-scope.firstPeriodSequence+1)&&o.swapSettlementId===row.id&&p&&o.amount===p.amount&&o.chargeAmount===p.chargeAmount&&day(o.startDate)===p.startDate&&day(o.endDate)===p.endDate&&day(o.dueDate)===p.dueDate&&canonicalHash(o.sourceBillIds)===canonicalHash(fund.sourceBillIds),409,'SWAP_FACT_OBLIGATION_CHANGED');
  const expected=new Map<string,number>();let carry=p.alreadyPaidCreditAmount;
  for(const payment of fund.payments){const amount=Math.min(carry,payment.net);carry-=amount;if(amount)expected.set(payment.id,amount);}ensure(carry===0,409,'SWAP_PAYMENT_SOURCE');
  let allocated=0,chargeReceipts=0;
  for(const a of o.allocations){const paid=a.payment,carried=expected.get(paid.id);
   ensure(paid.customerId===order.customerId&&paid.bill.customerId===order.customerId&&paid.bill.orderId===order.id&&(paid.bill.serviceStageId??null)===(scope?.serviceStageId??null)&&paid.status==='SUCCEEDED'&&paid.providerTransactionId&&!paid.reconciliationRequired&&paid.refunds.filter((r:any)=>r.status==='SUCCEEDED').every((r:any)=>r.customerId===order.customerId&&r.paymentId===paid.id&&hasRefundReceipt(r))&&paid.amount-refundCashState(paid.refunds).actualRefunded>=a.amount,409,'SWAP_PAYMENT_SOURCE');
   if(carried!==undefined){ensure(a.amount===carried&&fund.sourceBillIds.includes(paid.billId)&&!['DEPOSIT','DEPOSIT_ADJUSTMENT','SWAP_CREDIT','SWAP_HANDOVER_FEE'].includes(paid.bill.type),409,'SWAP_PAYMENT_SOURCE');expected.delete(paid.id);}
   else{ensure(++chargeReceipts===1&&o.chargeBillId===paid.billId&&paid.bill.type==='SWAP_ADJUSTMENT'&&(paid.bill.serviceStageId??null)===(o.serviceStageId??null)&&paid.bill.idempotencyKey===`swap-fact-${row.id}-${p.sequence}`&&paid.bill.status==='PAID'&&paid.bill.amount===p.chargeAmount&&paid.bill.paidAmount===p.chargeAmount&&paid.amount===p.chargeAmount&&a.amount===p.chargeAmount,409,'SWAP_PAYMENT_SOURCE');}
   allocated+=a.amount;if(paid.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))blockers.push('租金退款仍待核验');
  }
  ensure(expected.size===0,409,'SWAP_PAYMENT_SOURCE');
  ensure(allocated<=o.amount,409,'SWAP_PAYMENT_SOURCE');if((p.dueDate<=actualDay||p.startDate<=actualDay&&actualDay<p.endDate)&&allocated!==o.amount)blockers.push(`实际交付第${p.sequence}期及已到期租金未核清`);
  obligations.push({id:o.id,serviceStageId:o.serviceStageId??null,stageSequence:o.stageSequence??null,sourceBillIds:o.sourceBillIds,paymentIds:o.allocations.map((a:any)=>a.paymentId),sequence:o.sequence,startDate:p.startDate,endDate:p.endDate,dueDate:p.dueDate,amount:o.amount,allocatedAmount:allocated,chargeBillId:o.chargeBillId,chargeAmount:o.chargeAmount});
 }
 const deposits=await tx.payment.findMany({where:{customerId:order.customerId,status:'SUCCEEDED',bill:{orderId:order.id,type:{in:['DEPOSIT','DEPOSIT_ADJUSTMENT']}}},include:{refunds:true}});const net=deposits.reduce((n:number,p:any)=>n+p.amount-refundCashState(p.refunds).actualRefunded,0);if(net!==q.snapshot.depositAmount||deposits.some((p:any)=>!p.providerTransactionId||p.reconciliationRequired||p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))))blockers.push('原押金真实净额未核清');
 return{settlementId:row.id,sourceHash:row.sourceHash,serviceStageScope:scope,quoteId:q.id,financeId:posted.id,planHash:posted.planHash,cooperation:q.snapshot.targetRevenueRuleSnapshot,amountResponseId:posted.responseId,amountConfirmedAt:plan.amountConfirmedAt,actualDeliveryAt:row.sourceSnapshot.delivery.actualAt,financialReviewRequired:plan.result.rentRefundAmount>0,refundSource:{periods:plan.result.periods.filter((p:any)=>p.refundAmount>0),amountConfirmedAt:plan.amountConfirmedAt,actualDeliveryAt:row.sourceSnapshot.delivery.actualAt,completed:change.status==='APPLIED'},obligations,refunds:[],blockers:[...new Set(blockers)],canRetryRefund:false};
}

/** Exact factual source for new payments and verified late callbacks. */
export async function readSwapFactBillPaymentGuard(tx:any,bill:any,payment?:any,mode:'PAYMENT'|'ALLOCATION'|'HISTORY'='PAYMENT'){
 if(bill.type!=='SWAP_ADJUSTMENT')return null;
 const rows=await tx.serviceObligation.findMany({where:{chargeBillId:bill.id}}),o=rows[0];
 if(!o?.swapSettlementId){ensure(!bill.idempotencyKey?.startsWith('swap-fact-'),409,'SWAP_PAYMENT_SOURCE');return null;}
 const source=await requireSwapSettlement(tx,o.swapSettlementId),posted=await tx.swapFactFinance.findUnique({where:{settlementId:o.swapSettlementId}});
 ensure(rows.length===1&&posted&&canonicalHash(posted.plan)===posted.planHash&&source.q.financePreparedAt&&posted.quoteId===o.quoteId&&o.orderId===bill.orderId&&bill.customerId===source.order.customerId&&bill.orderId===source.order.id&&(mode==='HISTORY'||o.active||source.change.status==='SWAP_RETURNED'),409,'SWAP_PAYMENT_SOURCE');
 const scope=source.serviceStageScope;
 ensure((o.serviceStageId??null)===(scope?.serviceStageId??null)&&(bill.serviceStageId??null)===(scope?.serviceStageId??null)&&(!scope||o.stageSequence===o.sequence-scope.firstPeriodSequence+1),409,'SWAP_PAYMENT_SOURCE');
 const p=posted.plan.result.periods.find((p:any)=>p.sequence===o.sequence),fund=posted.plan.funds.find((p:any)=>p.sequence===o.sequence);
 ensure(p&&fund&&o.amount===p.amount&&o.chargeAmount===p.chargeAmount&&bill.amount===p.chargeAmount&&day(bill.dueDate)===p.dueDate&&day(o.dueDate)===p.dueDate&&day(o.startDate)===p.startDate&&day(o.endDate)===p.endDate&&bill.idempotencyKey===`swap-fact-${source.row.id}-${p.sequence}`&&canonicalHash(o.sourceBillIds)===canonicalHash(fund.sourceBillIds),409,'SWAP_PAYMENT_SOURCE');
 if(mode==='HISTORY')return{...source,obligation:o};
 if(scope){const stage=await tx.orderServiceStage.findUniqueOrThrow({where:{id:scope.serviceStageId}});await(await import('../order-renewals/cancellation-state')).assertRenewalNotCancelling(tx,stage.changeId);}
 ensure(mode==='PAYMENT'?bill.status==='PENDING'&&bill.paidAmount===0:['PENDING','PAID'].includes(bill.status)&&bill.paidAmount===(bill.status==='PAID'?bill.amount:0),409,'SWAP_PAYMENT_SOURCE');
 if(payment)ensure(payment.customerId===bill.customerId&&payment.billId===bill.id&&payment.amount===p.chargeAmount&&!payment.reconciliationRequired,409,'SWAP_PAYMENT_SOURCE');
 const allocations=await tx.paymentAllocation.findMany({where:{obligationId:o.id,releasedAt:null,...(mode==='ALLOCATION'&&payment?{paymentId:{not:payment.id}}:{})},include:{payment:{include:{bill:true,refunds:true}}}}),expected=new Map<string,number>();let carry=p.alreadyPaidCreditAmount;
 for(const paid of fund.payments){const amount=Math.min(carry,paid.net);carry-=amount;if(amount)expected.set(paid.id,amount);}ensure(carry===0&&allocations.length===expected.size,409,'SWAP_PAYMENT_SOURCE');
 for(const a of allocations){const paid=a.payment;ensure(expected.get(paid.id)===a.amount&&paid.status==='SUCCEEDED'&&paid.providerTransactionId&&!paid.reconciliationRequired&&paid.customerId===bill.customerId&&paid.bill.orderId===bill.orderId&&(paid.bill.serviceStageId??null)===(scope?.serviceStageId??null)&&o.sourceBillIds.includes(paid.billId)&&!paid.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))&&paid.amount-refundCashState(paid.refunds).actualRefunded>=a.amount,409,'SWAP_PAYMENT_SOURCE');}
 if(mode==='ALLOCATION'&&payment){const own=await tx.paymentAllocation.findUnique({where:{paymentId_obligationId:{paymentId:payment.id,obligationId:o.id}}});ensure(!own||!own.releasedAt&&own.amount===payment.amount,409,'SWAP_PAYMENT_SOURCE');}
 return{...source,obligation:o};
}
