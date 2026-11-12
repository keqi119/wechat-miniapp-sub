import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {versionSnapshot} from '../src/products/snapshot';
import {addPublicationFacts,syntheticPublicationFile} from './publish-readiness-fixture';
import {GoodsService} from '../src/goods/service';
import {AdminController} from '../src/operations/admin';
import {GoodsController} from '../src/goods/controller';
import {CatalogController,planView} from '../src/catalog/catalog';
import {Module} from '@nestjs/common';
import {APP_GUARD,NestFactory} from '@nestjs/core';
import {Db} from '../src/common/db';
import {Access} from '../src/auth/access';
import {Errors} from '../src/common/errors';
import {tokenHash} from '../src/auth/auth.service';
import cookieParser from 'cookie-parser';

const actor={id:'operator',role:'OPERATIONS',authVersion:1},now=new Date('2026-11-04T07:00:00Z'),code=(value:string)=>(e:any)=>e?.response?.error?.code===value;
async function readiness(s:any,goodsId?:string){const api:any=await import('../src/vehicles/publish-readiness').catch(()=>({}));assert.equal(typeof api.publicationReadiness,'function','shared publication readiness is implemented');return api.publicationReadiness(s.tx,s.vehicle.id,goodsId,now);}
function fixture(){
 const vehicle:any={id:'vehicle',vin:'LSVNV2182E2182777',plateNumber:'沪A00001',revision:3,status:'DRAFT',reservedOrderId:null,holdId:null,description:'',conditionDisclosure:''};
 const version:any={id:'product-version',productId:'product',version:1,configurationVersion:1,revision:0,status:'PUBLISHED',name:'真实12个月',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'真实条款',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const plan:any={id:'plan',vehicleId:vehicle.id,productVersionId:version.id,active:false};const snapshot=versionSnapshot(version),listing:any={id:'goods',vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id,revision:2,status:'DRAFT',source:'EXPLICIT',productSourceHash:canonicalHash(snapshot),snapshot,inspectionSnapshots:[],visible:true};
 const commands:any[]=[],audits:any[]=[],events:string[]=[];let current:any={...actor,active:true};const joined=()=>({...listing,vehicle,productVersion:version,subscriptionPlan:plan});
 const lookup=(where:any)=>commands.find(c=>JSON.stringify(where.actorId_resourceId_action_key)===JSON.stringify({actorId:c.actorId,resourceId:c.resourceId,action:c.action,key:c.key}));
 const tx:any={adminUser:{findUnique:async()=>current},$queryRaw:async()=>{events.push('lock');return[];},$executeRaw:async()=>0,
  vehicle:{findUnique:async({where}:any)=>where.id===vehicle.id?vehicle:null,update:async({data}:any)=>{events.push('vehicle-write');vehicle.status=data.status;vehicle.revision++;return{...vehicle};}},
  productVersion:{findUnique:async()=>version},vehicleListing:{findUnique:async({where}:any)=>where.id===listing.id?joined():null,findMany:async()=>[joined()],updateMany:async({where,data}:any)=>{if(where.id!==listing.id||where.revision!==listing.revision||where.status!==listing.status)return{count:0};const {revision,...fields}=data;Object.assign(listing,fields);listing.revision+=revision.increment;events.push('goods-write');return{count:1};}},subscriptionPlan:{findMany:async()=>[{...plan,productVersion:version}],updateMany:async({data}:any)=>{Object.assign(plan,data);return{count:1};}},
  productCommand:{findUnique:async({where}:any)=>lookup(where),create:async({data}:any)=>{commands.push(structuredClone(data));return data;}},archiveCommand:{findUnique:async({where}:any)=>lookup(where),create:async({data}:any)=>{commands.push(structuredClone(data));return data;}},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}}
 };
 const facts=addPublicationFacts(tx,vehicle);tx.serial=async(fn:any)=>fn(tx);
 return{tx,vehicle,version,plan,listing,commands,audits,events,...facts,setStaff:(v:any)=>{current=v;}};
}

