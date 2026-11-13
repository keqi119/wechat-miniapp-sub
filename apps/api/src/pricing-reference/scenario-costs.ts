import {Q} from './engine';
import type {ExactFraction,PricingCostBreakdown,PricingVehicleInput} from './engine-types';
import type {ScenarioV2} from './types';
import {isoDay} from './sources';
import {calendarDay,servicePeriods} from '../service-calendar/rules';
import {effectivePolicyVersion,validRegistration} from '../insurance/registration-facts';
import {addMonths,monthsBetween} from '../asset-costs/calendar';
import {previewBaasSchedule} from '../vehicle-baas/schedule';

const zero=Q.of(0),one=Q.of(1),twelve=Q.of(12),dayMs=86400000;
const ms=(day:string)=>calendarDay(day).getTime();
const fraction=(q:Q|null):ExactFraction|null=>q===null?null:{numerator:String(q.n),denominator:String(q.d)};
const total=(values:(Q|null)[])=>values.some(v=>v===null)?null:values.reduce<Q>((a,b)=>a.add(b!),zero);
const scaled=(value:number|null,factor:Q)=>factor.cmp(zero)===0?zero:value===null?null:Q.of(value).mul(factor);
/** Calendar month fractions remain rational until the final cents display. */
function monthSpan(start:string,end:string):Q {
 const a=calendarDay(start),b=calendarDay(end);let months=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
 const period=(n:number)=>servicePeriods({firstStartDay:start,anchorDay:a.getUTCDate(),ruleVersion:'V31'},n+1,1)[0];
 let p=period(months);if(end<p.startDay)p=period(--months);
 return Q.of(months).add(Q.of(ms(end)-ms(p.startDay)).div(Q.of(ms(p.endDayExclusive)-ms(p.startDay))));
}
function amortizedMonths(start:string,months:number,from:string,to:string):Q {
 const anchor={firstStartDay:start,anchorDay:calendarDay(start).getUTCDate(),ruleVersion:'V31' as const};
 const periods=Array.from({length:Math.ceil(months/120)},(_,chunk)=>servicePeriods(anchor,chunk*120+1,Math.min(120,months-chunk*120))).flat();
 return periods.reduce((sum,p)=>{const overlap=Math.min(ms(to),ms(p.endDayExclusive))-Math.max(ms(from),ms(p.startDay));return overlap>0?sum.add(Q.of(overlap).div(Q.of(ms(p.endDayExclusive)-ms(p.startDay)))):sum;},zero);
}
function budgetForDay(at:number,monthly:Q):Q {
 const d=new Date(at),days=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 return monthly.div(Q.of(days));
}
type Coverage={amount:number|null;exact:Q|null;missingDays:number;ambiguous?:boolean;sourceVersionIds?:string[];actual:boolean;budgetUsed:boolean};
type BaasBasis={from:number;to:number;amount:number;periodMs:number};
/** Clip coverage only; signed rental amounts always retain the original cycle divisor. */
function signedBaasBasis(contracts:any[],start:string,end:string):BaasBasis[]{
 const rows:BaasBasis[]=[];
 for(const c of contracts){
  if(c.status!=='ACTIVE'||!c.effectiveFrom||!c.billingCycle||!c.firstCostPeriod||c.rentalAmount==null||!c.paymentDayOfMonth)continue;
  const cycle=({MONTHLY:1,QUARTERLY:3,YEARLY:12} as Record<string,number>)[c.billingCycle];if(!cycle)continue;
  const contractStart=ms(isoDay(c.effectiveFrom)),contractEnd=c.effectiveTo?ms(isoDay(c.effectiveTo))+dayMs:ms(end),until=Math.min(ms(end),contractEnd);
  const offset=Math.max(0,Math.floor(monthsBetween(c.firstCostPeriod,start.slice(0,7))/cycle)*cycle),fromPeriod=addMonths(c.firstCostPeriod,offset);
  const lastPeriod=new Date(until-dayMs).toISOString().slice(0,7),distance=monthsBetween(fromPeriod,lastPeriod);
  // The original phase also survives previews longer than the schedule's 120-row limit.
  for(let chunk=0;chunk<=distance;chunk+=120*cycle){
   const schedule=previewBaasSchedule({fromPeriod:addMonths(fromPeriod,chunk),toPeriod:addMonths(fromPeriod,Math.min(distance,chunk+119*cycle)),firstCostPeriod:c.firstCostPeriod,billingCycle:c.billingCycle,rentalAmount:c.rentalAmount,paymentDayOfMonth:c.paymentDayOfMonth,effectiveFrom:isoDay(c.effectiveFrom),effectiveTo:c.effectiveTo?isoDay(c.effectiveTo):null});
   for(const p of schedule.rows){const originalStart=ms(p.periodStart),originalEnd=ms(p.periodEnd)+dayMs,from=Math.max(originalStart,contractStart),to=Math.min(originalEnd,contractEnd);if(to>from)rows.push({from,to,amount:p.amount,periodMs:originalEnd-originalStart});}
  }
 }
 return rows;
}
/** Plans replace only their covered days; budgets never replace signed cost. */
function exactBaas(start:string,end:string,contracts:any[],plans:any[],monthly:Q|null):Coverage {
 const prepared=(rows:{start:string,end:string,amount:number}[]):BaasBasis[]=>rows.map(r=>({amount:r.amount,from:ms(r.start),to:ms(r.end),periodMs:ms(r.end)-ms(r.start)}));
 const known=signedBaasBasis(contracts,start,end);
 const actual=prepared(plans.filter(p=>contracts.some(c=>c.id===p.baasContractId&&c.status==='ACTIVE')).map(p=>({start:isoDay(p.periodStart),end:new Date(ms(isoDay(p.periodEnd))+dayMs).toISOString().slice(0,10),amount:p.amount})));
 let amount=zero,missingDays=0,ambiguous=false,hasActual=false,budgetUsed=false;
 for(let t=ms(start);t<ms(end);t+=dayMs){const overrides=actual.filter(p=>p.from<=t&&p.to>t),rows=overrides.length?overrides:known.filter(p=>p.from<=t&&p.to>t);
  if(rows.length>1){ambiguous=true;continue;}
  if(rows.length){const p=rows[0];amount=amount.add(Q.of(p.amount).mul(Q.of(dayMs)).div(Q.of(p.periodMs)));hasActual=true;}
  else if(monthly!==null){amount=amount.add(budgetForDay(t,monthly));budgetUsed=true;}else missingDays++;
 }
 const exact=missingDays||ambiguous?null:amount;return {amount:exact?.integer()??null,exact,missingDays,ambiguous,actual:hasActual,budgetUsed};
}
/** Insurance budgets supplement missing policy types/intervals, retaining known premiums.
 * This is the legacy coverage meaning, with rational annual/12 budget allocation. */
