import type {Db} from '../common/db';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {residualId} from '../residual-market/forecast-types';
import {archiveCommand} from '../offline-documents/command';
import {isResidualCommandRace} from '../residual-market/forecast-command';

export async function valuationTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  const pendingRace=error?.code==='P2002'&&error.meta?.modelName==='VehicleValuationReview'&&fields.length===1&&fields[0]==='forecastPointId';
  if(isResidualCommandRace(error)||pendingRace)return db.serial(operation);throw error;
 }
}
export async function valuationCommand(tx:any,actor:StaffActor,id:string,action:'CREATE'|'APPROVE'|'REJECT'|'CANCEL',input:{idempotencyKey:string},operation:()=>Promise<any>){
 const current=await requireCurrentStaff(tx,actor,'vehicle-valuations');residualId.parse(id);
 if(action==='APPROVE'||action==='REJECT')ensure(['ADMIN','FINANCE'].includes(current.role),403,'FORBIDDEN','仅管理员或财务可以审核估值');
 if(action==='CANCEL'){const row=await tx.vehicleValuationReview.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','估值复核不存在');ensure(current.role==='ADMIN'||row.createdBy===current.id,403,'FORBIDDEN','仅原申请人或管理员可以取消申请');}
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vehicle-valuations:${actor.id}:${id}:${action}:${input.idempotencyKey}`},0))`;
 return archiveCommand(tx,actor,`vehicle-valuations:${id}`,`${action}_VEHICLE_VALUATION`,input,operation);
}
