import {test} from 'node:test';
import {trustedProfileFixture} from './customer-profile-fixture';
import assert from 'node:assert/strict';
import {CatalogController,catalogVehicleViews} from '../src/catalog/catalog';
import {ApplicationsController} from '../src/applications/applications';
import {CustomerController} from '../src/orders/customer';
import {cooperationBusinessHash} from '../src/offline-documents/snapshot';
import {hash} from '../src/common/data';
import {applicationCooperationEligible} from '../src/vehicles/application-eligibility';
import {snapshotRevenueRule} from '../src/partners/revenue-rules';

// Real controllers over in-memory records: no database, filesystem or provider.
process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
function fixture(){
 const profileFacts=trustedProfileFixture({id:'customer',name:'合成申请人'});
 const owner:any={id:'owner-private',subjectType:'INDIVIDUAL',name:'合成出租方',creditCode:null,address:'合成地址',contactPhone:'00000000000',revision:2,status:'DRAFT'};
 const vehicle:any={id:'vehicle',title:'合成纯电车',brand:'合成',model:'EV',year:2024,mileageKm:10000,modelDefinitionId:'model',status:'PUBLISHED',reservedOrderId:null,holdId:null};
 const product:any={id:'product-version',productId:'product',version:1,status:'PUBLISHED',name:'合成十二月产品',months:12,monthlyFeeAmount:399900,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'含电池租金，充换电自理',conditions:'合成条件',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const plan:any={id:'plan',vehicleId:'vehicle',productVersionId:product.id,active:true,productVersion:product,vehicle:{...vehicle},listing:{id:'legacy-listing',revision:1,vehicleId:vehicle.id,productVersionId:product.id,subscriptionPlanId:'plan',status:'PUBLISHED',visible:true,source:'LEGACY_MIGRATED'},...Object.fromEntries(['name','months','monthlyFeeAmount','mileagePerMonthKm','excessMileagePriceAmount','energyDescription','conditions'].map(k=>[k,product[k]]))};vehicle.plans=[plan];
 const binding:any={id:'binding',ownerId:owner.id,vehicleId:vehicle.id,owner,status:'APPROVED',reviewedBy:'independent-reviewer',reviewedAt:new Date(),revision:1,evidenceFileId:'private-proof'};
 const identity:any={id:'identity',ownerId:owner.id,relationship:'SELF',profileRevision:owner.revision,revision:3,status:'APPROVED',reviewedBy:'independent-reviewer',reviewedAt:new Date(),revokedAt:null};
 const domains=['SUBJECT','VEHICLE','ARCHIVE','RULE'].map(domain=>({domain,resourceId:domain,revision:1,hash:'a'.repeat(64)}));
 const verification:any={id:'verification',ownerId:owner.id,revision:1,status:'APPROVED',profileRevision:owner.revision,submittedBy:'maker',reviewedBy:'independent-reviewer',reviewedAt:new Date(),domainVersions:domains,completedActions:domains.map(d=>`${d.domain}:${d.resourceId}`)};
 const scope:any={vehicleIds:['vehicle'],validFrom:'2020-01-01',validUntil:'2099-12-31'};
 const archiveVersion:any={id:'cooperation-version',status:'ARCHIVED',scopeSnapshot:scope,businessSnapshotHash:cooperationBusinessHash(owner.id,owner.revision,scope)};
 const archive:any={id:'cooperation',ownerId:owner.id,kind:'OWNER_COOPERATION',currentApprovedVersionId:archiveVersion.id,versions:[archiveVersion]};
 const terms:any={cooperationVersionId:archiveVersion.id,vehicleIds:['vehicle'],validFrom:scope.validFrom,validUntil:scope.validUntil,method:'RATE',rateBps:2000,fixedMonthlyAmount:null,customAgreement:null,basis:'合成内部平台服务费口径',deductions:'合成约定',refundRule:'合成约定',cycle:'合成约定',expenseResponsibility:'合成约定'};
 const rule:any={id:'rule-version',ruleId:'rule',ownerId:owner.id,version:1,status:'APPROVED',cooperationVersionId:archiveVersion.id,vehicleIds:['vehicle'],validFrom:new Date(terms.validFrom),validUntil:new Date(terms.validUntil),terms,contentHash:hash(terms),reviewedBy:'finance-reviewer',reviewedAt:new Date()};
 const facts={binding:binding as any,owner:owner as any,verification:verification as any,identity:identity as any,archive:archive as any,rules:[rule] as any[],feedbackOpen:false};
 const writes:string[]=[],locks:unknown[][]=[],eligibilityReads:{delegate:string;serial:boolean}[]=[];let serial=false,existing:any=null;
 const read=(delegate:string)=>{eligibilityReads.push({delegate,serial});};
 const tx:any={vehicleOperationalRestriction:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},
  $queryRaw:async(...args:unknown[])=>{locks.push(args);return[];},
  vehicle:{findMany:async({distinct}:any)=>distinct?[{brand:vehicle.brand}]:[vehicle],count:async()=>1,findFirst:async()=>vehicle,findUnique:async()=>vehicle},
  subscriptionPlan:{findFirst:async()=>plan,findUnique:async()=>plan},
  ownerVehicle:{findUnique:async()=>{read('ownerVehicle');return facts.binding;}},
  vehicleOwner:{findUnique:async()=>{read('vehicleOwner');return facts.owner;}},
  partnerCooperationSubmission:{findFirst:async()=>{read('partnerCooperationSubmission');return facts.verification;}},
  partnerIdentityBinding:{findUnique:async()=>{read('partnerIdentityBinding');return facts.identity;}},
  documentArchive:{findFirst:async()=>{read('documentArchive');return facts.archive;}},
  archiveFeedback:{count:async()=>facts.feedbackOpen?1:0},
  partnerRevenueRule:{findMany:async()=>{read('partnerRevenueRule');return facts.rules.map(r=>({id:r.ruleId,currentApprovedVersionId:r.id}));}},
  partnerRevenueRuleVersion:{findMany:async({where}:any)=>{read('partnerRevenueRuleVersion');return facts.rules.filter(r=>where.id.in.includes(r.id)&&r.status===where.status&&r.vehicleIds.includes(where.vehicleIds.has)&&r.validFrom<=where.validFrom.lte&&r.validUntil>=where.validUntil.gte);}},
  storedFile:{findUnique:async()=>({id:'private-proof',sha256:'a'.repeat(64)}),count:async()=>0,findMany:async({where}:any)=>profileFacts.files.filter(file=>where.id.in.includes(file.id))},
  legalDocument:{findFirst:async({where}:any)=>({id:where.type,type:where.type,version:1,confirmedAt:new Date(),confirmedBy:'reviewer'})},
  customerConsent:{count:async()=>1,findMany:async()=>[],createMany:async()=>{writes.push('consent');return{count:1};}},
  customer:{findUnique:async()=>profileFacts.customer,update:async()=>{writes.push('customer');return{id:'customer'};}},eSignAccount:{findUnique:async()=>profileFacts.account},
  application:{findUnique:async()=>existing,findFirst:async()=>null,count:async()=>0,create:async({data}:any)=>{writes.push('application');existing={...data,id:'application',status:'SUBMITTED',revision:0,createdAt:new Date(),vehicle,subscriptionPlan:plan,finalPlans:[],order:null};return existing;}},
  order:{findFirst:async()=>null},
  auditLog:{create:async()=>{writes.push('audit');return{};}},
  insurancePolicy:{findMany:async()=>{throw Error('Insurance must remain a delivery gate');}},
  coverageRequirement:{findMany:async()=>{throw Error('Insurance must remain a delivery gate');}},
 };
 const db={...tx,serial:async(work:any)=>{serial=true;try{return await work(tx);}finally{serial=false;}}} as any;
 const input={vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:'合成申请人',fileIds:[]},consents:[{documentId:'application',version:1}],idempotencyKey:'application-eligibility-key'};
 const catalog=new CatalogController(db),applications=new ApplicationsController(db),request={customer:{id:'customer'}};
 return{facts,owner,vehicle,product,plan,scope,archiveVersion,rule,writes,locks,eligibilityReads,input,request,catalog,applications,tx,db,updateArchiveHash:()=>{archiveVersion.businessSnapshotHash=cooperationBusinessHash(owner.id,owner.revision,scope);}};
}

