import {cooperationBusinessHash} from '../src/offline-documents/snapshot';
import {seedTrustedCustomerProfile} from './customer-profile-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {RiskReviewService} from '../src/applications/risk-review';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {hash} from '../src/common/data';
import {leaseRange,quoteReady,deliveryBusinessReady} from '../src/orders/business-gates';
import {applicationView,ApplicationsController} from '../src/applications/applications';
import {orderGuidance} from '../src/orders/customer-order-view';
import {customerContractRecord} from '../src/orders/customer-contract-view';
import {customerHandoverSigningReadiness} from '../src/orders/customer-handover-view';
import {policySummaries,SevenModuleViewsController} from '../src/orders/seven-module-views';
import {CustomerController,recordView} from '../src/orders/customer';
import {customerProfileHash,qualificationEvidence} from '../src/customers/qualifications';
import {canonicalHash} from '../src/customers/types';
import {riskPlanInputHash,riskVehicleInputHash} from '../src/applications/risk-review';
import {buildOfflineLessorSnapshot} from '../src/owner-signing/lessor';
import {snapshotProduct} from '../src/products/snapshot';
import {snapshotRevenueRule} from '../src/partners/revenue-rules';
import {GoodsController} from '../src/goods/controller';

const denied=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
async function fixture(){
 const owner:any={id:'owner',subjectType:'INDIVIDUAL',name:'合成出租方',creditCode:null,address:'合成地址',contactPhone:'13800000000',revision:1,status:'DRAFT'};
 const customer:any={id:'customer',name:'合成客户',mobile:'13900000000',profile:{},drivingYears:5,legalIdentityFileId:null};
 const vehicle:any={id:'vehicle',brand:'合成',model:'EV',modelDefinitionId:'model',year:2026,vin:'SYNTHETIC',mileageKm:100,status:'PUBLISHED',reservedOrderId:null,holdId:null};
 const product:any={id:'product-version',productId:'product',version:1,status:'PUBLISHED',name:'合成产品',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'按约定用电',conditions:'合成条件',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const app:any={id:'app',customerId:'customer',vehicleId:'vehicle',subscriptionPlanId:'plan',profile:{name:'合成客户'},revision:1,creditRevision:1,status:'AWAITING_CONFIRMATION'};
 const plan:any={id:'final',applicationId:'app',revision:1,reviewStatus:'APPROVED',contractMode:'OFFLINE',commercialHash:hash('quote'),creditVerificationId:'credit',creditRevision:1,creditBand:'GE750',creditRuleVersion:'ZHIMA_MANUAL_V1',monthlyFeeAmount:10000,depositAmount:0,months:12,startDate:new Date('2026-11-01'),firstDueDate:new Date('2026-11-01'),mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'按约定用电',conditions:'合成条件',benefits:[]};
 const scope={vehicleIds:['vehicle'],validFrom:'2026-01-01',validUntil:'2030-12-31'};
 const cooperation:any={id:'cooperation',currentApprovedVersionId:'cooperation-version',versions:[{id:'cooperation-version',status:'ARCHIVED',scopeSnapshot:scope,businessSnapshotHash:cooperationBusinessHash('owner',1,scope)}]};
 const relation:any={id:'identity',ownerId:'owner',relationship:'SELF',profileRevision:1,revision:1,status:'APPROVED',reviewedBy:'reviewer',reviewedAt:new Date()};
 const domains=['SUBJECT','VEHICLE','ARCHIVE','RULE'].map(domain=>({domain,resourceId:domain,revision:1,hash:'a'.repeat(64)}));
 const verification:any={id:'partner-verification',revision:1,status:'APPROVED',profileRevision:1,submittedBy:'maker',reviewedBy:'reviewer',reviewedAt:new Date(),domainVersions:domains,completedActions:domains.map(d=>`${d.domain}:${d.resourceId}`),submissionHash:'c'.repeat(64)};
 const terms={cooperationVersionId:'cooperation-version',vehicleIds:['vehicle'],validFrom:scope.validFrom,validUntil:scope.validUntil,method:'RATE',rateBps:3000,fixedMonthlyAmount:null,customAgreement:null,basis:'实际订阅收入',deductions:'无',refundRule:'退款按约定调整',cycle:'每月',expenseResponsibility:'按合作协议'};
 const rule:any={id:'rule-version',ruleId:'rule',ownerId:'owner',version:1,status:'APPROVED',cooperationVersionId:'cooperation-version',terms,contentHash:hash(terms)};
 const file={id:'qualification-file',customerId:'customer',adminId:null,purpose:'identity',sha256:hash('proof'),mimeType:'image/jpeg'};
 const qualification:any={id:'qualification',customerId:'customer',revision:1,status:'APPROVED',profileHash:customerProfileHash(customer),identityFileIds:[file.id],drivingLicenseFileIds:[file.id],identityExpiresAt:new Date('2035-01-01'),drivingLicenseExpiresAt:new Date('2035-01-01'),submittedBy:'maker',reviewedBy:'reviewer',reviewedAt:new Date()};
 const consent={id:'consent',applicationId:'app',customerId:'customer',revision:1,version:1,documentId:'credit-verification',status:'ACCEPTED'};
 const credit={id:'credit',applicationId:'app',consentId:'consent',revision:1,band:'GE750',ruleVersion:'ZHIMA_MANUAL_V1'};
 const requirement={id:'requirement-version',items:[{code:'COLLISION',label:'约定车辆保障',description:'合成要求',minAmount:null,deductibleReview:'按保单核对',exclusionReview:'按保单核对'}]};
 const policy:any={id:'policy-version',policyId:'policy',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),startAt:new Date('2026-01-01'),endAt:new Date('2027-01-01'),vehicleIds:['vehicle'],fileIds:['policy-file'],coverageItems:[{code:'COLLISION',label:'约定车辆保障',amount:null,deductible:'合成',terms:'合成'}],requirementVersionIds:[requirement.id],reviewChecks:[{vehicleId:'vehicle',requirementVersionId:requirement.id,itemCode:'COLLISION',fileId:'policy-file',confirmed:true,note:'合成核对'}]};
 let risk:any;const order:any={id:'order',applicationId:'app',customerId:'customer',vehicleId:'vehicle',contractMode:'OFFLINE',status:'AWAITING_HANDOVER',effectiveTermsVersionId:null};
 const tx:any={vehicleOperationalRestriction:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},archiveFeedback:{count:async()=>0},$queryRaw:async()=>[],$executeRaw:async()=>1,application:{findUnique:async()=>app,findFirst:async()=>({...app,finalPlans:[plan],order:app.order,vehicle,subscriptionPlan:{id:'plan',name:'合成产品'}})},finalPlan:{findFirst:async()=>plan},vehicle:{findUnique:async()=>vehicle},customer:{findUnique:async()=>customer},subscriptionPlan:{findUnique:async()=>({id:'plan',vehicleId:vehicle.id,productVersionId:product.id,active:product.status==='PUBLISHED',vehicle,productVersion:product,listing:{id:'legacy-listing',revision:1,vehicleId:vehicle.id,productVersionId:product.id,subscriptionPlanId:'plan',status:'PUBLISHED',visible:true,source:'LEGACY_MIGRATED'}})},productVersion:{findUnique:async()=>product},ownerVehicle:{findUnique:async()=>({id:'binding',revision:1,ownerId:'owner',owner,vehicleId:'vehicle',status:'APPROVED',reviewedBy:'reviewer',reviewedAt:new Date(),evidenceFileId:'owner-file'})},vehicleOwner:{findUnique:async()=>owner},partnerCooperationSubmission:{findFirst:async()=>verification},partnerIdentityBinding:{findUnique:async()=>relation},storedFile:{findUnique:async()=>({id:'owner-file',sha256:hash('owner-proof')}),findMany:async()=>[file]},documentArchive:{findFirst:async()=>cooperation},legalDocument:{findFirst:async({where}:any)=>({id:where.type,version:1,title:'合成协议',content:where.type==='owner-data-sharing'?'{{lessorName}} {{lessorCreditCode}} {{lessorAddress}} {{lessorPhone}}':'合成正式文案',confirmedBy:'reviewer',confirmedAt:new Date()})},partnerRevenueRule:{findMany:async()=>[{currentApprovedVersionId:rule.id}]},partnerRevenueRuleVersion:{findMany:async()=>rule.status==='APPROVED'?[rule]:[]},customerQualificationVersion:{findFirst:async()=>qualification},creditConsent:{findFirst:async()=>consent,findUnique:async()=>consent},creditVerification:{findFirst:async()=>credit},applicationRiskReview:{findFirst:async()=>risk,findUnique:async()=>risk},order:{findUnique:async()=>order},coverageRequirement:{findMany:async()=>[{scopeType:'MODEL',versions:[requirement]}]},insurancePolicy:{findMany:async()=>[{versions:[policy]}]}};
 qualification.evidenceHash=(await qualificationEvidence(tx,'customer',qualification)).evidenceHash;
 plan.productSnapshot=await snapshotProduct(tx,'plan');plan.lessorSnapshot=await buildOfflineLessorSnapshot(tx,'vehicle',leaseRange(plan.startDate,12));plan.revenueRuleSnapshot=await snapshotRevenueRule(tx,'owner','vehicle','2026-11-01','2027-10-31');
 risk={id:'risk',applicationId:'app',customerId:'customer',decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,finalPlanId:'final',planRevision:1,applicationRevision:1,commercialHash:plan.commercialHash,planInputHash:riskPlanInputHash(plan),profileHash:customerProfileHash(customer),applicationProfileHash:canonicalHash(app.profile),vehicleId:'vehicle',vehicleInputHash:riskVehicleInputHash(vehicle),qualificationId:qualification.id,qualificationRevision:1,creditVerificationId:'credit',creditVerificationRevision:1,creditConsentId:'consent',creditConsentRevision:1,creditConsentVersion:1,creditRevision:1,reviewedAt:new Date()};
 order.finalPlanSnapshot={...plan,riskSnapshot:{reviewId:risk.id,applicationId:app.id,customerId:customer.id,qualificationId:qualification.id,qualificationRevision:1,planId:plan.id,planRevision:1,commercialHash:plan.commercialHash}};
 return{tx,owner,customer,vehicle,product,app,plan,rule,qualification,consent,policy,order,risk,cooperation};
}

