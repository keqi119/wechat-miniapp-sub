import { fixtureUsagePolicy, seedUsageLegal } from './usage-fixtures';
import { initializeUsage, shanghaiDay } from '../src/usage/rules';
import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/common/db';
import { WorkflowsController } from '../src/operations/workflows';
import { SignatureService } from '../src/orders/signature.service';
import { unavailableESign, unavailablePayment } from '../src/common/unavailable';
import { ApplicationsController } from '../src/applications/applications';
import { CustomerController } from '../src/orders/customer';
import { AdminController } from '../src/operations/admin';
import { BillingController, BillingService } from '../src/billing/billing';
import { AuthController } from '../src/auth/auth.controller';
import { CreditReviewController } from '../src/applications/credit-review';
let db: Db, workflows: WorkflowsController;
const admin = {admin:{id:'completion-operator',role:'ADMIN'}};
before(async()=>{assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});await seedUsageLegal(db);workflows=new WorkflowsController(db,unavailableESign,new SignatureService(db));});
after(async()=>{await db?.$disconnect();});
async function fixture(status: any='AWAITING_HANDOVER') {
  const key=`${Date.now()}-${Math.random()}`;
  const customer=await db.customer.create({data:{mobile:`fixture-${key}`,name:'测试客户'}});
  const vehicle=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'交接测试',year:2026,city:'上海',mileageKm:100,status:status==='ACTIVE'?'IN_USE':'RESERVED'}});
  const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'测试套餐',months:2,monthlyFeeAmount:10000,mileagePerMonthKm:1000,excessMileagePriceAmount:100,energyDescription:'测试',benefits:[],conditions:'测试',active:true}});
  const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:'原资料'},consents:[],idempotencyKey:key,requestHash:key,status:'FINAL_PLAN_CONFIRMED'}});
  const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{months:2,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,startDate:shanghaiDay(new Date()),usagePolicyVersion:'USAGE_V1',usagePolicy:fixtureUsagePolicy},confirmedMileageKm:100,status}});
  await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:order.id}});
  await db.contract.create({data:{orderId:order.id,customerId:customer.id,documentHash:key,status:'SIGNED'}});
  await db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:1,amount:10000,paidAmount:10000,status:'PAID',dueDate:new Date()}});
  if(status==='ACTIVE')await db.serial(tx=>initializeUsage(tx,order,{actualAt:new Date(),readingKm:100}));
  return {customer,vehicle,plan,application,order,request:{customer}};
}
async function handover(f:any,type='DELIVERY',status:any='CUSTOMER_CONFIRMED') {return db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type,actualAt:new Date(),readingKm:100,fileIds:[],checklist:[{label:'检查',value:'已核对'}],manifestHash:`manifest-${f.order.id}`,status,signatureStatus:'SIGNED',customerResponse:'CONFIRM'}});}
test('stale signed delivery cannot reactivate completed order, steal reservation or lower odometer',async()=>{
  const f=await fixture('COMPLETED');const h=await handover(f);
  await db.vehicle.update({where:{id:f.vehicle.id},data:{reservedOrderId:`another-${f.order.id}`,status:'IN_USE',mileageKm:500}});
  await assert.rejects(()=>workflows.complete(h.id,admin));
  assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'COMPLETED');
  const v=await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}});assert.equal(v.reservedOrderId,`another-${f.order.id}`);assert.equal(v.mileageKm,500);
});
test('completed delivery cannot be created a second time and return requires active owned vehicle',async()=>{
  const f=await fixture('ACTIVE');await handover(f,'DELIVERY','COMPLETED');
  await assert.rejects(()=>workflows.handover({orderId:f.order.id,type:'DELIVERY',actualAt:new Date().toISOString(),readingKm:100,fileIds:[],checklist:[{label:'检查',value:'已核对'}]},admin));
  const returned=await handover(f,'RETURN');await db.vehicle.update({where:{id:f.vehicle.id},data:{reservedOrderId:null,status:'UNPUBLISHED'}});
  await assert.rejects(()=>workflows.complete(returned.id,admin));
});
test('objection resolution creates a fresh unsigned handover while preserving immutable previous evidence',async()=>{
  const f=await fixture();const original=await handover(f,'DELIVERY','OBJECTION_SUBMITTED');
  await db.handover.update({where:{id:original.id},data:{signatureStatus:'DRAFT',customerResponse:'OBJECT',responseReason:'原照片不清楚',responseKey:'objection-first-key'}});
  const next=await workflows.reviseHandover(original.id,{actualAt:new Date().toISOString(),readingKm:101,fileIds:[],checklist:[{label:'车况',value:'重新核对'}],resolutionNote:'补充现场核对记录'},admin);
  assert.notEqual(next.id,original.id);assert.equal(next.signatureStatus,'DRAFT');assert.equal(next.customerResponse,null);
  const old=await db.handover.findUniqueOrThrow({where:{id:original.id}});assert.equal(old.status,'SUPERSEDED');assert.equal(old.responseReason,'原照片不清楚');assert.equal(old.manifestHash,original.manifestHash);
  await assert.rejects(()=>workflows.confirmHandover(next.id,{manifestHash:original.manifestHash,readFileIds:[],idempotencyKey:'new-confirm-key'},f.request));
});
test('NEEDS_INFO amendments change the application snapshot and preserve prior profile in audit',async()=>{
  const f=await fixture();await db.application.update({where:{id:f.application.id},data:{status:'NEEDS_INFO'}});
  const applications=new ApplicationsController(db);
  const updated=await applications.amend(f.application.id,{profile:{name:'补件客户',drivingYears:4,fileIds:[]},note:'已补全',idempotencyKey:'amend-request-key'},f.request);
  assert.equal(updated.status,'IN_REVIEW');assert.equal((updated.profile as any).name,'补件客户');
  const log=await db.auditLog.findFirstOrThrow({where:{resourceId:f.application.id,action:'AMEND'}});assert.equal((log.data as any).previousProfile.name,'原资料');
  await assert.rejects(()=>applications.amend(f.application.id,{profile:{name:'其他修改',fileIds:[]},idempotencyKey:'amend-request-key'},f.request));
});
test('support dashboard has no audit records and customer mileage records expose the submitted record',async()=>{
  const f=await fixture('ACTIVE');const mileage=await db.mileage.create({data:{orderId:f.order.id,customerId:f.customer.id,readingKm:120,recordedAt:new Date(),fileIds:[],idempotencyKey:'mileage-read-test'}});
  const dashboard=await new AdminController(db).dashboard({admin:{role:'SUPPORT'}});assert.deepEqual(dashboard.recentActivity,[]);
  const record=await new CustomerController(db).record('mileages',mileage.id,f.request);assert.equal(record.id,mileage.id);
});

