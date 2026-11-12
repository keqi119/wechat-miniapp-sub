import {terminationReadiness} from './termination';
import {readElectronicSubscriptionReady} from '../electronic-documents/subscription';
import {allowed} from '../auth/role-policy';
import {readContractReady,orderBusinessHash,readinessFromArchive} from '../offline-documents/readiness';
import {terminationReady} from '../offline-documents/cancellation';
import {readDeliveryFunding} from './readiness';
import {readDeliveryBusinessReady} from './business-gates';
import {readReturnView} from '../usage/returns';
import {receiptState,billFundsReady} from '../billing/receipt-state';
import {archiveSummary} from '../offline-documents/projection';
import {HttpException} from '@nestjs/common';
import {readHandoverCompletion} from './order-process-handover';
import {withBillPublication} from '../billing/publication-view';

/** No writes, row locks, provider calls, or cross-order list scans. */
export async function loadOrderProcessFacts(tx:any,order:any,actor:any,now=new Date()){
 const id=order.id;
 const [application,archives,bills,tasks,handovers,receipts,settlements,changes,usage,vehicle,terms,cancellation]=await Promise.all([
  tx.application.findUnique({where:{id:order.applicationId},select:{id:true,status:true}}),
  tx.documentArchive.findMany({where:{orderId:id},include:{versions:{orderBy:{version:'desc'},include:{feedback:{where:{status:'OPEN'}},files:{select:{uploadedBy:true}}}}}}),
  tx.bill.findMany({where:{orderId:id},include:{payments:{include:{refunds:true}}},orderBy:[{sequence:'asc'},{id:'asc'}]}),
  tx.fieldHandoverTask.findMany({where:{orderId:id},include:{assignee:{select:{id:true,name:true}}},orderBy:{updatedAt:'desc'}}),
  tx.handover.findMany({where:{orderId:id},orderBy:{createdAt:'desc'}}),
  tx.vehicleReceiptEvent.findMany({where:{orderId:id,isCurrent:true},select:{id:true,receivedAt:true,readingKm:true,handoverId:true}}),
  tx.returnSettlement.findMany({where:{orderId:id}}),
  tx.orderChange.findMany({where:{orderId:id,status:{notIn:['APPLIED','CANCELLED','REJECTED']}},select:{id:true,status:true,kind:true}}),
  tx.usageAccount.findUnique({where:{orderId:id},select:{id:true,startedOn:true,returnedOn:true}}),
  tx.vehicle.findUnique({where:{id:order.vehicleId},select:{id:true,status:true,reservedOrderId:true,mileageKm:true}}),
  order.effectiveTermsVersionId?tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}}):null,
  tx.offlineCancellationReview.findFirst({where:{orderId:id,isCurrent:true},select:{id:true,status:true,paperStatus:true,revision:true,submittedBy:true}})
 ]);
 const hash=orderBusinessHash(order),snapshot=terms?.snapshot||order.finalPlanSnapshot||{};
 const contract=order.contractMode==='ELECTRONIC'?await readElectronicSubscriptionReady(tx,id):await readContractReady(tx,id,'DELIVERY');
 const funding=await readDeliveryFunding(tx,order);
 let business:any={ready:false,blockers:[]};
 if(!['CANCELLED','COMPLETED'].includes(order.status)){
  try{const actual=order.contractMode==='ELECTRONIC'?handovers.find((h:any)=>h.type==='DELIVERY'&&!['SUPERSEDED','COMPLETED'].includes(h.status))?.actualAt:null;business=await readDeliveryBusinessReady(tx,id,actual??now);}catch(e){
   if(!(e instanceof HttpException)||![400,403,404,409].includes(e.getStatus()))throw e;
   const error=(e.getResponse() as any).error||{};business={ready:false,blockers:[{code:error.code||'DELIVERY_CHECK_REQUIRED',label:error.message||'交付资料待核对',resourceType:'orders',resourceId:id}]};
  }
 }
 business={...business,blockers:await Promise.all(business.blockers.map((b:any)=>businessBlockerNavigation(tx,b)))};
 const settlementViews=await Promise.all(settlements.map((s:any)=>readReturnView(tx,s,true)));
 const termination=order.contractMode==='ELECTRONIC'?await terminationReadiness(tx,order):await terminationReady(tx,order);
 const fundsVisible=allowed(actor.role,'bills',false),archivesVisible=['ADMIN','OPERATIONS'].includes(actor.role);
 const publishedViews=fundsVisible?(order.bills?.every((b:any)=>b.publication)?order.bills:await withBillPublication(tx,bills,now)):[];
 const publicationById=new Map(publishedViews.map((b:any)=>[b.id,b.publication]));
 const billRows=fundsVisible?bills.map((b:any)=>{
  const payments=b.payments.map((p:any)=>{const cash=receiptState(p);return{id:p.id,billId:b.id,orderId:id,status:p.status,amount:p.amount,reconciliationRequired:p.reconciliationRequired,netReceivedAmount:p.status==='SUCCEEDED'&&cash.valid?cash.retained:0,refundedAmount:cash.returned,succeededAt:p.succeededAt,refunds:p.refunds.map((r:any)=>({id:r.id,paymentId:p.id,orderId:id,status:r.status,amount:r.amount,requestedBy:r.requestedBy,approvedBy:r.approvedBy,succeededAt:r.succeededAt}))};});
  return{id:b.id,orderId:id,type:b.type,sequence:b.sequence,status:b.status,amount:b.amount,paidAmount:b.paidAmount,description:b.description,dueDate:b.dueDate,publication:publicationById.get(b.id),receivedAmount:payments.filter((p:any)=>p.status==='SUCCEEDED').reduce((n:number,p:any)=>n+p.amount,0),netReceivedAmount:payments.reduce((n:number,p:any)=>n+p.netReceivedAmount,0),refundedAmount:payments.reduce((n:number,p:any)=>n+p.refundedAmount,0),fundsReady:billFundsReady(b),payments};
 }):[];
 const archiveRows=archivesVisible?archives.map((a:any)=>({...archiveSummary({...a,customerId:order.customerId},a.handoverId?handovers.find((h:any)=>h.id===a.handoverId)?.manifestHash||'':hash,actor),orderId:id,handoverId:a.handoverId})):[];
 const taskRows=allowed(actor.role,'handover-tasks',false)?tasks.map((t:any)=>({id:t.id,orderId:id,type:t.type,status:t.status,version:t.version,assigneeId:t.assigneeId,assigneeName:t.assignee?.name||'',handoverId:t.currentHandoverId})):[];
 const handoverRows=allowed(actor.role,'handovers',false)?handovers.map((h:any)=>({id:h.id,orderId:id,type:h.type,status:h.status,revision:h.revision,actualAt:h.actualAt,completedAt:h.completedAt,customerResponse:h.customerResponse,archiveId:archives.find((a:any)=>a.handoverId===h.id)?.id||null})):[];
 const settlementRows=allowed(actor.role,'return-settlements',false)?settlementViews.map((s:any)=>({id:s.id,orderId:id,status:s.status,revision:s.revision,returnedOn:s.returnedOn,canComplete:s.canComplete&&allowed(actor.role,'return-settlements',true),unsettledPeriodIds:s.unsettledPeriodIds,documentBlockers:s.documentBlockers,financialBlockers:s.financialBlockers,financialSource:s.financialSource,financialAction:s.financialAction,depositRefundRequiredAmount:s.depositRefundRequiredAmount})):[];
 const facts={order,actor,now,hash,snapshot,application,archives,bills,tasks,handovers,receipts,changes,usage,vehicle,cancellation,settlements:settlementViews,termination,contract,funding,business,fundsVisible,archivesVisible,related:{archives:archiveRows,bills:billRows,tasks:taskRows,handovers:handoverRows,settlements:settlementRows}};
 const handoverReadiness=Object.fromEntries(await Promise.all(handovers.filter((h:any)=>['DELIVERY','RETURN'].includes(h.type)&&!['SUPERSEDED','COMPLETED'].includes(h.status)).map(async(h:any)=>[h.id,await readHandoverCompletion(tx,facts,h)])));
 return{...facts,handoverReadiness};
}

