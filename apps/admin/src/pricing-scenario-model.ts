import {moneyToCents} from './core.ts';

export const vehicleBases={HOLDING_MONTH:'元 / 持有月',HOLDING_YEAR:'元 / 持有年',OCCUPIED_MONTH:'元 / 出租月',OCCUPIED_KM:'元 / 出租公里',IDLE_MONTH:'元 / 闲置月',PER_CYCLE:'元 / 订阅周期',FUTURE_SETUP:'元 / 未来投放一次',DISPOSAL:'元 / 退出处置一次'};
export const enterpriseBases={MONTH:'元 / 企业月',YEAR:'元 / 企业年',AMORTIZED_ONCE:'元 / 企业一次性投入'};
export type CostForm={id:string;label:string;basis:string;amountCents:string;quantity:string;allocationMonths?:string;startDate?:string};
export type ScenarioForm={name:string;managementVehicleCount:string;occupancyRate:string;productTermMonths:string;repeatOrderRate:string;badDebtRate:string;targetAnnualRoa:string;expectedMonthlyMileageKm:string;notes:string;baasMonthlyBudgetCents:string;insuranceAnnualBudgetCents:string;vehicleCosts:CostForm[];enterpriseCosts:CostForm[];marketing:{fixedBudgetCents:string;conversionMonths:string;coverageVehicleCount:string;newOrderCostCents:string;repeatOrderCostCents:string}};
type Row=Record<string,any>;
const display=(value:unknown)=>value==null?'':String(value);
const moneyInput=(value:unknown)=>value==null?'':(Number(value)/100).toFixed(2);
const percentage=(value:unknown)=>value==null?'':String(Number((Number(value)*100).toFixed(10)));
const costInitial=(row:Row):CostForm=>({id:row.id,label:row.label,basis:row.basis,amountCents:moneyInput(row.amountCents),quantity:display(row.quantity),...(row.allocationMonths!=null?{allocationMonths:display(row.allocationMonths)}:{}),...(row.startDate?{startDate:row.startDate}:{})});

