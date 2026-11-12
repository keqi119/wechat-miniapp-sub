import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noVehicleUsage} from '../src/vehicle-changes/segments';
function fixture(){
 const order={id:'order',customerId:'customer',contractMode:'OFFLINE'},period={id:'june',orderId:order.id,startDate:new Date('2026-06-01'),effectiveEndDate:new Date('2026-07-01')};
 const before={id:'old',orderId:order.id,customerId:order.customerId,vehicleId:'old-car',returnHandoverId:'returned',endAt:new Date('2026-06-01T00:00:00+08:00'),endReadingKm:800},after={id:'new',orderId:order.id,customerId:order.customerId,vehicleId:'new-car',changeId:'change',deliveryHandoverId:'delivered',startAt:new Date('2026-07-01T00:00:00+08:00'),startReadingKm:20};
 const ret:any={id:'returned',orderId:order.id,customerId:order.customerId,assignmentId:before.id,vehicleId:before.vehicleId,changeId:'change',type:'SWAP_RETURN',status:'COMPLETED',executionMode:'OFFLINE',signatureStatus:'DRAFT',customerResponse:'CONFIRM',confirmedAt:new Date('2026-06-01'),actualAt:before.endAt,readingKm:800,manifestHash:'return-manifest',fileIds:['old-odometer']},delivery:any={id:'delivered',orderId:order.id,customerId:order.customerId,assignmentId:after.id,vehicleId:after.vehicleId,changeId:'change',type:'SWAP_DELIVERY',status:'COMPLETED',executionMode:'OFFLINE',signatureStatus:'DRAFT',customerResponse:'CONFIRM',confirmedAt:new Date('2026-07-01'),actualAt:after.startAt,readingKm:20,manifestHash:'delivery-manifest',fileIds:['new-odometer']};
 const archives=[ret,delivery].map(h=>({handoverId:h.id,kind:h.type==='SWAP_RETURN'?'RETURN_RECEIPT':'DELIVERY_RECEIPT',currentApprovedVersionId:h.id+'-paper',versions:[{id:h.id+'-paper',status:'ARCHIVED',businessSnapshotHash:h.manifestHash}]}));
 const tx:any={$queryRaw:async()=>[],order:{findUnique:async()=>order},vehicleAssignment:{count:async()=>0,findFirst:async({where}:any)=>where.status==='CLOSED'?before:after},handover:{findUnique:async({where}:any)=>where.id===ret.id?ret:delivery},documentArchive:{findFirst:async({where}:any)=>archives.find(a=>a.handoverId===where.handoverId&&a.kind===where.kind)},archiveFeedback:{count:async()=>0}};
 return{tx,period,order,before,after,ret,delivery,archives};
}
test('a whole vehicle-free month uses both actual archived OFFLINE swap receipts and never fabricates signed files or mileage',async()=>{
 const f=fixture(),result=await noVehicleUsage(f.tx,f.period);assert.deepEqual(result,{used:0,start:null,evidence:['old-odometer','new-odometer'],returnHandoverId:f.ret.id,deliveryHandoverId:f.delivery.id});assert.equal(f.ret.signatureStatus,'DRAFT');assert.equal(f.delivery.signedFileId,undefined);
 f.archives[1].versions[0].businessSnapshotHash='stale';await assert.rejects(noVehicleUsage(f.tx,f.period),(e:any)=>e.getResponse?.().error?.code==='ARCHIVE_SNAPSHOT_MISMATCH');
});
test('OFFLINE gap refuses foreign customers, mismatched assignment/change, unknown mode and any physical overlap',async()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.delivery.customerId='other';},(f:ReturnType<typeof fixture>)=>{f.delivery.assignmentId='other';},(f:ReturnType<typeof fixture>)=>{f.delivery.changeId='other';},(f:ReturnType<typeof fixture>)=>{f.delivery.executionMode='UNKNOWN';},(f:ReturnType<typeof fixture>)=>{f.tx.vehicleAssignment.count=async()=>1;}]){const f=fixture();mutate(f);assert.equal(await noVehicleUsage(f.tx,f.period),null);}
});