test('extra fee requires different reviewer and approved immutable evidence before publication',async()=>{
 const f=await fixture('ACTIVE'); const bills=new BillingController(db,new BillingService(db,unavailablePayment),unavailablePayment);
 const input={orderId:f.order.id,type:'EXTRA_FEE',amount:5500,dueDate:'2026-11-20',description:'清洁费用',fileIds:[],idempotencyKey:'fee-review-0001'};
 const bill=await bills.createBill(input,admin);assert.equal(bill.status,'DRAFT');assert.equal((await bills.createBill(input,admin)).id,bill.id);
 await assert.rejects(()=>bills.publish(bill.id,admin));await assert.rejects(()=>bills.reviewBill(bill.id,{decision:'APPROVED',note:'核对'},admin));
 const reviewed=await bills.reviewBill(bill.id,{decision:'APPROVED',note:'已核对'}, {admin:{id:'other-finance'}});assert.equal(reviewed.status,'REVIEWED');
 assert.equal((await bills.publish(bill.id,admin)).status,'PENDING');
 await assert.rejects(()=>bills.createBill({...input,amount:5501},admin));
});
test('cancellation refuses outstanding money and only releases its own reservation after safe termination',async()=>{
 const f=await fixture('AWAITING_SIGNATURE');const {OrderActionsController}=await import('../src/orders/order-actions');const actions=new OrderActionsController(db);
 await assert.rejects(()=>actions.cancel(f.order.id,{reason:'客户取消'},admin));
 await db.contract.updateMany({where:{orderId:f.order.id},data:{status:'DRAFT'}});await db.bill.updateMany({where:{orderId:f.order.id},data:{status:'DRAFT',paidAmount:0}});
 const result=await actions.cancel(f.order.id,{reason:'客户取消'},admin);assert.equal(result.status,'CANCELLED');const v=await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}});assert.equal(v.reservedOrderId,null);assert.equal(v.status,'UNPUBLISHED');
 assert.equal(await db.bill.count({where:{orderId:f.order.id,status:{not:'VOID'}}}),0);
 await assert.rejects(()=>workflows.handover({orderId:f.order.id,type:'DELIVERY',actualAt:new Date().toISOString(),readingKm:100,fileIds:[],checklist:[{label:'状态',value:'正常'}]},admin));
});
test('login persists exact current terms/privacy and application rejects a different published legal type',async()=>{
 const suffix=Math.floor(Date.now()/1000);const docs=[];for(const type of ['terms','privacy','application']) docs.push(await db.legalDocument.create({data:{type,version:suffix,title:type,content:'fixture',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}}));
 const identity:any={wechat:async()=>({mobile:`139${String(suffix).slice(-8)}`})};const auth=new AuthController(db,identity);
 await assert.rejects(()=>auth.wechat({loginCode:'test',phoneCode:'test',consents:[]}));
 const login=await auth.wechat({loginCode:'test',phoneCode:'test',consents:docs.slice(0,2).map(d=>({documentId:d.id,version:d.version}))});assert.equal(await db.customerConsent.count({where:{customerId:login.customer.id}}),2);
 const f=await fixture();await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'PUBLISHED',reservedOrderId:null}});
 const input={vehicleId:f.vehicle.id,subscriptionPlanId:f.plan.id,profile:{name:'测试'},idempotencyKey:'wrong-legal-0001',consents:[{documentId:docs[1].id,version:docs[1].version}]};
 await assert.rejects(()=>new ApplicationsController(db).submit(input,{customer:login.customer}));
 const correct=await new ApplicationsController(db).submit({...input,consents:[{documentId:docs[2].id,version:docs[2].version}]},{customer:login.customer});assert.equal(correct.status,'SUBMITTED');
});

