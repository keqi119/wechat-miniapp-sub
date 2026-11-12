import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {captureCustomerProfileSnapshot} from '../src/customers/profile';
import {hash} from '../src/common/data';
import {periods} from '../src/usage/rules';
import {snapshotProduct} from '../src/products/snapshot';
import {snapshotUsagePolicy} from '../src/usage/policy';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {readPreparedRenewalSource} from '../src/order-renewals/source';
import {assertRenewalAgreementQuote} from '../src/order-changes/renewal-agreement';
const errorCode=(code:string)=>(error:any)=>error.getResponse?.().error?.code===code;

// Only old order/risk/delivery facts are seeded. Current qualification, goods,
// insurance, archive lifecycle and payments use real application HTTP. Renewal
// service commands remain deliberately unregistered until rollout integration.
test('renewal finance: true paper, concurrent prepare, original debts and real first receipt schedule without activation',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness(),identityPolicy=process.env.CUSTOMER_IDENTITY_POLICY;
 try{
  process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';
  await h.start();
  const customer=await h.customer('续期财务客户');
  const front=await h.proof(customer,'identity'),back=await h.proof(customer,'identity'),license=await h.proof(customer,'identity');
  const profile=await h.get('/customer/profile',customer);
  await h.post('/customer/profile',{...command(profile.revision),name:'合成纸签客户',drivingYears:5,identityFrontFileId:front.id,identityBackFileId:back.id,drivingLicenseFileId:license.id},customer,'PUT');
  const current=await h.get(`/admin/customers/${customer.id}/qualifications`);
  const qualification=await h.post(`/admin/customers/${customer.id}/qualifications`,{...command(),profileHash:current.profileHash,verificationSource:'MANUAL',identityFileIds:[front.id,back.id],drivingLicenseFileIds:[license.id],identityExpiresAt:'2035-01-01T00:00:00.000Z',drivingLicenseExpiresAt:'2035-01-01T00:00:00.000Z'});
  await h.post(`/admin/customers/${customer.id}/qualifications/reviews`,{...command(qualification.revision),qualificationId:qualification.id,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:''},h.reviewer);
  const customerProfileSnapshot=await h.db.serial(tx=>captureCustomerProfileSnapshot(tx,customer.id,'ORDER_CONFIRMATION'));
  assert.equal(customerProfileSnapshot.version,2);assert.equal(customerProfileSnapshot.identity,null);assert.equal(await h.db.eSignAccount.count({where:{customerId:customer.id}}),0);
  const owner=await h.post('/admin/partners',{profile:{name:'合成纸质出租方',subjectType:'ENTERPRISE'},idempotencyKey:randomUUID()});
  const model=await h.db.modelDefinition.create({data:{brand:'续期合成',name:'真实同车续期-'+h.prefix}});
  const vehicle=await h.db.vehicle.create({data:{modelDefinitionId:model.id,brand:'合成',model:'EV',title:'同车续期测试车辆',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,status:'UNPUBLISHED'}});
  // Publish the renewal catalog source before this car becomes occupied by the historical order.
  const productDraft=await h.post('/admin/products',{configurationVersion:2,name:'同车续期产品',months:12,minimumTermMonths:12,baseFeeAmount:18000,mileageMonthlyFeeAmount:2000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:3,extraFeeAmount:55000},conditions:'合成续期明确条件',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],...command()});
  const product=await h.post(`/admin/products/${productDraft.productId}/publish`,{...command(productDraft.revision),versionId:productDraft.id});
  const renewalPlan=await h.publishGoods(vehicle.id,product.id),productSource=await h.db.serial(tx=>snapshotProduct(tx,renewalPlan.id));
  const plan=await h.db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成原十二期',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'仅合成测试'}});
  const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],status:'FINAL_PLAN_CONFIRMED',idempotencyKey:randomUUID(),requestHash:hash('synthetic-application')}});
  const originalHash=hash({applicationId:application.id,fixture:'offline-delay'}),riskId=randomUUID(),planId=randomUUID();
  const risk=await h.db.applicationRiskReview.create({data:{id:riskId,applicationId:application.id,customerId:customer.id,revision:1,applicationRevision:application.revision,profileHash:current.profileHash,applicationProfileHash:hash({}),qualificationId:qualification.id,qualificationRevision:qualification.revision,finalPlanId:planId,planRevision:1,commercialHash:originalHash,planInputHash:hash('synthetic-plan'),vehicleId:vehicle.id,vehicleInputHash:hash('synthetic-vehicle'),creditConsentId:randomUUID(),creditConsentRevision:1,creditConsentVersion:1,creditVerificationId:randomUUID(),creditVerificationRevision:1,creditRevision:1,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reviewedBy:h.reviewer.id,idempotencyKey:randomUUID(),requestHash:hash('synthetic-approved-risk')}});
  const usagePolicy=await h.db.serial(tx=>snapshotUsagePolicy(tx));
  const snapshot:any={commercialHash:originalHash,startDate:'2026-10-01',firstDueDate:'2026-10-01',months:12,monthlyFeeAmount:10000,depositAmount:50000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V1',usagePolicy,customerProfileSnapshot,commercialTerms:{vehicleIdentification:`合成车辆 ${vehicle.vin}`,customerAddress:'合成原签约地址'},lessorSnapshot:{ownerId:owner.id,vehicleId:vehicle.id,executionMode:'OFFLINE',name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode??null,platformLegalEntityName:'上海宁达信息科技有限公司'},partiesSnapshot:[{role:'CUSTOMER',partyId:customer.id,name:customerProfileSnapshot.name,subjectType:'INDIVIDUAL',identityNumber:'110101199001010000',phone:'13800000000'},{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:'ENTERPRISE',creditCode:'9131000SYNTHETIC01'},{role:'PLATFORM',partyId:'上海宁达信息科技有限公司',name:'上海宁达信息科技有限公司',subjectType:'ENTERPRISE',creditCode:'9131000SYNTHETIC02'}],riskSnapshot:{reviewId:risk.id,applicationId:application.id,customerId:customer.id,planId,planRevision:1,commercialHash:originalHash,qualificationId:qualification.id,qualificationRevision:qualification.revision}};
  const order=await h.db.order.create({data:{customerId:customer.id,applicationId:application.id,vehicleId:vehicle.id,contractMode:'OFFLINE',status:'AWAITING_CONTRACT_REVIEW',confirmedMileageKm:100,finalPlanSnapshot:snapshot}});
  const original=await h.db.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'OFFLINE',status:'DRAFT',documentHash:originalHash,documentId:'legacy-template-index',templateVersion:99}});
  // Preserve genuinely unpaid old monthly bills and a nonzero original deposit.
  // These are existing obligations, not invented receipts; payment below uses BillingService.
  for(const p of periods(snapshot.startDate,snapshot.months))await h.db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:p.sequence,amount:10000,paidAmount:0,status:'PENDING',dueDate:p.startDate}});
  const deposit=await h.db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'DEPOSIT',sequence:1,amount:50000,paidAmount:0,status:'PENDING',dueDate:new Date('2026-10-01')}});
  const rental=await h.archive('RENTAL','ORDER',order.id);assert.equal((await h.db.contract.findUniqueOrThrow({where:{id:original.id}})).offlineArchiveId,rental.archiveId);
  assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,true,'real archived rental is authoritative despite legacy template index');
  // Trusted previous actual handover/usage facts are not a new delivery operation.
  const deliveredAt=new Date('2026-10-01T00:00:00+08:00');
  const assignment=await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,startAt:deliveredAt,startReadingKm:100}});
  const handover=await h.db.handover.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,assignmentId:assignment.id,type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',readingKm:100,actualAt:deliveredAt,completedAt:deliveredAt,fileIds:[],checklist:{syntheticHistoricalFact:true},manifestHash:hash('historical-offline-delivery')}});
  await h.db.vehicleAssignment.update({where:{id:assignment.id},data:{deliveryHandoverId:handover.id}});
  await h.db.order.update({where:{id:order.id},data:{status:'ACTIVE',currentAssignmentId:assignment.id}});
  await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'IN_USE',reservedOrderId:order.id}});
  const account=await h.db.usageAccount.create({data:{orderId:order.id,customerId:customer.id,policyVersion:'USAGE_V1',startedOn:new Date('2026-10-01')}});
  for(const p of periods(snapshot.startDate,snapshot.months))await h.db.usagePeriod.create({data:{accountId:account.id,orderId:order.id,sequence:p.sequence,startDate:p.startDate,endDate:p.endDate,effectiveEndDate:p.endDate,startReadingKm:p.sequence===1?100:null}});
  const proof=await h.proof(h.maker,'contract');
  await h.post(`/admin/partners/${owner.id}/agreements`,{...command(),status:'ACTIVE',title:'同车完整续期合作范围',fileIds:[proof.id],partnerRateBps:8000,vehicleIds:[vehicle.id],validFrom:'2026-01-01',validUntil:'2035-12-31'});
  // Actual model insurance independently covers the current vehicle and future renewal start.
  const policyInput={...command(),insurer:'本地合成保险',policyNumber:randomUUID(),policyholder:owner.name,insuredParty:owner.name,vehicleIds:[vehicle.id],coverageItems:[{code:'SYNTHETIC_COVER',label:'合成保障',amount:10000,deductible:'合成免赔',terms:'合成保障条款'}],terms:'仅本地测试',startAt:'2026-01-01',endAt:'2035-12-31',effectiveAt:'2026-01-01',fileIds:[],requirementVersionIds:[]};
  let policy=await h.post('/admin/insurance-policies',policyInput);
  const policyProof=await h.post(`/admin/insurance-policies/${policy.id}/files`,h.form({revision:policy.revision,idempotencyKey:randomUUID(),vehicleIds:[vehicle.id]},'insurance'));
  policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}`,{...policyInput,...command(policy.versions[0].revision),fileIds:[policyProof.id]},h.maker,'PATCH');
  policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/submit`,command(policy.versions[0].revision));
  await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/review`,{...command(policy.versions[0].revision),decision:'APPROVED',checks:[{vehicleId:vehicle.id,fileId:policyProof.id,confirmed:true,note:'独立核对'}],reason:'真实合成保障'},h.reviewer);
  for(const [type,content] of [['usage-policy-v2','每月 {{baseAllowanceKm}} 公里，超额每公里 {{excessPriceYuan}} 元，严格按实际服务月结算。'],['OFFLINE_ORDER_AMENDMENT','仅本地合成，不用于真实交易。原合同编号 {{originalContractNo}}。\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}']]){
   const max=await h.db.legalDocument.aggregate({where:{type},_max:{version:true}});
   h.docs[type]=await h.db.legalDocument.create({data:{type,version:(max._max.version||0)+1,title:'本地续期 '+type,content,status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  }
  const ops=await h.db.adminUser.findUniqueOrThrow({where:{id:h.maker.id}}),finance=await h.db.adminUser.findUniqueOrThrow({where:{id:h.finance.id}}),service=new OrderRenewalsService(h.db,()=>new Date('2026-10-31T04:00:00Z'));
  const input=async()=>({listingId:productSource.listingId,listingRevision:productSource.listingRevision,productVersionId:productSource.productVersionId,listingSourceHash:productSource.sourceHash,orderRevision:(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,accountRevision:(await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}})).revision,reason:'客户明确继续原车十二个月',expiresAt:'2027-09-30T12:00:00+08:00',settlementExplanation:'原押金不变，新租期各月按冻结新价支付，未到期旧月不提前计债',cancellationTerms:'按本次签字协议及原退订约定处理'});
  const before=await input(),preview=await service.preview(order.id,before,ops);
  assert.equal(await h.db.orderServiceStage.count({where:{orderId:order.id}}),0,'read preview never silently creates an INITIAL stage');
  assert.equal(preview.startDate,'2027-10-01');assert.equal(preview.monthlyFeeAmount,20000);assert.equal(preview.depositAmount,50000);
  const created=await service.create(order.id,{...before,previewHash:preview.previewHash,idempotencyKey:randomUUID()},ops);
  assert.equal(await h.db.orderServiceStage.count({where:{orderId:order.id,kind:'INITIAL',status:'ACTIVE'}}),1);
  const next=await input(),quotePreview=await service.preview(order.id,next,ops,created.id);
  let receipt=await service.act(created.id,'quotes',{...next,revision:created.revision,previewHash:quotePreview.previewHash,idempotencyKey:randomUUID()},ops);
  receipt=await service.act(created.id,'review',{...command(receipt.revision),decision:'APPROVED',note:'另一财务人员核实原押金与十二期冻结金额'},finance);
  receipt=await service.act(created.id,'publish',command(receipt.revision),ops);
  const quote=await h.db.delayQuote.findUniqueOrThrow({where:{id:receipt.quoteId!}}),q=quote.snapshot as any;
  assert.equal(q.renewalTerms.quoteId,undefined);assert.deepEqual(q.renewalTerms.currentVehicleProductSnapshot,q.product);
  await service.customerAct(created.id,'confirm',{...command(receipt.revision),quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,bodyHash:q.document.bodyHash,lessorHash:q.source.lessorHash,noticeHash:q.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingAccepted:true},customer.id);
  assertRenewalAgreementQuote(await h.db.orderChange.findUniqueOrThrow({where:{id:created.id}}),await h.db.delayQuote.findUniqueOrThrow({where:{id:quote.id}}),await h.db.contract.findUniqueOrThrow({where:{delayQuoteId:quote.id}}),await h.db.order.findUniqueOrThrow({where:{id:order.id}}));
  const amendment=await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',quote.id);
  assert.equal((await h.db.orderChange.findUniqueOrThrow({where:{id:created.id}})).status,'AWAITING_FINANCE');
  // A confirmed frozen product remains a valid source if the catalogue later withdraws it.
  const listing=await h.get(`/admin/goods/${productSource.listingId}`);await h.post(`/admin/goods/${listing.id}/withdraw`,command(listing.revision));
  const oldBills=await h.db.bill.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),oldUsage=await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),oldAccount=await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}}),oldAssignment=await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:assignment.id}});
  const p=await service.financePreview(created.id,finance),prepare={...command(p.revision),orderRevision:p.orderRevision,accountRevision:p.accountRevision,previewHash:p.previewHash};
  const prepared=await Promise.all([service.prepare(created.id,prepare,finance),service.prepare(created.id,prepare,finance)]);
  assert.deepEqual(prepared[1],prepared[0]);const stageId=prepared[0].stageId;
  assert.equal(await h.db.orderServiceStage.count({where:{changeId:created.id}}),1);
  const newBills=await h.db.bill.findMany({where:{serviceStageId:stageId},orderBy:{sequence:'asc'}}),obligations=await h.db.serviceObligation.findMany({where:{serviceStageId:stageId},orderBy:{stageSequence:'asc'}});
  assert.equal(newBills.length,12);assert.deepEqual(newBills.map(b=>b.sequence),Array.from({length:12},(_,i)=>i+13));assert(newBills.every(b=>b.amount===20000&&b.status==='PENDING'));
  assert.equal(obligations.length,12);assert(obligations.every((o,i)=>!o.active&&o.stageSequence===i+1&&o.chargeBillId===newBills[i].id&&o.chargeAmount===o.amount&&o.sourceBillIds.length===0));
  const frozen=await h.db.serial(tx=>readPreparedRenewalSource(tx,stageId));assert.equal(frozen.agreement.archiveVersionId,amendment.versionId);assert.deepEqual(frozen.snapshot.termsSnapshot,q.renewalTerms);
  assert.deepEqual(await h.db.bill.findMany({where:{id:{in:oldBills.map(b=>b.id)}},orderBy:{id:'asc'}}),oldBills);
  assert.deepEqual(await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}}),oldAccount);
  const scheduleInput=(v:any)=>({...command(v.revision),orderRevision:v.orderRevision,accountRevision:v.accountRevision,stageId:v.stageId,stageRevision:v.stageRevision,previewHash:v.previewHash});
  let funding=await service.schedulePreview(created.id,finance);assert.equal(funding.ready,false);assert(funding.blockers.includes('RENEWAL_DEPOSIT_REQUIRED'));assert(funding.blockers.includes('RENEWAL_PRIOR_DUE_REQUIRED'));
  await assert.rejects(service.schedule(created.id,scheduleInput(funding),finance),errorCode('RENEWAL_FUNDS_UNRESOLVED'));
  const pay=async(billId:string)=>{const request=await h.post(`/customer/bills/${billId}/pay`,{idempotencyKey:randomUUID()},customer);h.payment.capture(request.paymentId);await h.post(`/admin/payments/${request.paymentId}/sync`,{},h.finance);const result=await h.db.payment.findUniqueOrThrow({where:{id:request.paymentId}});assert.equal(result.status,'SUCCEEDED');assert.equal(result.reconciliationRequired,false);return result;};
  await h.reject(`/customer/bills/${newBills[1].id}/pay`,{idempotencyKey:randomUUID()},customer,'RENEWAL_FUTURE_BILL');
  const firstPaid=await pay(newBills[0].id);
  assert.equal(await h.db.paymentAllocation.count({where:{paymentId:firstPaid.id,obligationId:obligations[0].id,amount:20000,releasedAt:null}}),1,'real BillingService.settle creates exactly the first own-stage allocation');
  funding=await service.schedulePreview(created.id,finance);assert.equal(funding.ready,false,'first new receipt cannot replace old deposit or due rent');
  await pay(deposit.id);funding=await service.schedulePreview(created.id,finance);assert.equal(funding.ready,false);assert(funding.blockers.includes('RENEWAL_PRIOR_DUE_REQUIRED'));
  const oldDue=oldBills.find(b=>b.type==='SUBSCRIPTION'&&b.sequence===1)!;await pay(oldDue.id);
  funding=await service.schedulePreview(created.id,finance);assert.equal(funding.ready,true,JSON.stringify(funding.blockers));assert.equal(newBills.length,12);
  assert.equal(await h.db.bill.count({where:{orderId:order.id,type:'SUBSCRIPTION',status:'PENDING'}}),22,'ordinary future old and new months are not immediate debts');
  const scheduledInput=scheduleInput(funding),scheduled=await service.schedule(created.id,scheduledInput,finance);assert.equal(scheduled.status,'SCHEDULED');
  const businessRevision=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision;
  assert.deepEqual(await service.schedule(created.id,scheduledInput,finance),scheduled);assert.deepEqual(await service.prepare(created.id,prepare,finance),prepared[0]);
  assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,businessRevision,'successful command replay does not increment business revision');
  await h.db.adminUser.update({where:{id:finance.id},data:{authVersion:{increment:1}}});
  await assert.rejects(service.prepare(created.id,prepare,finance),errorCode('STAFF_SESSION_CHANGED'));await assert.rejects(service.schedule(created.id,scheduledInput,finance),errorCode('STAFF_SESSION_CHANGED'));
  assert.equal((await h.db.orderServiceStage.findUniqueOrThrow({where:{id:stageId}})).status,'SCHEDULED');
  assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).effectiveTermsVersionId,null);assert.deepEqual((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,snapshot);
  assert.equal(await h.db.orderTermsVersion.count({where:{orderId:order.id}}),0);assert.equal(await h.db.swapCredit.count({where:{orderId:order.id}}),0);assert.equal(await h.db.swapLedger.count({where:{orderId:order.id}}),0);
  assert.deepEqual(await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),oldUsage);assert.deepEqual(await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:assignment.id}}),oldAssignment);
  assert.equal(await h.db.serviceObligation.count({where:{serviceStageId:stageId,active:true}}),0);
  const contract=await h.db.contract.findUniqueOrThrow({where:{delayQuoteId:quote.id}});assert.equal(contract.status,'DRAFT');assert.equal(contract.providerTaskId,null);assert.equal(contract.signedFileId,null);
  assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.realSmsSends,0);assert.equal(h.preparedPdfs,2);
 }finally{await h.close();if(identityPolicy===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=identityPolicy;}
});
