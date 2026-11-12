import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OfflineWorkspaceService} from '../src/offline-documents/workspace.service';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';
let db:Db,service:OfflineWorkspaceService,admin:any,finance:any,support:any;
before(async()=>{db=new Db();service=new OfflineWorkspaceService(db);const actor=async(role:string)=>db.adminUser.create({data:{username:randomUUID(),name:'合成流程人员',role:role as any,passwordHash:'synthetic-disabled-password'}});admin=await actor('ADMIN');finance=await actor('FINANCE');support=await actor('SUPPORT');});
after(()=>db.$disconnect());
async function fixture(){const f=await offlineOrder(db);await approvedOfflineArchive(db,f.order.id);await db.order.update({where:{id:f.order.id},data:{finalPlanSnapshot:{...f.order.finalPlanSnapshot as any,startDate:'2026-10-29',firstDueDate:'2027-10-28',monthlyFeeAmount:489900}}});await db.bill.update({where:{id:f.bill.id},data:{amount:489900}});return f;}
test('unpaid first rent drives the admin process; refunded one-cent test never satisfies delivery funds',async()=>{
 const f=await fixture(),b=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'PAYMENT_TEST',sequence:1,amount:1,paidAmount:1,status:'PAID',dueDate:new Date(),description:'合成测试'}}),p=await db.payment.create({data:{billId:b.id,customerId:f.customer.id,status:'SUCCEEDED',amount:1,idempotencyKey:randomUUID()}});await db.refund.create({data:{paymentId:p.id,customerId:f.customer.id,amount:1,status:'SUCCEEDED',reason:'合成退款',requestedBy:admin.id,idempotencyKey:randomUUID()}});
 const before=await db.order.findUniqueOrThrow({where:{id:f.order.id}}),result:any=await service.order(f.order.id,admin);
 assert.equal(result.process.currentStep,'PAYMENT');assert.equal(result.process.steps.length,7);assert.match(result.process.steps.find((s:any)=>s.key==='PAYMENT').summary,/4,?899/);
 assert(result.process.blockers.some((b:any)=>b.code==='FIRST_RENT_UNPAID'));assert.equal(result.process.primaryAction.key,'OPEN_BILL');assert.equal(result.process.primaryAction.target.id,f.bill.id);
 assert(!result.process.steps.flatMap((s:any)=>s.actions).some((a:any)=>a.key==='CREATE_DELIVERY_TASK'&&a.enabled));
 const testBill=result.process.related.bills.find((x:any)=>x.id===b.id);assert.equal(testBill.refundedAmount,1);assert.equal(testBill.netReceivedAmount,0);assert.equal(result.process.attention.some((x:any)=>x.code==='BILL_DATE_CHECK'),true);
 assert(result.process.related.bills.find((x:any)=>x.id===f.bill.id).publication);
 assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:f.order.id}}),before);assert.equal(await db.fieldHandoverTask.count({where:{orderId:f.order.id}}),0);
});