test('verified contract and first payments advance order to handover only once both are ready',async()=>{
 const f=await fixture('AWAITING_SIGNATURE');const contract=await db.contract.findFirstOrThrow({where:{orderId:f.order.id}});await db.contract.update({where:{id:contract.id},data:{status:'PENDING',providerTaskId:'task-'+f.order.id}});
 const file=await db.storedFile.create({data:{customerId:f.customer.id,name:'signed.pdf',mimeType:'application/pdf',size:5,sha256:'test',storagePath:'test',purpose:'contract'}});
 await new SignatureService(db).settleContract(contract.id,{status:'SIGNED',documentHash:contract.documentHash,taskId:'task-'+f.order.id,signedFileId:file.id});
 assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'AWAITING_HANDOVER');
});
test('cancellation is blocked while signature creation is in flight and late signing cannot revive cancelled order',async()=>{
 const f=await fixture('AWAITING_SIGNATURE');await db.contract.updateMany({where:{orderId:f.order.id},data:{status:'DRAFT'}});await db.bill.updateMany({where:{orderId:f.order.id},data:{status:'DRAFT',paidAmount:0}});
 const contract=await db.contract.findFirstOrThrow({where:{orderId:f.order.id}});let release:any, started:any;const entered=new Promise(r=>started=r);const pending=new Promise<any>(r=>release=r);
 const gateway:any={create:async()=>{started();return pending;}};const {SignaturesController}=await import('../src/orders/signatures');const {OrderActionsController}=await import('../src/orders/order-actions');
 const signatures=new SignaturesController(db,gateway,new SignatureService(db));const sending=signatures.send(contract.id);await entered;
 await assert.rejects(()=>new OrderActionsController(db).cancel(f.order.id,{reason:'并发取消'},admin));release({taskId:'fake-'+f.order.id,url:'https://test.invalid',status:'PENDING'});await sending;
 await db.contract.update({where:{id:contract.id},data:{status:'EXPIRED'}});await new OrderActionsController(db).cancel(f.order.id,{reason:'已终止签署'},admin);
 await assert.rejects(()=>signatures.send(contract.id));assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'CANCELLED');
});

