import {offlineSwapFixture} from './offline-swap-quotes-fixture';
import {termSwapFixture} from './term-swap-fixture';
import {SwapPurchasesController} from '../src/swap-purchases/controller';
import {swapProduct} from '../src/swap-purchases/policy';
import {swapTerms} from '../src/swap-purchases/rules';

/** Complete synthetic paper/qualification/physical facts; only persistence is in memory. */
export async function offlineSwapPurchaseFixture(){
 const f=offlineSwapFixture(),store=termSwapFixture(0,50000),tx=f.tx,now=new Date('2026-11-01T00:00:00+08:00');
 (f.initial as any).productSnapshot.swapPolicy.includedCount=0;f.changes.length=0;
 const account=f.account as any;account.revision=0;
 for(const key of ['swapCredit','swapReservation','swapLedger','swapCreditPurchase','bill','payment','auditLog','returnSettlement'])tx[key]=store.tx[key];
 const updateOrder=tx.order.update;tx.order.update=async(args:any)=>updateOrder(args);
 tx.usageAccount.update=async({data}:any)=>{account.revision+=data.revision?.increment||0;f.writes.push({table:'usageAccount',data});return account;};
 tx.orderChange.count=async()=>f.changes.length;
 const findPurchase=tx.swapCreditPurchase.findUnique;
 tx.swapCreditPurchase.findUnique=async({where}:any)=>where.orderId_idempotencyKey?store.purchases.find(p=>p.orderId===where.orderId_idempotencyKey.orderId&&p.idempotencyKey===where.orderId_idempotencyKey.idempotencyKey):findPurchase({where});
 const createPurchase=tx.swapCreditPurchase.create;tx.swapCreditPurchase.create=async({data}:any)=>createPurchase({data:{status:'PENDING_PAYMENT',...data}});
 const session={id:'purchase-session',customerId:f.order.customerId,expiresAt:new Date('2099-01-01')};tx.customerSession={findUnique:async()=>session};
 const legal=tx.legalDocument.findFirst;
 tx.legalDocument.findFirst=async(args:any)=>args.where.type==='swap-credit-v2'?{id:'swap-terms',type:'swap-credit-v2',version:1,status:'PUBLISHED',confirmedAt:new Date('2026-10-01'),confirmedBy:'legal-reviewer',content:'额外换车一次 {{extraFeeYuan}} 元；按本服务租期原截止日有效。'}:legal(args);
 const terms=(await swapTerms(tx,f.order))!,product=swapProduct(f.order),input={productId:product.id,pricingHash:'pricingHash'in product?product.pricingHash:'',termsVersion:terms.version,termsDocumentId:terms.documentId,termsDocumentVersion:terms.documentVersion,termsHash:terms.hash,accepted:true,idempotencyKey:'offline-purchase-key'};
 const db={serial:async(fn:any)=>fn(tx)},api=new SwapPurchasesController(db as any,{} as any,()=>now);
 return{...f,tx,now,account,store,input,session,api,db,request:{customer:{id:f.order.customerId},session},writesCount:()=>f.writes.length+store.writes()};
}

export async function withSwapPurchaseFlags(mvp:string|undefined,enabled:string|undefined,run:()=>Promise<void>){
 const keys=['MVP_V2_ENABLED','SWAP_CREDIT_PURCHASE_ENABLED'],before=keys.map(k=>process.env[k]);
 for(const [i,value]of [mvp,enabled].entries())if(value===undefined)delete process.env[keys[i]];else process.env[keys[i]]=value;
 try{await run();}finally{for(const [i,value]of before.entries())if(value===undefined)delete process.env[keys[i]];else process.env[keys[i]]=value;}
}

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {command,type JourneyHarness} from './seven-module-journey-fixtures';
import {captureCustomerProfileSnapshot} from '../src/customers/profile';
import {hash} from '../src/common/data';
import {periods} from '../src/usage/rules';
import {snapshotProduct} from '../src/products/snapshot';
import {snapshotUsagePolicy} from '../src/usage/policy';
import {freezeUsagePricing} from '../src/usage/pricing';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {OrderRenewalsService} from '../src/order-renewals/service';
import {canonicalHash} from '../src/customers/types';

/** Guarded test only. Prior delivery/risk/order are disclosed historical synthetic facts.
 * Current manual qualification, real goods, paper archive and all NEW purchases/money
 * use the actual App. This fixture never seeds an OrderChange or a paid swap credit. */
