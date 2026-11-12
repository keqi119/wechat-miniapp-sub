import {z} from 'zod';
import type {Db} from '../common/db';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';

const safeText=(value:string)=>!value.includes('\u0000');
const sourceId=z.string().trim().min(1).max(500).refine(safeText);
const sourceText=z.string().trim().min(1).max(64).refine(safeText);
export const customerSourceInput=z.object({sourceChannel:sourceText.nullable(),sourceRevision:z.number().int().min(0).max(2147483647),reason:z.string().trim().min(1).max(1000).refine(safeText),idempotencyKey:key.refine(safeText)}).strict();
const select={id:true,sourceChannel:true,sourceRevision:true};
function view(customer:any){return{customerId:customer.id,sourceChannel:customer.sourceChannel,sourceRevision:customer.sourceRevision};}
async function authorize(tx:any,actor:StaffActor,write=false){
 ensure(Number.isInteger(actor?.authVersion),403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 const current=await requireCurrentStaff(tx,actor,'customers',write);ensure(['ADMIN','OPERATIONS'].includes(current.role),403,'FORBIDDEN','客户来源仅管理员或运营可管理');
}
export async function customerSourceFilter(tx:any,actor:StaffActor,query:any){
 if(query.sourceChannel===undefined)return{};
 await authorize(tx,actor);return{sourceChannel:{contains:sourceText.parse(query.sourceChannel),mode:'insensitive'}};
}
export async function customerSourceTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  if(error?.code==='P2002'&&(error.meta?.modelName===undefined||error.meta.modelName==='ArchiveCommand')&&fields.length===4&&['actorId','resourceId','action','key'].every(field=>fields.includes(field)))return db.serial(operation);
  throw error;
 }
}
export class CustomerSourceService{
 async read(tx:any,actor:StaffActor,rawId:string){
  await authorize(tx,actor);const id=sourceId.parse(rawId),customer=await tx.customer.findUnique({where:{id},select});ensure(customer,404,'NOT_FOUND','客户不存在');return view(customer);
 }
 async save(tx:any,actor:StaffActor,rawId:string,raw:unknown){
  await authorize(tx,actor,true);const id=sourceId.parse(rawId),input=customerSourceInput.parse(raw);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-source:${actor.id}:${id}:${input.idempotencyKey}`},0))`;
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${id} FOR UPDATE`;
  return archiveCommand(tx,actor,`customer-source:${id}`,'SET_CUSTOMER_SOURCE',input,async()=>{
   const customer=await tx.customer.findUnique({where:{id},select});ensure(customer,404,'NOT_FOUND','客户不存在');ensure(customer.sourceRevision===input.sourceRevision,409,'REVISION_CONFLICT','客户来源已更新，请重新读取后核对');
   const changed=await tx.customer.updateMany({where:{id,sourceRevision:input.sourceRevision},data:{sourceChannel:input.sourceChannel,sourceRevision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','客户来源已更新，请重新读取后核对');
   const result=view(await tx.customer.findUnique({where:{id},select}));await audit(tx,actor.id,'SET_CUSTOMER_SOURCE','customers',id,{before:view(customer),after:result,reason:input.reason});return result;
  });
 }
}
