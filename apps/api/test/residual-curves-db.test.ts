import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalHash} from '../src/customers/types';
import {JourneyHarness} from './seven-module-journey-fixtures';

test('residual curve HTTP keeps preview read-only and serializes immutable source creation, activation and history',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const root='/admin/residual-curves';
  const model=await h.db.modelDefinition.create({data:{brand:'合成残值',name:`曲线-${h.prefix}`,modelYear:2026}});
  const samples=[];for(let index=0;index<3;index++)samples.push(await h.db.marketPriceObservation.create({data:{modelDefinitionId:model.id,modelSnapshot:{id:model.id,revision:model.revision,brand:model.brand,name:model.name,modelYear:2026},source:'MANUAL',observedOn:new Date('2026-10-30'),registrationDate:new Date('2025-10-31'),priceType:'TRANSACTION',priceAmount:100001+index*2,batteryOwnership:'OWNED',batteryCapacityKwh:'75.500',mileageKm:1000,sourceNote:'本地合成市场依据',dedupeKey:createHash('sha256').update(`${h.prefix}:${index}`).digest('hex'),confidenceScore:100,createdBy:h.maker.id,updatedBy:h.maker.id}}));
  const request={modelDefinitionId:model.id,modelRevision:model.revision,name:'合成曲线一期',batteryOwnership:'OWNED',batteryCapacityKwh:'075.500'},counts=()=>Promise.all([h.db.vehicleResidualCurve.count(),h.db.vehicleResidualCurvePoint.count(),h.db.archiveCommand.count(),h.db.auditLog.count(),h.db.bill.count(),h.db.payment.count()]);
  const beforePreview=await counts(),preview=await h.post(`${root}/preview`,request,h.finance);assert.deepEqual(await counts(),beforePreview);assert.equal(preview.sourceHash,canonicalHash(preview.sourceSnapshot));assert.equal(preview.dimensionSnapshot.batteryCapacityKwh,'75.5');assert.equal(preview.points[0].medianPriceAmount,100003);assert.equal(preview.points[0].ageMonth,12);
  const noCsrf={...h.finance,headers:{...h.finance.headers}};delete noCsrf.headers['X-CSRF-Token'];await h.reject(`${root}/preview`,request,noCsrf,'CSRF_DENIED');await h.reject(`${root}/preview`,request,{...h.finance,headers:{...h.finance.headers,Origin:'https://untrusted.invalid'}},'ORIGIN_DENIED');for(const who of [h.support,h.field])await h.reject(`${root}/preview`,request,who,'FORBIDDEN');
  const create={...request,revision:0,idempotencyKey:randomUUID(),previewHash:preview.previewHash};await h.reject(root,create,h.finance,'FORBIDDEN');
  const [first,replayed]=await Promise.all([h.post(root,create),h.post(root,create)]);assert.deepEqual(first,replayed);assert.equal(first.status,'DRAFT');assert.equal(first.activatedAt,null);assert.equal(first.pointCount,1);assert.deepEqual(first.points[0].sampleSnapshot.map((row:any)=>[row.observationId,row.revision,row.priceAmount]),samples.map(row=>[row.id,0,row.priceAmount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  assert.equal(await h.db.vehicleResidualCurve.count({where:{modelDefinitionId:model.id}}),1);assert.equal(await h.db.archiveCommand.count({where:{actorId:h.maker.id,resourceId:'residual-curves:NEW',action:'CREATE_RESIDUAL_CURVE',key:create.idempotencyKey}}),1);
  await h.reject(root,{...create,name:'同键不同名字'},h.maker,'IDEMPOTENCY_CONFLICT');
  const secondRequest={...request,name:'合成曲线二期'},secondPreview=await h.post(`${root}/preview`,secondRequest),second=await h.post(root,{...secondRequest,revision:0,idempotencyKey:randomUUID(),previewHash:secondPreview.previewHash});
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),activationA={revision:0,idempotencyKey:randomUUID(),effectiveFrom:today,reason:'同维度并发生效A'},activationB={revision:0,idempotencyKey:randomUUID(),effectiveFrom:today,reason:'同维度并发生效B'};
  const activated=await Promise.all([h.post(`${root}/${first.id}/activate`,activationA),h.post(`${root}/${second.id}/activate`,activationB)]);assert.ok(activated.every(row=>row.status==='ACTIVE'));const curves=await h.db.vehicleResidualCurve.findMany({where:{modelDefinitionId:model.id}}),active=curves.find(row=>row.status==='ACTIVE')!,superseded=curves.find(row=>row.status==='SUPERSEDED')!;assert.ok(active);assert.ok(superseded);assert.equal(curves.filter(row=>row.status==='ACTIVE').length,1);assert.ok(superseded.supersededAt);assert.equal(active.sourceHash,first.sourceHash);assert.equal(superseded.sourceHash,first.sourceHash);
  const beforeLiveChange=await h.get(`${root}/${active.id}`,h.finance);
  const thirdRequest={...request,name:'尚未生效来源变化'},thirdPreview=await h.post(`${root}/preview`,thirdRequest),thirdBody={...thirdRequest,revision:0,idempotencyKey:randomUUID(),previewHash:thirdPreview.previewHash},third=await h.post(root,thirdBody);
  // Real dedicated upload advances a source revision; it must invalidate a
  // first activation without rewriting any existing immutable curve.
  await h.post(`/admin/residual-observations/${samples[0].id}/files`,h.form({revision:0,idempotencyKey:randomUUID()},'curve-source-evidence'));
  await h.reject(`${root}/${third.id}/activate`,{revision:0,idempotencyKey:randomUUID(),effectiveFrom:today,reason:'来源已补证'},h.maker,'SOURCE_CHANGED');assert.equal((await h.db.vehicleResidualCurve.findUniqueOrThrow({where:{id:third.id}})).status,'DRAFT');
  await h.reject(root,{...thirdBody,idempotencyKey:randomUUID()},h.maker,'PREVIEW_CHANGED');assert.deepEqual(await h.post(root,thirdBody),third);
  const replayActivation=active.id===first.id?activationA:activationB,activeResponse=activated.find(row=>row.id===active.id)!;assert.deepEqual(await h.post(`${root}/${active.id}/activate`,replayActivation),activeResponse);
  await h.db.marketPriceObservation.update({where:{id:samples[1].id},data:{status:'VOIDED',revision:{increment:1}}});const afterLiveChange=await h.get(`${root}/${active.id}`,h.finance);assert.deepEqual(afterLiveChange.sourceSnapshot,beforeLiveChange.sourceSnapshot);assert.deepEqual(afterLiveChange.points,beforeLiveChange.points);assert.equal(afterLiveChange.sourceHash,beforeLiveChange.sourceHash);
  const empty=await h.post(`${root}/preview`,request,h.finance);assert.equal(empty.points.length,0);await h.reject(root,{...request,revision:0,idempotencyKey:randomUUID(),previewHash:empty.previewHash},h.maker,'RESIDUAL_NO_POINTS');
  const archive={revision:active.revision,idempotencyKey:randomUUID(),reason:'保留历史并停止新用'},archived=await h.post(`${root}/${active.id}/archive`,archive);assert.equal(archived.status,'ARCHIVED');assert.ok(archived.archivedAt);assert.deepEqual(archived.points,beforeLiveChange.points);assert.deepEqual(await h.post(`${root}/${active.id}/archive`,archive),archived);
  const financeList=await h.get(`${root}?modelDefinitionId=${model.id}&status=ARCHIVED`,h.finance);assert.equal(financeList.total,1);assert.equal(financeList.items[0].id,active.id);assert.equal('sourceSnapshot'in financeList.items[0],false);await h.reject(`${root}/${third.id}/archive`,{revision:0,idempotencyKey:randomUUID(),reason:'财务不能归档'},h.finance,'FORBIDDEN');
  await h.db.adminUser.update({where:{id:h.maker.id},data:{role:'SUPPORT',authVersion:{increment:1}}});await h.reject(root,create,h.maker,'SESSION_EXPIRED');await h.reject(`${root}/${active.id}/activate`,replayActivation,h.maker,'SESSION_EXPIRED');
  assert.equal(await h.db.bill.count(),beforePreview[4]);assert.equal(await h.db.payment.count(),beforePreview[5]);assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.payment.providerCalls,0);
 }finally{await h.close();}
});
