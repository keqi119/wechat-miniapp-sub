import {z} from 'zod';
import {ensure} from '../common/errors';
import {coverageItemInput,policyReviewCheckInput,CoverageResult,InsuranceTx} from './types';
import {activatedStatus,effectivePolicyVersion,validRegistration} from './registration-facts';
export function policyDateTime(value:string,endDate=false):Date {
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
  const utc=new Date(value+'T00:00:00.000Z');ensure(Number.isFinite(utc.getTime())&&utc.toISOString().slice(0,10)===value,400,'INSURANCE_DATE_INVALID','保单日期无效');
  return new Date(utc.getTime()-8*3600000+(endDate?86400000:0));
 }
 ensure(z.iso.datetime({offset:true}).safeParse(value).success,400,'INSURANCE_DATE_INVALID','保单时间须有明确时区');return new Date(value);
}
const date=z.union([z.date(),z.string().datetime({offset:true}).transform(value=>new Date(value))]);
const coverageVersion=z.object({id:z.string(),policyId:z.string(),version:z.number(),status:z.string(),changeKind:z.string(),effectiveAt:date,startAt:date,endAt:date,vehicleIds:z.array(z.string()),coverageItems:z.unknown(),requirementVersionIds:z.unknown(),fileIds:z.unknown(),reviewChecks:z.unknown()}).passthrough();
export type CoverageFacts={vehicleId:string;modelDefinitionId:string|null;productVersionId:string;requirements:unknown[];versions:unknown[];configurationMissing?:boolean};
export function evaluateCoverage(facts:CoverageFacts,at:Date):CoverageResult {
 const blockers:CoverageResult['blockers']=[],policyVersionIds:string[]=[],requirementIds:string[]=[];
 const block=(code:string,label:string,resourceId=facts.vehicleId)=>blockers.push({code,label,resourceType:'insurance-policies',resourceId});
 if(!Number.isFinite(at.getTime())){block('INSURANCE_TIME_INVALID','保障检查时间无效');return {ready:false,blockers,policyVersionIds,requirementIds};}
 const versions=facts.versions.flatMap(raw=>{const parsed=coverageVersion.safeParse(raw);return parsed.success?[parsed.data]:[];});
 const byPolicy=new Map<string,typeof versions>();
 // Group before filtering the vehicle: a later endorsement removing this vehicle must supersede the old scope.
 for(const v of versions){const rows=byPolicy.get(v.policyId)||[];rows.push(v);byPolicy.set(v.policyId,rows);}
 const active:typeof versions=[];
 for(const [policyId,rows] of byPolicy){
  if(!rows.some(v=>v.vehicleIds.includes(facts.vehicleId)))continue;
  const current=effectivePolicyVersion(rows,at);
  if(!current){block(rows.some(v=>activatedStatus(v.status))?'INSURANCE_POLICY_NOT_STARTED':'INSURANCE_POLICY_UNREVIEWED',rows.some(v=>activatedStatus(v.status))?'保单尚未生效':'保单尚未完成原件登记或独立审核',policyId);continue;}
  if(!current.vehicleIds.includes(facts.vehicleId)){block('INSURANCE_VEHICLE_REMOVED','批改后该车辆不在保障范围',current.id);continue;}
  if(current.changeKind==='CANCELLATION'){block('INSURANCE_POLICY_CANCELLED','保单已按退保批改生效',current.id);continue;}
  if(at<current.startAt){block('INSURANCE_POLICY_NOT_STARTED','保单尚未开始保障',current.id);continue;}
  if(at>=current.endAt){block('INSURANCE_POLICY_EXPIRED','保单已到期',current.id);continue;}
  if(current.status==='REGISTERED'){
   if(!validRegistration(current,facts.vehicleId)){block('INSURANCE_POLICY_UNVERIFIED','该车辆的原件登记证据不完整',current.id);continue;}
   if(facts.requirements.some(raw=>typeof raw==='object'&&raw!==null&&'items' in raw&&Array.isArray(raw.items)&&raw.items.length>0)){block('INSURANCE_REQUIREMENTS_UNVERIFIED','已登记保单原件，具体险种及额度仍无法逐项核验',current.id);continue;}
   active.push(current);continue;
  }
  const checks=z.array(policyReviewCheckInput).min(1).safeParse(current.reviewChecks);
  // Select the effective version before validating its files, so malformed new evidence cannot revive an older version.
  const files=z.array(z.string().min(1)).min(1).safeParse(current.fileIds);
  const coverage=z.array(coverageItemInput).min(1).safeParse(current.coverageItems);
  const verified=coverage.success&&checks.success&&files.success&&checks.data.some(check=>check.vehicleId===facts.vehicleId&&files.data.includes(check.fileId)&&(!('itemCode' in check)||coverage.data.some(item=>item.code===check.itemCode)));
  if(!verified){block('INSURANCE_POLICY_UNVERIFIED','尚未核实该车辆的保单原件与保障事实',current.id);continue;}
  active.push(current);
 }
 // Retired requirement rules never alter approved historical policy facts. A valid overlapping policy remains sufficient.
 for(const version of active)policyVersionIds.push(version.id);
 if(active.length)return {ready:true,blockers:[],policyVersionIds,requirementIds};
 if(!blockers.length)block('INSURANCE_POLICY_MISSING','车辆没有当前可用的原件登记或已复核保单');
 return {ready:false,blockers,policyVersionIds,requirementIds};
}
export async function requirementsAt(tx:InsuranceTx,modelDefinitionId:string|null,productVersionId:string,at:Date){
 const scopes=await tx.coverageRequirement.findMany({where:{OR:[{scopeType:'MODEL',scopeId:modelDefinitionId||'__MISSING__'},{scopeType:'PRODUCT',scopeId:productVersionId}]},include:{versions:{where:{effectiveAt:{lte:at}},orderBy:[{effectiveAt:'desc'},{version:'desc'}],take:1}}});
 const model=scopes.find(s=>s.scopeType==='MODEL'),product=scopes.find(s=>s.scopeType==='PRODUCT');
 return {requirements:scopes.flatMap(s=>s.versions),configurationMissing:!model?.versions.length||Boolean(product&&!product.versions.length)};
}
export async function coverageAt(tx:InsuranceTx,vehicleId:string,productVersionId:string,at:Date):Promise<CoverageResult>{
 const vehicle=await tx.vehicle.findUnique({where:{id:vehicleId},select:{modelDefinitionId:true}});
 const product=await tx.productVersion.findUnique({where:{id:productVersionId},select:{id:true}});
 if(!vehicle||!product)return {ready:false,blockers:[{code:!vehicle?'INSURANCE_VEHICLE_MISSING':'INSURANCE_PRODUCT_MISSING',label:!vehicle?'被保车辆不存在':'对应产品版本不存在',resourceType:!vehicle?'vehicles':'products',resourceId:!vehicle?vehicleId:productVersionId}],policyVersionIds:[],requirementIds:[]};
 const policies=await tx.insurancePolicy.findMany({where:{versions:{some:{vehicleIds:{has:vehicleId}}}},include:{versions:true}});
 return evaluateCoverage({vehicleId,modelDefinitionId:vehicle.modelDefinitionId,productVersionId,requirements:[],versions:policies.flatMap(p=>p.versions)},at);
}
