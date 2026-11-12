import {completedCancellationFixture,lateNow} from './renewal-cancellation-history-fixture';
import {renewalFinance} from './order-renewals-fixture';
import {BillingController,BillingService} from '../src/billing/billing';
import {fail} from '../src/common/errors';

export async function lateRefundGuardFixture(){
 const f=await completedCancellationFixture(),tx:any=f.tx,s:any=f.service;f.arrive();
 tx.orderPreDeliveryCancellation={findFirst:async()=>null}; // Existing05 late receipt, not an original04 obligation.
 const p=await s.cancellationLateRefundPreview(f.change.id,f.attempt.id,renewalFinance);
 await s.requestCancellationLateRefund(f.change.id,{cancellationId:p.cancellationId,cancellationRevision:p.cancellationRevision,orderRevision:p.orderRevision,previewHash:p.previewHash,paymentId:f.attempt.id,reason:'原关闭付款可信晚到，全额退回',idempotencyKey:'late-guard-request'},renewalFinance);
 const request=f.refunds[0],reviewer={id:'late-finance-reviewer',role:'FINANCE',authVersion:1};
 for(const staff of f.staff.values())Object.assign(staff,{staffPersonId:'person-'+staff.id});f.staff.set(reviewer.id,{...reviewer,active:true,staffPersonId:'independent-reviewer'} as any);
 tx.adminUser.findMany=async({where}:any)=>[...f.staff.values()].filter(staff=>where.id.in.includes(staff.id));
 tx.bill.findUniqueOrThrow=async({where}:any)=>{const row=f.bills.find(b=>b.id===where.id);if(!row)throw new Error('bill missing');return row;};
 const find=tx.refund.findUnique,update=tx.refund.update,withPayment=async(row:any)=>row?{...row,payment:await tx.payment.findUnique({where:{id:row.paymentId}})}:null;
 tx.refund.findUnique=async(args:any)=>{const row=await find(args);return args.include?.payment?withPayment(row):row?{...row}:null;};
 tx.refund.update=async(args:any)=>{const row=await update(args);return args.include?.payment?withPayment(row):row;};
 tx.refund.aggregate=async({where}:any)=>({_sum:{amount:f.refunds.filter(r=>r.paymentId===where.paymentId&&where.status.in.includes(r.status)).reduce((n,r)=>n+r.amount,0)}});
 tx.payment.findUniqueOrThrow=tx.payment.findUnique;tx.adminUser.findUniqueOrThrow=tx.adminUser.findUnique;tx.refund.findUniqueOrThrow=tx.refund.findUnique;
 for(const r of f.refunds)r.method='WECHAT_ORIGINAL';
 const calls:any[]=[],recorded:any[]=[],gateway:any={refund:async(input:any)=>{calls.push(input);return{status:'PROCESSING',providerRefundId:'synthetic-late-refund'};},queryRefund:async()=>fail(404,'REFUND_NOT_FOUND','合成渠道查无此单')};
 const billing=new BillingService(f.db as any,gateway,()=>lateNow);billing.settleRefund=async(id:string,event:any)=>{recorded.push({id,...event});return{id,...event};};
 const controller=new BillingController(f.db as any,billing,gateway,()=>lateNow);
 return{...f,tx,request,reviewer,billing,controller,calls,recorded};
}
