import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {activeSwapFixture} from './v31-swap-fixture';
import {runRenewalJourney,seedRenewalProduct} from './v31-renewal-journey';
import {CustomerController} from '../src/orders/customer';
import {BillingController} from '../src/billing/billing';
import {UsageService} from '../src/usage/usage.service';

const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('rejected pre-stage05 intake survives genuine preparation and binds a later claim/correction/refund without rewriting history',{skip:process.env.NODE_ENV!=='test'},async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2027-01-31T02:00:00Z')});const db=new Db(),saved={...process.env};
 try{
  let selected:any;const fixture=await activeSwapFixture(db,{initialMonths:3,actualDeliveryAt:'2027-01-31T01:00:00Z',configureSources:async(db,f)=>{selected=await seedRenewalProduct(db,f);}}),actor=fixture.f.actor;
  await db.adminUser.update({where:{id:actor.id},data:{staffPersonId:'intake-person-'+randomUUID()}});
  const reviewer=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'独立复核取消事实',role:'OPERATIONS',staffPersonId:'review-person-'+randomUUID()}}),reviewActor={id:reviewer.id,role:reviewer.role,authVersion:reviewer.authVersion};
  const files=await Promise.all(['customer','lessor','authority'].map(label=>db.storedFile.create({data:{adminId:actor.id,purpose:'evidence',mimeType:'application/pdf',size:100,sha256:'a'.repeat(64),storagePath:'synthetic/'+randomUUID(),name:label+'.pdf'}})));
  const claim={customer:{subjectId:fixture.sub.customer.id,intention:'取消本次新增服务期',occurredAt:'2027-01-31T01:50:00Z',fileIds:[files[0].id]},lessor:{ownerId:fixture.f.owner.id,personName:'真实出租方授权代表',personReference:'synthetic-lessor-representative',authorityScope:'本单05新增期取消',authorityFrom:'2027-01-01T00:00:00Z',authorityUntil:'2027-12-31T00:00:00Z',intention:'同意取消本次新增服务期',occurredAt:'2027-01-31T01:51:00Z',fileIds:[files[1].id],authorityFileIds:[files[2].id]},note:'保留原始双方意思与权限材料'};
  let frozenCase:any,originalFacts:any[],oldPin:string;
  const service:any=new OrderRenewalsService(db,()=>new Date());
  const read=(id:string)=>service.cancellationV31(id,'read',{},actor);
  const command=async(id:string,action:string,extra:any={},who=actor)=>{const v=await read(id);return service.cancellationV31(id,action,{revision:v.revision,headId:v.headId,headHash:v.headHash,businessSourceHash:v.businessSourceHash,idempotencyKey:randomUUID(),...extra},who);};
  await runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-04-30',end:'2027-07-31',firstEnd:'2027-05-31',secondEnd:'2027-06-30',expiresAt:'2027-02-10T00:00:00Z',startAt:'2027-04-29T16:00:00Z'},{
   prepared:async({changeId})=>{
    assert.equal((await read(changeId)).stageId,null);
    await command(changeId,'claim',{claim});await command(changeId,'verify',{decision:'REJECTED',note:'当前资料尚不能证明取消范围，保留原件和异议渠道'},reviewActor);
    frozenCase=await db.orderRenewalCancellation.findFirstOrThrow({where:{changeId}});originalFacts=await db.renewalCancellationFact.findMany({where:{changeId},orderBy:{revision:'asc'}});oldPin=(await read(changeId)).businessSourceHash;
    assert.equal(frozenCase.serviceStageId,null);assert.equal(frozenCase.sourceSnapshot.stageId,null);assert.deepEqual(originalFacts.map(f=>f.kind),['CLAIM','REJECTED']);assert.ok(originalFacts.every(f=>f.stageId===null));
   },
   financePrepared:async(j:any)=>{
    const after=await read(j.changeId); // RED: genuine preparation must not invalidate the rejected intake source.
    assert.equal(after.state,'REJECTED');assert.equal(after.stageId,j.stageId);assert.equal(after.intakeSourceHash,frozenCase.sourceHash);assert.equal(after.stageBinding.status,'AVAILABLE');
    assert.equal((await service.detail(j.changeId,actor)).cancellation,null);
    assert.equal((await service.cancellationV31File(j.changeId,files[0].id,actor)).sha256,files[0].sha256);
    assert.deepEqual(await db.renewalCancellationFact.findMany({where:{changeId:j.changeId},orderBy:{revision:'asc'}}),originalFacts,'reads append no facts and preserve original hashes');
    assert.deepEqual(await db.orderRenewalCancellation.findUniqueOrThrow({where:{id:frozenCase.id}}),frozenCase,'reads do not bind or rewrite the intake projection');
    const first=await db.bill.findFirstOrThrow({where:{serviceStageId:j.stageId},orderBy:{sequence:'asc'}}),records=new CustomerController(db),bill:any=await records.record('bills',first.id,{customer:fixture.sub.customer});
    assert.equal(bill.cancellation,null);assert.ok(bill.actions.some((a:any)=>a.id==='pay'));
    const payment=await fixture.billing.pay(fixture.payingCustomer,first.id,randomUUID());fixture.gateway.capture(payment.paymentId);await fixture.billing.sync(payment.paymentId);
    await assert.rejects(command(j.changeId,'claim',{claim,businessSourceHash:oldPin}),code('VERSION_CONFLICT'));
    const rollback=new Error('rollback projection-only stage binding');await assert.rejects(db.serial(async tx=>{
     await tx.orderRenewalCancellation.update({where:{id:frozenCase.id},data:{serviceStageId:j.stageId}});
     const scoped:any=new OrderRenewalsService({serial:(fn:any)=>fn(tx)} as any,()=>new Date());await assert.rejects(scoped.cancellationV31(j.changeId,'read',{},actor),code('RENEWAL_CANCELLATION_FACT_CHAIN'));throw rollback;
    }),(e:any)=>e===rollback);
    const initial=await db.orderServiceStage.findFirstOrThrow({where:{orderId:fixture.sub.order.id,kind:'INITIAL'}});
    await assert.rejects(db.serial(async tx=>{
     const proxy=new Proxy(tx,{get(target,key){if(key==='orderServiceStage')return new Proxy(target.orderServiceStage,{get(delegate,method){if(method==='findUnique')return(args:any)=>args.where.changeId?initial:delegate.findUnique(args);return Reflect.get(delegate,method);}});return Reflect.get(target,key);}});
     return new OrderRenewalsService({serial:(fn:any)=>fn(proxy)} as any,()=>new Date()).cancellationV31(j.changeId,'read',{},actor);
    }),code('RENEWAL_CANCELLATION_SOURCE'));
    const supplement=await db.storedFile.create({data:{adminId:actor.id,purpose:'evidence',mimeType:'application/pdf',size:101,sha256:'b'.repeat(64),storagePath:'synthetic/'+randomUUID(),name:'双方取消范围补充核验.pdf'}}),supplementedClaim={...claim,customer:{...claim.customer,fileIds:[...claim.customer.fileIds,supplement.id]},note:'补充原始双方意思所指向的本次新增服务期范围'};
    const failAppend=new Error('synthetic fact insert failure'),fresh=await read(j.changeId),input={revision:fresh.revision,headId:fresh.headId,headHash:fresh.headHash,businessSourceHash:fresh.businessSourceHash,idempotencyKey:randomUUID(),claim:supplementedClaim};
    await assert.rejects(db.serial(async tx=>{
     const proxy=new Proxy(tx,{get(target,key){if(key==='renewalCancellationFact')return new Proxy(target.renewalCancellationFact,{get(delegate,method){if(method==='create')return()=>{throw failAppend;};return Reflect.get(delegate,method);}});return Reflect.get(target,key);}});
     return new OrderRenewalsService({serial:(fn:any)=>fn(proxy)} as any,()=>new Date()).cancellationV31(j.changeId,'claim',input,actor);
    }),(e:any)=>e===failAppend);
    assert.equal((await db.orderRenewalCancellation.findUniqueOrThrow({where:{id:frozenCase.id}})).serviceStageId,null,'failed append rolls projection back');
    const reclaimed=await service.cancellationV31(j.changeId,'claim',input,actor);assert.deepEqual(await service.cancellationV31(j.changeId,'claim',input,actor),reclaimed);
    const bound=await read(j.changeId),fact=await db.renewalCancellationFact.findUniqueOrThrow({where:{id:reclaimed.factId}}),binding=(fact.payload as any).stageBinding;
    assert.equal(bound.stageBinding.status,'BOUND');assert.equal(binding.kind,'STAGE_PREPARED_AFTER_REJECTION');assert.equal(binding.stageId,j.stageId);assert.equal(binding.stageHash,(await db.orderServiceStage.findUniqueOrThrow({where:{id:j.stageId}})).snapshotHash);assert.equal(binding.rejectedFactId,originalFacts[1].id);assert.equal(binding.rejectedFactHash,originalFacts[1].factHash);
    assert.equal(fact.stageId,j.stageId);assert.equal(fact.sourceHash,frozenCase.sourceHash);
    assert.equal((await service.cancellationV31File(j.changeId,supplement.id,actor)).sha256,supplement.sha256);
    await command(j.changeId,'verify',{decision:'VERIFIED',note:'补充核实完整原始取消范围及双方权限'},reviewActor);await command(j.changeId,'correct');
    assert.equal((await db.orderServiceStage.findUniqueOrThrow({where:{id:j.stageId}})).status,'VOIDED');assert.equal((await new UsageService(db,()=>new Date()).account(fixture.sub.order.id,fixture.sub.customer.id)).servicePeriod.status,'CURRENT');
    const money=await read(j.changeId);assert.equal(money.refundSources.length,1);assert.equal(money.refundSources[0].paymentId,payment.paymentId);assert.equal(money.refundSources[0].stageId,j.stageId);
    await db.adminUser.update({where:{id:j.financeActor.id},data:{staffPersonId:'finance-requester-'+randomUUID()}});
    const financeReview=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'独立退款复核',role:'FINANCE',staffPersonId:'finance-reviewer-'+randomUUID()}}),financeActor={id:financeReview.id,role:financeReview.role,authVersion:financeReview.authVersion};
    const refund=await command(j.changeId,'request-refund',{paymentId:payment.paymentId,sourceHash:money.financialSourceHash,note:'本次新增期真实实收全额原路退回'},j.financeActor),stored=await db.refund.findUniqueOrThrow({where:{id:refund.refundId}});
    assert.equal(stored.renewalCancellationId,frozenCase.id);assert.equal(stored.renewalCancellationStageId,j.stageId);assert.equal(stored.renewalCancellationBillId,first.id);
    await new BillingController(db,fixture.billing,fixture.gateway,()=>new Date()).approve(refund.refundId,{admin:financeActor});
    const final=await read(j.changeId);await command(j.changeId,'close-finance',{sourceHash:final.financialSourceHash,note:'真实原路全额退款已独立核实'},j.financeActor);assert.equal((await read(j.changeId)).financialStatus,'CLOSED');
    const finalCase=await db.orderRenewalCancellation.findUniqueOrThrow({where:{id:frozenCase.id}}),facts=await db.renewalCancellationFact.findMany({where:{changeId:j.changeId},orderBy:{revision:'asc'}});
    assert.deepEqual(finalCase.sourceSnapshot,frozenCase.sourceSnapshot);assert.equal(finalCase.sourceHash,frozenCase.sourceHash);assert.equal(finalCase.serviceStageId,j.stageId);assert.deepEqual(facts.slice(0,2),originalFacts);assert.ok(facts.slice(2).every(f=>f.stageId===j.stageId&&f.sourceHash===frozenCase.sourceHash));
    return j;
   },
  });
 }finally{await db.$disconnect();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);ctx.mock.timers.reset();}
});
