import {moneyToCents,type Entity} from './core';
import {parseShanghaiDateTime,shanghaiDateTime} from './usage';
import {swapTextFields,type SwapContext} from './swap';
type Data=Record<string,any>;
export type SwapTarget={targetListingId:string;targetListingRevision:number;targetSourceHash:string;vehicle:{id:string;title:string;vin:string|null;plateNumber:string|null};product:{id:string;productVersionId:string;version:number;name:string;months:number;monthlyFeeAmount:number}};
export type OfflineSwapDraft=Record<string,string>;
const text=(v:unknown,label:string,max=500)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max||v.includes('\0'))throw Error(`请填写有效${label}`);return v.trim();};
const integer=(v:unknown,label:string)=>{if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>2147483647)throw Error(`${label}尚未核实`);return Number(v);};
const calendarDay=(v:unknown)=>{const d=typeof v==='string'?new Date(v+'T00:00:00Z'):new Date(NaN);if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw Error('服务月日期尚未核实');return v;};
const hash=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error('来源摘要尚未核实');return v;};
export const offlineSwapTextFields=swapTextFields.filter(([key])=>key!=='handoverFeeBasis');
export function swapTargetSafe(raw:unknown):SwapTarget{
 const r=raw as Data;if(!r||!r.vehicle||!r.product)throw Error('真实目标商品缺失');
 return{targetListingId:text(r.targetListingId,'商品来源',128),targetListingRevision:integer(r.targetListingRevision,'商品版本'),targetSourceHash:hash(r.targetSourceHash),vehicle:{id:text(r.vehicle.id,'目标车辆',128),title:text(r.vehicle.title,'车名'),vin:typeof r.vehicle.vin==='string'?r.vehicle.vin:null,plateNumber:typeof r.vehicle.plateNumber==='string'?r.vehicle.plateNumber:null},product:{id:text(r.product.id,'产品来源',128),productVersionId:text(r.product.productVersionId,'产品版本',128),version:integer(r.product.version,'产品版本'),name:text(r.product.name,'产品名称'),months:integer(r.product.months,'产品租期'),monthlyFeeAmount:integer(r.product.monthlyFeeAmount,'产品月费')}};
}
export function frozenSwapTarget(detail:Entity):SwapTarget|undefined{
 const q=detail.quote as Data|undefined,p=q?.targetSource?.product,v=detail.targetVehicle as Data|undefined;
 if(!p||!v)return;return swapTargetSafe({targetListingId:p.listingId,targetListingRevision:p.listingRevision,targetSourceHash:p.sourceHash,vehicle:v,product:{id:p.productId,productVersionId:p.productVersionId,version:p.version,name:p.name,months:p.months,monthlyFeeAmount:p.monthlyFeeAmount}});
}
export function offlineSwapDraft(detail:Entity,context:SwapContext):OfflineSwapDraft{
 const q=detail.quote as Data|undefined,returned=detail.returnHandover as Data|undefined,deposit=q?.depositAmount??context.depositAmount;
 return{plannedReturnAt:shanghaiDateTime(returned?.status==='COMPLETED'?returned.actualAt:q?.plannedReturnAt),plannedDeliveryAt:shanghaiDateTime(q?.plannedDeliveryAt),expiresAt:'',depositAmount:Number.isInteger(deposit)?(deposit/100).toFixed(2):'',...Object.fromEntries(offlineSwapTextFields.map(([key])=>[key,String(q?.[key]??(key==='reason'?detail.reason:'')??'')]))};
}
export function offlineSwapPreviewPayload(detail:Entity,draft:OfflineSwapDraft,target:SwapTarget|undefined){
 if(!target)throw Error('请选择真实目标商品');const t=swapTargetSafe(target),plannedDeliveryAt=parseShanghaiDateTime(text(draft.plannedDeliveryAt,'新车交付时间')),expiresAt=parseShanghaiDateTime(text(draft.expiresAt,'客户确认截止时间'));
 let plannedReturnAt=parseShanghaiDateTime(text(draft.plannedReturnAt,'旧车交还时间'));const returned=detail.returnHandover as Data|undefined;
 if(returned?.status==='COMPLETED'){
  text(returned.id,'原归还记录');const actualAt=returned.actualAt;
  if(returned.type!=='SWAP_RETURN'||typeof actualAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(actualAt)||!Number.isFinite(Date.parse(actualAt)))throw Error('原归还事实尚未核实');
  calendarDay(actualAt.slice(0,10));
  if(draft.plannedReturnAt!==shanghaiDateTime(actualAt))throw Error('旧车已经实际归还，不能修改已记录时间');
  plannedReturnAt=new Date(actualAt).toISOString();
 }
 if(Date.parse(plannedDeliveryAt)<Date.parse(plannedReturnAt)||Date.parse(expiresAt)<=Date.now())throw Error('请核对真实交接时间和未来确认截止时间');
 return{pricingVersion:2,revision:integer(detail.revision,'当前版本'),targetListingId:t.targetListingId,targetListingRevision:t.targetListingRevision,targetSourceHash:t.targetSourceHash,plannedReturnAt,plannedDeliveryAt,depositAmount:integer(moneyToCents(draft.depositAmount),'押金'),...Object.fromEntries(offlineSwapTextFields.map(([key,label])=>[key,text(draft[key],label)])),expiresAt,externalCompensationRequired:false};
}
export function offlineSwapPreviewSafe(raw:unknown,detail:Entity,input:Data):Data{
 const p=raw as Data;if(!p||p.changeId!==detail.id||p.orderId!==detail.orderId||p.revision!==detail.revision||p.pricingVersion!==2||p.financialGate!=='BEFORE_RETURN')throw Error('预览不属于当前换车版本');
 for(const key of ['previewHash','inputHash','sourceHash','pricingHash'])hash(p[key]);const target=swapTargetSafe(p.target);
 for(const key of ['targetListingId','targetListingRevision','targetSourceHash'])if((target as Data)[key]!==input[key])throw Error('预览商品已变化，请重新选择');
 for(const key of ['currentMonthlyFeeAmount','targetMonthlyFeeAmount','depositAmount','depositNetPaidAmount','depositChargeAmount','depositRefundAmount','handoverFeeAmount'])integer(p[key],key);
 if(p.targetMonthlyFeeAmount!==target.product.monthlyFeeAmount||p.depositAmount!==input.depositAmount||p.handoverFeeAmount!==0||!Array.isArray(p.periods)||!p.periods.length)throw Error('自动报价事实不完整');
 const ids=new Set<number>();for(const row of p.periods){for(const key of ['sequence','amount','originalAmount','differenceAmount','netPaidAmount','carryAmount','chargeAmount','refundAmount'])integer(row[key],key);if(row.sequence<1||ids.has(row.sequence)||row.amount!==row.originalAmount+row.differenceAmount||row.carryAmount!==Math.min(row.amount,row.netPaidAmount)||row.chargeAmount!==Math.max(0,row.amount-row.netPaidAmount)||row.refundAmount!==Math.max(0,row.netPaidAmount-row.amount))throw Error('逐期资金尚未核实');ids.add(row.sequence);for(const key of ['startDate','endDate','dueDate'])calendarDay(row[key]);if(row.startDate>=row.endDate)throw Error('服务月边界无效');}
 if(p.periods.some((r:Data,i:number)=>i>0&&p.periods[i-1].endDate!==r.startDate))throw Error('服务月边界必须连续');
 const account=detail.swapAccount as Data|undefined;if(account?.serviceStageId&&(!p.serviceStageScope||p.serviceStageScope.serviceStageId!==account.serviceStageId||p.serviceStageScope.stageSourceHash!==account.stageSourceHash||p.serviceStageScope.startDate!==account.term?.startDate||p.serviceStageScope.endDate!==account.term?.endDate))throw Error('预览不属于当前真实服务阶段');
 if(p.serviceStageScope){const s=p.serviceStageScope;text(s.serviceStageId,'当前阶段');hash(s.stageSourceHash);if(s.lastPeriodSequence-s.firstPeriodSequence+1!==p.periods.length||p.periods.some((r:Data,i:number)=>r.sequence!==s.firstPeriodSequence+i||r.stageSequence!==i+1)||p.periods[0].startDate!==s.startDate||p.periods.at(-1).endDate!==s.endDate)throw Error('预览不属于当前真实服务阶段');}
 return{...p,target};
}
export function offlineSwapQuotePayload(input:Data,seen:{input:Data;preview:Data},key:string){
 if(JSON.stringify(input)!==JSON.stringify(seen.input))throw Error('输入已经变化，请重新预览');hash(seen.preview.previewHash);return{...input,previewHash:seen.preview.previewHash,idempotencyKey:text(key,'请求编号',128)};
}
