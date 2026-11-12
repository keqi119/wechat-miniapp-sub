import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
test('model-year HTTP database commands protect concurrent changes, partial fields, replay and roles',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const body={brand:'合成年款',name:'不从名称2026猜年款-'+h.prefix,bodyType:'SUV',description:'保留说明',...command()};
  const concurrent=await Promise.all([h.raw('/admin/model-definitions',body),h.raw('/admin/model-definitions',body)]);assert.deepEqual(concurrent.map(result=>result.status),[201,201]);assert.equal(concurrent[0].data.id,concurrent[1].data.id);const model=concurrent[0].data;assert.equal(model.modelYear,null);assert.equal(model.revision,0);assert.equal(await h.db.modelDefinition.count({where:{name:body.name}}),1);assert.equal(await h.db.auditLog.count({where:{resourceType:'model-definitions',resourceId:model.id,action:'CREATE'}}),1);
  await h.reject('/admin/model-definitions',{...body,name:'同键修改'},h.maker,'IDEMPOTENCY_CONFLICT');await h.reject('/admin/model-definitions',{brand:'遗漏命令',name:'拒绝'},h.maker,'VALIDATION');
  const path='/admin/model-definitions/'+model.id;const vehicle=await h.db.vehicle.create({data:{brand:'合成',model:'关联',title:'车型年款独立',year:2026,city:'上海',mileageKm:0,modelDefinitionId:model.id}});
  const changes=await Promise.all([h.raw(path,{modelYear:2024,...command(0)},h.maker,'PATCH'),h.raw(path,{modelYear:2025,...command(0)},h.maker,'PATCH')]);assert.deepEqual(changes.map(result=>result.status).sort(),[200,409]);const first=changes.find(result=>result.status===200)!.data;assert.equal(first.revision,1);assert.ok([2024,2025].includes(first.modelYear));
  const renamed=await h.post(path,{name:'真实更正-'+h.prefix,...command(1)},h.maker,'PATCH');assert.equal(renamed.modelYear,first.modelYear);assert.equal(renamed.bodyType,'SUV');assert.equal(renamed.description,'保留说明');assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}})).year,2026);
  const clear={modelYear:null,...command(renamed.revision)},cleared=await h.post(path,clear,h.maker,'PATCH');assert.equal(cleared.modelYear,null);assert.deepEqual(await h.post(path,clear,h.maker,'PATCH'),cleared);const audit=await h.db.auditLog.findFirstOrThrow({where:{resourceType:'model-definitions',resourceId:model.id,action:'UPDATE'},orderBy:{createdAt:'desc'}});assert.equal((audit.data as any).modelYearBefore,first.modelYear);assert.equal((audit.data as any).modelYearAfter,null);
  const listed=await h.get('/admin/model-definitions?keyword='+encodeURIComponent('真实更正-'+h.prefix));assert.equal(listed.items[0].modelYear,null);assert.equal((await h.get(path)).revision,cleared.revision);
  for(const staff of [h.finance,h.support,h.field])await h.reject(path,{modelYear:2024,...command(cleared.revision)},staff,'FORBIDDEN','PATCH');
  await h.db.adminUser.update({where:{id:h.maker.id},data:{active:false}});await h.reject(path,clear,h.maker,undefined,'PATCH');assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});
