import { mutationPayload } from './form.ts';
import type { Entity } from './core.ts';
import type { ProcessView, ProcessAction } from './process-guide-model';

export const orderStepKeys = ['APPLICATION','CONTRACT','PAYMENT','DELIVERY','IN_USE','RETURN','SETTLEMENT'] as const;
export type OrderProcess = ProcessView & { orderId: string; orderRevision: number; related: Record<string, Entity[]> };
const states = new Set(['DONE','CURRENT','BLOCKED','WAITING','NOT_APPLICABLE','UNKNOWN']);
export function sectionForStep(key: string): string { return ({APPLICATION:'plan',CONTRACT:'contracts',PAYMENT:'funds',DELIVERY:'handover',IN_USE:'services',RETURN:'handover',SETTLEMENT:'settlement'} as Record<string,string>)[key] || 'overview'; }
export function sectionForAction(action: ProcessAction): string | undefined {
 const resource=action.target?.resource;
 return action.key==='OPEN_CANCELLATION'?'cancellation':action.key==='RECHECK_DELIVERY'?'handover':resource==='offline-archives'?'contracts':['bills','payments','refunds'].includes(resource||'')?'funds':['handovers','handover-tasks'].includes(resource||'')?'handover':resource==='return-settlements'?'settlement':resource==='usage-periods'?'services':undefined;
}
export function scopedRecord(value: unknown, orderId: string): Entity | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Entity;
  return typeof row.id === 'string' && row.id.length > 0 && row.orderId === orderId ? row : null;
}
export function readOrderProcess(value: unknown, orderId: string, revision: unknown): OrderProcess | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as OrderProcess;
  if (p.version !== 1 || p.orderId !== orderId || p.orderRevision !== revision || !Number.isSafeInteger(p.orderRevision) || !orderStepKeys.includes(p.currentStep as typeof orderStepKeys[number]) || !Array.isArray(p.steps) || p.steps.length !== orderStepKeys.length) return null;
  if (orderStepKeys.some(key => p.steps.filter(step=>step.key===key).length!==1) || p.steps.some(step=>!states.has(step.state)||!Array.isArray(step.checks)||!Array.isArray(step.actions))) return null;
  if (!Array.isArray(p.blockers) || !Array.isArray(p.attention) || !p.related || typeof p.related!=='object') return null;
  for (const key of ['archives','bills','tasks','handovers','settlements']) if (!Array.isArray(p.related[key]) || p.related[key].some(row=>!scopedRecord(row,orderId))) return null;
  return p;
}
const actionResources: Record<string,string[]> = {
  OPEN_ELECTRONIC:['orders'],OPEN_ORDER:['orders'],OPEN_BUSINESS_RECORD:['customers','partners','vehicles','insurance-policies','products','orders'],
  OPEN_APPLICATION:['applications'], CREATE_ARCHIVE:['offline-archives'], OPEN_ARCHIVE:['offline-archives'],
  OPEN_BILL:['bills'], OPEN_PAYMENT:['payments'], REQUEST_REFUND:['payments'], REVIEW_REFUND:['refunds'], SYNC_REFUND:['refunds'],
  CREATE_DELIVERY_TASK:['handover-tasks'],CREATE_RETURN_TASK:['handover-tasks'],OPEN_TASK:['handover-tasks'],OPEN_HANDOVER:['handovers'],
  PUBLISH_HANDOVER:['handovers'],COMPLETE_HANDOVER:['handovers'],RECHECK_DELIVERY:['orders'],
  OPEN_USAGE:['usage-periods'],OPEN_SETTLEMENT:['return-settlements'],COMPLETE_SETTLEMENT:['return-settlements'],OPEN_CANCELLATION:['orders'],
};
export function relatedRecords(p: OrderProcess, resource: string): Entity[] {
  if (resource==='payments') return p.related.bills.flatMap(bill=>Array.isArray(bill.payments)?bill.payments:[]).filter(row=>scopedRecord(row,p.orderId));
  if (resource==='refunds') return relatedRecords(p,'payments').flatMap(payment=>Array.isArray(payment.refunds)?payment.refunds:[]).filter(row=>scopedRecord(row,p.orderId));
  return p.related[({'offline-archives':'archives','bills':'bills','handover-tasks':'tasks','handovers':'handovers','return-settlements':'settlements'} as Record<string,string>)[resource]] || [];
}
export function scopedAction(action: ProcessAction, p: OrderProcess): ProcessAction | null {
  const target=action.target;
  if (!actionResources[action.key] || !target || target.orderId!==p.orderId || !actionResources[action.key].includes(target.resource||'') || !['OPEN_DETAIL','OPEN_FORM','REFRESH'].includes(action.kind)) return null;
  if (['RECHECK_DELIVERY','OPEN_CANCELLATION','OPEN_ORDER','OPEN_ELECTRONIC'].includes(action.key) && target.id!==p.orderId) return null;
  if (action.key==='CREATE_ARCHIVE') return ['RENTAL','TERMINATION'].includes(target.section||'')&&!target.id || ['DELIVERY_RECEIPT','RETURN_RECEIPT'].includes(target.section||'')&&p.related.handovers.some(row=>row.id===target.id) ? action : null;
  if (['CREATE_DELIVERY_TASK','CREATE_RETURN_TASK'].includes(action.key)) return !target.id || target.id===p.orderId ? action : null;
  if (['OPEN_APPLICATION','OPEN_USAGE','OPEN_BUSINESS_RECORD'].includes(action.key)) return action;
  if (target.resource!=='orders'&&!relatedRecords(p,target.resource||'').some(row=>row.id===target.id)) return null;
  return action;
}
export function processActions(p:OrderProcess):ProcessAction[]{const all=[...p.steps.flatMap(s=>[...s.actions,...s.checks.flatMap(c=>c.action?[c.action]:[])]),...p.blockers.flatMap(c=>c.action?[c.action]:[]),...p.attention.flatMap(c=>c.action?[c.action]:[]),...(p.primaryAction?[p.primaryAction]:[])];return all.filter((a,i)=>all.findIndex(b=>b.key===a.key&&b.target?.id===a.target?.id&&b.target?.section===a.target?.section)===i);}
export function businessRecordHref(resource:string,id?:string,section='profile'):string|null {
  if(!['applications','customers','partners','vehicles','insurance-policies','products','orders'].includes(resource))return null;
  const route=resource==='insurance-policies'?'insurance':resource;
  return '#'+route+(id?'?'+new URLSearchParams({record:id,view:section}).toString():'');
}
export function refundableReceipt(row:Entity|undefined):boolean {
  if(!row||row.status!=='SUCCEEDED'||typeof row.amount!=='number'||!Number.isSafeInteger(row.amount)||!Array.isArray(row.refunds))return false;
  let reserved=0;
  for(const refund of row.refunds){if(!refund||typeof refund!=='object'||!['PENDING_APPROVAL','PROCESSING','SUCCEEDED','FAILED','REJECTED'].includes(refund.status)||!Number.isSafeInteger(refund.amount)||refund.amount<0)return false;if(['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(refund.status))reserved+=refund.amount;}
  return Number.isSafeInteger(reserved)&&row.amount>reserved;
}
export function actionPayload(resource: string, body: Record<string,unknown>, record: Entity, idempotencyKey: string): Record<string,unknown> {
  const value = {...body};
  if ('orderId' in value) value.orderId=record.orderId;
  if (resource==='handover-tasks') { if (!Number.isSafeInteger(record.version)) throw new Error('当前任务版本未读取，请刷新'); value.version=record.version; }
  if (resource==='handovers') { if (!Number.isSafeInteger(record.revision)) throw new Error('当前交接版本未读取，请刷新'); value.revision=record.revision;value.idempotencyKey=idempotencyKey; }
  if (['usage-periods','return-settlements'].includes(resource)) { if (!Number.isSafeInteger(record.revision)) throw new Error('当前台账版本未读取，请刷新');value.revision=record.revision; }
  return mutationPayload(resource,'action',value,idempotencyKey);
}