test('lease coverage uses actual inclusive end day including clamped month boundaries',()=>{
 assert.deepEqual(leaseRange('2026-11-01',12),{startDate:'2026-11-01',endDate:'2027-10-31'});
 assert.deepEqual(leaseRange('2028-02-29',12),{startDate:'2028-02-29',endDate:'2029-02-27'});
});
test('offline lessor identity remains identical after JSONB reorders the frozen lease object',async()=>{
 const f=await fixture(),snapshot=f.plan.lessorSnapshot;
 assert.equal(lessorIdentityHash({...snapshot,leaseRange:{endDate:snapshot.leaseRange.endDate,startDate:snapshot.leaseRange.startDate}}),lessorIdentityHash(snapshot));
});
test('quote gate is ready only for an approved current candidate and freezes all independent facts',async()=>{
 const f=await fixture(),gate=await quoteReady(f.tx,'app',1);assert.equal(gate.ready,true);assert.equal(gate.snapshots?.riskSnapshot.reviewId,'risk');assert.equal(gate.snapshots?.revenueRuleSnapshot.versionId,'rule-version');
 for(const mutate of [(x:any)=>x.product.status='RETIRED',(x:any)=>x.rule.status='REJECTED',(x:any)=>x.customer.name='资料已变更',(x:any)=>x.vehicle.reservedOrderId='other',(x:any)=>x.plan.reviewStatus='DRAFT']){const g=await fixture();mutate(g);assert.equal((await quoteReady(g.tx,'app',1)).ready,false);}
});
test('delivery rechecks current partner and coverage while product retirement leaves a formed contract intact',async()=>{
 const f=await fixture();f.product.status='RETIRED';const gate=await deliveryBusinessReady(f.tx,'order',new Date('2026-11-01T00:00:00Z'));assert.equal(gate.ready,true);assert.deepEqual(gate.coverageEvidence?.policyVersionIds,['policy-version']);
 for(const mutate of [(x:any)=>x.owner.status='SUSPENDED',(x:any)=>x.policy.endAt=new Date('2026-10-01'),(x:any)=>x.policy.changeKind='CANCELLATION',(x:any)=>delete x.order.finalPlanSnapshot.riskSnapshot]){const g=await fixture();mutate(g);const result=await deliveryBusinessReady(g.tx,'order',new Date('2026-11-01T00:00:00Z'));assert.equal(result.ready,false);assert.ok(result.blockers[0].resourceType);}
});

