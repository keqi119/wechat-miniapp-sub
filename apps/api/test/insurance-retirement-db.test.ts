import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command,approval} from './seven-module-journey-fixtures';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {deliveryReady} from '../src/orders/readiness';
import {applicationCooperationEligible} from '../src/vehicles/application-eligibility';
import {portalPathPolicy} from '../src/owner-h5/access';
import {publishBillAutomatically} from '../src/billing/auto-publication';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';

import {coverageAt} from '../src/insurance/coverage';
import {deliveryBusinessReady} from '../src/orders/business-gates';
import {snapshotProduct} from '../src/products/snapshot';

// Real HTTP flow; only local synthetic identities/templates/channel transport are supplied by JourneyHarness.
test('no requirement configuration: real insurance approval, physical delivery and same-car renewal retain all other gates',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{await h.start();const subjectType='ENTERPRISE' as const,modular=false,allowanceKm=1500,excessPriceAmount=150,usageTemplate='unused-v1',v2PolicyDocument={id:'unused',version:0};
   const customerCount=await h.db.customer.count(),evidence=await h.proof(h.maker);
   const profile={subjectType,name:`合成${subjectType}出租方`,};
   const ownerInput={profile,idempotencyKey:randomUUID()},owner=await h.post('/admin/partners',ownerInput);
   assert.equal((await h.post('/admin/partners',ownerInput)).id,owner.id);
   await h.reject('/admin/partners',{...ownerInput,profile:{...profile,name:'同键不同资料'}},h.maker,'IDEMPOTENCY_CONFLICT');
   const model=await h.db.modelDefinition.create({data:{brand:'合成宁达',name:`N11-${subjectType}-${randomUUID()}`}});
   const vehicle=await h.post('/admin/vehicles',{modelDefinitionId:model.id,brand:'合成宁达',model:'本地EV',title:`N11 ${subjectType}合成车辆`,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,description:'全程合成车辆',conditionDisclosure:'合成车况：已检查，无待整备事项',mediaFileIds:[],...command()});
   const simpleInput={...command(),status:'ACTIVE',title:'合成分润协议',fileIds:[evidence.id],partnerRateBps:8000,vehicleIds:[vehicle.id]};
   const agreement=await h.post(`/admin/partners/${owner.id}/agreements`,simpleInput),rule=agreement.currentVersion;
   assert.deepEqual(await h.post(`/admin/partners/${owner.id}/agreements`,simpleInput),agreement);
   assert.equal(rule.partnerRateBps,8000);assert.equal(await h.db.partnerCooperationSubmission.count({where:{ownerId:owner.id}}),0);
   assert.equal(await h.db.customer.count(),customerCount);assert.equal(await h.db.partnerIdentityBinding.count({where:{ownerId:owner.id}}),0);
   assert.equal(await applicationCooperationEligible(h.db,vehicle.id,12),true,'No admin invitation or optional fields required for cooperation');
   const customer=await h.customer(`${subjectType}承租人`),outsider=await h.customer(`${subjectType}无关客户`),customerProof=await h.proof(customer,'identity'),foreignProof=await h.proof(outsider,'identity');
   const customerDocuments=await h.completeProfile(customer,customerProof);
   const benefit=await h.post('/admin/benefit-definitions',{...command(),benefit:{kind:'COUNT',name:'合成洗车服务',description:'整单一次预约洗车',provider:'合成履约方',conditions:'预约后核对履约',validity:'ORDER',unit:'次',totalQuantity:1}});
   const modules=modular?{configurationVersion:2,baseFeeAmount:8000,mileageMonthlyFeeAmount:2000,swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}}:{monthlyFeeAmount:10000,energyDescription:'自理用电'};
   const product=await h.post('/admin/products',{...command(),name:'N11合成12个月组合',months:12,...modules,mileagePerMonthKm:allowanceKm,excessMileagePriceAmount:excessPriceAmount,conditions:'仅本地合成条件',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'},{kind:'BENEFIT',benefitVersionId:benefit.id}]});
   assert.equal(product.monthlyFeeAmount,10000);assert.equal(product.configurationVersion,modular?2:1);
   if(modular)assert.equal(product.energyDescription,'充换电费用由客户自付');
   const published=await h.post(`/admin/products/${product.productId}/publish`,{...command(product.revision),versionId:product.id});
   const plan=await h.publishGoods(vehicle.id,product.id);
   const publishedVehicle=await h.post(`/admin/vehicles/${vehicle.id}/publish`,command(vehicle.revision));
   await h.reject(`/admin/vehicles/${vehicle.id}`,{title:'过期编辑不得覆盖',...command(vehicle.revision)},h.maker,'REVISION_CONFLICT','PATCH');
   assert.ok(publishedVehicle.revision>vehicle.revision);
   const policyInput={...command(),insurer:'合成保险机构',policyNumber:`N11-${randomUUID()}`,policyholder:owner.name,insuredParty:owner.name,vehicleIds:[vehicle.id],coverageItems:[{code:'SYNTHETIC_COVER',label:'合成约定保障',amount:10000,deductible:'合成免赔',terms:'合成保障条款'}],terms:'仅本地测试，不构成保单',startAt:'2026-01-01',endAt:'2035-12-31',effectiveAt:'2026-01-01',fileIds:[],requirementVersionIds:[]};
   let policy=await h.post('/admin/insurance-policies',policyInput);
   const policyProof=await h.post(`/admin/insurance-policies/${policy.id}/files`,h.form({revision:policy.revision,idempotencyKey:randomUUID(),vehicleIds:[vehicle.id]},'insurance'));
   policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}`,{...policyInput,...command(policy.versions[0].revision),fileIds:[policyProof.id]},h.maker,'PATCH');
   policy=await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/submit`,command(policy.versions[0].revision));
   for(const staff of [h.maker,h.finance,h.support]){
    const dashboard=await h.get('/admin/dashboard',staff),queues=dashboard.workbench.queues;
    assert.ok(Array.isArray(queues));assert.ok(queues.length>0);
    assert.ok(queues.every((queue:any)=>Number.isInteger(queue.count)&&queue.count>=0));
    if(staff===h.maker){assert.equal(queues.some((queue:any)=>queue.ownerRole==='FINANCE'),false);assert.ok(queues.find((queue:any)=>queue.key==='insurance-review').count>=1);}
    if(staff===h.finance)assert.equal(queues.some((queue:any)=>queue.ownerRole==='OPERATIONS'),false);
    if(staff===h.support)assert.ok(queues.every((queue:any)=>queue.ownerRole==='SUPPORT'&&queue.key!=='risk-applications'));
   }
   const policyReview={...command(policy.versions[0].revision),decision:'APPROVED',checks:[{vehicleId:vehicle.id,fileId:policyProof.id,confirmed:true,note:'已逐项核对本地合成字节'}],reason:'独立复核'};
   await h.reject(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/review`,policyReview,h.maker,'INSURANCE_SELF_REVIEW');
   // Approval is intentionally deferred until the real delivery readiness check below.

   const app=await h.post('/customer/applications',{vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:`合成${subjectType}承租人`,drivingYears:5,fileIds:[customerProof.id]},consents:[{documentId:h.docs.application.id,version:h.docs.application.version}],idempotencyKey:randomUUID()},customer);
   await h.post(`/admin/applications/${app.id}/review`,{decision:'IN_REVIEW',note:'开始核对合成申请'});
   const qualificationState=await h.get(`/admin/customers/${customer.id}/qualifications`),qualificationInput={...command(),profileHash:qualificationState.profileHash,verificationSource:'MANUAL',identityFileIds:[customerDocuments.identityFront.id,customerDocuments.identityBack.id],drivingLicenseFileIds:[customerDocuments.drivingLicense.id],identityExpiresAt:'2035-01-01T00:00:00.000Z',drivingLicenseExpiresAt:'2035-01-01T00:00:00.000Z'};
   await h.reject(`/admin/customers/${customer.id}/qualifications`,{...qualificationInput,identityFileIds:[foreignProof.id]},h.maker,'QUALIFICATION_MATERIALS_REQUIRED');
   const qualification=await h.post(`/admin/customers/${customer.id}/qualifications`,qualificationInput);
   const qualificationReview={...command(qualification.revision),qualificationId:qualification.id,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:''};
   await h.reject(`/admin/customers/${customer.id}/qualifications/reviews`,qualificationReview,h.maker,'QUALIFICATION_SELF_REVIEW');
   await h.post(`/admin/customers/${customer.id}/qualifications/reviews`,qualificationReview,h.reviewer);
   await h.reject(`/customer/files/${customerProof.id}`,undefined,outsider,'NOT_FOUND');
   await h.reject(`/admin/files/${customerProof.id}`,undefined,h.finance,'CUSTOMER_FILE_PERMISSION');
   await h.reject(`/admin/customers/${customer.id}/qualifications`,undefined,h.field,'FORBIDDEN');
   const credit=await h.post(`/customer/applications/${app.id}/credit-consent`,{documentId:h.docs['credit-verification'].id,version:h.docs['credit-verification'].version,decision:'ACCEPT',idempotencyKey:randomUUID()},customer);
   const verified=await h.post(`/admin/applications/${app.id}/credit-verifications`,{consentId:credit.consent.id,creditRevision:credit.creditRevision,band:'B700_749',customerPresented:true,idempotencyKey:randomUUID()});
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const publicationAt=new Date(new Date(`${today}T00:00:00+08:00`).getTime()-3*86400000);
   const commercialTerms=Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(k=>[k,'明确合成约定，按本单纸档复核']));
   commercialTerms.vehicleIdentification=`合成宁达本地EV；VIN：${vehicle.vin}`;
   const candidate=await h.post(`/admin/applications/${app.id}/final-plan`,{...command(app.revision),creditVerificationId:verified.verification.id,commercialTerms,monthlyFeeAmount:10000,months:12,mileagePerMonthKm:allowanceKm,excessMileagePriceAmount:excessPriceAmount,energyDescription:plan.energyDescription,benefits:plan.benefits,conditions:plan.conditions,startDate:today,firstDueDate:today});
   const riskInput={...command(candidate.revision),planRevision:candidate.finalPlan.revision,commercialHash:candidate.finalPlan.commercialHash,qualificationId:qualification.id,creditVerificationId:verified.verification.id,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reasonCodes:[],supplementaryInstructions:''};
   await h.reject(`/admin/applications/${app.id}/risk-reviews`,{...riskInput,revision:0},h.reviewer,'REVISION_CONFLICT');
   await h.post(`/admin/applications/${app.id}/risk-reviews`,riskInput,h.reviewer);
   const final=await h.db.finalPlan.findUniqueOrThrow({where:{id:candidate.finalPlan.id}}),lessor=final.lessorSnapshot as any;
   const frozenProduct=final.productSnapshot as any,frozenPolicy=final.usagePolicy as any;
   assert.equal(final.usagePolicyVersion,modular?'USAGE_V2':'USAGE_V1');assert.equal(final.mileagePerMonthKm,allowanceKm);assert.equal(final.excessMileagePriceAmount,excessPriceAmount);
   assert.equal(frozenPolicy.baseAllowanceKm,allowanceKm);assert.equal(frozenPolicy.excessPriceAmount,excessPriceAmount);
   if(modular){assert.equal(frozenProduct.configurationVersion,2);assert.equal(frozenProduct.baseFeeAmount,8000);assert.equal(frozenProduct.mileageMonthlyFeeAmount,2000);assert.equal(frozenProduct.monthlyFeeAmount,10000);assert.deepEqual(frozenProduct.swapPolicy,{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000});assert.equal(frozenPolicy.documentId,v2PolicyDocument.id);assert.equal(frozenPolicy.documentVersion,v2PolicyDocument.version);assert.equal(frozenPolicy.templateContent,usageTemplate);assert.equal(frozenPolicy.templateHash,hash(usageTemplate));assert.equal(frozenPolicy.content,usageTemplate.replace('{{baseAllowanceKm}}','2400').replace('{{excessPriceYuan}}','2.30'));assert.equal(frozenPolicy.hash,hash(frozenPolicy.content));}
   else{assert.equal('configurationVersion'in frozenProduct,false);assert.equal('swapPolicy'in frozenProduct,false);assert.equal(frozenPolicy.documentId,h.docs['usage-policy'].id);assert.equal('templateContent'in frozenPolicy,false);}
   const confirm={revision:candidate.revision,commercialHash:final.commercialHash,ownerSharing:{accepted:true,lessorHash:lessorIdentityHash(lessor),noticeHash:lessor.sharingNotice.contentHash}};
   await h.reject(`/customer/applications/${app.id}/confirm`,confirm,outsider,'NOT_FOUND');
   const order=await h.post(`/customer/applications/${app.id}/confirm`,confirm,customer);
   assert.equal(order.status,'AWAITING_CONTRACT_REVIEW');assert.equal(order.contractMode,'OFFLINE');
   assert.equal((await h.post(`/customer/applications/${app.id}/confirm`,confirm,customer)).id,order.id);
   const stored=await h.db.order.findUniqueOrThrow({where:{id:order.id}}),snapshot=stored.finalPlanSnapshot as any;
   assert.deepEqual(snapshot.productSnapshot,frozenProduct);assert.deepEqual(snapshot.usagePolicy,frozenPolicy);assert.equal(snapshot.usagePolicyVersion,final.usagePolicyVersion);
   assert.equal(snapshot.revenueRuleSnapshot.versionId,rule.id);assert.equal(snapshot.productSnapshot.productVersionId,product.id);assert.equal(snapshot.riskSnapshot.applicationId,app.id);

   assert.equal((await coverageAt(h.db,vehicle.id,product.id,new Date())).ready,false,'submitted policy cannot authorize delivery');
   assert.equal((await h.db.serial(tx=>deliveryBusinessReady(tx,order.id))).ready,false);
   await h.post(`/admin/insurance-policies/${policy.id}/versions/${policy.versions[0].id}/review`,policyReview,h.reviewer);
   assert.equal((await h.db.serial(tx=>deliveryBusinessReady(tx,order.id))).ready,true,'same actual consumer accepts approved policy with no configuration');
   const firstBill=await h.db.bill.findFirstOrThrow({where:{orderId:order.id,type:'SUBSCRIPTION',sequence:1}});
   await assert.rejects(publishBillAutomatically(h.db,firstBill.id,publicationAt),(error:any)=>error.getResponse?.().error?.code==='OFFLINE_ARCHIVE_REQUIRED');
   const rental=await h.archive('RENTAL','ORDER',order.id);
   await h.reject(`/customer/offline-archives/${rental.archiveId}/versions/${rental.versionId}/files/${rental.fileId}`,undefined,outsider,'NOT_FOUND');
   await h.reject(`/admin/offline-archives/${rental.archiveId}/versions/${rental.versionId}/files/${rental.fileId}`,undefined,h.finance,'FORBIDDEN');
   assert.equal((await h.db.contract.findFirstOrThrow({where:{orderId:order.id}})).status,'DRAFT');
   const bills=(await h.db.bill.findMany({where:{orderId:order.id,OR:[{type:'DEPOSIT'},{type:'SUBSCRIPTION',sequence:1}]}})).sort((a,b)=>Number(a.type==='DEPOSIT')-Number(b.type==='DEPOSIT'));
   const paid:any[]=[];
   for(const bill of bills){
    await h.reject(`/admin/bills/${bill.id}/publish`,{},h.finance,'BILL_AUTO_PUBLICATION_MANAGED');
    await assert.rejects(publishBillAutomatically(h.db,bill.id,new Date(publicationAt.getTime()-1)),(error:any)=>error.getResponse?.().error?.code==='BILL_AUTO_PUBLICATION_NOT_DUE');
    assert.equal((await publishBillAutomatically(h.db,bill.id,publicationAt)).published,true);
    const request=await h.post(`/customer/bills/${bill.id}/pay`,{idempotencyKey:randomUUID()},customer);
    let feedback:any;
    if(bill.type==='DEPOSIT')feedback=await h.post(`/customer/offline-archives/${rental.archiveId}/feedback`,{versionId:rental.versionId,message:'合成客户反馈：请核对签章页清晰度',idempotencyKey:randomUUID()},customer);
    h.payment.capture(request.paymentId);
    const result=await h.post(`/admin/payments/${request.paymentId}/sync`,{},h.finance);assert.equal(result.status,'SUCCEEDED');paid.push({...result,type:bill.type});await h.post(`/admin/payments/${request.paymentId}/sync`,{},h.finance);
    if(feedback){
     assert.equal(result.reconciliationRequired,true);
     assert.equal(await h.db.serial(tx=>deliveryReady(tx,order.id)),false);
     assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).status,'AWAITING_PAYMENT');
     const archive=await h.db.documentArchive.findUniqueOrThrow({where:{id:rental.archiveId}});
     await h.post(`${rental.root}/feedback/${feedback.id}/resolve`,{...command(archive.revision),resolution:'独立核对合成原件，已向客户说明当前扫描件清晰完整'},h.reviewer);
     const cashProof=await h.proof(h.finance),currentPayment=await h.db.payment.findUniqueOrThrow({where:{id:result.id}});
     const reconciliation=await h.post(`/admin/payments/${result.id}/reconciliations`,{...command(currentPayment.revision),resolution:'APPLY_TO_BILL',note:'合成渠道查证到账，档案问题已处理，按原账单入账',evidenceFileIds:[cashProof.id]},h.finance);
     const review={...command(reconciliation.paymentRevision),decision:'APPROVED',note:'另一财务权限人员独立核对合成到账与账单'};
     await h.reject(`/admin/payments/${result.id}/reconciliations/${reconciliation.id}/review`,review,h.finance,'SELF_REVIEW');
     await h.post(`/admin/payments/${result.id}/reconciliations/${reconciliation.id}/review`,review,h.reviewer);
     assert.equal((await h.db.payment.findUniqueOrThrow({where:{id:result.id}})).reconciliationRequired,false);
    }
   }
   assert.equal(paid.length,2);assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).status,'AWAITING_HANDOVER');

   assert.equal(await h.db.coverageRequirement.count({where:{scopeId:{in:[model.id,product.id]}}}),0);
   assert.equal(await h.db.serial(tx=>deliveryReady(tx,order.id)),true,'no configuration: genuine approved policy permits actual delivery');
   assert.equal((await coverageAt(h.db,vehicle.id,product.id,new Date('2036-01-01'))).ready,false,'expired policy still fails');
   const deliveryAt=new Date(Date.now()-60000).toISOString(),returnAt=new Date(Date.now()-10000).toISOString(),handoverProof=await h.proof(h.maker,'handover',true);
   const inspect=async(type:'DELIVERY'|'RETURN',actualAt:string,readingKm:number)=>{
    if(subjectType==='ENTERPRISE'&&type==='DELIVERY'){
     const task=await h.fieldInspection(order.id,actualAt,readingKm),visible=await h.get(`/customer/handovers/${task.handover.id}`,customer);
     await h.post(`/customer/handovers/${task.handover.id}/confirm`,{manifestHash:visible.manifestHash,readFileIds:visible.fileIds,fileIds:[],idempotencyKey:randomUUID()},customer);
     await h.archive('DELIVERY_RECEIPT','HANDOVER',task.handover.id,undefined,task);
     return h.db.handover.findUniqueOrThrow({where:{id:task.handover.id}});
    }
    const current=await h.db.order.findUniqueOrThrow({where:{id:order.id}});
    const created=await h.post('/admin/handovers',{orderId:order.id,type,actualAt,readingKm,fileIds:[handoverProof.id],checklist:[{label:'车况',value:'合成完好'},{label:'电量',value:'合成80%'},{label:'物品',value:'合成齐全'}],...command(current.revision)});
    await h.post(`/admin/handovers/${created.id}/publish`,command(created.revision));
    await h.reject(`/admin/handovers/${created.id}/publish`,command(created.revision-1),h.maker,'REVISION_CONFLICT');
    const visible=await h.get(`/customer/handovers/${created.id}`,customer);
    if(type==='DELIVERY'){
     await h.post(`/customer/handovers/${created.id}/confirm`,{manifestHash:visible.manifestHash,readFileIds:visible.fileIds,fileIds:[],idempotencyKey:randomUUID()},customer);
     await h.archive('DELIVERY_RECEIPT','HANDOVER',created.id);
    }
    return h.db.handover.findUniqueOrThrow({where:{id:created.id}});
   };
   const delivery=await inspect('DELIVERY',deliveryAt,100),deliveryCommand=command(delivery.revision);
   await h.post(`/admin/handovers/${delivery.id}/complete`,deliveryCommand);
   await h.post(`/admin/handovers/${delivery.id}/complete`,deliveryCommand);
   if(subjectType==='ENTERPRISE'){
    assert.ok(delivery.fieldTaskId);
    assert.equal((await h.db.fieldHandoverTask.findUniqueOrThrow({where:{id:delivery.fieldTaskId}})).status,'COMPLETED');
   }else assert.equal(delivery.fieldTaskId,null);
   assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).status,'ACTIVE');

   // Same-car renewal consumes the same genuine approved policy. No requirement configuration is created.
   const lastUsage=await h.db.legalDocument.aggregate({where:{type:'usage-policy-v2'},_max:{version:true}});await h.db.legalDocument.create({data:{type:'usage-policy-v2',version:(lastUsage._max.version||0)+1,title:'无配置续期合成里程规则',content:'每月 {{baseAllowanceKm}} 公里，超额每公里 {{excessPriceYuan}} 元。',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
   const nextProduct=await h.post('/admin/products',{...command(),configurationVersion:2,name:'无要求配置续期产品',months:12,baseFeeAmount:18000,mileageMonthlyFeeAmount:2000,mileagePerMonthKm:2400,excessMileagePriceAmount:230,swapPolicy:{version:2,period:'TERM',includedCount:0,extraFeeAmount:55000},conditions:'真实原件保障及无配置续期测试',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]});
   await h.post(`/admin/products/${nextProduct.productId}/publish`,{...command(nextProduct.revision),versionId:nextProduct.id});
   const renewalPlan=await h.publishGoods(vehicle.id,nextProduct.id),source=await h.db.serial(tx=>snapshotProduct(tx,renewalPlan.id));
   const renewalContext=await h.get(`/admin/orders/${order.id}/renewal-context`);assert.equal(renewalContext.eligible,true);
   const renewalInput={listingId:source.listingId,listingRevision:source.listingRevision,productVersionId:source.productVersionId,listingSourceHash:source.sourceHash,orderRevision:renewalContext.orderRevision,accountRevision:renewalContext.accountRevision,reason:'相同实际车辆续期',expiresAt:new Date(Date.now()+86400000).toISOString(),settlementExplanation:'原押金与旧期不变',cancellationTerms:'服务端固定规则'};
   const preview=await h.post(`/admin/orders/${order.id}/renewals/preview`,renewalInput);assert.equal(preview.monthlyFeeAmount,20000);assert.equal(preview.months,12);
   const created=await h.post(`/admin/orders/${order.id}/renewals`,{...renewalInput,previewHash:preview.previewHash,idempotencyKey:randomUUID()});assert.equal((await h.db.orderChange.findUniqueOrThrow({where:{id:created.id}})).kind,'SUBSCRIPTION_EXTENSION');
   assert.equal(await h.db.coverageRequirement.count({where:{scopeId:{in:[model.id,product.id,nextProduct.id]}}}),0);
   const approved=await h.db.insurancePolicyVersion.findUniqueOrThrow({where:{id:policy.versions[0].id}});assert.equal(approved.status,'APPROVED');assert.deepEqual(approved.requirementVersionIds,[]);assert.equal(JSON.stringify(approved.reviewChecks).includes('requirementVersionId'),false);
   const before=await h.db.order.findUniqueOrThrow({where:{id:order.id}});assert.deepEqual(before.finalPlanSnapshot,snapshot);assert.equal(before.vehicleId,vehicle.id);assert.equal(h.externalCalls,0);
 }finally{await h.close();}
});