const cases:[string,(f:ReturnType<typeof fixture>)=>void][]=[
 ['missing ownership',f=>{f.facts.binding=null;}],
 ['unreviewed ownership',f=>{f.facts.binding.status='SUBMITTED';}],
 ['missing independent ownership review',f=>{f.facts.binding.reviewedBy=null;}],
 ['unreviewed admission',f=>{f.facts.verification.status='SUBMITTED';}],
 ['changed partner profile',f=>{f.owner.revision++;}],
 ['incomplete cooperation batch',f=>{f.facts.verification.completedActions.pop();}],
 ['suspended partner',f=>{f.owner.status='SUSPENDED';}],
 ['missing cooperation',f=>{f.facts.archive=null;}],
 ['unarchived cooperation',f=>{f.archiveVersion.status='SUBMITTED';}],
 ['expired cooperation',f=>{f.scope.validUntil='2020-01-02';f.updateArchiveHash();}],
 ['cooperation shorter than the selected product term',f=>{f.scope.validUntil=new Date(Date.now()+180*86400000).toISOString().slice(0,10);f.updateArchiveHash();}],
 ['cooperation excludes vehicle',f=>{f.scope.vehicleIds=['other'];f.updateArchiveHash();}],
 ['changed archived business hash',f=>{f.archiveVersion.businessSnapshotHash='b'.repeat(64);}],
 ['open cooperation feedback',f=>{f.facts.feedbackOpen=true;}],
 ['missing approved rule',f=>{f.facts.rules=[];}],
 ['unreviewed rule',f=>{f.rule.status='SUBMITTED';}],
 ['expired rule',f=>{f.rule.validUntil=new Date('2020-01-02');}],
 ['rule shorter than the selected product term',f=>{f.rule.validUntil=new Date(Date.now()+180*86400000);}],
 ['overlapping approved rules',f=>{f.facts.rules.push({...f.rule,id:'second-rule-version',ruleId:'second-rule'});}],
];
for(const [name,mutate]of cases)test(`OFFLINE ${name} is unavailable in both public views and rejected before any submission write`,async()=>{
 const f=fixture();mutate(f);
 const list=await f.catalog.vehicles({}),detail=await f.catalog.vehicle(f.vehicle.id);
 assert.equal(list.items[0].available,false);assert.equal(detail.vehicle.available,false);assert.equal(detail.vehicle.statusText,'暂不可申请');assert.equal(detail.plans[0].available,false);
 assert.equal(detail.vehicle.status,'PUBLISHED');assert.equal(detail.plans[0].monthlyFeeAmount,399900);
 const json=JSON.stringify({list,detail});for(const privateValue of ['owner-private','private-proof','finance-reviewer','rateBps','内部平台服务费'])assert.ok(!json.includes(privateValue),privateValue);
 await assert.rejects(f.applications.submit(f.input,f.request),(e:any)=>{assert.equal(e.getStatus(),409);const failure=e.getResponse().error;assert.equal(failure.code,'VEHICLE_UNAVAILABLE');assert.match(failure.message,/暂不可申请|暂时不可申请/);assert.ok(!/分润|核准规则|身份|owner-private/.test(failure.message));return true;});
 assert.deepEqual(f.writes,[]);assert.equal(f.vehicle.status,'PUBLISHED');
});

