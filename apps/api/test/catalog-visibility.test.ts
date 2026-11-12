import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogController,catalogVehicleViews,vehicleView} from '../src/catalog/catalog';
import {catalogAppDisplay} from '../src/catalog/app-display';
import {CustomerController} from '../src/orders/customer';
import {versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';

function car(id:string,extra:any={}){
 const v:any={id,status:'PUBLISHED',catalogPublished:true,title:'车型 '+id,brand:'有效品牌',model:'ES6',year:2024,city:'上海',mileageKm:100,coverFileId:null,mediaFileIds:[],createdAt:new Date('2026-01-01'),...extra};
 const version:any={id:'version-'+id,productId:'product-'+id,version:1,status:'PUBLISHED',name:'合成套餐',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'客户自付',conditions:'合成约定',vehicleIds:[id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const snapshot=versionSnapshot(version),listing:any={id:'listing-'+id,revision:1,vehicleId:id,subscriptionPlanId:'plan-'+id,productVersionId:version.id,status:'PUBLISHED',visible:true,source:'EXPLICIT',snapshot,productSourceHash:canonicalHash(snapshot),inspectionSnapshots:[]};
 v.plans=[{id:'plan-'+id,vehicleId:id,productVersionId:version.id,active:true,listing,productVersion:version}];return v;
}
function fixture(rows:any[]){
 const eligibility:string[]=[],queries:any[]=[];
 function selected(where:any={}){return rows.filter(v=>(!where.status||v.status===where.status)&&(!where.id||v.id===where.id)&&(!where.brand||v.brand===where.brand)&&(!where.OR||where.OR.some((q:any)=>Object.entries(q).some(([k,rule]:any)=>String(v[k]||'').toLowerCase().includes(String(rule.contains).toLowerCase())))));}
 function included(v:any){return{...v,plans:(v.plans||[]).filter((p:any)=>p.active)};}
 const tx:any={vehicle:{findMany:async(q:any)=>{queries.push(q);let values=selected(q.where);if(q.distinct)return[...new Set(values.map(v=>v.brand))].map(brand=>({brand}));values=[...values].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||a.id.localeCompare(b.id));return values.slice(q.skip||0,q.take?((q.skip||0)+q.take):undefined).map(included);},count:async(q:any)=>selected(q.where).length,findFirst:async(q:any)=>{const v=selected(q.where)[0];return v?included(v):null;}},
 vehicleOperationalRestriction:{count:async({where}:any)=>{eligibility.push(where.vehicleId);return 1;}},application:{findFirst:async()=>null},order:{findFirst:async()=>null}};
 return{tx,eligibility,queries};
}
const unavailable=(e:any)=>e.getStatus?.()===404&&e.getResponse?.().error?.code==='NOT_FOUND';

test('public list admits one source-valid published good instead of four published inventory shells',async()=>{
 const live=car('live'),withdrawn=car('withdrawn',{brand:'下架品牌'}),hidden=car('hidden',{brand:'隐藏品牌'}),legacy=car('legacy',{brand:'孤儿品牌'});
 withdrawn.plans[0].listing.status='WITHDRAWN';withdrawn.plans[0].active=false;hidden.plans[0].listing.visible=false;legacy.plans[0].listing=null;
 const f=fixture([withdrawn,hidden,legacy,live]),result=await new CatalogController(f.tx).vehicles({});assert.equal(result.total,1);assert.deepEqual(result.items.map((v:any)=>v.id),['live']);assert.deepEqual(result.brands,['有效品牌']);assert.deepEqual(f.eligibility,['live']);
});
test('visibility precedes pagination, keyword, count and global brand choices, including invalid published sources',async()=>{
 const rows=[car('a-orphan',{brand:'不公开'}),car('b-corrupt',{brand:'不公开'}),car('c-live',{brand:'蔚来',title:'查找Alpha'}),car('d-live',{brand:'极氪',title:'查找Beta'})];rows[0].plans=[];rows[1].plans[0].listing.productSourceHash='corrupt';const f=fixture(rows),controller=new CatalogController(f.tx);
 const first=await controller.vehicles({page:1,pageSize:1}),second=await controller.vehicles({page:2,pageSize:1});assert.equal(first.total,2);assert.equal(second.total,2);assert.deepEqual(first.items.map((v:any)=>v.id),['c-live']);assert.deepEqual(second.items.map((v:any)=>v.id),['d-live']);assert.deepEqual(new Set(first.brands),new Set(['蔚来','极氪']));
 const keyword=await controller.vehicles({keyword:'alpha'});assert.equal(keyword.total,1);assert.equal(keyword.items[0].id,'c-live');assert.deepEqual(new Set(keyword.brands),new Set(['蔚来','极氪']));assert.equal((await controller.vehicles({brand:'不公开'})).total,0);assert.equal((await controller.vehicles({keyword:'corrupt'})).total,0);
});
test('authenticated home takes two recommendations after the same public visibility gate',async()=>{
 const orphan=car('a-orphan'),withdrawn=car('b-withdrawn'),live=car('c-live');orphan.plans=[];withdrawn.plans[0].listing.status='WITHDRAWN';const f=fixture([orphan,withdrawn,live]),controller=new CustomerController(f.tx);controller.context=async()=>({customer:{id:'synthetic'}}) as any;
 const result=await controller.home({customer:{id:'synthetic'}});assert.deepEqual(result.vehicles.map((v:any)=>v.id),['c-live']);assert.equal(result.nextAction,null);assert.deepEqual(f.eligibility,['c-live']);
});
test('an inventory detail without any current public plan is no longer a new-catalog entry',async()=>{
 for(const kind of ['withdrawn','hidden','orphan','retired','corrupt']){const v=car(kind);if(kind==='withdrawn')v.plans[0].listing.status='WITHDRAWN';if(kind==='hidden')v.plans[0].listing.visible=false;if(kind==='orphan')v.plans=[];if(kind==='retired')v.plans[0].productVersion.status='RETIRED';if(kind==='corrupt')v.plans[0].listing.productSourceHash='wrong';const f=fixture([v]);await assert.rejects(new CatalogController(f.tx).vehicle(v.id),unavailable);assert.equal(f.eligibility.length,0);}
});
test('a valid visible but unavailable good stays readable and matches the admin app-display predicate',async()=>{
 for(const patch of [{holdId:'synthetic-hold'},{reservedOrderId:'synthetic-order'},{}]){const v=car('live',patch),f=fixture([v]),list=await new CatalogController(f.tx).vehicles({}),detail=await new CatalogController(f.tx).vehicle(v.id),appDisplay=await catalogAppDisplay(f.tx,v.plans[0],v);
  assert.equal(list.total,1);assert.equal(list.items[0].available,false);assert.equal(detail.plans.length,1);assert.equal(detail.plans[0].available,false);assert.equal(appDisplay.visible,true);assert.equal(appDisplay.available,false);assert.equal(appDisplay.state,'VISIBLE_UNAVAILABLE');
 }
});
test('multiple goods deduplicate by vehicle and genuine published migrated sources remain supported',async()=>{
 const v=car('live'),extra=car('live').plans[0];extra.id='second-plan';extra.listing={...extra.listing,id:'second-listing',subscriptionPlanId:'second-plan',status:'WITHDRAWN'};v.plans.push(extra);Object.assign(v.plans[0].listing,{source:'LEGACY_MIGRATED',snapshot:null,productSourceHash:null});const f=fixture([v]),list=await new CatalogController(f.tx).vehicles({}),detail=await new CatalogController(f.tx).vehicle(v.id);
 assert.equal(list.total,1);assert.equal(detail.plans.length,1);assert.equal(detail.plans[0].id,'plan-live');assert.equal(detail.plans[0].monthlyFeeAmount,198000);
 // Historical/current-order vehicle projection is not subject to a new catalog gate.
 assert.equal(vehicleView({...v,plans:[],status:'IN_USE'}).id,'live');assert.equal((await catalogVehicleViews(f.tx,v)).plans.length,1);
});
test('only the requested visible page performs DB-backed application eligibility checks',async()=>{
 const f=fixture(Array.from({length:8},(_,i)=>car('live-'+i)));const result=await new CatalogController(f.tx).vehicles({page:2,pageSize:2});assert.equal(result.total,8);assert.deepEqual(result.items.map((v:any)=>v.id),['live-2','live-3']);assert.deepEqual(f.eligibility,['live-2','live-3']);
});
test('draft, pending confirmation, unknown states and unverified sources never enter any public catalog path',async()=>{
 for(const kind of ['DRAFT','PENDING_CONFIRMATION','UNKNOWN','UNVERIFIED_SOURCE','DRAFT_VERSION','INACTIVE_PLAN']){const v=car('not-confirmed');if(kind==='UNVERIFIED_SOURCE')v.plans[0].listing.source='UNVERIFIED';else if(kind==='DRAFT_VERSION')v.plans[0].productVersion.status='DRAFT';else if(kind==='INACTIVE_PLAN')v.plans[0].active=false;else v.plans[0].listing.status=kind;
  const f=fixture([v]),catalog=new CatalogController(f.tx),customer=new CustomerController(f.tx);customer.context=async()=>({}) as any;
  assert.equal((await catalog.vehicles({})).total,0,kind);assert.deepEqual((await customer.home({customer:{id:'synthetic'}})).vehicles,[],kind);await assert.rejects(catalog.vehicle(v.id),unavailable);assert.equal((await catalogAppDisplay(f.tx,v.plans[0],v)).visible,false,kind);assert.equal(f.eligibility.length,0,kind);
 }
});
test('activation and a published plan cannot replace the explicit parent catalog switch',async()=>{
 for(const flag of [false,undefined]){const v=car('not-catalogued',{catalogPublished:flag}),f=fixture([v]),catalog=new CatalogController(f.tx),customer=new CustomerController(f.tx);customer.context=async()=>({}) as any;
  assert.equal((await catalog.vehicles({})).total,0);assert.deepEqual((await customer.home({customer:{id:'synthetic'}})).vehicles,[]);await assert.rejects(catalog.vehicle(v.id),unavailable);const display=await catalogAppDisplay(f.tx,v.plans[0],v);assert.equal(display.visible,false);assert(display.reasons.some(r=>r.code==='CATALOG_NOT_PUBLISHED'));assert.equal(f.eligibility.length,0);
 }
});
