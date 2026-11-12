import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {snapshotProduct} from '../src/products/snapshot';

test('isolated goods HTTP/database lifecycle preserves one plan, rejects concurrent duplicate combinations and protects role boundaries',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();
  const model=await h.db.modelDefinition.create({data:{brand:'合成商品',name:'商品-'+h.prefix}});
  const vehicle=await h.post('/admin/vehicles',{modelDefinitionId:model.id,brand:'合成商品',model:'测试',title:'显式商品-'+h.prefix,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,description:'仅本地合成',conditionDisclosure:'仅本地合成',mediaFileIds:[],...command()});
  const product=await h.post('/admin/products',{...command(),name:'商品产品-'+h.prefix,months:12,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电自付',conditions:'仅本地合成',vehicleIds:[vehicle.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]});
  await h.post(`/admin/products/${product.productId}/publish`,{...command(product.revision),versionId:product.id});
  assert.equal(await h.db.subscriptionPlan.count({where:{productVersionId:product.id}}),0);
  const draft={vehicleId:vehicle.id,productVersionId:product.id,visible:true,recommended:false,sortOrder:5,...command()};
  const attempts=await Promise.all([h.raw('/admin/goods',draft,h.maker,'POST'),h.raw('/admin/goods',{...draft,idempotencyKey:randomUUID()},h.maker,'POST')]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);
  const created=attempts.find(r=>r.status===201)!.data;
  assert.equal(created.status,'DRAFT');assert.equal(await h.db.subscriptionPlan.count({where:{productVersionId:product.id}}),1);assert.equal(await h.db.vehicleListing.count({where:{vehicleId:vehicle.id,productVersionId:product.id}}),1);
  assert.equal((await h.db.subscriptionPlan.findUniqueOrThrow({where:{id:created.subscriptionPlanId}})).active,false);
  await assert.rejects(h.db.serial(tx=>snapshotProduct(tx,created.subscriptionPlanId)));
  const published=await h.post(`/admin/goods/${created.id}/publish`,command(created.revision));assert.equal(published.status,'PUBLISHED');
  const frozen=await h.db.serial(tx=>snapshotProduct(tx,created.subscriptionPlanId));assert.equal(frozen.listingId,created.id);assert.equal(frozen.monthlyFeeAmount,198000);
  const filtered=await h.get(`/admin/goods?keyword=${encodeURIComponent(vehicle.vin)}&status=PUBLISHED&page=1&pageSize=1`);assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,created.id);assert.equal('purchaseCostAmount'in filtered.items[0].vehicle,false);
  for(const person of [h.finance,h.support,h.field]){await h.reject('/admin/goods',undefined,person,'FORBIDDEN');await h.reject(`/admin/goods/${created.id}/withdraw`,command(published.revision),person,'FORBIDDEN');}
  await h.reject(`/admin/goods/${created.id}`,{...command(created.revision),visible:false},h.maker,'REVISION_CONFLICT','PATCH');
  const hidden=await h.post(`/admin/goods/${created.id}`,{...command(published.revision),visible:false},h.maker,'PATCH');await assert.rejects(h.db.serial(tx=>snapshotProduct(tx,created.subscriptionPlanId)));
  const shown=await h.post(`/admin/goods/${created.id}`,{...command(hidden.revision),visible:true},h.maker,'PATCH');
  const withdraw=command(shown.revision),withdrawn=await h.post(`/admin/goods/${created.id}/withdraw`,withdraw);assert.deepEqual(await h.post(`/admin/goods/${created.id}/withdraw`,withdraw),withdrawn);assert.equal(withdrawn.status,'WITHDRAWN');
  assert.equal((await h.db.subscriptionPlan.findUniqueOrThrow({where:{id:created.subscriptionPlanId}})).active,false);
  await assert.rejects(h.db.serial(tx=>snapshotProduct(tx,created.subscriptionPlanId)));
  const again=await h.post(`/admin/goods/${created.id}/publish`,command(withdrawn.revision));assert.equal(again.subscriptionPlanId,created.subscriptionPlanId);
  assert.equal(await h.db.auditLog.count({where:{resourceType:'goods',resourceId:created.id,action:'CREATE_GOODS'}}),1);assert.equal(await h.db.auditLog.count({where:{resourceType:'goods',resourceId:created.id,action:'WITHDRAW_GOODS'}}),1);
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});
