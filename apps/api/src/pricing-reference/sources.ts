import {calendarDay,durationProrationCents,servicePeriods} from '../service-calendar/rules';
import {previewBaasSchedule} from '../vehicle-baas/schedule';
import {addMonths,monthsBetween} from '../asset-costs/calendar';
import {effectivePolicyVersion,validRegistration} from '../insurance/registration-facts';
export const isoDay=(v:any)=>new Date(v).toISOString().slice(0,10);
export const effectiveInstant=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(calendarDay(value).getTime()-8*3600000).toISOString():new Date(value).toISOString();
export function purchaseAgeMonths(purchase:string|null,registration:string|null,pricingDate:string){return purchase&&registration&&purchase<=pricingDate?purchase<=registration?0:ageMonths(registration,purchase):null;}
const ms=(v:string)=>calendarDay(v).getTime();
export function ageMonths(start:string,end:string){
 const a=calendarDay(start),b=calendarDay(end);let months=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
 if(months<0)return months;
 const periods=servicePeriods({firstStartDay:start,anchorDay:a.getUTCDate(),ruleVersion:'V31'},months+1,1)[0];
 if(end<periods.startDay){months--;const p=servicePeriods({firstStartDay:start,anchorDay:a.getUTCDate(),ruleVersion:'V31'},months+1,1)[0];return months+(ms(end)-ms(p.startDay))/(ms(p.endDayExclusive)-ms(p.startDay));}
 return months+(ms(end)-ms(periods.startDay))/(ms(periods.endDayExclusive)-ms(periods.startDay));
}
export function selectReviews(rows:any[],pricingDate:string,cutoff:string){
 const latest=new Map<string,any>();for(const row of rows){if(new Date(row.createdAt)>new Date(cutoff)||Date.parse(effectiveInstant(row.payload.effectiveAt))>Date.parse(cutoff))continue;const prev=latest.get(row.lineageId);if(!prev||row.version>prev.version)latest.set(row.lineageId,row);}
 return [...latest.values()].filter(r=>!r.payload.withdrawn&&r.payload.observedAt<=pricingDate);
}
export type CostInterval={start:string,end:string,amount:number};
/** Cost intervals are half-open. Unknown gaps stay unknown; an explicit monthly budget covers gaps only. */
export function coveredCost(start:string,end:string,intervals:CostInterval[],monthlyBudget?:number){
 let total=0,missingDays=0,ambiguous=false;const first=ms(start),last=ms(end),days=new Map<number,{count:number,amount:number}>();
 for(const p of intervals){const from=ms(p.start),to=ms(p.end);if(to<=from)throw new Error('INVALID_COST_INTERVAL');for(let t=Math.max(from,first);t<Math.min(to,last);t+=86400000){const old=days.get(t)??{count:0,amount:0};days.set(t,{count:old.count+1,amount:old.amount+p.amount/((to-from)/86400000)});}}
 for(let t=first;t<last;t+=86400000){const covering=days.get(t);if(covering&&covering.count>1){ambiguous=true;continue;}
  if(covering){total+=covering.amount;}
  else if(monthlyBudget!==undefined){const d=new Date(t);const days=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();total+=monthlyBudget/days;}else missingDays++;
 }
 const amount=missingDays||ambiguous?null:Math.round(total);if(amount!==null&&!Number.isSafeInteger(amount))throw new Error('COST_OVERFLOW');return {amount,missingDays,ambiguous};
}
export function baasIntervals(contracts:any[],evaluationStart?:string,evaluationEnd?:string):CostInterval[]{const result:CostInterval[]=[];for(const c of contracts){if(c.status!=='ACTIVE'||!c.effectiveFrom||(!c.effectiveTo&&!evaluationEnd)||!c.billingCycle||!c.firstCostPeriod||c.rentalAmount==null||!c.paymentDayOfMonth)continue;
 const start=isoDay(c.effectiveFrom),end=c.effectiveTo?new Date(ms(isoDay(c.effectiveTo))+86400000).toISOString().slice(0,10):evaluationEnd!,cycle=({MONTHLY:1,QUARTERLY:3,YEARLY:12} as Record<string,number>)[c.billingCycle];if(!cycle)continue;
 const offset=evaluationStart?Math.max(0,Math.floor(monthsBetween(c.firstCostPeriod,evaluationStart.slice(0,7))/cycle)*cycle):0,fromPeriod=addMonths(c.firstCostPeriod,offset),until=evaluationEnd&&evaluationEnd<end?evaluationEnd:end;
 // Evaluation end is exclusive; only the last covered day belongs to a cycle.
 const lastPeriod=new Date(ms(until)-86400000).toISOString().slice(0,7),distance=monthsBetween(fromPeriod,lastPeriod);
 if(distance<0)continue;
 // A 120-month interval starting midmonth can span 121 calendar periods.
 // Chunk previews without changing their original phase or silently losing cost.
 for(let offset=0;offset<=distance;offset+=120*cycle){
 const chunkFrom=addMonths(fromPeriod,offset),chunkTo=addMonths(fromPeriod,Math.min(distance,offset+119*cycle));
 const schedule=previewBaasSchedule({fromPeriod:chunkFrom,toPeriod:chunkTo,firstCostPeriod:c.firstCostPeriod,billingCycle:c.billingCycle,rentalAmount:c.rentalAmount,paymentDayOfMonth:c.paymentDayOfMonth,effectiveFrom:start,effectiveTo:c.effectiveTo?isoDay(c.effectiveTo):null});
 for(const p of schedule.rows){const originalEnd=new Date(ms(p.periodEnd)+86400000).toISOString().slice(0,10),from=p.periodStart<start?start:p.periodStart,to=originalEnd>end?end:originalEnd;if(to<=from)continue;result.push({start:from,end:to,amount:durationProrationCents(p.amount,ms(to)-ms(from),ms(originalEnd)-ms(p.periodStart))});}
 }}return result;}

