import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {auditSevenModuleFacts,inspectSevenModuleMigration,validateBackfillTarget,parseBackfillArguments,assertBackfillRunner} from '../src/operations/seven-module-migration';
import {cooperationBusinessHash} from '../src/offline-documents/snapshot';

const at=new Date('2026-10-27T04:00:00Z');
function facts():any{return {vehicles:[],plans:[],owners:[],verifications:[],identityBindings:[],archives:[],feedback:[],requirements:[],policies:[],productVersions:[],counts:{products:0,legacyEsignOrders:0,offlineOrders:0,legacyEsignContracts:0}};}
const url='postgresql://synthetic:synthetic@127.0.0.1:55432/chundian_test?schema=public';
const env={NODE_ENV:'test',TEST_DATABASE_URL:url,DATABASE_URL:url};

test('backfill defaults to preview and rejects non-test invocation and foreign targets before any connection',()=>{
 assert.deepEqual(parseBackfillArguments(['--test']),{apply:false});
 assert.deepEqual(parseBackfillArguments(['--test','--apply']),{apply:true});
 for(const args of [[],['--apply'],['--test','--production'],['--test','--apply','--apply']])assert.throws(()=>parseBackfillArguments(args),/BACKFILL_ARGUMENTS/);
 assert.equal(validateBackfillTarget(env),url);
 for(const invalid of [url.replace('127.0.0.1','192.0.2.1'),url.replace('55432','5432'),url.replace('chundian_test','chundian_dev'),url+'&host=elsewhere',url+'#ignored'])assert.throws(()=>validateBackfillTarget({...env,TEST_DATABASE_URL:invalid,DATABASE_URL:invalid}),/BACKFILL_TARGET/);
 assert.throws(()=>validateBackfillTarget({...env,NODE_ENV:'production'}),/BACKFILL_ENVIRONMENT/);
 assert.throws(()=>validateBackfillTarget({...env,DATABASE_URL:url.replace('chundian_test','chundian_dev')}),/BACKFILL_ENVIRONMENT/);
 assert.doesNotThrow(()=>assertBackfillRunner({pid:123,token:randomUUID()},123));
 for(const lock of [null,{}, {pid:122,token:randomUUID()}, {pid:123,token:'invalid'}])assert.throws(()=>assertBackfillRunner(lock,123),/BACKFILL_RUNNER_REQUIRED/);
});

test('audit emits only business identifiers and fixed missing-item codes, with normalized duplicate VIN checks',()=>{
 const f=facts();f.vehicles=[{id:'v-one',vin:'  l1234567890123456 ',modelDefinitionId:null,ownerBinding:null},{id:'v-two',vin:'L1234567890123456',modelDefinitionId:null,ownerBinding:null},{id:'v-three',vin:null,modelDefinitionId:null,ownerBinding:null}];
 f.plans=[{id:'legacy-one',vehicleId:'v-one',productVersionId:null,active:true}];
 f.owners=[{id:'owner-one',subjectType:'ENTERPRISE',creditCode:'PII-CREDIT-CODE',name:'SECRET-NAME',address:'SECRET-ADDRESS',contactPhone:'13800000000',status:'DRAFT',revision:0}];
 const report=auditSevenModuleFacts(f,at),json=JSON.stringify(report);
 assert.equal(report.counts.legacyPlans,1);assert.ok(report.issues.every(x=>!x.code.startsWith('INSURANCE_REQUIREMENT')));
 for(const id of ['v-one','v-two'])assert.ok(report.issues.some(x=>x.resourceId===id&&x.code==='VIN_DUPLICATE'));
 for(const code of ['VIN_MISSING','OWNER_VEHICLE_REQUIRED','OWNER_BUSINESS_UNVERIFIED','PRODUCT_VERSION_MISSING','INSURANCE_POLICY_MISSING'])assert.ok(report.issues.some(x=>x.code===code),code);
 for(const privateValue of ['l1234567890123456','L1234567890123456','PII-CREDIT-CODE','SECRET-NAME','SECRET-ADDRESS','13800000000'])assert.ok(!json.includes(privateValue));
 assert.deepEqual(auditSevenModuleFacts(f,at),report);
});

