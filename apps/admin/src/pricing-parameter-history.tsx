import {useState,type ReactNode} from 'react';
import {vehicleBases,enterpriseBases} from './pricing-scenario-model';
import './pricing-parameter-history.css';

type Row=Record<string,unknown>;
type Item=[string,ReactNode];
const object=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const list=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const number=(value:unknown,suffix='')=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{maximumSignificantDigits:21})+suffix:'待补';
const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?'¥'+(value/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'待补';
const percent=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{style:'percent',maximumSignificantDigits:21}):'待补';
const plain=(value:unknown)=>value==null||value===''?'待补':typeof value==='boolean'?(value?'是':'否'):String(value);
const date=(value:unknown)=>{
 if(typeof value!=='string'||!value)return '待补';
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.replaceAll('-','/');
 const instant=new Date(value);
 return Number.isNaN(instant.getTime())?value:instant.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})+'（北京时间）';
};
const labels:Record<string,string>={
 id:'记录编号',lineageId:'版本系列编号',version:'版本号',revision:'修订号',createdAt:'录入时间（原始时刻）',createdBy:'记录人编号',updatedAt:'更新时间',name:'名称',label:'项目名称',payload:'参数内容',costModelVersion:'成本模型版本',
 managementVehicleCount:'预定管理规模',occupancyRate:'出租率',targetAnnualRoa:'参考目标年化 ROA',expectedMonthlyMileageKm:'每出租月预计里程',productTermMonths:'默认产品期限',repeatOrderRate:'复购率',badDebtRate:'坏账率',notes:'依据与备注',
 monthlyManagementBudgetCents:'固定月管理预算',variableCostPerOccupiedMonthCents:'每出租月变动成本',otherFixedMonthlyCostCents:'每持有月其他固定成本',disposalCostCents:'退出处置成本',oneTimeCostCents:'一次性成本',baasMonthlyBudgetCents:'BaaS 缺覆盖月预算',insuranceAnnualBudgetCents:'保险缺覆盖年预算',
 vehicleCosts:'车辆成本',enterpriseCosts:'企业成本',marketing:'营销成本',basis:'计价单位',amountCents:'单价',quantity:'数量 / 次数',allocationMonths:'摊销月数',startDate:'发生日期',fixedBudgetCents:'固定推广原总预算 B',conversionMonths:'折算周期 L',coverageVehicleCount:'推广覆盖车辆 Nm',newOrderCostCents:'每笔新单成本',repeatOrderCostCents:'每笔复购成本',
 modelDefinitionId:'车型定义编号',year:'车型年款',batteryOwnership:'电池方式',batteryCapacityKwh:'电池容量',configuration:'适用配置',mileageMinKm:'适用最小里程',mileageMaxKm:'适用最大里程',condition:'适用车况',effectiveFrom:'生效日期',valuationDate:'估值日期',source:'来源类型',sourceNotes:'来源依据',points:'曲线点',ageMonths:'车龄',coefficient:'残值系数',
 vehicleId:'车辆编号',observedAt:'估值对应日期',effectiveAt:'生效时间',mileageKm:'估值里程',valueCents:'车辆资产估值',curveId:'关联曲线版本编号',withdrawn:'已撤回',
};
const costKeys=['id','label','basis','amountCents','quantity','allocationMonths','startDate'];
const marketingKeys=['fixedBudgetCents','conversionMonths','coverageVehicleCount','newOrderCostCents','repeatOrderCostCents'];
const commonKeys=['name','managementVehicleCount','occupancyRate','targetAnnualRoa','expectedMonthlyMileageKm','notes'];
const legacyKeys=['monthlyManagementBudgetCents','variableCostPerOccupiedMonthCents','otherFixedMonthlyCostCents','disposalCostCents','oneTimeCostCents'];
const v2Keys=['costModelVersion','productTermMonths','repeatOrderRate','badDebtRate','baasMonthlyBudgetCents','insuranceAnnualBudgetCents','vehicleCosts','enterpriseCosts','marketing'];
const curveKeys=['name','modelDefinitionId','year','batteryOwnership','batteryCapacityKwh','configuration','mileageMinKm','mileageMaxKm','condition','effectiveFrom','valuationDate','source','sourceNotes','points'];
const reviewKeys=['vehicleId','observedAt','effectiveAt','ageMonths','mileageKm','valueCents','curveId','notes','withdrawn'];

