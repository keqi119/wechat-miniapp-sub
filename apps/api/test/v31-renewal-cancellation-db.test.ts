import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {activeSwapFixture} from './v31-swap-fixture';
import {runRenewalJourney,seedRenewalProduct} from './v31-renewal-journey';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {publishBillAutomatically} from '../src/billing/auto-publication';
import {UsageService} from '../src/usage/usage.service';
import {guardRenewalCancellationRefund} from '../src/billing/renewal-cancellation-refunds';
import {activateElectronicRenewal} from '../src/order-renewals/electronic-archive';
import {BillingController} from '../src/billing/billing';
import {reserveCredit,creditView} from '../src/vehicle-changes/credits';
import {hash} from '../src/common/data';
import {filePrivacyBoundary} from '../src/files/files';
import {PaymentReconciliationService} from '../src/billing/reconciliation';
import {CustomerController} from '../src/orders/customer';

async function bilateral(db:any,fixture:any,at='2027-04-28T03:00:00Z'){
 const actor=fixture.f.actor,files=await Promise.all(['customer','lessor','authority'].map(label=>db.storedFile.create({data:{id:randomUUID(),adminId:actor.id,purpose:'evidence',mimeType:'application/pdf',size:100,sha256:label.padEnd(64,'a').slice(0,64).replace(/[^a-f0-9]/g,'a'),storagePath:'synthetic/'+randomUUID(),name:label+'.pdf'}})));
 return{files,claim:{customer:{subjectId:fixture.sub.customer.id,intention:'取消本次新增阶段',occurredAt:at,fileIds:[files[0].id]},lessor:{ownerId:fixture.f.owner.id,personName:'出租方法定代表人',personReference:'synthetic-authorized-person',authorityScope:'取消本订单本次05新增阶段',authorityFrom:'2027-01-01T00:00:00Z',authorityUntil:'2027-12-31T00:00:00Z',intention:'同意取消本次新增阶段',occurredAt:at,fileIds:[files[1].id],authorityFileIds:[files[2].id]},note:'核对双方原始消息与有权人员授权'}};
}