test('reviewed current cooperation permits application without querying insurance or creating an order',async()=>{
 const f=fixture(),detail=await f.catalog.vehicle(f.vehicle.id);assert.equal(detail.vehicle.available,true);assert.equal(detail.plans[0].available,true);
 f.eligibilityReads.length=0;const application=await f.applications.submit(f.input,f.request);
 assert.equal(application.status,'SUBMITTED');assert.equal(application.order,null);assert.equal(f.vehicle.status,'PUBLISHED');
 assert.ok(f.eligibilityReads.length>0);assert.ok(f.eligibilityReads.every(r=>r.serial),'Submission must reload cooperation eligibility inside its transaction');
 assert.deepEqual(f.writes,['consent','application','audit']);
 assert.equal('startDate' in application,false,'An availability window is not the customer-confirmed lease start');
 assert.equal('startDate' in await f.tx.application.findUnique({}),false,'Preflight dates must not be persisted into the application');
});
test('portal phone or grant state and historical Customer identity do not change business eligibility',async()=>{
 const f=fixture();assert.equal(await applicationCooperationEligible(f.tx,'vehicle',12),true);
 Object.assign(f.owner,{portalPhone:'13900000000',accessVersion:99,portalStatus:'DISABLED',ordinaryContactPhone:'13700000000',contactRevision:9});f.facts.identity.revokedAt=new Date();f.facts.identity.status='REVOKED';
 assert.equal(await applicationCooperationEligible(f.tx,'vehicle',12),true);assert.equal((await f.catalog.vehicle(f.vehicle.id)).vehicle.available,true);assert.ok(!f.eligibilityReads.some(r=>r.delegate==='partnerIdentityBinding'));
});

