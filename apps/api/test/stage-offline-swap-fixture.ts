import {renewalFixture,renewalPreviewInput,renewalNow,renewalOps,renewalFinance} from './order-renewals-fixture';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';
import {validateManifest} from '../src/offline-documents/files';
import {canonicalHash} from '../src/customers/types';
import {hash} from '../src/common/data';
import {versionSnapshot,listedProductSnapshot} from '../src/products/snapshot';
import {createOfflineSwapQuote} from '../src/vehicle-changes/offline-quote';
import {publish,confirm} from '../src/order-changes/quotes';

export async function stageFinanceFixture(options:{depositAmount?:number}={}){
 const f=renewalFixture();f.product.swapPolicy.includedCount=3;Object.assign(f.plan.listing,{snapshot:versionSnapshot(f.product),productSourceHash:canonicalHash(versionSnapshot(f.product))});const tx=f.tx,oldLegal=tx.legalDocument.findFirst;tx.legalDocument.findFirst=async(args:any)=>{const d=await oldLegal(args);return d?{...d,title:d.title??'合成已确认文书'}:d;};
 if(options.depositAmount){(f.initial as any).depositAmount=options.depositAmount;f.stage.snapshot.source.originalTermsHash=canonicalHash(f.initial);f.stage.snapshot.source.agreement.priorTermsHash=hash(f.initial);f.stage.snapshotHash=canonicalHash(f.stage.snapshot);f.bills.push({id:'original-deposit',orderId:f.order.id,customerId:f.customer.id,type:'DEPOSIT',sequence:1,amount:options.depositAmount,paidAmount:0,dueDate:new Date('2026-10-01'),status:'PENDING',payments:[]});}
 const service=new OrderRenewalsService(f.db as any,()=>renewalNow),raw=renewalPreviewInput(f),preview=await service.preview(f.order.id,raw,renewalOps),created=await service.create(f.order.id,{...raw,previewHash:preview.previewHash,idempotencyKey:'finance-core-create'},renewalOps);
 const next=renewalPreviewInput(f),quoted=await service.preview(f.order.id,next,renewalOps,created.id);await service.act(created.id,'quotes',{...next,previewHash:quoted.previewHash,revision:created.revision,idempotencyKey:'finance-core-quote'},renewalOps);
 const change=f.changes[0],quote=f.quotes[0];await service.act(change.id,'review',{revision:change.revision,idempotencyKey:'finance-core-review',decision:'APPROVED',note:'独立核对本次续期'},renewalFinance);await service.act(change.id,'publish',{revision:change.revision,idempotencyKey:'finance-core-publish'},renewalOps);
 await service.customerAct(change.id,'confirm',{revision:change.revision,idempotencyKey:'finance-core-confirm',quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,bodyHash:quote.snapshot.document.bodyHash,lessorHash:quote.snapshot.source.lessorHash,noticeHash:quote.snapshot.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingAccepted:true},f.customer.id);
 const contract=quote.contract,archiveId='renewal-paper',versionId=archiveId+'-v1',source=f.source(archiveId+'-source'),signed={...f.source(archiveId+'-signed'),purpose:'offline-archive'},binding={versionId,fileId:signed.id,position:1,file:signed};Object.assign(f.files.find(v=>v.id===signed.id)!,signed);
 const version={...structuredClone(f.rental.versions[0]),id:versionId,archiveId,templateId:quote.snapshot.document.id,templateVersion:quote.snapshot.document.version,businessSnapshotHash:quote.commercialHash,scopeSnapshot:offlineChangeScope(change,quote,contract),sourceFileId:source.id,files:[binding],fileManifestHash:validateManifest([binding]),partyChecks:f.initial.partiesSnapshot.map((p:any)=>({...p,passed:true,signaturePageRefs:[{fileId:signed.id,page:1}],authorityFileIds:[]}))};
 const archive={id:archiveId,kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:quote.id,quoteId:quote.id,orderId:f.order.id,ownerId:f.owner.id,handoverId:null,currentApprovedVersionId:versionId,versions:[version]};f.archives.push(archive);contract.offlineArchiveId=archiveId;change.status='AWAITING_FINANCE';
 for(const bill of f.bills)for(const payment of bill.payments)Object.assign(payment,{billId:bill.id,customerId:f.customer.id,revision:1,providerTransactionId:'transaction-'+payment.id,reconciliationRequired:false,refunds:[]});
 const allocations=f.allocations,oldObligationFind=tx.serviceObligation.findMany;
 tx.serviceObligation.findMany=async(args:any={})=>(await oldObligationFind(args)).map((o:any)=>({...o,allocations:allocations.filter(a=>a.obligationId===o.id&&!a.releasedAt).map(a=>({...a,payment:f.bills.flatMap(b=>b.payments).find(p=>p.id===a.paymentId)}))}));
 tx.paymentAllocation.findMany=async({where}:any={})=>allocations.filter(a=>!a.releasedAt&&(!where?.paymentId?.in||where.paymentId.in.includes(a.paymentId)));
 tx.bill.create=async({data}:any)=>{const b={id:'renewal-bill-'+f.bills.length,paidAmount:0,payments:[],...data};f.bills.push(b);f.writes.push({table:'bill',data});return b;};
 tx.orderServiceStage.findFirst=async({where}:any)=>f.stages.find(s=>Object.entries(where).every(([k,v]:any)=>typeof v==='object'?v.in?.includes(s[k]):s[k]===v))??null;
 tx.orderServiceStage.updateMany=async({where,data}:any)=>{const s=f.stages.find(s=>s.id===where.id&&s.revision===where.revision);if(!s)return{count:0};Object.assign(s,data,{revision:s.revision+(data.revision?.increment??0)});f.writes.push({table:'stage.update',data});return{count:1};};
 const pay=(bill:any)=>{const p={id:'paid-'+bill.id,billId:bill.id,customerId:f.customer.id,revision:1,status:'SUCCEEDED',amount:bill.amount,providerTransactionId:'transaction-'+bill.id,reconciliationRequired:false,refunds:[]};bill.payments.push(p);bill.paidAmount=bill.amount;bill.status='PAID';const obligation=f.obligations.find(o=>o.chargeBillId===bill.id);if(obligation)allocations.push({id:'allocation-'+bill.id,paymentId:p.id,obligationId:obligation.id,amount:bill.amount,releasedAt:null});return p;};
 return{...f,service,change,quote,contract,archive,version,pay};
}