test('amendment cannot copy another customer private file and does not overwrite pending profile',async()=>{
 const f=await fixture();await db.application.update({where:{id:f.application.id},data:{status:'NEEDS_INFO'}});const other=await fixture();
 const file=await db.storedFile.create({data:{customerId:other.customer.id,name:'identity.png',mimeType:'image/png',size:8,sha256:'private',storagePath:'test',purpose:'identity'}});
 await assert.rejects(()=>new ApplicationsController(db).amend(f.application.id,{profile:{name:'修改',fileIds:[file.id]},idempotencyKey:'private-amend-key'},f.request));assert.deepEqual((await db.application.findUniqueOrThrow({where:{id:f.application.id}})).profile,{name:'原资料'});
});
test('delivery rejects reduced funds after refund and legitimate completion and return maintain odometer ownership',async()=>{
 const f=await fixture();const h=await handover(f);const bill=await db.bill.findFirstOrThrow({where:{orderId:f.order.id}});const payment=await db.payment.create({data:{billId:bill.id,customerId:f.customer.id,amount:10000,status:'SUCCEEDED',idempotencyKey:'refund-delivery'}});await db.refund.create({data:{paymentId:payment.id,customerId:f.customer.id,amount:1,reason:'复核退款',requestedBy:'one',status:'PENDING_APPROVAL'}});
 await assert.rejects(()=>workflows.complete(h.id,admin));assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'AWAITING_HANDOVER');
 await db.refund.updateMany({where:{paymentId:payment.id},data:{status:'REJECTED'}});await workflows.complete(h.id,admin);assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'ACTIVE');
 const returned=await handover(f,'RETURN');await db.handover.update({where:{id:returned.id},data:{readingKm:150}});await workflows.complete(returned.id,admin);const vehicle=await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}});assert.equal(vehicle.mileageKm,150);assert.equal(vehicle.reservedOrderId,null);assert.equal(vehicle.status,'UNPUBLISHED');
});
test('return settlement requires completed return and a successful bill payment also advances order readiness',async()=>{
 const f=await fixture('ACTIVE');const billing=new BillingService(db,unavailablePayment);const bills=new BillingController(db,billing,unavailablePayment);
 await assert.rejects(()=>bills.createBill({orderId:f.order.id,type:'RETURN_SETTLEMENT',amount:100,dueDate:'2026-11-20',description:'还车结算',fileIds:[],idempotencyKey:'return-settle-key'},admin));
 const h=await handover(f,'RETURN');await workflows.complete(h.id,admin);assert.equal((await bills.createBill({orderId:f.order.id,type:'RETURN_SETTLEMENT',amount:100,dueDate:'2026-11-20',description:'还车结算',fileIds:[],idempotencyKey:'return-settle-key'},admin)).status,'DRAFT');
 const g=await fixture('AWAITING_PAYMENT');const bill=await db.bill.findFirstOrThrow({where:{orderId:g.order.id}});await db.bill.update({where:{id:bill.id},data:{status:'PENDING',paidAmount:0}});const payment=await db.payment.create({data:{billId:bill.id,customerId:g.customer.id,amount:bill.amount,idempotencyKey:'advance-bill-key',status:'PENDING'}});await billing.settle(payment.id,{status:'SUCCEEDED',amount:bill.amount,transactionId:'txn-'+payment.id});assert.equal((await db.order.findUniqueOrThrow({where:{id:g.order.id}})).status,'AWAITING_HANDOVER');
});