test('funded order finishes payment and reports business blockers at delivery without writing order status',async()=>{
 const f=await fixture();await db.bill.update({where:{id:f.bill.id},data:{status:'PAID',paidAmount:489900}});await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,status:'SUCCEEDED',amount:489900,idempotencyKey:randomUUID()}});
 const before=await db.order.findUniqueOrThrow({where:{id:f.order.id}}),r:any=await service.order(f.order.id,admin);assert.equal(r.process.currentStep,'DELIVERY');assert.equal(r.process.steps.find((s:any)=>s.key==='PAYMENT').state,'DONE');assert(r.process.blockers.some((c:any)=>c.code==='ORDER_BUSINESS_SNAPSHOT_REQUIRED'));
 assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:f.order.id}}),before);
 assert.equal(r.process.primaryAction.key,'OPEN_BUSINESS_RECORD');
});
test('new process facts remain admin-only and support receives no finance or private archive detail',async()=>{
 const f=await fixture();assert.equal((await service.order(f.order.id,{id:f.customer.id,role:'CUSTOMER'} as any) as any).process,undefined);
 const result:any=await service.order(f.order.id,support);assert(result.process);assert.deepEqual(result.process.related.bills,[]);assert.deepEqual(result.process.related.archives,[]);assert(!JSON.stringify(result.process).includes('489900'));
 const fin:any=await service.order(f.order.id,finance);assert.deepEqual(fin.process.related.tasks,[]);assert.deepEqual(fin.process.related.archives,[]);assert(!fin.process.steps.flatMap((s:any)=>s.actions).some((a:any)=>a.enabled&&a.key==='CREATE_DELIVERY_TASK'));
});
test('fully refunded first rent and unresolved receipt both keep delivery blocked',async()=>{
 const f=await fixture();await db.bill.update({where:{id:f.bill.id},data:{status:'PAID',paidAmount:489900}});const p=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,status:'SUCCEEDED',amount:489900,idempotencyKey:randomUUID(),reconciliationRequired:true}});
 let result:any=await service.order(f.order.id,admin);assert(result.process.blockers.some((b:any)=>b.code==='PAYMENT_RECONCILIATION_REQUIRED'));
 await db.payment.update({where:{id:p.id},data:{reconciliationRequired:false}});await db.refund.create({data:{paymentId:p.id,customerId:f.customer.id,amount:489900,status:'SUCCEEDED',reason:'合成退款',requestedBy:admin.id,idempotencyKey:randomUUID()}});
 result=await service.order(f.order.id,admin);assert(result.process.blockers.some((b:any)=>b.code==='FIRST_RENT_UNPAID'));assert.equal(result.process.related.bills[0].netReceivedAmount,0);
});
test('cancelled undelivered order cannot appear as a completed delivery or offer advancing actions',async()=>{
 const f=await fixture();await db.order.update({where:{id:f.order.id},data:{status:'CANCELLED'}});const result:any=await service.order(f.order.id,admin);
 assert.equal(result.process.terminal,'CANCELLED');assert.equal(result.process.steps.find((s:any)=>s.key==='DELIVERY').state,'NOT_APPLICABLE');assert(!result.process.steps.flatMap((s:any)=>s.actions).some((a:any)=>a.kind==='OPEN_FORM'&&a.enabled));
});
test('pending payment and refund are explicit blockers instead of an empty checklist',async()=>{
 const f=await fixture(),p=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,status:'PENDING',amount:489900,idempotencyKey:randomUUID()}});
 let r:any=await service.order(f.order.id,admin);assert(r.process.blockers.some((b:any)=>b.code==='PAYMENT_PROCESSING'));
 await db.payment.update({where:{id:p.id},data:{status:'SUCCEEDED'}});await db.bill.update({where:{id:f.bill.id},data:{status:'PAID',paidAmount:489900}});
 await db.refund.create({data:{paymentId:p.id,customerId:f.customer.id,amount:1,status:'PROCESSING',reason:'合成退款',requestedBy:admin.id,idempotencyKey:randomUUID()}});
 r=await service.order(f.order.id,admin);assert(r.process.blockers.some((b:any)=>b.code==='REFUND_PROCESSING'));
});
test('physical receipt begins return work without pretending formal return or settlement is complete',async()=>{
 const f=await fixture();await db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
 const h=await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,vehicleId:f.vehicle.id,type:'RETURN',executionMode:'OFFLINE',status:'PUBLISHED',manifestHash:'synthetic-return',actualAt:new Date(),readingKm:200,fileIds:[],checklist:[]}});
 await db.vehicleReceiptEvent.create({data:{orderId:f.order.id,handoverId:h.id,vehicleId:f.vehicle.id,revision:0,receivedAt:h.actualAt!,readingKm:200,storageLocation:'合成地点',evidenceFileIds:[],createdBy:admin.id,idempotencyKey:randomUUID(),requestHash:'synthetic'}});
 const r:any=await service.order(f.order.id,admin);assert.equal(r.process.currentStep,'RETURN');assert.notEqual(r.process.steps.find((s:any)=>s.key==='RETURN').state,'DONE');assert.equal(r.process.related.settlements.length,0);assert.equal(r.process.primaryAction.key,'WAIT_CUSTOMER');
 assert(!r.process.steps.find((s:any)=>s.key==='RETURN').checks.some((c:any)=>c.code==='PHYSICAL_RECEIPT_MISMATCH'));
});
test('explicit delivery recheck refuses unfunded orders without business writes, stale versions, or privilege escalation',async()=>{
 const {OrderProcessController}=await import('../src/orders/order-process.controller');const controller=new OrderProcessController(db),f=await fixture();
 const before=await db.order.findUniqueOrThrow({where:{id:f.order.id}});
 const input={revision:before.revision,idempotencyKey:randomUUID()};
 await assert.rejects(controller.recheck(f.order.id,input,{admin}),(e:any)=>{const r=e.getResponse();assert.equal(r.error.code,'DELIVERY_NOT_READY');assert(r.error.details.some((x:any)=>x.code==='FIRST_RENT_UNPAID'));return true;});
 assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:f.order.id}}),before);
 await assert.rejects(controller.recheck(f.order.id,{...input,revision:before.revision+1},{admin}),(e:any)=>e.getResponse().error.code==='REVISION_CONFLICT');
 await assert.rejects(controller.recheck(f.order.id,input,{admin:finance}),(e:any)=>e.getResponse().error.code==='FORBIDDEN');
});

