import test from 'node:test';
import assert from 'node:assert/strict';
import {productDraftInput} from '../src/products/types';
import {ProductService} from '../src/products/service';
import {listedProductSnapshot,validatePublishedVersion,versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';

const actor={id:'staff',role:'OPERATIONS',authVersion:1};
const terms={configurationVersion:2,name:'模块产品',months:24,baseFeeAmount:180000,mileageMonthlyFeeAmount:23000,mileagePerMonthKm:2300,excessMileagePriceAmount:87,swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:65000},conditions:'仅限本人',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
const stored=()=>({...structuredClone(terms),id:'version',productId:'product',version:1,revision:0,status:'DRAFT',monthlyFeeAmount:203000,energyDescription:'充换电费用由客户自付'});
function fixture(initial:any=stored()){
 let current:any=structuredClone(initial),staff:any={...actor,active:true};const commands=new Map<string,any>(),audits:any[]=[],plans:any[]=[];let created:any;
 const tx:any={adminUser:{findUnique:async()=>staff},productCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where)),create:async({data}:any)=>commands.set(JSON.stringify({actorId_resourceId_action_key:{actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key}}),data)},auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},benefitDefinitionVersion:{count:async()=>0},product:{findUnique:async()=>({id:'product',revision:0}),create:async()=>({id:'product',revision:0}),updateMany:async()=>({count:1})},productCombinationItem:{deleteMany:async()=>({count:1}),createMany:async()=>({count:1})},productVersion:{findFirst:async({where}:any)=>where.id?current:null,findUnique:async()=>current,create:async({data}:any)=>{created=data;current={...data,id:'version',revision:0,status:'DRAFT',items:data.items.create};return current;},updateMany:async({where,data}:any)=>{if(where.id!==current.id||where.status!==current.status||where.revision!==current.revision)return{count:0};current={...current,...data,revision:current.revision+(data.revision?.increment||0)};return{count:1};}},vehicle:{findMany:async()=>[{id:'vehicle'}],count:async()=>1},modelDefinition:{count:async()=>0},subscriptionPlan:{findMany:async()=>plans,updateMany:async({where,data}:any)=>{let count=0;for(const plan of plans)if((!where.id||plan.id===where.id)&&(!where.productVersionId||plan.productVersionId===where.productVersionId)&&(!where.listing||plan.listing?.status==='PUBLISHED')){Object.assign(plan,data);count++;}return{count};}}};
 return{tx,plans,audits,get current(){return current;},get created(){return created;},revoke:()=>staff={...staff,active:false}};
}
const cmd=(revision:number,key:string)=>({revision,idempotencyKey:key,reason:'明确暂停或恢复'});
function planFor(version:any,status='PUBLISHED'){
 const snapshot=versionSnapshot(version);return{id:'plan-'+status,vehicleId:'vehicle',productVersionId:version.id,active:true,vehicle:{id:'vehicle'},productVersion:version,listing:{id:'goods-'+status,revision:1,subscriptionPlanId:'plan-'+status,vehicleId:'vehicle',productVersionId:version.id,status,visible:true,source:'EXPLICIT',snapshot,productSourceHash:canonicalHash(snapshot)}};
}