/** Materialized plans override their own days, never the rest of the contract. */
export function baasCost(start:string,end:string,contracts:any[],plans:any[],monthlyBudget?:number){
 const known=baasIntervals(contracts,start,end),actual=plans.filter(p=>contracts.some(c=>c.id===p.baasContractId&&c.status==='ACTIVE')).map(p=>({start:isoDay(p.periodStart),end:new Date(ms(isoDay(p.periodEnd))+86400000).toISOString().slice(0,10),amount:p.amount})),merged:CostInterval[]=[];
 const prepared=(rows:CostInterval[])=>rows.map(p=>({...p,from:ms(p.start),to:ms(p.end)})),a=prepared(actual),k=prepared(known);
 for(let t=ms(start);t<ms(end);t+=86400000){const overrides=a.filter(p=>p.from<=t&&p.to>t),rows=overrides.length?overrides:k.filter(p=>p.from<=t&&p.to>t);for(const p of rows)merged.push({start:new Date(t).toISOString().slice(0,10),end:new Date(t+86400000).toISOString().slice(0,10),amount:p.amount/((p.to-p.from)/86400000)});}
 return coveredCost(start,end,merged,monthlyBudget);
}

/** Insurance timestamps are actual instants; evaluation dates are Shanghai days.
 * Split at known endorsements and coverage boundaries before allocating premium. */
export function insuranceCost(start:string,end:string,policies:any[],vehicleId:string,cutoff:string,monthlyBudget?:number){
 const first=ms(start)-8*3600000,last=ms(end)-8*3600000,known=policies.map(p=>({...p,versions:p.versions.filter((v:any)=>new Date(v.createdAt).getTime()<=Date.parse(cutoff))})),boundaries=new Set<number>([first,last]);
 for(let t=first;t<last;t+=86400000)boundaries.add(t);
 for(const p of known)for(const v of p.versions)for(const field of ['effectiveAt','startAt','endAt']){const t=new Date(v[field]).getTime();if(t>first&&t<last)boundaries.add(t);}
 const points=[...boundaries].sort((a,b)=>a-b);let amount=0,missingMs=0;const sourceVersionIds=new Set<string>();
 for(let i=0;i<points.length-1;i++){const from=points[i],to=points[i+1],active:any[]=known.map(p=>effectivePolicyVersion<any>(p.versions,new Date(from))).filter((v:any)=>v&&v.changeKind!=='CANCELLATION'&&v.vehicleIds.includes(vehicleId)&&v.vehicleIds.length===1&&v.premiumAmount!==null&&new Date(v.startAt).getTime()<=from&&new Date(v.endAt).getTime()>=to&&(v.status!=='REGISTERED'||validRegistration(v,vehicleId)));
  const types=active.map((v:any)=>v.policyType),complete=types.includes('COMPULSORY_TRAFFIC')&&types.includes('COMMERCIAL')&&new Set(types).size===types.length;
  for(const v of active){sourceVersionIds.add(v.id);amount+=v.premiumAmount*(to-from)/(new Date(v.endAt).getTime()-new Date(v.startAt).getTime());}
  if(!complete){if(monthlyBudget!==undefined){const local=new Date(from+8*3600000),days=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0)).getUTCDate();amount+=monthlyBudget*(to-from)/(days*86400000);}else missingMs+=to-from;}
 }
 const rounded=Math.round(amount);if(!Number.isSafeInteger(rounded))throw new Error('COST_OVERFLOW');return {amount:missingMs?null:rounded,missingDays:missingMs/86400000,sourceVersionIds:[...sourceVersionIds]};
}
