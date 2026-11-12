import {ApiError} from './core.ts';
import {publicationCheckKeys,type PublishReadiness} from './vehicle-publish-readiness-model.ts';
export type CatalogReadiness=PublishReadiness&{catalogPublished:boolean;vehicleActivated:boolean;publishedPlanCount:number;blockers:{code:string;message:string}[]};
export type CatalogRecord={id:string;revision:number;status:string;catalogPublished:boolean};
export type CatalogMode='publish'|'withdraw';
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
export function catalogAccess(role:string|undefined,permissions:string[]){const has=(key:string)=>permissions.includes('*')||permissions.includes(key),operator=['ADMIN','OPERATIONS'].includes(role||'');return{read:operator&&has('vehicles.read'),write:operator&&has('vehicles.read')&&has('vehicles.write')&&has('goods.write')};}
export function checkedCatalogReadiness(raw:unknown,vehicleId:string):CatalogReadiness{
 const v=raw as CatalogReadiness;
 if(!v||v.vehicleId!==vehicleId||!integer(v.vehicleRevision)||typeof v.catalogPublished!=='boolean'||typeof v.vehicleActivated!=='boolean'||!integer(v.publishedPlanCount)||typeof v.ready!=='boolean'||!Array.isArray(v.blockers)||v.blockers.some(b=>!b||typeof b.code!=='string'||typeof b.message!=='string')||!Array.isArray(v.checks)||v.checks.length!==publicationCheckKeys.length||v.checks.some(c=>!c||typeof c.passed!=='boolean'||typeof c.required!=='boolean')||v.ready!==(v.vehicleActivated&&v.publishedPlanCount>0&&!v.blockers.length&&v.checks.every(c=>!c.required||c.passed)))throw new ApiError('商品上架条件与当前车辆不一致，请重新读取',0,'INVALID_RESPONSE');
 return v;
}
export function checkedCatalogRecord(raw:unknown,vehicleId:string):CatalogRecord{const v=raw as CatalogRecord;if(!v||v.id!==vehicleId||!integer(v.revision)||typeof v.status!=='string'||typeof v.catalogPublished!=='boolean')throw new ApiError('商品状态回读与当前车辆不一致',0,'INVALID_RESPONSE');return v;}
export class VehicleCatalogCommand{
 phase:'idle'|'unknown'|'readback'|'conflict'='idle';
 private pending?:{path:string;vehicleId:string;body:Readonly<{revision:number;idempotencyKey:string;reason?:string}>;published:boolean;committed:boolean;receiptRevision?:number};
 private disposed=false;
 private key:()=>string;
 constructor(key:()=>string=()=>crypto.randomUUID()){this.key=key;}
 get hasPending(){return !!this.pending;}
 dispose(){this.disposed=true;this.pending=undefined;this.phase='idle';}
 async execute(vehicleId:string,mode:CatalogMode,revision:number,reason:string,request:(path:string,body:Readonly<Record<string,unknown>>)=>Promise<unknown>,read:(id:string)=>Promise<unknown>,apply:(value:CatalogRecord)=>Promise<void>|void){
  if(this.disposed)throw new ApiError('登录或权限已变化，请重新进入当前业务',0,'SESSION_CHANGED');
  if(this.phase==='conflict')throw new Error('车辆版本已变化，请重新读取后再操作');
  if(!this.pending){if(!vehicleId||!integer(revision))throw new Error('当前车辆版本尚未确认');const text=reason.trim();if(text.length>500)throw new Error('操作说明最多500字');this.pending={path:`/admin/vehicles/${encodeURIComponent(vehicleId)}/catalog/${mode}`,vehicleId,body:Object.freeze({revision,idempotencyKey:this.key(),...(text?{reason:text}:{})}),published:mode==='publish',committed:false};}
  const p=this.pending;
  try{
   if(!p.committed){
    let raw:unknown;try{raw=await request(p.path,p.body);p.committed=true;}catch(e){if(e instanceof ApiError&&e.code==='INVALID_RESPONSE'&&e.status>=200&&e.status<300)p.committed=true;throw e;}
    if(this.disposed)throw new ApiError('登录会话已变化',0,'SESSION_CHANGED');
    const receipt=checkedCatalogRecord(raw,p.vehicleId);if((raw as {vehicleId?:string}).vehicleId!==p.vehicleId||receipt.revision!==p.body.revision+1||receipt.catalogPublished!==p.published)throw new ApiError('商品操作回执不完整，请重新读取原操作结果',0,'INVALID_RESPONSE');p.receiptRevision=receipt.revision;
   }
   this.phase='readback';const value=checkedCatalogRecord(await read(p.vehicleId),p.vehicleId);
   if(this.disposed)throw new ApiError('登录会话已变化',0,'SESSION_CHANGED');
   const committedRevision=p.receiptRevision??p.body.revision+1;
   if(value.revision<committedRevision||value.revision===committedRevision&&value.catalogPublished!==p.published)throw new ApiError('已提交，商品最新状态尚未核对，请重新读取',0,'INVALID_RESPONSE');
   await apply(value);if(this.disposed)throw new ApiError('登录会话已变化',0,'SESSION_CHANGED');this.pending=undefined;this.phase='idle';
  }catch(e){if(!this.disposed){if(p.committed)this.phase='readback';else if(e instanceof ApiError&&e.status>=400&&e.status<500&&e.code!=='INVALID_RESPONSE'){this.pending=undefined;this.phase=e.status===409?'conflict':'idle';}else this.phase='unknown';}throw e;}
 }
}
