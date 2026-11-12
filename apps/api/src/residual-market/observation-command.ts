import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import type {Db} from '../common/db';

/** Import, restore and single-create share the same reservation boundary. The
 * physical partial unique index remains authoritative across other writers. */
export async function residualObservationCommand<T>(tx:any,actor:StaffActor,resource:'residual-observations'|'residual-imports',id:string,action:string,input:{idempotencyKey:string},operation:()=>Promise<T>):Promise<T>{
 await requireCurrentStaff(tx,actor,resource,true);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'residual:observations'}))`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`residual:${actor.id}:${resource}:${id}:${action}:${input.idempotencyKey}`}))`;
 return archiveCommand(tx,actor,`residual:${resource}:${id}`,action,input,operation);
}
export async function residualTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  const commandRace=fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field));
  // A serializable snapshot can predate the advisory-lock wait. Restart only
  // this physical reservation race; never turn a DB error into a failed row.
  const observationRace=error?.meta?.modelName==='MarketPriceObservation'&&fields.length===1&&fields[0]==='dedupeKey';
  if(error?.code==='P2002'&&(commandRace||observationRace))return db.serial(operation);
  throw error;
 }
}