test('business navigation resolves real policy and product versions; retired requirements have no navigation to parent records and omits nonexistent IDs',async()=>{
 const {businessBlockerNavigation}=await import('../src/orders/order-process-facts');
 const policy=await db.insurancePolicy.create({data:{insurer:'合成保险机构',policyNumber:randomUUID(),createdBy:admin.id}});
 const policyVersion=await db.insurancePolicyVersion.create({data:{policyId:policy.id,version:1,status:'APPROVED',effectiveAt:new Date('2025-01-01'),startAt:new Date('2025-01-01'),endAt:new Date('2025-12-31'),policyholder:'合成投保人',insuredParty:'合成被保险人',vehicleIds:[],coverageItems:[],terms:'合成条款',fileIds:[],requirementVersionIds:[],createdBy:admin.id}});
 const requirement=await db.coverageRequirement.create({data:{scopeType:'MODEL',scopeId:randomUUID()}}),requirementVersion=await db.coverageRequirementVersion.create({data:{requirementId:requirement.id,version:1,effectiveAt:new Date('2025-01-01'),items:[],createdBy:admin.id}});
 const product=await db.product.create({data:{name:'合成导航产品',createdBy:admin.id}}),productVersion=await db.productVersion.create({data:{productId:product.id,version:1,name:'合成导航版本',months:12,monthlyFeeAmount:100,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'合成',conditions:'合成',vehicleIds:[],modelDefinitionIds:[],createdBy:admin.id}});
 for(const [resourceType,resourceId,parentId] of [['insurance-policies',policy.id,policy.id],['insurance-policies',policyVersion.id,policy.id],['products',productVersion.id,product.id]]){
  const blocker={code:'CHECK_REQUIRED',label:'待核对',resourceType,resourceId};const target=await businessBlockerNavigation(db,blocker);assert.equal(target.resourceId,parentId);assert.equal(target.code,blocker.code);
 }
 const f=await fixture();for(const resourceType of ['insurance-policies','coverage-requirements','products']){
  const target=await businessBlockerNavigation(db,{code:'MISSING',label:'待补齐',resourceType,resourceId:f.vehicle.id});assert.equal(target.resourceId,undefined);
 }
 const model=await db.modelDefinition.create({data:{brand:'合成',name:randomUUID()}});
 await db.vehicle.update({where:{id:f.vehicle.id},data:{modelDefinitionId:model.id}});await db.coverageRequirement.update({where:{id:requirement.id},data:{scopeId:model.id}});
 await db.coverageRequirementVersion.update({where:{id:requirementVersion.id},data:{items:[{code:'COVER',label:'合成保障',description:'合成核对',minAmount:null,deductibleReview:'按原件',exclusionReview:'按原件'}]}});
 await db.insurancePolicyVersion.update({where:{id:policyVersion.id},data:{vehicleIds:[f.vehicle.id]}});
 const current=await db.order.findUniqueOrThrow({where:{id:f.order.id}});await db.order.update({where:{id:f.order.id},data:{finalPlanSnapshot:{...current.finalPlanSnapshot as any,productSnapshot:{productVersionId:productVersion.id,benefits:[]}}}});
 const workspace:any=await service.order(f.order.id,admin),checks=workspace.process.steps.find((s:any)=>s.key==='DELIVERY').checks;
 assert.equal(checks.find((c:any)=>c.code==='INSURANCE_POLICY_EXPIRED').action.target.id,policy.id);
 assert.ok(checks.every((c:any)=>!c.code.startsWith('INSURANCE_REQUIREMENT')&&c.action?.target?.resource!=='coverage-requirements'));
 const retired=await businessBlockerNavigation({coverageRequirement:{findUnique:()=>{throw new Error('RETIRED_READ');}}},{code:'RETIRED',resourceType:'coverage-requirements',resourceId:requirementVersion.id});assert.equal(retired.resourceId,undefined);
});
