import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {customerProfileHash} from '../src/customers/qualifications';

test('customer source HTTP serializes independent versions and never leaks source through other roles or customer profile',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const who=await h.customer('source'),other=await h.customer('other-source'),name=`来源${h.prefix}`,sourceChannel=`渠道-${h.prefix}`;
  await h.db.customer.update({where:{id:who.id},data:{name}});await h.db.customer.update({where:{id:other.id},data:{name,sourceChannel:`其他-${h.prefix}`}});
  const before=await h.db.customer.findUniqueOrThrow({where:{id:who.id}}),profileHash=customerProfileHash(before),base=`/admin/customers/${who.id}/source`;
  assert.deepEqual(await h.get(base),{customerId:who.id,sourceChannel:null,sourceRevision:0});
  const input={sourceChannel,sourceRevision:0,reason:'客户说明来源后补录',idempotencyKey:randomUUID()};
  const [first,replay]=await Promise.all([h.post(base,input,h.maker,'PATCH'),h.post(base,input,h.maker,'PATCH')]);assert.deepEqual(first,replay);assert.equal(first.sourceRevision,1);
  assert.equal(await h.db.auditLog.count({where:{resourceType:'customers',resourceId:who.id,action:'SET_CUSTOMER_SOURCE'}}),1);
  const current=await h.db.customer.findUniqueOrThrow({where:{id:who.id}});assert.equal(customerProfileHash(current),profileHash);assert.deepEqual(current.profile,before.profile);assert.equal(current.legalIdentityFileId,before.legalIdentityFileId);
  await h.reject(base,{...input,sourceChannel:'冲突'},h.maker,'IDEMPOTENCY_CONFLICT','PATCH');
  const raced=await Promise.all([h.raw(base,{...input,sourceRevision:1,idempotencyKey:randomUUID()},h.maker,'PATCH'),h.raw(base,{...input,sourceRevision:1,idempotencyKey:randomUUID()},h.reviewer,'PATCH')]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);assert.equal(raced.find(r=>r.status===409)!.data.error.code,'REVISION_CONFLICT');
  for(const staff of [h.maker,h.reviewer]){const list=await h.get(`/admin/customers?keyword=${encodeURIComponent(name)}&sourceChannel=${encodeURIComponent(sourceChannel)}`,staff);assert.equal(list.total,1);assert.deepEqual(list.items.map((item:any)=>item.id),[who.id]);assert.equal(list.items[0].sourceChannel,sourceChannel);}
  for(const staff of [h.finance,h.support,h.field]){await h.reject(base,undefined,staff,'FORBIDDEN');await h.reject(base,input,staff,'FORBIDDEN','PATCH');await h.reject(`/admin/customers?sourceChannel=${encodeURIComponent(sourceChannel)}`,undefined,staff,'FORBIDDEN');}
  for(const staff of [h.finance,h.support])for(const dto of [await h.get(`/admin/customers/${who.id}`,staff),await h.get(`/admin/customers?keyword=${encodeURIComponent(name)}`,staff)]){const text=JSON.stringify(dto);assert.equal(text.includes('sourceChannel'),false);assert.equal(text.includes('sourceRevision'),false);assert.equal(text.includes(sourceChannel),false);}
  for(const route of ['/customer/context','/customer/profile','/customer/dashboard']){const text=JSON.stringify(await h.get(route,who));assert.equal(text.includes('sourceChannel'),false);assert.equal(text.includes('sourceRevision'),false);assert.equal(text.includes(sourceChannel),false);}
  await h.reject(`/admin/customers/${who.id}`,{sourceChannel:'旁路'},h.maker,'ACTION_REQUIRED','PATCH');
  await h.reject('/customer/profile',{revision:0,idempotencyKey:randomUUID(),name:before.name,drivingYears:5,sourceChannel:'旁路'},who,undefined,'PUT');
  assert.equal((await h.db.customer.findUniqueOrThrow({where:{id:who.id}})).sourceRevision,2);
  assert.deepEqual(await h.post(base,input,h.maker,'PATCH'),first,'Successful old key returns its original version');
  const cleared=await h.post(base,{...input,sourceChannel:null,sourceRevision:2,idempotencyKey:randomUUID()},h.maker,'PATCH');assert.equal(cleared.sourceChannel,null);assert.equal(cleared.sourceRevision,3);
  await h.db.adminUser.update({where:{id:h.maker.id},data:{role:'SUPPORT'}});await h.reject(base,input,h.maker,'FORBIDDEN','PATCH');await h.reject(`/admin/customers?sourceChannel=${encodeURIComponent(sourceChannel)}`,undefined,h.maker,'FORBIDDEN');
  assert.equal(customerProfileHash(await h.db.customer.findUniqueOrThrow({where:{id:who.id}})),profileHash);assert.equal(h.externalCalls,0);assert.equal(h.payment.providerCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);
 }finally{await h.close();}
});
