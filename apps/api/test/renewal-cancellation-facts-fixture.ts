import {renewalFinanceFixture} from './order-renewals-finance-fixture';
import {renewalFinance,renewalNow} from './order-renewals-fixture';
import {canonicalHash} from '../src/customers/types';

export {renewalNow};
const matches=(row:any,where:any):boolean=>!where||Object.entries(where).every(([k,v]:any)=>k==='OR'?v.some((w:any)=>matches(row,w)):k==='AND'?v.every((w:any)=>matches(row,w)):v&&typeof v==='object'&&!(v instanceof Date)?('in'in v?v.in.includes(row[k]):'startsWith'in v?String(row[k]??'').startsWith(v.startsWith):matches(row[k],v)):row[k]===v);
/** Pure actual core/finance commands, followed by read-only delegates. No Db or channel instance. */
export async function cancellationFactsFixture(prepared=false){
 const f=await renewalFinanceFixture();
 if(prepared){const p=await f.service.financePreview(f.change.id,renewalFinance);await f.service.prepare(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:p.previewHash,idempotencyKey:'cancel-facts-prepare'},renewalFinance);}
 else{f.archives.splice(f.archives.indexOf(f.archive),1);f.contract.offlineArchiveId=null;f.change.status='AWAITING_ARCHIVE';}
 const cases:any[]=[],archiveCommands:any[]=[],reconciliations:any[]=[],tx=f.tx;
 tx.orderRenewalCancellation.findUnique=async({where}:any)=>cases.find(c=>matches(c,where))??null;
 tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>matches(t,where))??null;
 tx.documentArchive.findMany=async({where}:any)=>f.archives.filter(a=>matches(a,where));
 tx.archiveCommand.findMany=async({where}:any)=>archiveCommands.filter(c=>matches(c,where));
 tx.orderServiceStage.findMany=async({where}:any={})=>f.stages.filter(s=>matches(s,where));
 tx.bill.findMany=async({where}:any)=>f.bills.filter(b=>matches(b,where));
 tx.serviceObligation.findMany=async({where}:any)=>f.obligations.filter(o=>matches(o,where));
 tx.paymentAllocation.findMany=async({where}:any)=>f.allocations.filter(a=>matches(a,where));
 tx.paymentReconciliation={findMany:async({where}:any)=>reconciliations.filter(r=>matches(r,where))};
 const stage=f.stages.find(s=>s.kind==='RENEWAL'),newBills=f.bills.filter(b=>b.serviceStageId===stage?.id&&stage),writesBefore=f.writes.length;
 const pay=(b:any=newBills[0])=>{const p:any=f.pay(b);p.succeededAt=renewalNow;return p;};
 const refund=(p:any,amount=p.amount,status='SUCCEEDED')=>{const r:any={id:'refund-'+p.refunds.length,paymentId:p.id,customerId:f.customer.id,amount,status,providerRefundId:status==='SUCCEEDED'?'channel-refund-'+p.refunds.length:null,succeededAt:status==='SUCCEEDED'?renewalNow:null,createdAt:renewalNow,updatedAt:renewalNow,renewalCancellationId:null,renewalCancellationOrderId:null,renewalCancellationStageId:null,renewalCancellationBillId:null};p.refunds.push(r);return r;};
 const forbidToday=()=>{for(const name of ['vehicleListing','productVersion','subscriptionPlan','coverageRequirement','insurancePolicy','customerQualification','vehicleOwner'])if(tx[name])for(const key of ['findUnique','findFirst','findMany'])tx[name][key]=async()=>{throw new Error('forbidden current eligibility read '+name);};};
 tx.storedFile.findMany=async({where}:any)=>f.files.filter(v=>where.id.in.includes(v.id));
 const openingCase=(facts:any)=>{const sourceSnapshot={version:1,facts:facts.sourceSnapshot};const c:any={id:'cancel',quoteId:f.quote.id,changeId:f.change.id,orderId:f.order.id,customerId:f.customer.id,ownerId:f.owner.id,serviceStageId:stage?.id??null,revision:0,status:'OPEN',sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot),signatureState:'UNKNOWN',signatureEvidenceFileIds:[],mutuallyAgreedAt:null,mutualAgreementVerifiedBy:null,mutualAgreementVerifiedAt:null,mutualAgreementEvidenceFileIds:[],mutualAgreementNote:null,mutualAgreementHash:null};cases.push(c);return c;};
 const agree=async(c:any,now=new Date('2027-10-02T02:00:00Z'))=>{const file:any={id:'mutual-evidence',name:'双方期前同意原件.pdf',adminId:'ops',customerId:null,fieldTaskId:null,purpose:'evidence',sha256:'f'.repeat(64),size:16,mimeType:'application/pdf'};f.files.push(file);const{buildRenewalCancellationMutualAgreement}=await import('../src/order-renewals/cancellation-timing');Object.assign(c,await buildRenewalCancellationMutualAgreement(tx,c,{startDate:f.quote.snapshot.startDate,mutuallyAgreedAt:'2027-09-30T10:00:00+08:00',evidenceFileIds:[file.id],note:'已核原客户及出租方双方期前同意材料'},{id:'ops'},now));return c;};
 return{...f,cases,archiveCommands,reconciliations,stage,newBills,writesBefore,pay,refund,forbidToday,openingCase,agree};
}
