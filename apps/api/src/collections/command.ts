import type {Db} from '../common/db';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {collectionId} from './types';

export async function collectionPermission(tx:any,actor:StaffActor,write=false,resource='collection-cases'){
 ensure(actor&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');const current=await requireCurrentStaff(tx,actor,resource,write);ensure(['ADMIN','FINANCE'].includes(current.role),403,'FORBIDDEN','仅管理员或财务可办理人工催收');return current;
}
export async function collectionTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){const fields=Array.isArray(error?.meta?.target)?error.meta.target:[],commandRace=(error?.meta?.modelName===undefined||error.meta.modelName==='ArchiveCommand')&&fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field)),caseRace=error?.meta?.modelName==='CollectionCase'&&fields.length===1&&fields[0]==='orderId';if(error?.code==='P2002'&&(commandRace||caseRace))return db.serial(operation);throw error;}
}
export async function collectionCommand<T>(tx:any,actor:StaffActor,id:string,action:string,input:{idempotencyKey:string},operation:()=>Promise<T>):Promise<T>{
 await collectionPermission(tx,actor,true);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`collection:${actor.id}:${id}:${action}:${input.idempotencyKey}`},0))`;return archiveCommand(tx,actor,'collection:'+id,action,input,operation);
}
/** Only first writes reach these locks; successful keys replay before current cash checks. */
export async function lockCollectionOrder(tx:any,orderId:string,caseId?:string){
 collectionId.parse(orderId);await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
 // A SERIALIZABLE snapshot may predate the wait above. Real late-receipt
 // callbacks can change only Payment, leaving Order/Bill values unchanged.
 // This same-value write establishes the SSI dependency which forces a full
 // retry instead of closing from that older cash snapshot. No business
 // revision/timestamp changes, and cached keys never reach this operation.
 await tx.$executeRaw`UPDATE "Order" SET revision=revision WHERE id=${orderId}`;
 if(caseId)await tx.$queryRaw`SELECT id FROM "CollectionCase" WHERE id=${caseId} FOR UPDATE`;
 const bills=await tx.bill.findMany({where:{orderId},select:{id:true},orderBy:{id:'asc'}});for(const bill of bills)await tx.$queryRaw`SELECT id FROM "Bill" WHERE id=${bill.id} FOR UPDATE`;
}