test('fixed six readiness checks use actual Shanghai publication date and allow complete draft slots',async()=>{
 const f=fixture(),r=await readiness(f);assert.equal(r.ready,true);assert.equal(r.publicationDate,'2026-11-04');assert.equal(r.vehicleRevision,3);assert.deepEqual(r.checks.map((c:any)=>c.key),['VEHICLE_INFO','PARTNER_INFO','PRODUCT','PHOTOS','BAAS','CONDITION']);assert.equal(r.checks[4].required,false);assert.equal(r.checks[4].passed,true);assert.equal(f.plan.active,false);assert.equal(f.listing.status,'DRAFT');
 const specific=await readiness(f,'goods');assert.equal(specific.goodsId,'goods');assert.equal(specific.goodsRevision,2);assert.equal(specific.ready,true);
});

test('every missing category blocks precisely and detailed condition narrative is optional',async()=>{
 const changes:any={VEHICLE_INFO:(f:any)=>f.vehicle.vin='',PARTNER_INFO:(f:any)=>f.owner.contactPhone='',PRODUCT:(f:any)=>f.listing.productSourceHash='bad',PHOTOS:(f:any)=>f.vehicle.mediaFileIds=[],CONDITION:(f:any)=>f.condition.fireDamage=null};
 for(const [key,change] of Object.entries(changes)){const f=fixture();(change as any)(f);const r=await readiness(f);assert.equal(r.ready,false,key);assert.equal(r.checks.find((c:any)=>c.key===key).passed,false,key);assert(r.checks.find((c:any)=>c.key===key).messages.length,key);}
 const f=fixture();Object.assign(f.condition,{fireDamage:true,floodDamage:true,structuralDamage:true});assert.equal((await readiness(f)).ready,true,'truthful damage flags never require a false clean claim');
});

test('BaaS publication accepts eight complete draft fields and signed PDF without battery specification or payment',async()=>{
 const f=fixture();f.asset.batteryOwnership='BAAS';assert.equal((await readiness(f)).checks.find((c:any)=>c.key==='BAAS').passed,false);
 f.asset.registeredOwnerName='合成登记车主';const pdf=syntheticPublicationFile('baas-signed-pdf','asset-baas','application/pdf',Buffer.from('%PDF-1.4 synthetic signed contract'));f.files.push(pdf);
 f.baas.push({id:'baas',vehicleId:f.vehicle.id,status:'DRAFT',revision:0,contractNumber:'B-1',supplierContractNumber:'',provider:'电池出租方',batteryPackage:null,batterySerialNumber:'',effectiveFrom:new Date('2026-01-01'),effectiveTo:null,billingCycle:'MONTHLY',rentalAmount:98000,paymentDayOfMonth:15,graceDays:0,invoiceRequired:false,taxIncluded:null,currency:'CNY',notes:'',previousContractId:null,createdAt:now,lesseeName:'合成登记车主',payerOwnerId:f.owner.id});
 f.tx.vehicleBaasContract.findUnique=async()=>f.baas[0];f.tx.assetPrivateFile.findMany=async()=>[{fileId:pdf.id,kind:'BAAS',baasContractId:'baas',depreciationPolicyId:null,costEntryId:null,licensePlateId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,sha256:pdf.sha256,uploadedBy:'operator',file:pdf}];assert.equal((await readiness(f)).ready,true);
 pdf.mimeType='image/png';assert.equal((await readiness(f)).checks.find((item:any)=>item.key==='BAAS').passed,false);pdf.mimeType='application/pdf';
 f.baas[0].status='TERMINATED';assert.equal((await readiness(f)).ready,false);f.asset.batteryOwnership='UNKNOWN';assert.equal((await readiness(f)).checks.find((c:any)=>c.key==='VEHICLE_INFO').passed,false);
});

