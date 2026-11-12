import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {captureCustomerProfileSnapshot} from '../src/customers/profile';
import {hash} from '../src/common/data';
import {periods,day} from '../src/usage/rules';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';

// Existing order, approved risk and settled historical money are synthetic facts.
// Every new quote/confirmation/paper archive/finance/apply action uses real HTTP.
// Both new changes are created through the real guarded HTTP entry point.
test('OFFLINE delay HTTP: genuine rental and two paper amendments, pinned finance, no eSign', {skip:process.env.NODE_ENV!=='test'},async()=>{
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
  const snapshot:any={commercialHash:originalHash,startDate:'2026-10-01',firstDueDate:'2026-10-01',months:12,monthlyFeeAmount:10000,depositAmount:0,customerProfileSnapshot,commercialTerms:{vehicleIdentification:`合成车辆 ${vehicle.vin}`,customerAddress:'合成原签约地址'},lessorSnapshot:{ownerId:owner.id,vehicleId:vehicle.id,executionMode:'OFFLINE',name:owner.name,subjectType:'ENTERPRISE',platformLegalEntityName:'合成平台'},partiesSnapshot:[{role:'CUSTOMER',partyId:customer.id,name:customerProfileSnapshot.name},{role:'OWNER',partyId:owner.id,name:owner.name},{role:'PLATFORM',partyId:'合成平台',name:'合成平台'}],riskSnapshot:{reviewId:risk.id,applicationId:application.id,customerId:customer.id,planId,planRevision:1,commercialHash:originalHash,qualificationId:qualification.id,qualificationRevision:qualification.revision}};
  const order=await h.db.order.create({data:{customerId:customer.id,applicationId:application.id,vehicleId:vehicle.id,contractMode:'OFFLINE',status:'AWAITING_CONTRACT_REVIEW',confirmedMileageKm:100,finalPlanSnapshot:snapshot}});
  const original=await h.db.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'OFFLINE',status:'DRAFT',documentHash:originalHash,documentId:'legacy-template-index',templateVersion:99}});
  for(const p of periods(snapshot.startDate,snapshot.months)){
   const bill=await h.db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:p.sequence,amount:10000,paidAmount:10000,status:'PAID',dueDate:p.startDate}});
   await h.db.payment.create({data:{customerId:customer.id,billId:bill.id,status:'SUCCEEDED',amount:10000,idempotencyKey:randomUUID(),providerTransactionId:`synthetic-settled-${randomUUID()}`}});
  }
  const rental=await h.archive('RENTAL','ORDER',order.id);assert.equal((await h.db.contract.findUniqueOrThrow({where:{id:original.id}})).offlineArchiveId,rental.archiveId);
  assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,true,'real archived rental is authoritative despite legacy template index');
  const legalMax=await h.db.legalDocument.aggregate({where:{type:'OFFLINE_ORDER_AMENDMENT'},_max:{version:true}});
  h.docs.OFFLINE_ORDER_AMENDMENT=await h.db.legalDocument.create({data:{type:'OFFLINE_ORDER_AMENDMENT',version:(legalMax._max.version||0)+1,title:'本地合成延期补充协议',content:'仅本地合成测试，不用于真实交易。{{customerName}} 与 {{lessorName}} 确认延期；原档案 {{originalArchiveVersionId}}（{{originalArchiveHash}}）。\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}\n{{settlementExplanation}}\n{{handoverArrangement}}\n{{cancellationTerms}}',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  const originalBills=await h.db.bill.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
  let lastArchive:any,lastChange:any,lastQuote:any,lastCreateInput:any;
  for(const newStartDate of ['2026-11-01','2026-12-01']){
   const state=await h.get(`/admin/orders/${order.id}/delivery-delay-context`);assert.equal(state.canCreate,true);
   const createPath=`/admin/orders/${order.id}/delivery-delay-changes`,createInput={expectedOrderRevision:state.orderRevision,priorTermsHash:state.priorTermsHash,reason:'双方同意未实际交付延期',idempotencyKey:randomUUID()};
   await h.reject(createPath,{...createInput,expectedOrderRevision:state.orderRevision-1},h.maker,'VERSION_CONFLICT');
   await h.reject(createPath,{...createInput,priorTermsHash:'f'.repeat(64)},h.maker,'VERSION_CONFLICT');
   await h.reject(createPath,createInput,h.finance,'FORBIDDEN');
   const currentOrder=await h.db.order.findUniqueOrThrow({where:{id:order.id}}),prior=currentOrder.effectiveTermsVersionId?(await h.db.orderTermsVersion.findUniqueOrThrow({where:{id:currentOrder.effectiveTermsVersionId}})).snapshot:currentOrder.finalPlanSnapshot;
   const created=await Promise.all([h.post(createPath,createInput),h.post(createPath,createInput)]),change=created[0];assert.equal(created[1].id,change.id);assert.equal(change.kind,'DELIVERY_DELAY');assert.equal(change.status,'DRAFT');
   assert.equal(await h.db.orderChange.count({where:{orderId:order.id,idempotencyKey:createInput.idempotencyKey}}),1);
   const source=await h.db.orderChange.findUniqueOrThrow({where:{id:change.id}});assert.equal(source.originalContractId,original.id);assert.equal(source.originalArchiveVersionId,rental.versionId);assert.equal(source.priorTermsVersionId,currentOrder.effectiveTermsVersionId);assert.equal(source.priorTermsHash,hash(prior));assert.deepEqual(source.priorTerms,prior);
   assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,state.orderRevision+1,'same-key create increments Order only once');
   await h.reject(createPath,{...createInput,idempotencyKey:randomUUID()},h.maker,'CHANGE_BLOCKED');
   await h.reject(createPath,{...createInput,reason:'不同请求正文'},h.maker,'IDEMPOTENCY_CONFLICT');lastCreateInput=createInput;
   const root=`/admin/order-changes/${change.id}`,schedule=periods(newStartDate,12);
   let view=await h.post(`${root}/quotes`,{...command(),expiresAt:'2099-12-31T00:00:00.000Z',externalCompensationRequired:false,newStartDate,periods:schedule.map(p=>({sequence:p.sequence,dueDate:day(p.startDate),amount:10000,calculationBasis:'原同一期金额不变'})),reason:'未实际交付双方协商延期',settlementExplanation:'原同一期付款全额沿用，不新增或重复收款',handoverArrangement:'按变更后起租日核对交付',cancellationTerms:'其余解除条件按原已归档合同办理'});
   await h.reject(`${root}/review`,{...command(view.revision),decision:'APPROVED',note:'同人不复核'},h.maker,'FORBIDDEN');
   view=await h.post(`${root}/review`,{...command(view.revision),decision:'APPROVED',note:'已逐期独立核对'},h.finance);
   view=await h.post(`${root}/publish`,command(view.revision));assert.equal(view.contract.executionMode,'OFFLINE');assert.equal(view.contract.status,'DRAFT');
   await h.reject(`/customer/order-changes/${change.id}`,undefined,outsider,'NOT_FOUND');
   const customerView=await h.get(`/customer/order-changes/${change.id}`,customer);assert.equal(customerView.canConfirm,true);assert.equal(customerView.canSign,false);
   const accept={...command(view.revision),commercialHash:view.quote.commercialHash};
   view=await h.post(`/customer/order-changes/${change.id}/confirm`,accept,customer);assert.equal(view.status,'AWAITING_ARCHIVE');
   assert.equal((await h.post(`/customer/order-changes/${change.id}/confirm`,accept,customer)).status,'AWAITING_ARCHIVE');
   await h.reject(`${root}/prepare-finance`,command(view.revision),h.finance,'CHANGE_STATE');
   const paper=await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',view.quote.id);
   view=await h.get(root);assert.equal(view.status,'AWAITING_FINANCE');assert.equal(view.contract.status,'DRAFT');
   assert.equal((await h.db.delayQuote.findUniqueOrThrow({where:{id:view.quote.id}})).approvedArchiveVersionId,null,'archive alone must not prepare money');
   const financeInput=command(view.revision);view=await h.post(`${root}/prepare-finance`,financeInput,h.finance);const obligationCount=await h.db.serviceObligation.count({where:{quoteId:view.quote.id}});
   await h.post(`${root}/prepare-finance`,financeInput,h.finance);assert.equal(await h.db.serviceObligation.count({where:{quoteId:view.quote.id}}),obligationCount);assert.equal(obligationCount,12);
   assert.equal((await h.db.delayQuote.findUniqueOrThrow({where:{id:view.quote.id}})).approvedArchiveVersionId,paper.versionId);
   const applyInput=command(view.revision);view=await h.post(`${root}/apply`,applyInput);assert.equal(view.status,'APPLIED');await h.post(`${root}/apply`,applyInput);
   const terms=await h.db.orderTermsVersion.findUniqueOrThrow({where:{quoteId:view.quote.id}});assert.equal(terms.offlineArchiveVersionId,paper.versionId);assert.equal((terms.snapshot as any).startDate,newStartDate);assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,true);
   const replayRevision=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision;assert.equal((await h.post(createPath,createInput)).id,change.id);assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,replayRevision);
   lastArchive=paper;lastChange=change;lastQuote=view.quote;
  }
  assert.equal(await h.db.orderTermsVersion.count({where:{orderId:order.id}}),2);assert.deepEqual(await h.db.bill.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}}),originalBills);
  assert.equal(await h.db.refund.count({where:{customerId:customer.id}}),0);assert.equal(await h.db.contract.count({where:{orderId:order.id,status:'SIGNED'}}),0);
  assert.equal(await h.db.paymentAllocation.count({where:{obligation:{orderId:order.id},releasedAt:null}}),12);
  await h.db.adminUser.update({where:{id:h.maker.id},data:{active:false}});await h.reject(`/admin/order-changes/${lastChange.id}`,undefined,h.maker);await h.reject(`/admin/orders/${order.id}/delivery-delay-changes`,lastCreateInput,h.maker,'SESSION_EXPIRED');await h.db.adminUser.update({where:{id:h.maker.id},data:{active:true}});
  // Invalidation is a trusted synthetic external fact; subsequent execution must fail closed.
  await h.db.archiveVersion.update({where:{id:lastArchive.versionId},data:{invalidatedAt:new Date(),invalidatedBy:h.reviewer.id}});
  assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,false);assert.equal((await h.get(`/admin/orders/${order.id}/delivery-delay-context`)).canCreate,false);
  assert.ok(lastQuote.commercialHash);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.externalCalls,0);assert.equal(h.preparedPdfs,3);
 }finally{try{await h.close();}finally{if(identityPolicy===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=identityPolicy;}}
});
