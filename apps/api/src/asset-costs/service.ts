import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {requireAssetFiles} from '../files/asset-files';
import {assetCommand,type AssetLock} from './command';
import {assertDepreciationBudget,assertNoCostOverlap,sourceLock,sourceRef,validateCostPlan,costSourceCategory,requireGeneratable} from './source';
import {workLedgerFacts} from '../asset-work-order-costs/ledger';
import {assertWorkSourceCurrent,validWorkReversal} from '../asset-work-order-costs/source';
import {assetCostId,confirmCostsInput,costCommandInput,costListInput,dateOnly,manualPaymentInput,storedDate,voidPaymentInput} from './types';

export function costEntryView(row:any){return{id:row.id,vehicleId:row.vehicleId,revision:row.revision,planId:row.planId,category:row.category,effect:row.effect,amount:row.amount,periodStart:dateOnly(row.periodStart),periodEnd:dateOnly(row.periodEnd),postedAt:row.postedAt,postedBy:row.postedBy,sourceHash:row.sourceHash,reversalOfId:row.reversalOfId??null,lockedAt:row.lockedAt??null,lockedBy:row.lockedBy??null,reason:row.reason??'',evidenceFileIds:row.evidenceFileIds??[],createdAt:row.createdAt};}
export function paymentRecordView(row:any){return{id:row.id,entryId:row.entryId,revision:row.revision,status:row.status,amount:row.amount,paidAt:dateOnly(row.paidAt),referenceNo:row.referenceNo,reason:row.reason,evidenceFileIds:row.evidenceFileIds,recordedBy:row.recordedBy,recordedAt:row.recordedAt,voidedBy:row.voidedBy??null,voidedAt:row.voidedAt??null,voidReason:row.voidReason??null};}
function safeTotal(amount:bigint){ensure(amount<=BigInt(Number.MAX_SAFE_INTEGER)&&amount>=BigInt(Number.MIN_SAFE_INTEGER),400,'AMOUNT_OVERFLOW','成本合计超出安全整数范围');return Number(amount);}
export class AssetCostsService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async read(tx:any,id:string){assetCostId.parse(id);const row=await tx.assetCostEntry.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','成本分录不存在');return row;}
 private async plan(tx:any,id:string){const row=await tx.assetCostPlan.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','成本计划不存在');return row;}
 private async context(tx:any,actor:StaffActor,id:string){await requireCurrentStaff(tx,actor,'asset-costs');const entry=await this.read(tx,id),plan=await this.plan(tx,entry.planId);ensure(plan.vehicleId===entry.vehicleId,409,'COST_SOURCE_MISMATCH','成本归属与计划不一致');return{entry,plan,locks:[sourceLock(sourceRef(plan)),{table:'AssetCostPlan',id:plan.id},{table:'AssetCostEntry',id}] as AssetLock[]};}
 private async validateEntry(tx:any,entry:any){
  ensure(entry.effect==='COST',409,'COST_STATE','只能对原成本分录执行此动作');const plan=await this.plan(tx,entry.planId),source=await validateCostPlan(tx,plan);
  ensure(plan.status==='CONFIRMED'&&plan.vehicleId===entry.vehicleId&&entry.sourceKey==='cost-plan:'+plan.id&&entry.category===costSourceCategory(source)&&entry.amount===plan.amount&&dateOnly(entry.periodStart)===dateOnly(plan.periodStart)&&dateOnly(entry.periodEnd)===dateOnly(plan.periodEnd)&&entry.sourceHash===plan.sourceHash&&canonicalHash(entry.sourceSnapshot)===plan.sourceHash,409,'COST_SOURCE_MISMATCH','成本分录与原确认计划不一致');return plan;
 }
 private async current(tx:any,id:string,revision:number){const entry=await this.read(tx,id);ensure(entry.revision===revision,409,'REVISION_CONFLICT','成本分录已变化，请刷新');await this.validateEntry(tx,entry);ensure(!await tx.assetCostEntry.count({where:{reversalOfId:id,effect:'REVERSAL'}}),409,'COST_ALREADY_REVERSED','原成本已冲正');return entry;}
 private async change(tx:any,id:string,revision:number,data:any){const changed=await tx.assetCostEntry.updateMany({where:{id,revision},data:{...data,revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','成本分录已变化，请刷新');}
 async list(tx:any,actor:StaffActor,query:unknown){
  await requireCurrentStaff(tx,actor,'asset-costs',false);const input=costListInput.parse(query),where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.category?{category:input.category}:{}),...(input.effect?{effect:input.effect}:{}),...(input.costPeriod?{plan:{costPeriod:input.costPeriod}}:{})};
  const [rows,total,costSum,reversalSum]=await Promise.all([tx.assetCostEntry.findMany({where,orderBy:[{postedAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.assetCostEntry.count({where}),tx.assetCostEntry.aggregate({where:{AND:[where,{effect:'COST'}]},_sum:{amount:true}}),tx.assetCostEntry.aggregate({where:{AND:[where,{effect:'REVERSAL'}]},_sum:{amount:true}})]);
  for(const row of rows)if(['REPAIR','MAINTENANCE','TOWING'].includes(row.category)){const plan=await this.plan(tx,row.planId);ensure(plan.sourceKind==='WORK_ORDER',409,'COST_SOURCE_MISMATCH','费用类别与真实来源不一致');if(row.effect==='COST')await this.validateEntry(tx,row);else{const original=await this.read(tx,row.reversalOfId);await this.validateEntry(tx,original);validWorkReversal(row,original);}}
  const costAmount=costSum._sum.amount??0,reversalAmount=reversalSum._sum.amount??0;ensure(Number.isSafeInteger(costAmount)&&Number.isSafeInteger(reversalAmount),400,'AMOUNT_OVERFLOW','成本合计超出安全整数范围');return{items:rows.map(costEntryView),total,page:input.page,pageSize:input.pageSize,totals:{costAmount,reversalAmount,netAmount:safeTotal(BigInt(costAmount)-BigInt(reversalAmount))}};
 }
 async detail(tx:any,actor:StaffActor,id:string){
  await requireCurrentStaff(tx,actor,'asset-costs',false);const row=await this.read(tx,id),plan=await this.plan(tx,row.planId),payments=await tx.assetManualPaymentRecord.findMany({where:{entryId:id},orderBy:[{recordedAt:'asc'},{id:'asc'}]}),reversal=await tx.assetCostEntry.findFirst({where:{reversalOfId:id,effect:'REVERSAL'}});ensure(plan.vehicleId===row.vehicleId,409,'COST_SOURCE_MISMATCH','成本与计划归属不一致');
  let sourceEvidence:any[]|undefined;
  if(plan.sourceKind==='WORK_ORDER'){const source=await validateCostPlan(tx,plan);if(row.effect==='COST')await this.validateEntry(tx,row);else{const original=await this.read(tx,row.reversalOfId);await this.validateEntry(tx,original);validWorkReversal(row,original);}sourceEvidence=await requireAssetFiles(tx,actor,{kind:'WORK_ORDER_COST',resourceId:source.id});}
  return{...costEntryView(row),...(sourceEvidence?{sourceEvidence}:{}),source:{...sourceRef(plan),sourceRevision:plan.sourceRevision,sourceHash:plan.sourceHash,costPeriod:plan.costPeriod},payments:payments.map(paymentRecordView),reversal:reversal?costEntryView(reversal):null,files:await requireAssetFiles(tx,actor,{kind:'COST',resourceId:id})};
 }
 async confirm(tx:any,actor:StaffActor,raw:unknown){
  const input=confirmCostsInput.parse(raw);await requireCurrentStaff(tx,actor,'asset-costs');const before=await Promise.all(input.plans.map(plan=>this.plan(tx,plan.id))),locks=before.flatMap(plan=>[sourceLock(sourceRef(plan)),{table:'AssetCostPlan' as const,id:plan.id}]);
  return assetCommand(tx,actor,'asset-costs','BATCH','CONFIRM_COST_PLANS',input,before.map(plan=>plan.vehicleId),locks,async()=>{
   const entries:any[]=[],confirmedPlanIds:string[]=[];let total=0n;
   for(const requested of input.plans){
    const plan=await this.plan(tx,requested.id);ensure(plan.revision===requested.revision,409,'REVISION_CONFLICT','成本计划已变化，请重新核对');ensure(plan.status==='SCHEDULED'&&!await tx.assetCostEntry.count({where:{planId:plan.id}}),409,'COST_PLAN_STATE','只有未确认的有效计划可确认');const source=await validateCostPlan(tx,plan);if(source.sourceKind==='WORK_ORDER'){requireGeneratable(source);await assertWorkSourceCurrent(tx,source);}await assertDepreciationBudget(tx,source);
    await assertNoCostOverlap(tx,plan.vehicleId,plan.sourceKind,dateOnly(plan.periodStart),dateOnly(plan.periodEnd),plan.id);
    const changed=await tx.assetCostPlan.updateMany({where:{id:plan.id,revision:requested.revision,status:'SCHEDULED'},data:{status:'CONFIRMED',revision:{increment:1},confirmedBy:actor.id,confirmedAt:this.clock()}});ensure(changed.count===1,409,'REVISION_CONFLICT','成本计划已变化，请重新核对');
    const entry=await tx.assetCostEntry.create({data:{vehicleId:plan.vehicleId,planId:plan.id,sourceKey:'cost-plan:'+plan.id,category:costSourceCategory(source),effect:'COST',amount:plan.amount,periodStart:plan.periodStart,periodEnd:plan.periodEnd,postedAt:this.clock(),postedBy:actor.id,sourceSnapshot:plan.sourceSnapshot,sourceHash:plan.sourceHash}});entries.push(costEntryView(entry));confirmedPlanIds.push(plan.id);total+=BigInt(plan.amount);
   }
   const totalAmount=safeTotal(total);await audit(tx,actor.id,'CONFIRM_COST_PLANS','asset-costs','BATCH',{confirmedPlanIds,entryIds:entries.map(entry=>entry.id),totalAmount});return{entries,confirmedPlanIds,totalAmount};
  });
 }
 async lock(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=costCommandInput.parse(raw),before=await this.context(tx,actor,id);return assetCommand(tx,actor,'asset-costs',id,'LOCK_ASSET_COST',input,[before.entry.vehicleId],before.locks,async()=>{
   const row=await this.current(tx,id,input.revision);ensure(!row.lockedAt,409,'COST_LOCKED','成本已经锁定');await this.change(tx,id,input.revision,{lockedAt:this.clock(),lockedBy:actor.id});await audit(tx,actor.id,'LOCK_ASSET_COST','asset-costs',id,{revision:input.revision+1,reason:input.reason});return this.detail(tx,actor,id);
  });
 }
 async reverse(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=costCommandInput.parse(raw),before=await this.context(tx,actor,id);return assetCommand(tx,actor,'asset-costs',id,'REVERSE_ASSET_COST',input,[before.entry.vehicleId],before.locks,async()=>{
   const row=await this.current(tx,id,input.revision);ensure(!row.lockedAt,409,'COST_LOCKED','已锁定成本不可冲正');ensure(!await tx.assetManualPaymentRecord.count({where:{entryId:id,status:'RECORDED'}}),409,'COST_HAS_PAYMENT','请先核对并更正有效人工付款登记');
   if(before.plan.sourceKind==='WORK_ORDER'){ensure(!await tx.assetRecoveryRecord.count({where:{costEntryId:id,status:'RECORDED'}}),409,'COST_HAS_RECOVERY','请先核实并明确撤销有效保险到账登记');const source=await validateCostPlan(tx,before.plan),facts=await workLedgerFacts(tx,source.record.workOrder);ensure(source.record.workOrder.status!=='CLOSED'||facts.effective.length>1,409,'WORK_ORDER_REOPEN_REQUIRED','已关闭工单最后一笔成本须先明确财务重开');}
   const reversal=await tx.assetCostEntry.create({data:{vehicleId:row.vehicleId,planId:row.planId,sourceKey:'cost-reversal:'+id,category:row.category,effect:'REVERSAL',amount:row.amount,periodStart:row.periodStart,periodEnd:row.periodEnd,postedAt:this.clock(),postedBy:actor.id,sourceSnapshot:row.sourceSnapshot,sourceHash:row.sourceHash,reversalOfId:id,reason:input.reason}});await this.change(tx,id,input.revision,{});await audit(tx,actor.id,'REVERSE_ASSET_COST','asset-costs',id,{revision:input.revision+1,reversalId:reversal.id,amount:row.amount,reason:input.reason});return this.detail(tx,actor,id);
  });
 }
 async manualPayment(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=manualPaymentInput.parse(raw),before=await this.context(tx,actor,id);return assetCommand(tx,actor,'asset-costs',id,'RECORD_ASSET_PAYMENT',input,[before.entry.vehicleId],before.locks,async()=>{
   const row=await this.current(tx,id,input.revision);ensure(['BAAS_RENT','REPAIR','MAINTENANCE','TOWING'].includes(row.category)&&row.amount>0,409,'MANUAL_PAYMENT_NOT_APPLICABLE','只有有效现金成本可以登记整笔人工付款');const today=new Date(this.clock().getTime()+8*3600000).toISOString().slice(0,10);ensure(input.paidAt<=today,400,'PAYMENT_DATE_FUTURE','实际付款日期不能晚于上海今天');ensure(!await tx.assetManualPaymentRecord.count({where:{entryId:id,status:'RECORDED'}}),409,'PAYMENT_ALREADY_RECORDED','此成本已有有效人工付款登记');
   const files=await requireAssetFiles(tx,actor,{kind:'COST',resourceId:id,fileIds:input.fileIds,required:true}),payment=await tx.assetManualPaymentRecord.create({data:{entryId:id,amount:row.amount,paidAt:storedDate(input.paidAt),referenceNo:input.referenceNo,reason:input.reason,evidenceFileIds:files.map(file=>file.id),recordedBy:actor.id,recordedAt:this.clock()}});await this.change(tx,id,input.revision,{});await audit(tx,actor.id,'RECORD_ASSET_PAYMENT','asset-costs',id,{revision:input.revision+1,paymentRecordId:payment.id,amount:row.amount,paidAt:input.paidAt,referenceNo:input.referenceNo,reason:input.reason,files});return this.detail(tx,actor,id);
  });
 }
 async voidPayment(tx:any,actor:StaffActor,id:string,recordId:string,raw:unknown){
  assetCostId.parse(recordId);const input=voidPaymentInput.parse(raw),before=await this.context(tx,actor,id),initial=await tx.assetManualPaymentRecord.findUnique({where:{id:recordId}});ensure(initial?.entryId===id,409,'PAYMENT_PARENT_MISMATCH','付款登记不属于此成本');
  return assetCommand(tx,actor,'asset-costs',id,'VOID_ASSET_PAYMENT:'+recordId,input,[before.entry.vehicleId],[...before.locks,{table:'AssetManualPaymentRecord',id:recordId}],async()=>{
   const row=await this.current(tx,id,input.revision),record=await tx.assetManualPaymentRecord.findUnique({where:{id:recordId}});ensure(record?.entryId===id&&record.amount===row.amount,409,'PAYMENT_PARENT_MISMATCH','付款登记与此成本不一致');ensure(record.revision===input.recordRevision,409,'REVISION_CONFLICT','付款登记已变化，请刷新');ensure(record.status==='RECORDED',409,'PAYMENT_RECORD_STATE','只有有效人工付款登记可撤销');
   const changed=await tx.assetManualPaymentRecord.updateMany({where:{id:recordId,entryId:id,revision:input.recordRevision,status:'RECORDED'},data:{status:'VOIDED',revision:{increment:1},voidedBy:actor.id,voidedAt:this.clock(),voidReason:input.reason}});ensure(changed.count===1,409,'REVISION_CONFLICT','付款登记已变化，请刷新');await this.change(tx,id,input.revision,{});await audit(tx,actor.id,'VOID_ASSET_PAYMENT','asset-costs',id,{revision:input.revision+1,paymentRecordId:recordId,recordRevision:input.recordRevision+1,amount:record.amount,reason:input.reason});return this.detail(tx,actor,id);
  });
 }
}