test('a newer incomplete BaaS draft does not hide the actual complete active contract from publication readiness',async()=>{
 const f=fixture();f.asset.batteryOwnership='BAAS';f.asset.registeredOwnerName='合成登记车主';
 const pdf=syntheticPublicationFile('active-baas-signed','asset-baas','application/pdf',Buffer.from('%PDF-1.4 synthetic active signed contract'));f.files.push(pdf);
 const active={id:'active-baas',vehicleId:f.vehicle.id,status:'ACTIVE',activatedAt:now,revision:1,contractNumber:'ACTUAL-ACTIVE',supplierContractNumber:'8109-ACTIVE',provider:'出租公司',effectiveFrom:new Date('2026-01-01'),effectiveTo:null,billingCycle:'MONTHLY',rentalAmount:72800,paymentDayOfMonth:8,lesseeName:'合成登记车主',payerOwnerId:f.owner.id,createdAt:new Date('2026-01-01')};
 f.baas.push({id:'new-incomplete-draft',vehicleId:f.vehicle.id,status:'DRAFT',contractNumber:'BAAS-00000000-0000-0000-0000-000000000000',createdAt:now},active);
 f.tx.vehicleBaasContract.findUnique=async({where}:any)=>f.baas.find((row:any)=>row.id===where.id)??null;
 f.tx.assetPrivateFile.findMany=async({where}:any)=>where.baasContractId===active.id?[{fileId:pdf.id,kind:'BAAS',baasContractId:active.id,depreciationPolicyId:null,costEntryId:null,licensePlateId:null,observationId:null,valuationReviewId:null,workOrderId:null,workOrderCostId:null,sha256:pdf.sha256,uploadedBy:'operator',file:pdf}]:[];
 const check=(await readiness(f)).checks.find((row:any)=>row.key==='BAAS');assert.equal(check.passed,true);assert.deepEqual(check.messages,[]);
});

test('photo identifiers alone cannot pass absent, corrupt or private byte ownership checks',async()=>{
 for(const mutate of [(f:any)=>{f.publicFile.sha256='b'.repeat(64);},(f:any)=>{f.publicFile.storagePath+='.missing';},(f:any)=>{f.publicFile.purpose='insurance';},(f:any)=>{f.publicFile.customerId='customer';},(f:any)=>{f.tx.vehicleDocumentFile={...f.tx.vehicleDocumentFile,count:async()=>1};}]){const f=fixture();mutate(f);assert.equal((await readiness(f)).checks.find((c:any)=>c.key==='PHOTOS').passed,false);}
 const f=fixture();f.vehicle.coverFileId=null;assert.equal((await readiness(f)).checks.find((c:any)=>c.key==='PHOTOS').passed,false);
});

test('goods publish rechecks all categories, freezes only true basic condition and preserves inspection v1',async()=>{
 const f=fixture(),goods=new GoodsService(),input={revision:2,idempotencyKey:'publish-new-facts'};f.vehicle.catalogPublished=true;f.condition.fireDamage=true;
 const preview=await readiness(f,'goods');assert.equal(preview.ready,true);f.owner.contactPhone='';await assert.rejects(goods.publish(f.tx,actor,'goods',input),code('PUBLISH_REQUIREMENTS'));assert.equal(f.listing.status,'DRAFT');assert.equal(f.commands.length,0);
 f.owner.contactPhone='13800000000';const published=await goods.publish(f.tx,actor,'goods',input);assert.equal(published.status,'PUBLISHED');assert.equal(f.listing.basicConditionSnapshot.fireDamage,true);assert.equal(f.listing.basicConditionSnapshot.sourceRevision,1);assert.deepEqual(f.listing.inspectionSnapshots,[]);assert.equal(f.plan.active,true);assert(f.events.indexOf('lock')<f.events.indexOf('goods-write'));
 f.condition.fireDamage=false;const replay=await goods.publish(f.tx,actor,'goods',input);assert.deepEqual(replay,published);assert.equal(f.listing.basicConditionSnapshot.fireDamage,true);
 const publicPlan=planView({...f.plan,vehicle:f.vehicle,productVersion:f.version,listing:f.listing});assert.equal((publicPlan as any).basicCondition.fireDamage,true);assert.equal(JSON.stringify(publicPlan).includes('assessedBy'),false);assert.equal(JSON.stringify(publicPlan).includes('operator'),false);
});

test('existing miniapp report label/value and narrative expose true damage without a client source change',async()=>{
 const f=fixture();f.vehicle.catalogPublished=true;f.condition.fireDamage=true;await new GoodsService().publish(f.tx,actor,'goods',{revision:2,idempotencyKey:'publish-client-disclosure'});f.vehicle.status='PUBLISHED';f.vehicle.holdId='synthetic-held';
 f.tx.vehicle.findFirst=async()=>({...f.vehicle,plans:[{...f.plan,listing:f.listing,productVersion:f.version}]});
 const result=await new CatalogController(f.tx).vehicle(f.vehicle.id);
 assert.equal(result.report.items.find((row:any)=>row.label==='是否火烧')?.value,'是');assert.equal(result.report.items.find((row:any)=>row.label==='是否泡水')?.value,'否');assert.match(result.vehicle.conditionDisclosure,/火烧：是/);assert.equal(JSON.stringify(result).includes('assessedBy'),false);assert.equal(JSON.stringify(result).includes('operator'),false);
});

