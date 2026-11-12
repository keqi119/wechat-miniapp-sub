import {offlineSwapFixture,swapOps,swapV2Input} from './offline-swap-quotes-fixture';
import {swapQuote} from '../src/vehicle-changes/quotes';
import {hash} from '../src/common/data';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';

export async function offlineSwapLifecycleFixture(){
 const f=offlineSwapFixture();await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);const q=f.quotes.at(-1)!;
 Object.assign(q,{status:'REVIEWED',reviewedBy:'finance',reviewNote:'独立逐期核对'});f.change.status='REVIEWED';
 Object.assign(f.legal,{content:'合成已批准线下补充协议：{{customerName}} / {{lessorName}} / {{platformName}}；原合同 {{originalContractNo}}，原签字件 {{originalArchiveHash}}。\n{{swapFacts}}\n{{periodSchedule}}\n{{financialSchedule}}',confirmedBy:'legal-reviewer',confirmedAt:new Date()});
 const oldFind=f.tx.legalDocument.findFirst;f.tx.legalDocument.findFirst=async(args:any)=>args.where.type==='OFFLINE_ORDER_AMENDMENT'?f.legal:oldFind(args);
 f.tx.legalDocument.findUnique=async({where}:any)=>where.id===f.legal.id?f.legal:null;
 for(const bill of f.bills){bill.customerId=f.order.customerId;for(const payment of bill.payments)Object.assign(payment,{customerId:f.order.customerId,billId:bill.id});}
 f.tx.delayQuote.aggregate=async()=>({_max:{revision:Math.max(0,...f.quotes.map(q=>q.revision))}});
 f.tx.vehicle.findUniqueOrThrow=async(args:any)=>{const value=await f.tx.vehicle.findUnique(args);if(!value)throw new Error('vehicle missing');return value;};
 f.tx.paymentAllocation.aggregate=async({where}:any)=>({_sum:{amount:f.allocations.filter((a:any)=>a.paymentId===where.paymentId&&!a.releasedAt&&f.obligations.some((o:any)=>o.id===a.obligationId&&o.quoteId===where.obligation.quoteId)).reduce((n:number,a:any)=>n+a.amount,0)}});
 f.tx.paymentAllocation.updateMany=async({data}:any)=>{for(const a of f.allocations)if(!a.releasedAt)Object.assign(a,data);return{count:f.allocations.length};};
 const createBill=f.tx.bill.create;f.tx.bill.create=async({data}:any)=>createBill({data:{paidAmount:0,...data}});
 f.tx.bill.updateMany=async({where,data}:any)=>{const matches=f.bills.filter((b:any)=>(!where.id?.in||where.id.in.includes(b.id))&&(!where.orderId||b.orderId===where.orderId)&&(!where.type?.in||where.type.in.includes(b.type))&&(!where.status?.in||where.status.in.includes(b.status))&&(where.paidAmount===undefined||(b.paidAmount??0)===where.paidAmount));for(const b of matches)Object.assign(b,data);return{count:matches.length};};
 f.tx.refund.findMany=async({where}:any={})=>f.refunds.filter((r:any)=>(!where?.paymentId||r.paymentId===where.paymentId)&&(!where?.idempotencyKey?.startsWith||r.idempotencyKey.startsWith(where.idempotencyKey.startsWith)));
 f.tx.refund.create=async({data}:any)=>{const r={id:'refund-'+f.refunds.length,status:'PENDING_APPROVAL',...data};f.refunds.push(r);const payment=f.bills.flatMap((b:any)=>b.payments).find((p:any)=>p.id===r.paymentId);payment?.refunds.push(r);return r;};
 const archiveQuote=(quote=q)=>{const contract=f.contracts.find(c=>c.delayQuoteId===quote.id)!,archive=quote===q?f.archive:structuredClone(f.archive);if(quote!==q){archive.id='paper-'+quote.id;archive.versions[0].id=archive.id+'-v1';archive.versions[0].archiveId=archive.id;archive.currentApprovedVersionId=archive.versions[0].id;for(const binding of archive.versions[0].files)binding.versionId=archive.versions[0].id;f.archives.push(archive);}const version=archive.versions[0];contract.offlineArchiveId=archive.id;Object.assign(archive,{quoteId:quote.id,subjectId:quote.id,subjectType:'ORDER_CHANGE_QUOTE'});Object.assign(version,{businessSnapshotHash:quote.commercialHash,scopeSnapshot:offlineChangeScope(f.change,quote,contract),templateId:quote.snapshot.document.id,templateVersion:quote.snapshot.document.version});f.change.status='AWAITING_FINANCE';return version;};
 return{...f,q,archiveQuote};
}
