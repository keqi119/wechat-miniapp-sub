import {renewalFinanceFixture} from './order-renewals-finance-fixture';
import {renewalFinance,renewalOps} from './order-renewals-fixture';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {freezeSwapPolicy} from '../src/swap-purchases/policy';

export async function renewalActivationFixture(){
 const f=await renewalFinanceFixture({depositAmount:50000}),tx=f.tx,p=await f.service.financePreview(f.change.id,renewalFinance);
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

export const activationInput=(view:any)=>({revision:view.revision,orderRevision:view.orderRevision,accountRevision:view.accountRevision,stageId:view.stageId,stageRevision:view.stageRevision,previousStageRevision:view.previousStageRevision,assignmentId:view.assignmentId,previewHash:view.previewHash,idempotencyKey:'explicit-activation-once'});
