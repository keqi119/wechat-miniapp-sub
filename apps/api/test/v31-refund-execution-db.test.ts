import {FilesController} from '../src/files/files';
import {refundFunding} from '../src/billing/refund-execution';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PaymentReconciliationService} from '../src/billing/reconciliation';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {refundObligationPerformance,RefundObligationsService} from '../src/billing/refund-obligations';
import {BillingController,BillingService} from '../src/billing/billing';
import {fail} from '../src/common/errors';
const code=(c:string)=>(e:any)=>e.getResponse?.().error?.code===c;
import {hasRefundReceipt} from '../src/billing/refund-proof';
import {Db} from '../src/common/db';
async function exercise(ctx:any,db:any,f:any){
  const service=new RefundObligationsService(db),orderId=f.sub.order.id,view:any=f.existingObligation?null:await service.read(orderId,f.f.actor),ready:any=f.existingObligation?{items:[await refundObligationPerformance(db,f.existingObligation)]}:await service.materialize(orderId,{sourceHash:view.sourceHash,idempotencyKey:randomUUID()},f.reviewer),o=ready.items[0];
  await db.adminUser.update({where:{id:f.f.actor.id},data:{role:'ADMIN'}});f.f.actor.role='ADMIN';
  const maker=f.f.actor,reviewer=f.reviewer,alias=await db.adminUser.create({data:{username:'alias9b-'+randomUUID(),passwordHash:'synthetic',name:'合成9b别名',role:'ADMIN',staffPersonId:(await db.adminUser.findUniqueOrThrow({where:{id:maker.id}})).staffPersonId}}),aliasActor={id:alias.id,role:alias.role,authVersion:alias.authVersion};
  const rejectedCustomerIds=new Set<string>();let unknown=true,queryMissing=true,calls=0;const gateway:any={refund:async(i:any)=>{calls++;if(rejectedCustomerIds.has(i.refundId))fail(409,'REFUND_USER_ACCOUNT_ABNORMAL');if(unknown)fail(503,'PAYMENT_NETWORK_ERROR');return{status:'PROCESSING',providerRefundId:'SYN-9b-'+i.refundId,nativeStatus:'PROCESSING',acceptedAt:new Date().toISOString(),evidenceSource:'REQUEST'};},queryRefund:async(id:string)=>{if(queryMissing||rejectedCustomerIds.has(id))fail(404,'REFUND_NOT_FOUND');const r=await db.refund.findUniqueOrThrow({where:{id}});return{status:'SUCCEEDED',providerRefundId:'SYN-9b-'+id,nativeStatus:'SUCCESS',paymentId:r.paymentId,amount:r.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:r.paymentId}})).amount,acceptedAt:new Date(Date.now()-1000).toISOString(),succeededAt:new Date().toISOString(),evidenceSource:'QUERY'};}};
  const billing=new BillingService(db,gateway),api=new BillingController(db,billing,gateway),body={paymentId:o.paymentId,obligationId:o.id,amount:Math.floor(o.amount/2),reason:'原03精确应退',idempotencyKey:randomUUID()};
  const feeFile=await db.storedFile.create({data:{name:'合成附加费用证据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:'5'.repeat(64),purpose:'evidence',adminId:maker.id}});
  const fee=await api.createBill({orderId,type:'EXTRA_FEE',amount:1,dueDate:'2027-01-14',description:'仅测试独立复核的草稿费用',fileIds:[feeFile.id],idempotencyKey:randomUUID()},{admin:maker});
  await assert.rejects(api.reviewBill(fee.id,{decision:'APPROVED',note:'同人别名不得复核'},{admin:aliasActor}),code('DUAL_APPROVAL'));await api.reviewBill(fee.id,{decision:'REJECTED',note:'真实另一员工拒绝测试草稿，无资金影响'},{admin:reviewer});
  const r:any=await api.requestRefund(body,{admin:maker});assert.equal(r.obligationId,o.id);
  await assert.rejects(api.approve(r.id,{admin:maker}),code('DUAL_APPROVAL'));await assert.rejects(api.approve(r.id,{admin:aliasActor}),code('DUAL_APPROVAL'));
  await assert.rejects(api.approve(r.id,{admin:reviewer}),code('PAYMENT_NETWORK_ERROR'));
  const dispatched:any=await db.refund.findUniqueOrThrow({where:{id:r.id}});assert.ok(dispatched.dispatchedAt);assert.equal(dispatched.acceptedAt,null);assert.equal(dispatched.channelState,'UNKNOWN');
  ctx.mock.timers.setTime(Date.now()+60000);unknown=false;
  const recovered:any=await api.retryRefund(r.id,{admin:reviewer});assert.equal(recovered.status,'PROCESSING');assert.equal(calls,2);assert.ok(recovered.acceptedAt);queryMissing=false;const result:any=await billing.syncRefund(r.id);assert.equal(result.status,'SUCCEEDED');
  const after:any=await refundObligationPerformance(db,await db.refundObligation.findUniqueOrThrow({where:{id:o.id}}));assert.equal(after.completedAmount,body.amount);assert.equal(after.triggerAt,o.triggerAt);assert.equal(after.dueAt,o.dueAt);assert.equal(after.acceptedAmount,body.amount);
  await billing.syncRefund(r.id);assert.equal((await refundObligationPerformance(db,await db.refundObligation.findUniqueOrThrow({where:{id:o.id}}))).completedAmount,body.amount);

  if(process.env.TASK9B_REISSUE_SOURCE){const source={version:1,origin:'task-9b-reissue-source-red.log new real03 command journey and actual half refund',orderId:o.orderId,paymentId:o.paymentId,obligationId:o.id,sourceHash:o.sourceHash,makerId:maker.id,reviewerId:reviewer.id,now:new Date().toISOString()};writeFileSync(resolve('../../.runtime/task9b-reissue-source.json'),JSON.stringify(source));await db.$transaction(async(tx:any)=>{const real=Object.assign(Object.create(tx),{_task9bTransaction:true,serial:(fn:any)=>fn(tx)});await reissueContinuation(ctx,real,source);},{timeout:60000,isolationLevel:'Serializable'});return;}

  if(f.lateFailedPayment)await lateRefundOnly(ctx,db,f,service,api,billing,maker,reviewer);
  await assert.rejects(api.requestRefund({...body,idempotencyKey:randomUUID()},{admin:{...maker,authVersion:maker.authVersion+1}}),code('STAFF_SESSION_CHANGED'));
  const attempts=await Promise.allSettled([1,2].map(()=>api.requestRefund({...body,amount:o.amount-body.amount,idempotencyKey:randomUUID()},{admin:maker})));assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected').length,1);const bank:any=(attempts.find(x=>x.status==='fulfilled') as any).value;
  await api.reject(bank.id,{reason:'合成并发容量核验后分成两笔真实资金验证'},{admin:reviewer});
  const firstAmount=Math.floor(bank.amount/2),bank1:any=await api.requestRefund({...body,amount:firstAmount,idempotencyKey:randomUUID()},{admin:maker}),bank2:any=await api.requestRefund({...body,amount:bank.amount-firstAmount,idempotencyKey:randomUUID()},{admin:maker});
  const accepted:any=await api.approve(bank1.id,{admin:reviewer});await billing.settleRefund(bank1.id,{status:'FAILED',providerRefundId:accepted.providerRefundId,nativeStatus:'CLOSED',evidenceSource:'QUERY',paymentId:bank1.paymentId,amount:bank1.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:bank1.paymentId}})).amount});
  rejectedCustomerIds.add(bank2.id);await assert.rejects(api.approve(bank2.id,{admin:reviewer}),code('REFUND_USER_ACCOUNT_ABNORMAL'));await assert.rejects(billing.syncRefund(bank2.id),code('REFUND_NOT_FOUND'));assert.equal((await db.refund.findUniqueOrThrow({where:{id:bank2.id}})).channelState,'NOT_ACCEPTED_UNAVAILABLE');

  await bankExercise(ctx,db,api,billing,bank1,o,maker,reviewer,{deferConflict:true});
  await bankExercise(ctx,db,api,billing,bank2,o,maker,reviewer,{reverse:true});
  await bankTail(db,billing,bank1,o,await db.refund.findUniqueOrThrow({where:{id:bank1.id}}));

}
async function lateRefundOnly(ctx:any,db:any,f:any,service:any,api:any,billing:any,maker:any,reviewer:any){
 const b=f.lateFailedPayment,orderId=f.sub.order.id;ctx.mock.timers.setTime(Date.now()+1000);
 await billing.settle(b.id,{status:'SUCCEEDED',amount:b.amount,transactionId:'SYN-LATE9b-'+b.id,succeededAt:new Date().toISOString()});
 const view=await service.read(orderId,maker),statement=view.amountStatements.find((v:any)=>v.paymentId===b.id);assert.ok(statement);
 await service.confirm(orderId,{sourceHash:statement.amountStatementHash,accepted:true,idempotencyKey:randomUUID()},f.sub.customer.id);const ready=await service.read(orderId,maker),out=await service.materialize(orderId,{sourceHash:ready.sourceHash,idempotencyKey:randomUUID()},reviewer),o=out.items.find((v:any)=>v.paymentId===b.id);assert.ok(o);
 const amount=process.env.TASK9B_AUTHORIZATION_RED?2000:o.amount;const body={paymentId:b.id,obligationId:o.id,amount,reason:'真实迟到款仅按精确义务退款',idempotencyKey:randomUUID()};await assert.rejects(api.requestRefund(body,{admin:maker}),code('PAYMENT_RECONCILIATION_REQUIRED'));
 const file=await db.storedFile.create({data:{name:'合成迟到款核对.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:'6'.repeat(64),purpose:'evidence',adminId:maker.id}}),reconciliation=new PaymentReconciliationService(),p=await db.payment.findUniqueOrThrow({where:{id:b.id}});
 const submitted=await db.serial((tx:any)=>reconciliation.submit(tx,maker,b.id,{revision:p.revision,idempotencyKey:randomUUID(),resolution:'REFUND_ONLY',obligationId:o.id,refundAmount:amount,note:'核实本笔真实迟到款及仅退本金，不分配履约',evidenceFileIds:[file.id]}));
 await assert.rejects(db.serial((tx:any)=>reconciliation.review(tx,maker,b.id,submitted.id,{revision:submitted.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'不得自审'})),code('SELF_REVIEW'));
 const approved=await db.serial((tx:any)=>reconciliation.review(tx,reviewer,b.id,submitted.id,{revision:submitted.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'独立核对精确原付款与应退来源'}));assert.equal((await db.payment.findUniqueOrThrow({where:{id:b.id}})).reconciliationRequired,true);assert.equal(await db.partnerRevenueEvent.count({where:{sourceId:b.id}}),0);
 await assert.rejects(db.paymentReconciliation.update({where:{id:submitted.id},data:{paymentSnapshot:{tampered:true}}}));
 const r=await api.requestRefund(body,{admin:maker});await api.approve(r.id,{admin:reviewer});await billing.syncRefund(r.id);assert.equal((await db.payment.findUniqueOrThrow({where:{id:b.id}})).reconciliationRequired,true);
 if(process.env.TASK9B_AUTHORIZATION_RED){
  const fixturePath=resolve('../../.runtime/task9b-authorization-source.json');mkdirSync(resolve('../../.runtime'),{recursive:true});writeFileSync(fixturePath,JSON.stringify({version:1,origin:'task-9b-authorization-red.log default real03 command journey + trusted late B + independent 2000 refund',orderId,paymentId:b.id,obligationId:o.id,sourceHash:o.sourceHash,makerId:maker.id,reviewerId:reviewer.id,refundId:r.id,reconciliationId:submitted.id,evidenceFileId:file.id,now:new Date().toISOString()}));
  let reused:any=null;try{reused=await api.requestRefund({...body,idempotencyKey:randomUUID()},{admin:maker});}catch{}
  if(reused)await api.reject(reused.id,{reason:'检测出旧2000授权被重复使用，保留拒绝记录并停止出款'},{admin:reviewer});
  assert.equal(reused,null,'a 2000-cent REFUND_ONLY approval already used for real cash must not authorize another 2000-cent request');return;
 }
 const current=await db.payment.findUniqueOrThrow({where:{id:b.id}}),done=await db.serial((tx:any)=>reconciliation.submit(tx,maker,b.id,{revision:current.revision,idempotencyKey:randomUUID(),resolution:'REFUNDED',note:'原实收已经足额实际退款',evidenceFileIds:[file.id]}));await db.serial((tx:any)=>reconciliation.review(tx,reviewer,b.id,done.id,{revision:done.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'独立核对真实足额退回'}));assert.equal((await db.payment.findUniqueOrThrow({where:{id:b.id}})).reconciliationRequired,false);
}
async function bankExercise(ctx:any,db:any,api:any,billing:any,bank:any,o:any,maker:any,reviewer:any,options:{reverse?:boolean;deferConflict?:boolean;pendingRace?:boolean}={}){
  const current=await db.refund.findUniqueOrThrow({where:{id:bank.id}});
  const proof=await db.storedFile.create({data:{name:'本人原路不可用和银行账户合成凭据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:100,sha256:'9'.repeat(64),purpose:'refund-bank',customerId:o.customerId}});
  const customer=await db.customer.findUniqueOrThrow({where:{id:o.customerId}});
  let account:any,error:any;try{account=await (api as any).bankSubmit(bank.id,{revision:current.revision,accountNumber:'6222021234567890123',bankName:'合成银行',accountName:customer.name,evidenceFileIds:[proof.id],accepted:true,idempotencyKey:randomUUID()},{customer});}catch(e){error=e;}
  assert.ok(account,'a source-valid terminal original refund must expose customer own-account submission: '+String(error));

  assert.equal(account.method,'MANUAL_BANK');assert.equal(account.status,'PENDING_APPROVAL');assert.equal(account.providerRefundId,null);assert.equal('bankAccountCiphertext' in account,false);
  const origin=await db.refund.findUniqueOrThrow({where:{id:bank.id}});assert.ok(origin.bankAccountCiphertext&&!origin.bankAccountCiphertext.includes('6222021234567890123'));
  const reasonFile=await db.storedFile.create({data:{name:'合成原银行卡销户凭据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:100,sha256:'8'.repeat(64),purpose:'refund-bank',adminId:maker.id}});
  const verification={revision:account.revision,accountHash:account.bankAccount.hash,unavailabilityKind:'CUSTOMER_ACCOUNT_CLOSED',unavailabilityReason:'原客户收款银行卡已真实销户，独立核对银行回函及原退款终态',evidenceFileIds:[reasonFile.id],idempotencyKey:randomUUID()};
  await assert.rejects(api.bankVerify(bank.id,verification,{admin:maker}),code('DUAL_APPROVAL'));
  if((await db.payment.findUniqueOrThrow({where:{id:bank.paymentId}})).reconciliationRequired)await authorizeCurrent(db,maker,reviewer,o,bank.amount,account);
  let approved:any=await api.bankVerify(bank.id,verification,{admin:reviewer});assert.equal(approved.status,'PROCESSING');assert.equal(approved.succeededAt,null);
  const originalProviderId=(origin.channelEvidence as any).providerRefundId??'SYN-9b-'+bank.id,originalEvent={providerRefundId:originalProviderId,paymentId:bank.paymentId,amount:bank.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:bank.paymentId}})).amount,evidenceSource:'QUERY'};
  await billing.settleRefund(bank.id,{...originalEvent,status:'PROCESSING',nativeStatus:'ABNORMAL'});await assert.rejects(api.bankInstructions(bank.id,{admin:reviewer}),code('REFUND_BANK_STATE'));
  const closed=await billing.settleRefund(bank.id,{...originalEvent,status:'FAILED',nativeStatus:'CLOSED'});approved=await api.bankVerify(bank.id,{...verification,revision:closed.revision,idempotencyKey:randomUUID()},{admin:reviewer});
  await assert.rejects(api.bankSubmit(bank.id,{revision:approved.revision,accountNumber:'6222021234567890123',bankName:'合成银行',accountName:'非客户本人',evidenceFileIds:[proof.id],accepted:true,idempotencyKey:randomUUID()},{customer}),code('REFUND_OWN_ACCOUNT_REQUIRED'));
  const replaced:any=await api.bankSubmit(bank.id,{revision:approved.revision,accountNumber:'6222021234567890999',bankName:'合成银行',accountName:customer.name,evidenceFileIds:[proof.id],accepted:true,idempotencyKey:randomUUID()},{customer});assert.equal(replaced.approvedBy,null);assert.equal(replaced.status,'PENDING_APPROVAL');assert.notEqual(replaced.bankAccount.hash,approved.bankAccount.hash);
  await assert.rejects(api.bankVerify(bank.id,{...verification,idempotencyKey:randomUUID()},{admin:reviewer}),code('REVISION_CONFLICT'));
  if((await db.payment.findUniqueOrThrow({where:{id:bank.paymentId}})).reconciliationRequired)await authorizeCurrent(db,maker,reviewer,o,bank.amount,replaced);
  approved=await api.bankVerify(bank.id,{...verification,revision:replaced.revision,accountHash:replaced.bankAccount.hash,idempotencyKey:randomUUID()},{admin:reviewer});
  if(options.reverse){await billing.settleRefund(bank.id,{status:'SUCCEEDED',providerRefundId:originalProviderId,paymentId:bank.paymentId,amount:bank.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:bank.paymentId}})).amount,succeededAt:new Date().toISOString(),nativeStatus:'SUCCESS',receiptDestination:'CUSTOMER',evidenceSource:'QUERY'});await assert.rejects(api.bankInstructions(bank.id,{admin:maker}),code('REFUND_BANK_STATE'));ctx.mock.timers.setTime(Date.now()+1000);approved=await db.refund.findUniqueOrThrow({where:{id:bank.id}});}
  const bankEvidence=await db.storedFile.create({data:{name:'合成真实银行出款回单.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:100,sha256:'7'.repeat(64),purpose:'refund-bank',adminId:maker.id}});
  const paymentInput={revision:approved.revision,accountHash:approved.bankAccount.hash,amount:bank.amount,paidAt:new Date().toISOString(),payerName:'上海宁达信息科技有限公司',payerAccount:'1234567890123456',payeeAccount:'6222021234567890999',reference:'SYN-BANK-'+bank.id,evidenceFileIds:[bankEvidence.id],idempotencyKey:randomUUID()};
  await assert.rejects(api.bankRecord(bank.id,{...paymentInput,amount:bank.amount+1},{admin:maker}),code('REFUND_BANK_AMOUNT_TIME'));
  let recorded:any=await api.bankRecord(bank.id,paymentInput,{admin:maker});assert.equal(recorded.status,options.reverse?'SUCCEEDED':'PROCESSING');if(!options.reverse)assert.equal(recorded.succeededAt,null);
  if(options.pendingRace){await billing.settleRefund(bank.id,{...originalEvent,status:'SUCCEEDED',nativeStatus:'SUCCESS',receiptDestination:'CUSTOMER',succeededAt:new Date().toISOString()});recorded=await db.refund.findUniqueOrThrow({where:{id:bank.id}});await assert.rejects(api.bankInstructions(bank.id,{admin:reviewer}),code('REFUND_BANK_STATE'));}
  const reviewInput={revision:recorded.revision,sourceHash:recorded.bankExecution.sourceHash,decision:'VERIFIED',reason:'核验银行真实出款与本人账户、金额时间一致',idempotencyKey:randomUUID()};
  if(!options.pendingRace)await assert.rejects(api.bankReview(bank.id,reviewInput,{admin:maker}),code('DUAL_APPROVAL'));
  const succeeded:any=await api.bankReview(bank.id,reviewInput,{admin:reviewer});assert.equal(succeeded.status,'SUCCEEDED');assert.equal(!!succeeded.providerRefundId,!!(options.reverse||options.pendingRace));assert.equal(hasRefundReceipt(succeeded),true);
  await api.bankReview(bank.id,reviewInput,{admin:reviewer});assert.ok((await refundObligationPerformance(db,await db.refundObligation.findUniqueOrThrow({where:{id:o.id}}))).completedAmount>=bank.amount);
  if(options.pendingRace){const current=await db.refund.findUniqueOrThrow({where:{id:bank.id}});assert.equal(current.method,'WECHAT_ORIGINAL');assert.equal((current.duplicateReceipt as any).verifiedExtraAmount,bank.amount);assert.equal((current.duplicateReceipt as any).bankVerification.sourceHash,current.bankExecution.sourceHash);}
  else if(options.reverse){const current=await db.refund.findUniqueOrThrow({where:{id:bank.id}});assert.equal(current.method,'WECHAT_ORIGINAL');assert.equal((current.duplicateReceipt as any).bank.source.authorizationTiming,'AFTER_INVALIDATION');}else if(!options.deferConflict)await bankTail(db,billing,bank,o,origin);
}
async function bankTail(db:any,billing:any,bank:any,o:any,origin:any){
  const deposits=await db.depositEntry.count({where:{refundId:bank.id}});
  await billing.settleRefund(bank.id,{status:'SUCCEEDED',providerRefundId:(origin.channelEvidence as any).providerRefundId,paymentId:bank.paymentId,amount:bank.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:bank.paymentId}})).amount,succeededAt:new Date().toISOString(),nativeStatus:'SUCCESS',receiptDestination:'CUSTOMER',evidenceSource:'QUERY'});
  const late=await db.refund.findUniqueOrThrow({where:{id:bank.id}});assert.equal(late.method,'MANUAL_BANK');assert.equal(late.providerRefundId,null);assert.equal((late.duplicateReceipt as any).unresolvedExtraAmount,bank.amount);assert.equal((await db.payment.findUniqueOrThrow({where:{id:bank.paymentId}})).reconciliationRequired,true);assert.equal(await db.depositEntry.count({where:{refundId:bank.id}}),deposits);

  const performance=await refundObligationPerformance(db,await db.refundObligation.findUniqueOrThrow({where:{id:o.id}}));assert.equal(performance.requiresRefundSourceReview,true);assert.equal(performance.status,'RECONCILIATION_REQUIRED');
  const conflict=await db.paymentReconciliation.findFirstOrThrow({where:{paymentId:bank.paymentId,resolution:'DUPLICATE_REFUND_CHANNEL_RECEIPT'}});if(db._task9bTransaction)await db.$executeRawUnsafe('SAVEPOINT immutable_conflict');await assert.rejects(db.paymentReconciliation.update({where:{id:conflict.id},data:{paymentSnapshot:{tampered:true}}}));if(db._task9bTransaction){await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT immutable_conflict');await db.$executeRawUnsafe('RELEASE SAVEPOINT immutable_conflict');}
}
async function authorizeCurrent(db:any,maker:any,reviewer:any,o:any,amount:number,refund?:any){
 const p=await db.payment.findUniqueOrThrow({where:{id:o.paymentId}}),service=new PaymentReconciliationService();
 const file=await db.storedFile.create({data:{name:'本次当前资金范围独立核验.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:'4'.repeat(64),purpose:'evidence',adminId:maker.id}});
 const input={revision:p.revision,idempotencyKey:randomUUID(),resolution:'REFUND_ONLY',obligationId:o.id,refundAmount:amount,...(refund?{refundId:refund.id,refundMethod:refund.method,accountHash:refund.bankAccount?.hash}:{}),note:'按当前真实来源与重复实汇逐笔确定本次无争议可退范围',evidenceFileIds:[file.id]};
 const submitted=await db.serial((tx:any)=>service.submit(tx,maker,p.id,input));
 await db.serial((tx:any)=>service.review(tx,reviewer,p.id,submitted.id,{revision:submitted.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'独立核对冻结资金及本次确定金额'}));return submitted;
}
async function authorizationContinuation(ctx:any,db:any,source:any){
 const maker=await db.adminUser.findUniqueOrThrow({where:{id:source.makerId}}),reviewer=await db.adminUser.findUniqueOrThrow({where:{id:source.reviewerId}}),o=await db.refundObligation.findUniqueOrThrow({where:{id:source.obligationId}});
 assert.equal(o.sourceHash,source.sourceHash);assert.equal(o.paymentId,source.paymentId);
 const gateway:any={refund:async(i:any)=>({status:'PROCESSING',nativeStatus:'PROCESSING',providerRefundId:'SYN-29-'+i.refundId,acceptedAt:new Date().toISOString(),evidenceSource:'REQUEST'}),queryRefund:async(id:string)=>{const r=await db.refund.findUniqueOrThrow({where:{id}}),p=await db.payment.findUniqueOrThrow({where:{id:r.paymentId}});return{status:'SUCCEEDED',nativeStatus:'SUCCESS',providerRefundId:'SYN-29-'+id,paymentId:r.paymentId,amount:r.amount,totalAmount:p.amount,succeededAt:new Date().toISOString(),receiptDestination:'CUSTOMER',evidenceSource:'QUERY'};}};
 const billing=new BillingService(db,gateway),api=new BillingController(db,billing,gateway),request=(amount:number)=>api.requestRefund({paymentId:o.paymentId,obligationId:o.id,amount,reason:'029当前资金精确核验',idempotencyKey:randomUUID()},{admin:maker});
 await assert.rejects(request(2000),code('PAYMENT_RECONCILIATION_REQUIRED'));
 const auth=await authorizeCurrent(db,maker,reviewer,o,2000),r=await request(2000);
 assert.equal((await db.paymentReconciliation.findUniqueOrThrow({where:{id:auth.id}})).usedRefundId,r.id);
 await assert.rejects(request(2000),code('PAYMENT_RECONCILIATION_REQUIRED'));
 async function constraint(work:()=>Promise<unknown>){await db.$executeRawUnsafe('SAVEPOINT auth_constraint');await assert.rejects(work);await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT auth_constraint');await db.$executeRawUnsafe('RELEASE SAVEPOINT auth_constraint');}
 await constraint(()=>db.paymentReconciliation.update({where:{id:auth.id},data:{usedRefundId:null}}));
 await constraint(()=>db.paymentReconciliation.update({where:{id:auth.id},data:{usedRefundId:source.refundId}}));
 await constraint(()=>db.refund.update({where:{id:source.refundId},data:{reconciliationId:auth.id}}));
 const accepted=await api.approve(r.id,{admin:reviewer});
 await billing.settleRefund(r.id,{status:'FAILED',nativeStatus:'CLOSED',providerRefundId:accepted.providerRefundId,paymentId:r.paymentId,amount:r.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:r.paymentId}})).amount,evidenceSource:'QUERY'});
 await bankExercise(ctx,db,api,billing,r,o,maker,reviewer,{deferConflict:true});
 assert.equal((await db.paymentReconciliation.findUniqueOrThrow({where:{id:auth.id}})).usedRefundId,r.id,'old authorization remains consumed after method/account reauthorization');
 const stale=await authorizeCurrent(db,maker,reviewer,o,2000);
 await bankTail(db,billing,r,o,await db.refund.findUniqueOrThrow({where:{id:r.id}}));
 await assert.rejects(request(2000),code('PAYMENT_RECONCILIATION_REQUIRED'));
 assert.equal((await db.paymentReconciliation.findUniqueOrThrow({where:{id:stale.id}})).usedRefundId,null);
 await assert.rejects(authorizeCurrent(db,maker,reviewer,o,4001),code('REFUND_AUTHORIZATION_CAPACITY'));
 const current=await authorizeCurrent(db,maker,reviewer,o,4000);assert.equal((current.paymentSnapshot as any).refundAuthorization.paymentAvailable,4000);assert.equal((current.paymentSnapshot as any).refundAuthorization.funds.filter((f:any)=>f.duplicate).length,1);
 const tail=await request(4000);await api.approve(tail.id,{admin:reviewer});await billing.syncRefund(tail.id);
 await assert.rejects(request(1),code('REFUND_OBLIGATION_LIMIT'));
 const p=await db.payment.findUniqueOrThrow({where:{id:o.paymentId}}),service=new PaymentReconciliationService();
 await assert.rejects(db.serial((tx:any)=>service.submit(tx,maker,p.id,{revision:p.revision,idempotencyKey:randomUUID(),resolution:'REFUNDED',note:'仍有重复实汇不得不实结清',evidenceFileIds:[source.evidenceFileId]})),code('REFUND_DUPLICATE_DISPOSITION_REQUIRED'));
 assert.equal(p.reconciliationRequired,true);assert.equal((await refundObligationPerformance(db,o)).completedAmount,8000);
}
async function pendingBankContinuation(ctx:any,db:any,source:any){
 const maker=await db.adminUser.findUniqueOrThrow({where:{id:source.makerId}}),reviewer=await db.adminUser.findUniqueOrThrow({where:{id:source.reviewerId}}),o=await db.refundObligation.findFirstOrThrow({where:{orderId:source.orderId,paymentId:{not:source.paymentId}}});
 const gateway:any={refund:async(i:any)=>({status:'PROCESSING',nativeStatus:'PROCESSING',providerRefundId:'SYN-RACE-'+i.refundId,acceptedAt:new Date().toISOString(),evidenceSource:'REQUEST'})},billing=new BillingService(db,gateway),api=new BillingController(db,billing,gateway);
 const r=await api.requestRefund({paymentId:o.paymentId,obligationId:o.id,amount:1000,reason:'银行记录原路到账竞争',idempotencyKey:randomUUID()},{admin:maker}),accepted=await api.approve(r.id,{admin:reviewer});
 await billing.settleRefund(r.id,{status:'FAILED',nativeStatus:'CLOSED',providerRefundId:accepted.providerRefundId,paymentId:r.paymentId,amount:r.amount,totalAmount:(await db.payment.findUniqueOrThrow({where:{id:r.paymentId}})).amount,evidenceSource:'QUERY'});
 await bankExercise(ctx,db,api,billing,r,o,maker,reviewer,{pendingRace:true});
}
async function reissueContinuation(ctx:any,db:any,source:any){
 // Only sources already executed by this task's exact request reason are eligible.
 const exact=process.env.TASK9B_REISSUE_SOURCE||process.env.TASK9B_REISSUE?source:null;
 const own=await db.refund.findMany({where:{reason:'原03精确应退',obligationId:{not:null}},orderBy:{createdAt:'asc'}});let o:any=exact?await db.refundObligation.findUniqueOrThrow({where:{id:exact.obligationId}}):null,maker:any=exact?await db.adminUser.findUniqueOrThrow({where:{id:exact.makerId}}):null,reviewer:any;
 for(const row of o?[]:own){const candidate=await db.refundObligation.findUniqueOrThrow({where:{id:row.obligationId}}),p=await db.payment.findUniqueOrThrow({where:{id:row.paymentId}}),funds=await refundFunding(db,p,candidate);if(!p.reconciliationRequired&&funds.obligationAvailable>=1000&&funds.paymentAvailable>=1000){o=candidate;maker=await db.adminUser.findUniqueOrThrow({where:{id:row.requestedBy}});break;}}
 assert.ok(o,'an actual task9b source with unchanged remaining cash is required');reviewer=await db.adminUser.findUniqueOrThrow({where:{id:source.reviewerId}});
 ctx.mock.timers.setTime(Math.max(Date.now(),new Date(o.triggerAt).getTime()+120000));console.log('REISSUE_SOURCE',JSON.stringify({obligationId:o.id,paymentId:o.paymentId,sourceHash:o.sourceHash,makerId:maker.id,reviewerId:reviewer.id,now:new Date().toISOString(),origin:'existing task9b 原03精确应退 real command source'}));
 const unknownIds=new Set<string>();let querySuccess=false,queries=0,dispatches=0;
 const total=(await db.payment.findUniqueOrThrow({where:{id:o.paymentId}})).amount;
 const event=(id:string,status:string)=>({status,nativeStatus:status==='FAILED'?'CLOSED':'SUCCESS',providerRefundId:'SYN-30-'+id,paymentId:o.paymentId,amount:1000,totalAmount:total,evidenceSource:'QUERY',receiptDestination:'CUSTOMER',...(status==='SUCCEEDED'?{succeededAt:new Date().toISOString()}:{})});
 const gateway:any={refund:async(i:any)=>{dispatches++;if(unknownIds.has(i.refundId))fail(503,'PAYMENT_NETWORK_ERROR');return{status:'PROCESSING',nativeStatus:'PROCESSING',providerRefundId:'SYN-30-'+i.refundId,acceptedAt:new Date().toISOString(),evidenceSource:'REQUEST'};},queryRefund:async(id:string)=>{queries++;if(!querySuccess)fail(404,'REFUND_NOT_FOUND');return event(id,'SUCCEEDED');}},billing=new BillingService(db,gateway),api=new BillingController(db,billing,gateway),effects:string[]=[],complete=billing.refundEffects.bind(billing);
 billing.refundEffects=async(tx:any,r:any)=>{effects.push(r.id);return complete(tx,r);};
 async function pair(){const first=await api.requestRefund({paymentId:o.paymentId,obligationId:o.id,amount:1000,reason:'030原路关闭后独立重发',idempotencyKey:randomUUID()},{admin:maker});await api.approve(first.id,{admin:reviewer});await billing.settleRefund(first.id,event(first.id,'FAILED') as any);const closed=await db.refund.findUniqueOrThrow({where:{id:first.id}});const body={revision:closed.revision,idempotencyKey:randomUUID(),reason:'补充余额后以新原路单号重发'},next=await (api as any).reissue(first.id,body,{admin:maker});assert.equal(next.replacesRefundId,first.id);assert.equal(next.approvedBy,null);assert.equal(next.reconciliationId,null);assert.equal((await (api as any).reissue(first.id,body,{admin:maker})).id,next.id);await assert.rejects(api.approve(next.id,{admin:maker}),code('DUAL_APPROVAL'));return{first,next};}
 async function constraint(work:()=>Promise<unknown>){await db.$executeRawUnsafe('SAVEPOINT reissue_constraint');await assert.rejects(work);await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT reissue_constraint');await db.$executeRawUnsafe('RELEASE SAVEPOINT reissue_constraint');}
 await db.$executeRawUnsafe('SAVEPOINT unsent_reissue');
 {const {first,next}=await pair();await constraint(()=>db.refund.update({where:{id:next.id},data:{replacesRefundId:null}}));await constraint(()=>db.refund.create({data:{paymentId:next.paymentId,customerId:next.customerId,obligationId:next.obligationId,amount:next.amount,requestedBy:maker.id,reason:'禁止并行替代分叉',replacesRefundId:first.id}}));await billing.settleRefund(first.id,event(first.id,'SUCCEEDED') as any);assert.equal((await db.refund.findUniqueOrThrow({where:{id:next.id}})).status,'REJECTED');await assert.rejects(api.approve(next.id,{admin:reviewer}),code('STATE_CONFLICT'));assert.deepEqual(effects,[first.id]);}
 await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT unsent_reissue');await db.$executeRawUnsafe('RELEASE SAVEPOINT unsent_reissue');effects.length=0;
 await db.$executeRawUnsafe('SAVEPOINT unknown_reissue');
 {const {first,next}=await pair();unknownIds.add(next.id);await assert.rejects(api.approve(next.id,{admin:reviewer}),code('PAYMENT_NETWORK_ERROR'));await billing.settleRefund(first.id,event(first.id,'SUCCEEDED') as any);assert.equal((await db.refund.findUniqueOrThrow({where:{id:next.id}})).status,'PROCESSING');ctx.mock.timers.setTime(Date.now()+60000);const beforeDispatch=dispatches;await assert.rejects(api.retryRefund(next.id,{admin:reviewer}),code('REFUND_REISSUE_ALREADY_PAID'));assert.equal(queries,1);assert.equal(dispatches,beforeDispatch);querySuccess=true;await billing.syncRefund(next.id);assert.deepEqual(effects,[first.id]);assert.equal((await db.refund.findUniqueOrThrow({where:{id:next.id}})).duplicateReceipt.normalRefundId,first.id);}
 await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT unknown_reissue');await db.$executeRawUnsafe('RELEASE SAVEPOINT unknown_reissue');effects.length=0;
 const before=await refundObligationPerformance(db,o),{first,next}=await pair();await api.approve(next.id,{admin:reviewer});await billing.settleRefund(next.id,event(next.id,'SUCCEEDED') as any);await billing.settleRefund(first.id,event(first.id,'SUCCEEDED') as any);
 const after=await refundObligationPerformance(db,o);assert.equal(after.completedAmount,before.completedAmount+1000);assert.equal(after.availablePaymentCapacity,before.availablePaymentCapacity-2000);assert.equal(after.duplicateReceipts.length,1);assert.deepEqual(effects,[next.id]);
 const old=await db.refund.findUniqueOrThrow({where:{id:first.id}});assert.equal(old.status,'SUCCEEDED');assert.equal(old.duplicateReceipt.normalRefundId,next.id);assert.equal(old.duplicateReceipt.verifiedExtraAmount,1000);
 await billing.settleRefund(first.id,event(first.id,'SUCCEEDED') as any);assert.equal((await refundObligationPerformance(db,o)).availablePaymentCapacity,after.availablePaymentCapacity);assert.deepEqual(effects,[next.id]);

}
async function securityContinuation(ctx:any,db:any,source:any){
 const maker=await db.adminUser.findUniqueOrThrow({where:{id:source.makerId}}),outsider=await db.adminUser.create({data:{username:'9b-ops-'+randomUUID(),name:'退款资料权限合成核验',passwordHash:'synthetic',role:'OPERATIONS',staffPersonId:randomUUID()}}),r=await db.refund.findUniqueOrThrow({where:{id:source.refundId}}),billing=new BillingService(db,{} as any),api=new BillingController(db,billing,{} as any);
 await assert.rejects(api.execution(r.id,{admin:outsider}),code('FORBIDDEN'));await assert.rejects(api.bankInstructions(r.id,{admin:outsider}),code('FORBIDDEN'));
 const file=await db.storedFile.findFirstOrThrow({where:{purpose:'refund-bank',adminId:maker.id}}),files=new FilesController(db);await assert.rejects(files.adminRead(file.id,{admin:outsider},{}),code('FORBIDDEN'));
 const dto=await api.execution(r.id,{admin:maker});assert.equal('bankAccountCiphertext' in dto,false);
 await assert.rejects(api.bindObligation(r.id,{obligationId:r.obligationId,revision:r.revision+1,idempotencyKey:randomUUID()},{admin:maker}),code('REVISION_CONFLICT'));
 const body={obligationId:r.obligationId,revision:r.revision,idempotencyKey:randomUUID()};const first=await api.bindObligation(r.id,body,{admin:maker});assert.equal((await api.bindObligation(r.id,body,{admin:maker})).id,first.id);
}
async function sqlSourceContinuation(db:any,source:any){
 // Constraint-only FAILED fixture on an actual source, all reverted. This is no cash/lifecycle success.
 await db.$executeRawUnsafe('SAVEPOINT sql_source_fixture');
 const o=await db.refundObligation.findUniqueOrThrow({where:{id:source.obligationId}});assert.equal(o.sourceHash,source.sourceHash);
 const providerRefundId='SYN-CONSTRAINT-31-'+randomUUID(),channel={nativeStatus:'CLOSED',evidenceSource:'QUERY',providerRefundId,paymentId:o.paymentId,amount:1000};
 const previous=await db.refund.create({data:{paymentId:o.paymentId,customerId:o.customerId,obligationId:o.id,amount:1000,status:'FAILED',method:'WECHAT_ORIGINAL',reason:'031仅约束前置行无资金效果',requestedBy:source.makerId,providerRefundId,channelEvidence:channel}});
 for(const evidenceSource of [undefined,null,'UNVERIFIED','QUERY','CALLBACK']){
  await db.$executeRawUnsafe('SAVEPOINT sql_source_variant');const evidence={...channel,evidenceSource};if(evidenceSource===undefined)delete evidence.evidenceSource;
  await db.refund.update({where:{id:previous.id},data:{channelEvidence:evidence}});
  const insert=()=>db.refund.create({data:{paymentId:o.paymentId,customerId:o.customerId,obligationId:o.id,amount:1000,replacesRefundId:previous.id,reason:'031仅验证来源约束无出款',requestedBy:source.makerId}});
  if(evidenceSource==='QUERY'||evidenceSource==='CALLBACK')await insert();else await assert.rejects(insert,'missing/NULL/unverified provider evidence must be rejected by SQL');
  await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sql_source_variant');await db.$executeRawUnsafe('RELEASE SAVEPOINT sql_source_variant');
 }
 await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sql_source_fixture');await db.$executeRawUnsafe('RELEASE SAVEPOINT sql_source_fixture');
}
test('9b exact03 obligation dispatch, actual-person review, acceptance, UNKNOWN recovery and immutable clock',async ctx=>{
 if(process.env.TASK9B_AUTHORIZATION_RESUME){
  const source=JSON.parse(readFileSync(resolve(process.env.TASK9B_REISSUE?'../../.runtime/task9b-reissue-source.json':'../../.runtime/task9b-authorization-source.json'),'utf8')),saved=process.env.ESIGN_IDENTITY_ENCRYPTION_KEY;process.env.ESIGN_IDENTITY_ENCRYPTION_KEY ||= Buffer.alloc(32,37).toString('base64');
  ctx.mock.timers.enable({apis:['Date'],now:new Date(source.now).getTime()+1000});const db=new Db();try{await db.$transaction(async(tx:any)=>{const real=Object.assign(Object.create(tx),{_task9bTransaction:true,serial:(fn:any)=>fn(tx)});if(process.env.TASK9B_ACCEPTANCE){const o=await real.refundObligation.findUniqueOrThrow({where:{id:source.obligationId}}),v=await refundObligationPerformance(real,o);assert.equal(v.acceptedAmount,v.completedAmount,'replacement attempts must not count twice toward acceptance of different principal');}else if(process.env.TASK9B_SQL_SOURCE)await sqlSourceContinuation(real,source);else if(process.env.TASK9B_READ_SECURITY)await securityContinuation(ctx,real,source);else if(process.env.TASK9B_REISSUE)await reissueContinuation(ctx,real,source);else if(process.env.TASK9B_PENDING_RACE)await pendingBankContinuation(ctx,real,source);else await authorizationContinuation(ctx,real,source);},{timeout:60000,isolationLevel:'Serializable'});}finally{await db.$disconnect();ctx.mock.timers.reset();if(saved===undefined)delete process.env.ESIGN_IDENTITY_ENCRYPTION_KEY;else process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=saved;}
 }else if(process.env.TASK9B_REUSE_BANK_TAIL){const db=new Db();try{const bank=await db.refund.findFirstOrThrow({where:{method:'MANUAL_BANK',status:'SUCCEEDED',reason:'原03精确应退'},orderBy:{createdAt:'desc'}}),o=await db.refundObligation.findUniqueOrThrow({where:{id:bank.obligationId!}});ctx.mock.timers.enable({apis:['Date'],now:new Date(bank.succeededAt!).getTime()+1000});await bankTail(db,new BillingService(db,{} as any),bank,o,bank);}finally{await db.$disconnect();ctx.mock.timers.reset();}}
 else if(process.env.TASK9B_REUSE_BANK){
  const saved={...process.env};process.env.ESIGN_IDENTITY_ENCRYPTION_KEY ||= Buffer.alloc(32,37).toString('base64');const db=new Db();try{
   const bank=await db.refund.findFirstOrThrow({where:{status:'FAILED',reason:'原03精确应退',obligationId:{not:null},channelState:'CLOSED'},orderBy:{createdAt:'desc'}}),o=await db.refundObligation.findUniqueOrThrow({where:{id:bank.obligationId!}}),maker=await db.adminUser.findUniqueOrThrow({where:{id:bank.requestedBy}}),reviewer=await db.adminUser.findUniqueOrThrow({where:{id:bank.approvedBy!}});
   ctx.mock.timers.enable({apis:['Date'],now:new Date(o.triggerAt).getTime()+120000});const billing=new BillingService(db,{} as any),api=new BillingController(db,billing,{} as any);await bankExercise(ctx,db,api,billing,bank,o,maker,reviewer);
  }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
 }else if(process.env.TASK9B_REUSE_MAKER){
  ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-12T02:00:00Z')});const db=new Db();try{
   const maker=await db.adminUser.findUniqueOrThrow({where:{id:process.env.TASK9B_REUSE_MAKER}}),change=await db.orderChange.findFirstOrThrow({where:{createdBy:maker.id},orderBy:{createdAt:'desc'}}),order=await db.order.findUniqueOrThrow({where:{id:change.orderId}});
   const reviewer=await db.adminUser.create({data:{username:randomUUID(),name:'合成独立9b财务',passwordHash:'synthetic',role:'FINANCE',staffPersonId:randomUUID()}});
   assert.ok(await db.refundObligation.count({where:{orderId:order.id}}),'reused fixture must be an actual previously materialized source');
   const existingObligation=await db.refundObligation.findFirstOrThrow({where:{orderId:order.id}});ctx.mock.timers.setTime(new Date(existingObligation.triggerAt).getTime()+60000);await exercise(ctx,db,{f:{actor:maker},reviewer,sub:{order},existingObligation});
  }finally{await db.$disconnect();ctx.mock.timers.reset();}
 }else await runSwapCommandJourney(ctx,'gap',{preserveFailedOriginalRequest:true,configureDb:db=>{const original=db.$transaction.bind(db);db.$transaction=((...args:any[])=>original(args[0],{...args[1],timeout:60000})) as any;},configureSources:async()=>{},stopAfterBeforeFinance:true,run:async()=>{},beforeFinance:exercise});
});
