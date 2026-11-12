import {consentRecords,loginDocumentTypes,smsPayload} from './model.ts';
import type {LegalDocument} from './model.ts';
export type CompanyTab='overview'|'vehicles'|'orders'|'revenue';
export interface InvitationPreview {mode?:'ELECTRONIC_LEGAL';previewToken:string;companyName:string;ownerId:string;maskedMobile:string;expiresAt:string}
export interface CompanyAgreement {id:string;status:string;versionId:string;version:number;title:string;referenceNumber:string;partnerRateBps:number;validFrom:string|null;validUntil:string|null;vehicleCount:number;files:{id:string;name:string;mimeType:string;size:number}[]}
export interface CompanyVehicle {vehicleId:string;plateNumber:string;modelId:string|null;modelName:string;status:string;agreementId:string;agreementTitle:string;partnerRateBps:number;cooperationActive:boolean}
export interface CompanyVehicles {items:CompanyVehicle[];total:number;page:number;pageSize:number;models:{id:string;name:string}[];agreements:{id:string;title:string}[]}
export interface RevenueTotals {receivedAmount:number;refundedAmount:number;netAmount:number;partnerAmount:number;platformAmount:number}
export interface RevenueItem {id:string;sourceType:'PAYMENT'|'REFUND';sourceId:string;agreementId:string;agreementVersionId:string;agreementTitle:string;vehicleId:string;modelId:string|null;modelName:string;plateNumber:string;partnerRateBps:number;amount:number;partnerAmount:number;platformAmount:number;occurredAt:string}
export interface Revenue {totals:RevenueTotals;groups:(RevenueTotals&{key:string;label:string;count:number})[];items:RevenueItem[];total:number;page:number;pageSize:number;incompleteCount:number;filters?:{agreements:{id:string;title:string}[];models:{id:string;name:string}[];vehicles:{id:string;plateNumber:string;modelId:string|null;agreementId:string}[]}}
export interface RevenueFilters {from:string;to:string;agreementId?:string;modelId?:string;vehicleId?:string;groupBy:'month'|'agreement'|'model'|'vehicle';page:number}
const safeId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value);
function requireValue(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
export function invitationPreviewPayload(mobile:string,invitationCode:string){requireValue(/^[A-Za-z0-9_-]{24}(?:[A-Za-z0-9_-]{19})?$/.test(invitationCode),'请输入运营提供的完整邀请码。');return{...smsPayload(mobile),invitationCode};}
export function validateInvitationPreview(value:unknown):InvitationPreview {
 const preview=value as InvitationPreview;requireValue(preview&&/^[a-f0-9]{64}$/.test(preview.previewToken)&&safeId(preview.ownerId)&&typeof preview.companyName==='string'&&preview.companyName.length&&typeof preview.maskedMobile==='string'&&Number.isFinite(Date.parse(preview.expiresAt))&&Date.parse(preview.expiresAt)>Date.now(),'邀请已失效，请重新核对手机号与邀请码。');return preview;
}
export function invitationConfirmPayload(preview:InvitationPreview,accepted:boolean,documents:LegalDocument[]){validateInvitationPreview(preview);requireValue(accepted,'请先阅读并同意服务协议及隐私政策。');return{previewToken:preview.previewToken,consents:consentRecords(documents,loginDocumentTypes)};}
export function companyRoute(hash:string,ownerId:string):{tab:CompanyTab;orderId?:string}{const match=/^#\/owners\/([A-Za-z0-9_-]+)\/(overview|vehicles|orders|revenue)(?:\/([A-Za-z0-9_-]+))?$/.exec(hash);return match&&match[1]===ownerId&&(!match[3]||match[2]==='orders')?{tab:match[2] as CompanyTab,...(match[3]?{orderId:match[3]}:{})}:{tab:'overview'};}
export function datePreset(preset:'month'|'previous'|'year',now=new Date()){
 const china=new Date(now.getTime()+8*3600000),year=china.getUTCFullYear(),month=china.getUTCMonth(),start=new Date(Date.UTC(year,preset==='year'?0:month-(preset==='previous'?1:0),1)),end=new Date(Date.UTC(year,preset==='year'?12:month+(preset==='previous'?0:1),0));
 return{from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
}
function date(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function revenueQuery(filters:RevenueFilters){
 requireValue(date(filters.from)&&date(filters.to)&&filters.from<=filters.to,'请选择有效的起止日期，结束日期不能早于开始日期。');requireValue(['month','agreement','model','vehicle'].includes(filters.groupBy)&&Number.isSafeInteger(filters.page)&&filters.page>0,'统计条件不正确。');
 const params=new URLSearchParams({from:filters.from,to:filters.to});for(const key of ['agreementId','modelId','vehicleId'] as const)if(filters[key]){requireValue(safeId(filters[key]),'统计范围不正确。');params.set(key,filters[key]);}params.set('groupBy',filters.groupBy);params.set('page',String(filters.page));params.set('pageSize','20');return params.toString();
}
const totalKeys=['receivedAmount','refundedAmount','netAmount','partnerAmount','platformAmount'] as const;
export function validateRevenue(value:unknown):Revenue {
 const revenue=value as Revenue,validTotals=(totals:any)=>totals&&totalKeys.every(key=>Number.isSafeInteger(totals[key]));
 requireValue(revenue&&validTotals(revenue.totals)&&Array.isArray(revenue.groups)&&Array.isArray(revenue.items)&&Number.isSafeInteger(revenue.total)&&revenue.total>=0&&Number.isSafeInteger(revenue.incompleteCount)&&revenue.incompleteCount>=0&&Number.isSafeInteger(revenue.page)&&revenue.page>0&&Number.isSafeInteger(revenue.pageSize)&&revenue.pageSize>0,'统计数据尚未完整返回，请重新读取。');
 requireValue(revenue.groups.every(group=>validTotals(group)&&typeof group.key==='string'&&typeof group.label==='string'&&Number.isSafeInteger(group.count)&&group.count>=0)&&revenue.items.every(item=>safeId(item.id)&&safeId(item.vehicleId)&&safeId(item.agreementId)&&['PAYMENT','REFUND'].includes(item.sourceType)&&[item.amount,item.partnerAmount,item.platformAmount,item.partnerRateBps].every(Number.isSafeInteger)&&item.partnerRateBps>=0&&item.partnerRateBps<=10000&&Number.isFinite(Date.parse(item.occurredAt))),'统计明细不完整，请重新读取。');return revenue;
}
export const rateLabel=(rate:number)=>Number.isInteger(rate)&&rate>=0&&rate<=10000?`${(rate/100).toFixed(2)}%`:'待核对';
