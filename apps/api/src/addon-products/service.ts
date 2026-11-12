import {z} from 'zod';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,hash,key,pagination,text} from '../common/data';
import {ensure} from '../common/errors';
import {kindInput,scopePricesInput,validateScopePrices,versionHash} from './policy';
const command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict();
const draft=command.extend({kind:kindInput,name:z.string().trim().min(1).max(200),scopePrices:scopePricesInput}).strict();
export async function lockAddonCatalog(tx:any){await tx.$queryRaw`SELECT pg_advisory_xact_lock(728190051)::text`;}
function overlapping(a:any[],b:any[]){return a.some(x=>b.some(y=>x.brand===y.brand&&(x.allModels||y.allModels||x.modelDefinitionIds.some((id:string)=>y.modelDefinitionIds.includes(id)))));}
async function checkScopes(tx:any,groups:any[]){
 const models=await tx.modelDefinition.findMany({select:{id:true,brand:true}});
 for(const g of groups)for(const s of g.scopes){ensure(models.some((m:any)=>m.brand===s.brand),409,'ADDON_BRAND','品牌须来自真实车型目录');for(const id of s.modelDefinitionIds)ensure(models.some((m:any)=>m.id===id&&m.brand===s.brand),409,'ADDON_MODEL','车型与品牌不符或不存在');}
 for(let i=0;i<groups.length;i++)for(let j=0;j<i;j++)ensure(!overlapping(groups[i].scopes,groups[j].scopes),409,'ADDON_AMBIGUOUS_PRICE','同一车型不可配置多组有效价格');
}
async function run(tx:any,actor:any,id:string,action:string,input:any,work:()=>Promise<any>){
 await requireCurrentStaff(tx,actor,'addon-products');await lockAddonCatalog(tx);
 const where={actorId_resourceId_action_key:{actorId:actor.id,resourceId:'addon:'+id,action,key:input.idempotencyKey}},requestHash=hash(input),old=await tx.productCommand.findUnique({where});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','相同请求编号不可修改内容');return old.resultSnapshot;}
 const result=JSON.parse(JSON.stringify(await work()));await tx.productCommand.create({data:{actorId:actor.id,resourceId:'addon:'+id,action,key:input.idempotencyKey,requestHash,resultSnapshot:result}});return result;
}
export class AddonProductsService{
 async list(tx:any,actor:any,query:any){await requireCurrentStaff(tx,actor,'addon-products',false);const p=pagination(query),where={...(query.kind?{kind:kindInput.parse(query.kind)}:{}),...(query.search?{name:{contains:String(query.search),mode:'insensitive'}}:{})};const [items,total]=await Promise.all([tx.addonProduct.findMany({where,skip:p.skip,take:p.take,orderBy:{createdAt:'desc'},include:{versions:{orderBy:{version:'desc'}}}}),tx.addonProduct.count({where})]);return{items,total,page:p.page,pageSize:p.pageSize};}
 async detail(tx:any,actor:any,id:string){await requireCurrentStaff(tx,actor,'addon-products',false);const p=await tx.addonProduct.findUnique({where:{id},include:{versions:{orderBy:{version:'desc'}}}});ensure(p,404,'NOT_FOUND','加购商品不存在');return p;}
 async save(tx:any,actor:any,raw:any,id?:string,versionId?:string){const input=draft.parse(raw);return run(tx,actor,versionId||id||'NEW',versionId?'UPDATE':'CREATE',input,async()=>{
  let p=id?await tx.addonProduct.findUnique({where:{id}}):null;ensure(!id||p,404,'NOT_FOUND','加购商品不存在');ensure(!p||p.kind===input.kind,409,'ADDON_KIND','商品种类不可修改');
  await checkScopes(tx,input.scopePrices);
  if(versionId){const v=await tx.addonProductVersion.findFirst({where:{id:versionId,productId:id}});ensure(v?.status==='DRAFT',409,'IMMUTABLE_PRODUCT_VERSION','仅草稿可修改，已发布版本请新建版本');const changed=await tx.addonProductVersion.updateMany({where:{id:versionId,revision:input.revision,status:'DRAFT'},data:{name:input.name,scopePrices:input.scopePrices,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','草稿已更新');await audit(tx,actor.id,'UPDATE','addon-products',id!,{versionId});return tx.addonProductVersion.findUnique({where:{id:versionId}});}
  if(p)ensure(p.revision===input.revision,409,'REVISION_CONFLICT','商品已更新');else{ensure(input.revision===0,409,'REVISION_CONFLICT','新商品版本须为0');p=await tx.addonProduct.create({data:{kind:input.kind,name:input.name,createdBy:actor.id}});}
  const last=await tx.addonProductVersion.findFirst({where:{productId:p.id},orderBy:{version:'desc'}});const changed=await tx.addonProduct.updateMany({where:{id:p.id,revision:input.revision},data:{revision:{increment:1},name:input.name}});ensure(changed.count===1,409,'REVISION_CONFLICT','商品已更新');const v=await tx.addonProductVersion.create({data:{productId:p.id,kind:input.kind,name:input.name,version:(last?.version||0)+1,scopePrices:input.scopePrices,createdBy:actor.id}});await audit(tx,actor.id,'CREATE_DRAFT','addon-products',p.id,{versionId:v.id});return{...v,productRevision:input.revision+1};
 });}
 async action(tx:any,actor:any,id:string,versionId:string,action:string,raw:any){const input=(action==='publish'?command:command.extend({reason:text})).parse(raw);return run(tx,actor,versionId,action,input,async()=>{
  const v=await tx.addonProductVersion.findFirst({where:{id:versionId,productId:id}});ensure(v,404,'NOT_FOUND','商品版本不存在');ensure(v.revision===input.revision,409,'REVISION_CONFLICT','商品版本已更新');
  const required:any={publish:['DRAFT'],suspend:['PUBLISHED'],resume:['SUSPENDED'],retire:['PUBLISHED','SUSPENDED']};ensure(required[action]?.includes(v.status),409,'ADDON_STATUS','当前商品状态不可执行该操作');
  if(action==='publish'||action==='resume'){
   const groups=validateScopePrices(v.kind,v.scopePrices);await checkScopes(tx,groups);
   const others=await tx.addonProductVersion.findMany({where:{kind:v.kind,status:'PUBLISHED',productId:{not:id}}});
   for(const other of others)for(const g of groups)for(const og of other.scopePrices)ensure(!overlapping(g.scopes,og.scopes),409,'ADDON_AMBIGUOUS_PRICE','已售商品存在重叠适用范围，请先暂停原报价');
   await tx.addonProductVersion.updateMany({where:{productId:id,status:{in:['PUBLISHED','SUSPENDED']},id:{not:versionId}},data:{status:'RETIRED',revision:{increment:1}}});
  }
  const status=action==='publish'||action==='resume'?'PUBLISHED':action==='suspend'?'SUSPENDED':'RETIRED';
  const changed=await tx.addonProductVersion.updateMany({where:{id:versionId,revision:input.revision,status:v.status},data:{status,revision:{increment:1},...(action==='publish'?{sourceHash:versionHash(v),publishedAt:new Date(),publishedBy:actor.id}:{})}});ensure(changed.count===1,409,'REVISION_CONFLICT','商品版本已更新');await tx.addonProduct.update({where:{id},data:{revision:{increment:1}}});await audit(tx,actor.id,action.toUpperCase(),'addon-products',id,{versionId,reason:(input as any).reason});return tx.addonProductVersion.findUnique({where:{id:versionId}});
 });}
}
