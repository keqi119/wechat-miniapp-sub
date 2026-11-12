import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {serviceFundsRows} from '../order-changes/context';
import {hash} from '../common/data';
import {requireHistoricalPreparedQuoteAgreement} from '../order-changes/agreement-readiness';
import {day} from '../usage/rules';
import {HttpException} from '@nestjs/common';
import {readSwapStageScope,type SwapStageScope} from './stage-source';
import {readPreparedRenewalSource} from '../order-renewals/source';

const validId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&!v.includes('\0');
const int=(v:any)=>Number.isSafeInteger(v)&&v>=0&&v<=2147483647;
export type PreparedSwapSource={quoteId:string;quoteRevision:number;commercialHash:string;contractId:string;archiveVersionId:string;preparedAt:string};

async function priorFinancialContext(tx:any,order:any,change:any){
 ensure(change.orderId===order.id&&change.customerId===order.customerId,409,'SWAP_FINANCE_SOURCE','原资金归属与本单不符');
 let terms=order.finalPlanSnapshot,obligations:any[]=[],priorQuote:any=null,priorKind:string|null=null,scope:SwapStageScope|null=null;
 if(change.priorTermsVersionId!=null){
  ensure(validId(change.priorTermsVersionId),409,'SWAP_FINANCE_SOURCE','原条款来源标识无效');const prior=await tx.orderTermsVersion.findUnique({where:{id:change.priorTermsVersionId}});
  ensure(prior?.orderId===order.id&&validId(prior.quoteId),409,'SWAP_FINANCE_SOURCE','原条款不属于本单或缺少真实报价');
  const quote=await tx.delayQuote.findUnique({where:{id:prior.quoteId}}),origin=quote?await tx.orderChange.findUnique({where:{id:quote.changeId}}):null;
  ensure(origin?.status==='APPLIED'&&origin.orderId===order.id&&origin.customerId===order.customerId&&origin.activeQuoteId===quote?.id&&prior.hash===quote.commercialHash&&prior.offlineArchiveVersionId===quote.approvedArchiveVersionId,409,'SWAP_FINANCE_SOURCE','原有效义务缺少真实已生效的同单协议');
  const agreement=await requireHistoricalPreparedQuoteAgreement(tx,origin.id,quote.id);ensure(agreement.mode==='OFFLINE'&&agreement.archiveVersionId===prior.offlineArchiveVersionId,409,'SWAP_FINANCE_SOURCE','原有效义务的纸质版本不符');
  terms=prior.snapshot;obligations=await tx.serviceObligation.findMany({where:{orderId:order.id,quoteId:quote.id},orderBy:{sequence:'asc'}});
  ensure(obligations.length===terms.months&&new Set(obligations.map(o=>o.sequence)).size===terms.months&&obligations.every(o=>o.orderId===order.id&&o.quoteId===quote.id&&Array.isArray(o.sourceBillIds)),409,'SWAP_FINANCE_SOURCE','原有效条款逐期义务缺失或归属不符');
  scope=await readSwapStageScope(tx,order,terms,{historical:true});
  if(origin.kind==='SUBSCRIPTION_EXTENSION'){
   ensure(scope,409,'SWAP_FINANCE_SOURCE','续期原义务必须具有真实服务段');
   const renewal=await readPreparedRenewalSource(tx,scope.serviceStageId);
   ensure(renewal.quote.id===quote.id&&renewal.stage.termsVersionId===prior.id&&renewal.stage.snapshotHash===scope.stageSourceHash&&canonicalHash(terms)===canonicalHash(renewal.snapshot.termsSnapshot),409,'SWAP_FINANCE_SOURCE','续期原资金条款与服务段不一致');
   ensure(obligations.every(o=>{const p=renewal.snapshot.billingSchedule.find(p=>p.sequence===o.sequence);return p&&o.serviceStageId===scope!.serviceStageId&&o.stageSequence===p.stageSequence&&day(o.startDate)===p.startDate&&day(o.endDate)===p.endDate&&day(o.dueDate)===p.dueDate&&o.amount===p.amount&&o.chargeAmount===p.amount&&o.sourceBillIds.length===0&&validId(o.chargeBillId);}),409,'SWAP_FINANCE_SOURCE','续期原义务的阶段、月份或金额不一致');
  }else{
   ensure(['VEHICLE_CHANGE','DELIVERY_DELAY'].includes(origin.kind),409,'SWAP_FINANCE_SOURCE','不支持的原条款资金来源');
  ensure(Array.isArray(quote.snapshot?.periods)&&quote.snapshot.periods.length===terms.months&&Array.isArray(quote.fundsSnapshot)&&quote.fundsSnapshot.length===terms.months&&Array.isArray(terms.billingSchedule)&&canonicalHash(terms.billingSchedule)===canonicalHash(quote.snapshot.periods),409,'SWAP_FINANCE_SOURCE','原有效条款缺少一致的冻结逐期方案');
  ensure(obligations.every(o=>{const p=quote.snapshot.periods.find((p:any)=>p.sequence===o.sequence),f=quote.fundsSnapshot.find((p:any)=>p.sequence===o.sequence);return p&&f&&Array.isArray(f.sourceBillIds)&&day(o.startDate)===p.startDate&&day(o.endDate)===p.endDate&&day(o.dueDate)===p.dueDate&&int(o.amount)&&o.amount===p.amount&&int(o.chargeAmount)&&o.chargeAmount===p.chargeAmount&&canonicalHash([...o.sourceBillIds].sort())===canonicalHash([...f.sourceBillIds].sort())&&(o.chargeAmount>0?validId(o.chargeBillId):o.chargeBillId==null);}),409,'SWAP_FINANCE_SOURCE','原有效义务的月份、金额或账单来源已变化');
   if(scope)ensure(canonicalHash(quote.snapshot.serviceStageScope)===canonicalHash(scope)&&obligations.every(o=>o.serviceStageId===scope!.serviceStageId&&o.stageSequence===o.sequence-scope!.firstPeriodSequence+1),409,'SWAP_FINANCE_SOURCE','原换车资金的服务段不一致');
  }
  priorQuote=quote;priorKind=origin.kind;
 }
 ensure(terms&&hash(terms)===change.priorTermsHash&&hash(change.priorTerms)===change.priorTermsHash,409,'SWAP_FINANCE_SOURCE','原资金基准与冻结条款不一致');
 const bills=await tx.bill.findMany({where:{orderId:order.id},orderBy:{id:'asc'},include:{payments:{orderBy:{id:'asc'},include:{refunds:true}}}});
 ensure(obligations.every(o=>[...o.sourceBillIds,...(o.chargeBillId?[o.chargeBillId]:[])].every(id=>bills.some((b:any)=>b.id===id&&b.orderId===order.id&&b.customerId===order.customerId))),409,'SWAP_FINANCE_SOURCE','原有效义务引用的真实账单缺失');
 ensure(obligations.every(o=>!o.chargeBillId||bills.some((b:any)=>b.id===o.chargeBillId&&b.amount===o.chargeAmount&&b.type===(priorKind==='SUBSCRIPTION_EXTENSION'?'SUBSCRIPTION':priorKind==='VEHICLE_CHANGE'?'SWAP_ADJUSTMENT':'DELAY_ADJUSTMENT')&&b.idempotencyKey===(priorKind==='SUBSCRIPTION_EXTENSION'?`renewal:${priorQuote.id}:${o.sequence}`:`delay-${priorQuote.id}-${o.sequence}`)&&(!scope||b.serviceStageId===scope.serviceStageId))),409,'SWAP_FINANCE_SOURCE','原有效义务补差账单与真实冻结报价不符');
 return{base:serviceFundsRows(terms,obligations,bills,scope??undefined),bills};
}

