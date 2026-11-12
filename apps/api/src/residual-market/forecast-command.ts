import type {Db} from '../common/db';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {residualId} from './forecast-types';
import {archiveCommand} from '../offline-documents/command';

export function isResidualCommandRace(error:any):boolean{
 const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
 return error?.code==='P2002'&&(error.meta?.modelName===undefined||error.meta.modelName==='ArchiveCommand')&&fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field));
}
export async function residualForecastTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{try{return await db.serial(operation);}catch(error){if(isResidualCommandRace(error))return db.serial(operation);throw error;}}
export async function forecastCommand<T extends {idempotencyKey:string}>(tx:any,actor:StaffActor,id:string,action:string,input:T,operation:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'residual-forecasts');residualId.parse(id);
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`residual-forecasts:${actor.id}:${id}:${action}:${input.idempotencyKey}`},0))`;
 return archiveCommand(tx,actor,`residual-forecasts:${id}`,action,input,operation);
}
export async function lockForecastVehicle(tx:any,vehicleId:string){await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicleId} FOR UPDATE`;}
export async function lockForecast(tx:any,id:string){await tx.$queryRaw`SELECT id FROM "VehicleResidualForecast" WHERE id=${id} FOR UPDATE`;}
