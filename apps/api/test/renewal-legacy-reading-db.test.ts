import './legacy-esign-mode';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {listenForHttpTests} from './http-listener';
import {tokenHash} from '../src/auth/auth.service';
import {hash} from '../src/common/data';
import {persistedStageSwap} from './stage-swap-db-fixture';

// Stage/assignment and months 1..11 are explicit historical seeds, not an activation claim.
// Month 12 and the new first segment below use real uploads, HTTP review and settlement.
test('real legacy month settlement supplies the renewal start without old-segment backfill or stale-meter overbilling',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});let app:any,providerCalls=0,phase='historical-seed',failed=false;
 try{
  const token=randomUUID(),actor=await db.adminUser.create({data:{username:token,name:'合成里程审核财务',passwordHash:'synthetic',role:'ADMIN'}});
  await db.adminSession.create({data:{id:tokenHash(token),adminId:actor.id,csrfToken:'legacy-reading',expiresAt:new Date(Date.now()+3600000)}});
  for(const type of ['terms','privacy']){const version=((await db.legalDocument.aggregate({where:{type},_max:{version:true}}))._max.version||0)+1;await db.legalDocument.create({data:{type,version,title:'本地合成协议',content:'本地合成使用，不用于真实业务',status:'PUBLISHED',confirmedBy:actor.id,confirmedAt:new Date()}});}
  const f=await persistedStageSwap(db,actor.id),boundary=(s:string)=>new Date(s+'T00:00:00+08:00');
  await db.order.update({where:{id:f.order.id},data:{effectiveTermsVersionId:f.ids['renewal-terms'],confirmedMileageKm:4500}});
  await db.vehicle.update({where:{id:f.order.vehicleId},data:{reservedOrderId:f.order.id,mileageKm:4500}});
  await db.vehicleAssignment.update({where:{id:f.ids['original-assignment']},data:{endAt:boundary('2026-12-01'),endReadingKm:5001}});
  await db.vehicleAssignment.update({where:{id:f.ids['current-assignment']},data:{startAt:boundary('2026-12-01'),startReadingKm:3000}});
  const oldMonths:any[]=[];
  for(const row of f.initial.billingSchedule){const prior=row.sequence<12;oldMonths.push(await db.usagePeriod.create({data:{accountId:f.account.id,orderId:f.order.id,sequence:row.sequence,startDate:new Date(row.startDate),endDate:new Date(row.endDate),effectiveEndDate:new Date(row.endDate),status:prior?'SETTLED':'OPEN',startReadingKm:row.sequence===12?4500:(row.sequence-1)*500,endReadingKm:prior?(row.sequence===11?4500:row.sequence*500):null,...(prior?{usedKm:row.sequence===11?1501:500,settlementKey:randomUUID(),settledAt:boundary('2027-01-01')}:{})}}));}
  // Month 11 contains a genuine old/new assignment split in this historical fixture.
  const earlier=oldMonths[10];
  for(const segment of [{assignmentId:f.ids['original-assignment'],vehicleId:f.ids['original-car'],startAt:boundary('2026-11-30'),endAt:boundary('2026-12-01'),startReadingKm:5000,endReadingKm:5001},{assignmentId:f.ids['current-assignment'],vehicleId:f.ids['current-car'],startAt:boundary('2026-12-01'),endAt:boundary('2026-12-31'),startReadingKm:3000,endReadingKm:4500}])await db.usageSegment.create({data:{...segment,periodId:earlier.id,status:'FROZEN',frozenHash:hash(segment)}});
  const old=oldMonths[11],row=f.source.billingSchedule[0],period=await db.usagePeriod.create({data:{accountId:f.account.id,orderId:f.order.id,serviceStageId:f.ids['stage-2'],stageSequence:1,sequence:row.sequence,startDate:new Date(row.startDate),endDate:new Date(row.endDate),effectiveEndDate:new Date(row.endDate),pricingSnapshot:f.source.usagePricing}});
  const segment=await db.usageSegment.create({data:{periodId:period.id,assignmentId:f.ids['current-assignment'],vehicleId:f.ids['current-car'],startAt:boundary(row.startDate),startReadingKm:null}});
  const forbidden=async()=>{providerCalls++;throw Error('External calls are forbidden in this local fixture');};
  phase='app-start';app=await createApp({db,usageClock:()=>new Date('2027-02-28T04:00:00Z'),payment:{create:forbidden,query:forbidden,close:forbidden,refund:forbidden,queryRefund:forbidden},identity:{verify:forbidden} as any,esign:{start:forbidden,query:forbidden} as any});
  const base=await listenForHttpTests(app);
  const post=async(path:string,body:any,customer=false)=>{phase=path;const multipart=body instanceof FormData,response=await fetch(base+'/api'+path,{method:'POST',headers:{Origin:'http://localhost:3100',...(!multipart?{'Content-Type':'application/json'}:{}),...(customer?{Authorization:'Bearer '+f.token}:{Cookie:'admin_session='+token,'X-CSRF-Token':'legacy-reading'})},body:multipart?body:JSON.stringify(body)}),data:any=await response.json();assert.equal(response.status,201,JSON.stringify(data));return data;};
  const photo=async()=>{const form=new FormData();form.set('purpose','mileage');form.set('file',new Blob([new Uint8Array([255,216,255,224,...Buffer.from('SYNTHETIC-ODOMETER-'+randomUUID())])],{type:'image/jpeg'}),'synthetic.jpg');return post('/customer/files',form,true);};
  const oldPhoto=await photo(),oldReading=await post(`/customer/usage-periods/${old.id}/readings`,{readingKm:7000,recordedAt:'2027-01-31T09:00:00+08:00',fileIds:[oldPhoto.id],idempotencyKey:randomUUID()},true);
  await post(`/admin/mileages/${oldReading.id}/review`,{decision:'APPROVED',boundaryConfirmed:true,note:'合成照片对应旧月界真实读数'});
  const oldReady=await db.usagePeriod.findUniqueOrThrow({where:{id:old.id}}),oldSettled=await post(`/admin/usage-periods/${old.id}/settle`,{revision:oldReady.revision,idempotencyKey:randomUUID()});
  assert.equal(oldSettled.usedKm,2500);assert.equal(oldSettled.baseAllowanceKm,1500);assert.equal(oldSettled.excessPriceAmount,150);assert.equal(oldSettled.excessAmount,150000);
  assert.equal(await db.usageSegment.count({where:{periodId:old.id}}),0,'settling a legacy month does not backfill segments');
  const oldPeriodFact=await db.usagePeriod.findUniqueOrThrow({where:{id:old.id}}),oldReadingFact=await db.mileage.findUniqueOrThrow({where:{id:oldReading.id}}),oldSegmentFacts=await db.usageSegment.findMany({where:{periodId:earlier.id},orderBy:{id:'asc'}});
  const newPhoto=await photo(),newReading=await post(`/customer/usage-segments/${segment.id}/readings`,{readingKm:10000,recordedAt:'2027-02-28T09:00:00+08:00',fileIds:[newPhoto.id],idempotencyKey:randomUUID()},true);
  await post(`/admin/mileages/${newReading.id}/review`,{decision:'APPROVED',boundaryConfirmed:true,note:'合成照片对应新月界真实读数'});
  const ready=await db.usagePeriod.findUniqueOrThrow({where:{id:period.id}}),input={revision:ready.revision,idempotencyKey:randomUUID()};
  const results=await Promise.all([post(`/admin/usage-periods/${period.id}/settle`,input),post(`/admin/usage-periods/${period.id}/settle`,input)]);
  assert.deepEqual(results[0],results[1]);assert.equal(results[0].startReadingKm,7000);assert.equal(results[0].usedKm,3000);assert.equal(results[0].baseAllowanceKm,2200);assert.equal(results[0].excessPriceAmount,175);assert.equal(results[0].excessAmount,140000);
  const frozen=await db.usageSegment.findUniqueOrThrow({where:{id:segment.id}});assert.equal(frozen.startReadingKm,7000);assert.equal(frozen.status,'FROZEN');assert.match(frozen.frozenHash!,/^[a-f0-9]{64}$/);
  assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'MILEAGE_EXCESS',sequence:13}}),1);
  assert.deepEqual(await db.usagePeriod.findUniqueOrThrow({where:{id:old.id}}),oldPeriodFact);assert.deepEqual(await db.mileage.findUniqueOrThrow({where:{id:oldReading.id}}),oldReadingFact);assert.deepEqual(await db.usageSegment.findMany({where:{periodId:earlier.id},orderBy:{id:'asc'}}),oldSegmentFacts);assert.equal(await db.usageSegment.count({where:{periodId:old.id}}),0);assert.equal(providerCalls,0);
 }catch(error){failed=true;console.error('Legacy-reading test phase:',phase);throw error;}
 finally{try{if(app)await app.close();else await db.$disconnect();}catch(error){if(!failed)throw error;console.error('Cleanup also failed; original test failure preserved.');}}
});
