import {baasPayerId} from './baas-business-model.ts';
import {normalizeBaasPreviousContract} from './baas-previous-model.ts';
import {moneyToCents} from './core.ts';
export type AssetResource='vehicle-assets'|'baas-contracts'|'asset-cost-plans'|'asset-costs'|'depreciation-policies';
export type AssetVehicle={id:string;title:string;brand?:string;model?:string;vin?:string|null;plateNumber?:string|null;revision?:number;year?:number;modelDefinition?:{modelYear?:number|null}};
export type AssetFile={id:string;name:string;mimeType:string;size:number;sha256:string;state?:'ACTIVE'|'VOIDED';url?:string;voidedAt?:string|null;voidedBy?:string|null;voidReason?:string|null};
export type BaasRegistrationReadiness={ready:boolean;checks:{key:string;label:string;passed:boolean;message:string;field?:string}[];missingFields:string[];signedPdfFiles:{id:string;name:string;sha256:string}[]};
export type BaasGroup='CURRENT'|'EXPIRED'|'OTHER';
export type BaasHistory={id:string;fromRevision:number;toRevision:number;termsHash:string;firstCostPeriod:string|null;createdBy:string;changeReason:string;createdAt:string};
export type AssetProfile={vehicleId:string;vehicle:AssetVehicle;vehicleRevision:number;registered:boolean;revision:number;batteryOwnership:'UNKNOWN'|'OWNED'|'BAAS';batteryCapacityKwh?:string|null;registeredOwnerName?:string|null;firstRegistrationDate:string|null;notes?:string;engineNumber?:string|null;bodyColor?:string|null;initialMileageKm?:number|null;purchaseAmount?:number|null;purchaserName?:string|null;purchaseDate?:string|null;nextInspectionDate?:string|null};
export type BaasContract={id:string;vehicleId:string;vehicle:AssetVehicle&{registeredOwnerName?:string|null};revision:number;status:'DRAFT'|'ACTIVE'|'SUSPENDED'|'TERMINATED'|'ARCHIVED';provider:string|null;contractNumber:string;supplierContractNumber:string;batteryPackage:string|null;batterySerialNumber:string;effectiveFrom:string|null;effectiveTo:string|null;billingCycle:'MONTHLY'|'QUARTERLY'|'YEARLY'|null;rentalAmount:number|null;paymentDayOfMonth:number|null;graceDays:number;invoiceRequired:boolean;taxIncluded:boolean|null;currency:'CNY';notes:string;previousContractId:string|null;firstCostPeriod:string|null;termsHash:string;files?:AssetFile[];supplierOrderNumber?:string|null;batteryBrand?:string|null;lesseeName?:string|null;lesseeCreditCode?:string|null;lessorCollectionAccountInfo?:string|null;missingFields?:string[];nextDueDate?:string|null;unpaidCostCount?:number;scheduledCostCount?:number;costPlanCount?:number;payerOwnerId?:string|null;currentPayer?:{id:string;name:string}|null;actualContractNumber?:string|null;registrationReadiness?:BaasRegistrationReadiness;financialMissingFields?:string[];activatedAt?:string|null;validityGroup?:BaasGroup;validityState?:'CURRENT'|'EXPIRED'|'UPCOMING'|'INCOMPLETE'|'SUSPENDED'|'TERMINATED'|'ARCHIVED'|'DRAFT';validityLabel?:string;serverDate?:string;history?:BaasHistory[];recentChanges?:{id:string;createdBy:string;createdAt:string;changeReason:string|null;revision:number;termsChanged:boolean;metadataFields:string[]}[]};
export type CostPlan={id:string;vehicleId:string;revision:number;sourceKind:'BAAS'|'DEPRECIATION'|'WORK_ORDER';baasContractId:string|null;depreciationPolicyId:string|null;workOrderCostId?:string|null;costPeriod:string;periodStart:string;periodEnd:string;amount:number;dueDate:string|null;status:'SCHEDULED'|'CONFIRMED'|'VOIDED';sourceRevision:number;sourceHash:string;reason:string};
export type CostPreview={contractId:string;sourceId:string;revision:number;assetRevision:number;algorithmVersion:string;request:{sourceKind:'BAAS';fromPeriod:string;toPeriod:string};rows:{costPeriod:string;periodStart:string;periodEnd:string;dueDate:string|null;amount:number;warningIds:string[];existingPlan:CostPlan|null}[];totalAmount:number;createCount:number;existingCount:number;totalCreatedAmount:number;warningIds:string[];previewHash:string};
export type CostReopenPreview={planId:string;planRevision:number;sourceRevision:number;sourceKind:'BAAS'|'DEPRECIATION'|'WORK_ORDER';costPeriod:string;amount:number;previewHash:string;warningIds:string[];rows:{costPeriod:string;amount:number;reason?:string;existingPlan:CostPlan|null}[]};
export function costReopenPayload(plan:CostPlan,preview:CostReopenPreview,reason:string){
 if(plan.status!=='VOIDED'||preview.planId!==plan.id||preview.planRevision!==plan.revision||preview.sourceKind!==plan.sourceKind||preview.costPeriod!==plan.costPeriod||preview.amount!==plan.amount||!/^[a-f0-9]{64}$/.test(preview.previewHash))throw new Error('重开依据已变化，请重新读取计划并预览');
 return{...assetReason({reason},plan),sourceRevision:assetInteger(preview.sourceRevision,'来源版本'),previewHash:preview.previewHash};
}
export type PaymentRecord={id:string;entryId:string;revision:number;status:'RECORDED'|'VOIDED';amount:number;paidAt:string;referenceNo:string;reason:string;evidenceFileIds:string[];recordedAt:string;voidedAt:string|null;voidReason:string|null};
export type CostEntry={id:string;vehicleId:string;revision:number;planId:string;category:'BAAS_RENT'|'DEPRECIATION'|'REPAIR'|'MAINTENANCE'|'TOWING';effect:'COST'|'REVERSAL';amount:number;periodStart:string;periodEnd:string;postedAt:string;sourceHash:string;reversalOfId:string|null;lockedAt:string|null;reason:string;source?:{sourceKind:'BAAS'|'DEPRECIATION'|'WORK_ORDER';baasContractId?:string;depreciationPolicyId?:string;workOrderCostId?:string;costPeriod:string};payments?:PaymentRecord[];reversal?:CostEntry|null;files?:AssetFile[]};
export function assetAccess(resource:AssetResource,role:string|undefined,permissions:string[]){
 const allowed=['asset-costs','depreciation-policies'].includes(resource)?['ADMIN','FINANCE']:['ADMIN','OPERATIONS','FINANCE'],read=allowed.includes(role||'')&&(permissions.includes('*')||permissions.includes(resource+'.read'));
 const writable=['vehicle-assets','baas-contracts'].includes(resource)?['ADMIN','OPERATIONS']:['ADMIN','OPERATIONS','FINANCE'];
 return{read,write:read&&writable.includes(role||'')&&(permissions.includes('*')||permissions.includes(resource+'.write'))};
}
export const assetLabels:Record<string,string>={WORK_ORDER:'工单费用',REPAIR:'维修费',MAINTENANCE:'保养费',TOWING:'拖车费',SUPERSEDED:'已被承接',UNKNOWN:'未登记',OWNED:'自有电池',BAAS:'BAAS 租用电池',DRAFT:'草稿',ACTIVE:'有效',SUSPENDED:'已暂停',TERMINATED:'已终止',ARCHIVED:'已归档',SCHEDULED:'待确认',CONFIRMED:'已确认',VOIDED:'已作废',RECORDED:'有效登记',COST:'原成本',REVERSAL:'冲正',BAAS_RENT:'BAAS 租金',DEPRECIATION:'折旧',MONTHLY:'月付',QUARTERLY:'季付',YEARLY:'年付'};
export const baasActionLabels:Record<string,string>={activate:'启用合同',suspend:'暂停合同',resume:'恢复合同',terminate:'终止合同',archive:'归档合同'};
export function assetCents(value:unknown){if(typeof value!=='string')throw new Error('请输入明确的元金额');return moneyToCents(value);}
export function assetInteger(value:unknown,label:string,min=0,max=2147483647){const s=String(value??'');if(!/^\d+$/.test(s)||!Number.isSafeInteger(Number(s))||Number(s)<min||Number(s)>max)throw new Error(`${label}须为${min}至${max}的整数`);return Number(s);}
export function assetDate(value:unknown){const s=String(value??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error('请填写有效日期');return s;}
const text=(value:unknown,label:string,max=500)=>{const s=String(value??'').trim();if(!s||s.length>max)throw new Error(`请填写${label}，最多${max}字`);return s;};
const optional=(value:unknown,max=500)=>{const s=String(value??'').trim();if(s.length>max)throw new Error(`内容最多${max}字`);return s;};
const revision=(value:number)=>assetInteger(value,'资料版本');
function batteryCapacity(value:unknown):string|null{
 if(value===null)return null;
 const invalid=()=>new Error('电池容量须为0至99999.999的十进制数，最多三位小数');
 if(typeof value!=='string')throw invalid();const raw=value.trim();if(!raw)return null;
 if(raw.length>100||!/^\d+(?:\.\d{1,3})?$/.test(raw))throw invalid();
 const [whole,fraction='']=raw.split('.'),integer=whole.replace(/^0+/,'')||'0',decimal=fraction.replace(/0+$/,'');
 if(integer.length>5)throw invalid();return integer+(decimal?'.'+decimal:'');
}
export function assetProfilePayload(values:Record<string,unknown>,profile:AssetProfile){
 if(!['UNKNOWN','OWNED','BAAS'].includes(String(values.batteryOwnership)))throw new Error('请选择电池归属');
 const inventory:Record<string,string|number|null>={};
 const add=(input:string,output:string,parse:(value:unknown)=>string|number)=>{
  if(!Object.hasOwn(values,input)||values[input]===undefined)return;
  const value=values[input];inventory[output]=value===null||typeof value==='string'&&!value.trim()?null:parse(value);
 };
 for(const [key,label,max] of [['engineNumber','发动机号',200],['bodyColor','车身颜色',100],['purchaserName','购车人',200]] as const)add(key,key,value=>{
  if(typeof value!=='string'||value.includes('\0'))throw new Error(`${label}须为不含空字符的文本`);
  return text(value,label,max);
 });
 add('initialMileageKm','initialMileageKm',value=>{
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('初始里程须为0至2147483647的整数');
  return assetInteger(typeof value==='string'?value.trim():value,'初始里程');
 });
 add('purchaseYuan','purchaseAmount',assetCents);
 for(const key of ['purchaseDate','nextInspectionDate'])add(key,key,assetDate);
 return{revision:revision(profile.revision),vehicleRevision:revision(profile.vehicleRevision),batteryOwnership:String(values.batteryOwnership),...(Object.hasOwn(values,'registeredOwnerName')?{registeredOwnerName:optional(values.registeredOwnerName,200)||null}:{}),...(Object.hasOwn(values,'batteryCapacityKwh')?{batteryCapacityKwh:batteryCapacity(values.batteryCapacityKwh)}:{}),firstRegistrationDate:values.firstRegistrationDate?assetDate(values.firstRegistrationDate):null,notes:optional(values.notes,5000),...inventory};
}
export function baasDraftPayload(values:Record<string,unknown>,current?:BaasContract,profile?:AssetProfile):Record<string,string|number|boolean|null|undefined>{
 if(!current&&!profile)throw new Error('请先选择车辆并读取当前资产资料');
 const fields:Record<string,string|number|boolean|null>={};
 const add=(input:string,output:string,parse:(value:unknown)=>string|number,createDefault=false)=>{
  if(!Object.hasOwn(values,input)||values[input]===undefined){if(!current&&createDefault)fields[output]=null;return;}
  const value=values[input];fields[output]=value===null||typeof value==='string'&&!value.trim()?null:parse(value);
 };
 const draftText=(value:unknown,label:string,max=500)=>{if(typeof value!=='string'||value.includes('\0'))throw new Error(`${label}须为不含空字符的文本`);return text(value,label,max);};
 add('provider','provider',value=>draftText(value,'电池出租方'),true);add('batteryPackage','batteryPackage',value=>draftText(value,'电池规格'),true);
 for(const key of ['effectiveFrom','effectiveTo'])add(key,key,value=>{if(typeof value!=='string'||value.startsWith('0000-'))throw new Error('请填写有效日期');return assetDate(value);},true);
 add('billingCycle','billingCycle',value=>{if(typeof value!=='string'||!['MONTHLY','QUARTERLY','YEARLY'].includes(value))throw new Error('请选择付款周期');return value;},true);
 add('rentalYuan','rentalAmount',value=>{const amount=assetCents(value);if(!amount)throw new Error('周期租金必须大于0');return amount;},true);
 add('paymentDayOfMonth','paymentDayOfMonth',value=>{if(typeof value!=='string'&&typeof value!=='number')throw new Error('付款日须为1至31的整数');return assetInteger(value,'付款日',1,31);},true);
 for(const [key,label,max] of [['supplierOrderNumber','外部订单号',500],['batteryBrand','电池品牌',200],['lesseeName','承租人',200],['lessorCollectionAccountInfo','出租方收款账户信息',2000]] as const)add(key,key,value=>draftText(value,label,max));
 add('lesseeCreditCode','lesseeCreditCode',value=>{const code=draftText(value,'承租人统一社会信用代码',18);if(!/^[A-Z0-9]{18}$/.test(code))throw new Error('承租人统一社会信用代码须为18位大写字母或数字');return code;});
 if(values.contractNumber!==undefined&&values.contractNumber!==null&&String(values.contractNumber).trim())fields.contractNumber=draftText(values.contractNumber,'内部合同编号');
 const effectiveFrom=Object.hasOwn(fields,'effectiveFrom')?fields.effectiveFrom:current?.effectiveFrom,effectiveTo=Object.hasOwn(fields,'effectiveTo')?fields.effectiveTo:current?.effectiveTo;
 if(typeof effectiveFrom==='string'&&typeof effectiveTo==='string'&&effectiveFrom>effectiveTo)throw new Error('合同结束日期不能早于开始日期');
 for(const [key,max] of [['supplierContractNumber',500],['batterySerialNumber',500],['notes',5000]] as const)if(!current||Object.hasOwn(values,key)&&values[key]!==undefined)fields[key]=optional(values[key],max);
 if(!current||values.graceDays!==undefined)fields.graceDays=assetInteger(values.graceDays===null||typeof values.graceDays==='string'&&!values.graceDays.trim()?'0':values.graceDays??'0','宽限天数',0,365);
 if(!current||values.invoiceRequired!==undefined)fields.invoiceRequired=values.invoiceRequired===true;
 if(!current||values.taxIncluded!==undefined)fields.taxIncluded=values.taxIncluded==='true'?true:values.taxIncluded==='false'?false:null;
 if(!current||values.previousContractId!==undefined){const previous=normalizeBaasPreviousContract(values.previousContractId);if(!current||previous!==normalizeBaasPreviousContract(current.previousContractId))fields.previousContractId=previous;}
 if(!current||values.payerOwnerId!==undefined){const payer=baasPayerId(values.payerOwnerId);if(!current||payer!==baasPayerId(current.payerOwnerId))fields.payerOwnerId=payer;}
 const changeReason=current&&current.status!=='DRAFT'?text(values.changeReason,'修改说明',500):undefined;
 return{...fields,...(changeReason?{changeReason}:{}),currency:'CNY',revision:current?revision(current.revision):0,...(!current?{vehicleId:profile!.vehicleId,vehicleRevision:revision(profile!.vehicleRevision),assetRevision:revision(profile!.revision)}:{})};
}
export const baasTermLabels:Record<string,string>={provider:'电池出租方',batteryPackage:'电池规格',effectiveFrom:'合同开始日期',billingCycle:'付款周期',rentalAmount:'周期租金',paymentDayOfMonth:'付款日'};
export function baasMissingFields(contract:BaasContract){return [...new Set([...(contract.missingFields||[]),...Object.keys(baasTermLabels).filter(key=>{const value=contract[key as keyof BaasContract];return value===null||value===undefined||typeof value==='string'&&!value.trim();})])];}
export function baasValidityLabel(contract:BaasContract){return contract.validityLabel||({CURRENT:'有效中',EXPIRED:'已过期',UPCOMING:'未到生效日',INCOMPLETE:'待完善',SUSPENDED:'已暂停',TERMINATED:'已终止',ARCHIVED:'已归档',DRAFT:'草稿'} as Record<string,string>)[contract.validityState||'']||assetLabels[contract.status]||contract.status;}
export function baasRegistrationMissingLabels(contract:BaasContract){
 const readiness=contract.registrationReadiness;if(readiness)return [...new Set(readiness.checks.filter(check=>!check.passed&&check.key!=='SIGNED_PDF').map(check=>check.label))];
 return baasMissingFields(contract).filter(key=>key!=='batteryPackage'&&key!=='billingCycle').map(key=>baasTermLabels[key]||key);
}
export function baasFinancialMissingFields(contract:BaasContract){return contract.financialMissingFields||baasMissingFields(contract).filter(key=>key!=='batteryPackage');}
export function baasActions(contract:BaasContract){
 const readiness=contract.registrationReadiness,hasPdf=contract.files?.some(file=>(!file.state||file.state==='ACTIVE')&&file.mimeType==='application/pdf'&&readiness?.signedPdfFiles.some(pdf=>pdf.id===file.id)),today=contract.serverDate;
 const inDates=today?!!contract.effectiveFrom&&contract.effectiveFrom<=today&&(!contract.effectiveTo||contract.effectiveTo>=today):contract.status!=='ARCHIVED';
 const ready=readiness?.ready&&readiness.checks.every(check=>check.passed)&&!readiness.missingFields.length&&hasPdf&&inDates;
 return({DRAFT:[...(ready?['activate']:[]),'archive'],ACTIVE:['suspend','terminate'],SUSPENDED:[...(ready?['resume']:[]),'terminate'],TERMINATED:['archive'],ARCHIVED:ready&&!contract.activatedAt?['activate']:[]} as Record<string,string[]>)[contract.status]||[];
}
export function baasRange(values:{fromPeriod:string;toPeriod:string}){for(const value of [values.fromPeriod,values.toPeriod])if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new Error('请选择有效起止账期');if(values.fromPeriod>values.toPeriod)throw new Error('截止账期不得早于开始账期');return values;}
export function baasGeneratePayload(contract:BaasContract,preview:CostPreview,range:{fromPeriod:string;toPeriod:string},acknowledged:string[]){
 if(baasMissingFields(contract).length)throw new Error('资料待补齐，请先核对完整合同条款');
 baasRange(range);if(!['ACTIVE','SUSPENDED'].includes(contract.status)||preview.contractId!==contract.id||preview.sourceId!==contract.id||preview.revision!==contract.revision||preview.request.sourceKind!=='BAAS'||preview.request.fromPeriod!==range.fromPeriod||preview.request.toPeriod!==range.toPeriod||!/^[a-f0-9]{64}$/.test(preview.previewHash))throw new Error('预览已过期，请重新试算');
 if(new Set(acknowledged).size!==acknowledged.length||acknowledged.length!==preview.warningIds.length||preview.warningIds.some(id=>!acknowledged.includes(id)))throw new Error('请逐项确认全部账期警示');
 return{revision:revision(contract.revision),...range,previewHash:preview.previewHash,acknowledgedWarningIds:[...acknowledged].sort()};
}
export function confirmCostPayload(plans:CostPlan[]){if(!plans.length||plans.length>120||new Set(plans.map(plan=>plan.id)).size!==plans.length)throw new Error('请选择1至120条不重复的待确认计划');for(const plan of plans){if(plan.status!=='SCHEDULED')throw new Error('只能确认待确认计划');assetInteger(plan.amount,'成本分金额');}return{plans:plans.map(plan=>({id:plan.id,revision:revision(plan.revision)}))};}
export function assetTotal(rows:{amount:number}[]){const total=rows.reduce((sum,row)=>sum+BigInt(assetInteger(row.amount,'成本分金额')),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('合计金额超出范围');return Number(total);}
export function assetReason(values:Record<string,unknown>,record:{revision:number}){return{revision:revision(record.revision),reason:text(values.reason,'办理原因',1000)};}
export function manualPaymentPayload(values:Record<string,unknown>,entry:Pick<CostEntry,'revision'|'amount'|'category'|'effect'|'lockedAt'|'payments'|'reversal'|'files'>,today:string){
 if(entry.effect!=='COST'||!['BAAS_RENT','REPAIR','MAINTENANCE','TOWING'].includes(entry.category)||entry.reversal||entry.payments?.some(payment=>payment.status==='RECORDED')||!Number.isInteger(entry.amount)||entry.amount<=0)throw new Error('此成本当前不能新增人工付款登记');
 const paidAt=assetDate(values.paidAt);if(paidAt>today)throw new Error('实际付款日期不能晚于上海今天');const ids=values.fileIds;if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!entry.files?.some(file=>file.id===id)))throw new Error('请选择本成本的专用付款依据');
 return{...assetReason(values,entry),paidAt,referenceNo:text(values.referenceNo,'付款参考号',200),fileIds:ids as string[]};
}
