import {moneyToCents,type Entity} from './core.ts';
import {parseShanghaiDateTime,shanghaiDateTime} from './usage.ts';
import {delayActionPayload,delayContextSafe,delayDetailSafe,delayListItemSafe,type DelayContext} from './delay.ts';
export type Assignment={id:string;vehicle:{id:string;title:string;plateNumber?:string;vin?:string};startAt:string;endAt:string|null;startReadingKm:number;endReadingKm:number|null;status:'ACTIVE'|'CLOSED'};
export type SwapAccount={orderId:string;startedOn:string;endDate:string;currentAssignment:Assignment|null;assignments?:Assignment[];cycle:{sequence:number;startDate:string;endDate:string;freeAvailable:number;freeReserved:number;freeConsumed:number};paidAvailable:number;reservations:Array<{id:string;changeId:string;source:string;cycleSequence:number;status:string}>;ledger:Array<{id:string;type:string;source:string;cycleSequence:number;changeId:string;actualAt:string|null;recordedAt:string}>;canRequest:boolean;canPurchase:false;blockers:string[]};
export type SwapContext=DelayContext&{currentAssignment:Assignment|null;swapAccount:SwapAccount};
export type SwapDraft={targetVehicleId:string;plannedReturnAt:string;plannedDeliveryAt:string;newMonthlyFeeAmount:string;depositAmount:string;handoverFeeAmount:string;handoverFeeBasis:string;depositBasis:string;insuranceResponsibility:string;downtimeArrangement:string;settlementExplanation:string;handoverArrangement:string;cancellationTerms:string;reason:string;expiresAt:string;externalCompensationRequired:string;periods:Array<{sequence:number;amount:string;dueDate:string;calculationBasis:string}>};
export const swapTextFields:[keyof SwapDraft,string][]=[['handoverFeeBasis','交接费用计算依据'],['depositBasis','押金沿用、补收或退款依据'],['insuranceResponsibility','目标车辆保险与责任'],['downtimeArrangement','无车间隔费用与责任安排'],['settlementExplanation','本次资金核清安排'],['handoverArrangement','双侧实际交接安排'],['cancellationTerms','取消、再次变更及履约异常责任'],['reason','换车原因']];
const required=(value:unknown,label:string)=>{if(typeof value!=='string'||!value.trim())throw new Error(`请填写${label}`);return value.trim();};
const version=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('当前版本缺失，请刷新详情');return Number(value);};
const requestKey=(key:string)=>{if(key.length<8)throw new Error('请求编号缺失，请重新打开表单');return key;};
const base=(revision:unknown,key:string)=>({revision:version(revision),idempotencyKey:requestKey(key)});
function day(value:unknown,label:string){const text=required(value,label),date=new Date(`${text}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)throw new Error(`${label}无效`);return text;}
export const swapRecoveryFields=['plannedReturnAt','plannedDeliveryAt','handoverArrangement','downtimeArrangement','reason','expiresAt'];
const centsInput=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?`${BigInt(Number(value))/100n}.${(BigInt(Number(value))%100n).toString().padStart(2,'0')}`:'';
export function swapQuoteDraft(detail:Record<string,unknown>,context:SwapContext):SwapDraft{
 const previous=detail.quote as Record<string,any>|null,recovery=detail.recoveryOnly===true;
 const returned=detail.returnHandover as Record<string,unknown>|null;
 const periods=recovery&&Array.isArray(previous?.periods)?previous.periods:context.periods;
 return{targetVehicleId:String(previous?.targetVehicleId??''),plannedReturnAt:shanghaiDateTime(recovery&&returned?.status==='COMPLETED'?returned.actualAt:previous?.plannedReturnAt),plannedDeliveryAt:shanghaiDateTime(previous?.plannedDeliveryAt),newMonthlyFeeAmount:centsInput(previous?.newMonthlyFeeAmount),depositAmount:centsInput(previous?.depositAmount??(recovery?undefined:context.depositAmount)),handoverFeeAmount:centsInput(previous?.handoverFeeAmount),expiresAt:'',externalCompensationRequired:recovery&&typeof previous?.externalCompensationRequired==='boolean'?String(previous.externalCompensationRequired):'',periods:periods.map(p=>{const prior=Array.isArray(previous?.periods)?previous.periods.find((row:any)=>row.sequence===p.sequence):null;return{sequence:p.sequence,dueDate:String(prior?.dueDate??p.dueDate),amount:centsInput(prior?.amount??p.amount),calculationBasis:String(prior?.calculationBasis??'')};}),...Object.fromEntries(swapTextFields.map(([key])=>[key,String(previous?.[key]??(key==='reason'?detail.reason:'')??'')]))} as SwapDraft;
}
export function swapQuotePayload(revision:number,expected:number[],draft:SwapDraft,key:string,detail?:Record<string,unknown>):Record<string,unknown>{
 if(!['true','false'].includes(draft.externalCompensationRequired))throw new Error('请明确选择本次是否涉及系统范围外额外赔付');
 if(draft.externalCompensationRequired==='true')throw new Error('额外赔付须先人工财务处理；本切片不能生成可签报价');
 const plannedReturnAt=parseShanghaiDateTime(required(draft.plannedReturnAt,'预计旧车交还时间')),plannedDeliveryAt=parseShanghaiDateTime(required(draft.plannedDeliveryAt,'预计新车交付时间')),expiresAt=parseShanghaiDateTime(required(draft.expiresAt,'客户确认截止时间'));
 if(new Date(plannedDeliveryAt)<new Date(plannedReturnAt))throw new Error('新车交付不得早于旧车交还时间');
 if(new Date(expiresAt).getTime()<=Date.now())throw new Error('客户确认截止时间须在未来');
 if(moneyToCents(draft.newMonthlyFeeAmount)<=0)throw new Error('新约定月费须大于零；单期减免应在逐期金额中明确列示');
 if(!expected.length||draft.periods.length!==expected.length||new Set(draft.periods.map(p=>p.sequence)).size!==expected.length||draft.periods.some(p=>!expected.includes(p.sequence)))throw new Error('请完整填写全部原订阅期且勿重复');
 const body:Record<string,unknown>={...base(revision,key),targetVehicleId:required(draft.targetVehicleId,'目标车辆'),plannedReturnAt,plannedDeliveryAt,expiresAt,externalCompensationRequired:false,newMonthlyFeeAmount:moneyToCents(draft.newMonthlyFeeAmount),depositAmount:moneyToCents(draft.depositAmount),handoverFeeAmount:moneyToCents(draft.handoverFeeAmount),periods:draft.periods.map(p=>({sequence:p.sequence,amount:moneyToCents(p.amount),dueDate:day(p.dueDate,`第${p.sequence}期付款日`),calculationBasis:required(p.calculationBasis,`第${p.sequence}期计算依据`)})),...Object.fromEntries(swapTextFields.map(([key,label])=>[key,required(draft[key],label)]))};
 if(detail?.recoveryOnly===true){
  const prior=detail.quote as Record<string,unknown>|null;if(!prior||!Array.isArray(prior.periods))throw new Error('当前原报价快照缺失，请刷新后重试');
  for(const field of Object.keys(body).filter(k=>!['revision','idempotencyKey',...swapRecoveryFields].includes(k))){const expected=field==='periods'?prior.periods.map((p:any)=>({sequence:p.sequence,amount:p.amount,dueDate:p.dueDate,calculationBasis:p.calculationBasis})):prior[field];if(JSON.stringify(body[field])!==JSON.stringify(expected))throw new Error('恢复报价的目标车、金额、逐期付款日和原责任已冻结，不可改价或重新分配资金');}
  const returned=detail.returnHandover as Record<string,unknown>|null;
  if(returned?.status==='COMPLETED'){if(typeof returned.actualAt!=='string'||!Number.isFinite(Date.parse(returned.actualAt))||draft.plannedReturnAt!==shanghaiDateTime(returned.actualAt))throw new Error('旧车已经实际归还，不能修改已记录事实');body.plannedReturnAt=new Date(returned.actualAt).toISOString();if(new Date(plannedDeliveryAt)<new Date(returned.actualAt))throw new Error('新车交付不得早于旧车实际归还');}
 }
 return body;
}
export function swapCreatePayload(context:Record<string,unknown>,reason:string,key:string){return{expectedOrderRevision:version(context.orderRevision),priorTermsHash:required(context.priorTermsHash,'当前有效条款哈希'),reason:required(reason,'换车原因'),idempotencyKey:requestKey(key)};}
const capabilities:Record<string,string>={quotes:'canQuote',review:'canReview',publish:'canPublish','prepare-signature':'canPrepareSignature','prepare-finance':'canPrepareFinance',cancel:'canCancel','create-return':'canCreateReturn','create-delivery':'canCreateDelivery',complete:'canComplete'};
export function swapActionAllowed(action:string,entity:Record<string,unknown>,role?:string,actorId?:string){
 if(entity.kind!=='VEHICLE_CHANGE'||!capabilities[action]||entity[capabilities[action]]!==true||!actorId)return false;
 if(!['ADMIN',...(['review','prepare-finance'].includes(action)?['FINANCE']:['OPERATIONS'])].includes(role||''))return false;
 const quote=entity.quote as Record<string,unknown>|undefined;
 if(action==='publish'&&(!quote?.expiresAt||!(new Date(String(quote.expiresAt)).getTime()>Date.now())))return false;
 return action!=='review'||!!quote?.createdBy&&quote.createdBy!==actorId;
}
export function swapActionPayload(action:string,revision:number,input:Record<string,unknown>,key:string):Record<string,unknown>{if(action==='complete')return base(revision,key);if(!['review','publish','prepare-signature','prepare-finance','cancel'].includes(action))throw new Error('不支持的换车后台动作');return delayActionPayload(action,revision,input,key);}
export function swapHandoverPayload(revision:number,side:string,input:Record<string,unknown>,key:string){
 if(!['RETURN','DELIVERY'].includes(side))throw new Error('交接侧别无效');
 if(!Number.isSafeInteger(input.readingKm)||Number(input.readingKm)<0)throw new Error('请输入该车辆真实非负整数里程');
 if(!Array.isArray(input.fileIds)||input.fileIds.some(id=>typeof id!=='string'))throw new Error('请核对交接证据');
 if(!Array.isArray(input.checklist)||!input.checklist.length)throw new Error('请填写真实交接清单');
 const checklist=input.checklist.map((fact:any)=>({label:required(fact.label,'交接清单名称'),value:required(fact.value,'交接事实')}));
 const raw=required(input.actualAt,'实际交接时间');let actualAt:string;
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)){const parsed=new Date(raw);if(!Number.isFinite(parsed.getTime()))throw new Error('实际交接时间无效');actualAt=parsed.toISOString();}else actualAt=parseShanghaiDateTime(raw);
 return{...base(revision,key),side,actualAt,readingKm:input.readingKm,fileIds:input.fileIds,checklist};
}
const pick=(source:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function assignmentSafe(value:unknown):unknown{if(!object(value))return value;return{...pick(value,['id','startAt','endAt','startReadingKm','endReadingKm','status']),...(object(value.vehicle)?{vehicle:pick(value.vehicle,['id','title','plateNumber','vin'])}:{})};}
function accountSafe(value:unknown):unknown{if(!object(value))return value;return{...pick(value,['orderId','startedOn','endDate','paidAvailable','canRequest','canPurchase','blockers']),...(value.currentAssignment!==undefined?{currentAssignment:assignmentSafe(value.currentAssignment)}:{}),...(Array.isArray(value.assignments)?{assignments:value.assignments.map(assignmentSafe)}:{}),...(object(value.cycle)?{cycle:pick(value.cycle,['sequence','startDate','endDate','freeAvailable','freeReserved','freeConsumed'])}:{}),...(Array.isArray(value.reservations)?{reservations:value.reservations.filter(object).map(row=>pick(row,['id','changeId','source','cycleSequence','status']))}:{}),...(Array.isArray(value.ledger)?{ledger:value.ledger.filter(object).map(row=>pick(row,['id','type','source','cycleSequence','changeId','actualAt','recordedAt']))}:{})};}
export function swapContextSafe(value:Record<string,unknown>):SwapContext{return{...delayContextSafe(value),currentAssignment:assignmentSafe(value.currentAssignment),swapAccount:accountSafe(value.swapAccount)} as SwapContext;}
export function swapListSafe(value:Record<string,unknown>):Entity{const result=delayListItemSafe(value);if(object(value.quoteSummary))result.quoteSummary={...(result.quoteSummary as object),...pick(value.quoteSummary,['targetVehicleId','targetVehicleTitle','plannedReturnAt','plannedDeliveryAt'])};return result;}
export function swapDetailSafe(value:Record<string,unknown>):Entity{
 const result=delayDetailSafe(value);Object.assign(result,pick(value,['actualCompletedAt','recordedAt','canCreateReturn','canCreateDelivery','canComplete','recoveryOnly']));
 if(value.currentAssignment!==undefined)result.currentAssignment=assignmentSafe(value.currentAssignment);
 if(value.originalAssignment!==undefined)result.originalAssignment=assignmentSafe(value.originalAssignment);
 if(value.swapAccount!==undefined)result.swapAccount=accountSafe(value.swapAccount);
 if(object(value.targetVehicle))result.targetVehicle=pick(value.targetVehicle,['id','title','plateNumber','vin','mileageKm']);
 if(object(value.hold))result.hold=pick(value.hold,['id','status','expiresAt']);
 for(const key of ['returnHandover','deliveryHandover'])if(object(value[key]))result[key]=pick(value[key],['id','type','vehicleId','assignmentId','status','signatureStatus','actualAt','readingKm','manifestHash','canComplete']);
 if(object(value.quote))result.quote={...(result.quote as object),...pick(value.quote,['targetVehicleId','targetVehicleTitle','oldVehicleIdentification','targetVehicleIdentification','plannedReturnAt','plannedDeliveryAt','newMonthlyFeeAmount','depositAmount','handoverFeeAmount','depositChargeAmount','depositRefundAmount','financialGate','externalCompensationRequired','previousQuoteId','recoveryFromQuoteId','financeSourceQuoteId',...swapTextFields.map(([key])=>key)])};
 if(object(value.finance))result.finance={...(result.finance as object),...pick(value.finance,['depositRefundAmount']),...(Array.isArray(value.finance.adjustments)?{adjustments:value.finance.adjustments.filter(object).map(row=>pick(row,['id','type','amount','paidAmount','status','dueDate']))}:{})};
 return result;
}
export function assignmentLabel(value:Assignment|null|undefined){return value===null?'旧车已交还，换车待交付':value?.vehicle?.title||'当前车辆分配尚未取得';}
export function segmentEvidencePayload(segment:Record<string,unknown>,reason:string,key:string){return{...base(segment.revision,key),reason:required(reason,'补证理由')};}
export const swapStatus=(value:unknown):string=>({DRAFT:'换车草案',REVIEW_PENDING:'待独立财务复核',REVIEWED:'报价已复核',AWAITING_CONFIRMATION:'待客户确认报价',AWAITING_SIGNATURE:'待补充协议签署',AWAITING_FINANCE:'待核清款项与双侧交接',SWAP_RETURNED:'旧车已交还，待新车交付',APPLIED:'换车已完成',CANCELLED:'已取消',REJECTED:'报价已拒绝'}as Record<string,string>)[String(value)]??String(value??'—');