function exactInsurance(start:string,end:string,policies:any[],vehicleId:string,cutoff:string,monthly:Q|null):Coverage {
 const first=ms(start)-8*3600000,last=ms(end)-8*3600000,known=policies.map(p=>({...p,versions:p.versions.filter((v:any)=>new Date(v.createdAt).getTime()<=Date.parse(cutoff))})),boundaries=new Set<number>([first,last]);
 for(let t=first;t<last;t+=dayMs)boundaries.add(t);
 for(const p of known)for(const v of p.versions)for(const field of ['effectiveAt','startAt','endAt']){const t=new Date(v[field]).getTime();if(t>first&&t<last)boundaries.add(t);}
 const points=[...boundaries].sort((a,b)=>a-b);let amount=zero,missingMs=0,actual=false,budgetUsed=false;const ids=new Set<string>();
 for(let i=0;i<points.length-1;i++){
  const from=points[i],to=points[i+1],active:any[]=known.map(p=>effectivePolicyVersion<any>(p.versions,new Date(from))).filter((v:any)=>v&&v.changeKind!=='CANCELLATION'&&v.vehicleIds.includes(vehicleId)&&v.vehicleIds.length===1&&v.premiumAmount!==null&&new Date(v.startAt).getTime()<=from&&new Date(v.endAt).getTime()>=to&&(v.status!=='REGISTERED'||validRegistration(v,vehicleId)));
  const types=active.map(v=>v.policyType),complete=types.includes('COMPULSORY_TRAFFIC')&&types.includes('COMMERCIAL');
  for(const v of active){ids.add(v.id);actual=true;amount=amount.add(Q.of(v.premiumAmount).mul(Q.of(to-from)).div(Q.of(new Date(v.endAt).getTime()-new Date(v.startAt).getTime())));}
  if(!complete){if(monthly!==null){amount=amount.add(budgetForDay(from+8*3600000,monthly).mul(Q.of(to-from)).div(Q.of(dayMs)));budgetUsed=true;}else missingMs+=to-from;}
 }
 const exact=missingMs?null:amount;return {amount:exact?.integer()??null,exact,missingDays:missingMs/dayMs,sourceVersionIds:[...ids],actual,budgetUsed};
}
const freezeCoverage=({exact,...rest}:Coverage)=>({...rest,...(exact?{exactAmount:fraction(exact)}:{})});

