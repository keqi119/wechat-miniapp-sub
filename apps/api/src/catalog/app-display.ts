import {HttpException} from '@nestjs/common';
import {ZodError} from 'zod';
import {listedProductSnapshot} from '../products/snapshot';
import {applicationCooperationEligible} from '../vehicles/application-eligibility';

export type AppDisplayReason={code:string;message:string};
export type AppDisplay={visible:boolean;available:boolean;state:'VISIBLE_AVAILABLE'|'VISIBLE_UNAVAILABLE'|'NOT_VISIBLE';reasons:AppDisplayReason[];checkedAt:string};

/** Source validation shared by public plan rendering and the admin's App projection. */
export function catalogPlanSource(plan:any,vehicle:any):{snapshot:ReturnType<typeof listedProductSnapshot>|null;reason:AppDisplayReason|null}{
 try{return{snapshot:listedProductSnapshot({...plan,vehicle}),reason:null};}
 catch(error){
  if(error instanceof HttpException){const body=error.getResponse(),detail=typeof body==='object'&&body!==null&&'error' in body?(body as {error?:Partial<AppDisplayReason>}).error:null;return{snapshot:null,reason:{code:typeof detail?.code==='string'?detail.code:'GOODS_SOURCE_INVALID',message:typeof detail?.message==='string'?detail.message:'商品产品来源当前不可展示'}};}
  if(error instanceof ZodError)return{snapshot:null,reason:{code:'PRODUCT_CONFIGURATION_INVALID',message:'产品配置不完整或无效'}};
  throw error;
 }
}

/** A visible vehicle/plan can remain readable while its application is unavailable. */
export async function catalogAppDisplay(db:any,plan:any,vehicle:any,at=new Date()):Promise<AppDisplay>{
 const source=catalogPlanSource(plan,vehicle),listing=plan?.listing,reasons:AppDisplayReason[]=[];
 if(vehicle?.status!=='PUBLISHED')reasons.push({code:'VEHICLE_NOT_PUBLISHED',message:vehicle?.status==='DRAFT'?'车辆尚未激活':vehicle?.status==='UNPUBLISHED'?'车辆已停用，App不展示':'车辆当前未激活'});
 if(vehicle?.catalogPublished!==true)reasons.push({code:'CATALOG_NOT_PUBLISHED',message:'车辆商品尚未上架，App不展示'});
 if(listing?.status!=='PUBLISHED')reasons.push({code:'GOODS_NOT_PUBLISHED',message:listing?.status==='WITHDRAWN'?'产品方案已下架':'产品方案尚未上架'});
 if(listing?.visible!==true)reasons.push({code:'DISPLAY_DISABLED',message:'未开启产品方案展示'});
 if(!plan?.active)reasons.push({code:'PLAN_INACTIVE',message:'关联套餐未启用'});
 if(source.reason&&(source.reason.code!=='GOODS_UNAVAILABLE'||!reasons.some(r=>['GOODS_NOT_PUBLISHED','DISPLAY_DISABLED','PLAN_INACTIVE'].includes(r.code))))reasons.push(source.reason);
 const visible=vehicle?.status==='PUBLISHED'&&vehicle?.catalogPublished===true&&source.snapshot!==null;
 let available=false;
 if(visible){
  if(vehicle.reservedOrderId)reasons.push({code:'VEHICLE_RESERVED',message:'车辆已被订单占用，App可查看但暂不可申请'});
  if(vehicle.holdId)reasons.push({code:'VEHICLE_HELD',message:'车辆已被预留，App可查看但暂不可申请'});
  if(!vehicle.reservedOrderId&&!vehicle.holdId){available=await applicationCooperationEligible(db,vehicle.id,source.snapshot!.months,at);if(!available)reasons.push({code:'APPLICATION_UNAVAILABLE',message:'本方案的合作资格或运营限制暂不满足申请条件，App仍可查看'});}
 }
 return{visible,available,state:!visible?'NOT_VISIBLE':available?'VISIBLE_AVAILABLE':'VISIBLE_UNAVAILABLE',reasons,checkedAt:at.toISOString()};
}
