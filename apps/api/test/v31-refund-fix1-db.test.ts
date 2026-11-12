import {runSwapCommandJourney} from './v31-swap-command-journey';
import {RefundObligationsService} from '../src/billing/refund-obligations';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../src/common/db';
import {BillingController,BillingService} from '../src/billing/billing';
import {PaymentReconciliationService} from '../src/billing/reconciliation';
import {canonicalHash} from '../src/customers/types';
const code=(c:string)=>(e:any)=>e.getResponse?.().error?.code===c;
let memorySources:Record<string,any>|undefined,fixtureEncryptionKey:string|undefined;
const cases:Array<{name:string;run:(ctx:any)=>Promise<void>}>=[];
const regression=(name:string,run:(ctx:any)=>Promise<void>)=>cases.push({name,run});
function source(kind='reissue'){
 if(memorySources)return memorySources[kind];
 assert.equal(process.env.TASK9B_FIX1_REUSE_SOURCE,'1','local source reuse requires explicit iteration mode');
 return JSON.parse(readFileSync(resolve(`../../.runtime/task9b-${kind==='bank'?'authorization':'reissue'}-source.json`),'utf8'));
}
const rollback=new Error('FIX1_TEST_TRANSACTION_ROLLBACK');
async function fixture(ctx:any,kind:string,run:(db:any,f:any)=>Promise<void>){
 const saved=process.env.ESIGN_IDENTITY_ENCRYPTION_KEY;process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=fixtureEncryptionKey??saved??Buffer.alloc(32,37).toString('base64');const db=new Db(),s=source(kind);
 try{const rows=await db.refund.findMany({where:{paymentId:s.paymentId}});ctx.mock.timers.enable({apis:['Date'],now:Math.max(Date.parse(s.now),...rows.map((r:any)=>new Date(r.succeededAt??s.now).getTime()))+60000});
  await db.$transaction(async(tx:any)=>{const scoped=Object.assign(Object.create(tx),{serial:(fn:any)=>fn(tx)}),maker=await tx.adminUser.findUniqueOrThrow({where:{id:s.makerId}}),reviewer=await tx.adminUser.findUniqueOrThrow({where:{id:s.reviewerId}}),o=await tx.refundObligation.findUniqueOrThrow({where:{id:s.obligationId}});assert.equal(o.sourceHash,s.sourceHash);await run(scoped,{s,maker,reviewer,o});throw rollback;},{timeout:60000,isolationLevel:'Serializable'});
 }catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();ctx.mock.timers.reset();if(saved===undefined)delete process.env.ESIGN_IDENTITY_ENCRYPTION_KEY;else process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=saved;}
}
async function file(db:any,actorId:string,purpose='refund-bank'){return db.storedFile.create({data:{name:'fix1 synthetic evidence.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:'c'.repeat(64),purpose,adminId:actorId}});}
async function authorize(db:any,f:any,refund?:any){
 const p=await db.payment.findUniqueOrThrow({where:{id:f.o.paymentId}});if(!p.reconciliationRequired)return;const proof=await file(db,f.maker.id,'evidence'),service=new PaymentReconciliationService();
 const submitted=await service.submit(db,f.maker,p.id,{revision:p.revision,idempotencyKey:randomUUID(),resolution:'REFUND_ONLY',obligationId:f.o.id,refundAmount:1000,...(refund?{refundId:refund.id,refundMethod:'MANUAL_BANK',accountHash:refund.bankAccount.hash}:{}),note:'fix1 exact uncontested amount only',evidenceFileIds:[proof.id]});
 await service.review(db,f.reviewer,p.id,submitted.id,{revision:submitted.paymentRevision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'independent current-funds review'});
}
async function bankAccount(db:any,f:any){
 await authorize(db,f);const gateway:any={refund:async(i:any)=>({status:'FAILED',nativeStatus:'CLOSED',providerRefundId:'SYN-FIX1-'+i.refundId,evidenceSource:'REQUEST'}),queryRefund:async(id:string)=>{const r=await db.refund.findUniqueOrThrow({where:{id}}),p=await db.payment.findUniqueOrThrow({where:{id:r.paymentId}});return{status:'FAILED',nativeStatus:'CLOSED',providerRefundId:'SYN-FIX1-'+id,evidenceSource:'QUERY',paymentId:p.id,amount:r.amount,totalAmount:p.amount};}},billing=new BillingService(db,gateway),api=new BillingController(db,billing,gateway),effects:string[]=[],real=billing.refundEffects.bind(billing);
 billing.refundEffects=async(tx:any,r:any)=>{effects.push(r.id);return real(tx,r);};
 const body={paymentId:f.o.paymentId,obligationId:f.o.id,amount:1000,reason:'fix1 bounded own-account receipt evidence',idempotencyKey:randomUUID()},r=await api.requestRefund(body,{admin:f.maker});await api.approve(r.id,{admin:f.reviewer});await billing.syncRefund(r.id);
 const customer=await db.customer.findUniqueOrThrow({where:{id:f.o.customerId}}),evidence=await db.storedFile.create({data:{name:'fix1 synthetic own account.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:10,sha256:'d'.repeat(64),purpose:'refund-bank',customerId:customer.id}}),current=await db.refund.findUniqueOrThrow({where:{id:r.id}}),account=await api.bankSubmit(r.id,{revision:current.revision,idempotencyKey:randomUUID(),accountNumber:'6222021234567890666',accountName:customer.name,bankName:'合成测试银行',evidenceFileIds:[evidence.id],accepted:true},{customer});
 return{api,billing,body,r,account,customer,effects};
}
regression('I3 request replay and rejection keep stored bank ciphertext and raw accounts out of DTOs',async ctx=>fixture(ctx,'reissue',async(db,f)=>{
 const b=await bankAccount(db,f);assert.ok((await db.refund.findUniqueOrThrow({where:{id:b.r.id}})).bankAccountCiphertext);
 const replay=await b.api.requestRefund(b.body,{admin:f.maker}),rejected=await b.api.reject(b.r.id,{reason:'fixture rejects unexecuted request'},{admin:f.reviewer});
 const leaks=[['replay',replay],['reject',rejected]].filter(([,v])=>'bankAccountCiphertext'in v||JSON.stringify(v).includes('6222021234567890666')).map(([name])=>name);assert.deepEqual(leaks,[]);
}));
regression('I2 rejected transfer evidence never reopens instructions; same factual claim has evidence-only correction',async ctx=>fixture(ctx,'reissue',async(db,f)=>{
 const b=await bankAccount(db,f);await authorize(db,f,b.account);const proof=await file(db,f.maker.id),approved=await b.api.bankVerify(b.r.id,{revision:b.account.revision,accountHash:b.account.bankAccount.hash,unavailabilityKind:'CUSTOMER_ACCOUNT_CLOSED',unavailabilityReason:'synthetic original-account closure evidence',evidenceFileIds:[proof.id],idempotencyKey:randomUUID()},{admin:f.reviewer});
 const receipt=await file(db,f.maker.id),input={revision:approved.revision,accountHash:approved.bankAccount.hash,amount:1000,paidAt:new Date().toISOString(),payerName:'宁达合成测试主体',payerAccount:'1234567890123456',payeeAccount:'6222021234567890666',reference:'SYN-FIX1-BANK-'+b.r.id,evidenceFileIds:[receipt.id],idempotencyKey:randomUUID()},recorded=await b.api.bankRecord(b.r.id,input,{admin:f.maker});
 const rejected=await b.api.bankReview(b.r.id,{revision:recorded.revision,sourceHash:recorded.bankExecution.sourceHash,decision:'REJECTED',reason:'receipt needs original bank verification',idempotencyKey:randomUUID()},{admin:f.reviewer});
 await assert.rejects(b.api.bankInstructions(b.r.id,{admin:f.maker}),code('REFUND_BANK_STATE'));assert.deepEqual(b.effects,[]);
 await assert.rejects(b.api.bankRecord(b.r.id,{...input,revision:rejected.revision,idempotencyKey:randomUUID()},{admin:f.maker}),code('REFUND_BANK_STATE'));
 const correctedFile=await file(db,f.maker.id),correction={revision:rejected.revision,sourceHash:rejected.bankExecution.sourceHash,evidenceFileIds:[correctedFile.id],reason:'same transfer, corrected bank evidence only',idempotencyKey:randomUUID()};
 const corrected=await (b.api as any).bankEvidence(b.r.id,correction,{admin:f.maker});assert.equal(corrected.bankExecution.status,'RECORDED');assert.equal(corrected.bankExecution.source.reference,recorded.bankExecution.source.reference);assert.equal(corrected.bankExecution.source.paidAt,recorded.bankExecution.source.paidAt);assert.equal(corrected.bankExecution.source.accountHash,recorded.bankExecution.source.accountHash);assert.deepEqual(b.effects,[]);assert.equal(corrected.succeededAt,null);
 await assert.rejects(b.api.bankInstructions(b.r.id,{admin:f.maker}),code('REFUND_BANK_STATE'));assert.equal((await(b.api as any).bankEvidence(b.r.id,correction,{admin:f.maker})).bankExecution.sourceHash,corrected.bankExecution.sourceHash);
 assert.equal(await db.depositEntry.count({where:{refundId:b.r.id}}),0);
 const verification={revision:corrected.revision,sourceHash:corrected.bankExecution.sourceHash,decision:'VERIFIED',reason:'independently verified corrected evidence for the original transfer',idempotencyKey:randomUUID()},succeeded=await b.api.bankReview(b.r.id,verification,{admin:f.reviewer});
 assert.deepEqual(b.effects,[b.r.id]);assert.equal(succeeded.status,'SUCCEEDED');assert.equal(succeeded.failureCode,null);assert.equal(succeeded.bankExecution.supplementalEvidence.length,1);assert.equal(new Date(succeeded.succeededAt).getTime(),Date.parse(recorded.bankExecution.source.paidAt));
 await b.api.bankReview(b.r.id,verification,{admin:f.reviewer});assert.deepEqual(b.effects,[b.r.id]);
}));
for(const kind of ['bank','reissue'])regression(`I1 ${kind} actual duplicate has append-only responsible investigation and independent unresolved review`,async ctx=>fixture(ctx,kind,async(db,f)=>{
 const service:any=new PaymentReconciliationService(),listed=await service.list(db,f.maker,f.o.paymentId),conflict=listed.items.find((r:any)=>r.resolution==='DUPLICATE_REFUND_CHANNEL_RECEIPT'&&(kind==='reissue'?r.paymentSnapshot.conflict.kind==='ORIGINAL_REISSUE':r.paymentSnapshot.conflict.kind!=='ORIGINAL_REISSUE'));assert.ok(conflict);assert.ok(conflict.investigation?.actions?.append,'actual duplicate list must expose its usable investigation action');
 const before=canonicalHash({p:await db.payment.findUniqueOrThrow({where:{id:f.o.paymentId}}),refunds:await db.refund.findMany({where:{paymentId:f.o.paymentId},orderBy:{id:'asc'}}),conflict:await db.paymentReconciliation.findUniqueOrThrow({where:{id:conflict.id}})}),view=await service.investigation(db,f.maker,f.o.paymentId,conflict.id),proof=await file(db,f.maker.id);
 const input={revision:view.revision,headHash:view.headHash,sourceHash:view.sourceHash,responsibleStaffId:f.maker.id,findings:'核对两笔真实渠道凭据，资金仍未决',nextAction:'VERIFY_BANK',nextActionNote:'责任财务向银行核对实汇，等待回函后继续补证',evidenceFileIds:[proof.id],idempotencyKey:randomUUID()};
 await assert.rejects(service.appendInvestigation(db,f.maker,f.o.paymentId,conflict.id,{...input,sourceHash:'0'.repeat(64)}),code('REFUND_CONFLICT_SOURCE_CHANGED'));
 const submitted=await service.appendInvestigation(db,f.maker,f.o.paymentId,conflict.id,input);assert.equal((await service.appendInvestigation(db,f.maker,f.o.paymentId,conflict.id,input)).headHash,submitted.headHash);
 const alias=await db.adminUser.create({data:{username:'fix1-alias-'+randomUUID(),name:'same person alias',passwordHash:'synthetic',role:'ADMIN',staffPersonId:f.maker.staffPersonId}}),review={revision:submitted.revision,headHash:submitted.headHash,sourceHash:submitted.sourceHash,reportId:submitted.events.at(-1).id,decision:'REVIEWED_UNRESOLVED',findings:'独立核查调查资料，尚无可验证资金归还',nextAction:'VERIFY_ORIGINAL_CHANNEL',nextActionNote:'继续向原渠道核对，不解除资金门禁',idempotencyKey:randomUUID()};
 await assert.rejects(service.reviewInvestigation(db,alias,f.o.paymentId,conflict.id,review),code('DUAL_APPROVAL'));
 const reviewed=await service.reviewInvestigation(db,f.reviewer,f.o.paymentId,conflict.id,review);assert.equal(reviewed.investigationStatus,'REVIEWED_UNRESOLVED');assert.equal(reviewed.cashStatus,'UNRESOLVED');
 await assert.rejects(service.appendInvestigation(db,f.maker,f.o.paymentId,conflict.id,{...input,idempotencyKey:randomUUID()}),code('REVISION_CONFLICT'));
 const added=await service.appendInvestigation(db,f.maker,f.o.paymentId,conflict.id,{...input,revision:reviewed.revision,headHash:reviewed.headHash,sourceHash:reviewed.sourceHash,findings:'补充原渠道核查函，仍等待银行结果',idempotencyKey:randomUUID()});assert.equal(added.events.length,view.events.length+3);assert.equal(added.investigationStatus,'AWAITING_REVIEW');
 const needsMore=await service.reviewInvestigation(db,f.reviewer,f.o.paymentId,conflict.id,{...review,revision:added.revision,headHash:added.headHash,sourceHash:added.sourceHash,reportId:added.events.at(-1).id,decision:'MORE_EVIDENCE_REQUIRED',idempotencyKey:randomUUID()});assert.equal(needsMore.investigationStatus,'MORE_EVIDENCE_REQUIRED');assert.equal(needsMore.cashStatus,'UNRESOLVED');
 const payment=await db.payment.findUniqueOrThrow({where:{id:f.o.paymentId}});await assert.rejects(service.review(db,f.reviewer,f.o.paymentId,conflict.id,{revision:payment.revision,idempotencyKey:randomUUID(),decision:'APPROVED',note:'investigation cannot release money'}),code('REFUND_DUPLICATE_DISPOSITION_REQUIRED'));
 assert.equal(canonicalHash({p:await db.payment.findUniqueOrThrow({where:{id:f.o.paymentId}}),refunds:await db.refund.findMany({where:{paymentId:f.o.paymentId},orderBy:{id:'asc'}}),conflict:await db.paymentReconciliation.findUniqueOrThrow({where:{id:conflict.id}})}),before,'investigation cannot rewrite unresolved cash/source');
 await db.$executeRawUnsafe('SAVEPOINT audit_immutable');await assert.rejects(db.auditLog.update({where:{id:added.events[0].id},data:{data:{tampered:true}}}));await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT audit_immutable');await db.$executeRawUnsafe('RELEASE SAVEPOINT audit_immutable');
 await db.$executeRawUnsafe('SAVEPOINT audit_delete');await assert.rejects(db.auditLog.delete({where:{id:added.events.at(-1).id}}));await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT audit_delete');await db.$executeRawUnsafe('RELEASE SAVEPOINT audit_delete');
}));

regression('I1 concurrent investigation append uses separate real transactions without a revision fork',async ctx=>{
 const s=source('reissue'),db=new Db();try{
  const rows=await db.refund.findMany({where:{paymentId:s.paymentId}});ctx.mock.timers.enable({apis:['Date'],now:Math.max(Date.parse(s.now),...rows.map((r:any)=>new Date(r.succeededAt??s.now).getTime()))+60000});
  const maker=await db.adminUser.findUniqueOrThrow({where:{id:s.makerId}}),reviewer=await db.adminUser.findUniqueOrThrow({where:{id:s.reviewerId}}),service:any=new PaymentReconciliationService(),listed=await db.serial(tx=>service.list(tx,maker,s.paymentId)),conflict=listed.items.find((r:any)=>r.resolution==='DUPLICATE_REFUND_CHANNEL_RECEIPT'&&r.paymentSnapshot.conflict.kind==='ORIGINAL_REISSUE'),initial=await db.serial(tx=>service.investigation(tx,maker,s.paymentId,conflict.id)),proof=await file(db,maker.id);
  const input={revision:initial.revision,headHash:initial.headHash,sourceHash:initial.sourceHash,responsibleStaffId:maker.id,findings:'synthetic simultaneous investigation, no cash effect',nextAction:'VERIFY_BANK',nextActionNote:'await independent bank evidence',evidenceFileIds:[proof.id]};
  const attempts=await Promise.allSettled([1,2].map(()=>db.serial(tx=>service.appendInvestigation(tx,maker,s.paymentId,conflict.id,{...input,idempotencyKey:randomUUID()}))));assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected'&&code('REVISION_CONFLICT')(r.reason)).length,1);
  const current=await db.serial(tx=>service.investigation(tx,maker,s.paymentId,conflict.id));assert.equal(current.revision,initial.revision+1);
  const reviewed=await db.serial(tx=>service.reviewInvestigation(tx,reviewer,s.paymentId,conflict.id,{revision:current.revision,headHash:current.headHash,sourceHash:current.sourceHash,reportId:current.events.at(-1).id,decision:'MORE_EVIDENCE_REQUIRED',findings:'independent review of synthetic concurrency fixture',nextAction:'VERIFY_BANK',nextActionNote:'retain unresolved cash until supported disposition',idempotencyKey:randomUUID()}));assert.equal(reviewed.cashStatus,'UNRESOLVED');
 }finally{await db.$disconnect();ctx.mock.timers.reset();}
});
async function bootstrap(ctx:any){
 await runSwapCommandJourney(ctx,'gap',{configureDb:db=>{const real=db.$transaction.bind(db);db.$transaction=((...args:any[])=>real(args[0],{...args[1],timeout:60000})) as any;},configureSources:async()=>{},run:async()=>{},stopAfterBeforeFinance:true,beforeFinance:async(_ctx,db,j)=>{
  const maker=await db.adminUser.update({where:{id:j.f.actor.id},data:{role:'ADMIN'}}),reviewer=j.reviewer,obligations=new RefundObligationsService(db),view=await obligations.read(j.sub.order.id,maker),created=await obligations.materialize(j.sub.order.id,{sourceHash:view.sourceHash,idempotencyKey:randomUUID()},reviewer),o=created.items[0],f={maker,reviewer,o};
  assert.ok(o.amount>=6000,'self-contained source must retain room for bounded correction tests');fixtureEncryptionKey=process.env.ESIGN_IDENTITY_ENCRYPTION_KEY;
  const b=await bankAccount(db,f);await authorize(db,f,b.account);const reason=await file(db,maker.id),approved=await b.api.bankVerify(b.r.id,{revision:b.account.revision,accountHash:b.account.bankAccount.hash,unavailabilityKind:'CUSTOMER_ACCOUNT_CLOSED',unavailabilityReason:'synthetic original-account closure evidence',evidenceFileIds:[reason.id],idempotencyKey:randomUUID()},{admin:reviewer}),receipt=await file(db,maker.id),recorded=await b.api.bankRecord(b.r.id,{revision:approved.revision,accountHash:approved.bankAccount.hash,amount:1000,paidAt:new Date().toISOString(),payerName:'宁达合成测试主体',payerAccount:'1234567890123456',payeeAccount:'6222021234567890666',reference:'SYN-FIX1-BOOT-'+b.r.id,evidenceFileIds:[receipt.id],idempotencyKey:randomUUID()},{admin:maker});
  await b.api.bankReview(b.r.id,{revision:recorded.revision,sourceHash:recorded.bankExecution.sourceHash,decision:'VERIFIED',reason:'synthetic boundary, actual independent bank verification command',idempotencyKey:randomUUID()},{admin:reviewer});
  const total=(await db.payment.findUniqueOrThrow({where:{id:o.paymentId}})).amount;
  await b.billing.settleRefund(b.r.id,{status:'SUCCEEDED',nativeStatus:'SUCCESS',providerRefundId:'SYN-FIX1-'+b.r.id,paymentId:o.paymentId,amount:1000,totalAmount:total,succeededAt:new Date().toISOString(),receiptDestination:'CUSTOMER',evidenceSource:'QUERY'});
  const gateway:any={refund:async(i:any)=>({status:'PROCESSING',nativeStatus:'PROCESSING',providerRefundId:'SYN-FIX1-PAIR-'+i.refundId,evidenceSource:'REQUEST',acceptedAt:new Date().toISOString()})},billing=new BillingService(db,gateway),api=new BillingController(db,billing,gateway);
  await authorize(db,f);const first=await api.requestRefund({paymentId:o.paymentId,obligationId:o.id,amount:1000,reason:'fix1 self-contained original replacement pair',idempotencyKey:randomUUID()},{admin:maker});await api.approve(first.id,{admin:reviewer});
  const channel=(id:string,status:'FAILED'|'SUCCEEDED')=>({status,nativeStatus:status==='FAILED'?'CLOSED' as const:'SUCCESS' as const,providerRefundId:'SYN-FIX1-PAIR-'+id,paymentId:o.paymentId,amount:1000,totalAmount:total,evidenceSource:'QUERY' as const,receiptDestination:'CUSTOMER' as const,...(status==='SUCCEEDED'?{succeededAt:new Date().toISOString()}:{})});
  await billing.settleRefund(first.id,channel(first.id,'FAILED'));await authorize(db,f);const closed=await db.refund.findUniqueOrThrow({where:{id:first.id}}),next=await api.reissue(first.id,{revision:closed.revision,reason:'new original identity with independent approval',idempotencyKey:randomUUID()},{admin:maker});await api.approve(next.id,{admin:reviewer});await billing.settleRefund(next.id,channel(next.id,'SUCCEEDED'));await billing.settleRefund(first.id,channel(first.id,'SUCCEEDED'));
  const data={paymentId:o.paymentId,obligationId:o.id,sourceHash:o.sourceHash,makerId:maker.id,reviewerId:reviewer.id,now:new Date().toISOString(),origin:'fix1 default self-contained real03 journey + actual commands; synthetic external channels'};memorySources={bank:data,reissue:data};
 }});
}
if(process.env.TASK9B_FIX1_REUSE_SOURCE==='1'){
 for(const item of cases)if(!process.env.TASK9B_FIX1_CASE||item.name.startsWith(process.env.TASK9B_FIX1_CASE))test(item.name,item.run);
}else test('fix1 self-contained real03 source and bounded review regressions',async ctx=>{
 await bootstrap(ctx);for(const item of cases)await ctx.test(item.name,item.run);
});
