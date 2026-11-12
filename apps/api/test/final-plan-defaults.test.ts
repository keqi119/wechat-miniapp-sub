import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationsController} from '../src/applications/applications';
import {commercialTermsInput} from '../src/applications/commercial-terms';
import {hash} from '../src/common/data';
import {buildDefaultCommercialTerms} from '../src/applications/final-plan-defaults';

const keys=['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'];
const error=(code:string)=>(value:any)=>value?.getResponse?.()?.error?.code===code;
const actor={id:'ops',role:'OPERATIONS',authVersion:1};
test('v2 defaults disclose exact module fees and whole-term swap limits independently of other benefits',async()=>{
 const f=fixture();Object.assign(f.version,{configurationVersion:2,baseFeeAmount:100000,mileageMonthlyFeeAmount:23456,mileagePerMonthKm:2400,excessMileagePriceAmount:230,energyDescription:'充换电费用由客户自付',swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}});
 const result=await f.controller.finalPlanDefaults('application',{admin:actor});
 assert.equal(result.values.monthlyFeeAmount,123456);assert.equal(result.values.mileagePerMonthKm,2400);assert.equal(result.values.excessMileagePriceAmount,230);
 assert.match(result.values.commercialTerms.serviceCoverage,/合同期内.*2次/);assert.match(result.values.commercialTerms.serviceCoverage,/500\.00元/);assert.match(result.values.commercialTerms.serviceCoverage,/升级.*差价/);
 assert.match(result.values.commercialTerms.usageCosts,/1000\.00元/);assert.match(result.values.commercialTerms.usageCosts,/234\.56元/);
 assert.match(result.values.commercialTerms.excessMileageCalculation,/2400/);assert.match(result.values.commercialTerms.excessMileageCalculation,/2\.30/);
});
function fixture(){
 const vehicle:any={id:'vehicle',vin:'L1234567890123456',plateNumber:'沪TEST01',brand:'测试品牌',model:'测试车型',title:'真实关联车辆',modelDefinitionId:'model',city:'上海',mileageKm:999999,conditionDisclosure:'旧录入的完好描述'};
 const version:any={id:'product-version-7',productId:'product',version:7,status:'PUBLISHED',name:'产品接口报价',months:24,monthlyFeeAmount:123456,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'产品能源说明：电池租金已含',conditions:'产品专属使用条件',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'},{kind:'BENEFIT',benefitVersionId:'benefit-v2',benefitVersion:{id:'benefit-v2',definitionId:'benefit',version:2,kind:'COUNT',name:'轮胎检查',description:'预约轮胎检查',provider:'实际提供方',conditions:'提前预约',validity:'ORDER',unit:'次',totalQuantity:2}}]};
 const plan:any={id:'plan',vehicleId:vehicle.id,productVersionId:version.id,active:true,monthlyFeeAmount:1,months:12,productVersion:version,vehicle,listing:{id:'legacy-listing',revision:1,vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:'plan',status:'PUBLISHED',visible:true,source:'LEGACY_MIGRATED'}};
 const application:any={id:'application',vehicleId:vehicle.id,subscriptionPlanId:plan.id,customerId:'customer',revision:4,creditRevision:2,status:'IN_REVIEW',profile:{name:'本单客户',mobile:'13900000000',contactAddress:'上海市测试路1号',handoverLocation:{name:'客户建议点',address:'建议地点，不是联系地址'}},vehicle};
 const reads:any[]=[],writes:any[]=[];
 const tx:any={adminUser:{findUnique:async({where}:any)=>({id:where.id,role:where.id==='finance'?'FINANCE':'OPERATIONS',active:true,authVersion:1})},application:{findUnique:async({where}:any)=>{reads.push({kind:'application',where});return where.id===application.id?application:null;}},subscriptionPlan:{findUnique:async({where}:any)=>{reads.push({kind:'product',where});return where.id===plan.id?plan:null;}},$queryRaw:async()=>[],archiveCommand:{findUnique:async()=>null,create:async(data:any)=>{writes.push(data);return data;}},finalPlan:{create:async(data:any)=>{writes.push(data);return data;}}};
 const db:any={...tx,serial:async(fn:any)=>fn(tx)};
 return{vehicle,version,plan,application,tx,db,reads,writes,controller:new ApplicationsController(db) as any};
}

test('defaults endpoint reads the linked published product instead of legacy plan prices and returns fourteen editable terms',async()=>{
 const f=fixture();assert.equal(typeof f.controller.finalPlanDefaults,'function','final-plan defaults endpoint is required');
 const result=await f.controller.finalPlanDefaults('application',{admin:actor});
 assert.equal(result.applicationId,'application');assert.equal(result.revision,4);
 assert.deepEqual({productId:result.source.productId,productVersionId:result.source.productVersionId,version:result.source.version,name:result.source.name},{productId:'product',productVersionId:'product-version-7',version:7,name:'产品接口报价'});
 assert.equal(result.values.monthlyFeeAmount,123456);assert.equal(result.values.months,24);assert.equal(result.values.energyDescription,'产品能源说明：电池租金已含');assert.deepEqual(result.values.benefits,['轮胎检查']);
 assert.equal(result.values.mileagePerMonthKm,1500);assert.equal(result.values.excessMileagePriceAmount,150);assert.equal(result.values.productSourceHash,result.source.hash);assert.match(result.source.hash,/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(result.values.commercialTerms).sort(),[...keys].sort());assert.equal(commercialTermsInput.safeParse(result.values.commercialTerms).success,true);
 assert.match(result.values.commercialTerms.vehicleIdentification,/L1234567890123456/);assert.match(result.values.commercialTerms.vehicleIdentification,/沪TEST01/);
 assert.match(result.values.commercialTerms.customerAddress,/上海市测试路1号/);assert.doesNotMatch(result.values.commercialTerms.customerAddress,/建议地点/);
 assert.match(result.values.commercialTerms.permittedUse,/产品专属使用条件/);assert.match(result.values.commercialTerms.mileageCarryRule,/24个月/);assert.match(result.values.commercialTerms.mileageCarryRule,/1500/);assert.match(result.values.commercialTerms.excessMileageCalculation,/1\.50/);
 assert.match(result.values.commercialTerms.serviceCoverage,/轮胎检查/);assert.match(result.values.commercialTerms.serviceCoverage,/2次/);assert.match(result.values.commercialTerms.serviceCoverage,/实际提供方/);
 assert.deepEqual(f.reads.filter(r=>r.kind==='product').map(r=>r.where),[{id:'plan'}]);assert.equal(f.writes.length,0);
});

test('condition defaults defer actual facts to signed onsite handover evidence and never copy old readings or claim sound condition',async()=>{
 const f=fixture();const r=await f.controller.finalPlanDefaults('application',{admin:actor}),text=r.values.commercialTerms.conditionDisclosure;
 assert.match(text,/现场/);assert.match(text,/影像|照片/);assert.match(text,/交接/);assert.doesNotMatch(text,/999999|完好|旧录入|已确认无损伤/);
});

test('missing address and VIN are explicit while customer proposed handover address never becomes contractual contact address',async()=>{
 const f=fixture();delete f.application.profile.contactAddress;delete f.vehicle.vin;const result=await f.controller.finalPlanDefaults('application',{admin:actor});
 assert.equal(result.values.commercialTerms.customerAddress,'');assert.ok(result.missingFields.includes('customerAddress'));assert.ok(result.missingFields.includes('vehicleIdentification'));
 assert.doesNotMatch(JSON.stringify(result.values.commercialTerms),/车况完好|100万元|24小时客服|免费保养/);
});

test('unpublished, disabled, wrong-scope and missing products never produce substitute defaults',async()=>{
 for(const mode of ['unpublished','disabled','scope','missing']){const f=fixture();if(mode==='unpublished')f.version.status='DRAFT';if(mode==='disabled')f.plan.active=false;if(mode==='scope')f.version.vehicleIds=['other'];if(mode==='missing')f.plan.productVersion=null;
  const expected={unpublished:'PRODUCT_UNAVAILABLE',disabled:'GOODS_UNAVAILABLE',scope:'PRODUCT_SCOPE_MISMATCH',missing:'GOODS_SOURCE_MISMATCH'};
  await assert.rejects(f.controller.finalPlanDefaults('application',{admin:actor}),error(expected[mode as keyof typeof expected]));assert.equal(f.writes.length,0);
 }
});

test('defaults endpoint requires current operations privileges and does not expose unrelated or missing application data',async()=>{
 const f=fixture();await assert.rejects(f.controller.finalPlanDefaults('application',{admin:{id:'finance',role:'FINANCE',authVersion:1}}),error('FORBIDDEN'));
 await assert.rejects(f.controller.finalPlanDefaults('application',{admin:{...actor,authVersion:2}}),error('STAFF_SESSION_CHANGED'));
 await assert.rejects(f.controller.finalPlanDefaults('missing',{admin:actor}),error('NOT_FOUND'));
});

test('product source hashes change with the published product and stale final-plan submissions fail before writing',async()=>{
 const f=fixture(),old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{const defaults=await f.controller.finalPlanDefaults('application',{admin:actor});f.version.monthlyFeeAmount=234567;
  const fresh=await f.controller.finalPlanDefaults('application',{admin:actor});assert.notEqual(fresh.source.hash,defaults.source.hash);
  const body={...defaults.values,revision:4,idempotencyKey:'stale-product-source-key',creditVerificationId:'verification',startDate:'2026-11-01',firstDueDate:'2026-11-01'};
  await assert.rejects(f.controller.finalPlan('application',body,{admin:actor}),error('PRODUCT_SOURCE_CHANGED'));assert.equal(f.writes.length,0);
 }finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
});

test('default wording derives units and duration from its product source rather than embedding current product constants',()=>{
 const f=fixture(),product:any={...f.version,benefits:[],months:36,mileagePerMonthKm:1800,excessMileagePriceAmount:175};
 const terms=buildDefaultCommercialTerms(f.application,product).commercialTerms;
 assert.match(terms.mileageCarryRule,/36个月/);assert.match(terms.mileageCarryRule,/1800公里/);assert.match(terms.excessMileageCalculation,/1800公里/);assert.match(terms.excessMileageCalculation,/1\.75元/);assert.doesNotMatch(terms.excessMileageCalculation,/1500|1\.50/);
});

for(const configurationVersion of [1,2])test(`v${configurationVersion} candidate creation freezes edited clauses and exact product data, strips source guard metadata and replays idempotently`,async()=>{
 const f=fixture(),old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 if(configurationVersion===2)Object.assign(f.version,{configurationVersion:2,baseFeeAmount:100000,mileageMonthlyFeeAmount:23456,mileagePerMonthKm:2400,excessMileagePriceAmount:230,energyDescription:'充换电费用由客户自付',swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:50000}});
 const commands:any[]=[],finals:any[]=[],audits:any[]=[];
 const owner={id:'owner',name:'合成出租方',subjectType:'ENTERPRISE',status:'VERIFIED',revision:1,address:'合成地址',contactPhone:'13900000001',creditCode:'SYNTHETIC'};
 const agreement={id:'agreement',ownerId:owner.id,currentVersionId:'agreement-v1',status:'ACTIVE'};
 const agreementVersion={id:'agreement-v1',agreementId:agreement.id,ownerId:owner.id,status:'ACTIVE',vehicleIds:[f.vehicle.id],fileIds:['agreement-file'],partnerRateBps:8000,contentHash:'a'.repeat(64),title:'合成协议'};
 const binding={vehicleId:f.vehicle.id,ownerId:owner.id,agreementId:agreement.id,agreementVersionId:agreementVersion.id,revision:1};
 Object.assign(f.tx,{
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},electronicFileQuarantine:{count:async()=>0},
  vehicle:{findUnique:async()=>f.vehicle},vehicleOwner:{findUnique:async()=>owner},partnerAgreementVehicle:{findUnique:async()=>binding},partnerAgreement:{findUnique:async()=>agreement},partnerAgreementVersion:{findUnique:async()=>agreementVersion},
  storedFile:{count:async()=>0,findMany:async()=>[{id:'agreement-file',adminId:'ops',purpose:'contract',mimeType:'application/pdf',sha256:'1'.repeat(64)}]},
  legalDocument:{findFirst:async({where}:any)=>({id:where.type,type:where.type,version:1,title:'合成文书',content:where.type==='usage-policy-v2'?'合成本单每月{{baseAllowanceKm}}公里，超额{{excessPriceYuan}}元/公里':'合成内容',confirmedBy:'fixture',confirmedAt:new Date(),status:'PUBLISHED'})},
  customerConsent:{count:async()=>1},creditConsent:{findFirst:async()=>({id:'consent',status:'ACCEPTED',documentId:'credit-verification',version:1})},creditVerification:{findFirst:async()=>({id:'verification',consentId:'consent',revision:2,ruleVersion:'ZHIMA_MANUAL_V1',band:'B700_749'})},
  archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>c.key===where.actorId_resourceId_action_key.key),create:async({data}:any)=>{commands.push(data);return data;}},
  finalPlan:{create:async({data}:any)=>{const row={id:'candidate',...data};finals.push(row);return row;}},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}}
 });
 f.tx.application.update=async({data}:any)=>{Object.assign(f.application,data);return{...f.application,finalPlans:finals.slice(-1)};};
 try{
  const defaults=await f.controller.finalPlanDefaults('application',{admin:actor});
  const body={...defaults.values,commercialTerms:{...defaults.values.commercialTerms,maintenanceRule:'人工确认：本单例行保养由出租方承担。'},revision:4,idempotencyKey:'successful-source-guard-command',creditVerificationId:'verification',startDate:'2026-11-01',firstDueDate:'2026-11-01'};
  const result=await f.controller.finalPlan('application',body,{admin:actor});
  assert.equal(result.finalPlan.commercialTerms.maintenanceRule,'人工确认：本单例行保养由出租方承担。');assert.equal(result.finalPlan.monthlyFeeAmount,123456);assert.equal(result.finalPlan.depositAmount,123456);assert.equal(result.finalPlan.reviewStatus,'DRAFT');
  assert.equal(finals.length,1);assert.equal(Object.hasOwn(finals[0],'productSourceHash'),false);assert.equal(hash(finals[0].productSnapshot),defaults.source.hash);assert.equal(finals[0].productSnapshot.productVersionId,'product-version-7');assert.equal(audits[0].action,'FINAL_PLAN');
  assert.equal(result.finalPlan.usagePolicyVersion,configurationVersion===2?'USAGE_V2':'USAGE_V1');
  if(configurationVersion===2){assert.equal(result.finalPlan.usagePolicy.baseAllowanceKm,2400);assert.equal(result.finalPlan.usagePolicy.excessPriceAmount,230);assert.match(result.finalPlan.usagePolicy.content,/2400.*2\.30/);assert.equal(result.finalPlan.product.baseFeeAmount,100000);assert.equal(result.finalPlan.product.swapPolicy.includedCount,2);}
  f.version.monthlyFeeAmount=999900;
  assert.deepEqual(await f.controller.finalPlan('application',body,{admin:actor}),result);assert.equal(finals.length,1);
 }finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}
});
