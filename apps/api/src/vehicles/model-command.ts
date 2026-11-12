import {z} from 'zod';
import {key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';

/** Model year is maintained master data, independent from a vehicle's registration year. */
export async function modelCommand(tx:any,actor:any,id:string|undefined,action:'CREATE'|'UPDATE',raw:any,operation:()=>Promise<any>){
 const input=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).passthrough().parse(raw);
 await requireCurrentStaff(tx,actor,'model-definitions');
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`model-command:${actor.id}:${id||'NEW'}:${action}:${input.idempotencyKey}`}))`;
 if(id)await tx.$queryRaw`SELECT id FROM "ModelDefinition" WHERE id=${id} FOR UPDATE`;
 return archiveCommand(tx,actor,id||'NEW_MODEL_DEFINITION',`MODEL_${action}`,input,async()=>{
  const current=id?await tx.modelDefinition.findUnique({where:{id}}):null;ensure(!id||current,404,'NOT_FOUND','车型资料不存在');
  ensure(input.revision===(current?.revision??0),409,'REVISION_CONFLICT','车型资料已更新，请刷新核对后再提交');
  return operation();
 });
}
