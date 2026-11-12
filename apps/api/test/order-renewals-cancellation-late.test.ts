import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {renewalOps,renewalFinance,renewalNow} from './order-renewals-fixture';
import {addRenewalCancellationArchive} from './renewal-cancellation-paper-fixture';

const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
export async function completedCancellationLateFixture(count=1){
 const f=await renewalCancellationFixture(true),s:any=f.service,bill=f.bills.find(b=>b.serviceStageId===f.stage!.id)!;
 const payment:any={id:'original-closed-before-cancellation',billId:bill.id,customerId:f.customer.id,revision:0,status:'CLOSED',amount:bill.amount,providerTransactionId:null,succeededAt:null,reconciliationRequired:false,reconciliationReason:null,refunds:[],createdAt:renewalNow,updatedAt:renewalNow};bill.payments.push(payment);
 for(let i=1;i<count;i++)bill.payments.push({...payment,id:`original-closed-before-cancellation-${i}`,refunds:[]});
 const p=await s.cancellationPreview(f.change.id,renewalOps);await s.openCancellation(f.change.id,{revision:p.revision,orderRevision:p.orderRevision,previewHash:p.previewHash,reason:'双方取消尚未开始的续期，新增实收全额退还无费用',idempotencyKey:'late-fixture-open'},renewalOps);
 const input=async()=>{const v=await s.cancellationPreview(f.change.id,renewalOps);return{revision:v.revision,orderRevision:v.orderRevision,cancellationId:v.cancellationId,cancellationRevision:v.cancellationRevision,previewHash:v.previewHash};};
 await s.confirmCancellationAgreement(f.change.id,{...await input(),mutuallyAgreedAt:renewalNow.toISOString(),evidenceFileIds:[f.evidence.id],note:'已核对真实双方期前取消同意及明确全退无费用',idempotencyKey:'late-fixture-mutual'},renewalOps);
 await s.verifyCancellationSignature(f.change.id,{...await input(),signatureState:'SIGNED',evidenceFileIds:[f.evidence.id],note:'已核验原续期签字原件及本次三方取消约定',idempotencyKey:'late-fixture-signature'},renewalOps);
 await addRenewalCancellationArchive(f,f.cases[0]);await s.cancelPrepared(f.change.id,{...await input(),reason:'已知实际新期实收为零且无未决状态',idempotencyKey:'late-fixture-complete'},renewalOps);
 const immutable=structuredClone({record:f.cases[0],change:f.change,stage:f.stage,bills:f.bills,account:f.account,terms:f.terms,assignment:f.assignment});
 Object.assign(payment,{status:'SUCCEEDED',providerTransactionId:'trusted-late-channel-original',succeededAt:renewalNow,reconciliationRequired:true,reconciliationReason:'BILL_CHANGED_AFTER_PAYMENT',revision:1});
 return{...f,payment,bill,immutable};
}

test('completed cancellation has a specific full late-refund command and never rewrites its completion or original period',async()=>{
 const f=await completedCancellationLateFixture(),s:any=f.service;
 assert.equal(typeof s.cancellationLateRefundPreview,'function','completed late receipt needs its own verified source preview');
 assert.equal(typeof s.requestCancellationLateRefund,'function','completed cancellation cannot use OPEN refund commands');
 const p=await s.cancellationLateRefundPreview(f.change.id,f.payment.id,renewalFinance);
 assert.equal(p.paymentId,f.payment.id);assert.equal(p.remainingRefundAmount,20000);assert.equal(p.eligibleLateReceipt,true);assert.equal('providerTransactionId'in p,false);assert.equal('sourceSnapshot'in p,false);
 const input={cancellationId:p.cancellationId,cancellationRevision:p.cancellationRevision,orderRevision:p.orderRevision,previewHash:p.previewHash,paymentId:f.payment.id,reason:'原取消完成时已关闭的同笔付款可信晚到，全部原路退回',idempotencyKey:'specific-late-full-refund'};
 const unchanged=structuredClone({record:f.cases[0],change:f.change,stage:f.stage,bills:f.bills,account:f.account,terms:f.terms,assignment:f.assignment}),beforeRevision=f.order.revision;
 const result=await s.requestCancellationLateRefund(f.change.id,input,renewalFinance);assert.equal(result.amount,20000);assert.equal(result.status,'PENDING_APPROVAL');assert.equal(f.order.revision,beforeRevision+1);
 assert.deepEqual({record:f.cases[0],change:f.change,stage:f.stage,bills:f.bills,account:f.account,terms:f.terms,assignment:f.assignment},unchanged);
 assert.equal(f.refunds.length,1);assert.deepEqual([f.refunds[0].renewalCancellationId,f.refunds[0].renewalCancellationOrderId,f.refunds[0].renewalCancellationStageId,f.refunds[0].renewalCancellationBillId],[f.cases[0].id,f.order.id,f.stage!.id,f.bill.id]);
 const writes=f.writes.length;assert.deepEqual(await s.requestCancellationLateRefund(f.change.id,input,renewalFinance),result);assert.equal(f.writes.length,writes);assert.equal(f.order.revision,beforeRevision+1);
 const pending=await s.cancellationLateRefundPreview(f.change.id,f.payment.id,renewalFinance);await assert.rejects(s.requestCancellationLateRefund(f.change.id,{...input,orderRevision:pending.orderRevision,previewHash:pending.previewHash,idempotencyKey:'duplicate-pending-late-refund'},renewalFinance),code('RENEWAL_CANCELLATION_REFUND_PENDING'));assert.equal(f.refunds.length,1);
 await assert.rejects(s.requestCancellationLateRefund(f.change.id,{...input,amount:1,idempotencyKey:'forbidden-late-partial'},renewalFinance));
 await assert.rejects(s.requestCancellationLateRefund(f.change.id,input,renewalOps),code('FORBIDDEN'));f.staff.get(renewalFinance.id)!.authVersion++;await assert.rejects(s.requestCancellationLateRefund(f.change.id,input,renewalFinance),code('STAFF_SESSION_CHANGED'));
});

