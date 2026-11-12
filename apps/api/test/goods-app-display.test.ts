import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoodsService} from '../src/goods/service';
import {catalogVehicleViews,planView,CatalogController} from '../src/catalog/catalog';
import {versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';

const actor={id:'operator',role:'OPERATIONS',authVersion:1},at=new Date('2026-11-05T00:00:00Z');
function fixture(){
 const vehicle:any={id:'vehicle',revision:4,status:'PUBLISHED',catalogPublished:true,reservedOrderId:null,holdId:null,title:'合成车辆',brand:'合成',model:'车型',year:2026,city:'上海',mileageKm:100,modelDefinitionId:'model',mediaFileIds:[],coverFileId:null};
 const version:any={id:'version',productId:'product',version:1,revision:0,status:'PUBLISHED',name:'合成方案',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',conditions:'合成约定',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const plan:any={id:'plan',vehicleId:vehicle.id,productVersionId:version.id,active:true},snapshot=versionSnapshot(version),listing:any={id:'goods',vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id,revision:1,status:'PUBLISHED',visible:true,source:'EXPLICIT',productSourceHash:canonicalHash(snapshot),snapshot,inspectionSnapshots:[]};
 const agreement:any={id:'agreement',ownerId:'owner',status:'ACTIVE',currentVersionId:'agreement-version'},agreementVersion:any={id:'agreement-version',agreementId:'agreement',ownerId:'owner',version:1,status:'ACTIVE',vehicleIds:[vehicle.id],fileIds:['agreement-file'],partnerRateBps:1000,validFrom:'2020-01-01',validUntil:'2099-01-01',contentHash:'real-synthetic-hash',title:'合成合作'};
 const commands:any[]=[],audits:any[]=[];let active=true,restriction=0,eligibilityReads=0;
 const joined=()=>({...listing,vehicle,productVersion:version,subscriptionPlan:plan});
 const publicVehicle=()=>({...vehicle,plans:[{...plan,listing,productVersion:version}]});
 const tx:any={$queryRaw:async()=>[],
  adminUser:{findUnique:async()=>({...actor,active})},vehicleListing:{findMany:async()=>[joined()],count:async()=>1,findUnique:async()=>joined(),updateMany:async({where,data}:any)=>{if(where.id!==listing.id||where.revision!==listing.revision||where.status!==listing.status)return{count:0};const {revision,...values}=data;Object.assign(listing,values);listing.revision+=revision.increment;return{count:1};}},
  vehicle:{findUnique:async()=>({...vehicle,modelDefinition:{id:'model',name:'车型'}}),findMany:async({distinct}:any)=>distinct?[{brand:vehicle.brand}]:vehicle.status==='PUBLISHED'?[publicVehicle()]:[],count:async()=>vehicle.status==='PUBLISHED'?1:0,findFirst:async()=>vehicle.status==='PUBLISHED'?publicVehicle():null},
  subscriptionPlan:{updateMany:async({data}:any)=>{Object.assign(plan,data);return{count:1};}},
  productCommand:{findUnique:async({where}:any)=>{const k=where.actorId_resourceId_action_key;return commands.find(c=>c.actorId===k.actorId&&c.resourceId===k.resourceId&&c.action===k.action&&c.key===k.key);},create:async({data}:any)=>{commands.push(data);return data;}},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  vehicleOperationalRestriction:{count:async()=>{eligibilityReads++;return restriction;}},partnerAgreementVehicle:{findUnique:async()=>({vehicleId:vehicle.id,ownerId:'owner',agreementId:'agreement',agreementVersionId:'agreement-version'})},partnerAgreement:{findUnique:async()=>agreement},partnerAgreementVersion:{findUnique:async()=>agreementVersion},vehicleOwner:{findUnique:async()=>({id:'owner',name:'合成合作方',status:'DRAFT',cooperationMode:'SIMPLE'})},ownerVehicle:{findUnique:async()=>null},
  storedFile:{findMany:async()=>[{id:'agreement-file',purpose:'contract',adminId:'operator',customerId:null,mimeType:'application/pdf',sha256:'a'.repeat(64)}],count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},vehicleInspectionFile:{count:async()=>0}
 };
 return{tx,vehicle,version,plan,listing,agreement,agreementVersion,commands,audits,publicVehicle,setRestriction:(v:number)=>{restriction=v;},setActive:(v:boolean)=>{active=v;},eligibilityReads:()=>eligibilityReads};
}
async function offline(work:()=>Promise<void>){const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';try{await work();}finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}}

test('published visible goods on a draft/unpublished vehicle are not visible in App or public vehicle results',()=>offline(async()=>{
 for(const status of ['DRAFT','UNPUBLISHED','RESERVED','IN_USE']){const f=fixture();f.vehicle.status=status;const detail=await new GoodsService().detail(f.tx,actor,'goods');assert.equal(detail.appDisplay?.state,'NOT_VISIBLE',status);assert.equal(detail.appDisplay.visible,false);assert.equal(detail.appDisplay.available,false);assert(detail.appDisplay.reasons.some((r:any)=>r.code==='VEHICLE_NOT_PUBLISHED'));assert.equal((await new CatalogController(f.tx).vehicles({})).total,0);assert.equal(f.eligibilityReads(),0);}
}));

test('App-visible source-valid goods can be available without photos or a fresh readiness result',()=>offline(async()=>{
 const f=fixture(),detail=await new GoodsService().detail(f.tx,actor,'goods');assert.deepEqual({...detail.appDisplay,checkedAt:'ignored'},{visible:true,available:true,state:'VISIBLE_AVAILABLE',reasons:[],checkedAt:'ignored'});assert(Number.isFinite(Date.parse(detail.appDisplay.checkedAt)));
 const publicView=await catalogVehicleViews(f.tx,f.publicVehicle(),at);assert.equal(publicView.plans.length,1);assert.equal(publicView.plans[0].available,detail.appDisplay.available);assert.equal(publicView.vehicle.available,detail.appDisplay.available);assert.equal(detail.vehicle.status,'PUBLISHED');
}));

test('hold, reservation and cooperation restrictions disable application without hiding an active public plan',()=>offline(async()=>{
 for(const kind of ['hold','reserved','cooperation','restriction']){const f=fixture();if(kind==='hold')f.vehicle.holdId='private-hold';if(kind==='reserved')f.vehicle.reservedOrderId='private-order';if(kind==='cooperation')f.agreement.status='STOPPED';if(kind==='restriction')f.setRestriction(1);
  const detail=await new GoodsService().detail(f.tx,actor,'goods'),view=await catalogVehicleViews(f.tx,f.publicVehicle(),at);assert.equal(detail.appDisplay?.state,'VISIBLE_UNAVAILABLE',kind);assert.equal(detail.appDisplay.visible,true);assert.equal(detail.appDisplay.available,false);assert(detail.appDisplay.reasons.length);assert.equal(view.plans.length,1);assert.equal(view.plans[0].available,false);assert.equal(view.vehicle.available,false);assert.equal(JSON.stringify(detail.appDisplay).includes('private-'),false);
 }
}));

test('listing flags, inactive plans and invalid source facts give precise NOT_VISIBLE reasons and preserve public predicates',()=>offline(async()=>{
 const cases:[string,(f:any)=>void][]=[['DISPLAY_DISABLED',f=>f.listing.visible=false],['GOODS_NOT_PUBLISHED',f=>f.listing.status='WITHDRAWN'],['PLAN_INACTIVE',f=>f.plan.active=false],['PRODUCT_UNAVAILABLE',f=>f.version.status='RETIRED'],['GOODS_SOURCE_CHANGED',f=>f.listing.productSourceHash='bad'],['PRODUCT_SCOPE_MISMATCH',f=>f.version.vehicleIds=['other']],['GOODS_SOURCE_MISMATCH',f=>f.listing.subscriptionPlanId='other'],['PRODUCT_CONFIGURATION_INVALID',f=>f.version.monthlyFeeAmount=0]];
 for(const [reason,mutate] of cases){const f=fixture();mutate(f);const detail=await new GoodsService().detail(f.tx,actor,'goods');assert.equal(detail.appDisplay?.state,'NOT_VISIBLE',reason);assert(detail.appDisplay.reasons.some((r:any)=>r.code===reason),JSON.stringify(detail.appDisplay));assert.equal((planView({...f.plan,listing:f.listing,productVersion:f.version},true,f.vehicle) as any).active,undefined);assert.equal(f.eligibilityReads(),0);}
 const migrated=fixture();Object.assign(migrated.listing,{source:'LEGACY_MIGRATED',productSourceHash:null,snapshot:null});assert.equal((await new GoodsService().detail(migrated.tx,actor,'goods')).appDisplay.visible,true,'legacy double-null reconstruction remains the public rule');
}));

test('list and detail use the same current projection and public availability uses this product term',()=>offline(async()=>{
 const f=fixture(),service=new GoodsService();f.agreementVersion.validUntil='2028-01-01';
 const short=await service.detail(f.tx,actor,'goods');assert.equal(short.appDisplay?.available,true);
 f.version.months=60;const snapshot=versionSnapshot(f.version);Object.assign(f.listing,{snapshot,productSourceHash:canonicalHash(snapshot)});
 const long=await service.detail(f.tx,actor,'goods');assert.equal(long.appDisplay.state,'VISIBLE_UNAVAILABLE');assert.equal((await catalogVehicleViews(f.tx,f.publicVehicle(),at)).plans[0].available,false);
 const page=await service.list(f.tx,actor,{});assert.deepEqual({...page.items[0].appDisplay,checkedAt:'same'},{...long.appDisplay,checkedAt:'same'});assert.equal(page.total,1);
}));

test('mutation acknowledgements carry their actual app projection and idempotent replay retains the original checkedAt',()=>offline(async()=>{
 const f=fixture(),service=new GoodsService(),body={revision:1,idempotencyKey:'display-hide-ack',visible:false};
 const hidden=await service.update(f.tx,actor,'goods',body);assert.equal(hidden.appDisplay?.state,'NOT_VISIBLE');assert(hidden.appDisplay.reasons.some((r:any)=>r.code==='DISPLAY_DISABLED'));
 f.vehicle.status='DRAFT';assert.deepEqual(await service.update(f.tx,actor,'goods',body),hidden);assert.equal(f.audits.length,1);assert.equal(f.commands.length,1);
 const withdrawn=await service.withdraw(f.tx,actor,'goods',{revision:2,idempotencyKey:'display-withdraw-ack'});assert.equal(withdrawn.appDisplay.state,'NOT_VISIBLE');assert(withdrawn.appDisplay.reasons.some((r:any)=>r.code==='GOODS_NOT_PUBLISHED'));
 f.setActive(false);await assert.rejects(service.detail(f.tx,actor,'goods'),(e:any)=>e.response?.error?.code==='STAFF_SESSION_CHANGED');
}));
