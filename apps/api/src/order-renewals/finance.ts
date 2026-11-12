import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {collectionBillFact} from '../collections/facts';
import {receiptState} from '../billing/receipt-state';
import {dateOnly} from '../billing/rules';
import {shanghaiDay} from '../usage/rules';
import {readConfirmedRenewalSource,readPreparedRenewalSource,requireRenewalCurrentEligibility,type PreparedRenewalSource,type RenewalSource} from './source';

const cents=(value:any)=>Number.isInteger(value)&&value>=0&&value<=2147483647;
const same=(a:any,b:any)=>canonicalHash(a)===canonicalHash(b);
const sorted=(rows:any[])=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));

async function unusedRange(tx:any,source:RenewalSource){
 const {order,snapshot}=source,stages=await tx.orderServiceStage.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
 ensure(!stages.some((s:any)=>['PREPARED','SCHEDULED'].includes(s.status)||s.id===snapshot.identity.serviceStageId||s.changeId===source.change.id),409,'RENEWAL_FUTURE_EXISTS','已有已准备续期或来源编号已占用');
 const maxima=await Promise.all([tx.usagePeriod.aggregate({where:{orderId:order.id},_max:{sequence:true}}),tx.bill.aggregate({where:{orderId:order.id,type:'SUBSCRIPTION'},_max:{sequence:true}}),tx.serviceObligation.aggregate({where:{orderId:order.id},_max:{sequence:true}})]);
 const last=Math.max(0,...stages.map((s:any)=>s.lastPeriodSequence),...maxima.map(r=>r._max.sequence??0)),nextStage=Math.max(0,...stages.map((s:any)=>s.sequence))+1;
 ensure(last+1===snapshot.period.firstPeriodSequence&&nextStage===snapshot.identity.sequence,409,'RENEWAL_SEQUENCE_CHANGED','已确认的月份或服务段编号被其他事实占用，请人工核对');
}

export async function buildRenewalPreparation(tx:any,changeId:string,now:Date){
 const source=await readConfirmedRenewalSource(tx,changeId),eligibility=await requireRenewalCurrentEligibility(tx,source,now);await unusedRange(tx,source);
 const previewHash=canonicalHash({changeRevision:source.change.revision,orderRevision:source.order.revision,accountRevision:source.account.revision,snapshot:source.snapshot,eligibility});
 return{source,previewHash,view:{changeId,revision:source.change.revision,orderRevision:source.order.revision,accountRevision:source.account.revision,stageId:source.snapshot.identity.serviceStageId,previousStageId:source.snapshot.identity.previousStageId,startDate:source.snapshot.period.startDate,endDate:source.snapshot.period.endDate,periods:source.snapshot.billingSchedule,archiveVersionId:source.agreement.archiveVersionId,commercialHash:source.quote.commercialHash,previewHash}};
}

/** Caller has current FINANCE permission, command deduplication and source locks. No old money is rewritten. */
export async function prepareRenewalFinance(tx:any,source:RenewalSource,actor:any,now:Date){
 const {snapshot:s,quote,order}=source,i=s.identity,p=s.period,a=s.source.agreement,product=s.source.product!;
 const stage=await tx.orderServiceStage.create({data:{id:i.serviceStageId,orderId:i.orderId,customerId:i.customerId,sequence:i.sequence,kind:'RENEWAL',status:'PREPARED',revision:0,previousStageId:i.previousStageId,changeId:a.changeId,quoteId:a.quoteId,priorTermsVersionId:a.priorTermsVersionId,termsVersionId:null,approvedArchiveVersionId:a.approvedArchiveVersionId,vehicleId:i.vehicleId,assignmentId:i.assignmentId,ownerId:i.ownerId,listingId:product.listingId,productVersionId:product.productVersionId,subscriptionPlanId:product.subscriptionPlanId,startDate:dateOnly(p.startDate),endDate:dateOnly(p.endDate),months:p.months,firstPeriodSequence:p.firstPeriodSequence,lastPeriodSequence:p.lastPeriodSequence,...(s.serviceAnchor?{serviceAnchor:s.serviceAnchor}:{}),snapshot:s,snapshotHash:canonicalHash(s),createdBy:actor.id}});
 for(const row of s.billingSchedule){
  const bill=await tx.bill.create({data:{orderId:order.id,customerId:order.customerId,serviceStageId:stage.id,type:'SUBSCRIPTION',sequence:row.sequence,amount:row.amount,paidAmount:0,dueDate:dateOnly(row.dueDate),status:'PENDING',description:`续期第${row.stageSequence}期（全单第${row.sequence}期）`,createdBy:quote.createdBy,reviewedBy:quote.reviewedBy,reviewedAt:now,reviewNote:quote.reviewNote,idempotencyKey:`renewal:${quote.id}:${row.sequence}`}});
  await tx.serviceObligation.create({data:{orderId:order.id,quoteId:quote.id,serviceStageId:stage.id,stageSequence:row.stageSequence,sequence:row.sequence,startDate:dateOnly(row.startDate),endDate:dateOnly(row.endDate),dueDate:dateOnly(row.dueDate),amount:row.amount,sourceBillIds:[],chargeBillId:bill.id,chargeAmount:row.amount,active:false}});
 }
 await tx.delayQuote.update({where:{id:quote.id},data:{approvedArchiveVersionId:a.approvedArchiveVersionId,financePreparedAt:now}});return stage;
}

