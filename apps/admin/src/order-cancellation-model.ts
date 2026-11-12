import type {Entity} from './core.ts';
import type {ProcessAction,ProcessCheck,ProcessStep} from './process-guide-model';
import type {OrderProcess} from './order-process.ts';
import {scopedRecord} from './order-process.ts';
export type CancellationReadiness={version:1;orderId:string;orderRevision:number;orderStatus:string;observedAt:string;mode:'PRE_DELIVERY_CANCEL'|'POST_DELIVERY_RETURN'|'TERMINAL';canCancel:boolean;currentStep:string;steps:ProcessStep[];blockers:ProcessCheck[];attention:ProcessCheck[];actions:ProcessAction[];signing?:{paperStatus:'SIGNED'|'UNSIGNED'|'UNKNOWN';source:'ARCHIVE'|'CONFIRMATION'|'UNCONFIRMED'};related:{review:Entity|null;terminationArchive:Entity|null;bills:Entity[];payments:Entity[];refunds:Entity[];tasks:Entity[];changes:Entity[]};effects:string[]};
const stepKeys=['EVIDENCE','TERMINATION','FUNDS','CONFIRM','RESULT'];
const states=new Set(['DONE','CURRENT','BLOCKED','WAITING','NOT_APPLICABLE','UNKNOWN']);
export function readCancellationReadiness(value:unknown,orderId:string):CancellationReadiness|null{
 if(!value||typeof value!=='object')return null;const r=value as CancellationReadiness;
 if(r.version!==1||r.orderId!==orderId||!Number.isSafeInteger(r.orderRevision)||r.orderRevision<0||typeof r.orderStatus!=='string'||typeof r.observedAt!=='string'||!['PRE_DELIVERY_CANCEL','POST_DELIVERY_RETURN','TERMINAL'].includes(r.mode)||typeof r.canCancel!=='boolean')return null;
 if(!Array.isArray(r.steps)||!r.steps.length||!stepKeys.includes(r.currentStep)||!r.steps.some(s=>s.key===r.currentStep)||r.steps.some((s,i)=>!stepKeys.includes(s.key)||r.steps.findIndex(x=>x.key===s.key)!==i||!states.has(s.state)||!Array.isArray(s.checks)||!Array.isArray(s.actions)))return null;
 if(!Array.isArray(r.blockers)||!Array.isArray(r.attention)||!Array.isArray(r.actions)||!Array.isArray(r.effects)||r.effects.some(e=>typeof e!=='string')||!r.related||typeof r.related!=='object')return null;
 if(r.canCancel&&(r.mode!=='PRE_DELIVERY_CANCEL'||r.blockers.length||r.steps.some(s=>['UNKNOWN','BLOCKED'].includes(s.state))))return null;
 for(const key of ['bills','payments','refunds','tasks','changes'] as const)if(!Array.isArray(r.related[key])||r.related[key].some(row=>!scopedRecord(row,orderId)))return null;
 for(const key of ['review','terminationArchive'] as const)if(r.related[key]!==null&&(!scopedRecord(r.related[key],orderId)||!Number.isSafeInteger(r.related[key]!.revision)))return null;
 for(const bill of r.related.bills){if(!Array.isArray(bill.payments)||bill.payments.some((p:Entity)=>!scopedRecord(p,orderId)||p.billId!==bill.id||!Array.isArray(p.refunds)||p.refunds.some((refund:Entity)=>!scopedRecord(refund,orderId)||refund.paymentId!==p.id)))return null;}
 return r;
}
const resources:Record<string,string[]>={SUBMIT_CANCELLATION_REVIEW:['orders'],REVIEW_CANCELLATION_EVIDENCE:['orders'],CREATE_ARCHIVE:['offline-archives'],OPEN_ARCHIVE:['offline-archives'],OPEN_BILL:['bills'],OPEN_PAYMENT:['payments'],REQUEST_REFUND:['payments'],REVIEW_REFUND:['refunds'],SYNC_REFUND:['refunds'],OPEN_CHANGE:['order-changes'],OPEN_VEHICLE:['vehicles'],OPEN_CONTRACT:['contracts'],OPEN_HANDOVER:['handovers'],OPEN_TASK:['handover-tasks'],CANCEL_ORDER:['orders'],OPEN_RETURN:['orders'],OPEN_SETTLEMENT:['return-settlements']};
export function scopedCancellationAction(action:ProcessAction,r:CancellationReadiness,base?:OrderProcess|null):ProcessAction|null{
 const t=action?.target;if(!t||t.orderId!==r.orderId||!resources[action.key]?.includes(t.resource||'')||!['OPEN_DETAIL','OPEN_FORM','REFRESH'].includes(action.kind))return null;
 if(t.resource==='orders'&&t.id!==r.orderId)return null;
 if(action.key==='CANCEL_ORDER'&&action.expectedRevision!==r.orderRevision)return null;
 if(action.key==='SUBMIT_CANCELLATION_REVIEW'&&action.expectedRevision!==(r.related.review?.revision||0))return null;
 if(action.key==='REVIEW_CANCELLATION_EVIDENCE'&&(!r.related.review||action.expectedRevision!==r.related.review.revision))return null;
 if(action.key==='CREATE_ARCHIVE')return t.section==='TERMINATION'&&!t.id?action:null;
 if(action.key==='OPEN_ARCHIVE')return r.related.terminationArchive?.id===t.id||base?.orderId===r.orderId&&base.related.archives.some(row=>row.id===t.id)?action:null;
 const rows=t.resource==='bills'?r.related.bills:t.resource==='payments'?r.related.payments:t.resource==='refunds'?r.related.refunds:t.resource==='order-changes'?r.related.changes:t.resource==='handover-tasks'?r.related.tasks:undefined;
 if(rows&&!rows.some(row=>row.id===t.id))return null;
 if(!t.id)return null;return action;
}
export function cancellationContext(r:CancellationReadiness,base:OrderProcess):OrderProcess{
 return {...base,orderRevision:r.orderRevision,primaryAction:undefined,blockers:[],attention:[],steps:base.steps.map((s,i)=>({...s,checks:[],actions:i===0?r.actions.filter(a=>scopedCancellationAction(a,r,base)):[]})),related:{...base.related,archives:r.related.terminationArchive?[r.related.terminationArchive]:[],bills:r.related.bills,tasks:r.related.tasks}};
}
export function cancellationExternalRoute(action:ProcessAction,r:CancellationReadiness):string|null{
 if(action.target?.orderId!==r.orderId||!action.target.id)return null;
 if(action.key==='OPEN_CHANGE'){const change=r.related.changes.find(row=>row.id===action.target!.id);return change?.kind==='VEHICLE_CHANGE'?'vehicle-changes':change?.kind==='DELIVERY_DELAY'?'order-changes':null;}
 return ({OPEN_VEHICLE:'vehicles',OPEN_CONTRACT:'contracts',OPEN_SETTLEMENT:'return-settlements',OPEN_HANDOVER:'handovers',OPEN_TASK:'handover-tasks'} as Record<string,string>)[action.key]||null;
}

/** Completed steps can be read again; future steps cannot start from the client. */
export function cancellationStepAccessible(r:CancellationReadiness,key:string):boolean{
 const current=stepKeys.indexOf(r.currentStep),index=stepKeys.indexOf(key);
 return r.mode==='PRE_DELIVERY_CANCEL'&&index>=0&&index<=current&&r.steps.some(s=>s.key===key&&s.state!=='WAITING'&&s.state!=='UNKNOWN');
}
