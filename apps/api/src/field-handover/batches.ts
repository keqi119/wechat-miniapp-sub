import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import {ensure} from '../common/errors';

export type FieldHandoverType='DELIVERY'|'RETURN'|'SWAP_RETURN'|'SWAP_DELIVERY';
type Moment=Date|string|null;
export type FieldBatchOrder={id:string;customerId:string;vehicleId:string;currentAssignmentId?:string|null;effectiveTermsVersionId?:string|null};
export type FieldBatchTerms={id:string;orderId:string;version?:number};
export type FieldBatchChange={id:string;orderId:string;customerId:string;kind:string;status:string;activeQuoteId:string|null;targetVehicleId:string|null;returnHandoverId?:string|null;deliveryHandoverId?:string|null};
export type FieldBatchQuote={id:string;changeId:string;revision:number;status:string;snapshot:{originalAssignmentId?:string;targetVehicleId?:string}};
export type FieldBatchAssignment={id:string;orderId:string;customerId:string;vehicleId:string;changeId?:string|null;status:string;startAt:Moment;startReadingKm:number;endAt:Moment;endReadingKm:number|null;deliveryHandoverId:string|null;returnHandoverId:string|null};
export type FieldBatchHandover={id:string;orderId:string;customerId:string;vehicleId:string|null;assignmentId:string|null;changeId?:string|null;type:string;status:string;actualAt:Moment;readingKm:number;fieldTaskId?:string|null;executionMode?:string;revision?:number;manifestHash?:string};
export type FieldBatchTask={id:string;orderId:string;type:string;status:string;vehicleId:string;vehicleAssignmentId?:string|null;currentHandoverId?:string|null;batchKey?:string|null;changeId?:string|null;quoteId?:string|null;termsVersionId?:string|null};
/** Complete rows for this order, read in one transaction by the calling service. */
export type FieldBatchFacts={order:FieldBatchOrder;termsVersions:readonly FieldBatchTerms[];changes:readonly FieldBatchChange[];quotes:readonly FieldBatchQuote[];assignments:readonly FieldBatchAssignment[];handovers:readonly FieldBatchHandover[];tasks:readonly FieldBatchTask[];swapReceipts?:readonly any[]};
export type FieldHandoverBatch={orderId:string;customerId:string;type:FieldHandoverType;batchKey:string;changeId:string|null;quoteId:string|null;termsVersionId:string|null;vehicleId:string;vehicleAssignmentId:string|null;currentHandoverId:string|null};
const id=z.string().trim().min(1).max(128).refine(value=>!value.includes('\0'),'编号不得含空字符');
const type=z.enum(['DELIVERY','RETURN','SWAP_RETURN','SWAP_DELIVERY']);
export const fieldBatchInput=z.object({orderId:id,type,changeId:id.nullable().optional()}).strict().superRefine((value,ctx)=>{if(value.type.startsWith('SWAP_')?!value.changeId:value.changeId!=null)ctx.addIssue({code:'custom',path:['changeId'],message:'换车必须指定真实变更；普通交还车不得指定变更'});});
export function isReturnFieldHandover(value:string){const parsed=type.parse(value);return parsed==='RETURN'||parsed==='SWAP_RETURN';}
export function fieldReceiptKind(value:string){return isReturnFieldHandover(value)?'RETURN_RECEIPT' as const:'DELIVERY_RECEIPT' as const;}
const isId=(value:unknown):value is string=>id.safeParse(value).success;
const at=(value:Moment)=>value===null?NaN:new Date(value).getTime();
const sameAt=(a:Moment,b:Moment)=>Number.isFinite(at(a))&&at(a)===at(b);
const validReading=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=2147483647;
function check(value:unknown,code='FIELD_BATCH_SOURCE_INVALID'):asserts value{ensure(value,409,code,'交接批次来源不完整或已变化，请核对原交接事实');}
function one<T extends {id:string}>(rows:readonly T[],value:unknown,code:string):T{check(isId(value),code);const matches=rows.filter(row=>row.id===value);check(matches.length===1,code);return matches[0];}
function scopedHandover(h:FieldBatchHandover,f:FieldBatchFacts,vehicleId:string,assignmentId:string|null,expectedType:string,changeId:string|null,code='FIELD_BATCH_ASSIGNMENT_INVALID'){
 check(h.orderId===f.order.id&&h.customerId===f.order.customerId&&h.vehicleId===vehicleId&&h.assignmentId===assignmentId&&h.type===expectedType&&(h.changeId??null)===changeId,code);
}
function deliveryProof(a:FieldBatchAssignment,f:FieldBatchFacts){
 const code='FIELD_BATCH_ASSIGNMENT_INVALID';check(a.orderId===f.order.id&&a.customerId===f.order.customerId&&isId(a.vehicleId)&&Number.isFinite(at(a.startAt))&&validReading(a.startReadingKm)&&['ACTIVE','CLOSED'].includes(a.status),code);
 const h=one(f.handovers,a.deliveryHandoverId,code),swap=!!a.changeId;scopedHandover(h,f,a.vehicleId,a.id,swap?'SWAP_DELIVERY':'DELIVERY',a.changeId??null);
 check(h.status==='COMPLETED'&&sameAt(h.actualAt,a.startAt)&&h.readingKm===a.startReadingKm,code);
 if(swap){const c=one(f.changes,a.changeId,code);check(c.kind==='VEHICLE_CHANGE'&&c.orderId===f.order.id&&c.customerId===f.order.customerId&&c.status==='APPLIED'&&c.targetVehicleId===a.vehicleId&&c.deliveryHandoverId===h.id,code);}
 if(a.status==='ACTIVE')check(a.endAt===null&&a.endReadingKm===null&&a.returnHandoverId===null,code);
 return a;
}
function returnProof(a:FieldBatchAssignment,f:FieldBatchFacts,changeId?:string){
 const code='FIELD_BATCH_RETURN_REQUIRED';check(a.status==='CLOSED'&&Number.isFinite(at(a.endAt))&&at(a.endAt)>=at(a.startAt)&&validReading(a.endReadingKm)&&a.endReadingKm!>=a.startReadingKm,code);
 const h=one(f.handovers,a.returnHandoverId,code);check(changeId?h.type==='SWAP_RETURN':h.type==='RETURN'||h.type==='SWAP_RETURN',code);scopedHandover(h,f,a.vehicleId,a.id,h.type,h.type==='RETURN'?null:changeId??h.changeId??null,code);
 const receipt=(f.swapReceipts??[]).find(e=>e.changeId===h.changeId&&e.assignmentId===a.id);
 if(receipt){const c=one(f.changes,h.changeId,code);check(h.executionMode==='ELECTRONIC'&&receipt.orderId===f.order.id&&receipt.customerId===f.order.customerId&&receipt.vehicleId===a.vehicleId&&receipt.handoverId===h.id&&receipt.handoverRevision===h.revision&&receipt.manifestHash===h.manifestHash&&receipt.quoteId===c.activeQuoteId&&sameAt(receipt.receivedAt,a.endAt)&&receipt.readingKm===a.endReadingKm,code);}
 else check(h.status==='COMPLETED'&&sameAt(h.actualAt,a.endAt)&&h.readingKm===a.endReadingKm,code);
 if(h.type==='SWAP_RETURN'){const c=one(f.changes,h.changeId,code);check(c.kind==='VEHICLE_CHANGE'&&c.orderId===f.order.id&&c.customerId===f.order.customerId&&['SWAP_RETURNED','APPLIED'].includes(c.status)&&c.returnHandoverId===h.id&&(!changeId||c.id===changeId),code);}
 return receipt?{...h,actualAt:receipt.receivedAt,readingKm:receipt.readingKm}:h;
}
function currentTerms(f:FieldBatchFacts){
 const pointer=f.order.effectiveTermsVersionId??null,rows=f.termsVersions.filter(row=>row.orderId===f.order.id);if(pointer===null){check(!rows.length,'FIELD_BATCH_TERMS_INVALID');return null;}
 const row=one(f.termsVersions,pointer,'FIELD_BATCH_TERMS_INVALID');check(row.orderId===f.order.id&&row.id!=='INITIAL','FIELD_BATCH_TERMS_INVALID');return row.id;
}
function currentHandover(f:FieldBatchFacts,t:string,assignmentId?:string){const rows=f.handovers.filter(h=>h.orderId===f.order.id&&h.type===t&&h.status!=='SUPERSEDED'&&(assignmentId===undefined||h.assignmentId===assignmentId));check(rows.length<=1,'FIELD_BATCH_HANDOVER_CONFLICT');return rows[0]?.id??null;}
/** Pure source resolution only; financial, legal and vehicle eligibility guards remain in their existing command owner. */
export function deriveFieldHandoverBatch(raw:unknown,f:FieldBatchFacts):FieldHandoverBatch{
 const input=fieldBatchInput.parse(raw),o=f.order;check(o&&input.orderId===o.id&&isId(o.customerId)&&isId(o.vehicleId),'FIELD_BATCH_ORDER_INVALID');
 const base={orderId:o.id,customerId:o.customerId,type:input.type,changeId:null,quoteId:null,termsVersionId:null,vehicleId:o.vehicleId,vehicleAssignmentId:null,currentHandoverId:null};
 if(input.type==='DELIVERY'){
  check(!o.currentAssignmentId&&!f.assignments.some(a=>a.orderId===o.id)&&!f.handovers.some(h=>h.orderId===o.id&&['DELIVERY','SWAP_DELIVERY'].includes(h.type)&&h.status==='COMPLETED'),'FIELD_BATCH_ALREADY_DELIVERED');const termsVersionId=currentTerms(f);
  return{...base,termsVersionId,batchKey:'DELIVERY:'+(termsVersionId??'INITIAL'),currentHandoverId:currentHandover(f,'DELIVERY')};
 }
 if(input.type==='RETURN'){
  const a=deliveryProof(one(f.assignments,o.currentAssignmentId,'FIELD_BATCH_ASSIGNMENT_INVALID'),f);check(a.status==='ACTIVE'&&a.vehicleId===o.vehicleId,'FIELD_BATCH_ASSIGNMENT_INVALID');
  return{...base,batchKey:'FINAL_RETURN:'+a.id,vehicleId:a.vehicleId,vehicleAssignmentId:a.id,currentHandoverId:currentHandover(f,'RETURN',a.id)};
 }
 const c=one(f.changes,input.changeId,'FIELD_BATCH_CHANGE_INVALID');check(c.kind==='VEHICLE_CHANGE'&&c.orderId===o.id&&c.customerId===o.customerId&&!['CANCELLED','REJECTED'].includes(c.status)&&isId(c.targetVehicleId),'FIELD_BATCH_CHANGE_INVALID');
 const q=one(f.quotes,c.activeQuoteId,'FIELD_BATCH_QUOTE_INVALID');check(q.changeId===c.id&&q.status==='CONFIRMED'&&Number.isInteger(q.revision)&&q.revision>0&&q.snapshot?.targetVehicleId===c.targetVehicleId,'FIELD_BATCH_QUOTE_INVALID');
 const a=deliveryProof(one(f.assignments,q.snapshot.originalAssignmentId,'FIELD_BATCH_ASSIGNMENT_INVALID'),f);check(a.vehicleId!==c.targetVehicleId,'FIELD_BATCH_CHANGE_INVALID');
 const source={...base,changeId:c.id,quoteId:q.id,batchKey:`CHANGE:${c.id}:${input.type==='SWAP_RETURN'?'RETURN':'DELIVERY'}`};
 if(input.type==='SWAP_RETURN'){
  if(a.status==='ACTIVE'){check(o.currentAssignmentId===a.id&&o.vehicleId===a.vehicleId,'FIELD_BATCH_ASSIGNMENT_INVALID');if(c.returnHandoverId){const h=one(f.handovers,c.returnHandoverId,'FIELD_BATCH_ASSIGNMENT_INVALID');scopedHandover(h,f,a.vehicleId,a.id,'SWAP_RETURN',c.id);check(!['COMPLETED','SUPERSEDED'].includes(h.status),'FIELD_BATCH_ASSIGNMENT_INVALID');}}
  else{const h=returnProof(a,f,c.id);check(c.returnHandoverId===h.id,'FIELD_BATCH_RETURN_REQUIRED');}
  return{...source,vehicleId:a.vehicleId,vehicleAssignmentId:a.id,currentHandoverId:c.returnHandoverId??null};
 }
 const returned=returnProof(a,f,c.id);check(returned.id===c.returnHandoverId,'FIELD_BATCH_RETURN_REQUIRED');let assignmentId:string|null=null;
 if(c.deliveryHandoverId){
  const h=one(f.handovers,c.deliveryHandoverId,'FIELD_BATCH_ASSIGNMENT_INVALID');
  if(h.status==='COMPLETED'){const incoming=deliveryProof(one(f.assignments,h.assignmentId,'FIELD_BATCH_ASSIGNMENT_INVALID'),f);check(incoming.changeId===c.id&&incoming.deliveryHandoverId===h.id&&incoming.vehicleId===c.targetVehicleId&&at(h.actualAt)>=at(returned.actualAt),'FIELD_BATCH_ASSIGNMENT_INVALID');assignmentId=incoming.id;}
  else{scopedHandover(h,f,c.targetVehicleId,null,'SWAP_DELIVERY',c.id);check(h.status!=='SUPERSEDED'&&!o.currentAssignmentId,'FIELD_BATCH_ASSIGNMENT_INVALID');}
 }else check(!o.currentAssignmentId&&!f.assignments.some(row=>row.orderId===o.id&&row.changeId===c.id),'FIELD_BATCH_ASSIGNMENT_INVALID');
 return{...source,vehicleId:c.targetVehicleId,vehicleAssignmentId:assignmentId,currentHandoverId:c.deliveryHandoverId??null};
}
export type LegacyFieldBatch={batchKey:string;changeId:null;quoteId:null;termsVersionId:null;vehicleAssignmentId:string|null;resolved:boolean};
/** Migration advice only. Never writes a row or guesses a historical terms ID from timestamps. */
export function legacyFieldTaskBatch(task:FieldBatchTask,f:FieldBatchFacts):LegacyFieldBatch{
 check(task.orderId===f.order.id&&isId(task.id)&&isId(task.vehicleId)&&['DELIVERY','RETURN'].includes(task.type),'FIELD_BATCH_LEGACY_UNVERIFIED');
 const fallback:LegacyFieldBatch={batchKey:'LEGACY:'+task.id,changeId:null,quoteId:null,termsVersionId:null,vehicleAssignmentId:task.vehicleAssignmentId??null,resolved:false};
 const h=task.currentHandoverId?one(f.handovers,task.currentHandoverId,'FIELD_BATCH_LEGACY_UNVERIFIED'):null;
 if(h)check(h.orderId===task.orderId&&h.customerId===f.order.customerId&&h.vehicleId===task.vehicleId&&h.type===task.type&&!h.changeId&&(!h.fieldTaskId||h.fieldTaskId===task.id),'FIELD_BATCH_LEGACY_UNVERIFIED');
 if(task.type==='DELIVERY')return!f.order.effectiveTermsVersionId&&!f.termsVersions.some(row=>row.orderId===f.order.id)?{...fallback,batchKey:'DELIVERY:INITIAL',resolved:true}:fallback;
 const linked=f.assignments.filter(a=>a.orderId===f.order.id&&h&&a.returnHandoverId===h.id),assignmentId=task.vehicleAssignmentId??h?.assignmentId??(linked.length===1?linked[0].id:null);
 if(!assignmentId){check(linked.length<=1,'FIELD_BATCH_ASSIGNMENT_INVALID');return fallback;}
 const a=deliveryProof(one(f.assignments,assignmentId,'FIELD_BATCH_ASSIGNMENT_INVALID'),f);check(a.vehicleId===task.vehicleId&&(!h||h.assignmentId===null||h.assignmentId===a.id)&&linked.every(row=>row.id===a.id),'FIELD_BATCH_ASSIGNMENT_INVALID');if(a.status==='CLOSED')returnProof(a,f);
 return{...fallback,batchKey:'FINAL_RETURN:'+a.id,vehicleAssignmentId:a.id,resolved:true};
}
export type FieldBatchOccupancy={canCreate:boolean;existingTaskId:string|null;existingTaskIds:string[];existingHandoverIds:string[];blockers:string[]};
/** Must run under the eventual command's Order lock before inserting the unique (orderId,batchKey). */
export function fieldBatchOccupancy(batch:FieldHandoverBatch,f:FieldBatchFacts):FieldBatchOccupancy{
 check(batch.orderId===f.order.id&&batch.customerId===f.order.customerId,'FIELD_BATCH_ORDER_INVALID');const taskIds=new Set<string>(),handoverIds=new Set<string>(),blockers=new Set<string>(),returns=isReturnFieldHandover(batch.type);
 const occupy=(task:FieldBatchTask,code='FIELD_BATCH_TASK_EXISTS')=>{taskIds.add(task.id);blockers.add(code);};
 for(const t of f.tasks.filter(t=>t.orderId===batch.orderId)){
  const associated=f.handovers.filter(h=>h.orderId===batch.orderId&&(h.fieldTaskId===t.id||h.id===t.currentHandoverId)),unpublished=t.status==='CANCELLED'&&!t.currentHandoverId&&!associated.length,superseded=t.status!=='COMPLETED'&&associated.length>0&&associated.every(h=>h.status==='SUPERSEDED');
  if(t.batchKey===batch.batchKey){occupy(t);if(t.type!==batch.type||(t.changeId??null)!==batch.changeId||(t.quoteId??null)!==batch.quoteId||(t.termsVersionId??null)!==batch.termsVersionId||t.vehicleId!==batch.vehicleId||(t.vehicleAssignmentId??null)!==batch.vehicleAssignmentId&&t.status!=='COMPLETED')blockers.add('FIELD_BATCH_SOURCE_CHANGED');continue;}
  const sameSide=returns?['RETURN','SWAP_RETURN'].includes(t.type):batch.type==='DELIVERY'&&t.type==='DELIVERY'||batch.type==='SWAP_DELIVERY'&&t.type==='SWAP_DELIVERY'&&t.changeId===batch.changeId;
  if(!sameSide)continue;
  if(t.batchKey&&!t.batchKey.startsWith('LEGACY:')){
   if(returns&&t.vehicleAssignmentId===batch.vehicleAssignmentId)occupy(t);
   else if(batch.type==='DELIVERY'&&!unpublished&&!superseded)occupy(t,'FIELD_BATCH_LEGACY_REVIEW_REQUIRED');
   continue;
  }
  let old:LegacyFieldBatch;try{old=legacyFieldTaskBatch(t,f);}catch(error){if(!(error instanceof HttpException)||(error.getResponse() as any)?.error?.code?.startsWith('FIELD_BATCH_')!==true)throw error;occupy(t,'FIELD_BATCH_LEGACY_REVIEW_REQUIRED');continue;}
  if(old.resolved&&(old.batchKey===batch.batchKey||returns&&old.vehicleAssignmentId===batch.vehicleAssignmentId)){occupy(t);continue;}
  if(returns&&old.resolved&&old.vehicleAssignmentId!==batch.vehicleAssignmentId)continue;
  if(!unpublished&&!superseded)occupy(t,'FIELD_BATCH_LEGACY_REVIEW_REQUIRED');
 }
 for(const h of f.handovers.filter(h=>h.orderId===batch.orderId&&h.status!=='SUPERSEDED')){
  let matches=batch.type==='DELIVERY'?h.type==='DELIVERY':batch.type==='SWAP_DELIVERY'?h.type==='SWAP_DELIVERY'&&h.changeId===batch.changeId:false;
  if(returns&&['RETURN','SWAP_RETURN'].includes(h.type)){
   const linked=f.assignments.filter(a=>a.orderId===batch.orderId&&a.returnHandoverId===h.id),assignmentId=h.assignmentId??(linked.length===1?linked[0].id:null);
   if(assignmentId===batch.vehicleAssignmentId)matches=true;else if(!assignmentId&&(h.type==='RETURN'||h.changeId===batch.changeId)){matches=true;blockers.add('FIELD_BATCH_LEGACY_REVIEW_REQUIRED');}
  }
  if(matches){handoverIds.add(h.id);blockers.add('FIELD_BATCH_HANDOVER_EXISTS');if(h.customerId!==batch.customerId||h.vehicleId!==batch.vehicleId)blockers.add('FIELD_BATCH_SOURCE_CHANGED');}
 }
 const existingTaskIds=[...taskIds].sort();return{canCreate:blockers.size===0,existingTaskId:existingTaskIds.length===1?existingTaskIds[0]:null,existingTaskIds,existingHandoverIds:[...handoverIds].sort(),blockers:[...blockers]};
}
