import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductService} from '../src/products/service';
import {snapshotProduct} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';
import {addPublicationFacts} from './publish-readiness-fixture';

const actor={id:'operator',role:'OPERATIONS',authVersion:1};
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
const input=()=>({vehicleId:'vehicle',productVersionId:'version',visible:true,recommended:false,sortOrder:10,revision:0,idempotencyKey:'create-goods-1'});
async function service(){const m:any=await import('../src/goods/service').catch(()=>({}));assert.equal(typeof m.GoodsService,'function','explicit goods service is available');return new m.GoodsService();}
function fixture(){
 const vehicle:any={id:'vehicle',title:'合成车辆',vin:'LSVNV2182E2182777',plateNumber:'沪合成',brand:'合成',model:'测试',year:2026,modelDefinitionId:'model',status:'PUBLISHED',catalogPublished:true,purchaseCostAmount:987654,customer:{name:'不得显示'}};
 const version:any={id:'version',productId:'product',version:1,revision:0,status:'PUBLISHED',name:'合成12个月',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电自付',conditions:'合成约定',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const listings:any[]=[],plans:any[]=[],commands:any[]=[],audits:any[]=[];let current:any={...actor,active:true};
 const match=(row:any,where:any)=>Object.entries(where||{}).every(([key,value]:any)=>key==='OR'?value.some((part:any)=>match(row,part)):key==='vehicleId_productVersionId'?match(row,value):value&&typeof value==='object'&&'contains'in value?String(row[key]||'').includes(value.contains):row[key]===value);
 const apply=(row:any,data:any)=>{for(const[key,value]of Object.entries(data))row[key]=value&&typeof value==='object'&&'increment'in value?row[key]+(value as any).increment:value;};
 const joined=(row:any)=>row?{...row,vehicle,productVersion:version,subscriptionPlan:plans.find(p=>p.id===row.subscriptionPlanId)}:null;
 const tx:any={adminUser:{findUnique:async()=>current},$queryRaw:async()=>[],
  productCommand:{findUnique:async({where}:any)=>commands.find(c=>match(c,where.actorId_resourceId_action_key)),create:async({data}:any)=>{commands.push(structuredClone(data));return data;}},
  auditLog:{create:async({data}:any)=>{audits.push(structuredClone(data));return data;}},
  vehicle:{findUnique:async({where}:any)=>where.id===vehicle.id?vehicle:null,findMany:async()=>[vehicle],count:async()=>1},modelDefinition:{count:async()=>0},
  productVersion:{findUnique:async({where}:any)=>where.id===version.id?version:null,findFirst:async()=>version,findMany:async()=>[version],updateMany:async({where,data}:any)=>{if(!match(version,where))return{count:0};apply(version,data);return{count:1};}},
  subscriptionPlan:{create:async({data}:any)=>{const p={id:'plan-'+(plans.length+1),...structuredClone(data)};plans.push(p);return p;},createMany:async({data}:any)=>{plans.push(...data);return{count:data.length};},findMany:async()=>plans,findUnique:async({where}:any)=>{const p=plans.find(p=>p.id===where.id);return p?{...p,vehicle,productVersion:version,listing:listings.find(l=>l.subscriptionPlanId===p.id)||null}:null;},updateMany:async({where,data}:any)=>{const found=plans.filter(p=>match(p,where));found.forEach(p=>apply(p,data));return{count:found.length};}},
  vehicleListing:{findUnique:async({where}:any)=>joined(listings.find(l=>match(l,where))),findFirst:async({where}:any)=>joined(listings.find(l=>match(l,where))),findMany:async({where,skip=0,take=100}:any)=>listings.filter(l=>match(l,where)).slice(skip,skip+take).map(joined),count:async({where}:any)=>listings.filter(l=>match(l,where)).length,create:async({data}:any)=>{const l={id:'goods-'+(listings.length+1),createdAt:new Date('2026-10-31T00:00:00Z'),updatedAt:new Date('2026-10-31T00:00:00Z'),...structuredClone(data)};listings.push(l);return joined(l);},updateMany:async({where,data}:any)=>{const found=listings.filter(l=>match(l,where));found.forEach(l=>apply(l,data));return{count:found.length};}}
 };
 addPublicationFacts(tx,vehicle);return{tx,vehicle,version,listings,plans,commands,audits,setStaff:(v:any)=>current=v};
}
async function draft(){const f=fixture(),s=await service();const value=await s.create(f.tx,actor,input());return{...f,s,value};}

test('goods selection freezes only explicit same-vehicle inspection revisions and clearing revokes public images',async()=>{
 const f=await draft();assert.deepEqual(f.value.inspectionSelections,[]);
 const source={id:'inspection',vehicleId:'vehicle',revision:2,title:'第三方检测',provider:null,inspectedAt:null,description:'选择时结论',imageFileIds:[]};f.tx.vehicleInspection={findUnique:async()=>source};
 const updated=await f.s.update(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'select-inspection',inspectionSelections:[{id:'inspection',revision:2}]});assert.deepEqual(updated.inspectionSelections,[{id:'inspection',revision:2}]);assert.equal(updated.inspectionSnapshots[0].description,'选择时结论');
 source.description='尚未选择的新内容';source.revision=3;
 const display=await f.s.update(f.tx,actor,f.value.id,{revision:1,idempotencyKey:'only-sort-inspection',sortOrder:99});assert.equal(display.inspectionSnapshots[0].description,'选择时结论');
 await assert.rejects(f.s.update(f.tx,actor,f.value.id,{revision:2,idempotencyKey:'stale-inspection',inspectionSelections:[{id:'inspection',revision:2}]}),code('REVISION_CONFLICT'));
 const cleared=await f.s.update(f.tx,actor,f.value.id,{revision:2,idempotencyKey:'clear-inspection',inspectionSelections:[]});assert.deepEqual(cleared.inspectionSnapshots,[]);
});