/** Gate evidence may identify a version or vehicle; navigation must identify an existing resource. */
export async function businessBlockerNavigation(tx:any,blocker:any){
 if(blocker.resourceType==='coverage-requirements')return{...blocker,resourceId:undefined};
 const sources:Record<string,[string,string,string]>={'insurance-policies':['insurancePolicy','insurancePolicyVersion','policyId'],products:['product','productVersion','productId']};
 const lookup=sources[blocker.resourceType];if(!lookup)return blocker;
 if(typeof blocker.resourceId!=='string'||!blocker.resourceId)return{...blocker,resourceId:undefined};
 const [parentModel,versionModel,parentField]=lookup,parent=await tx[parentModel]?.findUnique?.({where:{id:blocker.resourceId},select:{id:true}});
 const version=!parent?await tx[versionModel]?.findUnique?.({where:{id:blocker.resourceId},select:{[parentField]:true}}):null;
 return{...blocker,resourceId:parent?.id||version?.[parentField]};
}

export function currentHandoverArchive(f:any,h:any){const a=f.archives.find((a:any)=>a.handoverId===h?.id&&a.kind===(h?.type==='RETURN'?'RETURN_RECEIPT':'DELIVERY_RECEIPT'));return{archive:a,ready:!!h&&readinessFromArchive(a,h.manifestHash).ready};}
export function archiveReviewAvailable(archive:any,actor:any){
 const v=archive?.versions?.find((v:any)=>v.status==='SUBMITTED');
 return !!v&&['ADMIN','OPERATIONS'].includes(actor.role)&&(actor.role==='ADMIN'||v.submittedBy!==actor.id&&!v.files?.some((f:any)=>f.uploadedBy===actor.id));
}
