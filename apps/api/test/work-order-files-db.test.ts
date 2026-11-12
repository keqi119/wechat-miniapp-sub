import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,type Login} from './seven-module-journey-fixtures';

test('work-order and cost-line evidence HTTP keeps eight parents, finance separation and immutable historical replay',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const billCount=await h.db.bill.count(),paymentCount=await h.db.payment.count();
  const vehicle=await h.db.vehicle.create({data:{title:'合成工单附件车',brand:'Synthetic',model:'EV',year:2026,city:'上海',mileageKm:100}});
  const work=await h.db.assetWorkOrder.create({data:{vehicleId:vehicle.id,workOrderNo:'WO-'+h.prefix,kind:'REPAIR',occurredAt:new Date(),title:'合成维修',description:'仅隔离库附件验证',costConfirmationRequired:true,createdBy:h.maker.id,updatedBy:h.maker.id}});
  const other=await h.db.assetWorkOrder.create({data:{vehicleId:vehicle.id,workOrderNo:'WO-OTHER-'+h.prefix,kind:'REPAIR',occurredAt:new Date(),title:'同车另一工单',description:'跨父不能读',costConfirmationRequired:true,createdBy:h.maker.id,updatedBy:h.maker.id}});
  const line=await h.db.assetWorkOrderCost.create({data:{workOrderId:work.id,vehicleId:vehicle.id,category:'REPAIR',amount:12345,occurredOn:new Date('2026-10-30'),supplierName:'合成维修商',referenceNo:'LOCAL-ONLY',reason:'合成费用凭据',createdBy:h.finance.id,updatedBy:h.finance.id}});
  const workBase=`/admin/asset-work-orders/${work.id}/files`,costBase=`/admin/asset-work-order-cost-lines/${line.id}/files`;
  const bytes=Buffer.from('%PDF-1.4\nSYNTHETIC WORK ORDER '+h.prefix+'\n%%EOF');
  const form=(revision:number,idempotencyKey=randomUUID())=>{const body=new FormData();body.set('revision',String(revision));body.set('idempotencyKey',idempotencyKey);body.set('file',new Blob([bytes],{type:'application/pdf'}),'合成凭据.pdf');return body;};
  const key=randomUUID(),[first,replayed]=await Promise.all([h.post(workBase,form(0,key)),h.post(workBase,form(0,key))]);assert.deepEqual(first,replayed);assert.equal(first.revision,1);
  assert.equal(await h.db.assetPrivateFile.count({where:{workOrderId:work.id}}),1);assert.equal((await h.db.assetWorkOrder.findUniqueOrThrow({where:{id:work.id}})).eventSequence,0,'An attachment revision is not an operational event sequence');
  const raced=await Promise.all([h.raw(workBase,form(1)),h.raw(workBase,form(1))]);assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);assert.equal(raced.find(r=>r.status===409)!.data.error.code,'REVISION_CONFLICT');
  await h.assertPdf(`${workBase}/${first.id}`,h.finance);await h.reject(workBase,form(2),h.finance,'FORBIDDEN');
  const financeKey=randomUUID(),[proof,proofReplay]=await Promise.all([h.post(costBase,form(0,financeKey),h.finance),h.post(costBase,form(0,financeKey),h.finance)]);assert.deepEqual(proof,proofReplay);assert.equal(proof.revision,1);
  for(const resourceId of [work.id,line.id]){const bound=await h.db.assetPrivateFile.findMany({where:{OR:[{workOrderId:resourceId},{workOrderCostId:resourceId}]}});for(const b of bound){const fields=['baasContractId','depreciationPolicyId','costEntryId','licensePlateId','observationId','valuationReviewId','workOrderId','workOrderCostId'] as const;assert.equal(fields.filter(field=>b[field]!==null).length,1);}}
  for(const who of [h.maker,h.support,h.field]){await h.reject(costBase,undefined,who,'FORBIDDEN');await h.reject(`${costBase}/${proof.id}`,undefined,who,'FORBIDDEN');await h.reject(costBase,form(1),who,'FORBIDDEN');}
  for(const who of [h.support,h.field])await h.reject(workBase,undefined,who,'FORBIDDEN');
  await h.reject(`/admin/asset-work-orders/${other.id}/files/${first.id}`,undefined,h.maker,'ASSET_FILE_INVALID');await h.reject(`${workBase}/${proof.id}`,undefined,h.reviewer,'ASSET_FILE_INVALID');await h.reject(`${costBase}/${first.id}`,undefined,h.finance,'ASSET_FILE_INVALID');
  const [source,sourceRevision]=[await h.db.assetWorkOrderCost.findUniqueOrThrow({where:{id:line.id}}),(await h.db.assetWorkOrder.findUniqueOrThrow({where:{id:work.id}})).revision];
  await h.db.assetWorkOrderCost.update({where:{id:line.id},data:{status:'FROZEN',sourceSnapshot:{synthetic:'evidence-boundary-only'},sourceHash:'a'.repeat(64),frozenBy:h.finance.id,frozenAt:new Date()}});
  await h.reject(costBase,form(source.revision),h.finance,'ASSET_SOURCE_CLOSED');assert.deepEqual(await h.post(costBase,form(0,financeKey),h.finance),proof);await h.assertPdf(`${costBase}/${proof.id}`,h.finance);
  // Seed a terminal work-order fact solely to test the dedicated file surface;
  // operational state transitions are verified in their own service package.
  await h.db.assetWorkOrder.update({where:{id:work.id},data:{status:'CANCELLED',cancelledBy:h.maker.id,cancelledAt:new Date(),cancelReason:'隔离库终态附件验证'}});
  await h.reject(workBase,form(sourceRevision),h.maker,'ASSET_SOURCE_CLOSED');assert.deepEqual(await h.post(workBase,form(0,key)),first);await h.assertPdf(`${workBase}/${first.id}`,h.finance);
  const customer=await h.customer('work-order-proof'),anonymous:Login={id:'public',headers:{}};
  for(const fileId of [first.id,proof.id]){await h.reject(`/admin/files/${fileId}`,undefined,h.reviewer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/customer/files/${fileId}`,undefined,customer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/public/media/${fileId}`,undefined,anonymous,'NOT_FOUND');}
  await h.db.storedFile.update({where:{id:proof.id},data:{purpose:'vehicle',mimeType:'image/png'}});await h.db.vehicle.update({where:{id:vehicle.id},data:{coverFileId:proof.id,status:'PUBLISHED'}});await h.reject(`/public/media/${proof.id}`,undefined,anonymous,'NOT_FOUND');await h.reject(`/admin/files/${proof.id}`,undefined,h.reviewer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`${costBase}/${proof.id}`,undefined,h.finance,'ASSET_FILE_INVALID');
  await h.db.adminUser.update({where:{id:h.finance.id},data:{role:'OPERATIONS'}});await h.reject(costBase,form(0,financeKey),h.finance,'FORBIDDEN');
  assert.equal(await h.db.bill.count(),billCount);assert.equal(await h.db.payment.count(),paymentCount);assert.equal(h.externalCalls,0);assert.equal(h.payment.providerCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);
 }finally{await h.close();}
});