test('publishing a product never makes every matching vehicle a sellable plan',async()=>{
 const f=fixture();f.version.status='DRAFT';await new ProductService().publish(f.tx,actor,'product',{versionId:'version',revision:0,idempotencyKey:'publish-product'});
 assert.equal(f.version.status,'PUBLISHED');assert.equal(f.plans.length,0);assert.equal(f.listings.length,0);
});
test('goods draft freezes product facts but keeps its stable compatibility plan inactive and omits private vehicle facts',async()=>{
 const f=await draft();assert.equal(f.value.status,'DRAFT');assert.equal(f.value.subscriptionPlanId,'plan-1');assert.equal(f.plans[0].active,false);assert.equal(f.plans[0].monthlyFeeAmount,198000);
 assert.equal(f.value.appDisplay.state,'NOT_VISIBLE');assert.equal(f.value.appDisplay.visible,false);assert(f.value.appDisplay.reasons.some((r:any)=>r.code==='GOODS_NOT_PUBLISHED'));
 assert.equal(f.listings[0].source,'EXPLICIT');assert.match(f.listings[0].productSourceHash,/^[a-f0-9]{64}$/);assert.equal(f.listings[0].snapshot.monthlyFeeAmount,198000);
 assert.equal(f.value.vehicle.vin,'LSVNV2182E2182777');assert.equal(f.value.productVersion.version,1);assert.equal(f.value.plan.months,12);assert.equal(JSON.stringify(f.value).includes('987654'),false);assert.equal(JSON.stringify(f.value).includes('不得显示'),false);
 assert.equal(f.audits.length,1);
});
test('explicit publish, withdraw and republish only toggle the original plan with revision and audit protection',async()=>{
 const f=await draft(),id=f.value.id;let result=await f.s.publish(f.tx,actor,id,{revision:0,idempotencyKey:'publish-goods'});
 assert.equal(result.status,'PUBLISHED');assert.equal(result.revision,1);assert.equal(f.plans[0].active,true);
 assert.equal(result.appDisplay.state,'VISIBLE_UNAVAILABLE');assert.equal(result.appDisplay.visible,true);assert.equal(result.appDisplay.available,false);
 result=await f.s.withdraw(f.tx,actor,id,{revision:1,idempotencyKey:'withdraw-goods',reason:'暂停展示'});assert.equal(result.status,'WITHDRAWN');assert.equal(f.plans[0].active,false);
 assert.equal(result.appDisplay.state,'NOT_VISIBLE');
 result=await f.s.publish(f.tx,actor,id,{revision:2,idempotencyKey:'republish-goods'});assert.equal(result.status,'PUBLISHED');assert.equal(result.subscriptionPlanId,'plan-1');assert.equal(f.plans.length,1);assert.equal(f.audits.length,4);
});
test('duplicate goods and idempotency conflicts cannot create a second plan or replay after staff revocation',async()=>{
 const f=await draft();assert.deepEqual(await f.s.create(f.tx,actor,input()),f.value);assert.equal(f.plans.length,1);assert.equal(f.audits.length,1);
 await assert.rejects(f.s.create(f.tx,actor,{...input(),idempotencyKey:'duplicate-pair'}),code('GOODS_ALREADY_EXISTS'));
 await assert.rejects(f.s.create(f.tx,actor,{...input(),visible:false}),code('IDEMPOTENCY_CONFLICT'));
 f.setStaff({...actor,active:false});await assert.rejects(f.s.create(f.tx,actor,input()),code('STAFF_SESSION_CHANGED'));assert.equal(f.plans.length,1);
});
test('display-only edits cannot replace the vehicle, product or source, and stale writes are rejected',async()=>{
 const f=await draft(),id=f.value.id;
 const value=await f.s.update(f.tx,actor,id,{revision:0,idempotencyKey:'edit-display',visible:false,recommended:true,sortOrder:7});assert.equal(value.revision,1);assert.equal(value.visible,false);assert.equal(value.recommended,true);assert.equal(f.plans[0].active,false);
 await assert.rejects(f.s.update(f.tx,actor,id,{revision:0,idempotencyKey:'stale-display',visible:true}),code('REVISION_CONFLICT'));
 for(const extra of [{vehicleId:'other'},{productVersionId:'other'},{source:'LEGACY_MIGRATED'}])await assert.rejects(f.s.update(f.tx,actor,id,{revision:1,idempotencyKey:'replace-binding',...extra}));
 assert.equal(f.listings[0].vehicleId,'vehicle');assert.equal(f.listings[0].productVersionId,'version');
});
test('publishing rejects retired products, changed scope, incomplete or changed terms, and mismatched compatibility plans',async()=>{
 const changes:Record<string,(f:any)=>void>={retired:f=>f.version.status='RETIRED',scope:f=>f.version.vehicleIds=['other'],invalid:f=>f.version.monthlyFeeAmount=0,hash:f=>f.listings[0].productSourceHash='0'.repeat(64),snapshot:f=>f.listings[0].snapshot.monthlyFeeAmount=1,plan:f=>f.plans[0].vehicleId='other'};
 for(const[name,mutate]of Object.entries(changes)){const f=await draft();mutate(f);await assert.rejects(f.s.publish(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'publish-'+name}));assert.equal(f.plans[0].active,false,name);assert.equal(f.listings[0].status,'DRAFT',name);}
});
test('listing snapshots require a published visible correctly bound product and cannot fall back to all applicable plans',async()=>{
 const f=await draft();await assert.rejects(snapshotProduct(f.tx,'plan-1'));await f.s.publish(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'publish-listed'});
 const snapshot=await snapshotProduct(f.tx,'plan-1');assert.equal(snapshot.listingId,f.value.id);assert.equal(snapshot.listingRevision,1);assert.equal(snapshot.monthlyFeeAmount,198000);assert.match(snapshot.sourceHash!,/^[a-f0-9]{64}$/);
 f.listings[0].visible=false;await assert.rejects(snapshotProduct(f.tx,'plan-1'));f.listings[0].visible=true;f.listings[0].subscriptionPlanId='another-plan';await assert.rejects(snapshotProduct(f.tx,'plan-1'));
});
test('migrated listings allow absent stored hashes but still bind the real published product and physical vehicle',async()=>{
 const f=await draft();await f.s.publish(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'publish-migrated'});
 Object.assign(f.listings[0],{source:'LEGACY_MIGRATED',productSourceHash:null,snapshot:null});const snapshot=await snapshotProduct(f.tx,'plan-1');assert.equal(snapshot.monthlyFeeAmount,198000);assert.equal(snapshot.listingId,'goods-1');
 f.listings[0].vehicleId='other';await assert.rejects(snapshotProduct(f.tx,'plan-1'));f.listings[0].vehicleId='vehicle';f.version.status='RETIRED';await assert.rejects(snapshotProduct(f.tx,'plan-1'));
});
test('only migrated double-null evidence can be reconstructed and unknown or partially populated sources fail closed',async()=>{
 for(const patch of [{source:'EXPLICIT',productSourceHash:null,snapshot:null},{source:'UNKNOWN',productSourceHash:null,snapshot:null},{source:'LEGACY_MIGRATED',productSourceHash:null},{source:'LEGACY_MIGRATED',snapshot:null}]){
  const f=await draft();await f.s.publish(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'publish-source'});Object.assign(f.listings[0],patch);
  await assert.rejects(snapshotProduct(f.tx,'plan-1'),code(patch.source==='UNKNOWN'?'GOODS_SOURCE_MISMATCH':'GOODS_SOURCE_CHANGED'));
 }
});
test('withdrawn goods and retired product details remain readable without making the old plan sellable',async()=>{
 const f=await draft();await f.s.publish(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'publish-history'});
 await f.s.withdraw(f.tx,actor,f.value.id,{revision:1,idempotencyKey:'withdraw-history'});f.version.status='RETIRED';
 const detail=await f.s.detail(f.tx,actor,f.value.id);assert.equal(detail.status,'WITHDRAWN');assert.equal(detail.productVersion.status,'RETIRED');assert.equal(detail.plan.monthlyFeeAmount,198000);
 await f.s.update(f.tx,actor,f.value.id,{revision:2,idempotencyKey:'history-sort',sortOrder:2});assert.equal(f.plans[0].active,false);
 await assert.rejects(f.s.publish(f.tx,actor,f.value.id,{revision:3,idempotencyKey:'republish-retired'}),code('PRODUCT_UNAVAILABLE'));await assert.rejects(snapshotProduct(f.tx,'plan-1'));
});
test('snapshot integrity survives database JSON key order and the new listing revision invalidates its source hash',async()=>{
 const f=await draft();await f.s.publish(f.tx,actor,f.value.id,{revision:0,idempotencyKey:'publish-hash'});const before=await snapshotProduct(f.tx,'plan-1');
 f.listings[0].snapshot=Object.fromEntries(Object.entries(f.listings[0].snapshot).reverse());assert.equal(canonicalHash(f.listings[0].snapshot),f.listings[0].productSourceHash);assert.equal((await snapshotProduct(f.tx,'plan-1')).sourceHash,before.sourceHash);
 await f.s.update(f.tx,actor,f.value.id,{revision:1,idempotencyKey:'update-sort',sortOrder:1});assert.notEqual((await snapshotProduct(f.tx,'plan-1')).sourceHash,before.sourceHash);
});
test('goods reads and mutations recheck current permissions and never expose full vehicle or product rows',async()=>{
 const f=await draft();const page=await f.s.list(f.tx,actor,{status:'DRAFT',page:1,pageSize:20});assert.equal(page.total,1);assert.equal(page.items[0].id,f.value.id);assert.equal(JSON.stringify(page).includes('purchaseCostAmount'),false);
 f.setStaff({id:actor.id,role:'FINANCE',authVersion:1,active:true});const finance={...actor,role:'FINANCE'};await assert.rejects(f.s.list(f.tx,finance,{}),code('FORBIDDEN'));await assert.rejects(f.s.detail(f.tx,finance,f.value.id),code('FORBIDDEN'));
});
