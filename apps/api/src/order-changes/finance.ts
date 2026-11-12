import {prepareSwapFactFinance,swapFactFinanceView,readSwapFactBillPaymentGuard} from '../vehicle-changes/fact-settlement';
import {billFundsReady} from '../billing/receipt-state';
import {financeQuoteId} from '../vehicle-changes/recovery';
import {prepareSwapAdjustments,swapFinanceView} from '../vehicle-changes/finance';
import { ensure } from '../common/errors';
import { hash,audit } from '../common/data';
import { dateOnly } from '../billing/rules';
import { financialContext, terminal,requireOfflineDelayFacts } from './context';
import {requireChangeAgreementReady} from './agreement-readiness';
import {requireOfflineSwapFacts} from '../vehicle-changes/offline-facts';
import {assertOfflineSwapQuote,requireOfflineSwapTarget} from '../vehicle-changes/offline-target';
import {readOfflineSwapFunds,appendOfflineSwapMoneyBlockers} from '../vehicle-changes/offline-money';
import {canonicalHash} from '../customers/types';
import {readRenewalPaymentGuard,allocateRenewalPayment} from '../order-renewals/payment';
import {readStageSwapBillPaymentGuard} from '../billing/stage-payments';
function canonical(value:any):any{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
export async function guardDelayPayment(tx:any,bill:any){
  await tx.order.update({where:{id:bill.orderId},data:{revision:{increment:1}}});
  return readDelayPaymentGuard(tx,bill);
}
/** No revision writes: useful for display and callers already holding the order lock. */
export async function readDelayPaymentGuard(tx:any,bill:any){
  if(await readSwapFactBillPaymentGuard(tx,bill))return;
  if(await readRenewalPaymentGuard(tx,bill))return;
  if(await readStageSwapBillPaymentGuard(tx,bill))return;
  const active=await tx.orderChange.findFirst({where:{orderId:bill.orderId,status:{notIn:terminal}}});
  if(!active)return;
  // Future renewal bills have their own immutable source. Existing period money remains valid.
  if(active.kind==='SUBSCRIPTION_EXTENSION')return;
  // SWAP_CREDIT is independently consented and already checked by guardSwapPayment.
  if(bill.type==='SWAP_CREDIT'&&active.kind==='VEHICLE_CHANGE')return;
  ensure(active.activeQuoteId,409,'ORDER_CHANGE_PAYMENT_BLOCKED','订单正在变更，尚无已签资金方案');const financialId=financeQuoteId(await tx.delayQuote.findUniqueOrThrow({where:{id:active.activeQuoteId}}));
  ensure(['AWAITING_FINANCE','SWAP_RETURNED','READY'].includes(active.status)&&(bill.type==='DEPOSIT'||(active.kind==='VEHICLE_CHANGE'&&bill.idempotencyKey?.startsWith(`swap-${financialId}-`))||await tx.serviceObligation.count({where:{quoteId:financialId,chargeBillId:bill.id}})),409,'ORDER_CHANGE_PAYMENT_BLOCKED','订单正在变更，请按已签补充协议的新账单付款');
}
export async function allocateDelayPayment(tx:any,payment:any){
  if(payment.bill?.serviceStageId&&await allocateRenewalPayment(tx,payment))return;
  const obligation=await tx.serviceObligation.findFirst({where:{chargeBillId:payment.billId}});if(!obligation)return;
  await tx.order.update({where:{id:obligation.orderId},data:{revision:{increment:1}}});
  ensure(payment.amount===obligation.chargeAmount,409,'ALLOCATION_MISMATCH','付款与补充协议补收金额不一致');
  await tx.paymentAllocation.upsert({where:{paymentId_obligationId:{paymentId:payment.id,obligationId:obligation.id}},create:{paymentId:payment.id,obligationId:obligation.id,amount:payment.amount},update:{}});
}
export async function prepareFinance(tx:any,change:any,actor:any){
  ensure(change.status==='AWAITING_FINANCE'||change.kind==='VEHICLE_CHANGE'&&change.status==='SWAP_RETURNED',409,'CHANGE_STATE','须先完成补充协议签署');
  const quote=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId},include:{contract:true}});
  const agreementOrder=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});
  if(agreementOrder.contractMode==='ELECTRONIC')return prepareSwapFactFinance(tx,change,actor);
  if(agreementOrder.contractMode==='OFFLINE'){
    if(change.kind==='VEHICLE_CHANGE'){assertOfflineSwapQuote(change,quote);await requireOfflineSwapFacts(tx,agreementOrder,change,new Date(),!!quote.snapshot.previousPreparedQuoteId);await requireOfflineSwapTarget(tx,agreementOrder,change,quote,new Date(quote.snapshot.plannedDeliveryAt));}else{ensure(change.kind==='DELIVERY_DELAY',409,'CHANGE_KIND','变更种类不支持');await requireOfflineDelayFacts(tx,agreementOrder,change);}
    const agreement=await requireChangeAgreementReady(tx,change.id);ensure(agreement.mode==='OFFLINE',409,'AGREEMENT_OFFLINE_REQUIRED','线下补充协议证据不匹配');
    ensure(!quote.financePreparedAt||quote.approvedArchiveVersionId===agreement.archiveVersionId,409,'AGREEMENT_ARCHIVE_PIN_REQUIRED','原资金安排缺少一致的纸质档案版本');
    if(!quote.approvedArchiveVersionId)await tx.delayQuote.update({where:{id:quote.id},data:{approvedArchiveVersionId:agreement.archiveVersionId}});
  }else ensure(quote.contract?.status==='SIGNED',409,'SIGNATURE_REQUIRED','补充协议尚未签署完成');
  if(quote.snapshot.pricingVersion===2){
    ensure(!quote.snapshot.financeSourceQuoteId,409,'SWAP_FINANCE_SOURCE','自动计价不得借用旧资金复用路径');
    if(quote.financePreparedAt)await readOfflineSwapFunds(tx,agreementOrder,change,quote.id,quote.revision+1);
  }
  if(quote.snapshot.financeSourceQuoteId){const source=await tx.delayQuote.findUniqueOrThrow({where:{id:financeQuoteId(quote)},include:{contract:true}});ensure(source.changeId===change.id&&source.contract?.status==='SIGNED'&&source.financePreparedAt,409,'FINANCE_SOURCE_INVALID','原已签资金映射不完整');const financial=await financeView(tx,change);ensure(!financial.blockers.length,409,'FINANCE_UNRESOLVED',financial.blockers.join('；'));await tx.delayQuote.update({where:{id:quote.id},data:{financePreparedAt:new Date()}});return;}
  if(change.kind==='VEHICLE_CHANGE')await prepareSwapAdjustments(tx,change,quote,actor);
  if(quote.financePreparedAt){
    for(const source of quote.fundsSnapshot){for(const payment of source.payments){
      const assigned=await tx.paymentAllocation.aggregate({where:{paymentId:payment.id,obligation:{quoteId:quote.id},releasedAt:null},_sum:{amount:true}});
      const all=await tx.refund.findMany({where:{paymentId:payment.id}});
      const outstanding=payment.amount-all.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0)-(assigned._sum.amount||0);
      if(outstanding<=0||all.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))continue;
      ensure(all.some((r:any)=>r.idempotencyKey?.startsWith(`delay-${quote.id}-`)&&['FAILED','REJECTED'].includes(r.status)),409,'REFUND_RETRY_STATE','退款缺少可核验的失败记录');
      await tx.refund.create({data:{paymentId:payment.id,customerId:change.customerId,amount:outstanding,reason:`延期补充协议 ${quote.id} 失败退款重新申请`,requestedBy:actor.id,idempotencyKey:`delay-${quote.id}-${payment.id}-${all.length}`}});
    }}return;
  }
  const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});let current=await financialContext(tx,order);
  if(quote.snapshot.pricingVersion===2&&quote.snapshot.previousPreparedQuoteId!=null){const funds=await readOfflineSwapFunds(tx,order,change,quote.snapshot.previousPreparedQuoteId,quote.revision);ensure(quote.snapshot.preparedSourceHash===funds.sourceHash&&canonicalHash(quote.snapshot.preparedSources)===canonicalHash(funds.sources),409,'SWAP_FINANCE_SOURCE','已确认的原财务来源链已变化');current={...current,rows:funds.rows};}
  ensure(current.blockers.length===0&&hash(canonical(current.rows))===hash(canonical(quote.fundsSnapshot)),409,'FUNDS_CHANGED','实际收退款已变化，请人工核对已签方案，不能按旧资金快照执行');
  const stageScope=current.serviceStageScope;
  await tx.paymentAllocation.updateMany({where:{obligation:{orderId:order.id,...(stageScope?{serviceStageId:stageScope.serviceStageId}:{})},releasedAt:null},data:{releasedAt:new Date()}});
  const adjustmentType=change.kind==='VEHICLE_CHANGE'?'SWAP_ADJUSTMENT':'DELAY_ADJUSTMENT';let next=(await tx.bill.aggregate({where:{orderId:order.id,type:adjustmentType},_max:{sequence:true}}))._max.sequence||0;
  for(const row of quote.snapshot.periods){
    const source=current.rows.find((p:any)=>p.sequence===row.sequence)!;
    const obligation=await tx.serviceObligation.create({data:{orderId:order.id,quoteId:quote.id,...(stageScope?{serviceStageId:stageScope.serviceStageId,stageSequence:row.stageSequence}:{}),sequence:row.sequence,startDate:dateOnly(row.startDate),endDate:dateOnly(row.endDate),dueDate:dateOnly(row.dueDate),amount:row.amount,sourceBillIds:source.sourceBillIds,chargeAmount:row.chargeAmount}});
    let carry=row.carryAmount;
    for(const payment of source.payments){const assigned=Math.min(carry,payment.net);carry-=assigned;
      if(assigned>0)await tx.paymentAllocation.create({data:{paymentId:payment.id,obligationId:obligation.id,amount:assigned}});
      const refund=payment.net-assigned;if(refund>0)await tx.refund.create({data:{paymentId:payment.id,customerId:order.customerId,amount:refund,reason:`延期补充协议 ${quote.id} 第${row.sequence}期原路退回`,requestedBy:actor.id,idempotencyKey:`delay-${quote.id}-${payment.id}`}});
    }
    // Historical paid bills are never rewritten. Only definitely unstarted bills
    // are voided; outstanding channel states were rejected before this point.
    await tx.bill.updateMany({where:{id:{in:source.sourceBillIds},status:{in:['PENDING','DRAFT','REVIEWED']},paidAmount:0},data:{status:'VOID'}});
    if(row.chargeAmount>0){const bill=await tx.bill.create({data:{orderId:order.id,customerId:order.customerId,type:adjustmentType,...(stageScope?{serviceStageId:stageScope.serviceStageId}:{}),sequence:++next,amount:row.chargeAmount,dueDate:dateOnly(row.dueDate),status:'PENDING',description:`${change.kind==='VEHICLE_CHANGE'?'换车':'延期'}补充协议第${row.sequence}期：${row.calculationBasis}`,createdBy:quote.createdBy,reviewedBy:quote.reviewedBy,reviewedAt:new Date(),reviewNote:quote.reviewNote,idempotencyKey:`delay-${quote.id}-${row.sequence}`}});await tx.serviceObligation.update({where:{id:obligation.id},data:{chargeBillId:bill.id}});}
  }
  await tx.delayQuote.update({where:{id:quote.id},data:{financePreparedAt:new Date()}});
  if(agreementOrder.contractMode==='OFFLINE'&&change.kind==='VEHICLE_CHANGE'&&change.returnHandoverId)await tx.orderChange.update({where:{id:change.id},data:{status:'SWAP_RETURNED'}});
}
export async function financeView(tx:any,change:any){
  if(change.activeQuoteId&&(await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}})).snapshot.executionMode==='ELECTRONIC')return swapFactFinanceView(tx,change);
  if(!change.activeQuoteId)return{obligations:[],refunds:[],blockers:[],canRetryRefund:false};
  const quote=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}}),financialId=financeQuoteId(quote);
  const rows=await tx.serviceObligation.findMany({where:{quoteId:financialId},include:{allocations:{where:{releasedAt:null}}},orderBy:{sequence:'asc'}});
  const refunds=await tx.refund.findMany({where:{idempotencyKey:{startsWith:`delay-${financialId}-`}}});
  const bills=await tx.bill.findMany({where:{orderId:change.orderId},include:{payments:{include:{refunds:true}}}}), blockers:string[]=[];
  const expected=(quote.snapshot as any).periods.reduce((n:number,p:any)=>n+p.refundAmount,0)+(change.kind==='VEHICLE_CHANGE'?(quote.snapshot as any).depositRefundAmount:0),refunded=refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0);
  if(refunded!==expected||refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)))blockers.push('原路退款尚未全部可信完成');
  if(bills.some((b:any)=>b.payments.some((p:any)=>['CREATING','PENDING'].includes(p.status))))blockers.push('仍有渠道未确认的付款');
  const obligations=rows.map((o:any)=>({sequence:o.sequence,...(o.serviceStageId?{serviceStageId:o.serviceStageId,stageSequence:o.stageSequence}:{}),startDate:o.startDate.toISOString().slice(0,10),endDate:o.endDate.toISOString().slice(0,10),dueDate:o.dueDate.toISOString().slice(0,10),amount:o.amount,allocatedAmount:o.allocations.reduce((n:number,a:any)=>n+a.amount,0),chargeBillId:o.chargeBillId,chargeAmount:o.chargeAmount,chargeStatus:bills.find((b:any)=>b.id===o.chargeBillId)?.status??null}));
  if(change.kind==='VEHICLE_CHANGE')await appendOfflineSwapMoneyBlockers(tx,change,quote,obligations,blockers);
  if(!obligations.length)blockers.push('尚未准备资金安排');
  if(change.kind!=='VEHICLE_CHANGE'&&obligations[0]&&obligations[0].allocatedAmount!==obligations[0].amount)blockers.push('首期应收尚未全部到账');
  const deposit=change.kind==='VEHICLE_CHANGE'?[]:bills.filter((b:any)=>b.type==='DEPOSIT');if(deposit.some((b:any)=>!billFundsReady(b)))blockers.push('原约定押金尚未足额到账');
  return{...(change.kind==='VEHICLE_CHANGE'?await swapFinanceView(tx,change,quote,bills,obligations,blockers):{}),obligations,refunds:refunds.map((r:any)=>({id:r.id,amount:r.amount,status:r.status,paymentId:r.paymentId})),blockers,canRetryRefund:refunded<expected&&!refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))&&refunds.some((r:any)=>['FAILED','REJECTED'].includes(r.status))};
}
export async function applyDelay(tx:any,change:any){
  ensure(change.kind!=='VEHICLE_CHANGE'&&change.status==='AWAITING_FINANCE',409,'CHANGE_STATE','换车须完成两侧物理交接，不能直接生效');
  const finance=await financeView(tx,change);ensure(finance.blockers.length===0,409,'FINANCE_UNRESOLVED',finance.blockers.join('；'));
  const q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId},include:{contract:true}}),order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}});let offlineArchiveVersionId:string|undefined;
  if(order.contractMode==='OFFLINE'){
    await requireOfflineDelayFacts(tx,order,change);const agreement=await requireChangeAgreementReady(tx,change.id);
    ensure(agreement.mode==='OFFLINE'&&q.financePreparedAt&&q.approvedArchiveVersionId===agreement.archiveVersionId,409,'AGREEMENT_ARCHIVE_PIN_REQUIRED','须核验原资金准备所固定的纸质补充协议');offlineArchiveVersionId=agreement.archiveVersionId;
  }else ensure(q.contract?.status==='SIGNED',409,'SIGNATURE_REQUIRED','补充协议未完成');
  ensure(!(await tx.usageAccount.findUnique({where:{orderId:change.orderId}})),409,'ALREADY_DELIVERED','订单已实际交车');
  const version=((await tx.orderTermsVersion.aggregate({where:{orderId:change.orderId},_max:{version:true}}))._max.version||0)+1;
  const snapshot={...change.priorTerms,startDate:q.snapshot.newStartDate,firstDueDate:q.snapshot.periods[0].dueDate,monthlyAmounts:q.snapshot.periods.map((p:any)=>p.amount),billingSchedule:q.snapshot.periods,commercialHash:q.commercialHash,amendmentContractId:q.contract.id};
  const terms=await tx.orderTermsVersion.create({data:{orderId:change.orderId,quoteId:q.id,version,snapshot,hash:q.commercialHash,effectiveAt:new Date(),...(offlineArchiveVersionId?{offlineArchiveVersionId}:{})}});
  await tx.serviceObligation.updateMany({where:{orderId:change.orderId,active:true},data:{active:false}});
  await tx.serviceObligation.updateMany({where:{quoteId:q.id},data:{active:true}});
  const oldHandovers=await tx.handover.findMany({where:{orderId:change.orderId,type:'DELIVERY',status:{notIn:['COMPLETED','SUPERSEDED']}}});for(const old of oldHandovers)await audit(tx,'order-change','SUPERSEDED_BY_SIGNED_DELAY','handovers',old.id,{changeId:change.id,quoteId:q.id,originalManifestHash:old.manifestHash,originalActualAt:old.actualAt},'SYSTEM');
  await tx.handover.updateMany({where:{orderId:change.orderId,type:'DELIVERY',status:{notIn:['COMPLETED','SUPERSEDED']}},data:{status:'SUPERSEDED'}});
  await tx.order.update({where:{id:change.orderId},data:{effectiveTermsVersionId:terms.id,status:'AWAITING_HANDOVER'}});
  await tx.orderChange.update({where:{id:change.id},data:{status:'APPLIED',appliedAt:new Date()}});
}
