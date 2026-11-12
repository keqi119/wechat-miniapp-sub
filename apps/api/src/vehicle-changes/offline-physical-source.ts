import {isOnlineHandover,assertOnlineRecord,requireOnlineConfirmation} from '../operations/online-handover';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {fieldReceiptKind} from '../field-handover/batches';

/** Same ordered physical payload used by createSwapHandover, before delivery assignment backfill. */
export function offlineSwapHandoverHash(h:any,q:any){
 const data={orderId:h.orderId,customerId:h.customerId,changeId:h.changeId,type:h.type,vehicleId:h.vehicleId,assignmentId:h.type==='SWAP_DELIVERY'?null:h.assignmentId,actualAt:h.actualAt,readingKm:h.readingKm,fileIds:h.fileIds,checklist:h.checklist};
 return hash({...data,quoteId:q.id,commercialHash:q.commercialHash});
}
export function assertOfflineSwapHandoverSource(h:any,change:any,q:any){
 const online=isOnlineHandover(h)&&h.onlineRecordSnapshot?assertOnlineRecord(h):null;
 ensure((h.executionMode==='OFFLINE'||h.executionMode==='ELECTRONIC'&&q.snapshot.executionMode==='ELECTRONIC')&&h.changeId===change.id&&h.orderId===change.orderId&&h.customerId===change.customerId&&['SWAP_RETURN','SWAP_DELIVERY'].includes(h.type)&&q.changeId===change.id&&q.id===change.activeQuoteId&&(online?online.sourceHash:h.manifestHash)===offlineSwapHandoverHash(h,q),409,'SWAP_HANDOVER_SOURCE_CHANGED','实际交接事实与本次已确认报价不一致');
}

export async function requireSwapFieldCompletion(tx:any,h:any,change:any,q:any,locking=true){
 if(!h.fieldTaskId)return null;
 if(locking)await tx.$queryRaw`SELECT id FROM "FieldHandoverTask" WHERE id=${h.fieldTaskId} FOR UPDATE`;
 const task=await tx.fieldHandoverTask.findUnique({where:{id:h.fieldTaskId}}),side=h.type==='SWAP_RETURN'?'RETURN':'DELIVERY';
 ensure(task&&task.orderId===h.orderId&&task.changeId===change.id&&task.quoteId===q.id&&task.termsVersionId===null&&task.type===h.type&&task.batchKey===`CHANGE:${change.id}:${side}`&&task.vehicleId===h.vehicleId&&task.vehicleAssignmentId===h.assignmentId&&task.currentHandoverId===h.id&&task.status==='ASSIGNED',409,'FIELD_SWAP_SOURCE_CHANGED','现场任务当前交接、报价或车辆分配已变化');
 return task;
}

/** Read-only receipt projection, also excludes an explicitly invalidated current version. */
export async function readOfflineSwapReceiptReady(tx:any,h:any){
 if(h.executionMode!=='OFFLINE'||h.status!=='CUSTOMER_CONFIRMED'||h.customerResponse!=='CONFIRM'||!h.confirmedAt)return false;
 if(isOnlineHandover(h)){try{await requireOnlineConfirmation(tx,h);return !await tx.archiveFeedback.count({where:{status:'OPEN',version:{archive:{orderId:h.orderId}}}});}catch{return false;}}
 const [archive,feedback]=await Promise.all([tx.documentArchive.findFirst({where:{handoverId:h.id,kind:fieldReceiptKind(h.type)},include:{versions:true}}),tx.archiveFeedback.count({where:{status:'OPEN',version:{archive:{orderId:h.orderId}}}})]);
 const version=archive?.versions?.find((v:any)=>v.id===archive.currentApprovedVersionId);
 return !!(version&&version.status==='ARCHIVED'&&!version.invalidatedAt&&!version.invalidatedBy&&version.businessSnapshotHash===h.manifestHash&&!feedback);
}
