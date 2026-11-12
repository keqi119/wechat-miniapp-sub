import {assetCents,assetDate,assetInteger,assetReason,type AssetFile,type AssetVehicle,type CostPlan} from './asset-model.ts';
export type DepreciationMethod='STRAIGHT_LINE'|'MANUAL'|'NONE';
export type DepreciationTotals={confirmedAmount:number;reversalAmount:number;netAmount:number;lockedAmount:number};
export type DepreciationPolicy={id:string;vehicleId:string;vehicle?:AssetVehicle;revision:number;status:'DRAFT'|'ACTIVE'|'SUPERSEDED'|'ARCHIVED';method:DepreciationMethod;basisAmount:number;basisSource:string;basisEvidence:string;residualAmount:number;startDate:string;usefulLifeMonths:number|null;currency:'CNY';notes:string;previousPolicyId:string|null;termsHash:string;files?:AssetFile[];plans?:CostPlan[];totals?:DepreciationTotals;previousPolicy?:DepreciationPolicy|null};
export type ManualDepreciationDraft={costPeriod:string;amountYuan:string;reason:string};
export type ManualDepreciationPeriod={costPeriod:string;amount:number;reason:string};
export type DepreciationPreview={policyId:string;sourceId:string;revision:number;assetRevision:number;algorithmVersion:string;request:{sourceKind:'DEPRECIATION';manualPeriods?:ManualDepreciationPeriod[]};rows:{costPeriod:string;periodStart:string;periodEnd:string;amount:number;dueDate?:null;warningIds?:string[];reason?:string;existingPlan:CostPlan|null}[];totalAmount:number;createCount:number;existingCount:number;totalCreatedAmount:number;warningIds:string[];previewHash:string;budget:{depreciableAmount:number;committedAmount:number;remainingAmount:number}};
export const depreciationMethods:Record<DepreciationMethod,string>={STRAIGHT_LINE:'直线法',MANUAL:'手工逐期',NONE:'明确不计提'};
const required=(value:unknown,label:string,max=500)=>{const str=String(value??'').trim();if(!str||str.length>max)throw new Error(`请明确填写${label}，最多${max}字`);return str;};
export function depreciationInitial(current?:DepreciationPolicy,previous?:DepreciationPolicy){return{method:current?.method||previous?.method||'',basisYuan:current?(current.basisAmount/100).toFixed(2):'',residualYuan:current?(current.residualAmount/100).toFixed(2):'',basisSource:current?.basisSource||'',basisEvidence:current?.basisEvidence||'',startDate:current?.startDate||'',usefulLifeMonths:current?.usefulLifeMonths?String(current.usefulLifeMonths):'',notes:current?.notes||''};}
export function depreciationDraftPayload(values:Record<string,unknown>,current?:DepreciationPolicy,vehicle?:{id:string;revision:number},previous?:DepreciationPolicy){
 if(current&&current.status!=='DRAFT')throw new Error('仅草稿策略可以修改条款');if(!current&&(!vehicle||previous&&(previous.vehicleId!==vehicle.id||previous.status!=='ACTIVE')))throw new Error('请读取当前车辆及明确承接的有效策略');
 if(!Object.hasOwn(depreciationMethods,String(values.method)))throw new Error('请选择折旧方法');const method=String(values.method) as DepreciationMethod,basisAmount=assetCents(values.basisYuan),residualAmount=assetCents(values.residualYuan);if(residualAmount>basisAmount)throw new Error('残值不得高于折旧基数');const notes=String(values.notes??'');if(notes.length>5000)throw new Error('备注最多5000字');
 return{method,basisAmount,residualAmount,basisSource:required(values.basisSource,'基数来源'),basisEvidence:required(values.basisEvidence,'依据说明',5000),startDate:assetDate(values.startDate),usefulLifeMonths:method==='STRAIGHT_LINE'?assetInteger(values.usefulLifeMonths,'使用月数',1,120):null,currency:'CNY',notes,previousPolicyId:current?.previousPolicyId||previous?.id||null,revision:current?assetInteger(current.revision,'策略版本'):0,...(!current?{vehicleId:vehicle!.id,vehicleRevision:assetInteger(vehicle!.revision,'车辆版本')}:{})};
}
export function depreciationRequest(policy:DepreciationPolicy,drafts:ManualDepreciationDraft[]):{manualPeriods?:ManualDepreciationPeriod[]}{
 if(policy.method!=='MANUAL')return{};if(drafts.length>120||new Set(drafts.map(row=>row.costPeriod)).size!==drafts.length)throw new Error('手工期间最多120期，月份不得重复');
 return{manualPeriods:drafts.map(row=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.costPeriod))throw new Error('请填写有效月份');return{costPeriod:row.costPeriod,amount:assetCents(row.amountYuan),reason:required(row.reason,'本期金额依据',5000)};})};
}
export function depreciationGeneratePayload(policy:DepreciationPolicy,preview:DepreciationPreview,drafts:ManualDepreciationDraft[]){
 const request=depreciationRequest(policy,drafts),actual=preview.request;
 if(policy.status!=='ACTIVE'||policy.method==='NONE'||preview.policyId!==policy.id||preview.sourceId!==policy.id||preview.revision!==policy.revision||actual.sourceKind!=='DEPRECIATION'||JSON.stringify(actual.manualPeriods)!==JSON.stringify(request.manualPeriods)||!/^[a-f0-9]{64}$/.test(preview.previewHash)||preview.warningIds.length)throw new Error('试算已变化，请重新读取并试算');
 const budget=preview.budget;if(!budget||Object.values(budget).some(value=>!Number.isSafeInteger(value)||value<0)||budget.remainingAmount!==budget.depreciableAmount-budget.committedAmount||!Number.isSafeInteger(preview.totalCreatedAmount)||preview.totalCreatedAmount>budget.remainingAmount||preview.totalCreatedAmount<0||preview.createCount<1)throw new Error('本次新增计划超过剩余可折旧额，或没有可新增期间');
 return{revision:policy.revision,...request,previewHash:preview.previewHash,acknowledgedWarningIds:[]};
}
export function depreciationActivatePayload(policy:DepreciationPolicy,reason:string,acknowledgedPrevious=false){
 if(policy.status!=='DRAFT'||!policy.files?.length)throw new Error('只有具备本策略专用依据的草稿可以启用');const previous=policy.previousPolicy;
 if(policy.previousPolicyId&&(!acknowledgedPrevious||!previous||previous.id!==policy.previousPolicyId||previous.vehicleId!==policy.vehicleId||previous.status!=='ACTIVE'))throw new Error('请读取并明确核对当前有效前策略及其累计事实');
 return{...assetReason({reason},policy),...(policy.previousPolicyId?{previousRevision:assetInteger(previous!.revision,'前策略版本')}:{})};
}