test('explicit process recheck advances only a fully ready order and its retry cannot advance or audit twice',async()=>{
 const {OrderProcessController}=await import('../src/orders/order-process.controller');
 const f=await fixture(),actor={id:'admin',role:'ADMIN',active:true,authVersion:1},now=new Date();
 Object.assign(f.order,{status:'AWAITING_PAYMENT',revision:3});
 const rental={id:'rental',kind:'RENTAL',subjectType:'ORDER',subjectId:f.order.id,orderId:f.order.id,currentApprovedVersionId:'rental-version',versions:[{id:'rental-version',version:1,status:'ARCHIVED',businessSnapshotHash:f.plan.commercialHash,files:[],feedback:[]}]};
 const bill={id:'first-rent',orderId:f.order.id,type:'SUBSCRIPTION',sequence:1,status:'PAID',amount:10000,paidAmount:10000,dueDate:now,payments:[{id:'receipt',status:'SUCCEEDED',amount:10000,reconciliationRequired:false,refunds:[]}]};
 const commands:any[]=[],audits:any[]=[];let advances=0;
 Object.assign(f.tx,{
  adminUser:{findUnique:async()=>actor},archiveCommand:{findUnique:async()=>commands[0]||null,create:async({data}:any)=>{commands.push(data);return data;}},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  documentArchive:{findMany:async()=>[rental],findFirst:async({where}:any)=>where.kind==='RENTAL'?rental:where.kind==='OWNER_COOPERATION'?f.cooperation:null},
  bill:{findMany:async()=>[bill]},fieldHandoverTask:{findMany:async()=>[]},handover:{findMany:async()=>[]},vehicleReceiptEvent:{findMany:async()=>[]},returnSettlement:{findMany:async()=>[]},
  orderChange:{findMany:async()=>[],count:async()=>0},usageAccount:{findUnique:async()=>null},offlineCancellationReview:{findFirst:async()=>null},
  order:{findUnique:async()=>({...f.order}),findUniqueOrThrow:async()=>({...f.order}),updateMany:async({data}:any)=>{advances++;Object.assign(f.order,data);return{count:1};},update:async({data}:any)=>{f.order.revision+=data.revision.increment;return{...f.order};}}
 });
 const controller=new OrderProcessController({serial:async(fn:any)=>fn(f.tx)} as any),input={revision:3,idempotencyKey:randomUUID()};
 const result=await controller.recheck(f.order.id,input,{admin:actor});
 assert.equal(result.status,'AWAITING_HANDOVER');assert.equal(result.revision,4);assert.equal(advances,1);assert.equal(audits.length,1);
 assert.deepEqual(await controller.recheck(f.order.id,input,{admin:actor}),result);assert.equal(advances,1);assert.equal(audits.length,1);
 await assert.rejects(controller.recheck(f.order.id,{...input,revision:4},{admin:actor}),denied('IDEMPOTENCY_CONFLICT'));
});

