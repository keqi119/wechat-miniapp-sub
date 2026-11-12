import {ensure} from '../common/errors';
import {stageDay} from '../order-service-stages/source';
import {readRenewalCancellationFacts} from './cancellation-facts';
import {readCompletedRenewalCancellationSource} from './cancellation-history';
import {readRenewalBillSource} from './payment';

export type RenewalCancellationSummary={id:string;status:'OPEN'|'COMPLETED';completedAt:string|null;lifecycleState?:string|null;serviceEffect?:string;financialStatus?:string};
function valid(value:unknown):asserts value{ensure(value,409,'RENEWAL_CANCELLATION_SOURCE','续期取消来源不一致，请核对记录');}

/** Call only after the caller's current authority and order/customer ownership checks. */
export async function readRenewalCancellationSummary(tx:any,change:any,order:any,now=new Date()):Promise<RenewalCancellationSummary|null>{
 valid(change?.kind==='SUBSCRIPTION_EXTENSION'&&order?.id===change.orderId&&order.customerId===change.customerId);
 const record=await tx.orderRenewalCancellation.findFirst({where:{OR:[{changeId:change.id},...(change.activeQuoteId?[{quoteId:change.activeQuoteId}]:[])]}});
 if(!record)return null;
 valid(record.changeId===change.id&&record.quoteId===change.activeQuoteId&&record.orderId===order.id&&record.customerId===order.customerId);
 if(record.sourceSnapshot?.version===31){
  const {readV31CancellationSource,v31CancellationView}=await import('./cancellation-v31'),source=await readV31CancellationSource(tx,change.id),view=await v31CancellationView(tx,source);
  if(view.state==='REJECTED')return null;
  return{id:record.id,status:'OPEN',completedAt:null,...{lifecycleState:view.state,serviceEffect:view.correctedAt?'NEVER_EFFECTIVE':'DISPUTED',financialStatus:view.financialStatus,agreedAt:view.agreedAt,verifiedAt:view.verifiedAt,correctedAt:view.correctedAt,dependencyCount:view.dependencies.length,refundAmount:view.refundSources.reduce((n:number,p:any)=>n+p.amount,0)}};
 }
 if(record.status==='OPEN'){
  const facts=await readRenewalCancellationFacts(tx,{changeId:change.id,timingPurpose:'PREVIEW'},now);
  valid(facts.order.id===order.id&&facts.quote.id===record.quoteId&&facts.stage?.id===(record.serviceStageId??undefined));
  return{id:record.id,status:'OPEN',completedAt:null};
 }
 valid(record.status==='COMPLETED');
 const source=await readCompletedRenewalCancellationSource(tx,change.id);
 valid(source.record.id===record.id&&source.order.id===order.id&&source.quote.id===record.quoteId);
 return{id:record.id,status:'COMPLETED',completedAt:new Date(source.record.completedAt).toISOString()};
}

/** A completed future bill is historical evidence, never a new payment authority. */
export async function readRenewalBillCancellation(tx:any,bill:any,now=new Date()){
 const none={cancellation:null as RenewalCancellationSummary|null,canPay:bill.status==='PENDING',voidReadable:false};
 if(bill.serviceStageId==null)return none;
 const stage=await tx.orderServiceStage.findUnique({where:{id:bill.serviceStageId}});
 valid(stage&&stage.orderId===bill.orderId&&stage.customerId===bill.customerId);
 if(stage.kind==='INITIAL')return none;
 valid(stage.kind==='RENEWAL'&&stage.changeId);
 const [change,order]=await Promise.all([tx.orderChange.findUnique({where:{id:stage.changeId}}),tx.order.findUnique({where:{id:bill.orderId}})]);
 const cancellation=await readRenewalCancellationSummary(tx,change,order,now);
 if(!cancellation)return none;
 if(cancellation.lifecycleState){
  const source=await(await import('./cancellation-v31')).readV31CancellationSource(tx,change.id),row=source.stage?.snapshot.billingSchedule.find((r:any)=>r.sequence===bill.sequence);
  valid(source.stage?.id===stage.id&&row&&row.amount===bill.amount&&row.dueDate===stageDay(bill.dueDate)&&bill.idempotencyKey===`renewal:${source.quote.id}:${row.sequence}`);
  return{cancellation,canPay:false,voidReadable:source.stage.status==='VOIDED'&&source.history.some((f:any)=>f.kind==='CORRECTED')};
 }
 if(cancellation.status==='COMPLETED'){
  const source=await readRenewalBillSource(tx,bill);
  valid(source?.source.stage.id===stage.id&&stage.status==='VOIDED');
  return{cancellation,canPay:false,voidReadable:true};
 }
 const facts=await readRenewalCancellationFacts(tx,{changeId:change.id,timingPurpose:'PREVIEW'},now),row=facts.funding.bills.find(b=>b.id===bill.id);
 valid(row&&row.orderId===bill.orderId&&row.customerId===bill.customerId&&row.serviceStageId===stage.id&&row.sequence===bill.sequence&&row.amount===bill.amount&&row.dueDate===stageDay(bill.dueDate)&&row.idempotencyKey===bill.idempotencyKey);
 return{cancellation,canPay:false,voidReadable:false};
}

export const customerBillVisibility=(customerId:string)=>({customerId,OR:[{status:{notIn:['DRAFT','REVIEWED','VOID']}},{status:'VOID',serviceStage:{renewalCancellations:{some:{customerId,OR:[{status:'COMPLETED'},{lifecycleState:{in:['CORRECTED','FINANCE_CLOSED']}}]}}}}]});
