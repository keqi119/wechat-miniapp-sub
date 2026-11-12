import {Injectable} from '@nestjs/common';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,hash,pagination} from '../common/data';
import {ensure} from '../common/errors';
import {ProductService} from '../products/service';
import {commandInput,previewInput,runInput} from './types';
import {pricingCommand} from './command';
import {assemble} from './assembly';
import {listParameters,writeParameter,ParameterKind} from './parameters';
@Injectable()
export class PricingReferenceService {
 constructor(private readonly products=new ProductService(),private readonly clock=()=>new Date()){}
 listParameters(tx:any,actor:any,kind:ParameterKind,query:any){return listParameters(tx,actor,kind,query);}
 writeParameter(tx:any,actor:any,kind:ParameterKind,raw:any){return writeParameter(tx,actor,kind,raw);}
 async preview(tx:any,actor:any,raw:any){await requireCurrentStaff(tx,actor,'pricing-reference',false);return assemble(tx,previewInput.parse(raw),this.clock().toISOString());}
 async createRun(tx:any,actor:any,raw:any){const parsed=runInput.parse(raw);return pricingCommand(tx,actor,'NEW_RUN','CREATE_RUN',parsed,async()=>{
  const {revision,idempotencyKey,recalculatedFromId,...request}=parsed;
  if(recalculatedFromId)ensure(await tx.pricingReferenceRun.count({where:{id:recalculatedFromId}}),404,'NOT_FOUND','原测算记录不存在');
  const snapshot=await assemble(tx,request,this.clock().toISOString()),row=await tx.pricingReferenceRun.create({data:{scenarioVersionId:parsed.scenarioVersionId,recalculatedFromId:recalculatedFromId??null,snapshot,createdBy:actor.id},include:{adoptions:true}});
  await audit(tx,actor.id,'CREATE_RUN','pricing-reference',row.id,{scenarioVersionId:parsed.scenarioVersionId});return row;
 });}
 async runs(tx:any,actor:any,query:any={}){await requireCurrentStaff(tx,actor,'pricing-reference',false);const p=pagination(query),[items,total]=await Promise.all([tx.pricingReferenceRun.findMany({orderBy:{createdAt:'desc'},skip:p.skip,take:p.take,include:{adoptions:true}}),tx.pricingReferenceRun.count()]);return {items,total,page:p.page,pageSize:p.pageSize};}
 async run(tx:any,actor:any,id:string){await requireCurrentStaff(tx,actor,'pricing-reference',false);const row=await tx.pricingReferenceRun.findUnique({where:{id},include:{adoptions:true}});ensure(row,404,'NOT_FOUND','测算记录不存在');return row;}
 async adopt(tx:any,actor:any,id:string,groupKey:string,raw:any){const input=commandInput.parse(raw);
  // Product permission is checked even on a successful command replay.
  await requireCurrentStaff(tx,actor,'products');
  return pricingCommand(tx,actor,id+'/'+groupKey,'ADOPT',input,async()=>{
   const row=await this.run(tx,actor,id);ensure(input.revision===row.revision,409,'REVISION_CONFLICT','测算版本冲突');const group=row.snapshot.groups.find((g:any)=>g.groupKey===groupKey);ensure(group,404,'GROUP_NOT_FOUND','测算分组不存在');
   const previous=await tx.pricingReferenceAdoption.findUnique({where:{runId_groupKey:{runId:id,groupKey}}});if(previous)return {runId:id,groupKey,productId:previous.productId,productVersionId:previous.productVersionId};
   const version=await this.products.createDraft(tx,actor,{...group.draft,vehicleIds:group.vehicleIds,modelDefinitionIds:[],revision:0,idempotencyKey:'pricing-'+hash({runId:id,groupKey})});
   const result={runId:id,groupKey,productId:version.productId,productVersionId:version.id};await tx.pricingReferenceAdoption.create({data:{...result,createdBy:actor.id}});await audit(tx,actor.id,'ADOPT_GROUP_DRAFT','pricing-reference',id,result);return result;
  });
 }
}