test('read-only completion preview accepts consistent real delivery facts and current business evidence without locks',async()=>{
 const {readHandoverCompletion}=await import('../src/orders/order-process-handover'),{usageRules}=await import('../src/usage/policy');
 const f=await fixture(),now=new Date('2026-11-01T04:00:00Z'),content='仅合成用量规则';
 Object.assign(f.vehicle,{status:'RESERVED',reservedOrderId:f.order.id});Object.assign(f.order,{confirmedMileageKm:100});
 const snapshot={...f.order.finalPlanSnapshot,startDate:'2026-11-01',usagePolicyVersion:'USAGE_V1',mileagePerMonthKm:1500,excessMileagePriceAmount:150,usagePolicy:{...usageRules,documentId:'usage',documentVersion:1,content,hash:hash(content)}};
 f.order.finalPlanSnapshot=snapshot;f.tx.$queryRaw=async()=>{throw new Error('Read preview must not lock');};
 const result=await readHandoverCompletion(f.tx,{order:f.order,now,vehicle:f.vehicle,snapshot,changes:[],archives:[],usage:null},{type:'DELIVERY',customerId:f.order.customerId,executionMode:'OFFLINE',readingKm:100,actualAt:now});
 assert.deepEqual(result,{ready:true,blockers:[]});
});
test('independently reviewed credential renewal can restore delivery without changing the signed party',async()=>{
 const f=await fixture();f.qualification.id='renewed-qualification';f.qualification.revision=2;
 assert.equal((await deliveryBusinessReady(f.tx,'order',new Date('2026-11-01'))).ready,true);
 f.customer.name='另一位客户姓名';f.qualification.profileHash=customerProfileHash(f.customer);
 assert.equal((await deliveryBusinessReady(f.tx,'order',new Date('2026-11-01'))).ready,false);
});
test('effective terms cannot hide missing offline product or risk evidence',async()=>{
 const f=await fixture();f.order.effectiveTermsVersionId='effective';f.tx.orderTermsVersion={findUnique:async()=>({id:'effective',orderId:'order',snapshot:{...f.order.finalPlanSnapshot,productSnapshot:null}})};
 assert.equal((await deliveryBusinessReady(f.tx,'order',new Date('2026-11-01'))).ready,false);
});
test('customer application projections omit internal risk, revenue and candidate plan data',async()=>{
 const f=await fixture();const a={...f.app,vehicle:f.vehicle,subscriptionPlan:{id:'plan',name:'合成产品',productVersion:{internal:'secret'}},finalPlans:[f.plan],order:{id:'order',finalPlanSnapshot:f.order.finalPlanSnapshot},creditRevision:44};
 const result=applicationView(a),raw=JSON.stringify(result);assert.equal(raw.includes('revenueRuleSnapshot'),false);assert.equal(raw.includes('creditBand'),false);assert.equal(raw.includes('reviewer'),false);assert.equal(raw.includes('internal'),false);assert.equal(result.finalPlan?.lessorSnapshot.subjectType,'INDIVIDUAL');
 f.plan.reviewStatus='DRAFT';a.status='IN_REVIEW';assert.equal(applicationView(a).finalPlan,null);
});
test('created order confirmation retry returns a safe existing identity before retired-product validation',async()=>{
 const f=await fixture();f.app.status='FINAL_PLAN_CONFIRMED';f.app.order={id:'order',status:'AWAITING_CONTRACT_REVIEW',contractMode:'OFFLINE',finalPlanSnapshot:f.order.finalPlanSnapshot};f.product.status='RETIRED';
 const api=new ApplicationsController({serial:async(fn:any)=>fn(f.tx)} as any),result=await api.confirm('app',{revision:1,commercialHash:f.plan.commercialHash},{customer:{id:'customer'}});
 assert.equal(result.id,'order');assert.equal('finalPlanSnapshot' in result,false);
});
test('offline progress explains paperwork review without implying electronic signature',()=>{
 assert.match(orderGuidance('AWAITING_CONTRACT_REVIEW',[],[]).description,/线下|纸质/);
});

test('customer offline contracts show only approved paper archives and never call signing readers',async()=>{
 const f=await fixture(),file={fileId:'paper-file',position:1,versionId:'archive-version',file:{id:'paper-file',purpose:'offline-archive',name:'合同扫描件.pdf',mimeType:'application/pdf',size:100,sha256:hash('paper')}};
 const version:any={id:'archive-version',version:1,status:'ARCHIVED',businessSnapshotHash:f.plan.commercialHash,files:[file],feedback:[],signedOn:'2026-11-01',contractNumber:'合成-01'};
 const archive:any={id:'archive',orderId:'order',kind:'RENTAL',subjectType:'ORDER',subjectId:'order',currentApprovedVersionId:version.id,versions:[version]};
 const c={id:'contract',kind:'SUBSCRIPTION',customerId:'customer',orderId:'order',executionMode:'OFFLINE',offlineArchiveId:'archive',documentHash:f.plan.commercialHash,status:'DRAFT',createdAt:new Date(),updatedAt:new Date()};
 const db:any={documentArchive:{findFirst:async()=>archive},order:{findFirst:async()=>f.order}};
 const result=await customerContractRecord(db,'customer',c,f.order);assert.equal(result.contractDetail.canSign,false);assert.equal(result.contractDetail.canQuery,false);assert.equal(result.contractDetail.phase,'OFFLINE_ARCHIVED');assert.equal(result.contractDetail.parties.length,3);assert.equal(result.documents.length,1);assert.match(result.documents[0].url,/offline-archives\/archive\/versions\/archive-version/);assert.equal(JSON.stringify(result).includes('storagePath'),false);
 version.status='SUBMITTED';archive.currentApprovedVersionId=null;const pending=await customerContractRecord(db,'customer',c,f.order);assert.equal(pending.documents.length,0);assert.equal(pending.contractDetail.phase,'OFFLINE_REVIEWING');
});
test('customer confirmation of inspection is distinct from a reviewed paper handover',async()=>{
 const item:any={id:'handover',customerId:'customer',orderId:'order',type:'DELIVERY',executionMode:'OFFLINE',offlineArchiveId:'handover-archive',manifestHash:hash('facts'),revision:1,status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:new Date(),actualAt:new Date(),signatureStatus:'DRAFT'};
 const archive:any={id:'handover-archive',orderId:'order',handoverId:'handover',kind:'DELIVERY_RECEIPT',subjectType:'HANDOVER',subjectId:'handover',currentApprovedVersionId:null,versions:[]};
 const db:any={order:{findFirst:async()=>({id:'order',customerId:'customer',contractMode:'OFFLINE'})},documentArchive:{findFirst:async()=>archive}};
 const pending=await customerHandoverSigningReadiness(db,'customer',item);assert.equal(pending.canSign,false);assert.equal(pending.stage,'PAPER_PENDING');assert.match(pending.message,/纸质/);
 archive.currentApprovedVersionId='paper';archive.versions.push({id:'paper',version:1,status:'ARCHIVED',businessSnapshotHash:item.manifestHash,files:[],feedback:[]});assert.equal((await customerHandoverSigningReadiness(db,'customer',item)).stage,'PAPER_ARCHIVED');
 item.manifestHash=hash('revised-facts');assert.equal((await customerHandoverSigningReadiness(db,'customer',item)).stage,'PAPER_REVIEWING');
});

