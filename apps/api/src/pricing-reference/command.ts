import {requireCurrentStaff} from '../auth/staff-session';
import type {StaffActor} from '../auth/staff.types';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
export async function pricingCommand(tx:any,actor:StaffActor,resourceId:string,action:string,input:any,operation:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'pricing-reference');
 const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId,action,key:input.idempotencyKey}},requestHash=hash(input),old=await tx.pricingReferenceCommand.findUnique({where});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不得修改内容');return old.resultSnapshot;}
 const resultSnapshot=JSON.parse(JSON.stringify(await operation()));
 await tx.pricingReferenceCommand.create({data:{actorId:actor.id,resourceId,action,key:input.idempotencyKey,requestHash,resultSnapshot}});return resultSnapshot;
}
export async function pricingTransaction<T>(db:any,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(e:any){
  // A concurrent reservation/version/adoption race restarts the entire snapshot.
  if(e.code==='P2002')return db.serial(operation);throw e;
 }
}
