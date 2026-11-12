import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';

export const COLLECTION_FACTS_VERSION='COLLECTION_FACTS_V1' as const;
const MAX_AMOUNT=2147483647,DAY_MS=86400000;
export type CollectionLevel='D1'|'D2'|'D3'|'D4'|'D5';
export type CollectionBlocker='MONEY_INVALID'|'FACTS_INCOMPLETE'|'BILL_STATE_UNKNOWN'|'PAYMENT_STATE_UNKNOWN'|'REFUND_STATE_UNKNOWN'|'PAYMENT_IN_PROGRESS'|'REFUND_IN_PROGRESS'|'OWNERSHIP_MISMATCH'|'RECEIPT_UNVERIFIED'|'RECONCILIATION_REQUIRED'|'RECEIPT_MISMATCH'|'DUPLICATE_FACT'|'PAYMENT_REVISION_INVALID';
export type CollectionOrderRef={id:string;customerId:string};
export type CollectionRefundSource={id:string;paymentId:string;customerId:string;status:string;amount:number;providerRefundId?:string|null};
export type CollectionPaymentSource={id:string;billId:string;customerId:string;revision:number;status:string;amount:number;providerTransactionId:string|null;reconciliationRequired:boolean;refunds:readonly CollectionRefundSource[]};
export type CollectionBillSource={id:string;orderId:string;customerId:string;type:string;status:string;amount:number;paidAmount:number;dueDate:Date|string;payments:readonly CollectionPaymentSource[]};
type FrozenMoney=number|{invalidType:string;invalidValue:string};
type RefundSnapshot={id:string|null;paymentId:string|null;customerId:string|null;status:string|null;amount:FrozenMoney;providerRefundId:string|null};
type PaymentSnapshot={id:string|null;billId:string|null;customerId:string|null;revision:FrozenMoney;status:string|null;amount:FrozenMoney;providerTransactionId:string|null;reconciliationRequired:boolean|null;refunds:RefundSnapshot[]|null};
export type CollectionBillSnapshot={version:1;policyVersion:typeof COLLECTION_FACTS_VERSION;billId:string;orderId:string;customerId:string;type:string;status:string;amount:FrozenMoney;paidAmount:FrozenMoney;dueDate:string;payments:PaymentSnapshot[]|null};
export type CollectionBillFact={billId:string;orderId:string;customerId:string;type:string;status:string;amount:number|null;paidAmount:number|null;dueDate:string;overdueDays:number;level:CollectionLevel|null;outstandingAmount:number|null;confirmedOverdueAmount:number|null;settled:boolean;blockers:CollectionBlocker[];sourceSnapshot:CollectionBillSnapshot;sourceHash:string};

const money=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=MAX_AMOUNT;
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=500&&!value.includes('\0');
const nullableText=(value:unknown):string|null=>identifier(value)?value:null;
const frozenMoney=(value:unknown):FrozenMoney=>money(value)?value:{invalidType:typeof value,invalidValue:['string','number','bigint','boolean','undefined'].includes(typeof value)?String(value).slice(0,500):value===null?'null':'non-primitive'};
const byId=(a:{id:string|null},b:{id:string|null})=>compare(a.id??'',b.id??'')||compare(canonicalHash(a),canonicalHash(b));
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function parseDay(value:string){
 ensure(typeof value==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value),400,'COLLECTION_DATE_INVALID','须为有效 YYYY-MM-DD 日期');
 const date=new Date(value+'T00:00:00.000Z');ensure(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value,400,'COLLECTION_DATE_INVALID','日期不存在');return date.getTime();
}
function billDay(value:Date|string){if(typeof value==='string'){parseDay(value);return value;}ensure(value instanceof Date&&Number.isFinite(value.getTime()),400,'COLLECTION_DATE_INVALID','账单日期无效');const result=value.toISOString().slice(0,10);parseDay(result);ensure(value.getTime()===parseDay(result),400,'COLLECTION_DATE_INVALID','账单到期日须为数据库自然日');return result;}
export function collectionDay(now:Date):string{ensure(now instanceof Date&&Number.isFinite(now.getTime()),400,'COLLECTION_DATE_INVALID','当前时点无效');const shifted=new Date(now.getTime()+8*3600000);ensure(Number.isFinite(shifted.getTime()),400,'COLLECTION_DATE_INVALID','当前时点超出日期范围');const result=shifted.toISOString().slice(0,10);parseDay(result);return result;}
export function collectionLevel(days:number):CollectionLevel|null{ensure(Number.isSafeInteger(days)&&days>=0,400,'COLLECTION_DAYS_INVALID','逾期天数须为非负整数');return days===0?null:days<=3?'D1':days<=7?'D2':days<=15?'D3':days<=30?'D4':'D5';}
function requireOrder(order:CollectionOrderRef){ensure(order&&identifier(order.id)&&identifier(order.customerId),400,'COLLECTION_ORDER_INVALID','催收须指定真实订单及客户');}

