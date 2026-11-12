import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {captureCustomerProfileSnapshot} from '../src/customers/profile';
import {hash} from '../src/common/data';
import {periods} from '../src/usage/rules';
import {snapshotProduct} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {deliveryBusinessReady} from '../src/orders/business-gates';
import {readCurrentOfflineVehicleSource} from '../src/vehicle-changes/offline-effective';

// Existing order, approved risk and settled historical money are synthetic facts.
// Qualification, rental archive, product/goods and new quote commands use real HTTP.
// The create rollout gate intentionally stays closed: existing changes are seeded.
test('OFFLINE physical swap HTTP: real FIELD facts, current paper amendment, online confirmation and exact tasks and original term entitlement', {skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness(),identityPolicy=process.env.CUSTOMER_IDENTITY_POLICY;
 try{
  process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';
  await h.start();
  const customer=await h.customer('纸质延期客户'),outsider=await h.customer('无关客户');
  const front=await h.proof(customer,'identity'),back=await h.proof(customer,'identity'),license=await h.proof(customer,'identity');
  const profile=await h.get('/customer/profile',customer);
  await h.post('/customer/profile',{...command(profile.revision),name:'合成纸签客户',drivingYears:5,identityFrontFileId:front.id,identityBackFileId:back.id,drivingLicenseFileId:license.id},customer,'PUT');
  const current=await h.get(`/admin/customers/${customer.id}/qualifications`);
  const qualification=await h.post(`/admin/customers/${customer.id}/qualifications`,{...command(),profileHash:current.profileHash,verificationSource:'MANUAL',identityFileIds:[front.id,back.id],drivingLicenseFileIds:[license.id],identityExpiresAt:'2035-01-01T00:00:00.000Z',drivingLicenseExpiresAt:'2035-01-01T00:00:00.000Z'});
  await h.post(`/admin/customers/${customer.id}/qualifications/reviews`,{...command(qualification.revision),qualificationId:qualification.id,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:''},h.reviewer);
  const customerProfileSnapshot=await h.db.serial(tx=>captureCustomerProfileSnapshot(tx,customer.id,'ORDER_CONFIRMATION'));
  assert.equal(customerProfileSnapshot.version,2);assert.equal(customerProfileSnapshot.identity,null);assert.equal(await h.db.eSignAccount.count({where:{customerId:customer.id}}),0);
  const owner=await h.post('/admin/partners',{profile:{name:'合成纸质出租方',subjectType:'ENTERPRISE'},idempotencyKey:randomUUID()});
  const vehicle=await h.db.vehicle.create({data:{brand:'合成',model:'EV',title:'线下延期测试车辆',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,status:'RESERVED'}});
  const plan=await h.db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成原十二期',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:0,excessMileagePriceAmount:100,energyDescription:'自付',benefits:[],conditions:'仅合成测试'}});
  const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],status:'FINAL_PLAN_CONFIRMED',idempotencyKey:randomUUID(),requestHash:hash('synthetic-application')}});
  const originalHash=hash({applicationId:application.id,fixture:'offline-delay'}),riskId=randomUUID(),planId=randomUUID();
  const risk=await h.db.applicationRiskReview.create({data:{id:riskId,applicationId:application.id,customerId:customer.id,revision:1,applicationRevision:application.revision,profileHash:current.profileHash,applicationProfileHash:hash({}),qualificationId:qualification.id,qualificationRevision:qualification.revision,finalPlanId:planId,planRevision:1,commercialHash:originalHash,planInputHash:hash('synthetic-plan'),vehicleId:vehicle.id,vehicleInputHash:hash('synthetic-vehicle'),creditConsentId:randomUUID(),creditConsentRevision:1,creditConsentVersion:1,creditVerificationId:randomUUID(),creditVerificationRevision:1,creditRevision:1,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reviewedBy:h.reviewer.id,idempotencyKey:randomUUID(),requestHash:hash('synthetic-approved-risk')}});
  const snapshot:any={productSnapshot:{configurationVersion:2,productId:'synthetic-original-product',productVersionId:'synthetic-original-version',version:2,swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}},commercialHash:originalHash,startDate:'2026-10-01',firstDueDate:'2026-10-01',months:12,monthlyFeeAmount:10000,depositAmount:0,customerProfileSnapshot,commercialTerms:{vehicleIdentification:`合成车辆 ${vehicle.vin}`,customerAddress:'合成原签约地址'},lessorSnapshot:{ownerId:owner.id,vehicleId:vehicle.id,executionMode:'OFFLINE',name:owner.name,subjectType:'ENTERPRISE',creditCode:owner.creditCode??null,platformLegalEntityName:'合成平台'},partiesSnapshot:[{role:'CUSTOMER',partyId:customer.id,name:customerProfileSnapshot.name,subjectType:'INDIVIDUAL',identityNumber:'110101199001010000',phone:'13800000000'},{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:'ENTERPRISE',creditCode:'9131000SYNTHETIC01'},{role:'PLATFORM',partyId:'合成平台',name:'合成平台',subjectType:'ENTERPRISE',creditCode:'9131000SYNTHETIC02'}],riskSnapshot:{reviewId:risk.id,applicationId:application.id,customerId:customer.id,planId,planRevision:1,commercialHash:originalHash,qualificationId:qualification.id,qualificationRevision:qualification.revision}};
  const order=await h.db.order.create({data:{customerId:customer.id,applicationId:application.id,vehicleId:vehicle.id,contractMode:'OFFLINE',status:'AWAITING_CONTRACT_REVIEW',confirmedMileageKm:100,finalPlanSnapshot:snapshot}});
  const original=await h.db.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'OFFLINE',status:'DRAFT',documentHash:originalHash,documentId:'legacy-template-index',templateVersion:99}});
  for(const p of periods(snapshot.startDate,snapshot.months)){
   const bill=await h.db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:p.sequence,amount:10000,paidAmount:10000,status:'PAID',dueDate:p.startDate}});
   await h.db.payment.create({data:{customerId:customer.id,billId:bill.id,status:'SUCCEEDED',amount:10000,idempotencyKey:randomUUID(),providerTransactionId:`synthetic-settled-${randomUUID()}`}});
  }
  for(const paid of await h.db.payment.findMany({where:{customerId:customer.id,status:'SUCCEEDED'}}))h.payment.payments.set(paid.id,{status:'SUCCEEDED',amount:paid.amount,transactionId:paid.providerTransactionId});
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
  const model=await h.db.modelDefinition.create({data:{brand:'合成',name:'换入车真实车型'}});
  const target=await h.db.vehicle.create({data:{brand:'合成',model:'EV',title:'明确商品换入车',modelDefinitionId:model.id,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:200,status:'PUBLISHED'}});
  const proof=await h.proof(h.maker,'contract');
  const agreement=await h.db.partnerAgreement.create({data:{ownerId:owner.id,status:'ACTIVE',createdBy:h.maker.id}});
  const agreementVersion=await h.db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId:owner.id,version:1,status:'ACTIVE',title:'仅覆盖新车剩余服务期',fileIds:[proof.id],vehicleIds:[target.id],partnerRateBps:8000,validFrom:'2026-10-30',validUntil:'2027-09-30',contentHash:hash('synthetic-target-cooperation'),createdBy:h.maker.id}});
  await h.db.partnerAgreement.update({where:{id:agreement.id},data:{currentVersionId:agreementVersion.id}});
  await h.db.partnerAgreementVehicle.create({data:{vehicleId:target.id,ownerId:owner.id,agreementId:agreement.id,agreementVersionId:agreementVersion.id,assignedBy:h.maker.id}});
  const productDraft=await h.post('/admin/products',{configurationVersion:2,name:'换入产品',months:12,minimumTermMonths:3,baseFeeAmount:18000,mileageMonthlyFeeAmount:2000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:99,extraFeeAmount:99000},conditions:'合成升级条件',vehicleIds:[target.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],...command()});
  const product=await h.post(`/admin/products/${productDraft.productId}/publish`,{...command(productDraft.revision),versionId:productDraft.id});
  const targetPlan=await h.publishGoods(target.id,product.id),source=await h.db.serial(tx=>snapshotProduct(tx,targetPlan.id));

  // Current insurance is independent of the original product and only covers the target model.
  const policyInput={...command(),insurer:'本地合成保险',policyNumber:randomUUID(),policyholder:owner.name,insuredParty:owner.name,vehicleIds:[target.id],coverageItems:[{code:'SYNTHETIC_COVER',label:'合成保障',amount:10000,deductible:'合成免赔',terms:'合成保障条款'}],terms:'仅本地测试',startAt:'2026-01-01',endAt:'2035-12-31',effectiveAt:'2026-01-01',fileIds:[],requirementVersionIds:[]};
  let policy=await h.post('/admin/insurance-policies',policyInput);
  const policyProof=await h.post(`/admin/insurance-policies/${policy.id}/files`,h.form({revision:policy.revision,idempotencyKey:randomUUID(),vehicleIds:[target.id]},'insurance'));
  policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}`,{...policyInput,...command(policy.versions[0].revision),fileIds:[policyProof.id]},h.maker,'PATCH');
  policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/submit`,command(policy.versions[0].revision));
  await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/review`,{...command(policy.versions[0].revision),decision:'APPROVED',checks:[{vehicleId:target.id,fileId:policyProof.id,confirmed:true,note:'独立核对'}],reason:'真实合成保障'},h.reviewer);
  const frozenPrior=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot!;
  const change=await h.db.orderChange.create({data:{orderId:order.id,customerId:customer.id,kind:'VEHICLE_CHANGE',priorTermsHash:hash(frozenPrior),priorTerms:frozenPrior,originalContractId:original.id,originalArchiveVersionId:rental.versionId,reason:'仅隔离本地已有换车',createdBy:h.maker.id,idempotencyKey:randomUUID(),requestHash:hash('existing-physical-swap')}});
  const path=`/admin/order-changes/${change.id}`,input={...command(change.revision),pricingVersion:2,targetListingId:source.listingId,targetListingRevision:source.listingRevision,targetSourceHash:source.sourceHash,plannedReturnAt:'2026-10-30T09:00:00+08:00',plannedDeliveryAt:'2026-10-30T10:00:00+08:00',depositAmount:0,depositBasis:'保持原押金',insuranceResponsibility:'真实新车保障责任',downtimeArrangement:'当天安排',settlementExplanation:'升级差价按服务月实际天数',handoverArrangement:'客户核对两侧实际查验',cancellationTerms:'沿用原约定',reason:'客户升级',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};
  let view=await h.post(path+'/quotes',input);const quoteId=view.quote.id;
  assert.equal(view.quote.periods[0].amount,10645);assert.equal(view.quote.pricingHash,canonicalHash(view.quote.pricing));
  assert.deepEqual(view.quote.targetLessorSnapshot.leaseRange,{startDate:'2026-10-30',endDate:'2027-09-30'});
  const max=await h.db.legalDocument.aggregate({where:{type:'OFFLINE_ORDER_AMENDMENT'},_max:{version:true}});
  h.docs.OFFLINE_ORDER_AMENDMENT=await h.db.legalDocument.create({data:{type:'OFFLINE_ORDER_AMENDMENT',version:(max._max.version||0)+1,title:'合成共同补充协议',content:'仅本地测试。原合同编号 {{originalContractNo}}。{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  view=await h.post(path+'/review',{...command(view.revision),decision:'APPROVED',note:'核对实际服务日差额'},h.finance);
  view=await h.post(path+'/publish',command(view.revision));assert.equal(view.contract.status,'DRAFT');
  view=await h.post('/customer/order-changes/'+change.id+'/confirm',{...command(view.revision),commercialHash:view.quote.commercialHash},customer);
  const amendment=await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',quoteId);view=await h.get(path);
  await h.post(path+'/prepare-finance',command(view.revision),h.finance);
  const obligation=await h.db.serviceObligation.findUniqueOrThrow({where:{quoteId_sequence:{quoteId,sequence:1}}});assert.ok(obligation.chargeBillId);assert.equal(obligation.chargeAmount,645);
  const payment=await h.post(`/customer/bills/${obligation.chargeBillId}/pay`,{idempotencyKey:randomUUID()},customer);h.payment.capture(payment.paymentId);await h.post(`/admin/payments/${payment.paymentId}/sync`,{},h.finance);
  view=await h.get(path);assert.deepEqual(view.finance.blockers,[]);assert.equal(view.canCreateReturn,true);
  const originalSnapshot=structuredClone(frozenPrior),accountBefore=await h.db.usageAccount.findUniqueOrThrow({where:{orderId:order.id}});
  const periodBefore=await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
  // Existing actual assignment segments are trusted history; every new fact goes through FIELD HTTP.
  for(const p of periodBefore)await h.db.usageSegment.create({data:{periodId:p.id,assignmentId:assignment.id,vehicleId:vehicle.id,startAt:new Date(p.startDate.getTime()-8*3600000),startReadingKm:p.sequence===1?100:null}});
  const makeTask=async(side:'RETURN'|'DELIVERY',actualAt:string,readingKm:number)=>{
   let task=await h.post('/admin/handover-tasks',{orderId:order.id,changeId:change.id,type:'SWAP_'+side,assigneeId:h.field.id,note:'真实合成换车现场'});
   await h.reject('/admin/handover-tasks',{orderId:order.id,changeId:change.id,type:'SWAP_'+side,assigneeId:h.field.id,note:'重复任务'},h.maker,'TASK_EXISTS');
   const uploaded=await h.post(`/admin/field-tasks/${task.id}/files`,h.form({version:task.version},'swap-'+side,true),h.field);task=uploaded.task;
   const draft={actualAt,readingKm,batteryPercent:80,place:'合成本地查验车位',accessories:'钥匙齐全',condition:'现场真实查验',openItems:'无',resolutionPlan:'无',fileIds:[uploaded.id]};
   task=await h.post(`/admin/field-tasks/${task.id}/draft`,{version:task.version,draft},h.field);
   const publishInput={version:task.version,idempotencyKey:randomUUID(),checked:true};task=await h.post(`/admin/field-tasks/${task.id}/publish`,publishInput,h.field);
   assert.equal((await h.post(`/admin/field-tasks/${task.id}/publish`,publishInput,h.field)).handover.id,task.handover.id);assert.equal(task.status,'ASSIGNED');
   let fact=await h.get('/customer/handovers/'+task.handover.id,customer);
   if(side==='RETURN'){
    await h.post('/customer/handovers/'+fact.id+'/object',{revision:fact.revision,manifestHash:fact.manifestHash,readFileIds:fact.fileIds,fileIds:[],reason:'现场电量说明需要更正',idempotencyKey:randomUUID()},customer);
    const previousId=fact.id,previousRevision=fact.revision;task=await h.get(`/admin/field-tasks/${task.id}`,h.field);
    task=await h.post(`/admin/field-tasks/${task.id}/draft`,{version:task.version,draft:{...draft,batteryPercent:75,resolutionNote:'按仪表重新核实电量'}},h.field);
    task=await h.post(`/admin/field-tasks/${task.id}/publish`,{version:task.version,idempotencyKey:randomUUID(),checked:true},h.field);
    fact=await h.get('/customer/handovers/'+task.handover.id,customer);assert.equal(fact.previousHandoverId,previousId);assert.equal(fact.revision,previousRevision+1);assert.equal((await h.db.handover.findUniqueOrThrow({where:{id:previousId}})).status,'SUPERSEDED');
   }
   assert.equal(fact.confirmationMode,'ONLINE_RECORD');
   await h.reject('/admin/handovers/'+fact.id+'/complete',command(fact.revision),h.maker,'HANDOVER_NOT_READY');
   for(const fileId of fact.fileIds)await h.get('/customer/files/'+fileId,customer);
   await h.post('/customer/handovers/'+fact.id+'/confirm',{revision:fact.revision,manifestHash:fact.manifestHash,readFileIds:fact.fileIds,fileIds:[],reason:'',documentId:fact.onlineRecord.documentId,termsVersion:fact.onlineRecord.termsVersion,termsHash:fact.onlineRecord.termsHash,termsAccepted:true,idempotencyKey:randomUUID()},customer);
   assert.equal(await h.db.documentArchive.count({where:{handoverId:fact.id}}),0);
   return{task,fact};
  };
  const returned=await makeTask('RETURN',input.plannedReturnAt,300),returnCommand=command(returned.fact.revision);
  assert.equal((await h.get(path)).returnHandover.canComplete,true);
  await Promise.all([h.post(`/admin/handovers/${returned.fact.id}/complete`,returnCommand),h.post(`/admin/handovers/${returned.fact.id}/complete`,returnCommand)]);
  const oldAssignment=await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:assignment.id}});assert.equal(oldAssignment.status,'CLOSED');assert.equal(oldAssignment.returnHandoverId,returned.fact.id);
  assert.equal((await h.db.fieldHandoverTask.findUniqueOrThrow({where:{id:returned.task.id}})).status,'COMPLETED');
  assert.equal((await h.db.usageAccount.findUniqueOrThrow({where:{orderId:order.id}})).returnedOn,null);assert.equal(await h.db.vehicleReceiptEvent.count({where:{orderId:order.id}}),0,'swap return never stops the original lease');
  const incoming=await makeTask('DELIVERY',input.plannedDeliveryAt,250),deliveryCommand=command(incoming.fact.revision);
  assert.equal((await h.get(path)).canComplete,true);
  const completes=await Promise.all([h.post(`/admin/handovers/${incoming.fact.id}/complete`,deliveryCommand),h.post(`/admin/handovers/${incoming.fact.id}/complete`,deliveryCommand)]);assert.equal(completes[0].id,completes[1].id);
  const final=await h.db.order.findUniqueOrThrow({where:{id:order.id}}),newAssignment=await h.db.vehicleAssignment.findUniqueOrThrow({where:{id:final.currentAssignmentId!}}),newHandover=await h.db.handover.findUniqueOrThrow({where:{id:incoming.fact.id}}),task=await h.db.fieldHandoverTask.findUniqueOrThrow({where:{id:incoming.task.id}}),terms=await h.db.orderTermsVersion.findUniqueOrThrow({where:{id:final.effectiveTermsVersionId!}});
  assert.equal(newAssignment.vehicleId,target.id);assert.equal(newAssignment.changeId,change.id);assert.equal(newAssignment.deliveryHandoverId,incoming.fact.id);assert.equal(newHandover.assignmentId,newAssignment.id);assert.equal(newHandover.signatureStatus,'DRAFT');assert.equal(task.status,'COMPLETED');assert.equal(task.currentHandoverId,incoming.fact.id);assert.equal(task.vehicleAssignmentId,newAssignment.id);assert.equal(terms.offlineArchiveVersionId,amendment.versionId);
  assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'CONSUME'}}),1);assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'GRANT'}}),1);assert.equal(await h.db.swapCredit.count({where:{orderId:order.id,consumedChangeId:change.id}}),1);
  const rights=await h.get(`/customer/orders/${order.id}/swap-account`,customer);assert.equal(rights.term.includedCount,2);assert.equal(rights.term.remaining,1,'original TERM 2 minus one, never target product 99');
  assert.deepEqual(final.finalPlanSnapshot,originalSnapshot);assert.deepEqual((terms.snapshot as any).productSnapshot,(originalSnapshot as any).productSnapshot);assert.equal((terms.snapshot as any).vehicleId,target.id);assert.equal((terms.snapshot as any).lessorSnapshot.vehicleId,target.id);assert.equal((terms.snapshot as any).currentVehicleProductSnapshot.productVersionId,product.id);
  assert.deepEqual((await h.db.usageAccount.findUniqueOrThrow({where:{orderId:order.id}})).startedOn,accountBefore.startedOn);assert.equal(await h.db.usagePeriod.count({where:{orderId:order.id}}),periodBefore.length);
  assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,true);assert.equal((await readCurrentOfflineVehicleSource(h.db,final,terms)).product.productVersionId,product.id);assert.equal((await deliveryBusinessReady(h.db,order.id,new Date(input.plannedDeliveryAt))).ready,true);
  const applied=await h.get(path);assert.equal(applied.status,'APPLIED');assert.deepEqual(applied.finance.blockers,[]);assert.equal(applied.canComplete,false);assert.equal(applied.canCreateReturn,false);
  assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.externalCalls,0);assert(h.payment.providerCalls>0);
 }finally{try{await h.close();}finally{if(identityPolicy===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=identityPolicy;}}
});
