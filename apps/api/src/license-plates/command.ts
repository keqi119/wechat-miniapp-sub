import type {Db} from '../common/db';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {ensure} from '../common/errors';

/** Vehicle IDs are sorted before the plate; a plate operation never locks a vehicle afterwards. */
export async function plateCommand<T>(tx:any,actor:StaffActor,id:string,action:string,input:{idempotencyKey:string},vehicleIds:string[],ownerIds:string[],operation:()=>Promise<T>):Promise<T>{
 await requireCurrentStaff(tx,actor,'license-plates');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plate:${actor.id}:${id}:${action}:${input.idempotencyKey}`}))`;
 for(const vehicleId of [...new Set(vehicleIds)].sort())await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;
 if(id!=='NEW')await tx.$queryRaw`SELECT id FROM "LicensePlate" WHERE id=${id} FOR UPDATE`;
 for(const ownerId of [...new Set(ownerIds)].sort())await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${ownerId} FOR UPDATE`;
 if(id!=='NEW'){
  await tx.$queryRaw`SELECT id FROM "PlateOwnershipPeriod" WHERE "plateId"=${id} AND "validUntil" IS NULL ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PlateVehicleBinding" WHERE "plateId"=${id} AND "validUntil" IS NULL ORDER BY id FOR UPDATE`;
 }
 return archiveCommand(tx,actor,`license-plate:${id}`,action,input,operation);
}
export async function plateTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  if(error?.code==='P2002'&&fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field)))return db.serial(operation);
  if(error?.code==='P2002'){
   if(error.meta?.modelName==='LicensePlate'&&fields.includes('normalizedNumber'))ensure(false,409,'PLATE_NUMBER_EXISTS','该规范牌照号码已经备案，请查看原档案');
   if(['PlateOwnershipPeriod','PlateVehicleBinding'].includes(error.meta?.modelName))ensure(false,409,'PLATE_CURRENT_CONFLICT','当前归属或车辆绑定已变化，请刷新核对');
  }
  throw error;
 }
}
