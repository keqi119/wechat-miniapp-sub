import {randomUUID} from 'node:crypto';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {requireAssetFiles} from '../files/asset-files';
import {dateOnly,storedDate} from '../asset-costs/types';
import {planView} from '../asset-costs/source';
import {costEntryView,paymentRecordView} from '../asset-costs/service';
import {workCostCommand,readWork,readWorkCost,sameRevision} from './command';
import {assertReplacement,assertWorkCostCategory,currentAcceptance,frozenWorkCostSource} from './source';
import {recoveryView,workLedgerFacts} from './ledger';
import {workCostCreateInput,workCostPatchInput,workCostListInput,workFinanceListInput,workCostPreviewInput,workCostPrepareInput} from './types';

export function workFinanceView(row:any){return{id:row.id,revision:row.revision,workOrderNo:row.workOrderNo,vehicleId:row.vehicleId,kind:row.kind,title:row.title,status:row.status,costConfirmationRequired:row.costConfirmationRequired,noCostReason:row.noCostReason??null,acceptedEventId:row.acceptedEventId??null,acceptedRevision:row.acceptedRevision??null,closedAt:row.closedAt??null,closedBy:row.closedBy??null};}
export function workCostView(row:any){return{id:row.id,revision:row.revision,workOrderId:row.workOrderId,vehicleId:row.vehicleId,category:row.category,status:row.status,amount:row.amount,occurredOn:dateOnly(row.occurredOn),supplierName:row.supplierName,referenceNo:row.referenceNo,reason:row.reason,replacesCostId:row.replacesCostId??null,sourceHash:row.sourceHash??null,sourceSnapshot:row.sourceSnapshot??null,frozenBy:row.frozenBy??null,frozenAt:row.frozenAt??null,createdBy:row.createdBy,createdAt:row.createdAt,updatedBy:row.updatedBy,updatedAt:row.updatedAt};}
export class WorkOrderCostsService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private actualDate(date:string){const today=new Date(this.clock().getTime()+8*3600000).toISOString().slice(0,10);ensure(date<=today,400,'WORK_COST_DATE_FUTURE','实际费用日期不能晚于上海今天');}
 async list(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'asset-work-order-costs',false);const input=workFinanceListInput.parse(raw),where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.status?{status:input.status}:{})},[rows,total]=await Promise.all([tx.assetWorkOrder.findMany({where,orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.assetWorkOrder.count({where})]);return{items:rows.map(workFinanceView),total,page:input.page,pageSize:input.pageSize};}
 async detail(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'asset-work-order-costs',false);const work=await readWork(tx,id),facts=await workLedgerFacts(tx,work);return{workOrder:workFinanceView(work),lines:facts.lines.map(workCostView),plans:facts.plans.map(planView),entries:facts.entries.map(costEntryView),payments:facts.payments.map(paymentRecordView),recoveries:facts.recoveries.map(recoveryView),totals:facts.totals};}
 async listLines(tx:any,actor:StaffActor,raw:unknown){await requireCurrentStaff(tx,actor,'asset-work-order-cost-lines',false);const input=workCostListInput.parse(raw),where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.workOrderId?{workOrderId:input.workOrderId}:{}),...(input.status?{status:input.status}:{}),...(input.category?{category:input.category}:{})},[rows,total]=await Promise.all([tx.assetWorkOrderCost.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.assetWorkOrderCost.count({where})]);for(const row of rows)if(row.status==='FROZEN')await frozenWorkCostSource(tx,row.id);return{items:rows.map(workCostView),total,page:input.page,pageSize:input.pageSize};}
 async lineDetail(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'asset-work-order-cost-lines',false);const line=await readWorkCost(tx,id);if(line.status==='FROZEN')await frozenWorkCostSource(tx,id);return{...workCostView(line),files:await requireAssetFiles(tx,actor,{kind:'WORK_ORDER_COST',resourceId:id})};}
 async create(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=workCostCreateInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-work-order-cost-lines');const before=await readWork(tx,id);
  return workCostCommand(tx,actor,'asset-work-order-cost-lines',id,'CREATE_WORK_COST',input,[before.vehicleId],[{table:'AssetWorkOrder',id}],async()=>{
   const work=await readWork(tx,id);sameRevision(work,input.workOrderRevision);this.actualDate(input.occurredOn);await currentAcceptance(tx,work);assertWorkCostCategory(work,input.category);await assertReplacement(tx,work,input.replacesCostId);
   const line=await tx.assetWorkOrderCost.create({data:{id:randomUUID(),workOrderId:id,vehicleId:work.vehicleId,category:input.category,amount:input.amount,occurredOn:storedDate(input.occurredOn),supplierName:input.supplierName,referenceNo:input.referenceNo,reason:input.reason,replacesCostId:input.replacesCostId,createdBy:actor.id,updatedBy:actor.id}});
   await audit(tx,actor.id,'CREATE_WORK_COST','asset-work-order-cost-lines',line.id,{workOrderId:id,amount:line.amount,replacesCostId:line.replacesCostId});return workCostView(line);
  });
 }
 async update(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=workCostPatchInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-work-order-cost-lines');const before=await readWorkCost(tx,id);
  return workCostCommand(tx,actor,'asset-work-order-cost-lines',id,'UPDATE_WORK_COST',input,[before.vehicleId],[{table:'AssetWorkOrderCost',id}],async()=>{
   const line=await readWorkCost(tx,id),work=await readWork(tx,line.workOrderId);sameRevision(line,input.revision);ensure(line.status==='DRAFT',409,'WORK_COST_STATE','只有草稿费用可更正');await currentAcceptance(tx,work);this.actualDate(input.occurredOn??dateOnly(line.occurredOn));assertWorkCostCategory(work,line.category);
   const {revision,idempotencyKey,...patch}=input,data={...patch,...(patch.occurredOn?{occurredOn:storedDate(patch.occurredOn)}:{}),revision:{increment:1},updatedBy:actor.id,updatedAt:this.clock()},changed=await tx.assetWorkOrderCost.updateMany({where:{id,revision,status:'DRAFT'},data});ensure(changed.count===1,409,'REVISION_CONFLICT','费用来源已变化');await audit(tx,actor.id,'UPDATE_WORK_COST','asset-work-order-cost-lines',id,{revision:revision+1,fields:Object.keys(patch)});return workCostView(await readWorkCost(tx,id));
  });
 }
 private async calculate(tx:any,actor:StaffActor,line:any){
  ensure(line.status==='DRAFT',409,'WORK_COST_STATE','只有草稿费用可冻结');const work=await readWork(tx,line.workOrderId);ensure(work.vehicleId===line.vehicleId,409,'COST_SOURCE_MISMATCH','费用与真实工单归属不一致');this.actualDate(dateOnly(line.occurredOn));const event=await currentAcceptance(tx,work);assertWorkCostCategory(work,line.category);await assertReplacement(tx,work,line.replacesCostId??null,line.id);
  const evidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER_COST',resourceId:line.id,required:true}),sourceSnapshot={version:1,sourceKind:'WORK_ORDER',sourceId:line.id,workOrderId:work.id,vehicleId:line.vehicleId,sourceRevision:line.revision+1,evidenceRevision:line.revision,acceptedEventId:event.id,acceptedRevision:event.afterRevision,acceptedEventHash:event.sourceHash,acceptedSnapshot:event.detailSnapshot,category:line.category,amount:line.amount,occurredOn:dateOnly(line.occurredOn),supplierName:line.supplierName,referenceNo:line.referenceNo,reason:line.reason,replacesCostId:line.replacesCostId??null,evidence},sourceHash=canonicalHash(sourceSnapshot);
  return{lineId:line.id,lineRevision:line.revision,workOrderId:work.id,workOrderRevision:work.revision,amount:line.amount,costPeriod:sourceSnapshot.occurredOn.slice(0,7),periodStart:sourceSnapshot.occurredOn,periodEnd:sourceSnapshot.occurredOn,sourceSnapshot,sourceHash,previewHash:canonicalHash({lineRevision:line.revision,workOrderRevision:work.revision,sourceHash})};
 }
 async preview(tx:any,actor:StaffActor,id:string,raw:unknown){await requireCurrentStaff(tx,actor,'asset-work-order-cost-lines',false);workCostPreviewInput.parse(raw);return this.calculate(tx,actor,await readWorkCost(tx,id));}
 async prepare(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=workCostPrepareInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-work-order-cost-lines');const before=await readWorkCost(tx,id);
  return workCostCommand(tx,actor,'asset-work-order-cost-lines',id,'PREPARE_WORK_COST',input,[before.vehicleId],[{table:'AssetWorkOrderCost',id}],async()=>{
   const line=await readWorkCost(tx,id);sameRevision(line,input.revision);const preview=await this.calculate(tx,actor,line);ensure(preview.workOrderRevision===input.workOrderRevision,409,'REVISION_CONFLICT','工单已变化');ensure(preview.previewHash===input.previewHash,409,'PREVIEW_CHANGED','费用来源或证据已变化，请重新预览');ensure(!await tx.assetCostPlan.count({where:{workOrderCostId:id}}),409,'WORK_COST_STATE','费用来源已有计划');
   const changed=await tx.assetWorkOrderCost.updateMany({where:{id,revision:input.revision,status:'DRAFT'},data:{status:'FROZEN',sourceSnapshot:preview.sourceSnapshot,sourceHash:preview.sourceHash,revision:{increment:1},frozenBy:actor.id,frozenAt:this.clock(),updatedBy:actor.id,updatedAt:this.clock()}});ensure(changed.count===1,409,'REVISION_CONFLICT','费用来源已变化');
   const plan=await tx.assetCostPlan.create({data:{vehicleId:line.vehicleId,sourceKind:'WORK_ORDER',workOrderCostId:id,baasContractId:null,depreciationPolicyId:null,costPeriod:preview.costPeriod,periodStart:storedDate(preview.periodStart),periodEnd:storedDate(preview.periodEnd),dueDate:null,amount:line.amount,sourceRevision:input.revision+1,sourceSnapshot:preview.sourceSnapshot,sourceHash:preview.sourceHash,status:'SCHEDULED',createdBy:actor.id}});await audit(tx,actor.id,'PREPARE_WORK_COST','asset-work-order-cost-lines',id,{revision:input.revision+1,planId:plan.id,sourceHash:preview.sourceHash,acceptedEventId:preview.sourceSnapshot.acceptedEventId});return{line:workCostView(await readWorkCost(tx,id)),plan:planView(plan)};
  });
 }
}
