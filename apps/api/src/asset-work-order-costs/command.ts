import {ensure} from '../common/errors';
import {costId} from './types';
import type {Db} from '../common/db';
import {assetTransaction} from '../asset-costs/command';
export {assetCommand as workCostCommand} from '../asset-costs/command';
export async function workCostTransaction<T>(db:Db,operation:(tx:any)=>Promise<T>):Promise<T>{
 try{return await assetTransaction(db,operation);}catch(error:any){
  const fields=Array.isArray(error?.meta?.target)?error.meta.target:[];
  if(error?.code==='P2002'&&error?.meta?.modelName==='AssetWorkOrderCost'&&fields.length===1&&fields[0]==='replacesCostId')return db.serial(operation);
  throw error;
 }
}
export async function readWork(tx:any,id:string){costId.parse(id);const row=await tx.assetWorkOrder.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','内部工单不存在');return row;}
export async function readWorkCost(tx:any,id:string){costId.parse(id);const row=await tx.assetWorkOrderCost.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','工单费用来源不存在');return row;}
export function sameRevision(row:any,revision:number){ensure(row.revision===revision,409,'REVISION_CONFLICT','资料已变化，请刷新');ensure(revision<2147483647,409,'REVISION_LIMIT','资料版本已达上限');}
