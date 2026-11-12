import {randomUUID} from 'node:crypto';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import type {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';

export async function workOrderTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  const commandRace=fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field));
  const scheduleRace=error?.meta?.modelName==='VehicleMaintenanceSchedule'&&fields.length===1&&fields[0]==='vehicleId';
  if(error?.code==='P2002'&&(commandRace||scheduleRace))return db.serial(operation);throw error;
 }
}
export async function workOrderCommand<T>(tx:any,actor:StaffActor,resource:string,id:string,action:string,input:{idempotencyKey:string},apply:()=>Promise<T>):Promise<T>{
 await requireCurrentStaff(tx,actor,resource,true);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-order:${actor.id}:${resource}:${id}:${action}:${input.idempotencyKey}`}))`;
 return archiveCommand(tx,actor,`work-order:${resource}:${id}`,action,input,apply);
}
export async function lockWorkOrder(tx:any,id:string,revision:number){
 const initial=await tx.assetWorkOrder.findUnique({where:{id}});ensure(initial,404,'NOT_FOUND','工单不存在');
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.vehicleId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "AssetWorkOrder" WHERE id=${id} FOR UPDATE`;
 const row=await tx.assetWorkOrder.findUnique({where:{id}});ensure(row&&row.vehicleId===initial.vehicleId&&row.revision===revision,409,'REVISION_CONFLICT','工单资料已变化，请刷新核对');return row;
}
/** Caller must hold Vehicle -> AssetWorkOrder and its current write permission. */
export async function recordWorkOrderTransition(tx:any,actor:StaffActor,row:any,action:string,changes:Record<string,unknown>,detail:Record<string,unknown>,now:Date,eventId=randomUUID()){
 ensure(Object.keys(detail).length>0,400,'VALIDATION','事件必须包含真实处理依据');
 const nextRevision=row.revision+1,nextSequence=row.eventSequence+1;
 ensure(Number.isSafeInteger(nextRevision)&&nextRevision<=2147483647&&Number.isSafeInteger(nextSequence)&&nextSequence<=2147483647,409,'REVISION_LIMIT','记录版本已达上限');
 const snapshot=JSON.parse(JSON.stringify(detail)),sourceHash=canonicalHash(snapshot);
 await tx.assetWorkOrderEvent.create({data:{id:eventId,workOrderId:row.id,sequence:nextSequence,action,actorId:actor.id,actorAt:now,beforeRevision:row.revision,afterRevision:nextRevision,detailSnapshot:snapshot,sourceHash}});
 const changed=await tx.assetWorkOrder.updateMany({where:{id:row.id,vehicleId:row.vehicleId,revision:row.revision,eventSequence:row.eventSequence},data:{...changes,revision:nextRevision,eventSequence:nextSequence,updatedBy:actor.id,updatedAt:now}});
 ensure(changed.count===1,409,'REVISION_CONFLICT','工单已更新，请刷新后重新确认');
 await audit(tx,actor.id,'WORK_ORDER_'+action,'asset-work-orders',row.id,{eventId,sequence:nextSequence,beforeRevision:row.revision,afterRevision:nextRevision,sourceHash});
 return tx.assetWorkOrder.findUniqueOrThrow({where:{id:row.id}});
}