/** Read all current receipts including unknown outcomes; a PAID historical refund is not a new debt. */
export async function readRenewalFunding(tx:any,source:PreparedRenewalSource,now:Date){
 const {order,stage,snapshot}=source,today=shanghaiDay(now),blockers=new Set<string>();
 const bills=await tx.bill.findMany({where:{orderId:order.id},include:{payments:{include:{refunds:true}}},orderBy:{id:'asc'}});
 const obligations=await tx.serviceObligation.findMany({where:{orderId:order.id},include:{allocations:{where:{releasedAt:null},include:{payment:{include:{refunds:true}}}}},orderBy:{id:'asc'}});
 const facts=bills.map((b:any)=>collectionBillFact(b,order,today)),payments=bills.flatMap((b:any)=>b.payments||[]),paymentIds=payments.map((p:any)=>p.id),allAllocations=await tx.paymentAllocation.findMany({where:{paymentId:{in:paymentIds},releasedAt:null}});
 const seenPayments=new Set<string>(),seenChannels=new Set<string>(),seenRefunds=new Set<string>(),seenRefundChannels=new Set<string>();
 for(const fact of facts)for(const code of fact.blockers)blockers.add(`MONEY_${code}`);
 for(const p of payments){
  if(seenPayments.has(p.id)||p.providerTransactionId&&seenChannels.has(p.providerTransactionId))blockers.add('MONEY_DUPLICATE_FACT');seenPayments.add(p.id);if(p.providerTransactionId)seenChannels.add(p.providerTransactionId);
  for(const r of p.refunds||[]){if(seenRefunds.has(r.id)||r.providerRefundId&&seenRefundChannels.has(r.providerRefundId))blockers.add('MONEY_DUPLICATE_FACT');seenRefunds.add(r.id);if(r.providerRefundId)seenRefundChannels.add(r.providerRefundId);}
  const allocations=allAllocations.filter((a:any)=>a.paymentId===p.id);if(allocations.some((a:any)=>!cents(a.amount))||allocations.reduce((n:bigint,a:any)=>n+(cents(a.amount)?BigInt(a.amount):0n),0n)>BigInt(receiptState(p).retained))blockers.add('RENEWAL_ALLOCATION_INVALID');
 }
 const validFullReceipt=(bill:any)=>{
  const fact=facts.find((f:any)=>f.billId===bill?.id);if(!bill||!fact||fact.blockers.length||bill.status!=='PAID'||bill.paidAmount!==bill.amount)return false;
  const net=bill.payments.filter((p:any)=>p.status==='SUCCEEDED').reduce((n:bigint,p:any)=>n+BigInt(receiptState(p).retained),0n);return net===BigInt(bill.amount);
 };
 const validateAllocations=(o:any,billId?:string)=>{
  if(o.orderId!==order.id||!Array.isArray(o.sourceBillIds)||!Array.isArray(o.allocations))return false;
  const allowed=new Set(billId?[billId]:[...o.sourceBillIds,...(o.chargeBillId?[o.chargeBillId]:[])]);
  if(o.allocations.some((a:any)=>{
   const payment=payments.find((p:any)=>p.id===a.paymentId),record=allAllocations.find((r:any)=>r.id===a.id);
   return!cents(a.amount)||a.obligationId!==o.id||!payment||!a.payment||!same(a.payment,payment)||!record||record.paymentId!==a.paymentId||record.obligationId!==o.id||record.amount!==a.amount||payment.customerId!==order.customerId||!allowed.has(payment.billId)||payment.status!=='SUCCEEDED'||payment.reconciliationRequired||!receiptState(payment).valid||receiptState(payment).pending;
  }))return false;
  return o.allocations.reduce((n:bigint,a:any)=>n+BigInt(a.amount),0n)===BigInt(o.amount);
 };
 const stageBills=bills.filter((b:any)=>b.serviceStageId===stage.id),stageObligations=obligations.filter((o:any)=>o.serviceStageId===stage.id);
 if(stageBills.length!==snapshot.period.months||stageObligations.length!==snapshot.period.months)blockers.add('RENEWAL_FINANCE_ROWS_MISSING');
 const rows=snapshot.billingSchedule.map(row=>{
  const matches=stageBills.filter((b:any)=>b.type==='SUBSCRIPTION'&&b.sequence===row.sequence),bill=matches[0],os=stageObligations.filter((o:any)=>o.sequence===row.sequence&&o.stageSequence===row.stageSequence),o=os[0];
  const exact=matches.length===1&&os.length===1&&bill.customerId===order.customerId&&bill.amount===row.amount&&bill.dueDate.toISOString().slice(0,10)===row.dueDate&&bill.idempotencyKey===`renewal:${source.quote.id}:${row.sequence}`&&o.orderId===order.id&&o.quoteId===source.quote.id&&o.chargeBillId===bill.id&&o.amount===row.amount&&o.chargeAmount===row.amount&&Array.isArray(o.sourceBillIds)&&o.sourceBillIds.length===0&&o.startDate.toISOString().slice(0,10)===row.startDate&&o.endDate.toISOString().slice(0,10)===row.endDate&&o.dueDate.toISOString().slice(0,10)===row.dueDate&&o.active===false;
  if(!exact)blockers.add('RENEWAL_FINANCE_ROWS_MISMATCH');
  const funded=!!exact&&validFullReceipt(bill)&&validateAllocations(o,bill.id);if(row.stageSequence===1&&!funded)blockers.add('RENEWAL_FIRST_PAYMENT_REQUIRED');
  return{sequence:row.sequence,stageSequence:row.stageSequence,amount:row.amount,dueDate:row.dueDate,billId:bill?.id??null,status:bill?.status??null,paidAmount:bill?.paidAmount??0,funded};
 });
 const expectedDeposit=order.finalPlanSnapshot.depositAmount,depositBills=bills.filter((b:any)=>b.type==='DEPOSIT'&&b.status!=='VOID');
 if(!cents(expectedDeposit)||depositBills.reduce((n:bigint,b:any)=>n+(cents(b.amount)?BigInt(b.amount):0n),0n)!==BigInt(expectedDeposit)||depositBills.some((b:any)=>b.amount>0&&!validFullReceipt(b)))blockers.add('RENEWAL_DEPOSIT_REQUIRED');
 const oldDue=facts.filter((f:any)=>!stageBills.some((b:any)=>b.id===f.billId)&&f.type!=='DEPOSIT'&&f.status==='PENDING'&&f.dueDate<=today&&f.outstandingAmount!==0);if(oldDue.length)blockers.add('RENEWAL_PRIOR_DUE_REQUIRED');
 for(const o of obligations.filter((o:any)=>o.serviceStageId!==stage.id&&o.active&&o.dueDate.toISOString().slice(0,10)<=today))if(!cents(o.amount)||!validateAllocations(o))blockers.add('RENEWAL_PRIOR_OBLIGATION_REQUIRED');
 const sourceHash=canonicalHash({stageId:stage.id,snapshotHash:stage.snapshotHash,today,bills:facts.map((f:any)=>f.sourceSnapshot).sort((a:any,b:any)=>a.billId.localeCompare(b.billId)),obligations:sorted(obligations).map((o:any)=>({id:o.id,orderId:o.orderId,quoteId:o.quoteId,serviceStageId:o.serviceStageId??null,stageSequence:o.stageSequence??null,sequence:o.sequence,startDate:o.startDate,endDate:o.endDate,dueDate:o.dueDate,amount:o.amount,chargeBillId:o.chargeBillId,chargeAmount:o.chargeAmount,sourceBillIds:o.sourceBillIds,active:o.active})),allocations:sorted(allAllocations).map((a:any)=>({id:a.id,paymentId:a.paymentId,obligationId:a.obligationId,amount:a.amount,releasedAt:a.releasedAt??null}))});
 return{ready:blockers.size===0,blockers:[...blockers].sort(),sourceHash,rows,depositAmount:expectedDeposit,priorDueBillIds:oldDue.map((f:any)=>f.billId)};
}

