import {ApiError,moneyToCents} from './core.ts';
import {CommandIdentity} from './domain-commands.ts';
export const yuan=moneyToCents;
export function percent(text:string){if(!/^-?\d+(\.\d+)?$/.test(text.trim()))throw Error('请输入有效百分比');return Number(text)/100;}
export const inputFingerprint=(input:unknown)=>JSON.stringify(input);
export const referenceCurrent=(fingerprint:string|undefined,input:unknown)=>fingerprint!==undefined&&fingerprint===inputFingerprint(input);
export const frozenExport=(record:unknown)=>JSON.stringify(record,null,2);
export function defaultGroups(vehicles:Record<string,any>[]){const groups=new Map<string,{groupKey:string;label:string;vehicleIds:string[]}>();for(const v of vehicles){const key=JSON.stringify([v.modelDefinitionId||v.model,v.modelYear??null,v.batteryOwnership,v.batteryCapacityKwh==null?null:Number(v.batteryCapacityKwh)]);let group=groups.get(key);if(!group){group={groupKey:'group-'+(groups.size+1),label:[v.model||v.modelDefinitionId,v.modelYear,v.batteryOwnership,v.batteryCapacityKwh==null?'规格未知':Number(v.batteryCapacityKwh)+'kWh'].filter(Boolean).join(' / '),vehicleIds:[]};groups.set(key,group);}if(!group.vehicleIds.includes(v.id))group.vehicleIds.push(v.id);}return [...groups.values()];}
type Requester=(path:string,options:{method:string;permission:string;body:Record<string,unknown>})=>Promise<any>;
/** An unresolved write survives navigation through sessionPendingIntent. */
export class PricingWriteCommand{
 phase:'idle'|'unknown'|'conflict'='idle';private identity=new CommandIdentity();private pending?:{path:string;body:Record<string,unknown>;permission:string};private epoch=0;private running=false;
 get hasPending(){return !!this.pending;}
 dispose(){this.epoch++;this.pending=undefined;this.phase='idle';}
 async execute(path:string,body:Record<string,unknown>,permission:string,request:Requester):Promise<any>{
  if(this.running)throw Error('请求正在处理中');this.running=true;const epoch=this.epoch;
  try{if(!this.pending){const snapshot=structuredClone(body);this.pending={path,permission,body:{...snapshot,idempotencyKey:this.identity.for(path,snapshot)}};}
   const p=this.pending;const result=await request(p.path,{method:'POST',permission:p.permission,body:p.body});
   if(epoch!==this.epoch)throw Error('登录或权限已变化');if(!result||typeof result!=='object'||![result.id,result.productId].some(value=>typeof value==='string'&&value.length>0))throw Error('保存响应缺少记录编号，请按原请求重试核对');this.pending=undefined;this.phase='idle';return result;
  }catch(error){if(epoch===this.epoch){if(error instanceof ApiError&&error.status>=400&&error.status<500){this.pending=undefined;this.phase=error.status===409?'conflict':'idle';}else if(this.pending)this.phase='unknown';}throw error;}finally{this.running=false;}
 }
}


export const historyResponseCurrent=(token:number,epoch:number,currentSequence:number,currentEpoch:number)=>token===currentSequence&&epoch===currentEpoch;
/** Finance may calculate prices without loading the operations-only benefits source. */
export function pricingEditableFields<T extends {key:string}>(fields:T[],role:string|undefined){return role==='FINANCE'?fields.filter(field=>field.key!=='benefitVersionIds'):fields;}
export function pricingGroupRequest(group:Record<string,any>,draft:Record<string,any>){
 return {groupKey:group.groupKey,vehicleIds:group.vehicleIds,draft,...(group.customerBaasIncomeTreatment?{customerBaasIncomeTreatment:group.customerBaasIncomeTreatment}:{}),...(group.customerBaasIncomeBasisNotes?.trim()?{customerBaasIncomeBasisNotes:group.customerBaasIncomeBasisNotes.trim()}:{})};
}