test('late-refund preview is source-bound, stale money cannot write, and a payment created after completion is never eligible',async()=>{
 const f=await completedCancellationLateFixture(),s:any=f.service,p=await s.cancellationLateRefundPreview(f.change.id,f.payment.id,renewalFinance),input={cancellationId:p.cancellationId,cancellationRevision:p.cancellationRevision,orderRevision:p.orderRevision,previewHash:p.previewHash,paymentId:f.payment.id,reason:'核对原笔迟到款全退',idempotencyKey:'stale-late-source'};
 f.payment.revision++;await assert.rejects(s.requestCancellationLateRefund(f.change.id,input,renewalFinance),code('PREVIEW_CHANGED'));assert.equal(f.refunds.length,0);
 const introduced={...f.payment,id:'post-completion-new-payment',providerTransactionId:'unrelated-new-channel-result'};f.bill.payments.push(introduced);
 const invalid=await s.cancellationLateRefundPreview(f.change.id,introduced.id,renewalFinance);assert.equal(invalid.eligibleLateReceipt,false);
 await assert.rejects(s.requestCancellationLateRefund(f.change.id,{...input,paymentId:introduced.id,previewHash:invalid.previewHash,orderRevision:invalid.orderRevision,idempotencyKey:'refuse-new-payment'},renewalFinance),code('RENEWAL_CANCELLATION_REFUND_SOURCE'));assert.equal(f.refunds.length,0);
 await assert.rejects(s.cancellationLateRefundPreview(f.change.id,'foreign-payment',renewalFinance),code('NOT_FOUND'));
 const failure=new Error('unavailable payment facts');f.tx.payment.findMany=async()=>{throw failure;};await assert.rejects(s.cancellationLateRefundPreview(f.change.id,f.payment.id,renewalFinance),e=>e===failure);
});

test('finance discovers original late-payment IDs through a read-only bounded list with no private source or channel fields',async()=>{
 const f=await completedCancellationLateFixture(2),s:any=f.service;
 assert.equal(typeof s.cancellationLatePayments,'function','finance must discover an eligible original payment without typing an internal ID');
 const before=structuredClone({record:f.cases[0],order:f.order,stage:f.stage}),writes=f.writes.length;
 const page1=await s.cancellationLatePayments(f.change.id,{page:'1',pageSize:'1'},renewalFinance),page2=await s.cancellationLatePayments(f.change.id,{page:2,pageSize:1},renewalFinance);
 assert.equal(page1.total,2);assert.equal(page1.items.length,1);assert.equal(page2.total,2);assert.equal(page2.items.length,1);assert.notEqual(page1.items[0].id,page2.items[0].id);assert.equal(page1.page,1);assert.equal(page1.pageSize,1);
 const rows=[...page1.items,...page2.items];assert.equal(rows.find((p:any)=>p.id===f.payment.id).remainingRefundAmount,20000);assert.equal(rows.find((p:any)=>p.id===f.payment.id).eligibleLateReceipt,true);
 const serialized=JSON.stringify(page1);for(const field of ['sourceSnapshot','completionSnapshot','providerTransactionId','providerRefundId','signatureEvidenceFileIds','mutualAgreementEvidenceFileIds','document','content'])assert.equal(serialized.includes('"'+field+'"'),false,field+' must not leak in financial list');
 assert.equal(f.writes.length,writes);assert.deepEqual({record:f.cases[0],order:f.order,stage:f.stage},before);
 await assert.rejects(s.cancellationLatePayments(f.change.id,{},renewalOps),code('FORBIDDEN'));await assert.rejects(s.cancellationLatePayments(f.change.id,{}, {id:f.customer.id}),code('STAFF_SESSION_CHANGED'));
 for(const query of [{page:1000001},{pageSize:101},{page:1.5},{page:0},{unknown:'field'}])await assert.rejects(s.cancellationLatePayments(f.change.id,query,renewalFinance));
 f.staff.get(renewalFinance.id)!.authVersion++;await assert.rejects(s.cancellationLatePayments(f.change.id,{},renewalFinance),code('STAFF_SESSION_CHANGED'));
});