import {freezeSwapPolicy} from '../src/swap-purchases/policy';
export async function stageOfflineSwapFixture(){
 const f=await stageFinanceFixture({depositAmount:50000}),tx=f.tx,p=await f.service.financePreview(f.change.id,renewalFinance);
 await f.service.prepare(f.change.id,{revision:p.revision,orderRevision:p.orderRevision,accountRevision:p.accountRevision,previewHash:p.previewHash,idempotencyKey:'activation-prepare'},renewalFinance);
 const stage=f.stages.find(s=>s.kind==='RENEWAL')!;
 for(const bill of f.bills)if(bill.status==='PENDING'&&(bill.serviceStageId!==stage.id||bill.sequence===stage.firstPeriodSequence))f.pay(bill);
 const schedule=await f.service.schedulePreview(f.change.id,renewalFinance);
 await f.service.schedule(f.change.id,{revision:schedule.revision,orderRevision:schedule.orderRevision,accountRevision:schedule.accountRevision,stageId:stage.id,stageRevision:stage.revision,previewHash:schedule.previewHash,idempotencyKey:'activation-schedule'},renewalFinance);
 let now=new Date('2027-10-01T00:00:00+08:00');
 const periods:any[]=(await tx.usagePeriod.findMany()).map((p:any)=>({...p,effectiveEndDate:p.endDate,status:'OPEN',revision:0,startReadingKm:p.sequence===1?100:null,endReadingKm:null,readingId:null}));
 // Intentionally leave other original periods unsegmented: activation must not backfill them.
 const segments:any[]=[{id:'original-segment',periodId:periods[0].id,assignmentId:f.assignment.id,vehicleId:f.vehicle.id,startAt:f.assignment.startAt,startReadingKm:100,endReadingKm:321,status:'READY',readingId:'actual-old-reading',revision:2}];
 const matches=(row:any,where:any={})=>Object.entries(where).every(([k,v]:any)=>v&&typeof v==='object'&&!(v instanceof Date)?v.not!==undefined?row[k]!==v.not:v.in? v.in.includes(row[k]):true:row[k]===v);
 tx.usagePeriod.findMany=async({where}:any={})=>periods.filter(p=>matches(p,where));
 tx.usagePeriod.create=async({data}:any)=>{const p={id:'period-'+data.sequence,status:'OPEN',revision:0,startReadingKm:null,endReadingKm:null,readingId:null,...data};periods.push(p);f.writes.push({table:'usagePeriod.create',data});return p;};
 tx.usageSegment={upsert:async({where,create}:any)=>{const old=segments.find(s=>matches(s,where.periodId_assignmentId));if(old)return old;const s={id:'segment-'+segments.length,revision:0,...create};segments.push(s);f.writes.push({table:'usageSegment.create',data:create});return s;}};
 tx.orderTermsVersion.create=async({data}:any)=>{const row={id:'activated-terms-'+(f.terms.length+1),...data};f.terms.push(row);f.writes.push({table:'terms.create',data});return row;};
 tx.orderTermsVersion.findFirst=async({where}:any)=>f.terms.find(t=>matches(t,where))??null;
 tx.usageAccount.updateMany=async({where,data}:any)=>{if(!matches(f.account,where))return{count:0};Object.assign(f.account,data,{revision:(f.account as any).revision+(data.revision?.increment??0)});f.writes.push({table:'account.update',data});return{count:1};};
 tx.serviceObligation.updateMany=async({where,data}:any)=>{const rows=f.obligations.filter(o=>matches(o,where));for(const o of rows)Object.assign(o,data);f.writes.push({table:'obligations.update',where,data});return{count:rows.length};};
 const firstOld=f.bills.find(b=>!b.serviceStageId&&b.type==='SUBSCRIPTION')!,paid=firstOld.payments.find((p:any)=>p.status==='SUCCEEDED')!;
 const oldObligation={id:'old-preserved-obligation',orderId:f.order.id,quoteId:'prior-quote',serviceStageId:null,stageSequence:null,sequence:1,startDate:periods[0].startDate,endDate:periods[0].endDate,dueDate:periods[0].startDate,amount:firstOld.amount,chargeAmount:0,chargeBillId:null,sourceBillIds:[firstOld.id],active:true};f.obligations.push(oldObligation);
 f.allocations.push({id:'old-actual-allocation',paymentId:paid.id,obligationId:oldObligation.id,amount:firstOld.amount,releasedAt:null});
 const oldFree={id:'old-free',orderId:f.order.id,serviceStageId:null,source:'FREE',status:'ACTIVE',termSequence:1,cycleSequence:null,consumedChangeId:null,sourcePaymentId:null,policySnapshot:freezeSwapPolicy(f.order)};
 const paidCredit={id:'old-paid',orderId:f.order.id,serviceStageId:null,source:'PAID',status:'ACTIVE',sourcePaymentId:'original-paid-receipt',termSequence:null,cycleSequence:null,policySnapshot:freezeSwapPolicy(f.order)};
 const paidPurchase={id:'old-paid-purchase',creditId:paidCredit.id,amount:50000,expiresAt:new Date('2027-10-01T00:00:00+08:00')};f.credits.push(oldFree,paidCredit);
 f.reservations.push({id:'old-free-reservation',creditId:oldFree.id,changeId:'older-cancelled-change',status:'RESERVED'});
 tx.swapCredit.findMany=async({where}:any={})=>f.credits.filter(c=>matches(c,where));tx.swapCredit.update=async({where,data}:any)=>{const c=f.credits.find(c=>c.id===where.id)!;Object.assign(c,data);return c;};
 tx.swapReservation.findMany=async({where}:any)=>f.reservations.filter(r=>matches(r,where));tx.swapReservation.update=async({where,data}:any)=>{const r=f.reservations.find(r=>r.id===where.id)!;Object.assign(r,data);return r;};
 tx.swapCreditPurchase.findMany=async()=>[paidPurchase];
 const service=new OrderRenewalsService(f.db as any,()=>now);
 return{...f,service,stage,periods,segments,oldObligation,oldFree,paidCredit,paidPurchase,setNow:(value:string)=>{now=new Date(value);},now:()=>now,ops:renewalOps};
}

