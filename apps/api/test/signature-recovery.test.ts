import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/common/db';
import { SignaturesController } from '../src/orders/signatures';
import { SignatureService } from '../src/orders/signature.service';
import { WorkflowsController } from '../src/operations/workflows';
let db:Db;
before(()=>{assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});});
after(async()=>{await db.$disconnect();});
async function fixture(kind:'SUBSCRIPTION'|'HANDOVER'='SUBSCRIPTION') {
 const suffix=randomUUID();const customer=await db.customer.create({data:{mobile:'recover-'+suffix,name:'恢复测试'}});
 const vehicle=await db.vehicle.create({data:{brand:'test',model:'EV',title:'恢复测试车',year:2026,city:'上海',mileageKm:10,status:'RESERVED'}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'test',months:1,monthlyFeeAmount:100,mileagePerMonthKm:1000,excessMileagePriceAmount:1,energyDescription:'test',benefits:[],conditions:'test'}});
 const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:suffix,requestHash:suffix,status:'FINAL_PLAN_CONFIRMED'}});
 const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{},status:kind==='HANDOVER'?'AWAITING_HANDOVER':'AWAITING_SIGNATURE',confirmedMileageKm:10}});
 await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:order.id}});
 const resource=kind==='SUBSCRIPTION'?await db.contract.create({data:{orderId:order.id,customerId:customer.id,documentHash:suffix,status:'PENDING'}}):await db.handover.create({data:{orderId:order.id,customerId:customer.id,type:'DELIVERY',readingKm:10,fileIds:[],checklist:[],manifestHash:suffix,status:'CUSTOMER_CONFIRMED',signatureStatus:'PENDING'}});
 return {resource,customer,order,kind,hash:suffix};
}
async function task(f:Awaited<ReturnType<typeof fixture>>,uploaded=true){const suffix=randomUUID();return db.fadadaTask.create({data:{kind:f.kind,resourceId:f.resource.id,customerId:f.customer.id,documentHash:f.hash,sourcePdfHash:'pdf',sourceFileId:'fixture-file',approvalId:suffix,providerEnvelopeId:suffix,customerProviderId:'customer',platformProviderId:'company',customerTransactionId:'c-'+suffix,platformTransactionId:'p-'+suffix,...(uploaded?{uploadedAt:new Date(),status:'PENDING'}:{})}});}
const signatureService=()=>new SignatureService(db);
test('crash before provider creation: legacy unbound pending contract can retry',async()=>{
 const f=await fixture();let calls=0;const gateway:any={create:async()=>{calls++;return {taskId:'recovered-'+f.resource.id,status:'PENDING',url:'https://example.invalid/sign'};}};
 const result=await new SignaturesController(db,gateway,signatureService()).send(f.resource.id);assert.equal(calls,1);assert.equal(result.taskId,'recovered-'+f.resource.id);assert.equal((await db.contract.findUniqueOrThrow({where:{id:f.resource.id}})).providerTaskId,result.taskId);
});
test('crash after provider persistence: sync binds exact persisted task without a second create',async()=>{
 const f=await fixture();const persisted=await task(f);let creates=0;const gateway:any={create:async()=>{creates++;throw Error('must not create');},query:async(id:string)=>{assert.equal(id,persisted.id);return {status:'PENDING',documentHash:f.hash};}};
 await new SignaturesController(db,gateway,signatureService()).sync(f.resource.id);assert.equal(creates,0);assert.equal((await db.contract.findUniqueOrThrow({where:{id:f.resource.id}})).providerTaskId,persisted.id);
});
test('handover crash recovery binds existing task on query and can recover missing task on retry',async()=>{
 const f=await fixture('HANDOVER');const persisted=await task(f);const gateway:any={query:async()=>({status:'PENDING',documentHash:f.hash})};
 await new WorkflowsController(db,gateway,signatureService()).signStatus(f.resource.id,{customer:f.customer});assert.equal((await db.handover.findUniqueOrThrow({where:{id:f.resource.id}})).providerTaskId,persisted.id);
 const second=await fixture('HANDOVER');const create:any={create:async()=>({taskId:'recovered-'+second.resource.id,status:'PENDING'})};await new WorkflowsController(db,create,signatureService()).signHandover(second.resource.id,{customer:second.customer});assert.equal((await db.handover.findUniqueOrThrow({where:{id:second.resource.id}})).providerTaskId,'recovered-'+second.resource.id);
});

