import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {day} from './rules';
import {addonTerms,quoteMatches} from '../addon-products/policy';
export const isMonthlyPack=(p:any)=>p.ruleVersion==='MILEAGE_PACK_V2';
export function packApplicableToPeriod(pack:any,period:any){return isMonthlyPack(pack)?pack.applicablePeriodId===period.id:pack.applicableFromSequence<=period.sequence;}
export function packBalanceProjection(packs:any[],currentPeriodId:string|undefined,now:Date){
 let packBalanceKm=0,historicalPendingPackBalanceKm=0;
 for(const p of packs.filter(p=>p.status==='ACTIVE')){if(!isMonthlyPack(p)||p.applicablePeriodId===currentPeriodId&&new Date(p.expiresAt)>now)packBalanceKm+=p.remainingKm;else historicalPendingPackBalanceKm+=p.remainingKm;}
 return{packBalanceKm,historicalPendingPackBalanceKm};
}
export function monthlyReceiptBlocker(p:any,period:any,order:any,account:any,successAt:Date|undefined,received:boolean){
 if(!period||period.id!==p.applicablePeriodId||['SETTLED','CANCELLED'].includes(period.status))return'MILEAGE_PERIOD_SETTLED';
 if(received||account.returnedOn||account.packStatus!=='ACTIVE'||order.status!=='ACTIVE')return'MILEAGE_RETURNED';
 if(!successAt||successAt<new Date(p.createdAt)||successAt>=new Date(p.expiresAt)||successAt>=new Date(day(period.effectiveEndDate)+'T00:00:00+08:00'))return'MILEAGE_MONTH_CLOSED';
 return null;
}
export async function validateMonthlyPack(tx:any,p:any,account:any,bill:any){
 const s=p.pricingSnapshot,terms=addonTerms('MILEAGE_PACK');
 ensure(s?.quote&&typeof s.quote.quoteId==='string'&&Array.isArray(s.source?.scopePrices)&&s.source?.terms&&p.expiresAt instanceof Date&&Number.isFinite(p.expiresAt.getTime()),409,'PACK_SOURCE','月包冻结报价或期限缺失');
 ensure(s?.version===2&&s.source?.kind==='MILEAGE_PACK'&&p.sourceHash===canonicalHash(s.source)&&s.sourceHash===p.sourceHash&&p.addonVersionId===s.versionId&&p.productVersion===s.productVersion&&p.applicablePeriodId===s.periodId&&p.assignmentId===s.assignmentId&&p.modelDefinitionId===s.modelDefinitionId&&p.serviceStageId===s.serviceStageId&&new Date(p.expiresAt).toISOString()===s.expiresAt&&p.accountId===account.id&&p.orderId===bill.orderId&&p.customerId===bill.customerId&&account.customerId===bill.customerId&&p.amount===bill.amount,409,'PACK_SOURCE','月包与付款、计费月或冻结商品来源不符');
 const period=await tx.usagePeriod.findUnique({where:{id:p.applicablePeriodId}}),a=await tx.vehicleAssignment.findUnique({where:{id:p.assignmentId},include:{vehicle:true}}),model=await tx.modelDefinition.findUnique({where:{id:p.modelDefinitionId}});
 ensure(period?.accountId===account.id&&period.orderId===bill.orderId&&period.sequence===p.applicableFromSequence&&(period.serviceStageId??null)===(p.serviceStageId??null)&&a?.orderId===bill.orderId&&a.customerId===bill.customerId&&model&&a.vehicle?.modelDefinitionId===model.id&&model.brand===s.brand,409,'PACK_SOURCE','月包真实月份或车辆来源不符');
 const quote=quoteMatches(s.source.scopePrices,model).find((q:any)=>q.quoteId===s.quote.quoteId);
 ensure(quote&&quote.amount===p.amount&&quote.km===p.km&&canonicalHash(quote)===canonicalHash(s.quote)&&canonicalHash(s.source.terms)===canonicalHash(terms)&&p.termsSnapshot?.version===terms.version&&p.termsSnapshot?.hash===terms.hash&&p.termsSnapshot?.accepted===true,409,'PACK_CONSENT','月包报价或独立说明快照无效');
 return period;
}
export async function expireMonthlyPeriodPacks(tx:any,account:any,periodId:string){
 const packs=await tx.mileagePurchase.findMany({where:{accountId:account.id,ruleVersion:'MILEAGE_PACK_V2',applicablePeriodId:periodId,status:'ACTIVE'}});
 for(const p of packs){if(p.remainingKm)await tx.mileageLedger.create({data:{accountId:account.id,packId:p.id,periodId,type:'EXPIRE',deltaKm:-p.remainingKm,sourceKey:'monthly-expire:'+p.id}});await tx.mileagePurchase.update({where:{id:p.id},data:{status:'EXPIRED',remainingKm:0}});}
}
