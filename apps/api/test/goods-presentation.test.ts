import test from 'node:test';
import assert from 'node:assert/strict';
import {GoodsService} from '../src/goods/service';
import {catalogVehicleViews} from '../src/catalog/catalog';
import {canonicalHash} from '../src/customers/types';
import {versionSnapshot} from '../src/products/snapshot';

const actor={id:'staff',role:'OPERATIONS',authVersion:1};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
function fixture(){
 const vehicle:any={id:'car',revision:4,brand:'NIO',model:'ES6',title:'真实车型',year:2024,city:'上海',mileageKm:12345,description:'公开介绍',conditionDisclosure:'公开披露',mediaFileIds:[],coverFileId:null,status:'PUBLISHED',catalogPublished:true,privateCost:999999};
 const version:any={id:'version',productId:'product',version:2,status:'PUBLISHED',name:'真实套餐',months:12,monthlyFeeAmount:654321,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'客户自付',conditions:'真实冻结条款',vehicleIds:['car'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const plan:any={id:'plan',vehicleId:'car',productVersionId:'version',active:true,monthlyFeeAmount:1,productVersion:version};
 const listing:any={id:'goods',vehicleId:'car',subscriptionPlanId:'plan',productVersionId:'version',revision:3,status:'PUBLISHED',visible:true,source:'EXPLICIT',snapshot:versionSnapshot(version),productSourceHash:canonicalHash(versionSnapshot(version)),inspectionSnapshots:[]};
 const commands:any[]=[],audits:any[]=[],locks:string[]=[];let staff:any={...actor,active:true};
 const joined=()=>({...listing,vehicle,productVersion:version,subscriptionPlan:plan});
 const match=(row:any,w:any)=>Object.entries(w).every(([k,v])=>row[k]===v);
 const update=(row:any,w:any,d:any)=>{if(!match(row,w))return{count:0};for(const[k,v]of Object.entries(d))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+(v as any).increment:v;return{count:1};};
 const tx:any={ownerVehicle:{findUnique:async()=>null},adminUser:{findUnique:async()=>staff},vehicleOperationalRestriction:{count:async()=>0},$queryRaw:async(q:any)=>{locks.push(q.join('?'));return[];},
  vehicle:{findUnique:async()=>({...vehicle,plans:[{...plan,listing,productVersion:version}] }),updateMany:async({where,data}:any)=>update(vehicle,where,data)},
  vehicleListing:{findUnique:async()=>joined(),updateMany:async({where,data}:any)=>update(listing,where,data)},
  productCommand:{findUnique:async({where}:any)=>commands.find(c=>match(c,where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.push(structuredClone(data));return data;}},
  auditLog:{create:async({data}:any)=>{audits.push(data);return data;}}
 };
 return{tx,vehicle,version,plan,listing,commands,audits,locks,setStaff:(s:any)=>staff=s};
}
test('App preview uses the exact public projection and published product price, without private vehicle facts',async()=>{
 const f=fixture(),s:any=new GoodsService(),at=new Date('2026-11-05T00:00:00Z');
 assert.equal(typeof s.appPreview,'function');
 const preview=await s.appPreview(f.tx,actor,'goods',at),actual=await catalogVehicleViews(f.tx,await f.tx.vehicle.findUnique({}),at);
 assert.deepEqual(preview.vehicle,actual.vehicle);assert.deepEqual(preview.plans,actual.plans);
 assert.equal(preview.selectedPlan.monthlyFeeAmount,654321);assert.equal(preview.mode,'LIVE');assert.equal(JSON.stringify(preview).includes('privateCost'),false);
});
test('draft preview keeps actual source terms but never grants public visibility or application eligibility',async()=>{
 const f=fixture(),s:any=new GoodsService();f.listing.status='DRAFT';f.plan.active=false;
 assert.equal(typeof s.appPreview,'function');const result=await s.appPreview(f.tx,actor,'goods');
 assert.equal(result.mode,'DRAFT_PREVIEW');assert.equal(result.appDisplay.visible,false);assert.equal(result.vehicle.available,false);assert.equal(result.selectedPlan.available,false);assert.equal(result.selectedPlan.monthlyFeeAmount,654321);assert.equal(f.listing.status,'DRAFT');assert.equal(f.plan.active,false);
 f.listing.snapshot.monthlyFeeAmount=1;await assert.rejects(s.appPreview(f.tx,actor,'goods'),code('GOODS_SOURCE_CHANGED'));
});
test('shared presentation edits require both write permissions, atomically compare both revisions and replay exact commands',async()=>{
 const f=fixture(),s:any=new GoodsService(),body={revision:3,vehicleRevision:4,idempotencyKey:'edit-materials',title:'新标题',description:'新文案',conditionDisclosure:'新披露'};
 assert.equal(typeof s.updatePresentation,'function');const result=await s.updatePresentation(f.tx,actor,'goods',body);
 assert.equal(result.vehicleRevision,5);assert.equal(result.listingRevision,4);assert.equal(f.vehicle.title,'新标题');assert.equal(f.listing.status,'PUBLISHED');assert.equal(f.plan.monthlyFeeAmount,1);assert.equal(f.version.monthlyFeeAmount,654321);assert.equal(f.audits.length,1);assert.match(f.locks[0],/Vehicle/);assert.match(f.locks[1],/VehicleListing/);
 assert.deepEqual(await s.updatePresentation(f.tx,actor,'goods',body),result);assert.equal(f.audits.length,1);
 await assert.rejects(s.updatePresentation(f.tx,actor,'goods',{...body,title:'不同'}),code('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(s.updatePresentation(f.tx,actor,'goods',{...body,idempotencyKey:'stale-materials'}),code('REVISION_CONFLICT'));
 await assert.rejects(s.updatePresentation(f.tx,actor,'goods',{...body,monthlyFeeAmount:1}));
 f.setStaff({...actor,active:false});await assert.rejects(s.updatePresentation(f.tx,actor,'goods',body),code('STAFF_SESSION_CHANGED'));
});
test('presentation reads recheck staff and reserved vehicle edits fail closed',async()=>{
 const f=fixture(),s:any=new GoodsService();assert.equal(typeof s.appPreview,'function');
 f.setStaff({...actor,role:'FINANCE',active:true});await assert.rejects(s.appPreview(f.tx,{...actor,role:'FINANCE'},'goods'),code('FORBIDDEN'));
 f.setStaff({...actor,active:true});f.vehicle.holdId='hold';await assert.rejects(s.updatePresentation(f.tx,actor,'goods',{revision:3,vehicleRevision:4,idempotencyKey:'held-materials',title:'标题',description:'',conditionDisclosure:''}),code('VEHICLE_RESERVED'));
});
test('presentation title rejects NUL before any write or receipt persistence',async()=>{
 const f=fixture(),s:any=new GoodsService();await assert.rejects(s.updatePresentation(f.tx,actor,'goods',{revision:3,vehicleRevision:4,idempotencyKey:'invalid-title-nul',title:'bad\0title',description:'',conditionDisclosure:''}));assert.equal(f.audits.length,0);assert.equal(f.commands.length,0);assert.equal(f.vehicle.revision,4);
});