test('HTTP readiness denies finance/support private vehicle checks and keeps publication CSRF authoritative',async()=>{
 const f=fixture(),raw='synthetic-readiness-session';let who:any={...actor,active:true};f.tx.adminSession={findUnique:async({where}:any)=>where.id===tokenHash(raw)?{id:where.id,admin:who,authVersion:1,csrfToken:'synthetic-readiness-csrf',expiresAt:new Date(Date.now()+60000)}:null};
 @Module({controllers:[AdminController,GoodsController],providers:[{provide:Db,useValue:f.tx},{provide:APP_GUARD,useClass:Access}]})class ReadinessHttpModule{}
 const app=await NestFactory.create(ReadinessHttpModule,{logger:false});app.setGlobalPrefix('api');app.use(cookieParser());app.useGlobalFilters(new Errors());
 try{await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={Cookie:'admin_session='+raw},vehicle=base+'/api/admin/vehicles/vehicle/publish-readiness',goods=base+'/api/admin/goods/goods/publish-readiness';
  assert.equal((await fetch(vehicle)).status,401);for(const role of ['FINANCE','SUPPORT']){who={...actor,role,active:true};f.setStaff(who);assert.equal((await fetch(vehicle,{headers})).status,403,role);assert.equal((await fetch(goods,{headers})).status,403,role);}
  who={...actor,active:true};f.setStaff(who);const preview=await fetch(vehicle,{headers});assert.equal(preview.status,200);assert.equal((await preview.json() as any).checks.length,6);assert.equal((await fetch(goods,{headers})).status,200);
  assert.equal((await fetch(base+'/api/admin/goods/goods/publish',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({revision:2,idempotencyKey:'http-no-csrf-readiness'})})).status,403);assert.equal(f.listing.status,'DRAFT');
 }finally{await app.close();}
});

test('physical vehicle activation uses only basic readiness and preserves current scheme content',async()=>{
 const old=process.env.MVP_V2_ENABLED;process.env.MVP_V2_ENABLED='true';try{
  const f=fixture(),controller=new AdminController(f.tx),input={revision:3,idempotencyKey:'publish-physical-facts'};f.condition.structuralDamage=null;
  f.owner.contactPhone='';f.policies.length=0;f.vehicle.coverFileId=null;f.vehicle.mediaFileIds=[];const previous={old:'published-content'};f.listing.basicConditionSnapshot=previous;
  const result:any=await controller.publishVehicle(f.vehicle.id,{admin:actor},input);assert.equal(result.status,'PUBLISHED');assert.equal(f.vehicle.revision,4);assert.equal(f.listing.status,'DRAFT');assert.deepEqual(f.listing.basicConditionSnapshot,previous);assert.equal(f.vehicle.catalogPublished,undefined);
  const occupied=fixture();occupied.vehicle.holdId='hold';await assert.rejects(new AdminController(occupied.tx).publishVehicle(occupied.vehicle.id,{admin:actor},input),code('VEHICLE_RESERVED'));
 }finally{if(old===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=old;}
});

test('uninsured, future and expired insurance do not block product or vehicle catalog publication',async()=>{
 for(const mode of ['missing','future','expired']){const f=fixture();if(mode==='missing')f.policies.length=0;else for(const p of f.policies)p.versions[0][mode==='future'?'startAt':'endAt']=mode==='future'?new Date('2040-01-01'):now;f.tx.insurancePolicy.findMany=async()=>{throw Error('Publication must not query insurance');};
 const preview=await readiness(f,'goods');assert.equal(preview.ready,true);assert.equal(preview.checks.some((c:any)=>c.key==='INSURANCE'),false);f.vehicle.catalogPublished=true;assert.equal((await new GoodsService().publish(f.tx,actor,'goods',{revision:2,idempotencyKey:'no-insurance-'+mode})).status,'PUBLISHED');}
});
