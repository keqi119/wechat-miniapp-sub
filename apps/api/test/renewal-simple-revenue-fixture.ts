import {renewalFixture,renewalFinance,renewalNow} from './order-renewals-fixture';
import {renewalPaperFixture} from './renewal-paper-fixture';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';

/** Real renewal commands and readers on plain transaction doubles; no Db, channel or filesystem. */
export async function renewalRevenueFixture(){
 const base=renewalFixture(),oldVersion={...base.agreementVersion,id:'original-simple-version',title:'原期合作',contentHash:hash('original-simple'),partnerRateBps:2500};
 const originalRevenue={mode:'SIMPLE_AGREEMENT',ownerId:base.owner.id,agreementId:oldVersion.agreementId,agreementVersionId:oldVersion.id,versionId:oldVersion.id,contentHash:oldVersion.contentHash,title:oldVersion.title,partnerRateBps:2500,vehicleId:base.vehicle.id,modelId:'original-model',modelName:'原冻结车型',plateNumber:'原冻结牌号',validFrom:null,validUntil:null};
 (base.initial as any).revenueRuleSnapshot=originalRevenue;
 base.stage.snapshot.source.originalTermsHash=canonicalHash(base.initial);base.stage.snapshot.source.agreement.priorTermsHash=hash(base.initial);base.stage.snapshotHash=canonicalHash(base.stage.snapshot);
 const f=await renewalPaperFixture(base),tx=f.tx;f.version.scopeSnapshot=offlineChangeScope(f.change,f.quote,f.contract);f.change.status='AWAITING_FINANCE';
 const preview=await f.service.financePreview(f.change.id,renewalFinance);
 await f.service.prepare(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:preview.previewHash,idempotencyKey:'revenue-prepare'},renewalFinance);
 const stage=f.stages.find(s=>s.kind==='RENEWAL')!,first=f.bills.find(b=>b.serviceStageId===stage.id&&b.sequence===stage.firstPeriodSequence)!,second=f.bills.find(b=>b.serviceStageId===stage.id&&b.sequence===stage.firstPeriodSequence+1)!;
 const events:any[]=[],payments:any[]=[],refunds:any[]=[],queries:any[]=[],versions=[oldVersion,f.agreementVersion],orders=[f.order];
 const hydrate=(p:any)=>p?{...p,bill:{...f.bills.find(b=>b.id===p.billId),order:orders.find(o=>o.id===f.bills.find(b=>b.id===p.billId)?.orderId)},refunds:refunds.filter(r=>r.paymentId===p.id)}:null;
 tx.payment={findUnique:async({where}:any)=>hydrate(payments.find(p=>p.id===where.id)),findMany:async(args:any)=>{queries.push(args);const ownerId=args.where.OR.find((r:any)=>r.bill?.serviceStage)?.bill.serviceStage.ownerId;return payments.map(hydrate).filter(p=>args.where.OR.some((r:any)=>r.id?.in?.includes(p.id)||r.bill?.order&&(r.bill.serviceStageId===undefined||p.bill.serviceStageId==null)&&(p.bill.order.finalPlanSnapshot?.revenueRuleSnapshot?.ownerId??p.bill.order.finalPlanSnapshot?.lessorSnapshot?.ownerId)===r.bill.order.OR[0].finalPlanSnapshot.equals||ownerId&&r.bill?.serviceStage&&f.stages.find(s=>s.id===p.bill.serviceStageId)?.ownerId===ownerId));}};
 tx.refund={findMany:async({where}:any)=>refunds.filter(r=>r.paymentId===where.paymentId&&r.status===where.status),findUnique:async({where}:any)=>{const r=refunds.find(r=>r.id===where.id);return r?{...r,payment:hydrate(payments.find(p=>p.id===r.paymentId))}:null;}};
 tx.partnerRevenueEvent={findUnique:async({where}:any)=>events.find(e=>e.sourceType===where.sourceType_sourceId.sourceType&&e.sourceId===where.sourceType_sourceId.sourceId)??null,findMany:async({where}:any)=>events.filter(e=>(!where.ownerId||e.ownerId===where.ownerId)&&(!where.paymentId||e.paymentId===where.paymentId)&&(!where.sourceType||e.sourceType===where.sourceType)),create:async({data}:any)=>{const e={id:'revenue-'+events.length,...data};events.push(e);return e;}};
 tx.partnerAgreementVersion.findUnique=async({where}:any)=>versions.find(v=>v.id===where.id)??null;tx.partnerAgreementVersion.findMany=async({where}:any)=>versions.filter(v=>v.ownerId===where.ownerId);
 tx.partnerAgreementVehicle.findMany=async({where}:any)=>where.ownerId===f.owner.id?[{vehicleId:f.vehicle.id}]:[];
 tx.vehicle.findMany=async()=>[f.vehicle];tx.vehicleOwner.findUnique=async({where}:any)=>where.id===f.owner.id?f.owner:null;
 tx.serviceObligation.findMany=async({where}:any={})=>f.obligations.filter(o=>(!where?.chargeBillId||o.chargeBillId===where.chargeBillId)&&(!where?.orderId||o.orderId===where.orderId));
 function receive(bill=first){const p={id:'revenue-payment-'+payments.length,billId:bill.id,customerId:bill.customerId,status:'SUCCEEDED',providerTransactionId:'verified-'+payments.length,reconciliationRequired:false,amount:bill.amount,succeededAt:renewalNow};payments.push(p);bill.status='PAID';bill.paidAmount=bill.amount;return p;}
 function refund(payment:any,amount:number){const r={id:'revenue-refund-'+refunds.length,paymentId:payment.id,status:'SUCCEEDED',providerRefundId:'refund-channel-'+refunds.length,amount,succeededAt:new Date(renewalNow.getTime()+refunds.length+1)};refunds.push(r);return r;}
 function historical(status:'ACTIVE'|'ENDED'='ACTIVE'){
  f.stage.status='ENDED';(f.stage as any).endedAt=new Date('2027-10-01');Object.assign(stage,{status,scheduledAt:renewalNow,scheduledBy:'finance',activatedAt:new Date('2027-10-01'),activatedBy:'ops',termsVersionId:'revenue-stage-terms',endedAt:status==='ENDED'?new Date('2028-10-01'):null});f.change.status='APPLIED';
  f.terms.push({id:stage.termsVersionId,orderId:f.order.id,quoteId:f.quote.id,version:1,snapshot:structuredClone(stage.snapshot.termsSnapshot),hash:f.quote.commercialHash,offlineArchiveVersionId:f.quote.approvedArchiveVersionId,effectiveAt:stage.activatedAt});f.order.effectiveTermsVersionId=stage.termsVersionId;
  Object.assign(f.assignment,{status:'CLOSED',endAt:new Date('2027-11-01'),returnHandoverId:'later-return'});f.order.vehicleId='later-vehicle';f.order.currentAssignmentId='later-assignment';f.change.activeQuoteId='later-current-quote';
 }
 return{...f,stage,first,second,events,payments,refunds,queries,versions,orders,originalRevenue,oldVersion,receive,refund,historical};
}