test('audit requires current admission, ownership, cooperation archive and coverage without manufacturing approval',()=>{
 const f=facts(),scope={vehicleIds:['v'],validFrom:'2026-01-01',validUntil:'2027-12-31'};
 f.vehicles=[{id:'v',vin:'L1234567890123456',modelDefinitionId:'model',ownerBinding:{id:'binding',ownerId:'owner',status:'APPROVED',reviewedBy:'reviewer',reviewedAt:at}}];
 f.owners=[{id:'owner',subjectType:'INDIVIDUAL',creditCode:null,status:'ACTIVE',revision:1}];
 f.verifications=[{id:'verification',ownerId:'owner',revision:1,profileRevision:1,status:'APPROVED',reviewedBy:'reviewer',reviewedAt:at,identityBindingId:'identity',identityBindingRevision:2}];
 f.identityBindings=[{id:'identity',ownerId:'owner',status:'APPROVED',relationship:'SELF',profileRevision:1,revision:2,reviewedBy:'reviewer',reviewedAt:at,revokedAt:null}];
 f.archives=[{id:'archive',ownerId:'owner',currentApprovedVersionId:'archive-v1',versions:[{id:'archive-v1',status:'ARCHIVED',scopeSnapshot:scope,businessSnapshotHash:cooperationBusinessHash('owner',1,scope)}]}];
 f.plans=[{id:'plan',vehicleId:'v',productVersionId:'product-v1',active:true}];f.productVersions=[{id:'product-v1',status:'PUBLISHED'}];
 f.requirements=[{id:'requirement',scopeType:'MODEL',scopeId:'model',versions:[{id:'requirement-v1',effectiveAt:new Date('2026-01-01'),version:1,items:[{code:'THIRD_PARTY',label:'三者险',description:'合成要求',minAmount:10000}]}]}];
 f.policies=[{id:'policy-v1',policyId:'policy',version:1,status:'APPROVED',changeKind:'ORIGINAL',effectiveAt:new Date('2026-01-01'),startAt:new Date('2026-01-01'),endAt:new Date('2027-01-01'),vehicleIds:['v'],fileIds:['synthetic-file'],coverageItems:[{code:'THIRD_PARTY',label:'三者险',amount:10000,deductible:'合成免赔',terms:'合成条款'}],requirementVersionIds:['requirement-v1'],reviewChecks:[{vehicleId:'v',requirementVersionId:'requirement-v1',itemCode:'THIRD_PARTY',fileId:'synthetic-file',confirmed:true,note:'合成核验'}]}];
 assert.deepEqual(auditSevenModuleFacts(f,at).issues,[]);f.requirements=[];assert.deepEqual(auditSevenModuleFacts(f,at).issues,[]);
 f.owners[0].revision=2;
 const changed=auditSevenModuleFacts(f,at);
 assert.ok(changed.issues.some(x=>x.code==='OWNER_BUSINESS_UNVERIFIED'));
 assert.ok(changed.issues.some(x=>x.code==='OWNER_COOPERATION_REQUIRED'));
 f.owners[0].revision=1;f.policies.push({...f.policies[0],id:'policy-v2',version:2,vehicleIds:[],effectiveAt:new Date('2026-10-01')});
 assert.ok(auditSevenModuleFacts(f,at).issues.some(x=>x.code==='INSURANCE_VEHICLE_REMOVED'));
 f.feedback=[{versionId:'archive-v1',version:{archiveId:'archive',scopeSnapshot:scope}}];
 assert.ok(auditSevenModuleFacts(f,at).issues.some(x=>x.code==='OWNER_COOPERATION_FEEDBACK_OPEN'));
});