test('05 verified pre-start cancellation corrects activation and holds unresolved refunds for independent review',{skip:process.env.NODE_ENV!=='test'},async ctx=>{
 assert.equal(typeof (OrderRenewalsService.prototype as any).cancellationV31,'function','actual scoped05 cancellation command is required');
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2027-01-31T02:00:00Z')});const db=new Db(),saved={...process.env};
 try{
  let selected:any;const fixture=await activeSwapFixture(db,{initialMonths:3,actualDeliveryAt:'2027-01-31T01:00:00Z',configureSources:async(db,f)=>{selected=await seedRenewalProduct(db,f);}});
  const j=await runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-04-30',end:'2027-07-31',firstEnd:'2027-05-31',secondEnd:'2027-06-30',expiresAt:'2027-02-10T00:00:00Z',startAt:'2027-04-29T16:00:00Z'}),svc:any=j.service,actor=fixture.f.actor;
  const person='synthetic-ops-'+randomUUID();await db.adminUser.update({where:{id:actor.id},data:{staffPersonId:person}});
  const samePerson=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'同人运营账号',role:'OPERATIONS',staffPersonId:person}}),independent=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'独立事实复核',role:'OPERATIONS',staffPersonId:'synthetic-independent-'+randomUUID()}}),admin=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'管理员普通资料自审',role:'ADMIN'}});
  const factReviewer={id:independent.id,role:independent.role,authVersion:independent.authVersion},factAdmin={id:admin.id,role:admin.role,authVersion:admin.authVersion};
  const lateBill=await db.bill.findFirstOrThrow({where:{serviceStageId:j.stageId,sequence:6}}),lateRequest=await fixture.billing.pay(fixture.payingCustomer,lateBill.id,randomUUID());
  const currentOrder=await db.order.findUniqueOrThrow({where:{id:fixture.sub.order.id}}),terms=await db.orderTermsVersion.findUniqueOrThrow({where:{id:currentOrder.effectiveTermsVersionId!}});
  const draft=await db.orderChange.create({data:{orderId:fixture.sub.order.id,customerId:fixture.sub.customer.id,kind:'VEHICLE_CHANGE',originalArchiveVersionId:(await db.orderChange.findUniqueOrThrow({where:{id:j.changeId}})).originalArchiveVersionId,originalContractId:(await db.orderChange.findUniqueOrThrow({where:{id:j.changeId}})).originalContractId,priorTerms:terms.snapshot,priorTermsHash:hash(terms.snapshot),priorTermsVersionId:terms.id,reason:'未履行的预占',createdBy:actor.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
  const reservation=await db.serial(async tx=>reserveCredit(tx,await tx.order.findUniqueOrThrow({where:{id:fixture.sub.order.id}}),await tx.usageAccount.findUniqueOrThrow({where:{orderId:fixture.sub.order.id}}),draft.id,new Date()));
  const {files,claim}=await bilateral(db,fixture);
  const read=()=>svc.cancellationV31(j.changeId,'read',{},actor);
  const command=async(action:string,extra:any={},acting=actor)=>{const p=await read();return svc.cancellationV31(j.changeId,action,{revision:p.revision,headId:p.headId,headHash:p.headHash,businessSourceHash:p.businessSourceHash,idempotencyKey:randomUUID(),...extra},acting);};
  await assert.rejects(svc.cancellationV31(j.changeId,'read',{}, {...actor,authVersion:actor.authVersion+1}));
  await assert.rejects(command('claim',{claim:{...claim,lessor:{...claim.lessor,authorityFileIds:[]}}}));
  await assert.rejects(command('claim',{claim:{...claim,customer:{...claim.customer,subjectId:randomUUID()}}}));
  await assert.rejects(command('claim',{businessSourceHash:'f'.repeat(64),claim}));
  await assert.rejects(command('claim',{claim:{...claim,lessor:{...claim.lessor,personReference:actor.id}}}));
  await command('claim',{claim});const pending=await read();assert.equal(pending.state,'CLAIM');
  assert.equal((await filePrivacyBoundary(db,files[0].id)).renewalEvidence,true,'original bilateral evidence remains private even before verification');
  await assert.rejects(svc.cancellationV31File(j.changeId,files[0].id,undefined,randomUUID()));
  assert.equal((await svc.cancellationV31File(j.changeId,files[0].id,actor)).sha256,files[0].sha256);
  assert.equal((await read()).claims[0].claim.customer.subjectId,fixture.sub.customer.id,'current authorized reviewer can inspect original intentions');
  const heldRights:any=await db.serial(async tx=>creditView(tx,await tx.order.findUniqueOrThrow({where:{id:fixture.sub.order.id}}),await tx.usageAccount.findUniqueOrThrow({where:{orderId:fixture.sub.order.id}}),new Date()));assert.equal(heldRights.term.available,0);
  const future=await db.bill.findFirstOrThrow({where:{serviceStageId:j.stageId,sequence:5}});
  const customerRecords=new CustomerController(db),heldBill:any=await customerRecords.record('bills',future.id,{customer:fixture.sub.customer});
  assert.equal(heldBill.cancellation.lifecycleState,'CLAIM');assert.equal(heldBill.actions.some((a:any)=>a.id==='pay'),false);
  assert.equal((await publishBillAutomatically(db,future.id,new Date('2027-05-30T00:00:00Z'))).published,false,'already published bill retains history');
  await assert.rejects(fixture.billing.pay(fixture.payingCustomer,future.id,randomUUID()),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_CANCELLATION_IN_PROGRESS');
  const selfReview=(e:any)=>e.getResponse?.().error?.code==='RENEWAL_CANCELLATION_SELF_REVIEW';
  await assert.rejects(command('verify',{decision:'VERIFIED',note:'运营本人不得自审'},actor),selfReview);
  await assert.rejects(command('verify',{decision:'VERIFIED',note:'同人不同账号也不能互审'},{id:samePerson.id,role:samePerson.role,authVersion:samePerson.authVersion}),selfReview);
  await command('verify',{decision:'NEED_MORE',note:'补核原始时间'},factReviewer);
  const adminEvidence=await bilateral(db,{...fixture,f:{...fixture.f,actor:factAdmin}});await command('claim',{claim:adminEvidence.claim},factAdmin);
  await command('verify',{decision:'VERIFIED',note:'管理员按普通资料自审例外核对双方原始意思及权限'},factAdmin);
  assert.equal((await db.renewalCancellationFact.findFirstOrThrow({where:{changeId:j.changeId,kind:'VERIFIED'}})).payload['review'].policy,'ADMIN_EXCEPTION');
  const verified=await read();assert.equal(verified.state,'VERIFIED');assert.equal(verified.agreedAt,'2027-04-28T03:00:00.000Z');
  const rollback=new Error('rollback real usage dependency probe');
  await assert.rejects(db.serial(async(tx:any)=>{
   const period=await tx.usagePeriod.findFirstOrThrow({where:{serviceStageId:j.stageId},orderBy:{sequence:'asc'}}),segment=await tx.usageSegment.findFirstOrThrow({where:{periodId:period.id}});
   const reading=await tx.mileage.create({data:{orderId:fixture.sub.order.id,customerId:fixture.sub.customer.id,periodId:period.id,segmentId:segment.id,assignmentId:segment.assignmentId,readingKm:1300,recordedAt:new Date(),fileIds:[files[0].id],idempotencyKey:randomUUID()}});
   const sub:any=new OrderRenewalsService({serial:(fn:any)=>fn(tx)} as any,()=>new Date()),p=await sub.cancellationV31(j.changeId,'read',{},actor);
   await sub.cancellationV31(j.changeId,'correct',{revision:p.revision,headId:p.headId,headHash:p.headHash,businessSourceHash:p.businessSourceHash,idempotencyKey:randomUUID()},actor);
   const v=await sub.cancellationV31(j.changeId,'read',{},actor);assert.ok(v.dependencies.some((d:any)=>d.value.id===reading.id),'submitted genuine reading remains an independent review source');
   assert.deepEqual(await tx.mileage.findUnique({where:{id:reading.id}}),reading);
   assert.notEqual((await tx.usagePeriod.findUniqueOrThrow({where:{id:period.id}})).status,'CANCELLED');
   const d=v.dependencies.find((d:any)=>d.value.id===reading.id);
   await sub.cancellationV31(j.changeId,'dispose-dependency',{revision:v.revision,headId:v.headId,headHash:v.headHash,businessSourceHash:v.businessSourceHash,idempotencyKey:randomUUID(),dependencyHash:d.hash,disposition:'REFERRED_FINANCIAL_REVIEW',responsibleStaffId:j.financeActor.id,dueAt:'2027-05-10T00:00:00Z',evidenceFileIds:[files[0].id],note:'真实读数独立核验，不抵扣新期全退'},actor);
   assert.equal((await sub.cancellationV31(j.changeId,'read',{},actor)).dependencies.find((x:any)=>x.hash===d.hash).disposition.responsibleStaffId,j.financeActor.id);
   const next=await sub.cancellationV31(j.changeId,'read',{},actor),disposition={revision:next.revision,headId:next.headId,headHash:next.headHash,businessSourceHash:next.businessSourceHash,idempotencyKey:randomUUID(),dependencyHash:d.hash,disposition:'NO_SEPARATE_LIABILITY',responsibleStaffId:factAdmin.id,dueAt:'2027-05-10T00:00:00Z',evidenceFileIds:[adminEvidence.files[0].id],note:'管理员核实该提交读数不形成独立费用；真实证据仍保留'};
   await sub.cancellationV31(j.changeId,'dispose-dependency',disposition,factAdmin);
   assert.equal((await sub.cancellationV31(j.changeId,'read',{},actor)).dependencies.find((x:any)=>x.hash===d.hash).disposition.disposition,'NO_SEPARATE_LIABILITY');
   throw rollback;
  }),(e:any)=>e===rollback);
  const before=await db.payment.findMany({where:{bill:{serviceStageId:j.stageId}},orderBy:{id:'asc'}});
  const p=await read(),input={revision:p.revision,headId:p.headId,headHash:p.headHash,businessSourceHash:p.businessSourceHash,idempotencyKey:randomUUID()};const corrected=await svc.cancellationV31(j.changeId,'correct',input,actor);assert.deepEqual(await svc.cancellationV31(j.changeId,'correct',input,actor),corrected);
  assert.equal((await db.orderServiceStage.findUniqueOrThrow({where:{id:j.stageId}})).status,'VOIDED');
  assert.equal(await db.usagePeriod.count({where:{serviceStageId:j.stageId,status:'CANCELLED'}}),3);
  assert.equal(await db.bill.count({where:{serviceStageId:j.stageId,status:'VOID'}}),2);
  const stoppedBill:any=await customerRecords.record('bills',future.id,{customer:fixture.sub.customer});assert.equal(stoppedBill.status,'VOID');assert.equal(stoppedBill.cancellation.serviceEffect,'NEVER_EFFECTIVE');assert.equal(stoppedBill.actions.length,0);
  const billHistory:any=await customerRecords.records('bills',{page:1,pageSize:100},{customer:fixture.sub.customer});assert.ok(billHistory.items.some((b:any)=>b.id===future.id),'cancelled new-phase bill remains visible in customer history');
  assert.equal((await db.swapReservation.findUniqueOrThrow({where:{id:reservation.id}})).status,'RELEASED');assert.equal((await db.swapCredit.findUniqueOrThrow({where:{id:reservation.creditId}})).status,'EXPIRED');
  assert.deepEqual(await db.swapCredit.findUniqueOrThrow({where:{id:j.purchased.credit.id}}),j.purchased.credit);assert.deepEqual(await db.mileagePurchase.findUniqueOrThrow({where:{id:j.purchased.mileagePurchase.id}}),j.purchased.mileagePurchase);
  assert.equal(await db.orderServiceStage.count({where:{orderId:fixture.sub.order.id,status:'ACTIVE'}}),0,'expired original stage is not restarted');
  assert.equal((await db.order.findUniqueOrThrow({where:{id:fixture.sub.order.id}})).effectiveTermsVersionId,j.priorTermsVersionId);
  assert.equal((await readEffectiveContractChain(db,fixture.sub.order.id)).ready,true);
  const usage=await new UsageService(db,()=>new Date()).account(fixture.sub.order.id,fixture.sub.customer.id);assert.equal(usage.servicePeriod.status,'NO_ACTIVE_PERIOD');
  assert.equal((await svc.detail(j.changeId,actor)).cancellation.lifecycleState,'CORRECTED');
  assert.deepEqual(await db.payment.findMany({where:{bill:{serviceStageId:j.stageId}},orderBy:{id:'asc'}}),before);
  fixture.gateway.capture(lateRequest.paymentId);await Promise.all([fixture.billing.sync(lateRequest.paymentId),svc.cancellationV31(j.changeId,'correct',input,actor)]);await fixture.billing.sync(lateRequest.paymentId);
  const result=await read();assert.equal(result.state,'CORRECTED');assert.equal(result.refundSources.reduce((n:number,p:any)=>n+p.amount,0),40000);assert.equal(result.oldDebtOffsetAmount,0);assert.equal(await db.paymentAllocation.count({where:{paymentId:lateRequest.paymentId}}),0);
  await assert.rejects(command('close-finance',{sourceHash:result.financialSourceHash,note:'尚未实际退款不能关案'},j.financeActor));
  const refund=await command('request-refund',{paymentId:result.refundSources[0].paymentId,sourceHash:result.financialSourceHash,note:'05约定新期实收全额原路退回'},j.financeActor);
  const r=await db.refund.findUniqueOrThrow({where:{id:refund.refundId},include:{payment:true}});
  await db.adminUser.update({where:{id:j.financeActor.id},data:{staffPersonId:'synthetic-requester-'+randomUUID()}});
  const reviewer=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'独立退款复核',role:'FINANCE',staffPersonId:'synthetic-reviewer-'+randomUUID()}}),reviewActor={id:reviewer.id,role:reviewer.role,authVersion:reviewer.authVersion};
  assert.equal(r.amount,20000);await assert.rejects(db.serial(tx=>guardRenewalCancellationRefund(tx,r,j.financeActor,new Date(),'APPROVE')));
  await db.serial(tx=>guardRenewalCancellationRefund(tx,r,reviewActor,new Date(),'APPROVE'));
  const controller=new BillingController(db,fixture.billing,fixture.gateway,()=>new Date());
  await assert.rejects(controller.approve(r.id,{admin:reviewActor}),(e:any)=>e.response?.error?.code==='REFUND_OBLIGATION_REQUIRED');
  assert.equal((await db.refund.findUniqueOrThrow({where:{id:r.id}})).status,'PENDING_APPROVAL');
  await assert.rejects(command('request-refund',{paymentId:r.paymentId,sourceHash:(await read()).financialSourceHash,note:'不得对同一未决退款重复出款'},j.financeActor));
  await assert.rejects(command('close-finance',{sourceHash:(await read()).financialSourceHash,note:'退款来源和实际出款尚待独立核清'},j.financeActor));
  /* Financial execution and late cash authorization are exercised by the current
     v31-refund-renewal and v31-refund-execution suites. This cancellation test
     ends at the source-bound, non-paying manual-review handoff. */
  const firstFact=await db.renewalCancellationFact.findFirstOrThrow({where:{changeId:j.changeId}});await assert.rejects(db.renewalCancellationFact.update({where:{id:firstFact.id},data:{actorId:j.financeActor.id}}));
 }finally{await db.$disconnect();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);ctx.mock.timers.reset();}
});








