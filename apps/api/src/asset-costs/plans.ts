import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {assetCommand} from './command';
import {assertDepreciationBudget,assertNoCostOverlap,planView,previewCostPlans,sourceLock,sourceRef,validateCostPlan} from './source';
import {assetCostId,costCommandInput,planListInput,reopenPlanInput} from './types';

export class AssetCostPlansService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async read(tx:any,id:string){assetCostId.parse(id);const row=await tx.assetCostPlan.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','成本计划不存在');return row;}
 private async sourcePermission(tx:any,actor:StaffActor,row:any,write=false){const ref=sourceRef(row);return requireCurrentStaff(tx,actor,ref.sourceKind==='BAAS'?'baas-contracts':ref.sourceKind==='DEPRECIATION'?'depreciation-policies':'asset-work-order-cost-lines',write);}
 async list(tx:any,actor:StaffActor,query:unknown){
  const current=await requireCurrentStaff(tx,actor,'asset-cost-plans',false),input=planListInput.parse(query);ensure(current.role!=='OPERATIONS'||!input.sourceKind||input.sourceKind==='BAAS',403,'FORBIDDEN','运营只可读取 BAAS 计划');const where={...(current.role==='OPERATIONS'?{sourceKind:'BAAS'}:input.sourceKind?{sourceKind:input.sourceKind}:{}),...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.costPeriod?{costPeriod:input.costPeriod}:{}),...(input.status?{status:input.status}:{})};
  const [rows,total]=await Promise.all([tx.assetCostPlan.findMany({where,orderBy:[{costPeriod:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.assetCostPlan.count({where})]);for(const row of rows)if(row.sourceKind==='WORK_ORDER')await validateCostPlan(tx,row);return{items:rows.map(planView),total,page:input.page,pageSize:input.pageSize};
 }
 async detail(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'asset-cost-plans',false);const row=await this.read(tx,id);await this.sourcePermission(tx,actor,row);if(row.sourceKind==='WORK_ORDER')await validateCostPlan(tx,row);return planView(row);}
 async reopenPreview(tx:any,actor:StaffActor,id:string){
  await requireCurrentStaff(tx,actor,'asset-cost-plans',false);const row=await this.read(tx,id);await this.sourcePermission(tx,actor,row);
  ensure(row.status==='VOIDED'&&!await tx.assetCostEntry.count({where:{planId:id}}),409,'COST_PLAN_STATE','已确认过的计划不得重新开启');
  const source=await validateCostPlan(tx,row),request=source.sourceKind==='BAAS'?{sourceKind:'BAAS' as const,fromPeriod:row.costPeriod,toPeriod:row.costPeriod}:source.sourceKind==='WORK_ORDER'?{sourceKind:'WORK_ORDER' as const}:row.sourceSnapshot.request,preview=await previewCostPlans(tx,source,request);
  await assertDepreciationBudget(tx,source,[row]);
  await assertNoCostOverlap(tx,row.vehicleId,row.sourceKind,planView(row).periodStart,planView(row).periodEnd,id);
  return{planId:row.id,planRevision:row.revision,sourceRevision:source.revision,sourceKind:row.sourceKind,costPeriod:row.costPeriod,amount:row.amount,previewHash:preview.previewHash,warningIds:preview.warningIds,rows:preview.rows};
 }
 async void(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=costCommandInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-cost-plans');const before=await this.read(tx,id);await this.sourcePermission(tx,actor,before,true);
  return assetCommand(tx,actor,'asset-cost-plans',id,'VOID_COST_PLAN',input,[before.vehicleId],[sourceLock(sourceRef(before)),{table:'AssetCostPlan',id}],async()=>{
   const row=await this.read(tx,id);await this.sourcePermission(tx,actor,row,true);ensure(row.revision===input.revision,409,'REVISION_CONFLICT','成本计划已变化');ensure(row.status==='SCHEDULED'&&!await tx.assetCostEntry.count({where:{planId:id}}),409,'COST_PLAN_STATE','只有从未确认的待确认计划可作废');await validateCostPlan(tx,row);
   const changed=await tx.assetCostPlan.updateMany({where:{id,revision:input.revision,status:'SCHEDULED'},data:{status:'VOIDED',revision:{increment:1},voidedBy:actor.id,voidedAt:this.clock(),reason:input.reason}});ensure(changed.count===1,409,'REVISION_CONFLICT','成本计划已变化');await audit(tx,actor.id,'VOID_COST_PLAN','asset-cost-plans',id,{reason:input.reason,revision:input.revision+1});return planView(await this.read(tx,id));
  });
 }
 async reopen(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=reopenPlanInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-cost-plans');const before=await this.read(tx,id);await this.sourcePermission(tx,actor,before,true);
  return assetCommand(tx,actor,'asset-cost-plans',id,'REOPEN_COST_PLAN',input,[before.vehicleId],[sourceLock(sourceRef(before)),{table:'AssetCostPlan',id}],async()=>{
   const row=await this.read(tx,id);await this.sourcePermission(tx,actor,row,true);ensure(row.revision===input.revision,409,'REVISION_CONFLICT','成本计划已变化');ensure(row.status==='VOIDED'&&!await tx.assetCostEntry.count({where:{planId:id}}),409,'COST_PLAN_STATE','已确认过的计划不得重新开启');
   const source=await validateCostPlan(tx,row);ensure(source.revision===input.sourceRevision,409,'REVISION_CONFLICT','成本来源已变化，请重新预览');const request=source.sourceKind==='BAAS'?{sourceKind:'BAAS' as const,fromPeriod:row.costPeriod,toPeriod:row.costPeriod}:source.sourceKind==='WORK_ORDER'?{sourceKind:'WORK_ORDER' as const}:row.sourceSnapshot.request,preview=await previewCostPlans(tx,source,request);ensure(preview.previewHash===input.previewHash,409,'PREVIEW_CHANGED','重开预览已变化，请重新核对');
   await assertDepreciationBudget(tx,source,[row]);
   await assertNoCostOverlap(tx,row.vehicleId,row.sourceKind,planView(row).periodStart,planView(row).periodEnd,id);
   const changed=await tx.assetCostPlan.updateMany({where:{id,revision:input.revision,status:'VOIDED'},data:{status:'SCHEDULED',revision:{increment:1},voidedBy:null,voidedAt:null,reason:input.reason}});ensure(changed.count===1,409,'REVISION_CONFLICT','成本计划已变化');await audit(tx,actor.id,'REOPEN_COST_PLAN','asset-cost-plans',id,{reason:input.reason,revision:input.revision+1,previewHash:input.previewHash,sourceRevision:input.sourceRevision});return planView(await this.read(tx,id));
  });
 }
}