export async function buildRenewalSchedule(tx:any,changeId:string,now:Date){
 const stage=await tx.orderServiceStage.findFirst({where:{changeId}});ensure(stage,409,'RENEWAL_PREPARATION_REQUIRED','须先准备续期财务安排');
 const source=await readPreparedRenewalSource(tx,stage.id);ensure(source.change.id===changeId&&source.change.activeQuoteId===source.quote.id&&source.change.status==='AWAITING_FINANCE'&&source.stage.status==='PREPARED',409,'RENEWAL_STAGE_STATE','当前续期不能安排待生效');
 const eligibility=await requireRenewalCurrentEligibility(tx,source,now),funding=await readRenewalFunding(tx,source,now),previewHash=canonicalHash({changeRevision:source.change.revision,orderRevision:source.order.revision,accountRevision:source.account.revision,stageId:source.stage.id,stageRevision:source.stage.revision,snapshotHash:source.stage.snapshotHash,eligibility,fundingHash:funding.sourceHash});
 return{source,funding,previewHash,view:{changeId,revision:source.change.revision,orderRevision:source.order.revision,accountRevision:source.account.revision,stageId:source.stage.id,stageRevision:source.stage.revision,status:source.stage.status,startDate:source.snapshot.period.startDate,endDate:source.snapshot.period.endDate,ready:funding.ready,blockers:funding.blockers,rows:funding.rows,depositAmount:funding.depositAmount,priorDueBillIds:funding.priorDueBillIds,previewHash}};
}