test('stale public availability cannot authorize submit, while an already successful idempotent request is retained',async()=>{
 const f=fixture();assert.equal((await f.catalog.vehicle(f.vehicle.id)).vehicle.available,true);f.facts.binding=null;
 await assert.rejects(f.applications.submit(f.input,f.request));assert.deepEqual(f.writes,[]);
 const good=fixture(),first=await good.applications.submit(good.input,good.request);good.facts.binding=null;good.eligibilityReads.length=0;const writesBefore=good.writes.length;
 assert.equal((await good.applications.submit(good.input,good.request)).id,first.id);assert.equal(good.writes.length,writesBefore);assert.deepEqual(good.eligibilityReads,[]);
 await assert.rejects(good.applications.submit({...good.input,profile:{...good.input.profile,name:'不同内容'}},good.request),(e:any)=>e.getResponse().error.code==='IDEMPOTENCY_CONFLICT');
});

test('explicit historical ESIGN mode retains its previous application path',async()=>{
 process.env.NEW_ORDER_CONTRACT_MODE='ESIGN';try{const f=fixture();f.facts.binding=null;assert.equal((await f.catalog.vehicle(f.vehicle.id)).vehicle.available,true);assert.equal((await f.applications.submit(f.input,f.request)).status,'SUBMITTED');assert.deepEqual(f.eligibilityReads,[]);}finally{process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';}
});

test('unexpected eligibility read errors never become available and never write an application',async()=>{
 const f=fixture();f.tx.ownerVehicle.findUnique=async()=>{throw Error('synthetic read failed');};
 await assert.rejects(f.catalog.vehicle(f.vehicle.id),/synthetic read failed/);
 await assert.rejects(f.applications.submit(f.input,f.request),/synthetic read failed/);assert.deepEqual(f.writes,[]);
});

test('home recommendations use the same published product and current cooperation gate as the public catalogue',async()=>{
 const f=fixture(),customer=new CustomerController(f.db),request={customer:{id:'customer',name:'合成客户',profile:{},mobile:'00000000000',drivingYears:1}};
 assert.equal((await customer.home(request)).vehicles[0].available,true);assert.equal((await customer.home(request)).vehicles[0].minFeeAmount,399900);
 f.facts.binding=null;assert.equal((await customer.home(request)).vehicles[0].available,false);assert.deepEqual(f.writes,[]);
});

test('preflight uses Shanghai current day and the complete selected term, including exact inclusive end',async()=>{
 const f=fixture();Object.assign(f.scope,{validFrom:'2026-10-28',validUntil:'2027-10-27'});f.updateArchiveHash();Object.assign(f.rule,{validFrom:new Date(f.scope.validFrom),validUntil:new Date(f.scope.validUntil)});Object.assign(f.rule.terms,{validFrom:f.scope.validFrom,validUntil:f.scope.validUntil});
 assert.equal(await applicationCooperationEligible(f.tx,'vehicle',12,new Date('2026-10-27T15:59:59.999Z')),false);
 assert.equal(await applicationCooperationEligible(f.tx,'vehicle',12,new Date('2026-10-27T16:00:00.000Z')),true);
 assert.equal(await applicationCooperationEligible(f.tx,'vehicle',12,new Date('2026-10-28T16:00:00.000Z')),false);
});

test('different product durations retain individual availability and read selectors do not acquire write locks',async()=>{
 const f=fixture(),at=new Date('2026-10-28T00:00:00Z');f.scope.validUntil='2028-04-28';f.updateArchiveHash();f.rule.validUntil=new Date(f.scope.validUntil);f.rule.terms.validUntil=f.scope.validUntil;
 f.vehicle.plans.push({...f.plan,id:'long-plan',productVersionId:'long-product-version',listing:{...f.plan.listing,id:'long-legacy-listing',productVersionId:'long-product-version',subscriptionPlanId:'long-plan'},productVersion:{...f.product,id:'long-product-version',months:24,monthlyFeeAmount:200000}});
 const result=await catalogVehicleViews(f.tx,f.vehicle,at);assert.equal(result.vehicle.available,true);assert.deepEqual(Object.fromEntries(result.plans.map((p:any)=>[p.id,p.available])),{plan:true,'long-plan':false});assert.equal(result.vehicle.minFeeAmount,399900,'The available vehicle must advertise its lowest eligible price, not an unavailable longer term');assert.deepEqual(f.locks,[]);
 f.facts.binding=null;const unavailable=await catalogVehicleViews(f.tx,f.vehicle,at);assert.equal(unavailable.vehicle.available,false);assert.equal(unavailable.vehicle.minFeeAmount,200000,'Published prices may remain visible when the entire vehicle is clearly unavailable');
 await snapshotRevenueRule(f.tx,f.owner.id,'vehicle','2026-10-28','2027-10-27');assert.equal(f.locks.length,1);assert.match(String(f.locks[0][0]),/FOR UPDATE/,'Existing snapshot writes must still hold the owner lock');
});
