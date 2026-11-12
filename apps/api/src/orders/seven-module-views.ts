import {Controller,Get,Inject,Param,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {requirePartnerReadAccess} from '../partners/portal-session';
import {coverageAt} from '../insurance/coverage';
import {activatedStatus,effectivePolicyVersion,validRegistration} from '../insurance/registration-facts';

type PolicyVersionFact={id:string;version:number;status:string;changeKind:string;effectiveAt:Date;startAt:Date;endAt:Date;vehicleIds:string[];coverageItems:unknown;insurerSnapshot?:string|null;policyNumberSnapshot?:string|null};
type PolicyFact={id:string;insurer:string;policyNumber:string;versions:PolicyVersionFact[]};
export type PolicySummary={policyId:string;versionId:string;insurer:string;policyNumberLast4:string;vehicleIds:string[];status:'ACTIVE'|'NOT_STARTED'|'EXPIRED'|'CANCELLED';statusText:string;startAt:string;endAt:string;coverage:{code:string;label:string}[]};
const statusLabels={ACTIVE:'保障期内',NOT_STARTED:'尚未生效',EXPIRED:'已到期',CANCELLED:'已退保'};
const queryInput=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),vehicleId:z.string().trim().min(1).max(128).optional()}).strict();
const vehicleLabels:Record<string,string>={DRAFT:'待上架',PUBLISHED:'可订阅',RESERVED:'已预订',IN_USE:'使用中',UNPUBLISHED:'未上架'};
export function policySummaries(policies:PolicyFact[],vehicleIds:string[],at:Date):PolicySummary[]{
 const allowed=new Set(vehicleIds),result:PolicySummary[]=[];
 for(const policy of policies){
  const approved=policy.versions.filter(v=>activatedStatus(v.status)&&[v.effectiveAt,v.startAt,v.endAt].every(d=>d instanceof Date&&Number.isFinite(d.getTime()))),current=effectivePolicyVersion(approved,at)||approved.filter(v=>v.effectiveAt>at).sort((a,b)=>a.effectiveAt.getTime()-b.effectiveAt.getTime()||b.version-a.version)[0];
  if(current?.status==='REGISTERED'&&!validRegistration(current))continue;
  if(!current)continue;const visible=current.vehicleIds.filter(id=>allowed.has(id));if(!visible.length)continue;
  const status:PolicySummary['status']=current.effectiveAt>at||current.startAt>at?'NOT_STARTED':current.changeKind==='CANCELLATION'?'CANCELLED':current.endAt<=at?'EXPIRED':'ACTIVE';
  const coverage=Array.isArray(current.coverageItems)?current.coverageItems.flatMap(item=>item&&typeof item==='object'&&typeof item.code==='string'&&typeof item.label==='string'?[{code:item.code,label:item.label}]:[]):[];
  result.push({policyId:policy.id,versionId:current.id,insurer:current.insurerSnapshot??policy.insurer,policyNumberLast4:(current.policyNumberSnapshot??policy.policyNumber).slice(-4),vehicleIds:visible,status,statusText:statusLabels[status],startAt:current.startAt.toISOString(),endAt:current.endAt.toISOString(),coverage});
 }
 return result;
}
async function policyRows(tx:any,vehicleIds:string[],at:Date){
 if(!vehicleIds.length)return[];
 const policies=await tx.insurancePolicy.findMany({where:{versions:{some:{vehicleIds:{hasSome:vehicleIds}}}},include:{versions:true},take:501,orderBy:{createdAt:'desc'}});
 ensure(policies.length<=500,409,'INSURANCE_SCOPE_TOO_LARGE','请按单辆车辆查看保单摘要');return policySummaries(policies,vehicleIds,at);
}
const approvedBinding=(ownerId:string)=>({ownerId,status:'APPROVED',reviewedBy:{not:null},reviewedAt:{not:null}});
async function legacyBindingScope(tx:any,ownerId:string,vehicleId?:string){
 const candidates=await tx.ownerVehicle.findMany({where:{...approvedBinding(ownerId),...(vehicleId?{vehicleId}:{})},select:{vehicleId:true}});
 // Any simple marker retires the old realtime ownership projection. Stopped or
 // removed simple assignments must not reactivate a retained APPROVED row.
 const markers=await tx.partnerAgreementVehicle.findMany({where:{vehicleId:{in:candidates.map((row:any)=>row.vehicleId)}},select:{vehicleId:true}});
 return{...approvedBinding(ownerId),vehicleId:{notIn:markers.map((row:any)=>row.vehicleId),...(vehicleId?{equals:vehicleId}:{})}};
}
@Controller()
export class SevenModuleViewsController{
 constructor(@Inject(Db)private db:Db){}
 @Get('customer/orders/:id/insurance-summary')customerInsurance(@Param('id')id:string,@Req()r:any){return this.db.serial(async tx=>{
  const order=await tx.order.findFirst({where:{id,customerId:r.customer.id},include:{vehicle:{select:{id:true,title:true}}}});ensure(order,404,'NOT_FOUND','订单不存在');
  const assignment=order.currentAssignmentId?await tx.vehicleAssignment.findFirst({where:{id:order.currentAssignmentId,orderId:id,customerId:r.customer.id,status:'ACTIVE'},include:{vehicle:{select:{id:true,title:true}}}}):null;
  const vehicle=order.currentAssignmentId?assignment?.vehicle||null:order.vehicle;
  let snapshot=order.finalPlanSnapshot as Record<string,any>;
  if(order.effectiveTermsVersionId){const version=await tx.orderTermsVersion.findFirst({where:{id:order.effectiveTermsVersionId,orderId:id},select:{snapshot:true}});ensure(version,409,'TERMS_MISSING','当前有效条款缺失');snapshot=version.snapshot as Record<string,any>;}
  const productVersionId=snapshot?.productSnapshot?.productVersionId,at=new Date(),state=vehicle&&typeof productVersionId==='string'?await coverageAt(tx,vehicle.id,productVersionId,at):{ready:false,blockers:[{code:'INSURANCE_RECHECK_REQUIRED',label:'请联系平台核对本单保障资料'}]};
  return{orderId:id,vehicle,coverage:{ready:state.ready,statusText:state.ready?'当前保障已核验':'保障资料待核对',blockers:state.blockers.map(b=>({code:b.code,label:b.label}))},policies:vehicle?await policyRows(tx,[vehicle.id],at):[]};
 });}
 @Get('owner-h5/owners/:id/vehicles')ownerVehicles(@Param('id')id:string,@Query()query:unknown,@Req()r:any){const input=queryInput.parse(query);return this.db.serial(async tx=>{
  await requirePartnerReadAccess(tx,r.partnerPortalSession,id);const where=await legacyBindingScope(tx,id,input.vehicleId);
  const [bindings,total]=await Promise.all([tx.ownerVehicle.findMany({where,include:{vehicle:{select:{id:true,title:true,brand:true,model:true,plateNumber:true,status:true}}},skip:(input.page-1)*input.pageSize,take:input.pageSize,orderBy:{createdAt:'desc'}}),tx.ownerVehicle.count({where})]);
  return{items:bindings.map(b=>({...b.vehicle,statusText:vehicleLabels[b.vehicle.status]||'待核对'})),total,page:input.page,pageSize:input.pageSize};
 });}
 @Get('owner-h5/owners/:id/policies')ownerPolicies(@Param('id')id:string,@Query()query:unknown,@Req()r:any){const input=queryInput.parse(query);return this.db.serial(async tx=>{
  await requirePartnerReadAccess(tx,r.partnerPortalSession,id);const bindings=await tx.ownerVehicle.findMany({where:await legacyBindingScope(tx,id,input.vehicleId),select:{vehicleId:true},take:1001});
  ensure(!input.vehicleId||bindings.length===1,404,'NOT_FOUND','该合作商名下车辆不存在');ensure(bindings.length<=1000,409,'INSURANCE_SCOPE_TOO_LARGE','请按单辆车辆查看保单摘要');
  const all=await policyRows(tx,bindings.map(b=>b.vehicleId),new Date());return{items:all.slice((input.page-1)*input.pageSize,input.page*input.pageSize),total:all.length,page:input.page,pageSize:input.pageSize};
 });}
}
