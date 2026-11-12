import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {money} from '../common/data';
import {baasDraftInput,financialMissingFields,baasRequiredFields} from '../vehicle-baas/types';
import {HttpException} from '@nestjs/common';
import {previewBaasSchedule} from '../vehicle-baas/schedule';
import {previewDepreciationSchedule,type ManualDepreciationPeriod} from '../vehicle-depreciation/schedule';
import {dateOnly,storedDate,type AssetPlanSource,type AssetSourceKind} from './types';
import type {AssetLock} from './command';
import {frozenWorkCostSource,requireCurrentFrozenAcceptance,validWorkPlan,assertWorkSourceCurrent} from '../asset-work-order-costs/source';

export type PlanRequest={sourceKind:'BAAS';fromPeriod:string;toPeriod:string}|{sourceKind:'DEPRECIATION';manualPeriods?:ManualDepreciationPeriod[]}|{sourceKind:'WORK_ORDER'};
export type CostSource={sourceKind:AssetSourceKind;id:string;vehicleId:string;revision:number;status:string;activatedAt:Date|null;termsHash:string;terms:any;record:any};
const baasFields=['provider','contractNumber','supplierContractNumber','batteryPackage','batterySerialNumber','effectiveFrom','effectiveTo','billingCycle','rentalAmount','paymentDayOfMonth','graceDays','invoiceRequired','taxIncluded','currency','notes','previousContractId'];
export function baasTerms(row:any){return baasDraftInput.parse(Object.fromEntries(baasFields.map(field=>[field,['effectiveFrom','effectiveTo'].includes(field)?row[field]==null?null:dateOnly(row[field]):row[field]??(['previousContractId','taxIncluded',...baasRequiredFields].includes(field)?null:row[field])])));}
export function requireBaasCompleteTerms(terms:any){const missingFields=financialMissingFields(terms);if(missingFields.length)throw new HttpException({error:{code:'BAAS_DRAFT_INCOMPLETE',message:'请先补齐 BAAS 成本计算条款',missingFields}},409);}
export function depreciationTerms(row:any){return{method:row.method,basisAmount:row.basisAmount,basisSource:row.basisSource,basisEvidence:row.basisEvidence,residualAmount:row.residualAmount,startDate:dateOnly(row.startDate),usefulLifeMonths:row.usefulLifeMonths??null,currency:row.currency,notes:row.notes,previousPolicyId:row.previousPolicyId??null};}
export function sourceRef(plan:any):AssetPlanSource{
 const baas=typeof plan.baasContractId==='string'&&plan.baasContractId.length>0,depr=typeof plan.depreciationPolicyId==='string'&&plan.depreciationPolicyId.length>0,work=typeof plan.workOrderCostId==='string'&&plan.workOrderCostId.length>0;
 ensure(plan.sourceKind==='BAAS'&&baas&&!plan.depreciationPolicyId&&!plan.workOrderCostId||plan.sourceKind==='DEPRECIATION'&&depr&&!plan.baasContractId&&!plan.workOrderCostId||plan.sourceKind==='WORK_ORDER'&&work&&!plan.baasContractId&&!plan.depreciationPolicyId,409,'COST_SOURCE_MISMATCH','成本计划来源关联不完整');
 if(plan.sourceKind==='BAAS')return{sourceKind:'BAAS',baasContractId:plan.baasContractId};
 if(plan.sourceKind==='DEPRECIATION')return{sourceKind:'DEPRECIATION',depreciationPolicyId:plan.depreciationPolicyId};
 return{sourceKind:'WORK_ORDER',workOrderCostId:plan.workOrderCostId};
}
export function sourceLock(ref:AssetPlanSource):AssetLock{if(ref.sourceKind==='BAAS')return{table:'VehicleBaasContract',id:ref.baasContractId};if(ref.sourceKind==='DEPRECIATION')return{table:'VehicleDepreciationPolicy',id:ref.depreciationPolicyId};ensure(ref.sourceKind==='WORK_ORDER',409,'COST_SOURCE_MISMATCH','未知成本来源');return{table:'AssetWorkOrderCost',id:ref.workOrderCostId};}
export function sourceWhere(source:CostSource){return source.sourceKind==='BAAS'?{sourceKind:'BAAS',baasContractId:source.id,depreciationPolicyId:null}:source.sourceKind==='DEPRECIATION'?{sourceKind:'DEPRECIATION',depreciationPolicyId:source.id,baasContractId:null}:{sourceKind:'WORK_ORDER',workOrderCostId:source.id,baasContractId:null,depreciationPolicyId:null};}
export function costSourceCategory(source:CostSource){return source.sourceKind==='BAAS'?'BAAS_RENT':source.sourceKind==='DEPRECIATION'?'DEPRECIATION':source.terms.category;}
export async function loadCostSource(tx:any,ref:AssetPlanSource):Promise<CostSource>{
 if(ref.sourceKind==='WORK_ORDER')return frozenWorkCostSource(tx,ref.workOrderCostId);
 ensure(ref.sourceKind==='BAAS'||ref.sourceKind==='DEPRECIATION',409,'COST_SOURCE_MISMATCH','未知成本来源');
 const row=ref.sourceKind==='BAAS'?await tx.vehicleBaasContract.findUnique({where:{id:ref.baasContractId}}):await tx.vehicleDepreciationPolicy.findUnique({where:{id:ref.depreciationPolicyId}});ensure(row,404,'NOT_FOUND','成本来源不存在');
 const terms=ref.sourceKind==='BAAS'?baasTerms(row):depreciationTerms(row);ensure(row.termsHash===canonicalHash(terms),409,'COST_SOURCE_MISMATCH','成本来源条款摘要不一致');if(ref.sourceKind==='BAAS')requireBaasCompleteTerms(terms);
 return{sourceKind:ref.sourceKind,id:row.id,vehicleId:row.vehicleId,revision:row.revision,status:row.status,activatedAt:row.activatedAt??null,termsHash:row.termsHash,terms,record:row};
}
export function requireGeneratable(source:CostSource){if(source.sourceKind==='WORK_ORDER'){requireCurrentFrozenAcceptance(source);return;}if(source.sourceKind==='BAAS')requireBaasCompleteTerms(source.terms);ensure(source.activatedAt&&(source.sourceKind==='BAAS'?['ACTIVE','SUSPENDED']:['ACTIVE']).includes(source.status),409,source.sourceKind==='BAAS'?'BAAS_STATE':'DEPRECIATION_STATE','当前来源不能新生成成本计划');}
function calculate(source:CostSource,request:PlanRequest){
 ensure(source.sourceKind===request.sourceKind,409,'COST_SOURCE_MISMATCH','计划请求与来源种类不一致');
 if(request.sourceKind==='WORK_ORDER'){const terms=source.terms;return{algorithmVersion:'WORK_ORDER_COST_V1',rows:[{costPeriod:terms.occurredOn.slice(0,7),periodStart:terms.occurredOn,periodEnd:terms.occurredOn,amount:terms.amount,dueDate:null,warningIds:[] as string[]}],totalAmount:terms.amount,warningIds:[] as string[]};}
 if(request.sourceKind==='BAAS'){
  const terms=source.terms;return previewBaasSchedule({fromPeriod:request.fromPeriod,toPeriod:request.toPeriod,billingCycle:terms.billingCycle,rentalAmount:terms.rentalAmount,paymentDayOfMonth:terms.paymentDayOfMonth,effectiveFrom:terms.effectiveFrom,effectiveTo:terms.effectiveTo,...(source.record.firstCostPeriod?{firstCostPeriod:source.record.firstCostPeriod}:{})});
 }
 const terms=source.terms,common={basisAmount:terms.basisAmount,residualAmount:terms.residualAmount,startDate:terms.startDate};
 return previewDepreciationSchedule(terms.method==='STRAIGHT_LINE'?{...common,method:'STRAIGHT_LINE',usefulLifeMonths:terms.usefulLifeMonths}:terms.method==='MANUAL'?{...common,method:'MANUAL',manualPeriods:request.manualPeriods!}:{...common,method:terms.method});
}
export function planView(row:any){return{id:row.id,vehicleId:row.vehicleId,revision:row.revision,sourceKind:row.sourceKind,baasContractId:row.baasContractId??null,depreciationPolicyId:row.depreciationPolicyId??null,workOrderCostId:row.workOrderCostId??null,costPeriod:row.costPeriod,periodStart:dateOnly(row.periodStart),periodEnd:dateOnly(row.periodEnd),amount:row.amount,dueDate:row.dueDate?dateOnly(row.dueDate):null,status:row.status,sourceRevision:row.sourceRevision,sourceHash:row.sourceHash,reason:row.reason??'',createdAt:row.createdAt,confirmedAt:row.confirmedAt??null,voidedAt:row.voidedAt??null};}
export async function previewCostPlans(tx:any,source:CostSource,request:PlanRequest){
 requireGeneratable(source);if(source.sourceKind==='WORK_ORDER')await assertWorkSourceCurrent(tx,source);const calculated=calculate(source,request),asset=await tx.vehicleAssetProfile.findUnique({where:{vehicleId:source.vehicleId}}),assetRevision=asset?.revision??0;
 const existing=calculated.rows.length?await tx.assetCostPlan.findMany({where:{...sourceWhere(source),costPeriod:{in:calculated.rows.map(row=>row.costPeriod)}},orderBy:[{costPeriod:'asc'},{id:'asc'}]}):[];
 const rows=calculated.rows.map(row=>({...row,dueDate:'dueDate'in row?row.dueDate:null,warningIds:'warningIds'in row?row.warningIds:[],existingPlan:existing.find((plan:any)=>plan.costPeriod===row.costPeriod)?planView(existing.find((plan:any)=>plan.costPeriod===row.costPeriod)):null}));
 const warningIds='warningIds'in calculated?calculated.warningIds:[],budget=source.sourceKind==='DEPRECIATION'?await depreciationBudget(tx,source):null,hashInput={algorithmVersion:calculated.algorithmVersion,sourceKind:source.sourceKind,sourceId:source.id,sourceRevision:source.revision,termsHash:source.termsHash,assetRevision,request,rows,warningIds,...(budget?{depreciationBudget:budget}:{})};
 const createRows=rows.filter(row=>!row.existingPlan),totalCreated=createRows.reduce((sum,row)=>sum+BigInt(row.amount),0n);ensure(totalCreated<=BigInt(Number.MAX_SAFE_INTEGER),400,'AMOUNT_OVERFLOW','计划总额超出安全整数');
 return{sourceId:source.id,revision:source.revision,assetRevision,algorithmVersion:calculated.algorithmVersion,request,rows,totalAmount:calculated.totalAmount,createCount:createRows.length,existingCount:rows.length-createRows.length,totalCreatedAmount:Number(totalCreated),warningIds,previewHash:canonicalHash(hashInput),...(budget?{budget:{depreciableAmount:budget.depreciableAmount,committedAmount:budget.committedAmount,remainingAmount:budget.remainingAmount}}:{})};
}