/** Real receipt principal from an immutable, same-change prepared chain; never old fundsSnapshot reuse. */
export async function readOfflineSwapFunds(tx:any,order:any,change:any,previousPreparedQuoteId:string|null,maxRevision=Number.MAX_SAFE_INTEGER){
 const {base,bills}=await priorFinancialContext(tx,order,change);ensure(!base.blockers.length,409,'FUNDS_UNCONFIRMED',base.blockers.join('；'));
 ensure(previousPreparedQuoteId===null||validId(previousPreparedQuoteId),409,'SWAP_FINANCE_SOURCE','原财务来源标识不完整');
 const nodes:any[]=[],sources:PreparedSwapSource[]=[],seen=new Set<string>();let id=previousPreparedQuoteId,ceiling=maxRevision;
 while(id){
  ensure(!seen.has(id),409,'SWAP_FINANCE_SOURCE','原财务来源存在循环');seen.add(id);
  const q=await tx.delayQuote.findUnique({where:{id},include:{contract:true}});
  ensure(q?.id===id&&q.changeId===change.id&&q.snapshot?.pricingVersion===2&&q.financePreparedAt&&Number.isSafeInteger(q.revision)&&q.revision>0&&q.revision<ceiling&&!q.snapshot.financeSourceQuoteId,409,'SWAP_FINANCE_SOURCE','原财务报价归属、版本或准备状态不一致');
  ensure(canonicalHash(q.snapshot.serviceStageScope??null)===canonicalHash(base.serviceStageScope??null),409,'SWAP_FINANCE_SOURCE','净差重报不得跨服务段或替换冻结阶段来源');
  const agreement=await requireHistoricalPreparedQuoteAgreement(tx,change.id,id);ensure(agreement.mode==='OFFLINE'&&q.approvedArchiveVersionId===agreement.archiveVersionId,409,'SWAP_FINANCE_SOURCE','原财务报价纸档案固定版本不一致');
  const previous=q.snapshot.previousPreparedQuoteId??null;ensure(previous===null||validId(previous),409,'SWAP_FINANCE_SOURCE','原财务来源链不完整');
  nodes.push(q);sources.push({quoteId:q.id,quoteRevision:q.revision,commercialHash:q.commercialHash,contractId:agreement.contractId,archiveVersionId:agreement.archiveVersionId,preparedAt:new Date(q.financePreparedAt).toISOString()});ceiling=q.revision;id=previous;
 }
 for(let index=0;index<nodes.length;index++){const q=nodes[index],previous=sources.slice(index+1);if(q.snapshot.previousPreparedQuoteId)ensure(Array.isArray(q.snapshot.preparedSources)&&q.snapshot.preparedSourceHash===canonicalHash(previous)&&canonicalHash(q.snapshot.preparedSources)===canonicalHash(previous),409,'SWAP_FINANCE_SOURCE','历史净差方案冻结的原财务链已变化');else ensure(previous.length===0,409,'SWAP_FINANCE_SOURCE','原财务链未完整连接');}
 const byId=new Map<string,any>(bills.map((b:any)=>[b.id,b]));
 const idsByPeriod=new Map<number,Set<string>>(),amountByPeriod=new Map<number,number>(),ownedBill=new Map<string,number>();
 const add=(sequence:number,id:string)=>{ensure(validId(id)&&(!ownedBill.has(id)||ownedBill.get(id)===sequence),409,'SWAP_FINANCE_SOURCE','付款账单不得跨原服务期重复使用');ownedBill.set(id,sequence);idsByPeriod.get(sequence)!.add(id);};
 for(const row of base.rows){idsByPeriod.set(row.sequence,new Set());amountByPeriod.set(row.sequence,row.amount);for(const billId of row.sourceBillIds)add(row.sequence,billId);}
 for(const q of [...nodes].reverse()){
  ensure(Array.isArray(q.snapshot.periods)&&Array.isArray(q.fundsSnapshot)&&q.snapshot.periods.length===base.rows.length&&q.fundsSnapshot.length===base.rows.length,409,'SWAP_FINANCE_SOURCE','原财务逐期冻结数据不完整');
  const obligations=await tx.serviceObligation.findMany({where:{quoteId:q.id},orderBy:{sequence:'asc'}});
  ensure(obligations.length===base.rows.length&&new Set(obligations.map((o:any)=>o.sequence)).size===obligations.length,409,'SWAP_FINANCE_SOURCE','原准备资金的逐期义务缺失或重复');
  for(const o of obligations){
   const original=base.rows.find((r:any)=>r.sequence===o.sequence),quoted=q.snapshot.periods?.find((r:any)=>r.sequence===o.sequence),source=q.fundsSnapshot?.find((r:any)=>r.sequence===o.sequence),known=idsByPeriod.get(o.sequence);
   ensure((!base.serviceStageScope||o.serviceStageId===base.serviceStageScope.serviceStageId&&o.stageSequence===original?.stageSequence&&quoted?.stageSequence===original?.stageSequence&&source?.stageSequence===original?.stageSequence)&&original&&quoted&&source&&known&&o.orderId===order.id&&o.quoteId===q.id&&day(o.startDate)===original.startDate&&day(o.endDate)===original.endDate&&day(o.dueDate)===original.dueDate&&int(o.amount)&&o.amount===quoted.amount&&int(o.chargeAmount)&&o.chargeAmount===quoted.chargeAmount&&Array.isArray(o.sourceBillIds)&&Array.isArray(source.sourceBillIds)&&canonicalHash([...o.sourceBillIds].sort())===canonicalHash([...source.sourceBillIds].sort())&&canonicalHash([...o.sourceBillIds].sort())===canonicalHash([...known].sort()),409,'SWAP_FINANCE_SOURCE','原资金义务的归属、月份或来源不一致');
   if(o.chargeAmount>0){const bill=byId.get(o.chargeBillId);ensure(bill?.orderId===order.id&&bill.customerId===order.customerId&&bill.type==='SWAP_ADJUSTMENT'&&(!base.serviceStageScope||bill.serviceStageId===base.serviceStageScope.serviceStageId)&&bill.amount===o.chargeAmount&&bill.idempotencyKey===`delay-${q.id}-${o.sequence}`,409,'SWAP_FINANCE_SOURCE','原补差账单与真实准备义务不一致');add(o.sequence,bill.id);}else ensure(o.chargeBillId==null,409,'SWAP_FINANCE_SOURCE','零补差义务不得引用收费账单');
   amountByPeriod.set(o.sequence,o.amount);
  }
 }
 const rows=base.rows.map((row:any)=>{
  const sourceBillIds=[...idsByPeriod.get(row.sequence)!].sort(),payments:any[]=[];
  for(const billId of sourceBillIds){
   const bill=byId.get(billId);ensure(bill?.orderId===order.id&&bill.customerId===order.customerId&&['SUBSCRIPTION','DELAY_ADJUSTMENT','SWAP_ADJUSTMENT'].includes(bill.type)&&(!base.serviceStageScope||bill.serviceStageId===base.serviceStageScope.serviceStageId),409,'SWAP_FINANCE_SOURCE','月费来源账单归属或类别不一致');
   for(const p of bill.payments){
    ensure(p.billId===bill.id&&p.customerId===order.customerId&&int(p.amount),409,'FUNDS_INCONSISTENT','实收本金归属或金额无效');
    ensure(!['CREATING','PENDING'].includes(p.status)&&!p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status)),409,'FUNDS_UNCONFIRMED','来源仍有未知付款或处理中退款');if(p.status!=='SUCCEEDED')continue;
    const refunded=p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((total:bigint,r:any)=>{ensure(r.customerId===order.customerId&&int(r.amount),409,'FUNDS_INCONSISTENT','退款金额或归属无效');return total+BigInt(r.amount);},0n);
    ensure(refunded<=BigInt(p.amount),409,'FUNDS_INCONSISTENT','退款不得超过原实收本金');payments.push({id:p.id,amount:p.amount,net:p.amount-Number(refunded)});
   }
  }
  payments.sort((a,b)=>a.id.localeCompare(b.id));ensure(new Set(payments.map(p=>p.id)).size===payments.length,409,'FUNDS_INCONSISTENT','付款来源重复');const net=payments.reduce((n:bigint,p:any)=>n+BigInt(p.net),0n);ensure(net<=BigInt(Number.MAX_SAFE_INTEGER),409,'FUNDS_INCONSISTENT','实际净收超出精确整数范围');
  return{...row,amount:amountByPeriod.get(row.sequence),sourceBillIds,payments,netPaidAmount:Number(net)};
 });
 return{baseRows:base.rows,rows,sources,sourceHash:canonicalHash(sources)};
}

/** A late verified receipt/refund cannot silently leave stale allocations executable. */
export async function appendOfflineSwapMoneyBlockers(tx:any,change:any,q:any,obligations:any[],blockers:string[]){
 if(q.snapshot?.pricingVersion!==2||!q.financePreparedAt)return;
 try{
  const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),funds=await readOfflineSwapFunds(tx,order,change,q.id,q.revision+1);
  ensure(funds.rows.length===obligations.length&&funds.rows.every((r:any)=>obligations.find((o:any)=>o.sequence===r.sequence)?.allocatedAmount===r.netPaidAmount),409,'SWAP_NET_FUNDS_CHANGED','真实收退款与当前分配不一致，须核对并重新出具净差方案');
 }catch(error){if(error instanceof HttpException&&error.getStatus()===409){blockers.push('真实收退款或原财务协议来源尚未核清，请核对当前净差方案');return;}throw error;}
}