export function scenarioCosts(args:{scenario:ScenarioV2;start:string;end:string;groupMonths?:number;override:any;vehicle:any;policies:any[];cutoff:string}) {
 const {scenario:s,start,end,override:o,vehicle,policies,cutoff}=args,h=monthSpan(start,end),u=Q.of(s.occupancyRate),n=Q.of(s.managementVehicleCount),term=args.groupMonths??s.productTermMonths,cycles=h.mul(u).div(Q.of(term));
 const breakdown:PricingCostBreakdown[]=[],regular:(Q|null)[]=[],setup:(Q|null)[]=[],disposal:(Q|null)[]=[],enterprise:(Q|null)[]=[],missing:string[]=[];
 const row=(id:string,label:string,category:PricingCostBreakdown['category'],basis:string,quantity:number,value:Q|null,source:PricingCostBreakdown['source']='SCENARIO',budget?:number|null)=>{
  breakdown.push({id,label,category,basis,quantity,amountCents:value?.integer()??null,periodMonths:h.number(),cycles:basis==='PER_CYCLE'?cycles.number():null,source,...(budget===undefined?{}:{budgetAmountCents:budget})});
  if(value===null)missing.push('COST_AMOUNT_MISSING:'+id);
 };
 for(const c of s.vehicleCosts){let factor:Q,source:PricingCostBreakdown['source']='SCENARIO';
  switch(c.basis){case 'HOLDING_MONTH':factor=h;break;case 'HOLDING_YEAR':factor=h.div(twelve);break;case 'OCCUPIED_MONTH':factor=h.mul(u);break;case 'OCCUPIED_KM':factor=h.mul(u).mul(Q.of(s.expectedMonthlyMileageKm));break;case 'IDLE_MONTH':factor=h.mul(one.sub(u));break;case 'PER_CYCLE':factor=cycles;break;case 'FUTURE_SETUP':factor=o.includeSetupCosts===true&&o.oneTimeCostCents===undefined?one:zero;if(factor.cmp(zero)===0)source='NOT_APPLICABLE';break;case 'DISPOSAL':factor=o.disposalCostCents===undefined?one:zero;if(factor.cmp(zero)===0)source='NOT_APPLICABLE';break;}
  const value=scaled(c.amountCents,factor.mul(Q.of(c.quantity)));row(c.id,c.label,'VEHICLE',c.basis,c.quantity,value,source,c.amountCents);
  (c.basis==='FUTURE_SETUP'?setup:c.basis==='DISPOSAL'?disposal:regular).push(value);
 }
 if(o.oneTimeCostCents!==undefined){const value=o.includeSetupCosts===true?Q.of(o.oneTimeCostCents):zero;setup.push(value);row('setup-override','逐车未来投放成本','VEHICLE','FUTURE_SETUP',1,value,o.includeSetupCosts===true?'VEHICLE_OVERRIDE':'NOT_APPLICABLE',o.oneTimeCostCents);}
 if(o.disposalCostCents!==undefined){const value=Q.of(o.disposalCostCents);disposal.push(value);row('disposal-override','逐车退出处置成本','VEHICLE','DISPOSAL',1,value,'VEHICLE_OVERRIDE',o.disposalCostCents);}
 for(const c of s.enterpriseCosts){const factor=c.basis==='MONTH'?h:c.basis==='YEAR'?h.div(twelve):amortizedMonths(c.startDate!,c.allocationMonths!,start,end).div(Q.of(c.allocationMonths!)),value=scaled(c.amountCents,factor.mul(Q.of(c.quantity)).div(n));enterprise.push(value);regular.push(value);row(c.id,c.label,'ENTERPRISE',c.basis,c.quantity,value,factor.cmp(zero)===0?'NOT_APPLICABLE':'SCENARIO',c.amountCents);}
 const marketing=s.marketing,fixed=scaled(marketing.fixedBudgetCents,h.div(Q.of(marketing.conversionMonths)).div(Q.of(marketing.coverageVehicleCount??s.managementVehicleCount))),repeat=Q.of(s.repeatOrderRate),variable=total([scaled(marketing.newOrderCostCents,cycles.mul(one.sub(repeat))),scaled(marketing.repeatOrderCostCents,cycles.mul(repeat))]);
 regular.push(fixed,variable);row('marketing-fixed','固定推广分摊','MARKETING','HOLDING_MONTH',1,fixed,'SCENARIO',marketing.fixedBudgetCents);row('marketing-variable','新客与复购订单营销','MARKETING','PER_CYCLE',1,variable);
 const baasBudget=o.baasMonthlyBudgetCents??s.baasMonthlyBudgetCents,insuranceBudget=o.insuranceMonthlyBudgetCents??s.insuranceAnnualBudgetCents;
 const baas:Coverage=vehicle.assetProfile?.batteryOwnership==='OWNED'?{amount:0,exact:zero,missingDays:0,ambiguous:false,actual:false,budgetUsed:false}:exactBaas(start,end,vehicle.baasContracts,vehicle.assetCostPlans,baasBudget===null?null:Q.of(baasBudget));
 const insurance=exactInsurance(start,end,policies,vehicle.id,cutoff,insuranceBudget===null?null:o.insuranceMonthlyBudgetCents!==undefined?Q.of(insuranceBudget):Q.of(insuranceBudget).div(twelve));
 const source=(c:Coverage,overridden:boolean):PricingCostBreakdown['source']=>c.actual?(c.budgetUsed?'ACTUAL_WITH_BUDGET':'ACTUAL_COVERAGE'):(overridden?'VEHICLE_OVERRIDE':'SCENARIO');
 row('baas','持有方 BaaS','BAAS','HOLDING_MONTH',1,baas.exact,vehicle.assetProfile?.batteryOwnership==='OWNED'?'NOT_APPLICABLE':source(baas,o.baasMonthlyBudgetCents!==undefined),baasBudget);
 row('insurance','保险实际与缺覆盖预算','INSURANCE',o.insuranceMonthlyBudgetCents!==undefined?'HOLDING_MONTH':'HOLDING_YEAR',1,insurance.exact,source(insurance,o.insuranceMonthlyBudgetCents!==undefined),insuranceBudget);
 const other=total([...regular,insurance.exact]),holding=total([other,baas.exact]),setupTotal=total(setup),disposalTotal=total(disposal),enterpriseTotal=total(enterprise);
 const fields:Partial<PricingVehicleInput>={productTermMonths:term,productTermSource:args.groupMonths===undefined?'SCENARIO':'GROUP',costBreakdown:breakdown,holdingMonthsExact:fraction(h)!,exactCosts:{holding:fraction(holding),setup:fraction(setupTotal),disposal:fraction(disposalTotal),enterpriseMonthly:fraction(enterpriseTotal?.div(h)??null)},variableCostPerOccupiedMonthCents:0,holdingBaasCostCents:baas.amount,holdingOtherFixedCostCents:other?.integer()??null,disposalCostCents:disposalTotal?.integer()??null,oneTimeCostCents:setupTotal?.integer()??null};
 return {fields,missing,baas:freezeCoverage(baas),insurance:freezeCoverage(insurance)};
}