/** Copies legacy totals once into named lines. New business assumptions stay explicitly blank. */
export function scenarioInitial(source?:Row):ScenarioForm{
 const value=source||{},legacy=source&&value.costModelVersion!==2;
 const vehicleCosts=legacy?[
  ['variableCostPerOccupiedMonthCents','原每出租月变动成本','OCCUPIED_MONTH'],['otherFixedMonthlyCostCents','原每持有月其他固定成本','HOLDING_MONTH'],['oneTimeCostCents','原一次性成本（仅未来投放）','FUTURE_SETUP'],['disposalCostCents','原退出处置成本','DISPOSAL'],
 ].map(([key,label,basis])=>costInitial({id:'legacy-'+key,label,basis,amountCents:value[key]??null,quantity:1})):(value.vehicleCosts||[]).map(costInitial);
 const enterpriseCosts=legacy?[costInitial({id:'legacy-management',label:'原固定月管理预算',basis:'MONTH',amountCents:value.monthlyManagementBudgetCents??null,quantity:1})]:(value.enterpriseCosts||[]).map(costInitial);
 const marketing=value.marketing||{};
 return {name:display(value.name),managementVehicleCount:display(value.managementVehicleCount),occupancyRate:percentage(value.occupancyRate),productTermMonths:display(value.productTermMonths),repeatOrderRate:percentage(value.repeatOrderRate),badDebtRate:percentage(value.badDebtRate),targetAnnualRoa:percentage(value.targetAnnualRoa),expectedMonthlyMileageKm:display(value.expectedMonthlyMileageKm),notes:display(value.notes),baasMonthlyBudgetCents:moneyInput(value.baasMonthlyBudgetCents),insuranceAnnualBudgetCents:moneyInput(value.insuranceAnnualBudgetCents),vehicleCosts,enterpriseCosts,marketing:{fixedBudgetCents:moneyInput(marketing.fixedBudgetCents),conversionMonths:display(marketing.conversionMonths),coverageVehicleCount:display(marketing.coverageVehicleCount),newOrderCostCents:moneyInput(marketing.newOrderCostCents),repeatOrderCostCents:moneyInput(marketing.repeatOrderCostCents)}};
}
function numberValue(raw:string,label:string,min:number,max=Number.MAX_SAFE_INTEGER,integer=false){
 if(!/^\d+(\.\d+)?$/.test(raw.trim())||!Number.isFinite(Number(raw)))throw Error(label+'请输入有效数字');
 const value=Number(raw);if(value<min||value>max||(integer&&!Number.isInteger(value)))throw Error(label+`须为 ${min} 至 ${max} 的${integer?'整数':'数值'}`);return value;
}
function amount(raw:string){return raw.trim()===''?null:moneyToCents(raw);}
function requiredText(raw:string,label:string,max:number){const value=raw.trim();if(!value||value.length>max)throw Error(label+`须填写且不超过 ${max} 字`);return value;}
function costPayload(rows:CostForm[],bases:Record<string,string>){
 if(rows.length>100)throw Error('每类成本最多添加 100 项');const ids=new Set<string>();
 return rows.map(row=>{const id=requiredText(row.id,'项目编号',100);if(ids.has(id))throw Error('成本项目编号重复');ids.add(id);
  if(!Object.hasOwn(bases,row.basis))throw Error('成本计价单位不适用于此类别');
  const result={id,label:requiredText(row.label,'项目名称',200),basis:row.basis,amountCents:amount(row.amountCents),quantity:numberValue(row.quantity,'数量 / 次数',0)};
  if(row.basis!=='AMORTIZED_ONCE')return result;
  const startDate=row.startDate||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(Date.parse(startDate))||new Date(startDate).toISOString().slice(0,10)!==startDate)throw Error('企业一次性投入须填写有效发生日期');
  return {...result,startDate,allocationMonths:numberValue(row.allocationMonths||'','摊销月数',1,1200,true)};
 });
}
export function scenarioPayload(form:ScenarioForm){
 const ids=[...form.vehicleCosts,...form.enterpriseCosts].map(row=>row.id.trim());if(new Set(ids).size!==ids.length)throw Error('成本项目编号重复');
 let targetAnnualRoa:number|null=null;if(form.targetAnnualRoa.trim()){if(!/^-?\d+(\.\d+)?$/.test(form.targetAnnualRoa.trim())||Math.abs(Number(form.targetAnnualRoa))>1000)throw Error('参考目标 ROA 请输入 -1000% 至 1000%');targetAnnualRoa=Number(form.targetAnnualRoa)/100;}
 if(form.notes.length>5000)throw Error('依据说明不可超过 5000 字');
 return {costModelVersion:2 as const,name:requiredText(form.name,'场景名称',200),managementVehicleCount:numberValue(form.managementVehicleCount,'预定管理规模',1,1000000,true),occupancyRate:numberValue(form.occupancyRate,'出租率',0,100)/100,productTermMonths:numberValue(form.productTermMonths,'产品期限',3,120,true),repeatOrderRate:numberValue(form.repeatOrderRate,'复购率',0,100)/100,badDebtRate:numberValue(form.badDebtRate,'坏账率',0,100)/100,targetAnnualRoa,expectedMonthlyMileageKm:numberValue(form.expectedMonthlyMileageKm,'每出租月预计里程',0,100000,true),notes:form.notes,baasMonthlyBudgetCents:amount(form.baasMonthlyBudgetCents),insuranceAnnualBudgetCents:amount(form.insuranceAnnualBudgetCents),vehicleCosts:costPayload(form.vehicleCosts,vehicleBases),enterpriseCosts:costPayload(form.enterpriseCosts,enterpriseBases),marketing:{fixedBudgetCents:amount(form.marketing.fixedBudgetCents),conversionMonths:numberValue(form.marketing.conversionMonths,'固定推广折算周期',1,1200,true),coverageVehicleCount:form.marketing.coverageVehicleCount.trim()?numberValue(form.marketing.coverageVehicleCount,'推广覆盖车辆',1,1000000,true):null,newOrderCostCents:amount(form.marketing.newOrderCostCents),repeatOrderCostCents:amount(form.marketing.repeatOrderCostCents)}};
}
export function scenarioGroupTerm(scenario?:Row,groupMonths?:unknown){
 const valid=(v:unknown)=>v!==''&&v!=null&&Number.isInteger(Number(v))&&Number(v)>=3&&Number(v)<=120;
 if(valid(groupMonths))return {months:Number(groupMonths),source:'GROUP' as const};
 if(valid(scenario?.productTermMonths))return {months:Number(scenario!.productTermMonths),source:'SCENARIO' as const};
 return {months:'' as const,source:'MISSING' as const};
}
/** Editing preview only. Authoritative period/date/coverage calculation stays on the server. */
export function scenarioSummary(form:ScenarioForm){
 const read=(raw:string,min=0,max=Number.MAX_SAFE_INTEGER)=>{try{return numberValue(raw,'',min,max);}catch{return null;}};
 const cents=(raw:string)=>{try{return amount(raw);}catch{return null;}};
 const n=read(form.managementVehicleCount,1),u=read(form.occupancyRate,0,100),t=read(form.productTermMonths,3,120),r=read(form.repeatOrderRate,0,100),km=read(form.expectedMonthlyMileageKm);
 const annualCycles=u!=null&&t!=null?12*u/100/t:null;
 const fixed=cents(form.marketing.fixedBudgetCents),months=read(form.marketing.conversionMonths,1),coverage=form.marketing.coverageVehicleCount.trim()?read(form.marketing.coverageVehicleCount,1):n,newCost=cents(form.marketing.newOrderCostCents),repeatCost=cents(form.marketing.repeatOrderCostCents);
 const fixedMarketingAnnualCents=fixed!=null&&months!=null&&coverage!=null?Math.round(fixed/months/coverage*12):null;
 const variableMarketingAnnualCents=annualCycles!=null&&r!=null&&(newCost!=null||r===100)&&(repeatCost!=null||r===0)?Math.round(annualCycles*((1-r/100)*(newCost??0)+r/100*(repeatCost??0))):null;
 const marketingAnnualCents=fixedMarketingAnnualCents!=null&&variableMarketingAnnualCents!=null?fixedMarketingAnnualCents+variableMarketingAnnualCents:null;
 let vehicleAnnualCents=0,enterpriseMonthlyCents=0,setupCents=0,disposalCents=0;const unknown:string[]=[];let dateAllocatedCount=0;
 for(const row of form.vehicleCosts){const a=cents(row.amountCents),q=read(row.quantity);const scale:Record<string,number|null>={HOLDING_MONTH:12,HOLDING_YEAR:1,OCCUPIED_MONTH:u==null?null:12*u/100,OCCUPIED_KM:u==null||km==null?null:12*u/100*km,IDLE_MONTH:u==null?null:12*(1-u/100),PER_CYCLE:annualCycles,FUTURE_SETUP:1,DISPOSAL:1};if(a==null||q==null||scale[row.basis]==null){unknown.push(row.label||'未命名车辆成本');continue;}const total=a*q*scale[row.basis]!;if(row.basis==='FUTURE_SETUP')setupCents+=total;else if(row.basis==='DISPOSAL')disposalCents+=total;else vehicleAnnualCents+=total;}
 for(const row of form.enterpriseCosts){const a=cents(row.amountCents),q=read(row.quantity);if(row.basis==='AMORTIZED_ONCE'){dateAllocatedCount++;if(a==null||q==null||!row.startDate||read(row.allocationMonths||'',1)==null)unknown.push(row.label||'企业一次性投入');continue;}if(a==null||q==null){unknown.push(row.label||'未命名企业成本');continue;}enterpriseMonthlyCents+=a*q/(row.basis==='YEAR'?12:1);}
 if(fixedMarketingAnnualCents==null)unknown.push('固定推广预算 / 折算周期 / 覆盖车辆');if(variableMarketingAnnualCents==null)unknown.push('每单营销 / 期限 / 出租率 / 复购率');
 const missingAssumptions=[['managementVehicleCount','管理规模 N'],['occupancyRate','出租率'],['productTermMonths','产品期限 T'],['repeatOrderRate','复购率'],['badDebtRate','坏账率'],['expectedMonthlyMileageKm','每出租月里程']].filter(([key])=>!String(form[key as keyof ScenarioForm]).trim()).map(([,label])=>label);
 return {annualCycles,fixedMarketingAnnualCents,variableMarketingAnnualCents,marketingAnnualCents,vehicleAnnualCents:Math.round(vehicleAnnualCents),enterpriseMonthlyCents:Math.round(enterpriseMonthlyCents),enterprisePerVehicleMonthlyCents:n==null?null:Math.round(enterpriseMonthlyCents/n),setupCents:Math.round(setupCents),disposalCents:Math.round(disposalCents),dateAllocatedCount,unknown,missingAssumptions};
}
