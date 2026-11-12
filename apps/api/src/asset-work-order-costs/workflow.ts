import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {requireAssetFiles} from '../files/asset-files';
import {recordWorkOrderTransition} from '../asset-work-orders/command';
import {storedDate} from '../asset-costs/types';
import {sourceLock,sourceRef} from '../asset-costs/source';
import type {AssetLock} from '../asset-costs/command';
import {readWork,workCostCommand,sameRevision} from './command';
import {closeWorkCostsInput,reopenWorkCostsInput,recoveryInput,voidRecoveryInput,costId} from './types';
import {currentAcceptance} from './source';
import {currentWorkEntry,recoveryView,workLedgerFacts} from './ledger';
import {WorkOrderCostsService} from './service';

export class WorkOrderFinanceService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async entryContext(tx:any,actor:StaffActor,workOrderId:string,entryId:string){
  await requireCurrentStaff(tx,actor,'asset-work-order-costs');costId.parse(entryId);const work=await readWork(tx,workOrderId),entry=await tx.assetCostEntry.findUnique({where:{id:entryId}});ensure(entry&&entry.vehicleId===work.vehicleId,409,'COST_SOURCE_MISMATCH','成本分录不属于本工单车辆');const plan=await tx.assetCostPlan.findUnique({where:{id:entry.planId}});ensure(plan&&plan.sourceKind==='WORK_ORDER',409,'COST_SOURCE_MISMATCH','须指定真实工单成本');const ref=sourceRef(plan);ensure(ref.sourceKind==='WORK_ORDER',409,'COST_SOURCE_MISMATCH','须指定真实工单成本');const line=await tx.assetWorkOrderCost.findUnique({where:{id:ref.workOrderCostId}});ensure(line&&line.workOrderId===work.id&&line.vehicleId===work.vehicleId,409,'COST_SOURCE_MISMATCH','成本来源不属于本工单');
  return{work,entry,plan,locks:[{table:'AssetWorkOrder',id:work.id},sourceLock(ref),{table:'AssetCostPlan',id:plan.id},{table:'AssetCostEntry',id:entry.id}] as AssetLock[]};
 }
 private async changeEntry(tx:any,id:string,revision:number){const changed=await tx.assetCostEntry.updateMany({where:{id,revision},data:{revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','成本分录已变化');}
 async close(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=closeWorkCostsInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-work-order-costs');const before=await readWork(tx,id);
  return workCostCommand(tx,actor,'asset-work-order-costs',id,'FINANCE_CLOSE',input,[before.vehicleId],[{table:'AssetWorkOrder',id}],async()=>{
   const work=await readWork(tx,id);sameRevision(work,input.revision);await currentAcceptance(tx,work);const facts=await workLedgerFacts(tx,work);
   ensure(facts.effective.length>0&&!facts.lines.some((row:any)=>row.status==='DRAFT')&&!facts.plans.some((row:any)=>row.status==='SCHEDULED'),409,'WORK_ORDER_COSTS_INCOMPLETE','仍有未决费用或无有效入账成本，不能财务关单');
   await recordWorkOrderTransition(tx,actor,work,'FINANCE_CLOSE',{status:'CLOSED',closedBy:actor.id,closedAt:this.clock()},{reason:input.reason,acceptedEventId:work.acceptedEventId,entryIds:facts.effective.map((row:any)=>row.id),totals:facts.totals},this.clock());return new WorkOrderCostsService(this.clock).detail(tx,actor,id);
  });
 }
 async reopen(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=reopenWorkCostsInput.parse(raw),before=await this.entryContext(tx,actor,id,input.entryId);
  return workCostCommand(tx,actor,'asset-work-order-costs',id,'REOPEN_COST_REVIEW',input,[before.work.vehicleId],before.locks,async()=>{
   const work=await readWork(tx,id);sameRevision(work,input.revision);ensure(work.status==='CLOSED'&&work.costConfirmationRequired===true,409,'WORK_ORDER_COST_STATE','只有已关闭的有成本工单可财务重开');const {entry}=await currentWorkEntry(tx,work,input.entryId,input.entryRevision);ensure(!entry.lockedAt,409,'COST_LOCKED','已锁定成本不可通过财务重开更正');
   await recordWorkOrderTransition(tx,actor,work,'REOPEN_COST_REVIEW',{status:'PENDING_COST_CONFIRMATION',closedBy:null,closedAt:null},{reason:input.reason,entryId:entry.id,entryRevision:entry.revision,acceptedEventId:work.acceptedEventId},this.clock());return new WorkOrderCostsService(this.clock).detail(tx,actor,id);
  });
 }
 async recovery(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=recoveryInput.parse(raw),before=await this.entryContext(tx,actor,id,input.costEntryId);
  return workCostCommand(tx,actor,'asset-work-order-costs',id,'RECORD_INSURANCE_RECEIPT',input,[before.work.vehicleId],before.locks,async()=>{
   const work=await readWork(tx,id);sameRevision(work,input.workOrderRevision);const {entry}=await currentWorkEntry(tx,work,input.costEntryId,input.entryRevision);const today=new Date(this.clock().getTime()+8*3600000).toISOString().slice(0,10);ensure(input.receivedOn<=today,400,'RECOVERY_DATE_FUTURE','实际到账日期不能晚于上海今天');
   const files=await requireAssetFiles(tx,actor,{kind:'COST',resourceId:entry.id,fileIds:input.fileIds,required:true}),row=await tx.assetRecoveryRecord.create({data:{workOrderId:id,vehicleId:work.vehicleId,costEntryId:entry.id,kind:'INSURANCE_RECEIPT',amount:input.amount,receivedOn:storedDate(input.receivedOn),referenceNo:input.referenceNo,reason:input.reason,evidenceFileIds:files.map(file=>file.id),evidenceSnapshot:files,recordedBy:actor.id,recordedAt:this.clock()}});await this.changeEntry(tx,entry.id,input.entryRevision);await audit(tx,actor.id,'RECORD_INSURANCE_RECEIPT','asset-work-order-costs',id,{recordId:row.id,entryId:entry.id,entryRevision:input.entryRevision+1,amount:row.amount,files});return recoveryView(row);
  });
 }
 async voidRecovery(tx:any,actor:StaffActor,id:string,recordId:string,raw:unknown){
  const input=voidRecoveryInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-work-order-costs');costId.parse(recordId);const initial=await tx.assetRecoveryRecord.findUnique({where:{id:recordId}});ensure(initial?.workOrderId===id,409,'RECOVERY_PARENT_MISMATCH','收款登记不属于本工单');const before=await this.entryContext(tx,actor,id,initial.costEntryId);
  return workCostCommand(tx,actor,'asset-work-order-costs',id,'VOID_INSURANCE_RECEIPT:'+recordId,input,[before.work.vehicleId],[...before.locks,{table:'AssetRecoveryRecord',id:recordId}],async()=>{
   const work=await readWork(tx,id);sameRevision(work,input.revision);const row=await tx.assetRecoveryRecord.findUnique({where:{id:recordId}});ensure(row&&row.workOrderId===id&&row.vehicleId===work.vehicleId&&row.costEntryId===initial.costEntryId&&row.kind==='INSURANCE_RECEIPT',409,'RECOVERY_PARENT_MISMATCH','收款登记与原成本不一致');sameRevision(row,input.recordRevision);ensure(row.status==='RECORDED',409,'RECOVERY_STATE','只有有效到账登记可撤销');await currentWorkEntry(tx,work,row.costEntryId,input.entryRevision);
   const changed=await tx.assetRecoveryRecord.updateMany({where:{id:recordId,revision:input.recordRevision,status:'RECORDED'},data:{status:'VOIDED',revision:{increment:1},voidedBy:actor.id,voidedAt:this.clock(),voidReason:input.reason}});ensure(changed.count===1,409,'REVISION_CONFLICT','收款登记已变化');await this.changeEntry(tx,row.costEntryId,input.entryRevision);await audit(tx,actor.id,'VOID_INSURANCE_RECEIPT','asset-work-order-costs',id,{recordId,recordRevision:input.recordRevision+1,entryRevision:input.entryRevision+1,amount:row.amount,reason:input.reason});return recoveryView(await tx.assetRecoveryRecord.findUnique({where:{id:recordId}}));
  });
 }
}
