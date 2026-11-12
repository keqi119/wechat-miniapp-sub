import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {ArchiveActor} from './schemas';
import {requireCurrentStaff} from '../auth/staff-session';
import {requirePartnerCapability} from '../partners/capabilities';
export async function requireArchiveOperator(tx:any,actor:ArchiveActor,kind?:string,action:'write'|'review'='write'){
 if(kind==='OWNER_COOPERATION')return requirePartnerCapability(tx,actor,'partner.cooperation.write');
 const current=await requireCurrentStaff(tx,actor,'offline-archives');ensure(['ADMIN','OPERATIONS'].includes(current.role),403,'FORBIDDEN','仅当前有效管理员或运营可操作档案');return current;
}
export async function archiveCommand(tx:any,actor:ArchiveActor,resourceId:string,action:string,input:any,operation:()=>Promise<any>){
 const requestHash=hash(input),where={actorId_resourceId_action_key:{actorId:actor.id,resourceId,action,key:input.idempotencyKey}};
 const old=await tx.archiveCommand.findUnique({where});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','同一幂等键的请求内容不一致');return old.resultSnapshot;}
 const result=await operation();const snapshot=JSON.parse(JSON.stringify(result));await tx.archiveCommand.create({data:{actorId:actor.id,resourceId,action,key:input.idempotencyKey,requestHash,resultSnapshot:snapshot}});return snapshot;
}
