import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {snapshotProduct,versionSnapshot} from '../src/products/snapshot';
import {canonicalHash} from '../src/customers/types';

test('modular product HTTP/database stores authoritative prices and resumes only published goods',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const model=await h.db.modelDefinition.create({data:{brand:'本地模块',name:'模块车型-'+h.prefix}});
  const cars:any[]=[];for(let index=0;index<3;index++)cars.push(await h.post('/admin/vehicles',{modelDefinitionId:model.id,brand:'本地模块',model:'测试',title:'模块车-'+h.prefix+'-'+index,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,description:'仅本地合成',conditionDisclosure:'仅本地合成',mediaFileIds:[],...command()}));
  const input={configurationVersion:2,name:'模块产品-'+h.prefix,months:24,minimumTermMonths:3,baseFeeAmount:185000,mileageMonthlyFeeAmount:25000,mileagePerMonthKm:2300,excessMileagePriceAmount:87,swapPolicy:{version:2,period:'TERM',includedCount:2,extraFeeAmount:65000},conditions:'仅本地合成',vehicleIds:cars.map(car=>car.id),modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]};
  await h.reject('/admin/products',{...input,monthlyFeeAmount:1,...command()},h.maker,'VALIDATION');
  const draft=await h.post('/admin/products',{...input,...command()});assert.equal(draft.monthlyFeeAmount,210000);assert.equal(draft.energyDescription,'充换电费用由客户自付');assert.deepEqual(draft.swapPolicy,input.swapPolicy);
  const product=await h.post(`/admin/products/${draft.productId}/publish`,{...command(draft.revision),versionId:draft.id});assert.equal(await h.db.subscriptionPlan.count({where:{productVersionId:product.id}}),0);
  const goods:any[]=[];for(const car of cars)goods.push(await h.post('/admin/goods',{vehicleId:car.id,productVersionId:product.id,visible:true,recommended:false,sortOrder:0,...command()}));
  goods[0]=await h.post(`/admin/goods/${goods[0].id}/publish`,command(goods[0].revision));goods[1]=await h.post(`/admin/goods/${goods[1].id}/publish`,command(goods[1].revision));goods[1]=await h.post(`/admin/goods/${goods[1].id}/withdraw`,command(goods[1].revision));
  const frozen:any=await h.db.serial(tx=>snapshotProduct(tx,goods[0].subscriptionPlanId));assert.equal(frozen.configurationVersion,2);assert.equal(frozen.mileagePerMonthKm,2300);assert.equal(frozen.excessMileagePriceAmount,87);assert.equal(frozen.swapPolicy.includedCount,2);
  const path=`/admin/products/${product.productId}/versions/${product.id}`;await h.reject(`/admin/products/wrong-product/versions/${product.id}/suspend`,{...command(product.revision),reason:'错误父关联'},h.maker,'NOT_FOUND');
  const suspended=await h.post(path+'/suspend',{...command(product.revision),reason:'暂停本地测试销售'});assert.equal(suspended.status,'SUSPENDED');assert.equal(await h.db.subscriptionPlan.count({where:{productVersionId:product.id,active:true}}),0);assert.equal(canonicalHash(versionSnapshot(suspended)),canonicalHash(versionSnapshot(product)));
  await h.reject(path,{...input,...command(suspended.revision)},h.maker,'IMMUTABLE_PRODUCT_VERSION','PATCH');await assert.rejects(h.db.serial(tx=>snapshotProduct(tx,goods[0].subscriptionPlanId)));
  const resume={...command(suspended.revision),reason:'明确重新启用'},resumed=await h.post(path+'/resume',resume);assert.equal(resumed.status,'PUBLISHED');assert.deepEqual(await h.post(path+'/resume',resume),resumed);assert.equal(await h.db.auditLog.count({where:{resourceType:'products',resourceId:product.id,action:'RESUME'}}),1);
  for(let index=0;index<goods.length;index++){const plan=await h.db.subscriptionPlan.findUniqueOrThrow({where:{id:goods[index].subscriptionPlanId}});assert.equal(plan.active,index===0);assert.equal(plan.monthlyFeeAmount,210000);}
  assert.equal((await h.db.serial(tx=>snapshotProduct(tx,goods[0].subscriptionPlanId))).sourceHash,frozen.sourceHash);await h.reject(path+'/suspend',{...command(product.revision),reason:'过期版本'},h.maker,'REVISION_CONFLICT');await h.reject(path+'/suspend',{...command(resumed.revision),reason:'无权限'},h.support,'FORBIDDEN');
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});