test('final commercial terms are mandatory, reject placeholders and change the immutable hash',async()=>{
 const f=await fixture();await db.application.update({where:{id:f.application.id},data:{status:'IN_REVIEW'}});const applications=new ApplicationsController(db);
 const credits=new CreditReviewController(db),auth=new AuthController(db,{} as any),docs=[];
 for(const type of ['terms','privacy'])docs.push(await db.legalDocument.findFirstOrThrow({where:{type,status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}}));
 await auth.accept({consents:docs.map(d=>({documentId:d.id,version:d.version}))},f.request);
 const max=await db.legalDocument.aggregate({where:{type:'credit-verification'},_max:{version:true}});
 const creditDoc=await db.legalDocument.create({data:{type:'credit-verification',version:(max._max.version||0)+1,title:'测试授权',content:'合成测试',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
 const c=await credits.consent(f.application.id,{documentId:creditDoc.id,version:creditDoc.version,decision:'ACCEPT',idempotencyKey:'terms-credit-consent'},f.request);
 const verified=await credits.verify(f.application.id,{consentId:c.consent!.id,creditRevision:c.creditRevision,band:'GE750',customerPresented:true,idempotencyKey:'terms-credit-verify'},admin);
 const terms=Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(key=>[key,'测试正式约定：'+key]));
 const input={creditVerificationId:verified.verification!.id,revision:0,monthlyFeeAmount:10000,depositAmount:0,months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自费',benefits:[],conditions:'测试约定',startDate:'2026-11-01',firstDueDate:'2026-11-01'};
 await assert.rejects(()=>applications.finalPlan(f.application.id,input,admin));await assert.rejects(()=>applications.finalPlan(f.application.id,{...input,commercialTerms:{...terms,depositRefundRule:'待确认'}},admin));
 const first=await applications.finalPlan(f.application.id,{...input,commercialTerms:terms},admin);assert.deepEqual(first.finalPlan.commercialTerms,terms);
 const revised=await applications.finalPlan(f.application.id,{...input,revision:1,commercialTerms:{...terms,depositRefundRule:'双方约定七日内结算'}},admin);assert.notEqual(revised.commercialHash,first.commercialHash);
});

test('signed cancellation requires full refund and archived termination, and pending payment cannot release vehicle',async()=>{
 const {OrderActionsController}=await import('../src/orders/order-actions');const actions=new OrderActionsController(db);const f=await fixture('AWAITING_PAYMENT');const bill=await db.bill.findFirstOrThrow({where:{orderId:f.order.id}});
 const payment=await db.payment.create({data:{billId:bill.id,customerId:f.customer.id,amount:bill.amount,status:'PENDING',idempotencyKey:'cancel-pending-key'}});
 await assert.rejects(()=>actions.cancel(f.order.id,{reason:'取消'},admin));await db.payment.update({where:{id:payment.id},data:{status:'SUCCEEDED'}});await db.refund.create({data:{paymentId:payment.id,customerId:f.customer.id,amount:bill.amount,status:'SUCCEEDED',requestedBy:'requester',approvedBy:'reviewer',reason:'取消退款'}});
 await assert.rejects(()=>actions.cancel(f.order.id,{reason:'已退款'},admin));
 const file=await db.storedFile.create({data:{adminId:'completion-operator',name:'双方签署终止协议.pdf',mimeType:'application/pdf',size:20,sha256:'termination',storagePath:'fixture',purpose:'evidence'}});
 assert.equal((await actions.cancel(f.order.id,{reason:'双方协议终止',terminationFileId:file.id},admin)).status,'CANCELLED');assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}})).reservedOrderId,null);
});