test('insurance summaries cannot leak private policy fields or removed vehicle cover',()=>{
 const version:any={id:'v1',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),startAt:new Date('2026-01-01'),endAt:new Date('2027-01-01'),vehicleIds:['mine','foreign'],policyholder:'secret policyholder',insuredParty:'secret party',premiumAmount:123456,fileIds:['secret-file'],coverageItems:[{code:'C',label:'约定保障',amount:10000,deductible:'secret clauses'}]};
 const policy={id:'policy',insurer:'合成保险',policyNumber:'SYNTHETIC1234',versions:[version]};
 const [result]=policySummaries([policy],['mine'],new Date('2026-10-01'));assert.equal(result.status,'ACTIVE');assert.deepEqual(result.vehicleIds,['mine']);assert.equal(result.policyNumberLast4,'1234');assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('foreign'),false);
 policy.versions.push({...version,id:'v2',version:2,vehicleIds:['foreign'],effectiveAt:new Date('2026-09-01')});assert.equal(policySummaries([policy],['mine'],new Date('2026-10-01')).length,0);
 assert.equal(policySummaries([{...policy,versions:[{...version,status:'SUBMITTED'}]}],['mine'],new Date('2026-10-01')).length,0);
});
test('customer insurance summary checks order ownership before querying vehicle policies',async()=>{
 let queried=false;const tx:any={order:{findFirst:async()=>null},insurancePolicy:{findMany:async()=>{queried=true;return[];}}},api=new SevenModuleViewsController({serial:async(fn:any)=>fn(tx)} as any);
 await assert.rejects(api.customerInsurance('foreign-order',{customer:{id:'customer'}}),denied('NOT_FOUND'));assert.equal(queried,false);
});
test('dashboard and generic entitlement records expose balances without private business snapshots',async()=>{
 const f=await fixture(),entitlement:any={id:'entitlement',customerId:'customer',orderId:'order',kind:'COUNT',status:'ACTIVE',title:'洗车',description:'三次洗车',unit:'次',totalQuantity:3,sourceSnapshot:{provider:'宁达安排',conditions:'预约',privateSecret:'secret'},sourceHash:'private-hash',revision:0,createdAt:new Date()};
 const generic=recordView('entitlements',entitlement);assert.equal(JSON.stringify(generic).includes('private'),false);assert.equal(JSON.stringify(generic).includes('secret'),false);
 f.order.status='AWAITING_CONTRACT_REVIEW';f.order.vehicle=f.vehicle;f.vehicle.plans=[];Object.assign(f.tx,{order:{findFirst:async()=>f.order},application:{findFirst:async()=>null},bill:{findMany:async()=>[]},serviceRequest:{findMany:async()=>[]},entitlement:{findMany:async()=>[entitlement]},entitlementReservation:{findMany:async()=>[{status:'RESERVED',quantity:1}]},entitlementLedger:{findMany:async()=>[{type:'CONSUME',quantity:1}]},handover:{findFirst:async()=>null},vehicleAssignment:{count:async()=>0},orderChange:{findFirst:async()=>null},customerConsent:{findMany:async()=>[]}});
 f.tx.eSignAccount={findUnique:async()=>null};
 const dashboard=await new CustomerController(f.tx).dashboard({customer:f.customer}),json=JSON.stringify(dashboard);assert.equal(json.includes('revenueRuleSnapshot'),false);assert.equal(json.includes('riskSnapshot'),false);assert.equal(json.includes('sourceSnapshot'),false);assert.equal(dashboard.subscription?.statusText,'线下合同待归档');assert.equal(dashboard.entitlements[0].availableQuantity,1);
});

