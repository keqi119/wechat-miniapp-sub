import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {captureCustomerProfileSnapshot} from '../src/customers/profile';
import {hash} from '../src/common/data';
import {periods,day} from '../src/usage/rules';
import {snapshotProduct} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {assertOfflineSwapQuote} from '../src/vehicle-changes/offline-target';

// Existing order, approved risk and settled historical money are synthetic facts.
// Qualification, rental archive, product/goods and new quote commands use real HTTP.
// New swap drafts use the real current-source HTTP create entry point.
test('OFFLINE swap lifecycle HTTP: approved paper, concurrent finance, real net refund and recovery', {skip:process.env.NODE_ENV!=='test'},async()=>{
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
  const account=await h.db.usageAccount.create({data:{orderId:order.id,customerId:customer.id,policyVersion:'USAGE_V1',startedOn:new Date('2026-10-01')}});
  for(const p of periods(snapshot.startDate,snapshot.months))await h.db.usagePeriod.create({data:{accountId:account.id,orderId:order.id,sequence:p.sequence,startDate:p.startDate,endDate:p.endDate,effectiveEndDate:p.endDate,startReadingKm:p.sequence===1?100:null}});
  const target=await h.db.vehicle.create({data:{brand:'合成',model:'EV',title:'明确商品换入车',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:200,status:'PUBLISHED'}});
  const proof=await h.proof(h.maker,'contract');
  const agreement=await h.db.partnerAgreement.create({data:{ownerId:owner.id,status:'ACTIVE',createdBy:h.maker.id}});
  const agreementVersion=await h.db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId:owner.id,version:1,status:'ACTIVE',title:'仅覆盖新车剩余服务期',fileIds:[proof.id],vehicleIds:[target.id],partnerRateBps:8000,validFrom:'2026-11-01',validUntil:'2027-09-30',contentHash:hash('synthetic-target-cooperation'),createdBy:h.maker.id}});
  await h.db.partnerAgreement.update({where:{id:agreement.id},data:{currentVersionId:agreementVersion.id}});
  await h.db.partnerAgreementVehicle.create({data:{vehicleId:target.id,ownerId:owner.id,agreementId:agreement.id,agreementVersionId:agreementVersion.id,assignedBy:h.maker.id}});
  const productDraft=await h.post('/admin/products',{configurationVersion:2,name:'换入产品',months:12,minimumTermMonths:3,baseFeeAmount:18000,mileageMonthlyFeeAmount:2000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:99,extraFeeAmount:99000},conditions:'合成升级条件',vehicleIds:[target.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],...command()});
  const product=await h.post(`/admin/products/${productDraft.productId}/publish`,{...command(productDraft.revision),versionId:productDraft.id});
  const targetPlan=await h.publishGoods(target.id,product.id),source=await h.db.serial(tx=>snapshotProduct(tx,targetPlan.id));
  const readCounts=()=>Promise.all([h.db.swapCreditPurchase.count({where:{orderId:order.id}}),h.db.swapCredit.count({where:{orderId:order.id}}),h.db.swapLedger.count({where:{orderId:order.id}})]),beforeReads=await readCounts();
  const context=await h.get(`/admin/orders/${order.id}/vehicle-change-context`);assert.equal(context.offline.ready,true);assert.equal(context.canCreate,true);assert.equal(context.swapAccount.term.includedCount,2);
  const customerAccount=await h.get(`/customer/orders/${order.id}/swap-account`,customer);assert.equal(context.swapAccount.canPurchase,customerAccount.canPurchase);assert.deepEqual(context.swapAccount.purchaseBlockers,customerAccount.purchaseBlockers);assert.deepEqual(await readCounts(),beforeReads,'capability GETs do not create purchases, credits or ledger entries');
  const oldRevision=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision;
  await h.get(`/customer/orders/${order.id}/swap-account`,customer);assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,oldRevision,'read projection does not bootstrap assignments or expire rights');
  await h.reject(`/admin/orders/${order.id}/vehicle-changes`,{expectedOrderRevision:context.orderRevision-1,priorTermsHash:context.priorTermsHash,reason:'错误条款来源',idempotencyKey:randomUUID()},h.maker,'VERSION_CONFLICT');
  await h.reject(`/customer/orders/${order.id}/vehicle-changes`,{reason:'其他客户不能申请',idempotencyKey:randomUUID()},outsider,'NOT_FOUND');
  assert.equal(await h.db.orderChange.count({where:{orderId:order.id}}),0);
  const frozenPrior=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot;
  assert.ok(frozenPrior&&typeof frozenPrior==='object'&&!Array.isArray(frozenPrior));
  const createPath=`/customer/orders/${order.id}/vehicle-changes`,createInputs=Array.from({length:2},()=>({reason:'客户本人明确商品换车申请',idempotencyKey:randomUUID()}));assert.notEqual(createInputs[0].idempotencyKey,createInputs[1].idempotencyKey);
  const createResults=await Promise.all(createInputs.map(body=>h.raw(createPath,body,customer)));assert.deepEqual(createResults.map(r=>r.status).sort(),[201,409],JSON.stringify(createResults));const winner=createResults.findIndex(r=>r.status===201),change=createResults[winner].data;assert.equal(createResults[1-winner].data.error?.code,'CHANGE_BLOCKED');assert.equal(await h.db.orderChange.count({where:{orderId:order.id}}),1);assert.equal((await h.post(createPath,createInputs[winner],customer)).id,change.id);assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,context.orderRevision+1);
  const createdSource=await h.db.orderChange.findUniqueOrThrow({where:{id:change.id}});assert.equal(createdSource.priorTermsHash,hash(frozenPrior));assert.deepEqual(createdSource.priorTerms,frozenPrior);assert.equal(createdSource.originalContractId,original.id);assert.equal(createdSource.originalArchiveVersionId,rental.versionId);
  const path=`/admin/order-changes/${change.id}`,input={...command(change.revision),pricingVersion:2,targetListingId:source.listingId,targetListingRevision:source.listingRevision,targetSourceHash:source.sourceHash,plannedReturnAt:'2026-11-01T09:00:00+08:00',plannedDeliveryAt:'2026-11-01T10:00:00+08:00',depositAmount:0,depositBasis:'原押金保持',insuranceResponsibility:'按原合同责任',downtimeArrangement:'当天明确安排',settlementExplanation:'自动按原服务月实际天数算升级差价',handoverArrangement:'各自核实实际交接',cancellationTerms:'按原约定',reason:'客户升级',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};
  const billsBefore=await h.db.bill.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),usageBefore=await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}});
  const targets=await h.get(path+'/offline/targets?keyword='+encodeURIComponent(target.vin!)+'&page=1&pageSize=20'),selected=targets.items.find((item:any)=>item.targetListingId===source.listingId);assert.ok(selected);assert.equal(selected.targetListingRevision,source.listingRevision);assert.equal(selected.targetSourceHash,source.sourceHash);
  const {idempotencyKey:_previewKey,...previewInput}=input,previewOrderRevision=(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,preview=await h.post(path+'/offline/quote-preview',previewInput),strictInput={...input,previewHash:preview.previewHash};assert.equal(preview.targetMonthlyFeeAmount,20000);assert.equal(preview.target.targetSourceHash,source.sourceHash);assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,previewOrderRevision);assert.equal(await h.db.vehicleHold.count({where:{changeId:change.id}}),0);
  assert.deepEqual(await readCounts(),beforeReads,'strict preview is also rights-read-only');
  await h.reject(path+'/offline/quotes',input,h.maker,'VALIDATION');await h.reject(path+'/offline/quotes',{...strictInput,reason:'预览后变更内容'},h.maker,'SWAP_PREVIEW_CHANGED');
  await h.reject(path+'/offline/quotes',{...strictInput,targetSourceHash:'f'.repeat(64)},h.maker,'GOODS_SOURCE_CHANGED');
  await h.reject(path+'/offline/quotes',{...strictInput,newMonthlyFeeAmount:1},h.maker,'VALIDATION');
  await h.reject(path+'/offline/quotes',strictInput,h.finance,'FORBIDDEN');
  assert.equal(await h.db.delayQuote.count({where:{changeId:change.id}}),0);
  const replies=await Promise.all([h.post(path+'/offline/quotes',strictInput),h.post(path+'/offline/quotes',strictInput)]);let view=replies[0];assert.equal(replies[1].quote.id,view.quote.id);assert.equal(view.quote.pricingHash,preview.pricingHash);
  assert.equal(view.status,'REVIEW_PENDING');assert.equal(view.quote.pricingVersion,2);assert.equal(view.quote.newMonthlyFeeAmount,20000);assert.equal(view.quote.handoverFeeAmount,0);assert.equal(view.quote.targetSource.product.sourceHash,source.sourceHash);assert.equal(view.quote.pricingHash,canonicalHash(view.quote.pricing));
  assert.deepEqual(view.quote.periods.map((p:any)=>p.amount),[10000,...Array(11).fill(20000)]);assert.deepEqual(view.quote.targetLessorSnapshot.leaseRange,{startDate:'2026-11-01',endDate:'2027-09-30'});
  assert.equal(view.canPublish,false);assert.equal(view.canCreateReturn,false);assert.equal(view.canPrepareFinance,false);assert.equal(view.canComplete,false);
  assert.equal(await h.db.delayQuote.count({where:{changeId:change.id}}),1);assert.equal(await h.db.vehicleHold.count({where:{changeId:change.id,status:'HELD'}}),1);
  assert.equal(await h.db.swapCredit.count({where:{orderId:order.id,source:'FREE',consumedChangeId:null}}),1);assert.equal(await h.db.swapReservation.count({where:{orderId:order.id,changeId:change.id,status:'RESERVED'}}),1);assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'GRANT'}}),1);assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'RESERVE'}}),1);assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'CONSUME'}}),0,'formal quote reserves once; actual delivery alone consumes');
  assert.equal(await h.db.serviceObligation.count({where:{orderId:order.id}}),0);assert.equal(await h.db.refund.count({where:{customerId:customer.id}}),0);assert.deepEqual(await h.db.bill.findMany({where:{orderId:order.id},orderBy:{id:'asc'}}),billsBefore);assert.deepEqual(await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}}),usageBefore);
  assert.deepEqual((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,snapshot);
  const quoteBefore=await h.db.delayQuote.findUniqueOrThrow({where:{id:view.quote.id}});
  const goods=await h.get(`/admin/goods/${source.listingId}`);await h.post(`/admin/goods/${goods.id}/withdraw`,command(goods.revision));
  assert.equal((await h.post(path+'/offline/quotes',strictInput)).quote.id,view.quote.id);assert.deepEqual(await h.db.delayQuote.findUniqueOrThrow({where:{id:view.quote.id}}),quoteBefore);
  await h.reject(path+'/offline/quotes',{...strictInput,reason:'篡改同键'},h.maker,'IDEMPOTENCY_CONFLICT');

  const max=await h.db.legalDocument.aggregate({where:{type:'OFFLINE_ORDER_AMENDMENT'},_max:{version:true}});
  h.docs.OFFLINE_ORDER_AMENDMENT=await h.db.legalDocument.create({data:{type:'OFFLINE_ORDER_AMENDMENT',version:(max._max.version||0)+1,title:'本地合成换车补充协议',content:'只限本地合成测试，不用于真实交易。{{customerName}} 与 {{lessorName}}；原签字件 {{originalArchiveHash}}。\n{{swapFacts}}\n{{periodSchedule}}\n{{financialSchedule}}',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  const approveAndArchive=async()=>{
   view=await h.get(path);view=await h.post(path+'/review',{...command(view.revision),decision:'APPROVED',note:'独立逐期核对真实净差'},h.finance);
   assertOfflineSwapQuote(await h.db.orderChange.findUniqueOrThrow({where:{id:change.id}}),await h.db.delayQuote.findUniqueOrThrow({where:{id:view.quote.id}}));
   assert.equal((await h.get(path)).canPublish,true);
   view=await h.post(path+'/publish',command(view.revision));assert.equal(view.contract.executionMode,'OFFLINE');assert.equal(view.contract.status,'DRAFT');
   const accept={...command(view.revision),commercialHash:view.quote.commercialHash};view=await h.post('/customer/order-changes/'+change.id+'/confirm',accept,customer);assert.equal(view.status,'AWAITING_ARCHIVE');
   assert.equal((await h.post('/customer/order-changes/'+change.id+'/confirm',accept,customer)).status,'AWAITING_ARCHIVE');
   await h.reject(path+'/prepare-finance',command(view.revision),h.finance,'CHANGE_STATE');
   const paper=await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',view.quote.id);view=await h.get(path);assert.equal(view.status,'AWAITING_FINANCE');return paper;
  };
  const firstArchive=await approveAndArchive(),firstId=view.quote.id,firstPrepare=command(view.revision);
  await Promise.all([h.post(path+'/prepare-finance',firstPrepare,h.finance),h.post(path+'/prepare-finance',firstPrepare,h.finance)]);
  view=await h.get(path);assert.equal(await h.db.serviceObligation.count({where:{quoteId:firstId}}),12);assert.equal((await h.db.delayQuote.findUniqueOrThrow({where:{id:firstId}})).approvedArchiveVersionId,firstArchive.versionId);
  const secondPeriod=await h.db.serviceObligation.findUniqueOrThrow({where:{quoteId_sequence:{quoteId:firstId,sequence:2}}});assert.ok(secondPeriod.chargeBillId);
  const payment=await h.post('/customer/bills/'+secondPeriod.chargeBillId+'/pay',{idempotencyKey:randomUUID()},customer);h.payment.capture(payment.paymentId);await h.post('/admin/payments/'+payment.paymentId+'/sync',{},h.finance);await h.post('/admin/payments/'+payment.paymentId+'/sync',{},h.finance);
  view=await h.get(path);assert.equal(view.finance.blockers.length,0);assert.equal(view.canQuote,true);assert.equal(view.canCreateReturn,true,'operations may start the archived and funded physical return');
  assert.equal(await h.db.handover.count({where:{changeId:change.id}}),0);assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'CONSUME'}}),0);assert.equal(await h.db.orderTermsVersion.count({where:{orderId:order.id}}),0,'reading physical capability creates no handover, consumption or effective terms');
  const reprice={...input,...command(view.revision),plannedReturnAt:'2026-11-02T09:00:00+08:00',plannedDeliveryAt:'2026-11-02T10:00:00+08:00'};
  const {idempotencyKey:_repriceKey,...repricePreviewInput}=reprice,secondPreview=await h.post(path+'/offline/quote-preview',repricePreviewInput),strictReprice={...reprice,previewHash:secondPreview.previewHash};assert.equal(secondPreview.periods[1].refundAmount,333);
  const secondReplies=await Promise.all([h.post(path+'/offline/quotes',strictReprice),h.post(path+'/offline/quotes',strictReprice)]);view=secondReplies[0];assert.equal(secondReplies[1].quote.id,view.quote.id);assert.equal(view.quote.periods[1].amount,19667);assert.equal(view.quote.periods[1].netPaidAmount,20000);assert.equal(view.quote.periods[1].refundAmount,333);assert.equal(view.quote.periods[1].chargeAmount,0);assert.equal(view.quote.financeSourceQuoteId,undefined);assert.equal(view.quote.previousPreparedQuoteId,firstId);
  assert.equal(await h.db.refund.count({where:{customerId:customer.id}}),0);const secondArchive=await approveAndArchive(),secondId=view.quote.id,secondPrepare=command(view.revision);
  await Promise.all([h.post(path+'/prepare-finance',secondPrepare,h.finance),h.post(path+'/prepare-finance',secondPrepare,h.finance)]);
  const refunds=await h.db.refund.findMany({where:{customerId:customer.id}});assert.equal(refunds.length,1);assert.equal(refunds[0].amount,333);assert.equal(refunds[0].status,'PENDING_APPROVAL');assert.equal((await h.db.delayQuote.findUniqueOrThrow({where:{id:secondId}})).approvedArchiveVersionId,secondArchive.versionId);
  assert.equal((await h.get(path)).canQuote,false);await h.post('/admin/refunds/'+refunds[0].id+'/approve',{},h.reviewer);view=await h.get(path);assert.equal(view.finance.blockers.length,0);
  const beforeCallback=await h.db.paymentAllocation.count({where:{obligation:{quoteId:secondId},releasedAt:null}});await h.post('/admin/payments/'+payment.paymentId+'/sync',{},h.finance);assert.equal(await h.db.paymentAllocation.count({where:{obligation:{quoteId:secondId},releasedAt:null}}),beforeCallback);
  const thirdInput={...input,...command(view.revision)},{idempotencyKey:_thirdKey,...thirdPreviewInput}=thirdInput,thirdPreview=await h.post(path+'/offline/quote-preview',thirdPreviewInput);assert.equal(thirdPreview.periods[1].chargeAmount,333);
  view=await h.post(path+'/offline/quotes',{...thirdInput,previewHash:thirdPreview.previewHash});assert.equal(view.quote.periods[1].netPaidAmount,19667);assert.equal(view.quote.periods[1].chargeAmount,333);assert.equal(view.quote.periods[1].refundAmount,0);assert.equal(view.quote.preparedSources.length,2);
  const cancel={...command(view.revision),reason:'保留前次已归档安排'};view=await h.post(path+'/cancel',cancel);assert.equal(view.quote.id,secondId);assert.equal(view.status,'AWAITING_FINANCE');await h.post(path+'/cancel',cancel);
  await h.reject('/customer/order-changes/'+change.id,undefined,outsider,'NOT_FOUND');
  assert.equal(await h.db.swapCredit.count({where:{orderId:order.id,source:'FREE',consumedChangeId:null}}),1);assert.equal(await h.db.swapReservation.count({where:{orderId:order.id,changeId:change.id,status:'RESERVED'}}),1,'cancelling the new draft restores the previous agreed arrangement and its reservation');assert.equal(await h.db.swapLedger.count({where:{orderId:order.id,type:'CONSUME'}}),0);assert.equal(await h.db.orderTermsVersion.count({where:{orderId:order.id}}),0);
  assert.deepEqual((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,snapshot);assert.deepEqual(await h.db.usagePeriod.findMany({where:{orderId:order.id},orderBy:{sequence:'asc'}}),usageBefore);
  assert.equal(await h.db.refund.count({where:{customerId:customer.id,status:'SUCCEEDED'}}),1);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.externalCalls,0);assert(h.payment.providerCalls>0,'only the local verified synthetic payment gateway was used');

 }finally{try{await h.close();}finally{if(identityPolicy===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=identityPolicy;}}
});
