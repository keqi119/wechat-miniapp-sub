import type {Db} from '../common/db';

/** Waiting for an Order lock does not refresh an already-established SERIALIZABLE snapshot. */
export async function fieldTaskTransaction<T>(db:Pick<Db,'serial'>,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await db.serial(operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  const sameBatch=error?.code==='P2002'&&error.meta?.modelName==='FieldHandoverTask'&&fields.length===2&&fields.includes('orderId')&&fields.includes('batchKey');
  if(sameBatch)return db.serial(operation);throw error;
 }
}
