import {ApiError} from './core.ts';
export const publicationCheckKeys=['VEHICLE_INFO','PARTNER_INFO','PRODUCT','PHOTOS','BAAS','CONDITION'] as const;
export type PublicationCheck={key:typeof publicationCheckKeys[number];label:string;passed:boolean;required:boolean;messages:string[];targetView:string};
export type PublishReadiness={vehicleId:string;vehicleRevision:number;goodsId?:string;goodsRevision?:number;checkedAt:string;publicationDate:string;ready:boolean;checks:PublicationCheck[]};
export type PublicationScope={vehicleId:string;goodsId?:string;vehicleRevision?:number;goodsRevision?:number};
const views=['overview','documents','photos','inspection','insurance','battery-baas','listing','valuation','capital','unclassified'];
export function publicationCheckHref(vehicleId:string,targetView:string){if(!views.includes(targetView))throw new Error('发布条件资料入口不受支持。');return '#vehicles?'+new URLSearchParams({record:vehicleId,view:targetView});}
export function checkPublishReadiness(raw:unknown,scope:PublicationScope):PublishReadiness{
 const v=raw as PublishReadiness,integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
 if(!v||v.vehicleId!==scope.vehicleId||!integer(v.vehicleRevision)||scope.vehicleRevision!==undefined&&v.vehicleRevision!==scope.vehicleRevision||scope.goodsId!==undefined&&(v.goodsId!==scope.goodsId||!integer(v.goodsRevision)||scope.goodsRevision!==undefined&&v.goodsRevision!==scope.goodsRevision)||scope.goodsId===undefined&&(v.goodsId!==undefined||v.goodsRevision!==undefined)||typeof v.checkedAt!=='string'||!Number.isFinite(Date.parse(v.checkedAt))||typeof v.publicationDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.publicationDate)||typeof v.ready!=='boolean'||!Array.isArray(v.checks)||v.checks.length!==publicationCheckKeys.length||v.checks.some((check,i)=>!check||check.key!==publicationCheckKeys[i]||typeof check.label!=='string'||!check.label.trim()||typeof check.passed!=='boolean'||typeof check.required!=='boolean'||check.key!=='BAAS'&&!check.required||!Array.isArray(check.messages)||check.messages.some(message=>typeof message!=='string')||!views.includes(check.targetView))||v.ready!==v.checks.every(check=>!check.required||check.passed))throw new ApiError('发布条件回执不完整或与当前记录不一致，请刷新核对。',0,'INVALID_RESPONSE');
 return v;
}
