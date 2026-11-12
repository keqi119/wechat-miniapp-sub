import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import type {Db} from '../common/db';
import {ensure} from '../common/errors';

export type AssetLockTable='VehicleAssetProfile'|'VehicleBaasContract'|'VehicleDepreciationPolicy'|'AssetWorkOrder'|'AssetWorkOrderCost'|'AssetCostPlan'|'AssetCostEntry'|'AssetManualPaymentRecord'|'AssetRecoveryRecord';
export type AssetLock={table:AssetLockTable;id:string};
const lockOrder:AssetLockTable[]=['VehicleAssetProfile','VehicleBaasContract','VehicleDepreciationPolicy','AssetWorkOrder','AssetWorkOrderCost','AssetCostPlan','AssetCostEntry','AssetManualPaymentRecord','AssetRecoveryRecord'];
export async function lockAssetRows(tx:any,vehicleIds:string[],locks:AssetLock[]=[]){
 for(const id of [...new Set(vehicleIds)].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${id} FOR UPDATE`;
 const expanded=[...locks];
 for(const lock of locks.filter(item=>item.table==='AssetWorkOrderCost')){
  const line=await tx.assetWorkOrderCost.findUnique({where:{id:lock.id}});ensure(line&&vehicleIds.includes(line.vehicleId),409,'COST_SOURCE_MISMATCH','费用来源与已锁定车辆不一致');
  const work=await tx.assetWorkOrder.findUnique({where:{id:line.workOrderId}});ensure(work&&work.vehicleId===line.vehicleId,409,'COST_SOURCE_MISMATCH','费用与真实工单不一致');expanded.push({table:'AssetWorkOrder',id:work.id});
 }
 for(const lock of [...new Map(expanded.map(item=>[item.table+':'+item.id,item])).values()].sort((a,b)=>lockOrder.indexOf(a.table)-lockOrder.indexOf(b.table)||a.id.localeCompare(b.id))){
  if(lock.table==='VehicleAssetProfile')await tx.$queryRaw`SELECT "vehicleId" FROM "VehicleAssetProfile" WHERE "vehicleId"=${lock.id} FOR UPDATE`;
  if(lock.table==='VehicleBaasContract')await tx.$queryRaw`SELECT id FROM "VehicleBaasContract" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='VehicleDepreciationPolicy')await tx.$queryRaw`SELECT id FROM "VehicleDepreciationPolicy" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='AssetWorkOrder')await tx.$queryRaw`SELECT id FROM "AssetWorkOrder" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='AssetWorkOrderCost')await tx.$queryRaw`SELECT id FROM "AssetWorkOrderCost" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='AssetCostPlan')await tx.$queryRaw`SELECT id FROM "AssetCostPlan" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='AssetCostEntry')await tx.$queryRaw`SELECT id FROM "AssetCostEntry" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='AssetManualPaymentRecord')await tx.$queryRaw`SELECT id FROM "AssetManualPaymentRecord" WHERE id=${lock.id} FOR UPDATE`;
  if(lock.table==='AssetRecoveryRecord')await tx.$queryRaw`SELECT id FROM "AssetRecoveryRecord" WHERE id=${lock.id} FOR UPDATE`;
 }
}
export async function assetCommand<T>(tx:any,actor:StaffActor,resource:string,id:string,action:string,input:{idempotencyKey:string},vehicleIds:string[],locks:AssetLock[],operation:()=>Promise<T>):Promise<T>{
 await requireCurrentStaff(tx,actor,resource,true);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset:${actor.id}:${resource}:${id}:${action}:${input.idempotencyKey}`}))`;
 await lockAssetRows(tx,vehicleIds,locks);
 return archiveCommand(tx,actor,`asset:${resource}:${id}`,action,input,operation);
}
/** Serializable retries live in Db; only known initial-create/replay uniqueness races retry here. */
export async function assetTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const target=error?.meta?.target,fields=Array.isArray(target)?target:[];
  const commandRace=fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field));
  const profileRace=error?.meta?.modelName==='VehicleAssetProfile'&&fields.length===1&&fields[0]==='vehicleId';
  if(error?.code==='P2002'&&(commandRace||profileRace))return db.serial(operation);
  throw error;
 }
}
