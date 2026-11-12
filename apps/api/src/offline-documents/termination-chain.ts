import {readEffectiveContractChain} from '../order-changes/agreement-readiness';
import type {TerminationContext} from './termination';

type Facts={rental:any;handovers:any[];receipt:any;payments:any[]};
const time=(v:any)=>v?new Date(v).getTime():NaN;
const sameTime=(a:any,b:any)=>Number.isFinite(time(a))&&time(a)===time(b);
const iso=(v:any)=>new Date(v).toISOString();
const text=(v:any)=>typeof v==='string'?v:'';
const frozenVehicle=(s:any)=>s&&(!s.vehicleId||!s.lessorSnapshot?.vehicleId||s.vehicleId===s.lessorSnapshot.vehicleId)?s.vehicleId||s.lessorSnapshot?.vehicleId:null;

function actualDelivery(order:any,terms:any[],assignments:any[],handovers:any[],receipt:any):TerminationContext['delivery']{
 const unknown:TerminationContext['delivery']={state:'UNKNOWN'};
 if(!assignments.length)return !receipt&&!handovers.some(h=>h.actualAt||h.status==='COMPLETED')&&['AWAITING_SIGNATURE','AWAITING_CONTRACT_REVIEW','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status)?{state:'NOT_DELIVERED'}:unknown;
 const known=new Set<string>();
 const bound=(h:any,a:any)=>h&&h.orderId===order.id&&h.customerId===order.customerId&&h.vehicleId===a.vehicleId&&h.assignmentId===a.id;
 const complete=(h:any,a:any)=>bound(h,a)&&h.status==='COMPLETED'&&Number.isFinite(time(h.actualAt))&&Number.isFinite(time(h.completedAt));
 for(let i=0;i<assignments.length;i++){
  const a=assignments[i],delivery=handovers.find(h=>h.id===a.deliveryHandoverId),returned=handovers.find(h=>h.id===a.returnHandoverId);
  if(a.orderId!==order.id||a.customerId!==order.customerId||!complete(delivery,a)||!sameTime(delivery.actualAt,a.startAt))return unknown;
  if(i===0){if(delivery.type!=='DELIVERY'||a.changeId||delivery.changeId||a.vehicleId!==frozenVehicle(order.finalPlanSnapshot))return unknown;}
  else{
   const prior=assignments[i-1],t=terms.find(t=>t.quote?.change?.id===a.changeId),c=t?.quote?.change,q=t?.quote;
   const priorReturn=handovers.find(h=>h.id===prior.returnHandoverId);
   if(!c||c.kind!=='VEHICLE_CHANGE'||c.status!=='APPLIED'||c.activeQuoteId!==q.id||c.targetVehicleId!==a.vehicleId||a.vehicleId!==frozenVehicle(t.snapshot)||prior.vehicleId!==frozenVehicle(c.priorTerms)||c.deliveryHandoverId!==delivery.id||c.returnHandoverId!==priorReturn?.id||q.snapshot?.originalAssignmentId!==prior.id||delivery.type!=='SWAP_DELIVERY'||delivery.changeId!==c.id||priorReturn?.type!=='SWAP_RETURN'||priorReturn.changeId!==c.id||time(prior.endAt)>time(a.startAt))return unknown;
  }
  known.add(delivery.id);
  if(a.status==='CLOSED'){
   if(!complete(returned,a)||!['RETURN','SWAP_RETURN'].includes(returned.type)||!sameTime(a.endAt,returned.actualAt)||time(a.endAt)<time(a.startAt))return unknown;
   known.add(returned.id);
  }else if(a.status!=='ACTIVE'||a.endAt||a.returnHandoverId||i!==assignments.length-1)return unknown;
 }
 const current=assignments.at(-1),delivered=handovers.find(h=>h.id===current.deliveryHandoverId),returned=handovers.find(h=>h.id===current.returnHandoverId);
 if(current.vehicleId!==order.vehicleId)return unknown;
 if(order.currentAssignmentId){if(order.currentAssignmentId!==current.id||current.status!=='ACTIVE')return unknown;}
 else if(!['SETTLING','COMPLETED'].includes(order.status)||current.status!=='CLOSED'||returned?.type!=='RETURN')return unknown;
 if(handovers.some(h=>h.status==='COMPLETED'&&!known.has(h.id)))return unknown;
 const result:TerminationContext['delivery']={state:'AWAITING_RETURN',deliveryId:delivered.id,deliveredAt:iso(delivered.actualAt)};
 if(receipt){
  const receiptHandover=handovers.find(h=>h.id===receipt.handoverId);
  if(receipt.orderId!==order.id||receipt.vehicleId!==current.vehicleId||receipt.assignmentId!==current.id||!bound(receiptHandover,current)||receiptHandover.type!=='RETURN'||!['PUBLISHED','CUSTOMER_CONFIRMED','COMPLETED'].includes(receiptHandover.status)||!Number.isFinite(time(receipt.receivedAt))||time(receipt.receivedAt)<time(current.startAt)||returned&&receipt.handoverId!==returned.id)return unknown;
  return{...result,state:'RETURNED',returnId:receipt.id,returnedAt:iso(receipt.receivedAt),returnPlace:receipt.storageLocation||undefined,readingKm:receipt.readingKm,source:'PHYSICAL_RECEIPT'};
 }
 if(returned?.type==='RETURN')return{...result,state:'RETURNED',returnId:returned.id,returnedAt:iso(returned.actualAt),readingKm:returned.readingKm,source:'RETURN_HANDOVER'};
 return result;
}

/** Changed orders use the complete archived chain and actual assignment history. Never infer a swap from the current vehicle alone. */
export async function readChangedTerminationContext(tx:any,order:any,facts:Facts):Promise<TerminationContext>{
 const result:TerminationContext={originalContract:null,amendments:[],effectiveTermsVersionId:order.effectiveTermsVersionId,vehicle:null,relevantTerms:{earlyTerminationRule:'',depositRefundRule:''},delivery:{state:'UNKNOWN'},funds:{receivedAmount:0,refundedAmount:0,netReceivedAmount:0,depositReceivedAmount:0,depositRefundedAmount:0},blockers:[]};
 result.relevantTerms={earlyTerminationRule:text(order.finalPlanSnapshot?.commercialTerms?.earlyTerminationRule),depositRefundRule:text(order.finalPlanSnapshot?.commercialTerms?.depositRefundRule)};
 const block=(code:string,message:string)=>result.blockers.push({code,message});
 for(const p of facts.payments){if(p.status!=='SUCCEEDED')continue;const refunded=p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0);result.funds.receivedAmount+=p.amount;result.funds.refundedAmount+=refunded;if(p.bill.type==='DEPOSIT'){result.funds.depositReceivedAmount+=p.amount;result.funds.depositRefundedAmount+=refunded;}}
 result.funds.netReceivedAmount=result.funds.receivedAmount-result.funds.refundedAmount;
 const chain=await readEffectiveContractChain(tx,order.id);
 if(!chain.ready||chain.termsVersionId!==order.effectiveTermsVersionId){block('TERMINATION_AMENDMENT_REVIEW_REQUIRED','本单有效补充协议链或纸质归档尚未完整，请核对原档案');return result;}
 const terms=await tx.orderTermsVersion.findMany({where:{orderId:order.id},orderBy:{version:'asc'},include:{quote:{include:{change:true,contract:true}}}}),latest=terms.at(-1);
 if(latest?.id!==chain.termsVersionId||latest.orderId!==order.id||latest.hash!==chain.termsHash){block('TERMINATION_AMENDMENT_REVIEW_REQUIRED','当前条款来源已变化，请重新读取');return result;}
 const reference=async(archive:any,versionId:string,kind:string)=>{
  const version=archive?.versions?.find((v:any)=>v.id===versionId),template=version?await tx.legalDocument.findUnique({where:{id:version.templateId},select:{title:true,type:true}}):null;
  if(!version||archive.orderId!==order.id||archive.kind!==kind||template?.type!=='OFFLINE_'+kind||!template.title||!version.contractNumber||!version.signedOn)return null;
  return{archiveId:archive.id,versionId:version.id,version:version.version,name:template.title,number:version.contractNumber,signedOn:version.signedOn,businessSnapshotHash:version.businessSnapshotHash};
 };
 const rental=facts.rental?.id===chain.original?.archiveId?facts.rental:await tx.documentArchive.findUnique({where:{id:chain.original!.archiveId},include:{versions:true}});
 result.originalContract=await reference(rental,chain.original!.archiveVersionId,'RENTAL');
 if(!result.originalContract)block('TERMINATION_ORIGINAL_REQUIRED','原已签租赁合同引用资料不完整');
 for(const t of terms){const a=await tx.documentArchive.findUnique({where:{id:t.quote?.contract?.offlineArchiveId},include:{versions:true}}),ref=await reference(a,t.offlineArchiveVersionId,'ORDER_AMENDMENT');if(!ref){block('TERMINATION_AMENDMENT_REVIEW_REQUIRED','已生效补充协议引用资料不完整');return result;}result.amendments!.push({...ref,termsVersionId:t.id,quoteId:t.quoteId});}
 if(!result.relevantTerms.earlyTerminationRule||!result.relevantTerms.depositRefundRule)block('TERMINATION_ORIGINAL_TERMS_REQUIRED','原冻结提前终止或押金条款缺失，请核对原合同');
 const s=latest.snapshot,vehicleId=s.vehicleId||s.lessorSnapshot?.vehicleId,identification=text(s.commercialTerms?.vehicleIdentification),vin=identification.toUpperCase().match(/(?:VIN\s*[:：]\s*|\b)([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/)?.[1];
 if(!vin||vehicleId!==order.vehicleId||s.vehicleId&&s.lessorSnapshot?.vehicleId&&s.vehicleId!==s.lessorSnapshot.vehicleId)block('TERMINATION_VEHICLE_UNCONFIRMED','当前车辆须与已生效补充协议的冻结车辆及 VIN 一致');
 else result.vehicle={id:vehicleId,vin,identification};
 const assignments=await tx.vehicleAssignment.findMany({where:{orderId:order.id,customerId:order.customerId},orderBy:{startAt:'asc'}});
 // The applied contract chain resolves equal-time swaps without relying on database tie ordering.
 const position=(a:any)=>a.changeId?terms.findIndex((t:any)=>t.quote?.change?.id===a.changeId)+1:0;
 const ordered=[...assignments].sort((a:any,b:any)=>position(a)-position(b));
 result.delivery=actualDelivery(order,terms,ordered,facts.handovers,facts.receipt);
 if(result.delivery.state==='UNKNOWN')block('TERMINATION_DELIVERY_UNCONFIRMED','请核对本单完整实际分配及交还事实，换车归还不能替代最终收车');
 return result;
}