export const stageActivationInput=(view:any)=>({revision:view.revision,orderRevision:view.orderRevision,accountRevision:view.accountRevision,stageId:view.stageId,stageRevision:view.stageRevision,previousStageRevision:view.previousStageRevision,assignmentId:view.assignmentId,previewHash:view.previewHash,idempotencyKey:'explicit-activation-once'});

export async function activeRenewalMoney(){
 const f=await stageOfflineSwapFixture(),view=await f.service.activationPreview(f.change.id,f.ops);await f.service.activate(f.change.id,stageActivationInput(view),f.ops);
 const terms=f.terms.at(-1)!;const change={id:'stage-swap',kind:'VEHICLE_CHANGE',orderId:f.order.id,customerId:f.customer.id,priorTermsVersionId:terms.id,priorTerms:structuredClone(terms.snapshot),priorTermsHash:hash(terms.snapshot)};
 f.tx.orderTermsVersion.findUnique=async({where}:any)=>f.terms.find(t=>t.id===where.id)??null;
 return{...f,swap:change};
}

export async function activeStageSwapFixture(){
 const f=await activeRenewalMoney(),tx=f.tx,renewal=f.change,renewalQuote=f.quote;
 const change:any={...f.swap,revision:0,status:'DRAFT',activeQuoteId:null,createdBy:'ops',originalContractId:renewal.originalContractId,originalArchiveVersionId:renewal.originalArchiveVersionId};f.changes.push(change);
 f.credits.splice(f.credits.indexOf(f.paidCredit),1); // This prior activation fixture deliberately uses an incomplete paid credit; this package does not purchase it.
 const product={...structuredClone(f.product),id:'swap-target-version',productId:'swap-target-product',baseFeeAmount:30000,mileageMonthlyFeeAmount:0,monthlyFeeAmount:30000,vehicleIds:[f.target.id],swapPolicy:{version:2,period:'TERM',includedCount:99,extraFeeAmount:99999}};
 const plan:any={id:'swap-target-plan',vehicleId:f.target.id,vehicle:f.target,productVersionId:product.id,productVersion:product,active:true,listing:{id:'swap-target-listing',revision:1,vehicleId:f.target.id,subscriptionPlanId:'swap-target-plan',productVersionId:product.id,status:'PUBLISHED',visible:true,source:'EXPLICIT',snapshot:versionSnapshot(product),productSourceHash:canonicalHash(versionSnapshot(product))}};
 const oldPlan=tx.subscriptionPlan.findUnique,oldListing=tx.vehicleListing.findUnique,oldProduct=tx.productVersion.findUnique;
 tx.subscriptionPlan.findUnique=async(args:any)=>args.where.id===plan.id?plan:oldPlan(args);tx.vehicleListing.findUnique=async(args:any)=>args.where.id===plan.listing.id?plan.listing:oldListing(args);tx.productVersion.findUnique=async(args:any)=>args.where.id===product.id?product:oldProduct(args);
 f.agreementVersion.vehicleIds=[f.vehicle.id,f.target.id];tx.partnerAgreementVehicle.findUnique=async({where}:any)=>({vehicleId:where.vehicleId,ownerId:f.owner.id,agreementId:f.agreement.id,agreementVersionId:f.agreementVersion.id,revision:1});
 const match=(row:any,where:any={})=>Object.entries(where).every(([k,v]:any)=>v&&typeof v==='object'&&!(v instanceof Date)?v.in?v.in.includes(row[k]):v.notIn?!v.notIn.includes(row[k]):v.not!==undefined?row[k]!==v.not:true:row[k]===v);
 tx.swapReservation.count=async({where}:any)=>f.reservations.filter(r=>match(r,where)).length;
 tx.serviceObligation.findMany=async({where}:any={})=>f.obligations.filter(o=>match(o,where)).map(o=>({...o,allocations:f.allocations.filter(a=>a.obligationId===o.id&&!a.releasedAt)}));
 tx.serviceObligation.findFirst=async({where}:any)=>f.obligations.find(o=>match(o,where))??null;
 tx.serviceObligation.updateMany=async({where,data}:any)=>{const rows=f.obligations.filter(o=>match(o,where));rows.forEach(o=>Object.assign(o,data));f.writes.push({table:'stage-obligations.update',where,data});return{count:rows.length};};
 tx.paymentAllocation.updateMany=async({where,data}:any)=>{const rows=f.allocations.filter(a=>!a.releasedAt&&f.obligations.some(o=>o.id===a.obligationId&&match(o,where.obligation)));rows.forEach(a=>Object.assign(a,data));f.writes.push({table:'allocations.release',where,data});return{count:rows.length};};
 tx.paymentAllocation.aggregate=async({where}:any)=>({_sum:{amount:f.allocations.filter(a=>!a.releasedAt&&a.paymentId===where.paymentId&&f.obligations.some(o=>o.id===a.obligationId&&match(o,where.obligation))).reduce((n,a)=>n+a.amount,0)}});
 tx.orderChange.findMany=async({where}:any={})=>f.changes.filter(c=>match(c,where));
 tx.orderServiceStage.findMany=async({where}:any={})=>f.stages.filter(s=>match(s,where));
 tx.payment.findMany=async()=>f.bills.filter(b=>['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(b.type)).flatMap(b=>b.payments);
 tx.bill.updateMany=async({where,data}:any)=>{const rows=f.bills.filter(b=>match(b,where));rows.forEach(b=>Object.assign(b,data));return{count:rows.length};};
 const p=listedProductSnapshot(plan),input={pricingVersion:2 as const,revision:0,idempotencyKey:'stage-quote',targetListingId:p.listingId,targetListingRevision:p.listingRevision,targetSourceHash:p.sourceHash,plannedReturnAt:'2027-10-02T09:00:00+08:00',plannedDeliveryAt:'2027-10-02T10:00:00+08:00',depositAmount:50000,depositBasis:'押金沿用实际本金',insuranceResponsibility:'按实际目标车辆保障',downtimeArrangement:'当天明确安排',settlementExplanation:'本续期服务段原逐期净差',handoverArrangement:'双侧确认归档',cancellationTerms:'实际收退款核清',reason:'续期同价升级',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};
 return{...f,renewal,renewalQuote,change,swapPlan:plan,swapProduct:product,input};
}

export async function confirmedStageSwapFixture(){
 const f=await activeStageSwapFixture();await createOfflineSwapQuote(f.tx,f.change,f.input,f.ops);const q=f.quotes.at(-1)!;
 Object.assign(q,{status:'REVIEWED',reviewedBy:'finance',reviewNote:'逐期独立复核'});f.change.status='REVIEWED';await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:q.commercialHash});
 const archiveQuote=(quote=q)=>{
  const contract=f.contracts.find(c=>c.delayQuoteId===quote.id)!,archive=structuredClone(f.archive);archive.id='stage-swap-paper-'+quote.id;archive.quoteId=quote.id;archive.subjectId=quote.id;const version=archive.versions[0];version.id=archive.id+'-v1';version.archiveId=archive.id;archive.currentApprovedVersionId=version.id;
  for(const b of version.files)b.versionId=version.id;Object.assign(version,{businessSnapshotHash:quote.commercialHash,scopeSnapshot:offlineChangeScope(f.change,quote,contract),templateId:quote.snapshot.document.id,templateVersion:quote.snapshot.document.version});contract.offlineArchiveId=archive.id;f.archives.push(archive);f.change.status='AWAITING_FINANCE';return version;
 };const paper=archiveQuote();return{...f,q,paper,archiveQuote};
}
