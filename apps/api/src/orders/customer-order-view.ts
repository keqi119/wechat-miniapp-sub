import {contractInclude,customerContractRecord} from './customer-contract-view';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {fen} from '../common/data';
import {periods} from '../usage/rules';
import {virtualOrderView} from '../virtual-acceptance/view';

const orderStatuses:Record<string,string>={AWAITING_CONTRACT_REVIEW:'线下合同待归档',AWAITING_SIGNATURE:'待签约',AWAITING_PAYMENT:'待支付',AWAITING_HANDOVER:'待交付',ACTIVE:'用车中',SETTLING:'已还车待结算',COMPLETED:'已完成',CANCELLED:'已取消'};
const handoverStatuses:Record<string,string>={PUBLISHED:'待核对交接事实',CUSTOMER_CONFIRMED:'事实已确认',OBJECTION_SUBMITTED:'异议处理中',COMPLETED:'交接已完成'};
const billTitles:Record<string,string>={DEPOSIT:'订阅押金',SUBSCRIPTION:'月度订阅费',DELAY_ADJUSTMENT:'延期费用调整',SWAP_ADJUSTMENT:'换车费用调整',SWAP_CREDIT:'换车次数费用'};
const commercialLabels:Record<string,string>={vehicleIdentification:'车辆身份',permittedUse:'允许用途',conditionDisclosure:'车况披露',mileageCarryRule:'里程结转',excessMileageCalculation:'超里程计算',usageCosts:'用车费用',insuranceDetails:'保险责任',maintenanceRule:'保养规则',serviceCoverage:'服务范围',handoverArrangement:'交接安排',earlyTerminationRule:'提前终止',depositRefundRule:'押金退还',otherFees:'其他费用'};
type Row={label:string;value:string};
const object=(value:any):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const text=(value:unknown,fallback='未提供')=>typeof value==='string'&&value.trim()?value.trim():fallback;
const amount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647?value:null;
const money=(value:unknown)=>amount(value)===null?'未提供':fen(value as number);
const date=(value:unknown)=>{const raw=value instanceof Date?value.toISOString():typeof value==='string'?value:'';const day=/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw)?raw.slice(0,10):'';const parsed=new Date(day+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:'未提供';};
export function orderTime(value:unknown){const parsed=value instanceof Date?value:new Date(typeof value==='string'?value:'');if(!Number.isFinite(parsed.getTime()))return'未提供';const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(parsed).map(item=>[item.type,item.value]));return`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}（北京时间）`;}
const page=(type:string,id:string)=>`/pages/record/index?type=${type}&id=${encodeURIComponent(id)}`;
const documents=(source:unknown,signed:unknown)=>[{id:source,title:'合同原文'},{id:signed,title:'签署归档'}].filter((d):d is{id:string;title:string}=>typeof d.id==='string'&&!!d.id).map(d=>({...d,url:`/api/customer/files/${encodeURIComponent(d.id)}`}));
const monthText=(terms:any)=>Array.isArray(terms.monthlyAmounts)&&terms.monthlyAmounts.length||Array.isArray(terms.billingSchedule)&&terms.billingSchedule.length?'按已生效协议逐期结算':money(terms.monthlyFeeAmount);
function summaryRows(terms:any):Row[]{
 let end='未提供';try{const schedule=periods(date(terms.startDate),terms.months);end=new Date(schedule.at(-1)!.endDate.getTime()-86400000).toISOString().slice(0,10);}catch{/* Incomplete historical data must not invent a term. */}
 return[{label:'月度订阅费',value:monthText(terms)},{label:'订阅押金',value:money(terms.depositAmount)},{label:'订阅期限',value:Number.isInteger(terms.months)&&terms.months>0?`${terms.months} 个月`:'未提供'},{label:'订阅起止日期',value:`${date(terms.startDate)} 至 ${end}`}];
}
function termRows(terms:any):Row[]{
 const benefits=Array.isArray(terms.benefits)?terms.benefits.filter((v:unknown)=>typeof v==='string'&&v.trim()).join('；'):'';
 return[{label:'首期付款日',value:date(terms.firstDueDate)},{label:'每月里程',value:Number.isSafeInteger(terms.mileagePerMonthKm)&&terms.mileagePerMonthKm>=0?`${terms.mileagePerMonthKm} 公里`:'未提供'},{label:'超里程费用',value:amount(terms.excessMileagePriceAmount)!==null?`${money(terms.excessMileagePriceAmount)}/公里`:'未提供'},{label:'能源说明',value:text(terms.energyDescription)},{label:'服务权益',value:benefits||'本方案未列其他服务权益'},{label:'使用条件',value:text(terms.conditions)}];
}
export function orderGuidance(status:string,contracts:any[]=[],bills:any[]=[]){
 if(status==='AWAITING_CONTRACT_REVIEW')return{title:'线下合同待归档',description:'请按工作人员安排完成三方纸质合同签署。平台上传并独立审核归档后，再按已发布账单付款。'};
 if(status==='AWAITING_SIGNATURE'){
  const detail=contracts.find(c=>c.contractDetail?.kind==='SUBSCRIPTION')?.contractDetail;
  return detail?{title:`待签约 · ${detail.phaseText}`,description:detail.guidance.description}:{title:'待签约 · 合同准备中',description:'订单已成立，合同正在准备或核验中；正式签署入口就绪后可在合同详情办理。'};
 }
 if(status==='AWAITING_PAYMENT'){
  const payable=bills.some(b=>b.status==='PENDING'&&amount(b.amount)!==null&&b.amount>0&&amount(b.paidAmount)!==null&&b.paidAmount>=0&&b.paidAmount<b.amount);
  if(payable)return{title:'待支付',description:'请查看已发布账单，按账单详情提示完成支付。'};
  return bills.some(b=>['PENDING','PAID'].includes(b.status))?{title:'待支付 · 资金状态核对',description:'已发布账单的资金状态正在核对，请等待运营确认后续安排。'}:{title:'待支付 · 账单待发布',description:'合同资料已就绪，等待运营核对并发布账单后支付。'};
 }
 const descriptions:Record<string,string>={AWAITING_HANDOVER:'请等待交车安排，并在交接单发布后核对实际车辆与交接事实。',ACTIVE:'查看当前车辆、已发布账单与用车服务。',SETTLING:'车辆已还回，请查看结算账单及相关交接记录。',COMPLETED:'本次订阅已完成，可查看合同、账单与交接归档。',CANCELLED:'本订单已取消，可查看已有记录。'};
 return{title:orderStatuses[status]||'订单进度',description:descriptions[status]||'请查看当前订单详情。'};
}
/** Lists remain one query and never serialize raw financial/identity snapshots. */
export function orderRecordSummary(order:any){
 const terms=object(order.finalPlanSnapshot),status=order.status,statusText=orderStatuses[status]||'订单处理中';
 return{id:order.id,contractMode:order.contractMode||'ESIGN',type:'orders',title:'车辆订阅订单',subtitle:text(order.vehicle?.title,''),status,statusText,amount:order.effectiveTermsVersionId?null:amount(terms.monthlyFeeAmount),amountText:order.effectiveTermsVersionId?'以当前生效条款为准':money(terms.monthlyFeeAmount),createdAtText:orderTime(order.createdAt),details:[],timeline:[],actions:[],documents:[]};
}
/** Every private child read binds both the selected order and authenticated customer. */
export async function customerOrderRecord(db:Db,customerId:string,id:string){
 const order=await db.order.findFirst({where:{id,customerId},select:{id:true,vehicleId:true,customerId:true,status:true,contractMode:true,createdAt:true,finalPlanSnapshot:true,effectiveTermsVersionId:true,currentAssignmentId:true,vehicle:{select:{title:true,coverFileId:true}}}});
 ensure(order,404,'NOT_FOUND','订单不存在');const scoped={orderId:id,customerId};
 const [version,assignment,assignmentCount,contracts,bills,handovers]=await Promise.all([
  order.effectiveTermsVersionId?db.orderTermsVersion.findFirst({where:{id:order.effectiveTermsVersionId,orderId:id,order:{customerId}},select:{version:true,effectiveAt:true,snapshot:true}}):null,
  order.currentAssignmentId?db.vehicleAssignment.findFirst({where:{...scoped,id:order.currentAssignmentId,status:'ACTIVE'},select:{vehicle:{select:{title:true,coverFileId:true}}}}):null,
  db.vehicleAssignment.count({where:scoped}),
  db.contract.findMany({where:scoped,orderBy:{createdAt:'desc'},include:contractInclude}),
  db.bill.findMany({where:{...scoped,status:{in:['PENDING','PAID']}},orderBy:[{dueDate:'asc'},{sequence:'asc'}],select:{id:true,type:true,sequence:true,status:true,amount:true,paidAmount:true,dueDate:true,description:true}}),
  db.handover.findMany({where:{...scoped,status:{in:['PUBLISHED','CUSTOMER_CONFIRMED','OBJECTION_SUBMITTED','COMPLETED']}},orderBy:{createdAt:'desc'},select:{id:true,type:true,status:true,executionMode:true,signatureStatus:true,createdAt:true,actualAt:true,signedFileId:true}})
 ]);
 ensure(!order.effectiveTermsVersionId||version,409,'TERMS_MISSING','当前有效条款缺失，请联系运营核对');
 const original=object(order.finalPlanSnapshot),terms=object(version?version.snapshot:original),changedVehicle=!!order.currentAssignmentId||assignmentCount>0;
 const current=assignment?.vehicle||(changedVehicle?null:order.vehicle),returned=['SETTLING','COMPLETED','CANCELLED'].includes(order.status)&&changedVehicle&&!current;
 const originalTitle=text(object(original.commercialTerms).vehicleIdentification,'原始方案未记录车辆标识');
 const vehicle={title:current?.title||(returned?'车辆已归还':'当前暂无交付车辆'),imageUrl:current?.coverFileId?`/api/public/media/${encodeURIComponent(current.coverFileId)}`:'',originalTitle,currentState:assignment?'CURRENT':changedVehicle?(returned?'RETURNED':'AWAITING_DELIVERY'):'ORIGINAL'};
 const lessor=object(terms.lessorSnapshot),trade=object(terms.commercialTerms);
 const sections:Array<{id:string;title:string;rows:Row[];collapsible:boolean}>=[{id:'current-terms',title:version?`当前生效条款（第 ${version.version} 版）`:'已确认订阅方案',rows:[...(version?[{label:'生效时间',value:orderTime(version.effectiveAt)}]:[]),...termRows(terms)],collapsible:false},{id:'lessor',title:'实际出租方',rows:[{label:lessor.subjectType==='INDIVIDUAL'?'出租人姓名':'企业名称',value:text(lessor.name,'以已签合同记载为准')},...(typeof lessor.creditCode==='string'?[{label:'统一社会信用代码',value:lessor.creditCode}]:[])],collapsible:false},{id:'commercial-terms',title:'完整交易条件',rows:Object.entries(commercialLabels).flatMap(([key,label])=>typeof trade[key]==='string'&&trade[key].trim()?[{label,value:trade[key]}]:[]),collapsible:true}];
 if(Array.isArray(terms.billingSchedule)&&terms.billingSchedule.length)sections.push({id:'billing-schedule',title:'生效协议各期订阅费（实际应付以已发布账单为准）',rows:terms.billingSchedule.slice(0,120).map((raw:any,index:number)=>{const item=object(raw);return{label:`第 ${Number.isInteger(item.sequence)&&item.sequence>0?item.sequence:index+1} 期`,value:`${money(item.amount)}；付款日 ${date(item.dueDate)}`};}),collapsible:true});
 else if(Array.isArray(terms.monthlyAmounts)&&terms.monthlyAmounts.length)sections.push({id:'billing-schedule',title:'生效协议各期订阅费（实际应付以已发布账单为准）',rows:terms.monthlyAmounts.slice(0,120).map((value:unknown,index:number)=>({label:`第 ${index+1} 期`,value:money(value)})),collapsible:true});
 if(version)sections.push({id:'original-terms',title:'原始确认方案（历史约定）',rows:[{label:'原订阅车辆标识',value:originalTitle},...summaryRows(original),...termRows(original)],collapsible:true});
 const related={canSign:false,canPay:false}; // This aggregation grants read-only navigation, never transaction permission.
 const contractViews=await Promise.all(contracts.map(c=>customerContractRecord(db,customerId,c,order)));
 const contractRows=contractViews.map(c=>({id:c.id,title:c.title,status:c.status,statusText:c.statusText,phase:c.contractDetail.phase,description:c.contractDetail.guidance.description,dateText:c.createdAtText,amountText:'',url:'workspaceUrl' in c.contractDetail?c.contractDetail.workspaceUrl:c.contractDetail.phase==='PREPARING'?'':page('contracts',c.id),documents:c.documents,...related}));
 if(order.contractMode==='ELECTRONIC'){
  const cases=await Promise.all([db.orderPreDeliveryCancellation.findFirst({where:{orderId:id,customerId},orderBy:{version:'desc'},select:{id:true,state:true,createdAt:true}}),db.orderTermination.findFirst({where:{orderId:id,customerId,kind:'AGREED06'},orderBy:{version:'desc'},select:{id:true,state:true,createdAt:true}})]);
  cases.forEach((c,index)=>{if(c)contractRows.unshift({id:c.id,title:index===0?'交付前取消方案':'协商终止方案',status:c.state,statusText:['VERIFIED','EFFECTIVE'].includes(c.state)?'待确认方案':c.state==='PROPOSED'?'待复核':c.state==='REJECTED'?'已退回':'查看方案',phase:'BUSINESS_CONFIRMATION',description:'查看本版本协商方案及确认进度。',dateText:orderTime(c.createdAt),amountText:'',url:'/pages/contract-plan/index?orderId='+encodeURIComponent(id)+'&kind='+(index===0?'cancellation04':'termination'),documents:[],...related});});
 }
 const billRows=bills.map(b=>({id:b.id,title:billTitles[b.type]||'订阅费用账单',status:b.status,statusText:b.status==='PAID'?'已支付':'待支付',description:text(b.description,b.type==='SUBSCRIPTION'?`第 ${b.sequence} 期订阅费`:'查看本单账单明细'),dateText:`应付日期 ${date(b.dueDate)}`,amountText:money(b.amount),url:page('bills',b.id),documents:[],...related}));
 const handoverRows=handovers.map(h=>({id:h.id,title:['DELIVERY','SWAP_DELIVERY'].includes(h.type)?'交车交接单':'还车交接单',status:h.status,statusText:handoverStatuses[h.status]||'交接处理中',description:h.executionMode==='OFFLINE'?'查看查验事实、纸质交接单和归档进度':h.signatureStatus==='SIGNED'?'双方签署已归档':h.signatureStatus==='PENDING'?'交接签署进行中':'查看交接事实与签署状态',dateText:orderTime(h.actualAt||h.createdAt),amountText:'',url:`/pages/handover/index?id=${encodeURIComponent(h.id)}`,documents:documents(null,h.executionMode!=='OFFLINE'&&h.signatureStatus==='SIGNED'?h.signedFileId:null),...related}));
 const virtual=await virtualOrderView(db,order);if(virtual)sections.unshift({id:'virtual-notice',title:'虚拟流程验收说明',rows:[{label:'测试范围',value:virtual.notice},{label:'测试进度',value:virtual.description}],collapsible:false});
 return{...orderRecordSummary(order),...(virtual?{virtualAcceptance:virtual,title:'虚拟流程验收',statusText:virtual.title}:{}),subtitle:vehicle.title,amountText:monthText(terms),orderDetail:{version:1,orderId:id,status:order.status,statusText:virtual?.title??orderStatuses[order.status],createdAtText:orderTime(order.createdAt),vehicle,guidance:virtual??orderGuidance(order.status,contractViews,bills),summaryRows:summaryRows(terms),sections,contracts:contractRows,bills:billRows,handovers:handoverRows}};
}
