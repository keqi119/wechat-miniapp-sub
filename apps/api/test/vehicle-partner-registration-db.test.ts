import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';

test('real database and HTTP preserve effective cooperation while source drafts move, deduplicate and expose conflict only to operators',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const label='合作资料合成-'+h.prefix,ids=[randomUUID(),randomUUID(),randomUUID()];
  await h.db.vehicle.createMany({data:ids.map((id,i)=>({id,title:label+i,brand:label,model:'合成车型',year:2026,city:'上海',mileageKm:0,status:'DRAFT',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase()}))});
  const owners=[];for(let i=0;i<3;i++)owners.push(await h.post('/admin/partners',{profile:{name:label+'主体'+i},idempotencyKey:randomUUID()}));
  const save=(ownerId:string,vehicleIds:string[],extra:any={})=>h.post('/admin/partners/'+ownerId+'/agreements',{...command(),status:'DRAFT',title:'合成来源资料',vehicleIds,fileIds:[],partnerRateBps:null,...extra});
  const old=await save(owners[0].id,[ids[0],ids[1]]);
  let first=await h.get('/admin/vehicles/'+ids[0]);assert.deepEqual(first.cooperationRegistration,{status:'PENDING_AGREEMENT',owners:[{id:owners[0].id,name:owners[0].name}]});assert.equal(first.cooperationOwner,null);
  await save(owners[0].id,[ids[1]],{...command(old.revision),agreementId:old.id});
  await save(owners[1].id,[ids[0],ids[2]]);await save(owners[1].id,[ids[0]]);
  await save(owners[0].id,[ids[2]]);
  const file=await h.proof(h.maker,'contract');
  await save(owners[2].id,[ids[0]],{status:'ACTIVE',partnerRateBps:4500,fileIds:[file.id]});
  const counts=async()=>({audits:await h.db.auditLog.count(),commands:await h.db.archiveCommand.count(),versions:await h.db.partnerAgreementVersion.count(),bindings:await h.db.partnerAgreementVehicle.count()});
  const before=await counts(),list=await h.get('/admin/vehicles?'+new URLSearchParams({keyword:label,pageSize:'100'}));
  assert.equal(list.total,3);const byId=new Map<string,any>(list.items.map((row:any)=>[row.id,row]));
  first=await h.get('/admin/vehicles/'+ids[0]);assert.deepEqual(first,byId.get(ids[0]));
  assert.deepEqual(first.cooperationOwner,{id:owners[2].id,name:owners[2].name,source:'SIMPLE_AGREEMENT'});
  assert.deepEqual(first.cooperationRegistration,{status:'CONFLICT',owners:[{id:owners[1].id,name:owners[1].name}]});
  assert.deepEqual(byId.get(ids[1]).cooperationRegistration,{status:'PENDING_AGREEMENT',owners:[{id:owners[0].id,name:owners[0].name}]});
  assert.equal(byId.get(ids[2]).cooperationRegistration.status,'CONFLICT');assert.deepEqual(new Set(byId.get(ids[2]).cooperationRegistration.owners.map((row:any)=>row.id)),new Set([owners[0].id,owners[1].id]));
  for(const staff of [h.finance,h.support]){const detail=await h.get('/admin/vehicles/'+ids[0],staff);assert.equal(Object.hasOwn(detail,'cooperationRegistration'),false);assert.equal(Object.hasOwn(detail,'cooperationOwner'),false);}
  const effectiveOnly=await h.get('/admin/vehicles?'+new URLSearchParams({cooperationOwnerId:owners[1].id}));assert.equal(effectiveOnly.total,0);
  assert.deepEqual(await counts(),before);assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.payment.providerCalls,0);
 }finally{await h.close();}
});