export async function persistedOfflineSwapPurchase(h:JourneyHarness){
  await h.start();
  const customer=await h.customer('零赠送付费换车客户');
  const front=await h.proof(customer,'identity'),back=await h.proof(customer,'identity'),license=await h.proof(customer,'identity');
  const profile=await h.get('/customer/profile',customer);
  await h.post('/customer/profile',{...command(profile.revision),name:'合成纸签客户',drivingYears:5,identityFrontFileId:front.id,identityBackFileId:back.id,drivingLicenseFileId:license.id},customer,'PUT');
  const current=await h.get(`/admin/customers/${customer.id}/qualifications`);
  const qualification=await h.post(`/admin/customers/${customer.id}/qualifications`,{...command(),profileHash:current.profileHash,verificationSource:'MANUAL',identityFileIds:[front.id,back.id],drivingLicenseFileIds:[license.id],identityExpiresAt:'2035-01-01T00:00:00.000Z',drivingLicenseExpiresAt:'2035-01-01T00:00:00.000Z'});
  await h.post(`/admin/customers/${customer.id}/qualifications/reviews`,{...command(qualification.revision),qualificationId:qualification.id,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:''},h.reviewer);
  const customerProfileSnapshot=await h.db.serial(tx=>captureCustomerProfileSnapshot(tx,customer.id,'ORDER_CONFIRMATION'));
  assert.equal(customerProfileSnapshot.version,2);assert.equal(customerProfileSnapshot.identity,null);assert.equal(await h.db.eSignAccount.count({where:{customerId:customer.id}}),0);
  const owner=await h.post('/admin/partners',{profile:{name:'合成纸质出租方',subjectType:'ENTERPRISE'},idempotencyKey:randomUUID()});
  const model=await h.db.modelDefinition.create({data:{brand:'购买合成',name:'零赠送额外换车-'+h.prefix}});
  const vehicle=await h.db.vehicle.create({data:{modelDefinitionId:model.id,brand:'合成',model:'EV',title:'线下次数购买测试车辆',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,status:'RESERVED'}});
  const oldUsageType='usage-policy-v2',oldUsageVersion=await h.db.legalDocument.aggregate({where:{type:oldUsageType},_max:{version:true}});
  await h.db.legalDocument.create({data:{type:oldUsageType,version:(oldUsageVersion._max.version||0)+1,title:'原期真实可配置里程',content:'原期每月 {{baseAllowanceKm}} 公里，超额每公里 {{excessPriceYuan}} 元。',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  const oldProductDraft=await h.post('/admin/products',{configurationVersion:2,name:'原期真实商品',months:12,baseFeeAmount:10000,mileageMonthlyFeeAmount:0,mileagePerMonthKm:1500,excessMileagePriceAmount:150,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:50000},conditions:'原期明确条件',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],...command()});
  const oldProduct=await h.post(`/admin/products/${oldProductDraft.productId}/publish`,{...command(oldProductDraft.revision),versionId:oldProductDraft.id}),plan=await h.publishGoods(vehicle.id,oldProduct.id),originalProduct=await h.db.serial(tx=>snapshotProduct(tx,plan.id));
  const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],status:'FINAL_PLAN_CONFIRMED',idempotencyKey:randomUUID(),requestHash:hash('synthetic-application')}});
  const originalHash=hash({applicationId:application.id,fixture:'offline-delay'}),riskId=randomUUID(),planId=randomUUID();
  const risk=await h.db.applicationRiskReview.create({data:{id:riskId,applicationId:application.id,customerId:customer.id,revision:1,applicationRevision:application.revision,profileHash:current.profileHash,applicationProfileHash:hash({}),qualificationId:qualification.id,qualificationRevision:qualification.revision,finalPlanId:planId,planRevision:1,commercialHash:originalHash,planInputHash:hash('synthetic-plan'),vehicleId:vehicle.id,vehicleInputHash:hash('synthetic-vehicle'),creditConsentId:randomUUID(),creditConsentRevision:1,creditConsentVersion:1,creditVerificationId:randomUUID(),creditVerificationRevision:1,creditRevision:1,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reviewedBy:h.reviewer.id,idempotencyKey:randomUUID(),requestHash:hash('synthetic-approved-risk')}});
  const usagePolicy=await h.db.serial(tx=>snapshotUsagePolicy(tx,originalProduct));
  const snapshot:any={productSnapshot:originalProduct,energyDescription:originalProduct.energyDescription,conditions:originalProduct.conditions,commercialHash:originalHash,startDate:'2026-10-01',firstDueDate:'2026-10-01',months:12,monthlyFeeAmount:10000,depositAmount:0,mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicyVersion:'USAGE_V2',usagePolicy,customerProfileSnapshot,commercialTerms:{vehicleIdentification:`合成车辆 ${vehicle.vin}`,customerAddress:'合成原签约地址',earlyTerminationRule:'仅本地合成约定：客户提前还车须各方确认终止安排，已发生租金和实际里程费用据实结算。',depositRefundRule:'仅本地合成约定：结清已发生费用并完成还车查验后，原押金于确认当日全额原路退回。'},lessorSnapshot:{ownerId:owner.id,vehicleId:vehicle.id,executionMode:'OFFLINE',name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode??null,platformLegalEntityName:'上海宁达信息科技有限公司'},partiesSnapshot:[{role:'CUSTOMER',partyId:customer.id,name:customerProfileSnapshot.name},{role:'OWNER',partyId:owner.id,name:owner.name},{role:'PLATFORM',partyId:'上海宁达信息科技有限公司',name:'上海宁达信息科技有限公司'}],riskSnapshot:{reviewId:risk.id,applicationId:application.id,customerId:customer.id,planId,planRevision:1,commercialHash:originalHash,qualificationId:qualification.id,qualificationRevision:qualification.revision}};
  const order=await h.db.order.create({data:{customerId:customer.id,applicationId:application.id,vehicleId:vehicle.id,contractMode:'OFFLINE',status:'AWAITING_CONTRACT_REVIEW',confirmedMileageKm:100,finalPlanSnapshot:snapshot}});
  const original=await h.db.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'OFFLINE',status:'DRAFT',documentHash:originalHash,documentId:'legacy-template-index',templateVersion:99}});
  // Preserve genuinely unpaid old monthly bills; this product has zero original deposit.
  // These are existing obligations, not invented receipts; payment below uses BillingService.
  for(const p of periods(snapshot.startDate,snapshot.months))await h.db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:p.sequence,amount:10000,paidAmount:0,status:'PENDING',dueDate:p.startDate}});
  const rental=await h.archive('RENTAL','ORDER',order.id);assert.equal((await h.db.contract.findUniqueOrThrow({where:{id:original.id}})).offlineArchiveId,rental.archiveId);
  assert.equal((await readEffectiveContractChain(h.db,order.id)).ready,true,'real archived rental is authoritative despite legacy template index');
  // Trusted previous actual handover/usage facts are not a new delivery operation.
  const deliveredAt=new Date('2026-10-01T00:00:00+08:00');
  const assignment=await h.db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,startAt:deliveredAt,startReadingKm:100}});
  const handover=await h.db.handover.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,assignmentId:assignment.id,type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',readingKm:100,actualAt:deliveredAt,completedAt:deliveredAt,fileIds:[],checklist:{syntheticHistoricalFact:true},manifestHash:hash('historical-offline-delivery')}});
  await h.db.vehicleAssignment.update({where:{id:assignment.id},data:{deliveryHandoverId:handover.id}});
  await h.db.order.update({where:{id:order.id},data:{status:'ACTIVE',currentAssignmentId:assignment.id}});
  await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'IN_USE',reservedOrderId:order.id}});
  const account=await h.db.usageAccount.create({data:{orderId:order.id,customerId:customer.id,policyVersion:'USAGE_V2',pricingSnapshot:freezeUsagePricing(snapshot),startedOn:new Date('2026-10-01')}});
  for(const p of periods(snapshot.startDate,snapshot.months))await h.db.usagePeriod.create({data:{accountId:account.id,orderId:order.id,sequence:p.sequence,startDate:p.startDate,endDate:p.endDate,effectiveEndDate:p.endDate,pricingSnapshot:freezeUsagePricing(snapshot),startReadingKm:p.sequence===1?100:null}});

  const max=await h.db.legalDocument.aggregate({where:{type:'swap-credit-v2'},_max:{version:true}});
  const purchaseDocument=await h.db.legalDocument.create({data:{type:'swap-credit-v2',version:(max._max.version||0)+1,title:'合成已核对额外换车说明',content:'仅本地合成。额外换车一次 {{extraFeeYuan}} 元，按本次购买原服务期截止日有效；未使用或未预占须经独立审核方可例外全额退款。',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  return{customer,owner,vehicle,order,account,assignment,original,rental,snapshot,product:originalProduct,purchaseDocument,qualification};
}

/** Real approved model coverage; the supplied local files are synthetic evidence. */
export async function offlineSwapPurchaseCoverage(h:JourneyHarness,vehicleId:string,modelId:string,ownerName:string){
 const input={...command(),insurer:'本地合成保险',policyNumber:randomUUID(),policyholder:ownerName,insuredParty:ownerName,vehicleIds:[vehicleId],coverageItems:[{code:'PURCHASE_COVER',label:'合成保障',amount:10000,deductible:'合成免赔',terms:'合成保障条款'}],terms:'仅本地测试',startAt:'2026-01-01',endAt:'2035-12-31',effectiveAt:'2026-01-01',fileIds:[],requirementVersionIds:[]};
 let policy=await h.post('/admin/insurance-policies',input);
 const file=await h.post(`/admin/insurance-policies/${policy.id}/files`,h.form({revision:policy.revision,idempotencyKey:randomUUID(),vehicleIds:[vehicleId]},'insurance'));
 policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}`,{...input,...command(policy.versions[0].revision),fileIds:[file.id]},h.maker,'PATCH');
 policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/submit`,command(policy.versions[0].revision));
 await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/review`,{...command(policy.versions[0].revision),decision:'APPROVED',checks:[{vehicleId,fileId:file.id,confirmed:true,note:'独立核对'}],reason:'真实合成保障'},h.reviewer);
}

export async function payOfflineSwapPurchaseBill(h:JourneyHarness,customer:any,billId:string){
 const request=await h.post(`/customer/bills/${billId}/pay`,{idempotencyKey:randomUUID()},customer);h.payment.capture(request.paymentId);await h.post(`/admin/payments/${request.paymentId}/sync`,{},h.finance);
 const payment=await h.db.payment.findUniqueOrThrow({where:{id:request.paymentId}});assert.equal(payment.status,'SUCCEEDED');assert.equal(payment.reconciliationRequired,false);return payment;
}

/** A real renewal command lifecycle, with zero included gifts fixed BEFORE its quote.
 * No stage/terms/change/payment/credit is fabricated for this renewal. */
export async function persistedZeroGiftRenewalPurchase(h:JourneyHarness){
 const f=await persistedOfflineSwapPurchase(h),{customer,vehicle,owner,order,account}=f;
 const proof=await h.proof(h.maker,'contract');await h.post(`/admin/partners/${owner.id}/agreements`,{...command(),status:'ACTIVE',title:'同车完整续期合作范围',fileIds:[proof.id],partnerRateBps:8000,vehicleIds:[vehicle.id],validFrom:'2026-01-01',validUntil:'2035-12-31'});
 await offlineSwapPurchaseCoverage(h,vehicle.id,vehicle.modelDefinitionId!,owner.name);
 const productDraft=await h.post('/admin/products',{configurationVersion:2,name:'零赠送续期实际产品',months:12,baseFeeAmount:18000,mileageMonthlyFeeAmount:2000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:55000},conditions:'零赠送，明确新段单次费用',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}],...command()});
 const product=await h.post(`/admin/products/${productDraft.productId}/publish`,{...command(productDraft.revision),versionId:productDraft.id}),plan=await h.publishGoods(vehicle.id,product.id),productSource=await h.db.serial(tx=>snapshotProduct(tx,plan.id));
 const max=await h.db.legalDocument.aggregate({where:{type:'OFFLINE_ORDER_AMENDMENT'},_max:{version:true}});
 h.docs.OFFLINE_ORDER_AMENDMENT=await h.db.legalDocument.create({data:{type:'OFFLINE_ORDER_AMENDMENT',version:(max._max.version||0)+1,title:'本地合成共同补充协议',content:'本地合成。原合同编号 {{originalContractNo}}。\n{{changeFacts}}\n{{periodSchedule}}\n{{financialSchedule}}',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
 const ops=await h.db.adminUser.findUniqueOrThrow({where:{id:h.maker.id}}),finance=await h.db.adminUser.findUniqueOrThrow({where:{id:h.finance.id}}),service=new OrderRenewalsService(h.db,()=>new Date('2026-10-31T04:00:00Z'));
 const input=async()=>({listingId:productSource.listingId,listingRevision:productSource.listingRevision,productVersionId:productSource.productVersionId,listingSourceHash:productSource.sourceHash,orderRevision:(await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,accountRevision:(await h.db.usageAccount.findUniqueOrThrow({where:{id:account.id}})).revision,reason:'合成客户继续同车十二个月',expiresAt:'2027-09-30T12:00:00+08:00',settlementExplanation:'原期与新期按各自真实冻结账单支付，原押金保持0',cancellationTerms:'由服务端固定规则规范化'});
 const first=await input(),preview=await service.preview(order.id,first,ops),created=await service.create(order.id,{...first,previewHash:preview.previewHash,idempotencyKey:randomUUID()},ops);
 const next=await input(),quotePreview=await service.preview(order.id,next,ops,created.id);let receipt=await service.act(created.id,'quotes',{...next,revision:created.revision,previewHash:quotePreview.previewHash,idempotencyKey:randomUUID()},ops);
 receipt=await service.act(created.id,'review',{...command(receipt.revision),decision:'APPROVED',note:'独立财务复核新段0赠送及550元单次费'},finance);receipt=await service.act(created.id,'publish',command(receipt.revision),ops);
 const quote=await h.db.delayQuote.findUniqueOrThrow({where:{id:receipt.quoteId!}}),q=quote.snapshot as any;
 assert.equal(q.renewalTerms.productSnapshot.swapPolicy.includedCount,0);assert.equal(q.renewalTerms.productSnapshot.swapPolicy.extraFeeAmount,55000);
 await service.customerAct(created.id,'confirm',{...command(receipt.revision),quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,bodyHash:q.document.bodyHash,lessorHash:q.source.lessorHash,noticeHash:q.renewalTerms.lessorSnapshot.sharingNotice.contentHash,sharingAccepted:true},customer.id);
 await h.archive('ORDER_AMENDMENT','ORDER_CHANGE_QUOTE',quote.id);
 const pre=await service.financePreview(created.id,finance),prepared=await service.prepare(created.id,{...command(pre.revision),orderRevision:pre.orderRevision,accountRevision:pre.accountRevision,previewHash:pre.previewHash},finance),stageId=prepared.stageId;
 const firstBill=await h.db.bill.findFirstOrThrow({where:{serviceStageId:stageId,type:'SUBSCRIPTION',sequence:13}});await payOfflineSwapPurchaseBill(h,customer,firstBill.id);
 for(const bill of await h.db.bill.findMany({where:{orderId:order.id,type:'SUBSCRIPTION',serviceStageId:null},orderBy:{sequence:'asc'}}))await payOfflineSwapPurchaseBill(h,customer,bill.id);
 const funding=await service.schedulePreview(created.id,finance);assert.equal(funding.ready,true,JSON.stringify(funding.blockers));await service.schedule(created.id,{...command(funding.revision),orderRevision:funding.orderRevision,accountRevision:funding.accountRevision,stageId:funding.stageId,stageRevision:funding.stageRevision,previewHash:funding.previewHash},finance);
 const activation=new OrderRenewalsService(h.db,()=>new Date('2027-10-01T00:00:00+08:00')),ap=await activation.activationPreview(created.id,ops);assert.equal(ap.ready,true,JSON.stringify(ap.blockers));
 const active=await activation.activate(created.id,{...command(ap.revision),orderRevision:ap.orderRevision,accountRevision:ap.accountRevision,stageId:ap.stageId,stageRevision:ap.stageRevision,previousStageRevision:ap.previousStageRevision,assignmentId:ap.assignmentId,previewHash:ap.previewHash},ops);
 const stage=await h.db.orderServiceStage.findUniqueOrThrow({where:{id:stageId}}),terms=await h.db.orderTermsVersion.findUniqueOrThrow({where:{id:active.termsVersionId}});
 assert.equal(stage.status,'ACTIVE');assert.equal(stage.kind,'RENEWAL');assert.deepEqual(terms.snapshot,q.renewalTerms);assert.equal(canonicalHash((stage.snapshot as any).swapPolicy),canonicalHash({policyVersion:'SWAP_TERM_V2',includedCount:0,extraFeeAmount:55000,sourceHash:(stage.snapshot as any).swapPolicy.sourceHash}));
 assert.equal(await h.db.swapCredit.count({where:{orderId:order.id}}),0,'renewal activation does not grant gifts or paid credits');
 return{...f,stage,stageId,terms,renewalQuote:quote};
}
