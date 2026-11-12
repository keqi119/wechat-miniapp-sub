import {validTermMonths} from '../service-calendar/rules';
import { Injectable } from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,hash,key,pagination,text} from '../common/data';
import {ensure} from '../common/errors';
import {benefitInput,commandInput,draftCommandInput,productVersionInclude,ProductActor,ProductVersionView} from './types';
import {validatePublishedVersion,validateListingSource,versionSnapshot} from './snapshot';
import {productDraftData} from './configuration';
export function assertDraftMutable(version:any){ensure(version?.status==='DRAFT',409,'IMMUTABLE_PRODUCT_VERSION','已发布版本不可修改，请新建版本');}
export function validateCombination(version:any){validatePublishedVersion(version);ensure(version.vehicleIds.length+version.modelDefinitionIds.length>0,409,'PRODUCT_SCOPE_REQUIRED','发布前必须明确适用车辆或车型');}
export function legacyBenefit(name:string){return {name,description:name,provider:'待运营核对',conditions:'待运营核对',kind:'DESCRIPTION' as const,unit:null,totalQuantity:null,validity:'ORDER' as const};}
export async function productCommand(tx:any,actor:ProductActor,resourceId:string,action:string,input:any,operation:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'products');
 const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId,action,key:input.idempotencyKey}},requestHash=hash(input),old=await tx.productCommand.findUnique({where});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同幂等键不得修改内容');return old.resultSnapshot;}
 const value=await operation(),resultSnapshot=JSON.parse(JSON.stringify(value));await tx.productCommand.create({data:{actorId:actor.id,resourceId,action,key:input.idempotencyKey,requestHash,resultSnapshot}});return resultSnapshot;
}
const draftData=(input:any)=>{const {revision,idempotencyKey,...draft}=input;const data=productDraftData(draft);return draft.configurationVersion===2?data:{...data,baseFeeAmount:null,mileageMonthlyFeeAmount:null,swapPolicy:Prisma.DbNull};};
async function resolveItems(tx:any,items:any[]){
 const ids=items.filter(i=>i.kind==='BENEFIT').map(i=>i.benefitVersionId);ensure(new Set(ids).size===ids.length,400,'DUPLICATE_BENEFIT','产品权益不可重复');
 ensure(await tx.benefitDefinitionVersion.count({where:{id:{in:ids}}})===ids.length,409,'BENEFIT_VERSION_MISSING','权益版本不存在');
 return items.map((i,position)=>({...i,position}));
}
@Injectable()
export class ProductService {
 async list(tx:any,actor:ProductActor,query:any){
  await requireCurrentStaff(tx,actor,'products',false);const raw=query??{},p=pagination(raw);
  const filter=z.object({keyword:z.string().trim().max(200).refine(v=>!v.includes('\0')),latestStatus:z.enum(['DRAFT','PUBLISHED','SUSPENDED','RETIRED']).optional()}).parse({keyword:raw.keyword??raw.search??raw.q??'',latestStatus:raw.latestStatus});
  const where=filter.keyword?{name:{contains:filter.keyword,mode:'insensitive'}}:{};
  const orderBy=[{createdAt:'desc'},{id:'asc'}],include={versions:{orderBy:{version:'desc'}}};
  if(filter.latestStatus){
   // Select candidates using indexed relations, then inspect the actual latest
   // version before pagination. An older published version is not a latest-state match.
   const candidates=await tx.product.findMany({where:{...where,versions:{some:{status:filter.latestStatus}}},orderBy,include});
   const matching=candidates.filter((row:any)=>row.versions.reduce((latest:any,v:any)=>!latest||v.version>latest.version?v:latest,null)?.status===filter.latestStatus);
   return{items:matching.slice(p.skip,p.skip+p.take),total:matching.length,page:p.page,pageSize:p.pageSize};
  }
  const [items,total]=await Promise.all([tx.product.findMany({where,skip:p.skip,take:p.take,orderBy,include}),tx.product.count({where})]);return{items,total,page:p.page,pageSize:p.pageSize};
 }
 async detail(tx:any,actor:ProductActor,id:string){await requireCurrentStaff(tx,actor,'products',false);const product=await tx.product.findUnique({where:{id},include:{versions:{orderBy:{version:'desc'},include:productVersionInclude}}});ensure(product,404,'NOT_FOUND','产品不存在');return product;}
 async createDraft(tx:any,actor:ProductActor,raw:any,productId?:string){const input=draftCommandInput.parse(raw);return productCommand(tx,actor,productId||'NEW','CREATE_DRAFT',input,async()=>{
  let product=productId?await tx.product.findUnique({where:{id:productId}}):null;
  if(productId)ensure(product&&product.revision===input.revision,409,'REVISION_CONFLICT','产品已更新，请刷新');else ensure(input.revision===0,409,'REVISION_CONFLICT','新产品版本必须为0');
  const items=await resolveItems(tx,input.items);ensure(items.filter(i=>i.kind==='BASE_SUBSCRIPTION').length===1,400,'PRODUCT_COMBINATION_INVALID','产品必须恰好包含一个基础订阅');
  if(!product)product=await tx.product.create({data:{name:input.name,createdBy:actor.id}});
  const last=await tx.productVersion.findFirst({where:{productId:product.id},orderBy:{version:'desc'}});
  const changed=await tx.product.updateMany({where:{id:product.id,revision:input.revision},data:{revision:{increment:1},name:input.name}});ensure(changed.count===1,409,'REVISION_CONFLICT','产品已更新，请刷新');
  const version=await tx.productVersion.create({data:{...draftData(input),productId:product.id,version:(last?.version||0)+1,createdBy:actor.id,items:{create:items}},include:productVersionInclude});
  await audit(tx,actor.id,'CREATE_DRAFT','products',product.id,{productVersionId:version.id});return version;
 });}
 async updateDraft(tx:any,actor:ProductActor,versionId:string,raw:any){const input=draftCommandInput.parse(raw);return productCommand(tx,actor,versionId,'UPDATE_DRAFT',input,async()=>{
  const version=await tx.productVersion.findUnique({where:{id:versionId}});ensure(version,404,'NOT_FOUND','产品版本不存在');assertDraftMutable(version);
  ensure(validTermMonths(input.months,input.minimumTermMonths??version.minimumTermMonths),409,'PRODUCT_TERM_INVALID','实际期限不得小于已确认最短期限');
  const items=await resolveItems(tx,input.items);ensure(items.filter(i=>i.kind==='BASE_SUBSCRIPTION').length===1,400,'PRODUCT_COMBINATION_INVALID','产品必须恰好包含一个基础订阅');
  const changed=await tx.productVersion.updateMany({where:{id:versionId,status:'DRAFT',revision:input.revision},data:{...draftData(input),revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','草稿已更新');
  await tx.productCombinationItem.deleteMany({where:{productVersionId:versionId}});await tx.productCombinationItem.createMany({data:items.map(i=>({...i,productVersionId:versionId}))});
  await audit(tx,actor.id,'UPDATE_DRAFT','products',version.productId,{versionId});return tx.productVersion.findUnique({where:{id:versionId},include:productVersionInclude});
 });}
 async deleteDraft(tx:any,actor:ProductActor,versionId:string,raw:any,productId?:string){const input=commandInput.parse(raw);return productCommand(tx,actor,`${productId||""}/${versionId}`,'DELETE_DRAFT',input,async()=>{const version=await tx.productVersion.findUnique({where:{id:versionId}});ensure(version,404,'NOT_FOUND','产品版本不存在');ensure(!productId||version.productId===productId,404,'NOT_FOUND','产品版本不存在');assertDraftMutable(version);ensure(!await tx.subscriptionPlan.count({where:{productVersionId:versionId}}),409,'PRODUCT_DRAFT_REFERENCED','兼容套餐已关联此草稿，请编辑核对后发布');const changed=await tx.productVersion.deleteMany({where:{id:versionId,revision:input.revision,status:'DRAFT'}});ensure(changed.count===1,409,'REVISION_CONFLICT','草稿已更新');await audit(tx,actor.id,'DELETE_DRAFT','products',version.productId,{versionId});return {id:versionId,deleted:true};});}
 async publish(tx:any,actor:ProductActor,productId:string,raw:any):Promise<ProductVersionView>{const input=commandInput.extend({versionId:text}).strict().parse(raw);return productCommand(tx,actor,productId,'PUBLISH',input,async()=>{
  const version=await tx.productVersion.findFirst({where:{id:input.versionId,productId},include:productVersionInclude});ensure(version,404,'NOT_FOUND','产品版本不存在');assertDraftMutable(version);validateCombination(version);validatePublishedVersion(version,true);
  const vehicles=await tx.vehicle.findMany({where:{OR:[{id:{in:version.vehicleIds}},{modelDefinitionId:{in:version.modelDefinitionIds}}]},select:{id:true}});
  const [vehicleCount,modelCount]=await Promise.all([tx.vehicle.count({where:{id:{in:version.vehicleIds}}}),tx.modelDefinition.count({where:{id:{in:version.modelDefinitionIds}}})]);ensure(vehicleCount===version.vehicleIds.length&&modelCount===version.modelDefinitionIds.length&&vehicles.length,409,'PRODUCT_SCOPE_INVALID','适用车辆或车型不存在');
  const changed=await tx.productVersion.updateMany({where:{id:version.id,status:'DRAFT',revision:input.revision},data:{status:'PUBLISHED',revision:{increment:1},publishedBy:actor.id,publishedAt:new Date()}});ensure(changed.count===1,409,'REVISION_CONFLICT','产品版本已更新');
  // Warehouse publication does not authorize any vehicle/product combination for sale.
  // Compatibility plans are created inactive by GoodsService and activated explicitly.
  await audit(tx,actor.id,'PUBLISH','products',productId,{versionId:version.id,version:version.version});return tx.productVersion.findUnique({where:{id:version.id},include:productVersionInclude});
 });}
 async retire(tx:any,actor:ProductActor,versionId:string,raw:any):Promise<ProductVersionView>{const input=commandInput.extend({reason:text}).strict().parse(raw);return productCommand(tx,actor,versionId,'RETIRE',input,async()=>{
  const changed=await tx.productVersion.updateMany({where:{id:versionId,status:'PUBLISHED',revision:input.revision},data:{status:'RETIRED',revision:{increment:1},retiredBy:actor.id,retiredAt:new Date(),retirementReason:input.reason}});ensure(changed.count===1,409,'REVISION_CONFLICT','当前版本不能停用或已更新');
  await tx.subscriptionPlan.updateMany({where:{productVersionId:versionId},data:{active:false}});await audit(tx,actor.id,'RETIRE','products',versionId,{reason:input.reason});return tx.productVersion.findUnique({where:{id:versionId},include:productVersionInclude});
 });}
 async suspend(tx:any,actor:ProductActor,versionId:string,raw:any):Promise<ProductVersionView>{const input=commandInput.extend({reason:text}).strict().parse(raw);return productCommand(tx,actor,versionId,'SUSPEND',input,async()=>{
  const changed=await tx.productVersion.updateMany({where:{id:versionId,status:'PUBLISHED',revision:input.revision},data:{status:'SUSPENDED',revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','当前版本不能暂停或已更新');
  await tx.subscriptionPlan.updateMany({where:{productVersionId:versionId},data:{active:false}});await audit(tx,actor.id,'SUSPEND','products',versionId,{reason:input.reason});return tx.productVersion.findUnique({where:{id:versionId},include:productVersionInclude});
 });}
 async resume(tx:any,actor:ProductActor,versionId:string,raw:any):Promise<ProductVersionView>{const input=commandInput.extend({reason:text}).strict().parse(raw);return productCommand(tx,actor,versionId,'RESUME',input,async()=>{
  const version=await tx.productVersion.findUnique({where:{id:versionId},include:productVersionInclude});ensure(version,404,'NOT_FOUND','产品版本不存在');ensure(version.status==='SUSPENDED',409,'PRODUCT_NOT_SUSPENDED','仅可重新启用已暂停的版本');ensure(version.revision===input.revision,409,'REVISION_CONFLICT','产品版本已更新');validateCombination(version);
  const plans=await tx.subscriptionPlan.findMany({where:{productVersionId:versionId,listing:{status:'PUBLISHED'}},include:{listing:true,vehicle:true}});
  for(const plan of plans)if(plan.listing?.status==='PUBLISHED')validateListingSource(plan.listing,{...version,status:'PUBLISHED'},plan.vehicle,plan);
  const changed=await tx.productVersion.updateMany({where:{id:versionId,status:'SUSPENDED',revision:input.revision},data:{status:'PUBLISHED',revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','产品版本已更新');
  await tx.subscriptionPlan.updateMany({where:{productVersionId:versionId,listing:{status:'PUBLISHED'}},data:{active:true}});await audit(tx,actor.id,'RESUME','products',versionId,{reason:input.reason});return tx.productVersion.findUnique({where:{id:versionId},include:productVersionInclude});
 });}
 async benefits(tx:any,actor:ProductActor){await requireCurrentStaff(tx,actor,'products',false);const items=await tx.benefitDefinition.findMany({include:{versions:{orderBy:{version:'desc'}}},orderBy:{createdAt:'desc'}});return {items,total:items.length};}
 async createBenefitVersion(tx:any,actor:ProductActor,raw:any,definitionId?:string){const input=z.object({benefit:benefitInput,revision:z.number().int().nonnegative(),idempotencyKey:key}).strict().parse(raw);return productCommand(tx,actor,definitionId||'NEW_BENEFIT','BENEFIT_VERSION',input,async()=>{
  const last=definitionId?await tx.benefitDefinitionVersion.findFirst({where:{definitionId},orderBy:{version:'desc'}}):null;ensure(input.revision===(last?.version||0),409,'REVISION_CONFLICT','权益版本已更新');
  if(input.benefit.kind==='COUNT')ensure(!/里程|换车/.test(input.benefit.name),400,'EXISTING_ENTITLEMENT_REQUIRED','里程和换车额度须使用既有账本');
  const definition=definitionId?await tx.benefitDefinition.findUnique({where:{id:definitionId}}):await tx.benefitDefinition.create({data:{name:input.benefit.name,createdBy:actor.id}});ensure(definition,404,'NOT_FOUND','权益定义不存在');
  const result=await tx.benefitDefinitionVersion.create({data:{definitionId:definition.id,version:(last?.version||0)+1,...input.benefit,createdBy:actor.id}});await audit(tx,actor.id,'CREATE_BENEFIT_VERSION','products',definition.id,{versionId:result.id});return result;
 });}
}
// Deterministic IDs keep each legacy per-vehicle plan separate; values are preserved for review,
// even when they fail the current publication policy. No historical text becomes count credit.
export function legacyProductDraft(plan:any){return {
 productId:`legacy-plan-${plan.id}`,
 version:{id:`legacy-plan-version-${plan.id}`,version:1,status:'DRAFT',revision:0,name:plan.name,months:plan.months,monthlyFeeAmount:plan.monthlyFeeAmount,mileagePerMonthKm:plan.mileagePerMonthKm,excessMileagePriceAmount:plan.excessMileagePriceAmount,energyDescription:plan.energyDescription,conditions:plan.conditions,vehicleIds:[plan.vehicleId],modelDefinitionIds:[]},
 benefits:plan.benefits.map((name:string)=>legacyBenefit(name))
};}
// Called only by the main migration transaction, never from public/admin request handlers.
export async function migrateLegacyProducts(tx:any){
 const plans=await tx.subscriptionPlan.findMany({where:{productVersionId:null},orderBy:{id:'asc'}});let migrated=0;
 for(const plan of plans){const draft=legacyProductDraft(plan),items:any[]=[{kind:'BASE_SUBSCRIPTION',position:0}];
  for(let position=0;position<draft.benefits.length;position++){const benefit=draft.benefits[position],id=`legacy-benefit-${plan.id}-${position}`;await tx.benefitDefinition.create({data:{id,name:benefit.name,createdBy:'SYSTEM_MIGRATION',versions:{create:{id:`${id}-v1`,version:1,...benefit,createdBy:'SYSTEM_MIGRATION'}}}});items.push({kind:'BENEFIT',position:position+1,benefitVersionId:`${id}-v1`});}
  await tx.product.create({data:{id:draft.productId,name:plan.name,createdBy:'SYSTEM_MIGRATION',versions:{create:{...draft.version,createdBy:'SYSTEM_MIGRATION',items:{create:items}}}}});
  await tx.subscriptionPlan.update({where:{id:plan.id},data:{productVersionId:draft.version.id,active:false}});await audit(tx,'SYSTEM_MIGRATION','MIGRATE_LEGACY_PRODUCT','products',draft.productId,{subscriptionPlanId:plan.id,requiresReview:true},'SYSTEM');migrated++;
 }
 return {migrated};
}

