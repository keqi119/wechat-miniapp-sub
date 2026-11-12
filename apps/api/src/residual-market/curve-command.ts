import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import type {Db} from '../common/db';

/** An advisory-lock wait cannot refresh a serializable snapshot. Restart the
 * whole transaction once only for the command reservation's physical race. */
export async function residualCurveTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  const commandRace=error?.code==='P2002'&&(error.meta?.modelName===undefined||error.meta.modelName==='ArchiveCommand')&&fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field));
  if(commandRace)return db.serial(operation);
  throw error;
 }
}

/** Authentication precedes replay; live sources are read only inside operation. */
export async function residualCurveCommand(tx:any,actor:StaffActor,scope:string,action:string,input:{idempotencyKey:string},operation:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'residual-curves');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`residual-curves:${actor.id}:${scope}:${action}:${input.idempotencyKey}`},0))`;
 return archiveCommand(tx,actor,`residual-curves:${scope}`,action,input,operation);
}
export async function lockCurveDimension(tx:any,dimensionHash:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`residual-curve-dimension:${dimensionHash}`},0))`;}
export async function lockCurves(tx:any,ids:string[]){for(const id of [...new Set(ids)].sort())await tx.$queryRaw`SELECT id FROM "VehicleResidualCurve" WHERE id=${id} FOR UPDATE`;}
