import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,money} from '../common/data';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {requireAssetFiles} from '../files/asset-files';
import {assetCommand,type AssetLock} from '../asset-costs/command';
import {addMonths,periodEnd,periodOf} from '../asset-costs/calendar';
import {depreciationTerms,generateCostPlans,loadCostSource,planView,previewCostPlans,type CostSource,type PlanRequest} from '../asset-costs/source';
import {dateOnly,storedDate} from '../asset-costs/types';
import {assetVehicleSelect,assetVehicleView} from '../vehicle-assets/service';
import {depreciationActivateInput,depreciationArchiveInput,depreciationCreateInput,depreciationDraftInput,depreciationGenerateInput,depreciationListInput,depreciationPatchInput,depreciationPreviewInput} from './types';

export function depreciationView(row:any,vehicle?:any){return{id:row.id,vehicleId:row.vehicleId,revision:row.revision,status:row.status,...depreciationTerms(row),termsHash:row.termsHash,activatedAt:row.activatedAt??null,supersededAt:row.supersededAt??null,archivedAt:row.archivedAt??null,createdAt:row.createdAt,updatedAt:row.updatedAt,...(vehicle?{vehicle:assetVehicleView(vehicle)}:{})};}
const storedTerms=(terms:any)=>({...terms,startDate:storedDate(terms.startDate)});
function safeTotal(value:bigint){ensure(value>=0n&&value<=BigInt(Number.MAX_SAFE_INTEGER),409,'AMOUNT_OVERFLOW','折旧合计超出安全整数范围');return Number(value);}
function requestFor(source:CostSource,input:{manualPeriods?:any[]}):PlanRequest{
 ensure(source.terms.method==='MANUAL'?Array.isArray(input.manualPeriods):input.manualPeriods===undefined,400,'DEPRECIATION_REQUEST','手工法须明确逐期金额和依据；其他方法不接受手工期间');
 return{sourceKind:'DEPRECIATION',...(source.terms.method==='MANUAL'?{manualPeriods:input.manualPeriods}:{})};
}
export class DepreciationService{
 constructor(private readonly clock:()=>Date=()=>new Date()){}
 private async read(tx:any,id:string){const row=await tx.vehicleDepreciationPolicy.findUnique({where:{id}});ensure(row,404,'NOT_FOUND','折旧策略不存在');return row;}
 private async previous(tx:any,vehicleId:string,id:string|null,currentId?:string){if(!id)return null;const row=await this.read(tx,id);ensure(row.id!==currentId&&row.vehicleId===vehicleId&&row.activatedAt&&row.status!=='DRAFT',409,'DEPRECIATION_PREVIOUS_POLICY','前策略须是同车曾启用的其他策略');return row;}
 private async facts(tx:any,row:any){
  const plans=await tx.assetCostPlan.findMany({where:{sourceKind:'DEPRECIATION',depreciationPolicyId:row.id},orderBy:[{costPeriod:'asc'},{id:'asc'}]}),entries=plans.length?await tx.assetCostEntry.findMany({where:{planId:{in:plans.map((plan:any)=>plan.id)},category:'DEPRECIATION'}}):[];
  const sum=(rows:any[])=>rows.reduce<bigint>((total,entry)=>total+BigInt(money.parse(entry.amount)),0n),costs=entries.filter((entry:any)=>entry.effect==='COST'),reversals=entries.filter((entry:any)=>entry.effect==='REVERSAL'),confirmed=sum(costs),reversed=sum(reversals),locked=sum(costs.filter((entry:any)=>entry.lockedAt&&!reversals.some((reverse:any)=>reverse.reversalOfId===entry.id)));
  return{plans:plans.map(planView),totals:{confirmedAmount:safeTotal(confirmed),reversalAmount:safeTotal(reversed),netAmount:safeTotal(confirmed-reversed),lockedAmount:safeTotal(locked)}};
 }
 async list(tx:any,actor:StaffActor,raw:unknown){
  await requireCurrentStaff(tx,actor,'depreciation-policies',false);const input=depreciationListInput.parse(raw),where={...(input.vehicleId?{vehicleId:input.vehicleId}:{}),...(input.status?{status:input.status}:{})};
  const [rows,total]=await Promise.all([tx.vehicleDepreciationPolicy.findMany({where,include:{vehicle:{select:assetVehicleSelect}},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),tx.vehicleDepreciationPolicy.count({where})]);return{items:rows.map((row:any)=>depreciationView(row,row.vehicle)),total,page:input.page,pageSize:input.pageSize};
 }
 async detail(tx:any,actor:StaffActor,id:string){
  await requireCurrentStaff(tx,actor,'depreciation-policies',false);const row=await this.read(tx,id),vehicle=await tx.vehicle.findUnique({where:{id:row.vehicleId},select:assetVehicleSelect}),previous=await this.previous(tx,row.vehicleId,row.previousPolicyId,id);
  return{...depreciationView(row,vehicle),files:await requireAssetFiles(tx,actor,{kind:'DEPRECIATION',resourceId:id}),...await this.facts(tx,row),previousPolicy:previous?{...depreciationView(previous),...await this.facts(tx,previous)}:null};
 }
 async create(tx:any,actor:StaffActor,raw:unknown){
  const input=depreciationCreateInput.parse(raw);return assetCommand(tx,actor,'depreciation-policies','NEW','CREATE_DEPRECIATION',input,[input.vehicleId],[],async()=>{
   const vehicle=await tx.vehicle.findUnique({where:{id:input.vehicleId},select:assetVehicleSelect});ensure(vehicle,404,'NOT_FOUND','车辆不存在');ensure(vehicle.revision===input.vehicleRevision,409,'REVISION_CONFLICT','车辆资料已变化，请刷新');await this.previous(tx,input.vehicleId,input.previousPolicyId);
   const terms=depreciationDraftInput.parse(depreciationTerms(input)),row=await tx.vehicleDepreciationPolicy.create({data:{vehicleId:input.vehicleId,...storedTerms(terms),status:'DRAFT',termsHash:canonicalHash(terms),createdBy:actor.id,updatedBy:actor.id}});await audit(tx,actor.id,'CREATE_DEPRECIATION','depreciation-policies',row.id,{vehicleId:row.vehicleId,termsHash:row.termsHash});return depreciationView(row,vehicle);
  });
 }
 async update(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=depreciationPatchInput.parse(raw);await requireCurrentStaff(tx,actor,'depreciation-policies');const before=await this.read(tx,id);
  return assetCommand(tx,actor,'depreciation-policies',id,'UPDATE_DEPRECIATION',input,[before.vehicleId],[{table:'VehicleDepreciationPolicy',id}],async()=>{
   const row=await this.read(tx,id);ensure(row.status==='DRAFT',409,'DEPRECIATION_STATE','只有草稿可修改折旧条款');ensure(row.revision===input.revision,409,'REVISION_CONFLICT','策略已更新，请刷新');const{revision,idempotencyKey,...changes}=input,terms=depreciationDraftInput.parse({...depreciationTerms(row),...changes});await this.previous(tx,row.vehicleId,terms.previousPolicyId,id);
   const changed=await tx.vehicleDepreciationPolicy.updateMany({where:{id,revision,status:'DRAFT'},data:{...storedTerms(terms),termsHash:canonicalHash(terms),revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','策略已更新，请刷新');await audit(tx,actor.id,'UPDATE_DEPRECIATION','depreciation-policies',id,{revision:revision+1,previousTermsHash:row.termsHash,termsHash:canonicalHash(terms)});return this.detail(tx,actor,id);
  });
 }
 private async rejectOverlap(tx:any,row:any){
  const terms=depreciationDraftInput.parse(depreciationTerms(row)),end=terms.method==='STRAIGHT_LINE'?periodEnd(addMonths(periodOf(terms.startDate),terms.usefulLifeMonths!-1)):'9999-12-31';
  const plans=await tx.assetCostPlan.findMany({where:{vehicleId:row.vehicleId,sourceKind:'DEPRECIATION',status:{in:['SCHEDULED','CONFIRMED']},periodStart:{lte:storedDate(end)},periodEnd:{gte:storedDate(terms.startDate)}}}),conflicts:string[]=[];
  for(const plan of plans){if(plan.status==='SCHEDULED'){conflicts.push(plan.id);continue;}const entries=await tx.assetCostEntry.findMany({where:{planId:plan.id,effect:'COST'}});ensure(entries.length===1,409,'COST_SOURCE_MISMATCH','已确认计划缺少唯一原成本事实');if(!await tx.assetCostEntry.count({where:{reversalOfId:entries[0].id,effect:'REVERSAL'}}))conflicts.push(plan.id);}
  ensure(!conflicts.length,409,'COST_PERIOD_OVERLAP',`承接期间与有效旧计划或未冲正成本重叠，请先处理计划：${conflicts.join('、')}`);
 }
 async activate(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=depreciationActivateInput.parse(raw);await requireCurrentStaff(tx,actor,'depreciation-policies');const before=await this.read(tx,id),locks:AssetLock[]=[{table:'VehicleDepreciationPolicy',id},...(before.previousPolicyId?[{table:'VehicleDepreciationPolicy' as const,id:before.previousPolicyId}]:[])];
  return assetCommand(tx,actor,'depreciation-policies',id,'ACTIVATE_DEPRECIATION',input,[before.vehicleId],locks,async()=>{
   const row=await this.read(tx,id);ensure(row.status==='DRAFT',409,'DEPRECIATION_STATE','只有草稿可启用');ensure(row.revision===input.revision&&row.previousPolicyId===before.previousPolicyId,409,'REVISION_CONFLICT','策略已更新，请刷新');depreciationDraftInput.parse(depreciationTerms(row));await loadCostSource(tx,{sourceKind:'DEPRECIATION',depreciationPolicyId:id});
   const active=await tx.vehicleDepreciationPolicy.findMany({where:{vehicleId:row.vehicleId,status:'ACTIVE',id:{not:id}}});let previous:any=null;
   if(row.previousPolicyId){ensure(input.previousRevision!==undefined,409,'DEPRECIATION_PREVIOUS_POLICY','承接须明确前策略版本和原因');previous=await this.previous(tx,row.vehicleId,row.previousPolicyId,id);ensure(previous.revision===input.previousRevision,409,'REVISION_CONFLICT','前策略已变化，请核对最新累计事实');ensure(active.length===1&&active[0].id===previous.id&&previous.status==='ACTIVE',409,'DEPRECIATION_PREVIOUS_POLICY','当前有效策略须与明确承接的前策略一致');}
   else{ensure(input.previousRevision===undefined,409,'DEPRECIATION_PREVIOUS_POLICY','普通启用不填写前策略版本');ensure(active.length===0,409,'DEPRECIATION_ACTIVE_CONFLICT','该车辆已有有效折旧策略');}
   await requireAssetFiles(tx,actor,{kind:'DEPRECIATION',resourceId:id,required:true});await this.rejectOverlap(tx,row);
   const activatedAt=this.clock();if(previous){const changed=await tx.vehicleDepreciationPolicy.updateMany({where:{id:previous.id,revision:input.previousRevision,status:'ACTIVE'},data:{status:'SUPERSEDED',supersededAt:activatedAt,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','前策略已变化');await audit(tx,actor.id,'SUPERSEDE_DEPRECIATION','depreciation-policies',previous.id,{successorId:id,reason:input.reason,revision:previous.revision+1});}
   const changed=await tx.vehicleDepreciationPolicy.updateMany({where:{id,revision:input.revision,status:'DRAFT'},data:{status:'ACTIVE',activatedAt,revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','策略已变化');await audit(tx,actor.id,'ACTIVATE_DEPRECIATION','depreciation-policies',id,{reason:input.reason,previousPolicyId:previous?.id??null,previousRevision:input.previousRevision??null,revision:input.revision+1,termsHash:row.termsHash});return this.detail(tx,actor,id);
  });
 }
 async archive(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=depreciationArchiveInput.parse(raw);await requireCurrentStaff(tx,actor,'depreciation-policies');const before=await this.read(tx,id);
  return assetCommand(tx,actor,'depreciation-policies',id,'ARCHIVE_DEPRECIATION',input,[before.vehicleId],[{table:'VehicleDepreciationPolicy',id}],async()=>{
   const row=await this.read(tx,id);ensure(row.revision===input.revision,409,'REVISION_CONFLICT','策略已变化');ensure(['DRAFT','ACTIVE','SUPERSEDED'].includes(row.status),409,'DEPRECIATION_STATE','策略已归档');const changed=await tx.vehicleDepreciationPolicy.updateMany({where:{id,revision:input.revision,status:row.status},data:{status:'ARCHIVED',archivedAt:this.clock(),revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','策略已变化');await audit(tx,actor.id,'ARCHIVE_DEPRECIATION','depreciation-policies',id,{reason:input.reason,previousStatus:row.status,revision:input.revision+1});return this.detail(tx,actor,id);
  });
 }
 async preview(tx:any,actor:StaffActor,id:string,raw:unknown){await requireCurrentStaff(tx,actor,'depreciation-policies',false);const input=depreciationPreviewInput.parse(raw),source=await loadCostSource(tx,{sourceKind:'DEPRECIATION',depreciationPolicyId:id});return{policyId:id,...await previewCostPlans(tx,source,requestFor(source,input))};}
 async generate(tx:any,actor:StaffActor,id:string,raw:unknown){
  const input=depreciationGenerateInput.parse(raw);await requireCurrentStaff(tx,actor,'depreciation-policies');const before=await this.read(tx,id);
  return assetCommand(tx,actor,'depreciation-policies',id,'GENERATE_DEPRECIATION_PLANS',input,[before.vehicleId],[{table:'VehicleDepreciationPolicy',id}],async()=>{
   const source=await loadCostSource(tx,{sourceKind:'DEPRECIATION',depreciationPolicyId:id});ensure(source.revision===input.revision,409,'REVISION_CONFLICT','策略已变化，请重新预览');const request=requestFor(source,input),generated=await generateCostPlans(tx,source,request,input.previewHash,input.acknowledgedWarningIds,actor.id);
   const changed=await tx.vehicleDepreciationPolicy.updateMany({where:{id,revision:input.revision,status:'ACTIVE'},data:{revision:{increment:1},updatedBy:actor.id}});ensure(changed.count===1,409,'REVISION_CONFLICT','策略已变化，请重新预览');await audit(tx,actor.id,'GENERATE_DEPRECIATION_PLANS','depreciation-policies',id,{revision:input.revision+1,previewHash:input.previewHash,request,createdPlanIds:generated.created.map(row=>row.id),existingPlanIds:generated.existing.map(row=>row.id),totalCreatedAmount:generated.totalCreatedAmount});return{policyId:id,revision:input.revision+1,...generated};
  });
 }
}
