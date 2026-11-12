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

async function bilateral(db:any,fixture:any,at='2027-04-28T03:00:00Z'){
 const actor=fixture.f.actor,files=await Promise.all(['customer','lessor','authority'].map(label=>db.storedFile.create({data:{id:randomUUID(),adminId:actor.id,purpose:'evidence',mimeType:'application/pdf',size:100,sha256:label.padEnd(64,'a').slice(0,64).replace(/[^a-f0-9]/g,'a'),storagePath:'synthetic/'+randomUUID(),name:label+'.pdf'}})));
 return{files,claim:{customer:{subjectId:fixture.sub.customer.id,intention:'取消本次新增阶段',occurredAt:at,fileIds:[files[0].id]},lessor:{ownerId:fixture.f.owner.id,personName:'出租方法定代表人',personReference:'synthetic-authorized-person',authorityScope:'取消本订单本次05新增阶段',authorityFrom:'2027-01-01T00:00:00Z',authorityUntil:'2027-12-31T00:00:00Z',intention:'同意取消本次新增阶段',occurredAt:at,fileIds:[files[1].id],authorityFileIds:[files[2].id]},note:'核对双方原始消息与有权人员授权'}};
}

test('05 intake before archive preserves unresolved signing, then claim and actual activation share order locks',{skip:process.env.NODE_ENV!=='test'},async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2027-01-31T02:00:00Z')});const db=new Db(),saved={...process.env};
 try{
  let selected:any;const fixture=await activeSwapFixture(db,{initialMonths:3,actualDeliveryAt:'2027-01-31T01:00:00Z',configureSources:async(db,f)=>{selected=await seedRenewalProduct(db,f);}}),actor=fixture.f.actor;
  const reviewer=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'管理员事实核验',role:'ADMIN'}}),factAdmin={id:reviewer.id,role:reviewer.role,authVersion:reviewer.authVersion};
  await runRenewalJourney(ctx,db,fixture,selected.product,selected.listing,{start:'2027-04-30',end:'2027-07-31',firstEnd:'2027-05-31',secondEnd:'2027-06-30',expiresAt:'2027-02-10T00:00:00Z',startAt:'2027-04-29T16:00:00Z'},{
   prepared:async({changeId,taskId})=>{
    const rollback=new Error('rollback pending05 intake');await assert.rejects(db.serial(async(tx:any)=>{
     const service:any=new OrderRenewalsService({serial:(fn:any)=>fn(tx)} as any,()=>new Date()),{claim}=await bilateral(tx,fixture,'2027-01-31T01:50:00Z');
     const act=async(action:string,extra:any={},acting=action==='verify'?factAdmin:actor)=>{const p=await service.cancellationV31(changeId,'read',{},actor);return service.cancellationV31(changeId,action,{revision:p.revision,headId:p.headId,headHash:p.headHash,businessSourceHash:p.businessSourceHash,idempotencyKey:randomUUID(),...extra},acting);};
     await act('claim',{claim});
     const oldUsage=await new UsageService({serial:(fn:any)=>fn(tx)} as any,()=>new Date()).account(fixture.sub.order.id,fixture.sub.customer.id);assert.equal(oldUsage.servicePeriod.status,'CURRENT','pending future05 must preserve original necessary service');
     await act('verify',{decision:'VERIFIED',note:'期前双方原始消息与有权范围已核实，05签署仍未决'});await act('correct');
     const task=await tx.electronicSigningTask.findUniqueOrThrow({where:{id:taskId}});assert.equal(task.status,'WITHDRAWN');assert.equal(task.stopStatus,'STOPPED_LOCAL_ONLY');assert.equal(task.archivedAt,null);
     await assert.rejects(activateElectronicRenewal(tx,task));assert.equal(await tx.orderServiceStage.count({where:{orderId:fixture.sub.order.id}}),1);
     assert.equal((await service.cancellationV31(changeId,'read',{},actor)).state,'CORRECTED');throw rollback;
    }),(e:any)=>e===rollback);
   },
   activationReady:async(j:any)=>{
    const {claim}=await bilateral(db,fixture),svc:any=j.service,p=await svc.cancellationV31(j.changeId,'read',{},actor),claimInput={revision:p.revision,headId:p.headId,headHash:p.headHash,businessSourceHash:p.businessSourceHash,idempotencyKey:randomUUID(),claim};
    const results=await Promise.allSettled([svc.cancellationV31(j.changeId,'claim',claimInput,actor),svc.activate(j.changeId,j.activateCommand,actor)]);
    assert.equal(results[0].status,'fulfilled');if(results[1].status==='rejected')assert.ok(['VERSION_CONFLICT','RENEWAL_CANCELLATION_IN_PROGRESS'].includes((results[1] as any).reason.getResponse?.().error?.code));
    for(const [action,extra]of [['verify',{decision:'VERIFIED',note:'真实期前合意已核清'}],['correct',{}]] as const){const v=await svc.cancellationV31(j.changeId,'read',{},actor);await svc.cancellationV31(j.changeId,action,{revision:v.revision,headId:v.headId,headHash:v.headHash,businessSourceHash:v.businessSourceHash,idempotencyKey:randomUUID(),...extra},action==='verify'?factAdmin:actor);}
    assert.equal((await db.orderServiceStage.findUniqueOrThrow({where:{id:j.stageId}})).status,'VOIDED');assert.equal(await db.renewalCancellationFact.count({where:{changeId:j.changeId,kind:'CORRECTED'}}),1);assert.equal(await db.orderTermsVersion.count({where:{quoteId:j.quoteId}}),results[1].status==='fulfilled'?1:0);return j;
   },
  });
 }finally{await db.$disconnect();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);ctx.mock.timers.reset();}
});