test('active lease blocks concurrent creation and expired lease admits one recovery worker',async()=>{
 const f=await fixture();await db.contract.update({where:{id:f.resource.id},data:{signingLeaseUntil:new Date(Date.now()+45000)}});let calls=0;let release:any,entered:any;const began=new Promise(r=>entered=r);const pending=new Promise<any>(r=>release=r);const gateway:any={create:async()=>{calls++;entered();return pending;}};const controller=new SignaturesController(db,gateway,signatureService());
 await assert.rejects(()=>controller.send(f.resource.id));assert.equal(calls,0);
 await db.contract.update({where:{id:f.resource.id},data:{signingLeaseUntil:new Date(Date.now()-1000)}});const first=controller.send(f.resource.id);await began;await assert.rejects(()=>controller.send(f.resource.id));release({taskId:'lease-'+f.resource.id,status:'PENDING'});await first;assert.equal(calls,1);assert.equal((await db.contract.findUniqueOrThrow({where:{id:f.resource.id}})).signingLeaseUntil,null);
});
test('expired worker cannot overwrite a newer task binding or clear its lease',async()=>{
 const f=await fixture();let release:any,entered:any;const began=new Promise(r=>entered=r);const pending=new Promise<any>(r=>release=r);let calls=0;const gateway:any={create:async()=>{calls++;if(calls===1){entered();return pending;}return{taskId:'new-'+f.resource.id,status:'PENDING'};}};const controller=new SignaturesController(db,gateway,signatureService());
 const old=controller.send(f.resource.id);await began;await db.contract.update({where:{id:f.resource.id},data:{signingLeaseUntil:new Date(Date.now()-1000)}});await controller.send(f.resource.id);const rejected=assert.rejects(()=>old);release({taskId:'old-'+f.resource.id,status:'PENDING'});await rejected;
 const current=await db.contract.findUniqueOrThrow({where:{id:f.resource.id}});assert.equal(current.providerTaskId,'new-'+f.resource.id);assert.equal(current.signingLeaseUntil,null);
});
test('partially uploaded persistent task is bound but query exposes retry delay without querying absent provider record',async()=>{
 const f=await fixture('HANDOVER');const persisted=await task(f,false);await db.fadadaTask.update({where:{id:persisted.id},data:{processingUntil:new Date(Date.now()+60000)}});let queries=0;const gateway:any={query:async()=>{queries++;throw Error('upload incomplete');}};const controller=new WorkflowsController(db,gateway,signatureService());
 const state=await controller.signStatus(f.resource.id,{customer:f.customer});assert.equal(state.status,'PENDING');assert.equal(state.retryable,false);assert.ok(state.retryAfterSeconds>0);assert.equal(queries,0);assert.equal((await db.handover.findUniqueOrThrow({where:{id:f.resource.id}})).providerTaskId,persisted.id);
 await db.fadadaTask.update({where:{id:persisted.id},data:{processingUntil:new Date(Date.now()-1000)}});assert.equal((await controller.signStatus(f.resource.id,{customer:f.customer})).retryable,true);
});
test('recovery rejects persisted task with wrong customer and never adopts a different kind',async()=>{
 const f=await fixture();const persisted=await task(f);await db.fadadaTask.update({where:{id:persisted.id},data:{customerId:'wrong-customer'}});let queries=0;const gateway:any={query:async()=>{queries++;throw Error('unexpected');}};await assert.rejects(()=>new SignaturesController(db,gateway,signatureService()).sync(f.resource.id));assert.equal(queries,0);assert.equal((await db.contract.findUniqueOrThrow({where:{id:f.resource.id}})).providerTaskId,null);
 const second=await fixture();await task({...second,kind:'HANDOVER'});const state=await new SignaturesController(db,gateway,signatureService()).sync(second.resource.id);assert.equal(state.retryable,true);assert.equal((await db.contract.findUniqueOrThrow({where:{id:second.resource.id}})).providerTaskId,null);
});

test('retry resumes the persisted envelope after upload interruption without creating a second task',async()=>{
 const f=await fixture();const persisted=await task(f,false);let creates=0;const gateway:any={create:async(input:any)=>{creates++;assert.equal(input.kind,'SUBSCRIPTION');assert.equal(input.documentHash,f.hash);assert.equal((await db.contract.findUniqueOrThrow({where:{id:f.resource.id}})).providerTaskId,persisted.id);await db.fadadaTask.update({where:{id:persisted.id},data:{uploadedAt:new Date(),status:'PENDING'}});return {taskId:persisted.id,status:'PENDING',url:'https://example.invalid/existing-envelope'};}};
 const result=await new SignaturesController(db,gateway,signatureService()).send(f.resource.id);assert.equal(result.taskId,persisted.id);assert.equal(creates,1);assert.equal(await db.fadadaTask.count({where:{kind:'SUBSCRIPTION',resourceId:f.resource.id,documentHash:f.hash}}),1);
});
