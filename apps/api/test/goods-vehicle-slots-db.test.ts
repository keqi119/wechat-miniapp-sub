import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {snapshotProduct} from '../src/products/snapshot';

test('one real vehicle retains two independent goods slots, exact pagination and immutable selected product sources',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();
  const model=await h.db.modelDefinition.create({data:{brand:'合成卡槽',name:'卡槽-'+h.prefix}});
  async function vehicle(label:string){return h.post('/admin/vehicles',{modelDefinitionId:model.id,brand:'合成卡槽',model:'本地测试',title:label+'-'+h.prefix,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,description:'仅本地合成',conditionDisclosure:'仅本地合成',mediaFileIds:[],...command()});}
  const car=await vehicle('本车'),other=await vehicle('另一车'),slots:any[]=[];
  for(const [months,monthlyFeeAmount] of [[12,198000],[24,168000]]){
   const version=await h.post('/admin/products',{...command(),name:`${months}个月-${h.prefix}`,months,monthlyFeeAmount,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电自付',conditions:'仅本地合成',vehicleIds:[car.id,other.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]});
   await h.post(`/admin/products/${version.productId}/publish`,{...command(version.revision),versionId:version.id});
   const draft=await h.post('/admin/goods',{vehicleId:car.id,productVersionId:version.id,visible:true,recommended:false,sortOrder:months,...command()});
   assert.equal(draft.status,'DRAFT');assert.equal((await h.db.subscriptionPlan.findUniqueOrThrow({where:{id:draft.subscriptionPlanId}})).active,false);
   slots.push(await h.post(`/admin/goods/${draft.id}/publish`,command(draft.revision)));
  }
  const foreign=await h.post('/admin/goods',{vehicleId:other.id,productVersionId:slots[0].productVersionId,visible:true,recommended:false,sortOrder:0,...command()});
  const first=await h.get(`/admin/goods?vehicleId=${car.id}&page=1&pageSize=1`),second=await h.get(`/admin/goods?vehicleId=${car.id}&page=2&pageSize=1`);
  assert.equal(first.total,2);assert.equal(second.total,2);assert.deepEqual([first.items[0].id,second.items[0].id],slots.map(s=>s.id));assert.ok(first.items.concat(second.items).every((s:any)=>s.vehicleId===car.id&&s.id!==foreign.id));
  const prior=await h.db.serial(tx=>snapshotProduct(tx,slots[1].subscriptionPlanId));assert.equal(prior.monthlyFeeAmount,168000);assert.equal(prior.months,24);assert.equal(prior.listingId,slots[1].id);
  const removed=await h.post(`/admin/goods/${slots[0].id}/withdraw`,command(slots[0].revision));
  await assert.rejects(h.db.serial(tx=>snapshotProduct(tx,slots[0].subscriptionPlanId)));
  assert.deepEqual(await h.db.serial(tx=>snapshotProduct(tx,slots[1].subscriptionPlanId)),prior);
  const restored=await h.post(`/admin/goods/${removed.id}/publish`,command(removed.revision));assert.equal(restored.subscriptionPlanId,slots[0].subscriptionPlanId);
  assert.equal(await h.db.subscriptionPlan.count({where:{vehicleId:car.id}}),2);assert.equal(await h.db.vehicleListing.count({where:{vehicleId:car.id}}),2);
  // Historical PUBLISHED physical vehicle seed only; no owner/cooperation evidence
  // is fabricated. Public catalog must list both products but permit no application.
  await h.db.vehicle.update({where:{id:car.id},data:{status:'PUBLISHED'}});
  const catalog=await h.get(`/public/vehicles/${car.id}`);assert.equal(catalog.plans.length,2);assert.deepEqual(catalog.plans.map((p:any)=>p.id),slots.map(s=>s.subscriptionPlanId));assert.equal(catalog.vehicle.available,false);assert.ok(catalog.plans.every((p:any)=>p.available===false));
  assert.deepEqual(catalog.plans.map((p:any)=>p.monthlyFeeAmount),[198000,168000]);
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});