test('inspect uses read-only delegates and does not return queried personal fields',async()=>{
 const tx:any={};for(const name of ['vehicle','subscriptionPlan','vehicleOwner','partnerVerification','partnerIdentityBinding','documentArchive','archiveFeedback','insurancePolicyVersion','productVersion'])tx[name]={findMany:async()=>[]};
 for(const name of ['product','order','contract'])tx[name]={count:async()=>0};tx.coverageRequirement={findMany:async()=>{throw new Error('RETIRED_REQUIREMENT_READ');}};tx.insurancePolicyVersion.findMany=async(query:any)=>{assert.equal(query.select.fileIds,true);return [];};
 const report=await inspectSevenModuleMigration(tx,at);assert.equal(report.counts.vehicles,0);assert.deepEqual(report.issues,[]);
});

// The runner sets both URLs to the dedicated test target. Without it the DB test is skipped.
test('database migration keeps same-name plans separate, creates description benefits, is repeatable and preserves ESIGN history',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 validateBackfillTarget(process.env);
 const {Db}=await import('../src/common/db');const {migrateLegacyProducts}=await import('../src/products/service');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),rollback=new Error('SYNTHETIC_MIGRATION_ROLLBACK');
 try{
  await assert.rejects(db.$transaction(async tx=>{
   const suffix=randomUUID(),planIds:string[]=[];
   const customer=await tx.customer.create({data:{mobile:`migration-${suffix}`,openId:`migration-${suffix}`,name:'合成客户'}});
   for(let i=0;i<2;i++){
    const vehicle=await tx.vehicle.create({data:{brand:'合成',model:'EV',title:'迁移合成车辆',year:2026,city:'上海',mileageKm:100,status:'DRAFT'}});
    const plan=await tx.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:`同名套餐-${suffix}`,months:12,monthlyFeeAmount:12300+i,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'合成说明',benefits:['免费保养3次，具体以纸质约定为准'],conditions:'合成条件',active:true}});planIds.push(plan.id);
   }
   const first=await tx.subscriptionPlan.findUniqueOrThrow({where:{id:planIds[0]}}),snapshot={legacy:true,nested:{untouched:'历史套餐原值'},monthlyFeeAmount:12300};
   const application=await tx.application.create({data:{customerId:customer.id,vehicleId:first.vehicleId,subscriptionPlanId:first.id,profile:{},consents:[],idempotencyKey:suffix,requestHash:suffix,status:'FINAL_PLAN_CONFIRMED'}});
   const order=await tx.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:first.vehicleId,confirmedMileageKm:100,contractMode:'ESIGN',finalPlanSnapshot:snapshot}});
   const contract=await tx.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'ESIGN',documentHash:'a'.repeat(64)}});
   const before=await Promise.all([tx.partnerVerification.count(),tx.documentArchive.count(),tx.insurancePolicy.count()]);
   assert.ok((await migrateLegacyProducts(tx)).migrated>=2);
   const plans=await tx.subscriptionPlan.findMany({where:{id:{in:planIds}},include:{productVersion:{include:{items:{include:{benefitVersion:true}}}}}});
   assert.equal(plans.length,2);assert.notEqual(plans[0].productVersion!.productId,plans[1].productVersion!.productId);
   for(const plan of plans){
    assert.equal(plan.active,false);assert.equal(plan.productVersion!.status,'DRAFT');assert.deepEqual(plan.productVersion!.vehicleIds,[plan.vehicleId]);
    const benefit=plan.productVersion!.items.find(item=>item.kind==='BENEFIT')!.benefitVersion!;
    assert.equal(benefit.kind,'DESCRIPTION');assert.equal(benefit.totalQuantity,null);assert.equal(benefit.unit,null);assert.ok(benefit.description.includes('3次'));
   }
   assert.deepEqual(await migrateLegacyProducts(tx),{migrated:0});
   assert.equal(await tx.product.count({where:{id:{in:planIds.map(id=>`legacy-plan-${id}`)}}}),2);
   assert.deepEqual(await tx.order.findUnique({where:{id:order.id}}),order);
   assert.deepEqual(await tx.contract.findUnique({where:{id:contract.id}}),contract);
   assert.deepEqual(await Promise.all([tx.partnerVerification.count(),tx.documentArchive.count(),tx.insurancePolicy.count()]),before);
   throw rollback;
  },{isolationLevel:'Serializable',timeout:60000}),error=>error===rollback);
 }finally{await db.$disconnect();}
});