/** Policy-wide scheduled plus unreversed confirmed depreciation. Each counted
 * fact is checked against its immutable mathematical source before summing. */
async function depreciationBudget(tx:any,source:CostSource){
 ensure(source.sourceKind==='DEPRECIATION',409,'COST_SOURCE_MISMATCH','累计折旧校验须指定真实折旧策略');
 const depreciableAmount=money.parse(source.terms.basisAmount)-money.parse(source.terms.residualAmount);ensure(depreciableAmount>=0,409,'COST_SOURCE_MISMATCH','残值不得超过折旧基数');
 const plans=await tx.assetCostPlan.findMany({where:sourceWhere(source),orderBy:[{costPeriod:'asc'},{id:'asc'}]}),facts:any[]=[];let total=0n;
 for(const plan of plans){
  await validateCostPlan(tx,plan);const entries=await tx.assetCostEntry.findMany({where:{planId:plan.id,effect:'COST'}});let counted=0,receipt:any=null;
  if(plan.status==='SCHEDULED'){ensure(entries.length===0,409,'COST_SOURCE_MISMATCH','待确认计划已有异常成本事实');counted=plan.amount;}
  else if(plan.status==='VOIDED')ensure(entries.length===0,409,'COST_SOURCE_MISMATCH','作废计划不能隐藏已确认成本');
  else{
   ensure(plan.status==='CONFIRMED'&&entries.length===1,409,'COST_SOURCE_MISMATCH','已确认计划须有唯一原成本事实');const entry=entries[0];
   ensure(entry.vehicleId===source.vehicleId&&entry.category==='DEPRECIATION'&&entry.amount===plan.amount&&entry.sourceHash===plan.sourceHash&&canonicalHash(entry.sourceSnapshot)===plan.sourceHash,409,'COST_SOURCE_MISMATCH','累计折旧的成本事实与计划不一致');
   const reversal=await tx.assetCostEntry.findFirst({where:{reversalOfId:entry.id,effect:'REVERSAL'}});
   if(reversal)ensure(reversal.planId===plan.id&&reversal.vehicleId===source.vehicleId&&reversal.category==='DEPRECIATION'&&reversal.amount===entry.amount&&reversal.sourceHash===entry.sourceHash&&canonicalHash(reversal.sourceSnapshot)===entry.sourceHash,409,'COST_SOURCE_MISMATCH','累计折旧冲正来源不一致');
   counted=reversal?0:entry.amount;receipt={id:entry.id,revision:entry.revision,sourceHash:entry.sourceHash,reversal:reversal?{id:reversal.id,revision:reversal.revision,sourceHash:reversal.sourceHash}:null};
  }
  total+=BigInt(counted);facts.push({id:plan.id,revision:plan.revision,status:plan.status,sourceHash:plan.sourceHash,amount:plan.amount,countedAmount:counted,receipt});
 }
 ensure(total<=BigInt(Number.MAX_SAFE_INTEGER),400,'AMOUNT_OVERFLOW','累计折旧超出安全整数范围');return{depreciableAmount,committedAmount:Number(total),remainingAmount:depreciableAmount-Number(total),facts};
}
export async function assertDepreciationBudget(tx:any,source:CostSource,additionalRows:{amount:number}[]=[]){
 if(source.sourceKind!=='DEPRECIATION')return;
 const budget=await depreciationBudget(tx,source),additional=additionalRows.reduce((sum,row)=>sum+BigInt(money.parse(row.amount)),0n);
 ensure(BigInt(budget.committedAmount)+additional<=BigInt(budget.depreciableAmount),409,'DEPRECIATION_LIMIT','本策略的有效计划与未冲正确认成本累计已超出可折旧额');
}
export async function assertNoCostOverlap(tx:any,vehicleId:string,sourceKind:AssetSourceKind,start:string,end:string,excludePlanId?:string){
 if(sourceKind==='WORK_ORDER')return; // Real work sources may share a day; uniqueness is per source line.
 const conflicts=await tx.assetCostPlan.findMany({where:{vehicleId,sourceKind,status:{in:['SCHEDULED','CONFIRMED']},periodStart:{lte:storedDate(end)},periodEnd:{gte:storedDate(start)},...(excludePlanId?{id:{not:excludePlanId}}:{})}});
 for(const plan of conflicts){
  if(plan.status==='SCHEDULED')ensure(false,409,'COST_PERIOD_OVERLAP','同车同类期间已有有效成本计划');
  const entries=await tx.assetCostEntry.findMany({where:{planId:plan.id,effect:'COST'}});ensure(entries.length>0,409,'COST_SOURCE_MISMATCH','已确认计划缺少成本事实');
  for(const entry of entries)ensure(await tx.assetCostEntry.count({where:{reversalOfId:entry.id,effect:'REVERSAL'}})>0,409,'COST_PERIOD_OVERLAP','同车同类期间已有未冲正确认成本');
 }
}
/** Internal generation primitive; public controllers only accept a concrete source and preview hash. */
export async function generateCostPlans(tx:any,source:CostSource,request:PlanRequest,previewHash:string,acknowledgedWarningIds:string[],actorId:string){
 const preview=await previewCostPlans(tx,source,request);ensure(preview.previewHash===previewHash,409,'PREVIEW_CHANGED','预览已变化，请重新核对');
 ensure(acknowledgedWarningIds.length===preview.warningIds.length&&preview.warningIds.every(id=>acknowledgedWarningIds.includes(id)),409,'WARNINGS_NOT_ACKNOWLEDGED','请确认本次全部合同期间提示');
 await assertDepreciationBudget(tx,source,preview.rows.filter(row=>!row.existingPlan));
 const created:any[]=[],existing:any[]=[];
 for(const row of preview.rows){
  if(row.existingPlan){existing.push(row.existingPlan);continue;}
  await assertNoCostOverlap(tx,source.vehicleId,source.sourceKind,row.periodStart,row.periodEnd);
  const {existingPlan,...calculatedRow}=row,sourceSnapshot=source.sourceKind==='WORK_ORDER'?source.terms:{version:1,sourceKind:source.sourceKind,sourceId:source.id,vehicleId:source.vehicleId,sourceRevision:source.revision,termsHash:source.termsHash,terms:source.terms,assetRevision:preview.assetRevision,algorithmVersion:preview.algorithmVersion,request,row:calculatedRow};
  const plan=await tx.assetCostPlan.create({data:{vehicleId:source.vehicleId,...sourceWhere(source),costPeriod:row.costPeriod,periodStart:storedDate(row.periodStart),periodEnd:storedDate(row.periodEnd),amount:row.amount,dueDate:row.dueDate?storedDate(row.dueDate):null,sourceRevision:source.revision,sourceHash:canonicalHash(sourceSnapshot),sourceSnapshot,status:'SCHEDULED',createdBy:actorId}});created.push(planView(plan));
 }
 return{created,existing,totalCreatedAmount:preview.totalCreatedAmount};
}
export async function validateCostPlan(tx:any,plan:any){
 let source=await loadCostSource(tx,sourceRef(plan));const snapshot=plan.sourceSnapshot;
 if(source.sourceKind==='WORK_ORDER'){validWorkPlan(plan,source);return source;}
 ensure(source.vehicleId===plan.vehicleId&&source.activatedAt&&source.status!=='DRAFT',409,'COST_SOURCE_MISMATCH','成本来源未真实启用或归属不一致');
 if(source.sourceKind==='BAAS'){
  ensure(Number.isSafeInteger(plan.sourceRevision)&&plan.sourceRevision>=0&&plan.sourceRevision<=source.revision,409,'COST_SOURCE_MISMATCH','计划来源版本不在真实合同版本范围内');
  const history=await tx.vehicleBaasContractRevision.findMany({where:{contractId:source.id},orderBy:{fromRevision:'asc'}});let nextRevision=0,original:any=null;
  for(const prior of history){ensure(prior.contractId===source.id&&prior.vehicleId===source.vehicleId&&Number.isSafeInteger(prior.fromRevision)&&Number.isSafeInteger(prior.toRevision)&&prior.fromRevision===nextRevision&&prior.toRevision>=prior.fromRevision&&prior.toRevision<source.revision,409,'COST_SOURCE_MISMATCH','合同历史来源区间不连续或归属不一致');if(plan.sourceRevision>=prior.fromRevision&&plan.sourceRevision<=prior.toRevision)original=prior;nextRevision=prior.toRevision+1;}
  if(original){const parsed=baasDraftInput.safeParse(original.termsSnapshot);ensure(parsed.success&&financialMissingFields(parsed.data).length===0&&canonicalHash(parsed.data)===original.termsHash,409,'COST_SOURCE_MISMATCH','合同历史条款摘要不一致');source={...source,termsHash:original.termsHash,terms:parsed.data,record:{...source.record,firstCostPeriod:original.firstCostPeriod??null}};}
  else ensure(plan.sourceRevision>=nextRevision,409,'COST_SOURCE_MISMATCH','计划来源版本缺少原合同条款');
 }
 ensure(snapshot&&snapshot.version===1&&snapshot.sourceKind===source.sourceKind&&snapshot.sourceId===source.id&&snapshot.vehicleId===source.vehicleId&&snapshot.sourceRevision===plan.sourceRevision&&snapshot.termsHash===source.termsHash&&canonicalHash(snapshot.terms)===source.termsHash&&canonicalHash(snapshot)===plan.sourceHash,409,'COST_SOURCE_MISMATCH','计划冻结来源或摘要不一致');
 const result=calculate(source,snapshot.request),row=result.rows.find(row=>row.costPeriod===plan.costPeriod);ensure(row,409,'COST_SOURCE_MISMATCH','原来源不包含该计划账期');
 const normalized={...row,dueDate:'dueDate'in row?row.dueDate:null,warningIds:'warningIds'in row?row.warningIds:[]};
 money.parse(plan.amount);ensure(snapshot.algorithmVersion===result.algorithmVersion&&canonicalHash(snapshot.row)===canonicalHash(normalized)&&dateOnly(plan.periodStart)===row.periodStart&&dateOnly(plan.periodEnd)===row.periodEnd&&plan.amount===row.amount&&(plan.dueDate?dateOnly(plan.dueDate):null)===normalized.dueDate,409,'COST_SOURCE_MISMATCH','计划金额或实际期间与冻结原明细不符');
 return source;
}
