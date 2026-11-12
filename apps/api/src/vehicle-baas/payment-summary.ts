import {ensure} from '../common/errors';
import {dateOnly} from '../asset-costs/types';

export type BaasPaymentSummary={nextDueDate:string|null;unpaidCostCount:number;scheduledCostCount:number;costPlanCount:number};
/** Read existing ledger facts only. No rent prediction, posting, or payment action. */
export async function readBaasPaymentSummaries(tx:any,contracts:{id:string;vehicleId:string}[]){
 const result=new Map<string,BaasPaymentSummary>(contracts.map(row=>[row.id,{nextDueDate:null,unpaidCostCount:0,scheduledCostCount:0,costPlanCount:0}]));
 if(!contracts.length)return result;
 const vehicleIds=new Map(contracts.map(row=>[row.id,row.vehicleId]));
 const plans=await tx.assetCostPlan.findMany({where:{sourceKind:'BAAS',baasContractId:{in:contracts.map(row=>row.id)},status:{in:['SCHEDULED','CONFIRMED']}},
  select:{id:true,vehicleId:true,baasContractId:true,sourceKind:true,status:true,amount:true,dueDate:true,entries:{where:{effect:'COST'},select:{id:true,vehicleId:true,category:true,effect:true,amount:true,reversedBy:{select:{id:true}},payments:{select:{status:true,amount:true}}}}}});
 for(const plan of plans){
  const summary=result.get(plan.baasContractId);
  ensure(summary&&plan.sourceKind==='BAAS'&&plan.vehicleId===vehicleIds.get(plan.baasContractId)&&['SCHEDULED','CONFIRMED'].includes(plan.status)&&Number.isSafeInteger(plan.amount)&&plan.amount>0,409,'COST_SOURCE_MISMATCH','BaaS成本归属或金额待核对');
  summary.costPlanCount++;
  let pending=false;
  if(plan.status==='SCHEDULED'){
   ensure(plan.entries.length===0,409,'COST_SOURCE_MISMATCH','待确认成本计划存在异常分录');summary.scheduledCostCount++;pending=true;
  }else{
   ensure(plan.entries.length===1,409,'COST_SOURCE_MISMATCH','BaaS确认成本分录待核对');
   const entry=plan.entries[0];
   ensure(entry.vehicleId===plan.vehicleId&&entry.category==='BAAS_RENT'&&entry.effect==='COST'&&entry.amount===plan.amount,409,'COST_SOURCE_MISMATCH','BaaS成本分录与计划不一致');
   const payments=entry.payments.filter((row:any)=>row.status==='RECORDED');
   ensure(payments.length<=1&&payments.every((row:any)=>row.amount===entry.amount)&&!(entry.reversedBy&&payments.length),409,'COST_SOURCE_MISMATCH','BaaS付款或冲正记录待核对');
   if(!entry.reversedBy&&!payments.length){summary.unpaidCostCount++;pending=true;}
  }
  if(pending&&plan.dueDate){const day=dateOnly(plan.dueDate);if(!summary.nextDueDate||day<summary.nextDueDate)summary.nextDueDate=day;}
 }
 return result;
}
