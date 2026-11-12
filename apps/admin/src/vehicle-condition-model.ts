import {ApiError} from './core';
export const conditionFields=[['fireDamage','是否有火烧'],['floodDamage','是否有泡水'],['structuralDamage','是否有结构性损伤']] as const;
export type ConditionKey=typeof conditionFields[number][0];
export type ConditionAssessment={vehicleId:string;vehicleRevision:number;revision:number;registered:boolean;fireDamage:boolean|null;floodDamage:boolean|null;structuralDamage:boolean|null;assessedBy:string|null;assessedAt:string|null};
export type ConditionDraft=Record<ConditionKey,string>;
export type ConditionCommand={revision:number;vehicleRevision:number;idempotencyKey:string;fireDamage:boolean;floodDamage:boolean;structuralDamage:boolean;reason?:string};
export function checkCondition(value:unknown,vehicleId:string):ConditionAssessment{
 const v=value as ConditionAssessment;
 if(!v||v.vehicleId!==vehicleId||!Number.isSafeInteger(v.revision)||v.revision<0||!Number.isSafeInteger(v.vehicleRevision)||v.vehicleRevision<0||typeof v.registered!=='boolean'||conditionFields.some(([key])=>v[key]!==null&&typeof v[key]!=='boolean')||v.registered&&(v.revision<1||conditionFields.some(([key])=>typeof v[key]!=='boolean')||typeof v.assessedBy!=='string'||!v.assessedBy||typeof v.assessedAt!=='string'||!Number.isFinite(Date.parse(v.assessedAt)))||!v.registered&&(v.revision!==0||conditionFields.some(([key])=>v[key]!==null)||v.assessedBy!==null||v.assessedAt!==null))throw new ApiError('车况基础判断回执与当前车辆不一致，请重新核对。',0,'INVALID_RESPONSE');
 return v;
}
export function conditionDraft(v:ConditionAssessment):ConditionDraft{return Object.fromEntries(conditionFields.map(([key])=>[key,v[key]===null?'':String(v[key])])) as ConditionDraft;}
export function conditionMatches(v:ConditionAssessment,b:ConditionCommand){return v.registered&&v.revision>=b.revision+1&&v.vehicleRevision>=b.vehicleRevision&&conditionFields.every(([key])=>v[key]===b[key]);}
export function conditionReceipt(value:unknown,vehicleId:string,body:ConditionCommand){const v=checkCondition(value,vehicleId);if(!conditionMatches(v,body)||v.revision!==body.revision+1||v.vehicleRevision!==body.vehicleRevision)throw new ApiError('车况基础判断保存回执不匹配，请重新读取结果。',0,'INVALID_RESPONSE');return v;}
