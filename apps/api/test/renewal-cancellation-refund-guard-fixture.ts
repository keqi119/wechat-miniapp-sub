import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {addRenewalCancellationArchive} from './renewal-cancellation-paper-fixture';
import {renewalOps,renewalFinance,renewalNow} from './order-renewals-fixture';
import {BillingController,BillingService} from '../src/billing/billing';
import {fail} from '../src/common/errors';

export async function cancellationRefundGuardFixture(){
 const f=await renewalCancellationFixture(true),s=f.service,tx:any=f.tx,bill=f.bills.find(b=>b.serviceStageId===f.stage!.id)!,payment=f.pay(bill);
 tx.orderPreDeliveryCancellation={findFirst:async()=>null}; // This fixture is a05 cancellation, without an original04 case.
 const preview=()=>s.cancellationPreview(f.change.id,renewalOps);
 let p=await preview();await s.openCancellation(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,previewHash:p.previewHash,reason:'双方期前取消且新增实收全退',idempotencyKey:'guard-open'},renewalOps);
 const base=async()=>{const current=await preview();return{cancellationId:f.cases[0].id,cancellationRevision:f.cases[0].revision,revision:f.change.revision,orderRevision:f.order.revision,previewHash:current.previewHash};};
 await s.verifyCancellationSignature(f.change.id,{...await base(),signatureState:'SIGNED',evidenceFileIds:[f.evidence.id],note:'核实原续期签署资料及取消所需文件',idempotencyKey:'guard-signature'},renewalOps);
 await s.confirmCancellationAgreement(f.change.id,{...await base(),mutuallyAgreedAt:renewalNow.toISOString(),evidenceFileIds:[f.evidence.id],note:'双方真实同意取消所记时间及有权代表已核对',idempotencyKey:'guard-agreement'},renewalOps);
 const paper=await addRenewalCancellationArchive(f,f.cases[0]);
 await s.requestCancellationRefund(f.change.id,{...await base(),paymentId:payment.id,reason:'新增续期全部实收原路退款，无取消费',idempotencyKey:'guard-refund'},renewalFinance);
 const refund=f.refunds[0],reviewer={id:'finance-review',role:'FINANCE',authVersion:1};
 tx.bill.findUniqueOrThrow=async({where}:any)=>{const row=f.bills.find(b=>b.id===where.id);if(!row)throw new Error('synthetic bill not found');return row;};
 for(const staff of f.staff.values())Object.assign(staff,{staffPersonId:'person-'+staff.id});f.staff.set(reviewer.id,{...reviewer,active:true,staffPersonId:'person-independent'} as any);
 tx.adminUser.findMany=async({where}:any)=>[...f.staff.values()].filter(staff=>where.id.in.includes(staff.id));
 const attach=async(row:any)=>row?{...row,payment:await tx.payment.findUnique({where:{id:row.paymentId}})}:null;
 const find=tx.refund.findUnique,update=tx.refund.update;
 tx.refund.findUnique=async(args:any)=>{const row=await find(args);return args.include?.payment?attach(row):row?{...row}:null;};
 tx.refund.update=async(args:any)=>{const row=await update(args);return args.include?.payment?attach(row):row;};
 const locks:string[]=[];let onOrderLock:(()=>void)|undefined;
 const raw=tx.$queryRaw;tx.$queryRaw=async(parts:any,...values:any[])=>{const sql=parts.join('?');locks.push(sql);if(sql.includes('FROM "Order"'))onOrderLock?.();return raw(parts,...values);};
 tx.adminUser.findUniqueOrThrow=tx.adminUser.findUnique;tx.refund.findUniqueOrThrow=tx.refund.findUnique;
 for(const r of f.refunds)r.method='WECHAT_ORIGINAL';
 const calls:any[]=[],recorded:any[]=[];let queryResult:any=null;
 const gateway:any={refund:async(input:any)=>{calls.push(input);return{status:'PROCESSING',providerRefundId:'synthetic-only-refund'};},queryRefund:async()=>{if(queryResult)return queryResult;return fail(404,'REFUND_NOT_FOUND','合成渠道查询无此单');}};
 const billing=new BillingService(f.db as any,gateway,()=>renewalNow);
 billing.settleRefund=async(id:string,event:any)=>{recorded.push({id,...event});return{id,...event};};
 const controller=new BillingController(f.db as any,billing,gateway,()=>renewalNow);
 const processing=()=>Object.assign(refund,{status:'PROCESSING',approvedBy:reviewer.id,updatedAt:new Date(Date.now()-60000)});
 return{...f,tx,refund,bill,payment,paper,reviewer,billing,controller,calls,recorded,locks,processing,setQuery:(v:any)=>{queryResult=v;},onOrderLock:(fn:()=>void)=>{onOrderLock=fn;}};
}