function Facts({items}:{items:Item[]}){
 return <dl className="parameter-history-facts">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function Section({title,children}:{title:string;children:ReactNode}){
 return <section className="parameter-history-section"><h4>{title}</h4>{children}</section>;
}
/** Unknown fields remain inspectable as labelled values, never as a JSON dump. */
function RecordedValue({value,field}:{value:unknown;field?:string}):ReactNode{
 if(Array.isArray(value))return value.length?<ol className="parameter-history-recorded-list">{value.map((entry,index)=><li key={index}><RecordedValue value={entry}/></li>)}</ol>:<span>空列表（无记录）</span>;
 if(value!==null&&typeof value==='object')return Object.keys(value).length?<Facts items={Object.entries(object(value)).map(([key,entry])=>[labels[key]||'补充字段（'+key+'）',<RecordedValue value={entry} field={key}/>])}/>:<span>无补充内容</span>;
 if(field?.endsWith('Cents')&&typeof value==='number'&&Number.isSafeInteger(value))return amount(value);
 if(field==='basis')return (vehicleBases as Record<string,string>)[String(value)]||(enterpriseBases as Record<string,string>)[String(value)]||plain(value);
 return plain(value);
}
function ExtraFields({value,known,title='补充记录'}:{value:Row;known:string[];title?:string}){
 const entries=Object.entries(value).filter(([key])=>!known.includes(key));
 return entries.length?<details className="parameter-history-metadata"><summary>{title}</summary><Facts items={entries.map(([key,entry])=>[labels[key]||'补充字段（'+key+'）',<RecordedValue value={entry} field={key}/>])}/></details>:null;
}
function CostTable({value,enterprise=false}:{value:unknown;enterprise?:boolean}){
 const rows=list(value),bases:Record<string,string>=enterprise?enterpriseBases:vehicleBases;
 const hasAllocation=rows.some(entry=>{const row=object(entry);return row.startDate!==undefined||row.allocationMonths!==undefined;});
 if(!rows.length)return <p className="parameter-history-muted">{Array.isArray(value)?'此版本未添加成本项目。':'待补：此版本未记录成本明细。'}</p>;
 return <><div className="parameter-history-table-scroll" role="region" aria-label={enterprise?'企业成本明细':'车辆成本明细'} tabIndex={0}><table className="parameter-history-table"><thead><tr><th scope="col">成本项目</th><th scope="col">单价</th><th scope="col">计价单位</th><th scope="col">数量 / 次数</th>{hasAllocation?<><th scope="col">发生日期</th><th scope="col">摊销月数</th></>:null}</tr></thead><tbody>{rows.map((entry,index)=>{const row=object(entry);return <tr key={index}><th scope="row">{plain(row.label)}</th><td>{amount(row.amountCents)}</td><td>{bases[String(row.basis)]||plain(row.basis)}</td><td>{number(row.quantity)}</td>{hasAllocation?<><td>{row.startDate===undefined?'—':date(row.startDate)}</td><td>{row.allocationMonths===undefined?'—':number(row.allocationMonths,' 月')}</td></>:null}</tr>;})}</tbody></table></div><details className="parameter-history-metadata"><summary>成本项目追溯信息</summary>{rows.map((entry,index)=>{const row=object(entry);return <div className="parameter-history-trace-item" key={index}><strong>{plain(row.label)}</strong><Facts items={[["项目编号",plain(row.id)]]}/><ExtraFields value={row} known={costKeys}/>{Object.keys(row).length===0?<RecordedValue value={entry}/>:null}</div>;})}</details></>;
}
function ScenarioDetail({payload}:{payload:Row}){
 const v2=payload.costModelVersion===2,marketing=object(payload.marketing);
 const assumptions:Item[]=[['场景名称',plain(payload.name)],['成本口径',v2?'明细成本（第 2 版）':'旧版合计成本'],['预定管理规模 N',number(payload.managementVehicleCount,' 辆')],['出租率',percent(payload.occupancyRate)],['每出租月预计里程',number(payload.expectedMonthlyMileageKm,' 公里')],['参考目标年化 ROA',payload.targetAnnualRoa==null?'未设置目标':percent(payload.targetAnnualRoa)]];
 if(v2)assumptions.push(['默认产品期限 T',number(payload.productTermMonths,' 月')],['复购率',percent(payload.repeatOrderRate)],['坏账率',percent(payload.badDebtRate)]);
 return <><Section title="经营假设"><Facts items={assumptions}/></Section>{v2?<><Section title="车辆成本"><CostTable value={payload.vehicleCosts}/><Facts items={[["BaaS 缺覆盖预算（每月）",amount(payload.baasMonthlyBudgetCents)],["保险缺覆盖预算（每年）",amount(payload.insuranceAnnualBudgetCents)]]}/></Section><Section title="企业成本"><CostTable value={payload.enterpriseCosts} enterprise/></Section><Section title="营销成本"><Facts items={[["固定推广原总预算 B",amount(marketing.fixedBudgetCents)],["折算周期 L",number(marketing.conversionMonths,' 月')],["推广覆盖车辆 Nm",marketing.coverageVehicleCount===null?'跟随管理规模 N（'+number(payload.managementVehicleCount,' 辆')+'）':number(marketing.coverageVehicleCount,' 辆')],["每笔新单成本",amount(marketing.newOrderCostCents)],["每笔复购成本",amount(marketing.repeatOrderCostCents)]]}/><p className="parameter-history-muted">固定推广按 B / L / Nm 分摊为每车月投入，持续计入；L 为折算周期。</p><ExtraFields value={marketing} known={marketingKeys}/></Section></>:<Section title="旧版成本预算"><Facts items={[["固定月管理预算",amount(payload.monthlyManagementBudgetCents)],["每出租月变动成本",amount(payload.variableCostPerOccupiedMonthCents)],["每持有月其他固定成本",amount(payload.otherFixedMonthlyCostCents)],["一次性成本",amount(payload.oneTimeCostCents)],["退出处置成本",amount(payload.disposalCostCents)]]}/><p className="parameter-history-muted">按此版本保存的旧版口径展示。</p></Section>}<Section title="依据与备注"><p className="parameter-history-notes">{plain(payload.notes)}</p></Section><ExtraFields value={payload} known={[...commonKeys,...(v2?v2Keys:legacyKeys)]}/></>;
}
function CurveDetail({payload}:{payload:Row}){
 const points=list(payload.points),ownership:Record<string,string>={OWNED:'电池买断',BAAS:'BaaS 电池租用',UNKNOWN:'电池方式待确认'},sources:Record<string,string>={MANUAL:'人工录入',MARKET:'市场数据'};
 return <><Section title="曲线适用范围"><Facts items={[["曲线名称",plain(payload.name)],["车型定义编号",plain(payload.modelDefinitionId)],["车型年款",number(payload.year,' 款')],["电池方式",ownership[String(payload.batteryOwnership)]||plain(payload.batteryOwnership)],["电池容量",number(payload.batteryCapacityKwh,' kWh')],["适用配置",payload.configuration===''?'不限配置':plain(payload.configuration)],["最小适用里程",number(payload.mileageMinKm,' 公里')],["最大适用里程",number(payload.mileageMaxKm,' 公里')],["适用车况",plain(payload.condition)],["估值日期",date(payload.valuationDate)],["生效日期",date(payload.effectiveFrom)],["来源类型",sources[String(payload.source)]||plain(payload.source)]]}/></Section><Section title="残值曲线点">{points.length?<div className="parameter-history-table-scroll" role="region" aria-label="残值曲线点" tabIndex={0}><table className="parameter-history-table parameter-history-points"><thead><tr><th scope="col">车龄（月）</th><th scope="col">残值系数</th></tr></thead><tbody>{points.map((entry,index)=>{const point=object(entry);return <tr key={index}><th scope="row">{number(point.ageMonths)}</th><td>{number(point.coefficient)}</td></tr>;})}</tbody></table></div>:<p className="parameter-history-muted">待补：此版本未记录曲线点。</p>}<p className="parameter-history-muted">仅在适用范围内插值，不默认外推。</p>{points.some(entry=>Object.keys(object(entry)).some(key=>!['ageMonths','coefficient'].includes(key)))?<details className="parameter-history-metadata"><summary>曲线点补充记录</summary>{points.map((entry,index)=><ExtraFields key={index} value={object(entry)} known={['ageMonths','coefficient']} title={'第 '+(index+1)+' 个曲线点'}/>)}</details>:null}</Section><Section title="来源依据"><p className="parameter-history-notes">{plain(payload.sourceNotes)}</p></Section><ExtraFields value={payload} known={curveKeys}/></>;
}
function ReviewDetail({payload}:{payload:Row}){
 return <><Section title="单车估值记录"><Facts items={[["车辆编号",plain(payload.vehicleId)],["估值对应日期",date(payload.observedAt)],["生效时间",date(payload.effectiveAt)],["估值车龄",number(payload.ageMonths,' 月')],["估值里程",number(payload.mileageKm,' 公里')],["车辆资产估值",amount(payload.valueCents)],["关联曲线版本编号",payload.curveId===null?'未指定曲线':plain(payload.curveId)],["撤回状态",payload.withdrawn===true?'已撤回':payload.withdrawn===false?'未撤回':'待补']]} /><p className="parameter-history-muted">车辆资产估值不含处置费用；估值日期、生效时间和录入时间分别保留。</p></Section><Section title="估值 / 修正 / 撤回依据"><p className="parameter-history-notes">{plain(payload.notes)}</p></Section><ExtraFields value={payload} known={reviewKeys}/></>;
}
function ParameterVersion({row,kind}:{row:Row;kind:string}){
 const [expanded,setExpanded]=useState(false),payload=object(row.payload);
 const name=typeof payload.name==='string'&&payload.name?payload.name:kind==='reviews'?'单车估值 · '+plain(payload.vehicleId):'未命名参数';
 const withdrawn=payload.withdrawn===true;
 return <details className="parameter-history-version" onToggle={event=>setExpanded(event.currentTarget.open)}><summary className="parameter-history-summary"><span className="parameter-history-chevron" aria-hidden="true">›</span><span className="parameter-history-version-name">{name}<span className="parameter-history-version-number">版本 {plain(row.version)}</span></span><span className="parameter-history-date">{date(row.createdAt)}</span><span className={'parameter-history-state'+(withdrawn?' parameter-history-withdrawn':'')}>{withdrawn?'已撤回':'只读版本'}</span></summary>{expanded?<div className="parameter-history-content">{kind==='scenarios'?<ScenarioDetail payload={payload}/>:kind==='curves'?<CurveDetail payload={payload}/>:<ReviewDetail payload={payload}/>}<details className="parameter-history-metadata"><summary>版本追溯信息</summary><Facts items={[["记录编号",plain(row.id)],["版本系列编号",plain(row.lineageId)],["版本号",plain(row.version)],["修订号",plain(row.revision)],["记录人编号",plain(row.createdBy)],["录入时间（原始时刻）",plain(row.createdAt)]]}/><ExtraFields value={row} known={['id','lineageId','version','revision','createdAt','createdBy','payload']}/></details></div>:null}</details>;
}

export function ParameterVersionHistory({rows,kind}:{rows:Row[];kind:string}){
 return <div className="parameter-history"><p className="parameter-history-intro">按版本查看已保存参数，展开可查阅成本、适用范围及来源记录。</p>{rows.length?rows.map((row,index)=><ParameterVersion key={kind+':'+plain(row.id)+':'+index} row={row} kind={kind}/>):<p className="parameter-history-empty">暂无已保存的参数版本。</p>}</div>;
}