test('database candidate review and concurrent customer confirmations freeze one offline order',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),before=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{
  const seed=randomUUID(),maker=await db.adminUser.create({data:{username:'n07-maker-'+seed,name:'合成经办',role:'OPERATIONS',passwordHash:'synthetic'}}),reviewer=await db.adminUser.create({data:{username:'n07-reviewer-'+seed,name:'合成复核',role:'ADMIN',passwordHash:'synthetic'}});
  const docs:Record<string,any>={};for(const type of ['terms','privacy','usage-policy','credit-verification','OFFLINE_RENTAL','owner-data-sharing']){const max=await db.legalDocument.aggregate({where:{type},_max:{version:true}});docs[type]=await db.legalDocument.create({data:{type,version:(max._max.version||0)+1,title:'合成-'+type,content:type==='owner-data-sharing'?'向实际出租方 {{lessorName}} 提供本订单必要资料':'仅本地合成测试正式文案',status:'PUBLISHED',confirmedBy:reviewer.id,confirmedAt:new Date()}});}
  const model=await db.modelDefinition.create({data:{brand:'合成',name:'N07-'+seed}}),vehicle=await db.vehicle.create({data:{modelDefinitionId:model.id,brand:'合成',model:'EV',title:'N07合成车辆',year:2026,city:'上海',mileageKm:100,status:'PUBLISHED'}});
  const owner=await db.vehicleOwner.create({data:{subjectType:'INDIVIDUAL',name:'合成个人出租方',creditCode:null,address:'合成地址',contactPhone:'13800000000',createdBy:maker.id}}),ownerCustomer=await db.customer.create({data:{mobile:'n07-owner-'+seed}});
  const ownerFile=await db.storedFile.create({data:{adminId:maker.id,name:'合成权属.pdf',mimeType:'application/pdf',size:10,sha256:hash(seed),purpose:'evidence',storagePath:'synthetic-no-real-file'}}),identity=await db.partnerIdentityBinding.create({data:{ownerId:owner.id,customerId:ownerCustomer.id,relationship:'SELF',profileRevision:0,revision:1,status:'APPROVED',evidenceFileIds:[ownerFile.id],submittedBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date()}});
  await db.partnerVerification.create({data:{ownerId:owner.id,revision:1,profileRevision:0,subjectType:'INDIVIDUAL',status:'APPROVED',identityBindingId:identity.id,identityBindingRevision:1,evidenceFileIds:[ownerFile.id],submittedBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date()}});
  await db.ownerVehicle.create({data:{ownerId:owner.id,vehicleId:vehicle.id,status:'APPROVED',evidenceFileId:ownerFile.id,revision:1,createdBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date()}});
  const scope={vehicleIds:[vehicle.id],validFrom:'2026-01-01',validUntil:'2035-12-31'},archive=await db.documentArchive.create({data:{kind:'OWNER_COOPERATION',subjectType:'OWNER',subjectId:owner.id,ownerId:owner.id,createdBy:maker.id}}),cooperation=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,status:'ARCHIVED',templateId:docs.OFFLINE_RENTAL.id,templateVersion:docs.OFFLINE_RENTAL.version,businessSnapshotHash:cooperationBusinessHash(owner.id,0,scope),partiesSnapshot:[],requiredSigners:['OWNER','PLATFORM'],scopeSnapshot:scope,reviewedBy:reviewer.id,reviewedAt:new Date()}});
  await db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:cooperation.id}});
  const rule=await db.partnerRevenueRule.create({data:{ownerId:owner.id}}),ruleTerms={cooperationVersionId:cooperation.id,vehicleIds:[vehicle.id],validFrom:scope.validFrom,validUntil:scope.validUntil,method:'RATE',rateBps:3000,fixedMonthlyAmount:null,customAgreement:null,basis:'实收订阅款',deductions:'无',refundRule:'按原单退款调整',cycle:'每月',expenseResponsibility:'按合成协议'},ruleVersion=await db.partnerRevenueRuleVersion.create({data:{ruleId:rule.id,ownerId:owner.id,version:1,status:'APPROVED',cooperationVersionId:cooperation.id,vehicleIds:[vehicle.id],validFrom:new Date(scope.validFrom),validUntil:new Date(scope.validUntil),terms:ruleTerms,contentHash:hash(ruleTerms),evidenceFileIds:[],createdBy:maker.id,submittedBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date()}});
  await db.partnerRevenueRule.update({where:{id:rule.id},data:{currentApprovedVersionId:ruleVersion.id}});
  const domains=[{domain:'SUBJECT',resourceId:owner.id,revision:0,hash:hash(owner.id)},{domain:'VEHICLE',resourceId:vehicle.id,revision:1,hash:hash(vehicle.id)},{domain:'ARCHIVE',resourceId:cooperation.id,revision:0,hash:cooperation.businessSnapshotHash},{domain:'RULE',resourceId:ruleVersion.id,revision:0,hash:ruleVersion.contentHash}];
  await db.partnerCooperationSubmission.create({data:{ownerId:owner.id,revision:1,profileRevision:0,draftRevision:1,representatives:[{name:owner.name,role:'SELF',authorizationEvidenceFileIds:[]}],subjectEvidenceFileIds:[ownerFile.id],domainVersions:domains,submissionHash:hash(domains),status:'APPROVED',submittedBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date(),completedActions:domains.map(d=>`${d.domain}:${d.resourceId}`)}});
  const product=await db.product.create({data:{name:'合成产品',createdBy:maker.id}}),definition=await db.benefitDefinition.create({data:{name:'合成洗车服务',createdBy:maker.id}}),benefit=await db.benefitDefinitionVersion.create({data:{definitionId:definition.id,version:1,name:'合成洗车服务',description:'整单一次',provider:'宁达安排',conditions:'预约后使用',kind:'COUNT',unit:'次',totalQuantity:1,validity:'ORDER',createdBy:maker.id}});
  const terms={name:'合成产品',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'按实际用电',conditions:'合成条件'},productVersion=await db.productVersion.create({data:{...terms,productId:product.id,version:1,status:'PUBLISHED',vehicleIds:[vehicle.id],modelDefinitionIds:[],createdBy:maker.id,publishedBy:reviewer.id,publishedAt:new Date(),items:{create:[{position:1,kind:'BASE_SUBSCRIPTION'},{position:2,kind:'BENEFIT',benefitVersionId:benefit.id}]}}});
  const goodsController=new GoodsController(db),goods=await goodsController.create({vehicleId:vehicle.id,productVersionId:productVersion.id,visible:true,recommended:false,sortOrder:0,revision:0,idempotencyKey:randomUUID()},{admin:maker});
  const published=await goodsController.publish(goods.id,{revision:goods.revision,idempotencyKey:randomUUID()},{admin:maker}),plan=await db.subscriptionPlan.findUniqueOrThrow({where:{id:published.subscriptionPlanId}});
  assert.equal(plan.vehicleId,vehicle.id);assert.equal(plan.productVersionId,productVersion.id);assert.equal(plan.active,true);
  const api=new ApplicationsController(db),riskService=new RiskReviewService(),commercialTerms=Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(k=>[k,'明确合成约定']));
  const createCandidate=async(index:number)=>{
   let customer=await db.customer.create({data:{mobile:`n07-${index}-${seed}`,name:`合成客户${index}`,profile:{}}});
   await seedTrustedCustomerProfile(db,customer.id);customer=await db.customer.findUniqueOrThrow({where:{id:customer.id}});
   await db.customerConsent.createMany({data:['terms','privacy'].map(type=>({customerId:customer.id,documentId:docs[type].id,type,version:docs[type].version,source:'SYNTHETIC'}))});
   const app=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:customer.name},consents:[],idempotencyKey:randomUUID(),requestHash:hash(index),status:'IN_REVIEW',creditRevision:1}}),consent=await db.creditConsent.create({data:{applicationId:app.id,customerId:customer.id,documentId:docs['credit-verification'].id,version:docs['credit-verification'].version,status:'ACCEPTED',revision:1,idempotencyKey:randomUUID(),requestHash:hash(index)}}),credit=await db.creditVerification.create({data:{applicationId:app.id,consentId:consent.id,band:'GE750',revision:1,ruleVersion:'ZHIMA_MANUAL_V1',verifiedBy:maker.id,idempotencyKey:randomUUID(),requestHash:hash(index)}});
   const evidence=await db.storedFile.create({data:{customerId:customer.id,name:'合成身份与驾驶凭据.pdf',mimeType:'application/pdf',size:10,sha256:hash(index),purpose:'identity',storagePath:'synthetic-no-real-file'}}),proof={identityFileIds:[evidence.id],drivingLicenseFileIds:[evidence.id]},qualification=await db.customerQualificationVersion.create({data:{customerId:customer.id,revision:1,profileHash:customerProfileHash(customer),status:'APPROVED',...proof,evidenceHash:(await qualificationEvidence(db,customer.id,proof)).evidenceHash,identityExpiresAt:new Date('2035-01-01'),drivingLicenseExpiresAt:new Date('2035-01-01'),submittedBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date(),idempotencyKey:randomUUID(),requestHash:hash(index)}});
   const input={revision:0,idempotencyKey:randomUUID(),creditVerificationId:credit.id,commercialTerms,monthlyFeeAmount:10000,months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:terms.energyDescription,benefits:[benefit.name],conditions:terms.conditions,startDate:'2027-01-01',firstDueDate:'2027-01-01'};
   const candidate=await api.finalPlan(app.id,input,{admin:maker});assert.equal(candidate.status,'IN_REVIEW');assert.equal(candidate.finalPlan.reviewStatus,'DRAFT');assert.equal(candidate.finalPlan.contractMode,'OFFLINE');
   assert.equal((await api.finalPlan(app.id,input,{admin:maker})).finalPlan.id,candidate.finalPlan.id);
   await assert.rejects(api.finalPlan(app.id,{...input,monthlyFeeAmount:11000,priceAdjustmentReason:'修改内容不可复用原键'},{admin:maker}),denied('IDEMPOTENCY_CONFLICT'));
   await assert.rejects(api.confirm(app.id,{revision:1,commercialHash:candidate.finalPlan.commercialHash},{customer}),denied('STATE_CONFLICT'));
   await db.serial(tx=>riskService.assess(tx,reviewer,app.id,{revision:1,planRevision:1,commercialHash:candidate.finalPlan.commercialHash,qualificationId:qualification.id,creditVerificationId:credit.id,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reasonCodes:[],supplementaryInstructions:'',idempotencyKey:randomUUID()}));
   const final=await db.finalPlan.findUniqueOrThrow({where:{id:candidate.finalPlan.id}}),lessor=final.lessorSnapshot as any;
   return{app,customer,final,input:{revision:1,commercialHash:final.commercialHash,ownerSharing:{accepted:true,lessorHash:lessorIdentityHash(lessor),noticeHash:lessor.sharingNotice.contentHash}}};
  };
  const first=await createCandidate(1),second=await createCandidate(2),results=await Promise.allSettled([api.confirm(first.app.id,first.input,{customer:first.customer}),api.confirm(second.app.id,second.input,{customer:second.customer})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results.map(r=>r.status==='rejected'?r.reason?.getResponse?.()||r.reason?.message:'fulfilled')));const winnerIndex=results[0].status==='fulfilled'?0:1,winner=winnerIndex===0?first:second,winnerResult=results[winnerIndex];assert.equal(winnerResult.status,'fulfilled');if(winnerResult.status!=='fulfilled')throw new Error('Expected one order');
  const order=await db.order.findUniqueOrThrow({where:{id:winnerResult.value.id}});assert.equal(order.status,'AWAITING_CONTRACT_REVIEW');assert.equal(order.contractMode,'OFFLINE');assert.equal((order.finalPlanSnapshot as any).riskSnapshot.applicationId,winner.app.id);assert.equal((order.finalPlanSnapshot as any).revenueRuleSnapshot.versionId,ruleVersion.id);assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}})).reservedOrderId,order.id);
  assert.equal((order.finalPlanSnapshot as any).platformLegalEntityName,'上海宁达信息科技有限公司');assert.deepEqual((order.finalPlanSnapshot as any).partiesSnapshot.map((p:any)=>p.role),['CUSTOMER','OWNER','PLATFORM']);assert.equal((order.finalPlanSnapshot as any).partiesSnapshot[0].name,winner.customer.name);
  assert.equal(await db.order.count({where:{vehicleId:vehicle.id}}),1);const contract=await db.contract.findFirstOrThrow({where:{orderId:order.id}});assert.equal(contract.executionMode,'OFFLINE');assert.equal(contract.status,'DRAFT');assert.equal(await db.bill.count({where:{orderId:order.id,status:'DRAFT'}}),12);const granted=await db.entitlement.findMany({where:{orderId:order.id}});assert.equal(granted.length,1);assert.equal(granted[0].kind,'COUNT');assert.equal(granted[0].status,'PENDING');
  await db.productVersion.update({where:{id:productVersion.id},data:{status:'RETIRED'}});await db.subscriptionPlan.update({where:{id:plan.id},data:{active:false}});assert.equal((await api.confirm(winner.app.id,winner.input,{customer:winner.customer})).id,order.id);
  const now=new Date(),requirement=await db.coverageRequirement.create({data:{scopeType:'MODEL',scopeId:model.id}}),requirementVersion=await db.coverageRequirementVersion.create({data:{requirementId:requirement.id,version:1,effectiveAt:new Date(now.getTime()-86400000),items:[{code:'C',label:'合成车辆保障',description:'合成要求',minAmount:null,deductibleReview:'已人工核对',exclusionReview:'已人工核对'}],createdBy:maker.id}}),policy=await db.insurancePolicy.create({data:{insurer:'合成机构',policyNumber:'N07-'+seed,createdBy:maker.id}});
  await db.insurancePolicyVersion.create({data:{policyId:policy.id,version:1,status:'APPROVED',effectiveAt:new Date(now.getTime()-86400000),startAt:new Date(now.getTime()-86400000),endAt:new Date(now.getTime()+180*86400000),policyholder:'private policyholder',insuredParty:'private insured party',vehicleIds:[vehicle.id],coverageItems:[{code:'C',label:'合成车辆保障',amount:null,deductible:'private deductible',terms:'private clauses'}],terms:'private terms',fileIds:['private-file'],requirementVersionIds:[requirementVersion.id],reviewChecks:[{vehicleId:vehicle.id,requirementVersionId:requirementVersion.id,itemCode:'C',fileId:'private-file',confirmed:true,note:'合成审核'}],createdBy:maker.id,reviewedBy:reviewer.id,reviewedAt:new Date()}});
  const access=await db.partnerPortalAccess.create({data:{ownerId:owner.id,status:'ENABLED',accessVersion:1,displayName:'Synthetic viewer',mobileHash:hash('synthetic-view-'+seed),reviewedBy:reviewer.id,reviewedAt:now}});
  const session=await db.partnerPortalSession.create({data:{id:randomUUID(),mode:'PARTNER_READONLY',mobileHash:access.mobileHash!,maskedMobile:'139****0000',csrfToken:'synthetic-token',expiresAt:new Date(now.getTime()+3600000),consentSnapshot:[],scopeSnapshot:[{accessId:access.id,ownerId:owner.id,accessVersion:1}]}}),views=new SevenModuleViewsController(db),h5Request={partnerPortalSession:session};
  const inventory=await views.ownerVehicles(owner.id,{},h5Request);assert.equal(inventory.total,1);assert.equal(inventory.items[0].id,vehicle.id);assert.equal('reservedOrderId' in inventory.items[0],false);
  const ownerPolicies=await views.ownerPolicies(owner.id,{},h5Request);assert.equal(ownerPolicies.items.length,1);assert.equal(JSON.stringify(ownerPolicies).includes('private'),false);assert.deepEqual(ownerPolicies.items[0].vehicleIds,[vehicle.id]);
  await assert.rejects(views.ownerPolicies(owner.id,{vehicleId:'unrelated-vehicle'},h5Request),denied('NOT_FOUND'));
  await assert.rejects(views.ownerVehicles('unrelated-owner',{},h5Request));
  const customerPolicies=await views.customerInsurance(order.id,{customer:winner.customer});assert.equal(customerPolicies.coverage.ready,true);assert.equal(customerPolicies.policies.length,1);assert.equal(JSON.stringify(customerPolicies).includes('private'),false);await assert.rejects(views.customerInsurance(order.id,{customer:winnerIndex===0?second.customer:first.customer}),denied('NOT_FOUND'));
  await db.vehicleOwner.update({where:{id:owner.id},data:{status:'SUSPENDED'}});const gate=await db.serial(tx=>deliveryBusinessReady(tx,order.id,new Date('2027-01-01')));assert.equal(gate.ready,false);assert.ok(gate.blockers.some(b=>b.code==='OWNER_BUSINESS_UNVERIFIED'));
  assert.equal((await views.ownerVehicles(owner.id,{},h5Request)).items[0].id,vehicle.id,'Business suspension does not silently revoke independently granted historical read access');
  await db.partnerPortalAccess.update({where:{id:access.id},data:{status:'DISABLED',accessVersion:{increment:1}}});
  await assert.rejects(views.ownerVehicles(owner.id,{},h5Request));
 }finally{await db.$disconnect();if(before===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=before;}
});

