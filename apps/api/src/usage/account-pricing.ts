import {ensure} from '../common/errors';
import {readUsagePricing,resolveUsagePricing} from './pricing';
import {day,shanghaiDay} from './rules';

/** A historical account stays readable; only a real current period can authorize new purchases. */
export async function readAccountPricing(tx:any,order:any,account:any,periods:any[],at:Date){
 const today=shanghaiDay(at),initialPricing=resolveUsagePricing(order,account);
 const ended=!!account.returnedOn||['SETTLING','COMPLETED','CANCELLED'].includes(order.status);
 const voided=tx.orderServiceStage?await tx.orderServiceStage.findMany({where:{orderId:order.id,status:'VOIDED'},select:{id:true}}):[];
 const actual=periods.filter(p=>p.status!=='CANCELLED'&&!voided.some((s:any)=>s.id===p.serviceStageId));
 const current=ended?[]:actual.filter(p=>day(p.startDate)<=today&&today<day(p.endDate));
 ensure(current.length<=1,409,'USAGE_PERIOD_CONTINUITY','当前服务月存在重叠，请核对已生效租期');
 if(current.length)return{pricing:await readUsagePricing(tx,order,account,undefined,at),initialPricing,servicePeriod:{status:'CURRENT' as const,periodId:current[0].id}};
 const cutoff=account.returnedOn?day(account.returnedOn):today;
 const historical=actual.filter(p=>day(p.startDate)<=cutoff).sort((a,b)=>b.sequence-a.sequence)[0];
 const pricing=historical?await readUsagePricing(tx,order,account,historical,at):initialPricing;
 return{pricing,initialPricing,servicePeriod:{status:ended?'ENDED' as const:'NO_ACTIVE_PERIOD' as const,periodId:historical?.id??null}};
}
