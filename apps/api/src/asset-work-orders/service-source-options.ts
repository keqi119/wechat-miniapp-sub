import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {serviceSourceSnapshot,iso} from './facts';
import {workId,workTimestamp} from './types';

const scope={vehicleId:workId,eventAt:workTimestamp};
export const serviceSourceDetailInput=z.object(scope).strict();
export const serviceSourceListInput=z.object({...scope,keyword:z.string().trim().max(200).refine(value=>!value.includes('\0')).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict().refine(value=>(value.page-1)*value.pageSize<=1000000,'分页偏移过大');
const selectable=['SUBMITTED','ACCEPTED','ASSIGNED','IN_PROGRESS','COMPLETED'];
const publicService=(row:any)=>({id:row.id,revision:row.revision,type:row.type,status:row.status,description:row.description,createdAt:iso(row.createdAt),orderId:row.orderId});
export async function requireServiceSourceAccess(tx:any,actor:StaffActor){const current=await requireCurrentStaff(tx,actor,'asset-work-orders',false);ensure(['ADMIN','OPERATIONS'].includes(current.role),403,'FORBIDDEN','仅管理员或运营可选择客户服务来源');await requireCurrentStaff(tx,actor,'services',false);}
/** A read-only source digest. Caller handles current permission and, on create, row locking. */
export async function readServiceSource(tx:any,id:string,vehicleId:string,eventAt:Date){
 const row=await tx.serviceRequest.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','来源客户服务不存在');ensure(selectable.includes(row.status),409,'SERVICE_SOURCE_UNAVAILABLE','来源客户服务已取消或状态不可核对，请重新选择');
 const snapshot=await serviceSourceSnapshot(tx,id,vehicleId,eventAt);
 const sourceHash=canonicalHash({version:1,service:{...publicService(row),location:row.location},assignment:snapshot});
 return{row,snapshot,sourceHash};
}
const invalidCandidate=(error:unknown)=>error instanceof HttpException&&error.getStatus()===409&&['SERVICE_SOURCE_UNVERIFIED','SERVICE_SOURCE_UNAVAILABLE'].includes((error.getResponse() as any)?.error?.code);
export class ServiceSourceOptionsService{
 async list(tx:any,actor:StaffActor,raw:unknown){
  await requireServiceSourceAccess(tx,actor);const input=serviceSourceListInput.parse(raw),eventAt=new Date(input.eventAt);
  ensure(await tx.vehicle.findUnique({where:{id:input.vehicleId},select:{id:true}}),404,'NOT_FOUND','车辆不存在');
  const assignments=await tx.vehicleAssignment.findMany({where:{vehicleId:input.vehicleId,startAt:{lte:eventAt},OR:[{endAt:null},{endAt:{gt:eventAt}}]},select:{orderId:true,customerId:true},orderBy:{id:'asc'}});
  const pairs=[...new Map(assignments.map((item:any)=>[item.orderId+':'+item.customerId,{orderId:item.orderId,customerId:item.customerId}])).values()];
  if(!pairs.length)return{items:[],total:0,page:input.page,pageSize:input.pageSize};
  const candidates=await tx.serviceRequest.findMany({where:{status:{in:selectable},AND:[{OR:pairs},...(input.keyword?[{OR:['id','description'].map(field=>({[field]:{contains:input.keyword,mode:'insensitive'}}))}]:[])]},orderBy:[{createdAt:'desc'},{id:'asc'}]});
  const valid:any[]=[];
  for(const row of candidates){try{const checked=await readServiceSource(tx,row.id,input.vehicleId,eventAt);valid.push(publicService(checked.row));}catch(error){if(!invalidCandidate(error))throw error;}}
  const offset=(input.page-1)*input.pageSize;return{items:valid.slice(offset,offset+input.pageSize),total:valid.length,page:input.page,pageSize:input.pageSize};
 }
 async detail(tx:any,actor:StaffActor,id:string,raw:unknown){
  await requireServiceSourceAccess(tx,actor);workId.parse(id);const input=serviceSourceDetailInput.parse(raw),value=await readServiceSource(tx,id,input.vehicleId,new Date(input.eventAt)),s=value.snapshot!;
  return{...publicService(value.row),location:value.row.location,sourceHash:value.sourceHash,assignment:{vehicleId:s.vehicleId,assignmentId:s.assignmentId,eventAt:s.eventAt,startAt:s.assignmentStartAt,endAt:s.assignmentEndAt}};
 }
}
