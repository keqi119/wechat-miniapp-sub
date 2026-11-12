import {z} from 'zod';
import {HttpException} from '@nestjs/common';
import {audit,key,text} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {productVersionInclude} from '../products/types';
import {catalogPlanSource} from '../catalog/app-display';
import {vehicleCommand} from './commands';
import {publicationReadiness} from './publish-readiness';
import {freezeBasicCondition} from './basic-condition-snapshot';

const commandInput=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key,reason:text.optional()}).strict();
async function facts(tx:any,id:string){
 const vehicle=await tx.vehicle.findUnique({where:{id}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');
 const listings=await tx.vehicleListing.findMany({where:{vehicleId:id},include:{productVersion:{include:productVersionInclude},subscriptionPlan:true}}),sources:any[]=[];
 for(const listing of listings){const plan={...listing.subscriptionPlan,listing,productVersion:listing.productVersion},source=catalogPlanSource(plan,vehicle).snapshot;if(source)sources.push({listingId:listing.id,listingRevision:listing.revision,planId:plan.id,sourceHash:source.sourceHash});}
 return{vehicle,sources};
}
async function readiness(tx:any,id:string){
 const [{vehicle,sources},original]=await Promise.all([facts(tx,id),publicationReadiness(tx,id)]),vehicleActivated=vehicle.status==='PUBLISHED',blockers=[];
 if(!vehicleActivated)blockers.push({code:'VEHICLE_NOT_ACTIVATED',message:'请先激活车辆，再上架商品'});
 if(vehicle.reservedOrderId||vehicle.holdId)blockers.push({code:'VEHICLE_RESERVED',message:'车辆已被订单占用或预留，当前不能上架商品'});
 if(!sources.length)blockers.push({code:'CATALOG_PLAN_REQUIRED',message:'请至少上架一个已确认、公开可见且来源有效的产品方案'});
 const value={...original,ready:original.ready&&blockers.length===0,catalogPublished:vehicle.catalogPublished===true,vehicleActivated,publishedPlanCount:sources.length,blockers};return{vehicle,sources,value};
}
export async function readVehicleCatalogReadiness(tx:any,actor:any,id:string){await requireCurrentStaff(tx,actor,'vehicles',false);await requireCurrentStaff(tx,actor,'goods',false);return(await readiness(tx,id)).value;}
/** The sole application command allowed to change the parent catalog switch. */
export async function setVehicleCatalogPublished(tx:any,actor:any,id:string,publish:boolean,raw:unknown){
 const input=commandInput.parse(raw);await requireCurrentStaff(tx,actor,'goods');
 return vehicleCommand(tx,actor,id,publish?'CATALOG_PUBLISH':'CATALOG_WITHDRAW',input,async()=>{
  if(publish)await tx.$queryRaw`SELECT id FROM "VehicleListing" WHERE "vehicleId"=${id} ORDER BY id FOR UPDATE`;
  const vehicle=await tx.vehicle.findUnique({where:{id}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');ensure((vehicle.catalogPublished===true)!==publish,409,'CATALOG_STATE',publish?'商品已上架':'商品已下架');let checked:any=null,sources:any[]=[],basicConditionSnapshot:any=null;
  if(publish){const result=await readiness(tx,id);checked=result.value;sources=result.sources;ensure(checked.vehicleActivated,409,'VEHICLE_NOT_ACTIVATED','请先激活车辆，再上架商品');ensure(!vehicle.reservedOrderId&&!vehicle.holdId,409,'VEHICLE_RESERVED','车辆已被订单占用或预留，当前不能上架商品');ensure(checked.publishedPlanCount>0,409,'CATALOG_PLAN_REQUIRED','请至少上架一个已确认、公开可见且来源有效的产品方案');if(!checked.ready)throw new HttpException({error:{code:'PUBLISH_REQUIREMENTS',message:'请先补齐商品发布所需资料',readiness:checked}},409);
   const condition=await tx.vehicleConditionAssessment.findUnique({where:{vehicleId:id}});ensure(condition?.vehicleId===id,409,'PUBLISH_REQUIREMENTS','请重新核对当前基本车况');basicConditionSnapshot=freezeBasicCondition(condition);
   for(const source of sources){const changed=await tx.vehicleListing.updateMany({where:{id:source.listingId,vehicleId:id,status:'PUBLISHED',visible:true,revision:source.listingRevision},data:{basicConditionSnapshot,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','产品方案已变化，请刷新后重新上架商品');}
  }
  const changed=await tx.vehicle.updateMany({where:{id,revision:input.revision,status:vehicle.status,catalogPublished:!publish},data:{catalogPublished:publish,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','车辆商品资料已变化，请刷新后核对');
  const result={id,vehicleId:id,revision:input.revision+1,status:vehicle.status,catalogPublished:publish};await audit(tx,actor.id,publish?'PUBLISH_VEHICLE_CATALOG':'WITHDRAW_VEHICLE_CATALOG','vehicles',id,{revision:result.revision,catalogPublishedBefore:!publish,catalogPublished:publish,reason:input.reason??null,...(checked?{publicationDate:checked.publicationDate,sources:sources.map(source=>({...source,listingRevisionAfter:source.listingRevision+1})),basicConditionSnapshot}:{})});return result;
 });
}
