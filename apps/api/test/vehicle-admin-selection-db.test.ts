import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';

test('real vehicle HTTP selection filters all rows and keeps registered owner, cooperating partner, years and permissions separate',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const label='合成筛选-'+h.prefix;
  const model=await h.db.modelDefinition.create({data:{brand:label,name:'真实车型年款',modelYear:2025}});
  const ids=Array.from({length:125},()=>randomUUID());
  await h.db.vehicle.createMany({data:ids.map((id,i)=>({id,title:label+'-'+i,brand:label,model:'合成电动车',modelDefinitionId:model.id,year:2020,city:'上海',mileageKm:i===124?90000:i,status:'DRAFT',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),createdAt:new Date(Date.UTC(2026,0,125-i))}))});
  const targetId=ids[124],profilePath='/admin/vehicle-assets/'+targetId,body={...command(),vehicleRevision:0,registeredOwnerName:'  合成登记证所有人  ',firstRegistrationDate:'2024-02-29'};
  const writes=await Promise.all([h.raw(profilePath,body,h.maker,'PATCH'),h.raw(profilePath,body,h.maker,'PATCH')]);assert.deepEqual(writes.map(r=>r.status),[200,200]);assert.deepEqual(writes[0].data,writes[1].data);assert.equal(writes[0].data.registeredOwnerName,'合成登记证所有人');assert.equal(await h.db.auditLog.count({where:{resourceType:'vehicle-assets',resourceId:targetId}}),1);
  await h.reject(profilePath,{...command(0),vehicleRevision:0,registeredOwnerName:'不能覆盖'},h.maker,'REVISION_CONFLICT','PATCH');
  const defaultList=await h.get('/admin/vehicles?keyword='+encodeURIComponent(label)+'&pageSize=100');assert.equal(defaultList.total,125);assert.equal(defaultList.items.some((v:any)=>v.id===targetId),false);
  const q=new URLSearchParams({view:'product-selection',keyword:label,modelDefinitionId:model.id,modelYear:'2025',registeredOwnerName:'登记证',mileageKmMin:'90000',mileageKmMax:'90000',page:'1',pageSize:'1'}),selection=await h.get('/admin/vehicles?'+q);
  assert.equal(selection.total,1);const selected=selection.items[0];assert.equal(selected.id,targetId);assert.equal(selected.modelYear,2025);assert.equal(selected.registrationYear,2020);assert.equal(selected.firstRegistrationDate,'2024-02-29');assert.equal(selected.registeredOwnerName,'合成登记证所有人');assert.equal(selected.cooperationOwner,null);assert.ok(selected.ageMonths>=0);assert.equal(Object.hasOwn(selected,'reservedOrderId'),false);assert.equal(Object.hasOwn(selected,'assetProfile'),false);
  const secondPage=await h.get('/admin/vehicles?'+new URLSearchParams({...Object.fromEntries(q),page:'2'}));assert.equal(secondPage.total,1);assert.deepEqual(secondPage.items,[]);
  const direct=await h.get('/admin/vehicles/'+targetId);assert.equal(direct.registeredOwnerName,selected.registeredOwnerName);assert.equal(direct.modelYear,2025);assert.equal(direct.year,2020);
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());await h.post('/admin/vehicle-assets/'+ids[0],{...command(),vehicleRevision:0,firstRegistrationDate:date},h.maker,'PATCH');
  const newCars=await h.get('/admin/vehicles?'+new URLSearchParams({view:'product-selection',keyword:label,ageMonthsMin:'0',ageMonthsMax:'0'}));assert.equal(newCars.total,1);assert.equal(newCars.items[0].id,ids[0]);assert.equal(newCars.items[0].ageMonths,0);
  const owners:any[]=[],agreements:any[]=[];
  for(const [i,vehicleId]of [targetId,ids[1]].entries()){
   const owner=await h.post('/admin/partners',{profile:{name:label+'合作商'+i},idempotencyKey:randomUUID()}),file=await h.proof(h.maker,'contract');owners.push(owner);
   agreements.push(await h.post('/admin/partners/'+owner.id+'/agreements',{...command(),status:'ACTIVE',title:'合成有效协议',fileIds:[file.id],vehicleIds:[vehicleId],partnerRateBps:5000}));
  }
  const countBefore={audit:await h.db.auditLog.count(),commands:await h.db.archiveCommand.count(),profiles:await h.db.vehicleAssetProfile.count(),bindings:await h.db.partnerAgreementVehicle.count()};
  for(const [i,owner]of owners.entries()){
   const page=await h.get('/admin/vehicles?'+new URLSearchParams({view:'product-selection',cooperationOwnerId:owner.id,pageSize:'1'}));assert.equal(page.total,1);assert.equal(page.items[0].id,i===0?targetId:ids[1]);assert.deepEqual(page.items[0].cooperationOwner,{id:owner.id,name:owner.name,source:'SIMPLE_AGREEMENT'});
   const detail=await h.get('/admin/partners/'+owner.id);assert.equal(detail.vehicleCount,1);assert.equal(detail.vehicles.filter((v:any)=>v.active).length,1);assert(detail.vehicleAssignments.some((v:any)=>v.ownerId===owners[1-i].id),'global assignments remain available only for replacement checks');
  }
  for(const user of [h.finance,h.support]){
   const basic=await h.get('/admin/vehicles/'+targetId,user);assert.equal(Object.hasOwn(basic,'registeredOwnerName'),false);assert.equal(Object.hasOwn(basic,'cooperationOwner'),false);
   await h.reject('/admin/vehicles?view=product-selection',undefined,user,'FORBIDDEN');await h.reject('/admin/vehicles?registeredOwnerName=合成',undefined,user,'FORBIDDEN');
  }
  assert.equal(Object.hasOwn(await h.get(profilePath,h.finance),'registeredOwnerName'),false);await h.reject('/admin/vehicles?view=product-selection',undefined,h.field,'FORBIDDEN');
  for(const query of ['page=1.5','page=10001','pageSize=101','ageMonthsMin=5&ageMonthsMax=1','registeredOwnerName=a%00b'])await h.reject('/admin/vehicles?view=product-selection&'+query,undefined,h.maker,'VALIDATION');
  assert.deepEqual({audit:await h.db.auditLog.count(),commands:await h.db.archiveCommand.count(),profiles:await h.db.vehicleAssetProfile.count(),bindings:await h.db.partnerAgreementVehicle.count()},countBefore);
  await h.post('/admin/partners/'+owners[0].id+'/agreements/'+agreements[0].id+'/stop',{...command(agreements[0].revision)});
  assert.equal((await h.get('/admin/vehicles/'+targetId)).cooperationOwner,null);assert.equal((await h.get('/admin/vehicles?view=product-selection&cooperationOwnerId='+owners[0].id)).total,0);
  const partial=await h.post(profilePath,{...command(1),vehicleRevision:0,notes:'独立资料修改'},h.maker,'PATCH');assert.equal(partial.registeredOwnerName,'合成登记证所有人');
  const cleared=await h.post(profilePath,{...command(2),vehicleRevision:0,registeredOwnerName:null},h.maker,'PATCH');assert.equal(cleared.registeredOwnerName,null);assert.equal((await h.get('/admin/vehicles/'+targetId)).registeredOwnerName,null);
  await h.db.adminUser.update({where:{id:h.maker.id},data:{authVersion:{increment:1}}});await h.reject('/admin/vehicles?view=product-selection',undefined,h.maker);await h.reject(profilePath,body,h.maker,undefined,'PATCH');
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.payment.providerCalls,0);
 }finally{await h.close();}
});