test('v2 accepts modular fees, configurable mileage and explicit TERM swap policy',()=>{
 assert.equal(productDraftInput.safeParse(terms).success,true);
 assert.equal(productDraftInput.safeParse({...terms,baseFeeAmount:0,mileageMonthlyFeeAmount:1,mileagePerMonthKm:0,excessMileagePriceAmount:0,swapPolicy:{...terms.swapPolicy,includedCount:0,extraFeeAmount:1}}).success,true);
 assert.equal(productDraftInput.safeParse({...terms,baseFeeAmount:2147483647,mileageMonthlyFeeAmount:0,mileagePerMonthKm:2147483647,excessMileagePriceAmount:2147483647}).success,true);
});
test('v2 refuses supplied totals/energy, absent policy, fractional/overflow values and unknown versions',()=>{
 for(const patch of [{monthlyFeeAmount:203000},{energyDescription:'供应商承担'},{swapPolicy:undefined},{configurationVersion:3},{baseFeeAmount:0,mileageMonthlyFeeAmount:0},{baseFeeAmount:2147483647,mileageMonthlyFeeAmount:1},{baseFeeAmount:-1},{mileagePerMonthKm:2.1},{mileagePerMonthKm:2147483648},{excessMileagePriceAmount:-1},{swapPolicy:{...terms.swapPolicy,period:'MONTH'}},{swapPolicy:{...terms.swapPolicy,includedCount:-1}},{swapPolicy:{...terms.swapPolicy,extraFeeAmount:0}},{swapPolicy:{...terms.swapPolicy,extraFeeAmount:1.5}}])assert.equal(productDraftInput.safeParse({...terms,...patch}).success,false,JSON.stringify(patch));
});
test('draft create/update derive stored monthly fees and energy and never auto create a plan',async()=>{
 const f=fixture();const service=new ProductService();const result=await service.createDraft(f.tx,actor,{...terms,revision:0,idempotencyKey:'create-modular'});
 assert.equal(result.monthlyFeeAmount,203000);assert.equal(result.energyDescription,'充换电费用由客户自付');assert.equal(result.configurationVersion,2);assert.deepEqual(result.swapPolicy,terms.swapPolicy);assert.equal(f.plans.length,0);
 const updated=await service.updateDraft(f.tx,actor,'version',{...terms,baseFeeAmount:190000,revision:0,idempotencyKey:'update-modular'});assert.equal(updated.monthlyFeeAmount,213000);assert.equal(updated.revision,1);
 await assert.rejects(()=>service.updateDraft(f.tx,actor,'version',{...terms,revision:0,idempotencyKey:'stale-modular'}),e=>(e as any).getResponse?.().error?.code==='REVISION_CONFLICT');
});
test('v1 snapshot stays exactly unchanged after nullable schema additions and receives no swap entitlement',()=>{
 const original={id:'old',productId:'product',version:1,name:'历史产品',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'能源自理',conditions:'原条件',vehicleIds:['vehicle'],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
 const expected={productId:'product',productVersionId:'old',version:1,name:'历史产品',months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'能源自理',conditions:'原条件',vehicleIds:['vehicle'],modelDefinitionIds:[],benefits:[]};
 assert.equal(JSON.stringify(versionSnapshot(original)),JSON.stringify(expected));assert.equal(JSON.stringify(versionSnapshot({...original,configurationVersion:1,baseFeeAmount:null,mileageMonthlyFeeAmount:null,swapPolicy:null})),JSON.stringify(expected));
});
test('v2 immutable snapshot includes authoritative modules and refuses corrupted totals or policies',()=>{
 const version=stored(),snapshot:any=versionSnapshot(version);assert.equal(snapshot.configurationVersion,2);assert.equal(snapshot.baseFeeAmount,180000);assert.equal(snapshot.mileageMonthlyFeeAmount,23000);assert.deepEqual(snapshot.swapPolicy,terms.swapPolicy);assert.doesNotThrow(()=>validatePublishedVersion(version));
 for(const patch of [{monthlyFeeAmount:1},{energyDescription:'含能源'},{configurationVersion:3},{swapPolicy:null},{baseFeeAmount:null}])assert.throws(()=>validatePublishedVersion({...version,...patch}));
 version.swapPolicy.includedCount=99;assert.equal(snapshot.swapPolicy.includedCount,2);
});
test('published and suspended v2 cannot be edited, while old draft input still has no inferred swap policy',async()=>{
 const service=new ProductService();for(const status of ['PUBLISHED','SUSPENDED','RETIRED']){const f=fixture({...stored(),status});await assert.rejects(()=>service.updateDraft(f.tx,actor,'version',{...terms,revision:0,idempotencyKey:'immutable-modular'}),e=>(e as any).getResponse?.().error?.code==='IMMUTABLE_PRODUCT_VERSION');assert.equal(f.audits.length,0);}
 const old:any={...terms,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'历史能源说明'};for(const key of ['configurationVersion','baseFeeAmount','mileageMonthlyFeeAmount','swapPolicy'])delete old[key];
 assert.equal(productDraftInput.safeParse(old).success,true);assert.equal(productDraftInput.safeParse({...old,configurationVersion:1}).success,true);
 const f=fixture();const saved=await service.createDraft(f.tx,actor,{...old,revision:0,idempotencyKey:'legacy-compatible'});assert.equal(saved.configurationVersion,1);assert.equal(saved.monthlyFeeAmount,198000);assert.equal(saved.energyDescription,'历史能源说明');assert.equal('swapPolicy'in versionSnapshot(saved),false);
});
test('v2 goods snapshots retain module source and fail when frozen evidence is modified',()=>{
 const version={...stored(),status:'PUBLISHED'},plan=planFor(version);const snapshot:any=listedProductSnapshot(plan);assert.equal(snapshot.configurationVersion,2);assert.equal(snapshot.mileagePerMonthKm,2300);assert.equal(snapshot.swapPolicy.extraFeeAmount,65000);
 plan.productVersion={...version,baseFeeAmount:180001,monthlyFeeAmount:203001};assert.throws(()=>listedProductSnapshot(plan),e=>(e as any).getResponse?.().error?.code==='GOODS_SOURCE_CHANGED');
});
test('suspend/resume preserve version and frozen goods while only published listings resume',async()=>{
 const f=fixture({...stored(),status:'PUBLISHED'}),service:any=new ProductService();const before=canonicalHash(versionSnapshot(f.current));f.plans.push(planFor(f.current),planFor(f.current,'WITHDRAWN'),planFor(f.current,'DRAFT'));
 const suspended=await service.suspend(f.tx,actor,'version',cmd(0,'suspend-first'));assert.equal(suspended.status,'SUSPENDED');assert.ok(f.plans.every(p=>p.active===false));assert.equal(canonicalHash(versionSnapshot(suspended)),before);
 const resumed=await service.resume(f.tx,actor,'version',cmd(1,'resume-first'));assert.equal(resumed.status,'PUBLISHED');assert.equal(resumed.revision,2);assert.deepEqual(f.plans.map(p=>p.active),[true,false,false]);assert.equal(canonicalHash(versionSnapshot(resumed)),before);assert.deepEqual(f.audits.map(a=>a.action),['SUSPEND','RESUME']);
 assert.deepEqual(await service.resume(f.tx,actor,'version',cmd(1,'resume-first')),resumed);assert.equal(f.audits.length,2);
 await assert.rejects(()=>service.resume(f.tx,actor,'version',{...cmd(1,'resume-first'),reason:'改动同键'}),e=>(e as any).getResponse?.().error?.code==='IDEMPOTENCY_CONFLICT');f.revoke();await assert.rejects(()=>service.resume(f.tx,actor,'version',cmd(1,'resume-first')));
});
test('resume rejects retired/draft versions, stale revisions and corrupted published listings',async()=>{
 const service:any=new ProductService();for(const status of ['RETIRED','DRAFT','PUBLISHED']){const f=fixture({...stored(),status});await assert.rejects(()=>service.resume(f.tx,actor,'version',cmd(0,'resume-invalid')));assert.equal(f.audits.length,0);}
 const f=fixture({...stored(),status:'SUSPENDED'});await assert.rejects(()=>service.resume(f.tx,actor,'version',cmd(9,'resume-stale')),e=>(e as any).getResponse?.().error?.code==='REVISION_CONFLICT');
 const bad=fixture({...stored(),status:'SUSPENDED'});const plan=planFor(bad.current);plan.listing.productSourceHash='corrupt';bad.plans.push(plan);await assert.rejects(()=>service.resume(bad.tx,actor,'version',cmd(0,'resume-corrupt')),e=>(e as any).getResponse?.().error?.code==='GOODS_SOURCE_CHANGED');assert.equal(bad.audits.length,0);
});
