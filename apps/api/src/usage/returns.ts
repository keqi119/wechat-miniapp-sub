import {serviceBillSequences} from '../order-changes/obligations';
import { Prisma } from '@prisma/client';
import { ensure } from '../common/errors';
import { audit, hash } from '../common/data';
import { day, shanghaiDay, lockAccount } from './rules';
import { voidUnpaidQuotes, expireRemainingPacks } from './ledger';
export async function recordUsageReturn(tx:Prisma.TransactionClient,order:any,handover:any){
  const a=await lockAccount(tx,order.id);ensure(!a.returnedOn&&handover.actualAt&&handover.actualAt<=new Date(Date.now()+300000),409,'RETURN_DATE_REQUIRED','须有真实归还时间且不可重复归还');
  const date=new Date(shanghaiDay(handover.actualAt));ensure(date>=a.startedOn,409,'RETURN_DATE_REQUIRED','归还时间不可早于交车');
  const periods=await tx.usagePeriod.findMany({where:{accountId:a.id},orderBy:{sequence:'asc'}});
  ensure(periods.every(p=>p.endReadingKm===null||p.endReadingKm<=handover.readingKm),409,'RETURN_READING_CONFLICT','归还读数低于已核验月读数，请先更正未结算证据');
  const last=periods.find(p=>p.startDate<=date&&date<p.endDate)||periods.find(p=>p.endDate.getTime()===date.getTime());ensure(last,409,'RETURN_OUTSIDE_TERM','超出约定订阅期，须先人工确认续期与费用');
  ensure(last.status!=='SETTLED'&&periods.every(p=>p.sequence<=last.sequence||p.status==='OPEN'),409,'RETURN_PERIOD_CONFLICT','归还时间与已提交或结算的月份冲突');
  await tx.usagePeriod.update({where:{id:last.id},data:{effectiveEndDate:date,status:'AWAITING_READING',readingId:null,endReadingKm:null,reviewNote:'请提交与归还交接相同读数的仪表照片',revision:{increment:1}}});
  await tx.usagePeriod.updateMany({where:{accountId:a.id,sequence:{gt:last.sequence}},data:{status:'CANCELLED',revision:{increment:1}}});
  await tx.usageAccount.update({where:{id:a.id},data:{returnedOn:date,returnReadingKm:handover.readingKm,packStatus:'FROZEN'}});
  return tx.returnSettlement.create({data:{accountId:a.id,orderId:order.id,customerId:order.customerId,returnedOn:date}});
}
export async function returnView(tx:Prisma.TransactionClient,record:any,financial=false){
  const a=await tx.usageAccount.findUniqueOrThrow({where:{id:record.accountId}}),periods=await tx.usagePeriod.findMany({where:{accountId:a.id,status:{notIn:['SETTLED','CANCELLED']}}});
  const bills=await tx.bill.findMany({where:{orderId:record.orderId},include:{payments:{include:{refunds:true}}},orderBy:[{type:'asc'},{sequence:'asc'}]});
  const pending=bills.some(b=>b.payments.some(p=>['CREATING','PENDING'].includes(p.status)||p.refunds.some(r=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))));
  const depositRefundRequiredAmount=bills.filter(b=>b.type==='DEPOSIT').reduce((n,b)=>n+b.paidAmount-b.payments.flatMap(p=>p.refunds).filter(r=>r.status==='SUCCEEDED').reduce((s,r)=>s+r.amount,0),0);
  const max=await tx.usagePeriod.aggregate({where:{accountId:a.id,status:{not:'CANCELLED'}},_max:{sequence:true}});
  const sequences=await serviceBillSequences(tx,record.orderId);const future=bills.filter(b=>(sequences.get(b.id)||0)>(max._max.sequence||0));
  const futureUnrefunded=future.some(b=>b.paidAmount>b.payments.flatMap(p=>p.refunds).filter(r=>r.status==='SUCCEEDED').reduce((s,r)=>s+r.amount,0));
  const invalidPacks=await tx.mileagePurchase.count({where:{accountId:a.id,applicableFromSequence:{gt:max._max.sequence||0},status:{notIn:['VOID','REFUNDED']}}});
  const frozen=await tx.mileagePurchase.count({where:{accountId:a.id,status:'REFUND_PENDING'}});
  const unpaid=bills.some(b=>!future.some(f=>f.id===b.id)&&!['PAID','VOID'].includes(b.status));
  return{id:record.id,orderId:record.orderId,status:record.status,revision:record.revision,returnedOn:day(record.returnedOn),unsettledPeriodIds:periods.map(p=>p.id),bills:bills.map(b=>({id:b.id,type:b.type,amount:b.amount,paidAmount:b.paidAmount,status:b.status,dueDate:day(b.dueDate),description:b.description})),disputeReason:record.disputeReason,resolutionNote:record.resolutionNote,depositRefundRequiredAmount,canDispute:record.status!=='COMPLETED',canResolve:financial&&record.status==='DISPUTED',canComplete:financial&&record.status==='PENDING_PAYMENT'&&!periods.length&&!pending&&!unpaid&&!futureUnrefunded&&!invalidPacks&&!frozen&&depositRefundRequiredAmount===0};
}
export async function returnAction(tx:Prisma.TransactionClient,record:any,action:'DISPUTE'|'RESOLVE'|'COMPLETE',input:any,actorId:string){
  const a=await lockAccount(tx,record.orderId),requestHash=hash(input);
  const old=await tx.auditLog.findFirst({where:{resourceType:'return-settlements',resourceId:record.id,action,data:{path:['idempotencyKey'],equals:input.idempotencyKey}}});
  if(old){ensure((old.data as any).requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','结算操作编号与内容冲突');return returnView(tx,record,action!=='DISPUTE');}
  ensure(record.status!=='COMPLETED',409,'RETURN_COMPLETE','该结算已完成');
  if(action!=='DISPUTE')ensure(record.revision===input.revision,409,'REVISION_CONFLICT','结算已更新，请刷新');
  let data:any;
  if(action==='DISPUTE')data={status:'DISPUTED',disputeReason:input.reason};
  else if(action==='RESOLVE'){ensure(record.status==='DISPUTED',409,'STATE_CONFLICT','当前无待处理争议');const missing=await tx.usagePeriod.count({where:{accountId:a.id,status:{notIn:['SETTLED','CANCELLED']}}});data={status:missing?'READINGS_REQUIRED':'PENDING_PAYMENT',resolutionNote:input.resolutionNote};}
  else{
    ensure((await returnView(tx,record,true)).canComplete,409,'RETURN_NOT_SETTLED','尚有缺失里程、争议、账单、未知支付或应退资金未核清');
    await voidUnpaidQuotes(tx,a.id,120);await expireRemainingPacks(tx,a);
    const max=await tx.usagePeriod.aggregate({where:{accountId:a.id,status:{not:'CANCELLED'}},_max:{sequence:true}});
    const sequences=await serviceBillSequences(tx,record.orderId);const futureIds=[...sequences].filter(([,sequence])=>sequence>(max._max.sequence||0)).map(([id])=>id);
    await tx.bill.updateMany({where:{orderId:record.orderId,id:{in:futureIds},status:{in:['DRAFT','REVIEWED','PENDING']}},data:{status:'VOID'}});
    await tx.order.update({where:{id:record.orderId},data:{status:'COMPLETED'}});data={status:'COMPLETED',completedAt:new Date()};
  }
  const updated=await tx.returnSettlement.update({where:{id:record.id},data:{...data,revision:{increment:1}}});
  await audit(tx,actorId,action,'return-settlements',record.id,{...input,requestHash},action==='DISPUTE'?'CUSTOMER':'ADMIN');return returnView(tx,updated,action!=='DISPUTE');
}
