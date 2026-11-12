import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';

test('isolated database: manual documents submit without provider identity, but qualification approval still gates the customer final offer',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const previous=process.env.CUSTOMER_IDENTITY_POLICY;process.env.CUSTOMER_IDENTITY_POLICY='MANUAL_REVIEW';const h=new JourneyHarness();
 try{
  await h.start();
  const owner=await h.post('/admin/partners',{profile:{subjectType:'INDIVIDUAL',name:'合成人工资料出租方'},idempotencyKey:randomUUID()}),proof=await h.proof(h.maker);
  const model=await h.db.modelDefinition.create({data:{brand:'合成',name:'人工资料-'+randomUUID()}});
  const vehicle=await h.post('/admin/vehicles',{modelDefinitionId:model.id,brand:'合成',model:'人工资料测试',title:'合成人工资料车辆',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,description:'仅本地合成车辆',conditionDisclosure:'仅本地合成车况',mediaFileIds:[],...command()});
  await h.post(`/admin/partners/${owner.id}/agreements`,{...command(),status:'ACTIVE',title:'合成人工资料合作',fileIds:[proof.id],partnerRateBps:8000,vehicleIds:[vehicle.id]});
  const product=await h.post('/admin/products',{...command(),name:'合成人工资料12月',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自理用电',conditions:'仅本地合成',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]});
  await h.post(`/admin/products/${product.productId}/publish`,{...command(product.revision),versionId:product.id});
  const plan=await h.publishGoods(vehicle.id,product.id);await h.post(`/admin/vehicles/${vehicle.id}/publish`,command(vehicle.revision));
  const customer=await h.customer('人工资料客户');
  const files=[];for(const slot of ['front','back','license'])files.push(await h.proof(customer,'identity'));
  const saved=await h.post('/customer/profile',{...command(),name:'合成人工资料客户',drivingYears:5,identityFrontFileId:files[0].id,identityBackFileId:files[1].id,drivingLicenseFileId:files[2].id},customer,'PUT');
  assert.equal(saved.readiness.identityPolicy,'MANUAL_REVIEW');assert.equal(saved.readiness.readyForApplication,true);assert.equal(saved.readiness.realNameVerified,false);
  assert.equal(await h.db.eSignAccount.count({where:{customerId:customer.id}}),0);
  const input={vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:'客户端不能替换存档姓名',fileIds:[]},consents:[{documentId:h.docs.application.id,version:h.docs.application.version}],idempotencyKey:randomUUID()};
  const app=await h.post('/customer/applications',input,customer);assert.equal(app.status,'SUBMITTED');assert.equal((await h.post('/customer/applications',input,customer)).id,app.id);
  const persisted=await h.db.application.findUniqueOrThrow({where:{id:app.id}}),snapshot=(persisted.profile as any).customerProfileSnapshot;
  assert.equal(snapshot.version,2);assert.equal(snapshot.identityPolicy,'MANUAL_REVIEW');assert.equal(snapshot.identity,null);assert.equal(snapshot.name,'合成人工资料客户');assert.equal(snapshot.documents.drivingLicense.id,files[2].id);
  const identity=await h.get('/customer/identity/readiness',customer);assert.equal(identity.verified,false);assert.equal(identity.identityPolicy,'MANUAL_REVIEW');
  for(const path of ['/customer/identity/register','/customer/identity/refresh']){const closed=await h.raw(path,{},customer);assert.equal(closed.status,503);assert.equal(closed.data.error.code,'CUSTOMER_IDENTITY_UNAVAILABLE');}
  await h.post(`/admin/applications/${app.id}/review`,{decision:'IN_REVIEW',note:'开始人工资料审核'});
  const credit=await h.post(`/customer/applications/${app.id}/credit-consent`,{documentId:h.docs['credit-verification'].id,version:h.docs['credit-verification'].version,decision:'ACCEPT',idempotencyKey:randomUUID()},customer);
  const verification=await h.post(`/admin/applications/${app.id}/credit-verifications`,{consentId:credit.consent.id,creditRevision:credit.creditRevision,band:'B700_749',customerPresented:true,idempotencyKey:randomUUID()});
  const defaults=await h.get(`/admin/applications/${app.id}/final-plan-defaults`),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const commercialTerms=Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(k=>[k,'明确合成约定，仅本地人工资料验证']));
  const candidate=await h.post(`/admin/applications/${app.id}/final-plan`,{...command(app.revision),productSourceHash:defaults.values.productSourceHash,creditVerificationId:verification.verification.id,commercialTerms,monthlyFeeAmount:10000,months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:plan.energyDescription,benefits:plan.benefits,conditions:plan.conditions,startDate:today,firstDueDate:today});
  const risk={...command(candidate.revision),planRevision:candidate.finalPlan.revision,commercialHash:candidate.finalPlan.commercialHash,qualificationId:'missing-qualification',creditVerificationId:verification.verification.id,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reasonCodes:[],supplementaryInstructions:''};
  await h.reject(`/admin/applications/${app.id}/risk-reviews`,risk,h.reviewer,'CUSTOMER_QUALIFICATION_REQUIRED');
  assert.equal((await h.get(`/customer/applications/${app.id}`,customer)).finalPlan,null);
  const qualificationState=await h.get(`/admin/customers/${customer.id}/qualifications`),qualification=await h.post(`/admin/customers/${customer.id}/qualifications`,{...command(),profileHash:qualificationState.profileHash,verificationSource:'MANUAL',identityFileIds:files.slice(0,2).map(f=>f.id),drivingLicenseFileIds:[files[2].id],identityExpiresAt:'2099-01-01T00:00:00.000Z',drivingLicenseExpiresAt:'2099-01-01T00:00:00.000Z'});
  await h.reject(`/admin/applications/${app.id}/risk-reviews`,{...risk,idempotencyKey:randomUUID(),qualificationId:qualification.id},h.reviewer,'CUSTOMER_QUALIFICATION_REQUIRED');
  assert.equal((await h.db.application.findUniqueOrThrow({where:{id:app.id}})).status,'IN_REVIEW');assert.equal(await h.db.order.count({where:{applicationId:app.id}}),0);
  await h.post(`/admin/customers/${customer.id}/qualifications/reviews`,{...command(qualification.revision),qualificationId:qualification.id,decision:'APPROVED',reasonCodes:[],supplementaryInstructions:''},h.reviewer);
  await h.post(`/admin/applications/${app.id}/risk-reviews`,{...risk,idempotencyKey:randomUUID(),qualificationId:qualification.id},h.reviewer);
  assert.equal((await h.get(`/customer/applications/${app.id}`,customer)).status,'AWAITING_CONFIRMATION');
  assert.equal((await h.get('/customer/profile',customer)).readiness.realNameVerified,false);assert.equal(await h.db.eSignAccount.count({where:{customerId:customer.id}}),0);assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();if(previous===undefined)delete process.env.CUSTOMER_IDENTITY_POLICY;else process.env.CUSTOMER_IDENTITY_POLICY=previous;}
});
