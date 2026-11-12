export interface PartnerCancellation {id:string;status:'OPEN'|'COMPLETED';completedAt:string|null}
export interface PartnerArchiveRef {id:string;kind:'RENTAL'|'ORDER_AMENDMENT';currentApprovedVersionId:string|null;canRead:true;versions:{id:string;version:number;status:'ARCHIVED'|'INVALIDATED';contractNumber:string;signedOn:string|null}[]}
export interface PartnerPeriod {serviceStageId:string|null;startDate:string;endDate:string;months:number;monthlyFeeAmount:number|null;depositAmount:number|null;productName:string;baseAllowanceKm:number|null;excessPriceAmount:number|null;includedSwapCount:number|null}
export interface PartnerFuture extends PartnerPeriod {cancellation:PartnerCancellation|null;changeId:string;quoteId:string;contractId:string;status:string;confirmedAt:string;archive:PartnerArchiveRef|null}
export interface PartnerOrderView {ownerId:string;accessVersion:number;orderId:string;orderStatus:string;vehicle:{id:string;title:string;plateNumber:string}|null;originalContract:{id:string;executionMode:string;contractNumber:string;archive:PartnerArchiveRef|null}|null;currentPeriod:PartnerPeriod|null;futureRenewals:PartnerFuture[];cancelledRenewals:PartnerFuture[];amendments:{changeId:string;quoteId:string;contractId:string;kind:string;status:string;confirmedAt:string;archive:PartnerArchiveRef}[];blockers:string[];readOnly:true}
const validId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]+$/.test(v);
const stageId=(v:any)=>v===null||typeof v==='string'&&/^[A-Za-z0-9_:-]+$/.test(v);
const date=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function check(v:unknown):asserts v{if(!v)throw Error('订单资料不完整或查看范围已变化，请重新读取。');}
const money=(v:any)=>v===null||Number.isSafeInteger(v)&&v>=0&&v<=2147483647;
const instant=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function cancellation(v:any):PartnerCancellation|null{if(v==null)return null;check(v&&validId(v.id)&&['OPEN','COMPLETED'].includes(v.status)&&(v.status==='OPEN'?v.completedAt===null:instant(v.completedAt)));return{id:v.id,status:v.status,completedAt:v.completedAt};}
function renewal(r:any,completed=false):PartnerFuture{const c=cancellation(r.cancellation);check(['changeId','quoteId','contractId'].every(k=>validId(r[k]))&&instant(r.confirmedAt));check(completed?r.status==='CANCELLED'&&c?.status==='COMPLETED':['AWAITING_ARCHIVE','AWAITING_FINANCE','PREPARED','SCHEDULED'].includes(r.status)&&c?.status!=='COMPLETED');return{...period(r),changeId:r.changeId,quoteId:r.quoteId,contractId:r.contractId,status:r.status,confirmedAt:r.confirmedAt,archive:archive(r.archive),cancellation:c};}
function archive(v:any):PartnerArchiveRef|null{
 if(v===null)return null;check(v&&validId(v.id)&&['RENTAL','ORDER_AMENDMENT'].includes(v.kind)&&v.canRead===true&&(v.currentApprovedVersionId===null||validId(v.currentApprovedVersionId))&&Array.isArray(v.versions)&&v.versions.length>0);
 const versions=v.versions.map((r:any)=>{check(validId(r.id)&&Number.isSafeInteger(r.version)&&r.version>0&&['ARCHIVED','INVALIDATED'].includes(r.status)&&typeof r.contractNumber==='string'&&(r.signedOn===null||date(r.signedOn)));return{id:r.id,version:r.version,status:r.status,contractNumber:r.contractNumber,signedOn:r.signedOn};});check(v.currentApprovedVersionId===null||versions.some((r:any)=>r.id===v.currentApprovedVersionId));
 return{id:v.id,kind:v.kind,canRead:true,currentApprovedVersionId:v.currentApprovedVersionId,versions};
}
function period(v:any):PartnerPeriod{
 check(v&&stageId(v.serviceStageId)&&date(v.startDate)&&date(v.endDate)&&v.startDate<v.endDate&&Number.isInteger(v.months)&&v.months>0&&v.months<=120&&typeof v.productName==='string'&&['monthlyFeeAmount','depositAmount','baseAllowanceKm','excessPriceAmount','includedSwapCount'].every(k=>money(v[k])));
 return{serviceStageId:v.serviceStageId,startDate:v.startDate,endDate:v.endDate,months:v.months,monthlyFeeAmount:v.monthlyFeeAmount,depositAmount:v.depositAmount,productName:v.productName,baseAllowanceKm:v.baseAllowanceKm,excessPriceAmount:v.excessPriceAmount,includedSwapCount:v.includedSwapCount};
}
/** Construct a fresh allowlist DTO: unknown API fields never become view state. */
export function checkedPartnerOrder(v:any,ownerId:string,accessVersion:number,orderId?:string):PartnerOrderView{
 check(v&&v.readOnly===true&&v.ownerId===ownerId&&v.accessVersion===accessVersion&&validId(v.orderId)&&(!orderId||v.orderId===orderId)&&typeof v.orderStatus==='string'&&Array.isArray(v.futureRenewals)&&Array.isArray(v.amendments)&&Array.isArray(v.blockers)&&v.blockers.every((b:any)=>typeof b==='string'));
 let vehicle:PartnerOrderView['vehicle']=null,originalContract:PartnerOrderView['originalContract']=null;
 if(v.vehicle!==null){check(v.vehicle&&validId(v.vehicle.id)&&typeof v.vehicle.title==='string'&&typeof v.vehicle.plateNumber==='string');vehicle={id:v.vehicle.id,title:v.vehicle.title,plateNumber:v.vehicle.plateNumber};}
 if(v.originalContract!==null){const c=v.originalContract;check(c&&validId(c.id)&&['OFFLINE','ESIGN'].includes(c.executionMode)&&typeof c.contractNumber==='string');originalContract={id:c.id,executionMode:c.executionMode,contractNumber:c.contractNumber,archive:archive(c.archive)};}
 const futureRenewals=v.futureRenewals.map((r:any)=>renewal(r));check(v.cancelledRenewals===undefined||Array.isArray(v.cancelledRenewals));const cancelledRenewals=(v.cancelledRenewals??[]).map((r:any)=>renewal(r,true));
 const amendments=v.amendments.map((r:any)=>{check(['changeId','quoteId','contractId'].every(k=>validId(r[k]))&&['DELIVERY_DELAY','VEHICLE_CHANGE','SUBSCRIPTION_EXTENSION'].includes(r.kind)&&typeof r.status==='string'&&instant(r.confirmedAt));const a=archive(r.archive);check(a&&a.kind==='ORDER_AMENDMENT');return{changeId:r.changeId,quoteId:r.quoteId,contractId:r.contractId,kind:r.kind,status:r.status,confirmedAt:r.confirmedAt,archive:a};});
 return{ownerId,accessVersion,orderId:v.orderId,orderStatus:v.orderStatus,readOnly:true,vehicle,originalContract,currentPeriod:v.currentPeriod===null?null:period(v.currentPeriod),futureRenewals,cancelledRenewals,amendments,blockers:[...v.blockers]};
}
export function checkedPartnerOrders(v:any,ownerId:string,accessVersion:number){
 check(v&&Array.isArray(v.items)&&Number.isSafeInteger(v.total)&&v.total>=v.items.length&&Number.isSafeInteger(v.page)&&v.page>0&&Number.isInteger(v.pageSize)&&v.pageSize>0&&v.pageSize<=100&&v.items.length<=v.pageSize);
 return{items:v.items.map((r:any)=>checkedPartnerOrder(r,ownerId,accessVersion)),total:v.total,page:v.page,pageSize:v.pageSize};
}
export const partnerRenewalStatus=(status:string)=>({AWAITING_ARCHIVE:'客户已确认，纸质资料待归档',AWAITING_FINANCE:'纸质资料已归档，财务待核对',PREPARED:'未来账单已准备，尚未生效',SCHEDULED:'已安排续期，待运营生效',APPLIED:'已生效',CANCELLED:'已撤销',REJECTED:'未确认'}[status]||'状态待核对');