/** Current raw cash facts only. Never subtract a refund from Bill.paidAmount or
 * invent a new obligation. A missing nested relation is unknown, not empty. */
export function collectionBillFact(bill:CollectionBillSource,order:CollectionOrderRef,asOfDate:string):CollectionBillFact{
 requireOrder(order);const asOf=parseDay(asOfDate);ensure(bill&&identifier(bill.id)&&bill.orderId===order.id&&bill.customerId===order.customerId,409,'COLLECTION_OWNERSHIP_MISMATCH','账单必须属于本订单和本客户');ensure(identifier(bill.type)&&identifier(bill.status),400,'COLLECTION_FACTS_INVALID','账单种类或状态无效');
 const dueDate=billDay(bill.dueDate),blockers=new Set<CollectionBlocker>(),add=(code:CollectionBlocker)=>blockers.add(code),paymentIds=new Set<string>(),channelIds=new Set<string>(),refundIds=new Set<string>(),refundChannelIds=new Set<string>();let gross=0n,retained=0n;
 const amountsValid=money(bill.amount)&&money(bill.paidAmount)&&bill.paidAmount<=bill.amount;if(!amountsValid)add('MONEY_INVALID');
 if(!['DRAFT','REVIEWED','PENDING','PAID','VOID'].includes(bill.status))add('BILL_STATE_UNKNOWN');
 let paymentSnapshots:PaymentSnapshot[]|null=null;
 if(!Array.isArray(bill.payments))add('FACTS_INCOMPLETE');else{
  paymentSnapshots=[];
  for(const item of bill.payments){
   const payment=item as CollectionPaymentSource|undefined;
   if(!payment||!identifier(payment.id)){add('FACTS_INCOMPLETE');paymentSnapshots.push({id:null,billId:null,customerId:null,revision:frozenMoney(undefined),status:null,amount:frozenMoney(undefined),providerTransactionId:null,reconciliationRequired:null,refunds:null});continue;}
   if(paymentIds.has(payment.id))add('DUPLICATE_FACT');paymentIds.add(payment.id);
   if(payment.billId!==bill.id||payment.customerId!==order.customerId)add('OWNERSHIP_MISMATCH');
   if(!money(payment.revision))add('PAYMENT_REVISION_INVALID');
   const validAmount=money(payment.amount)&&payment.amount>0;if(!validAmount)add('MONEY_INVALID');
   if(!['CREATING','PENDING','SUCCEEDED','FAILED','CLOSED'].includes(payment.status))add('PAYMENT_STATE_UNKNOWN');
   if(['CREATING','PENDING'].includes(payment.status))add('PAYMENT_IN_PROGRESS');
   if(typeof payment.reconciliationRequired!=='boolean')add('FACTS_INCOMPLETE');else if(payment.reconciliationRequired)add('RECONCILIATION_REQUIRED');
   const transactionId=nullableText(payment.providerTransactionId);if(payment.status==='SUCCEEDED'&&!transactionId)add('RECEIPT_UNVERIFIED');
   if(transactionId){if(channelIds.has(transactionId))add('DUPLICATE_FACT');channelIds.add(transactionId);}
   let returned=0n,reserved=0n,refundSnapshots:RefundSnapshot[]|null=null;
   if(!Array.isArray(payment.refunds))add('FACTS_INCOMPLETE');else{
    refundSnapshots=[];
    for(const candidate of payment.refunds){
     const refund=candidate as CollectionRefundSource|undefined;if(!refund||!identifier(refund.id)){add('FACTS_INCOMPLETE');refundSnapshots.push({id:null,paymentId:null,customerId:null,status:null,amount:frozenMoney(undefined),providerRefundId:null});continue;}
     if(refundIds.has(refund.id))add('DUPLICATE_FACT');refundIds.add(refund.id);
     if(refund.paymentId!==payment.id||refund.customerId!==order.customerId)add('OWNERSHIP_MISMATCH');
     const refundAmountValid=money(refund.amount)&&refund.amount>0;if(!refundAmountValid||validAmount&&refundAmountValid&&refund.amount>payment.amount)add('MONEY_INVALID');
     if(!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(refund.status))add('REFUND_STATE_UNKNOWN');
     if(['PENDING_APPROVAL','PROCESSING'].includes(refund.status))add('REFUND_IN_PROGRESS');
     if(payment.status!=='SUCCEEDED')add('RECEIPT_MISMATCH');
     if(refundAmountValid&&refund.status==='SUCCEEDED')returned+=BigInt(refund.amount);
     if(refundAmountValid&&['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(refund.status))reserved+=BigInt(refund.amount);
     const refundChannelId=nullableText(refund.providerRefundId);if(refundChannelId){if(refundChannelIds.has(refundChannelId))add('DUPLICATE_FACT');refundChannelIds.add(refundChannelId);}
     refundSnapshots.push({id:refund.id,paymentId:nullableText(refund.paymentId),customerId:nullableText(refund.customerId),status:nullableText(refund.status),amount:frozenMoney(refund.amount),providerRefundId:refundChannelId});
    }
    refundSnapshots.sort(byId);
   }
   if(validAmount&&(returned>BigInt(payment.amount)||reserved>BigInt(payment.amount)))add('MONEY_INVALID');
   if(payment.status==='SUCCEEDED'&&validAmount){gross+=BigInt(payment.amount);retained+=BigInt(payment.amount)-returned;}
   paymentSnapshots.push({id:payment.id,billId:nullableText(payment.billId),customerId:nullableText(payment.customerId),revision:frozenMoney(payment.revision),status:nullableText(payment.status),amount:frozenMoney(payment.amount),providerTransactionId:transactionId,reconciliationRequired:typeof payment.reconciliationRequired==='boolean'?payment.reconciliationRequired:null,refunds:refundSnapshots});
  }
  paymentSnapshots.sort(byId);
 }
 if(amountsValid){
  const paid=BigInt(bill.paidAmount);
  if(bill.status==='PAID'){if(bill.paidAmount!==bill.amount||gross<paid||retained>paid||retained<0n)add('RECEIPT_MISMATCH');}
  else if(bill.status==='PENDING'){if(retained!==paid)add('RECEIPT_MISMATCH');}
  else if(bill.status==='VOID'){if(retained!==0n)add('RECEIPT_MISMATCH');}
  else if(['DRAFT','REVIEWED'].includes(bill.status)&&(bill.paidAmount!==0||retained!==0n))add('RECEIPT_MISMATCH');
 }
 const overdueDays=bill.status==='PENDING'?Math.max(0,(asOf-parseDay(dueDate))/DAY_MS):0,issues=[...blockers].sort() as CollectionBlocker[],outstandingAmount=issues.length?null:bill.status==='PENDING'?bill.amount-bill.paidAmount:0,confirmedOverdueAmount=outstandingAmount===null?null:overdueDays>0?outstandingAmount:0;
 const sourceSnapshot:CollectionBillSnapshot={version:1,policyVersion:COLLECTION_FACTS_VERSION,billId:bill.id,orderId:bill.orderId,customerId:bill.customerId,type:bill.type,status:bill.status,amount:frozenMoney(bill.amount),paidAmount:frozenMoney(bill.paidAmount),dueDate,payments:paymentSnapshots};
 return{billId:bill.id,orderId:bill.orderId,customerId:bill.customerId,type:bill.type,status:bill.status,amount:money(bill.amount)?bill.amount:null,paidAmount:money(bill.paidAmount)?bill.paidAmount:null,dueDate,overdueDays,level:collectionLevel(overdueDays),outstandingAmount,confirmedOverdueAmount,settled:issues.length===0&&['PAID','VOID'].includes(bill.status),blockers:issues,sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot)};
}

export function collectionSummary(order:CollectionOrderRef,bills:readonly CollectionBillSource[],asOfDate:string,linkedBillIds:readonly string[]=[]){
 requireOrder(order);parseDay(asOfDate);ensure(Array.isArray(bills)&&Array.isArray(linkedBillIds),400,'COLLECTION_FACTS_INVALID','须完整读取本订单账单');
 const ids=bills.map(bill=>bill?.id);ensure(new Set(ids).size===ids.length,409,'COLLECTION_DUPLICATE_FACT','账单事实不得重复');ensure(linkedBillIds.every(identifier)&&new Set(linkedBillIds).size===linkedBillIds.length&&linkedBillIds.every(id=>ids.includes(id)),409,'COLLECTION_LINK_MISMATCH','关联账单缺失或重复');
 const facts=bills.map(bill=>collectionBillFact(bill,order,asOfDate)).sort((a,b)=>compare(a.billId,b.billId)),cashIds=new Map<string,string>();
 const register=(kind:string,id:string|null,billId:string)=>{if(id===null)return;const key=kind+':'+id,previous=cashIds.get(key);ensure(!previous||previous===billId,409,'COLLECTION_DUPLICATE_FACT','不同账单不能重复引用同一收退款事实或渠道号');cashIds.set(key,billId);};
 for(const fact of facts)for(const payment of fact.sourceSnapshot.payments??[]){register('payment',payment.id,fact.billId);register('payment-channel',payment.providerTransactionId,fact.billId);for(const refund of payment.refunds??[]){register('refund',refund.id,fact.billId);register('refund-channel',refund.providerRefundId,fact.billId);}}
 const overdue=facts.filter(fact=>fact.confirmedOverdueAmount!==null&&fact.confirmedOverdueAmount>0),blockedBillIds=facts.filter(fact=>fact.blockers.length>0).map(fact=>fact.billId),total=overdue.reduce((sum,fact)=>sum+BigInt(fact.confirmedOverdueAmount!),0n);ensure(total<=BigInt(MAX_AMOUNT),400,'COLLECTION_AMOUNT_OVERFLOW','逾期确认欠款合计超出整数分存储范围');
 const maxOverdueDays=overdue.reduce((max,fact)=>Math.max(max,fact.overdueDays),0),sourceSnapshot={version:1 as const,policyVersion:COLLECTION_FACTS_VERSION,orderId:order.id,customerId:order.customerId,asOfDate,bills:facts.map(fact=>fact.sourceSnapshot)};
 return{orderId:order.id,customerId:order.customerId,asOfDate,bills:facts,totalOverdueAmount:Number(total),maxOverdueDays,level:collectionLevel(maxOverdueDays),overdueBillIds:overdue.map(fact=>fact.billId),blockedBillIds,linkedBillIds:[...linkedBillIds].sort(compare),canClose:blockedBillIds.length===0&&overdue.length===0&&linkedBillIds.every(id=>facts.find(fact=>fact.billId===id)!.settled),sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot)};
}
