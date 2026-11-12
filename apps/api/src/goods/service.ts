import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {canonicalHash} from '../customers/types';
import {productVersionInclude,ProductActor,ProductSnapshot} from '../products/types';
import {productApplies,validatePublishedVersion,versionSnapshot,validateListingSource} from '../products/snapshot';
import {createGoodsInput,updateGoodsInput,goodsCommandInput,goodsListInput,goodsPresentationInput} from './types';
import {goodsAppPreview} from './presentation';
import {buildInspectionSnapshots,readInspectionSnapshots} from '../vehicle-inspections/service';
import {requirePublicationReady} from '../vehicles/publish-readiness';
import {publicBasicCondition} from '../vehicles/basic-condition-snapshot';
import {catalogAppDisplay} from '../catalog/app-display';

const include={vehicle:true,productVersion:{include:productVersionInclude},subscriptionPlan:true};
const pick=(value:any,keys:string[])=>Object.fromEntries(keys.map(key=>[key,value?.[key]??null]));
export function goodsView(value:any){
 const snapshots=readInspectionSnapshots(value.inspectionSnapshots,value.vehicleId);
 return{...pick(value,['id','vehicleId','productVersionId','subscriptionPlanId','revision','status','visible','recommended','sortOrder','source','productSourceHash','createdAt','updatedAt','publishedAt','withdrawnAt']),
  basicCondition:publicBasicCondition(value.basicConditionSnapshot,value.vehicleId),inspectionSelections:snapshots.map(s=>({id:s.sourceId,revision:s.sourceRevision})),inspectionSnapshots:snapshots.map(s=>({...s,images:s.images.map(f=>({...f,url:`/api/admin/vehicles/${encodeURIComponent(value.vehicleId)}/inspection-files/${encodeURIComponent(f.fileId)}`}))})),
  vehicle:pick(value.vehicle,['id','title','brand','model','year','vin','plateNumber','status','catalogPublished','modelDefinitionId']),
  productVersion:pick(value.productVersion,['id','productId','version','name','status']),
  plan:pick(value.subscriptionPlan,['id','name','months','monthlyFeeAmount','mileagePerMonthKm','excessMileagePriceAmount','energyDescription','conditions','benefits'])};
}
async function appGoodsView(tx:any,value:any,at=new Date()){
 const plan={...value.subscriptionPlan,listing:value,productVersion:value.productVersion};
 return{...goodsView(value),appDisplay:await catalogAppDisplay(tx,plan,value.vehicle,at)};
}
function planProjection(s:ProductSnapshot){return{name:s.name,months:s.months,monthlyFeeAmount:s.monthlyFeeAmount,mileagePerMonthKm:s.mileagePerMonthKm,excessMileagePriceAmount:s.excessMileagePriceAmount,energyDescription:s.energyDescription,conditions:s.conditions,benefits:s.benefits.map(b=>b.name)};}
async function command(tx:any,actor:ProductActor,id:string,action:string,input:any,operation:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'goods');
 const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId:`goods:${id}`,action:`GOODS_${action}`,key:input.idempotencyKey}},requestHash=hash(input);
 const prior=await tx.productCommand.findUnique({where});
 if(prior){ensure(prior.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不得修改内容');return prior.resultSnapshot;}
 const result=await operation(),resultSnapshot=JSON.parse(JSON.stringify(result));
 await tx.productCommand.create({data:{...where.actorId_resourceId_action_key,requestHash,resultSnapshot}});return resultSnapshot;
}
async function read(tx:any,id:string){const value=await tx.vehicleListing.findUnique({where:{id},include});ensure(value,404,'NOT_FOUND','商品不存在');return value;}
async function change(tx:any,id:string,revision:number,status:string,data:any){
 const changed=await tx.vehicleListing.updateMany({where:{id,revision,status},data:{...data,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','商品已更新，请刷新后重试');
}
export class GoodsService {
 async list(tx:any,actor:ProductActor,query:any){
  await requireCurrentStaff(tx,actor,'goods',false);
  const input=goodsListInput.parse({keyword:query.keyword??query.q??'',...(query.vehicleId!==undefined?{vehicleId:query.vehicleId}:{}),...(query.status?{status:query.status}:{}),...(query.page!==undefined?{page:query.page}:{}),...(query.pageSize!==undefined?{pageSize:query.pageSize}:{})});
  const where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.status?{status:input.status}:{}),...(input.keyword?{OR:[{id:{contains:input.keyword}},{vehicle:{title:{contains:input.keyword}}},{vehicle:{vin:{contains:input.keyword}}},{vehicle:{plateNumber:{contains:input.keyword}}},{productVersion:{name:{contains:input.keyword}}}]}:{})};
  const[rows,total]=await Promise.all([tx.vehicleListing.findMany({where,include,skip:(input.page-1)*input.pageSize,take:input.pageSize,orderBy:[{sortOrder:'asc'},{createdAt:'desc'},{id:'asc'}]}),tx.vehicleListing.count({where})]);
  const at=new Date();return{items:await Promise.all(rows.map((row:any)=>appGoodsView(tx,row,at))),total,page:input.page,pageSize:input.pageSize};
 }
 async detail(tx:any,actor:ProductActor,id:string){await requireCurrentStaff(tx,actor,'goods',false);return appGoodsView(tx,await read(tx,id));}
 async appPreview(tx:any,actor:ProductActor,id:string,at=new Date()){await requireCurrentStaff(tx,actor,'goods',false);return goodsAppPreview(tx,await read(tx,id),at);}
 async updatePresentation(tx:any,actor:ProductActor,id:string,raw:unknown){
  const input=goodsPresentationInput.parse(raw);
  // Shared vehicle materials require current vehicle write permission, including receipt replay.
  await requireCurrentStaff(tx,actor,'vehicles');
  return command(tx,actor,id,'PRESENTATION',input,async()=>{
   const initial=await read(tx,id);await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.vehicleId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "VehicleListing" WHERE id=${id} FOR UPDATE`;
   const row=await read(tx,id);ensure(row.vehicleId===initial.vehicleId&&row.revision===input.revision&&row.vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆或商品已变化，请刷新后核对');
   ensure(['DRAFT','PUBLISHED','WITHDRAWN'].includes(row.status),409,'GOODS_STATE','商品当前不可编辑');
   ensure(!row.vehicle.reservedOrderId&&!row.vehicle.holdId&&!['RESERVED','IN_USE'].includes(row.vehicle.status),409,'VEHICLE_RESERVED','订单占用中的车辆不可修改商业资料');
   const fields={title:input.title,description:input.description,conditionDisclosure:input.conditionDisclosure},before=pick(row.vehicle,Object.keys(fields));
   const changed=await tx.vehicle.updateMany({where:{id:row.vehicleId,revision:input.vehicleRevision},data:{...fields,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','车辆资料已更新，请刷新后核对');
   await change(tx,id,input.revision,row.status,{});
   await audit(tx,actor.id,'UPDATE_GOODS_PRESENTATION','goods',id,{vehicleId:row.vehicleId,vehicleRevision:input.vehicleRevision+1,listingRevision:input.revision+1,sharedAcrossVehicleGoods:true,before,after:fields});
   return{listingId:id,listingRevision:input.revision+1,vehicleId:row.vehicleId,vehicleRevision:input.vehicleRevision+1,materials:fields};
  });
 }
 async create(tx:any,actor:ProductActor,raw:unknown){const input=createGoodsInput.parse(raw);return command(tx,actor,'NEW','CREATE',input,async()=>{
  ensure(!await tx.vehicleListing.findUnique({where:{vehicleId_productVersionId:{vehicleId:input.vehicleId,productVersionId:input.productVersionId}}}),409,'GOODS_ALREADY_EXISTS','该车辆与产品版本已有商品，请使用原商品');
  const[vehicle,version]=await Promise.all([tx.vehicle.findUnique({where:{id:input.vehicleId}}),tx.productVersion.findUnique({where:{id:input.productVersionId},include:productVersionInclude})]);
  ensure(vehicle,404,'NOT_FOUND','车辆不存在');ensure(version?.status==='PUBLISHED',409,'PRODUCT_UNAVAILABLE','请先发布产品仓库版本');
  ensure(!vehicle.virtualAcceptanceScopeId,409,'VIRTUAL_PUBLICATION_FORBIDDEN','虚拟验收资产不得建立普通商品');
  ensure(productApplies(version,vehicle),409,'PRODUCT_SCOPE_MISMATCH','车辆不在产品适用范围');validatePublishedVersion(version);const snapshot=versionSnapshot(version);
  const plan=await tx.subscriptionPlan.create({data:{vehicleId:vehicle.id,productVersionId:version.id,...planProjection(snapshot),active:false}});
  const row=await tx.vehicleListing.create({data:{vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id,revision:0,status:'DRAFT',source:'EXPLICIT',visible:input.visible,recommended:input.recommended,sortOrder:input.sortOrder,productSourceHash:canonicalHash(snapshot),snapshot,createdBy:actor.id},include});
  await audit(tx,actor.id,'CREATE_GOODS','goods',row.id,{vehicleId:vehicle.id,productVersionId:version.id,subscriptionPlanId:plan.id});return appGoodsView(tx,row);
 });}
 async update(tx:any,actor:ProductActor,id:string,raw:unknown){const input=updateGoodsInput.parse(raw);return command(tx,actor,id,'UPDATE',input,async()=>{
  const initial=await read(tx,id);await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.vehicleId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "VehicleListing" WHERE id=${id} FOR UPDATE`;
  const row=await read(tx,id);ensure(row.vehicleId===initial.vehicleId,409,'REVISION_CONFLICT','产品方案车辆归属已变化');ensure(['DRAFT','PUBLISHED','WITHDRAWN'].includes(row.status),409,'GOODS_STATE','产品方案状态不可编辑');
  const data:any=Object.fromEntries(['visible','recommended','sortOrder'].filter(k=>Object.hasOwn(input,k)).map(k=>[k,(input as any)[k]]));
  if(row.vehicle.catalogPublished===true&&row.status==='PUBLISHED'&&row.visible===false&&input.visible===true){ensure(!row.vehicle.reservedOrderId&&!row.vehicle.holdId&&!['RESERVED','IN_USE'].includes(row.vehicle.status),409,'VEHICLE_RESERVED','车辆已被订单占用');validateListingSource(row,row.productVersion,row.vehicle,row.subscriptionPlan);const {basicConditionSnapshot}=await requirePublicationReady(tx,row.vehicleId,id);data.basicConditionSnapshot=basicConditionSnapshot;}
  if(input.inspectionSelections!==undefined)data.inspectionSnapshots=await buildInspectionSnapshots(tx,row.vehicleId,input.inspectionSelections);
  await change(tx,id,input.revision,row.status,data);const{inspectionSnapshots,...display}=data;await audit(tx,actor.id,'UPDATE_GOODS','goods',id,{revision:input.revision+1,...display,...(inspectionSnapshots?{inspectionSelections:input.inspectionSelections,inspectionHash:canonicalHash(inspectionSnapshots)}:{})});return appGoodsView(tx,await read(tx,id));
 });}
 async publish(tx:any,actor:ProductActor,id:string,raw:unknown){const input=goodsCommandInput.parse(raw);return command(tx,actor,id,'PUBLISH',input,async()=>{
  const initial=await read(tx,id);await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${initial.vehicleId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "VehicleListing" WHERE id=${id} FOR UPDATE`;
  const row=await read(tx,id);ensure(row.vehicleId===initial.vehicleId,409,'REVISION_CONFLICT','产品方案车辆归属已变化');ensure(['DRAFT','WITHDRAWN'].includes(row.status),409,'GOODS_STATE','产品方案当前不能上架');ensure(!row.vehicle.reservedOrderId&&!row.vehicle.holdId&&!['RESERVED','IN_USE'].includes(row.vehicle.status),409,'VEHICLE_RESERVED','车辆已被订单占用');validateListingSource(row,row.productVersion,row.vehicle,row.subscriptionPlan);
  const publication=row.vehicle.catalogPublished===true&&row.visible===true?await requirePublicationReady(tx,row.vehicleId,id):null;
  await change(tx,id,input.revision,row.status,{status:'PUBLISHED',publishedBy:actor.id,publishedAt:new Date(),...(publication?{basicConditionSnapshot:publication.basicConditionSnapshot}:{})});
  const plan=await tx.subscriptionPlan.updateMany({where:{id:row.subscriptionPlanId,vehicleId:row.vehicleId,productVersionId:row.productVersionId},data:{active:true}});ensure(plan.count===1,409,'GOODS_SOURCE_MISMATCH','商品套餐关联已变化');
  await audit(tx,actor.id,'PUBLISH_GOODS','goods',id,{revision:input.revision+1,productSourceHash:row.productSourceHash,...(publication?{basicConditionSnapshot:publication.basicConditionSnapshot}:{})});return appGoodsView(tx,await read(tx,id));
 });}
 async withdraw(tx:any,actor:ProductActor,id:string,raw:unknown){const input=goodsCommandInput.parse(raw);return command(tx,actor,id,'WITHDRAW',input,async()=>{
  const row=await read(tx,id);ensure(row.status==='PUBLISHED',409,'GOODS_STATE','仅已上架产品方案可下架');
  ensure(row.subscriptionPlan?.id===row.subscriptionPlanId&&row.subscriptionPlan.vehicleId===row.vehicleId&&row.subscriptionPlan.productVersionId===row.productVersionId,409,'GOODS_SOURCE_MISMATCH','商品套餐关联已变化');
  await change(tx,id,input.revision,row.status,{status:'WITHDRAWN',withdrawnBy:actor.id,withdrawnAt:new Date()});
  await tx.subscriptionPlan.updateMany({where:{id:row.subscriptionPlanId,vehicleId:row.vehicleId,productVersionId:row.productVersionId},data:{active:false}});
  await audit(tx,actor.id,'WITHDRAW_GOODS','goods',id,{revision:input.revision+1,reason:input.reason||''});return appGoodsView(tx,await read(tx,id));
 });}
}
