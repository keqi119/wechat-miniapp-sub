import {cooperationBusinessHash} from './snapshot';
import {ensure} from '../common/errors';
import {readSimpleAgreementSnapshot,hasSimpleAgreementScope} from '../partners/simple-agreements';
import {readChangeAgreementReady,readEffectiveContractChain} from '../order-changes/agreement-readiness';
import {fieldReceiptKind} from '../field-handover/batches';
import {readElectronicSubscriptionReady} from '../electronic-documents/subscription';
export function feedbackHold(stage:string,open:boolean){const pre=!['ACTIVE','SETTLING','COMPLETED','CANCELLED'].includes(stage);return{payment:open&&pre,delivery:open&&pre,contractChange:open,settlement:open,closure:open};}
export function readinessFromArchive(archive:any,currentHash:string){const current=archive?.versions?.find((v:any)=>v.id===archive.currentApprovedVersionId);const ready=!!current&&current.status==='ARCHIVED'&&current.businessSnapshotHash===currentHash;return{ready,archiveId:archive?.id||null,versionId:ready?current.id:null,blockers:ready?[]:[current?'ARCHIVE_SNAPSHOT_MISMATCH':'OFFLINE_ARCHIVE_REQUIRED']};}
export async function lockOrder(tx:any,orderId:string){await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;}
export function orderBusinessHash(order:any){if(order.effectiveTermsVersionId){ensure(order.currentBusinessHash,409,'TERMS_MISSING','当前有效商业条款缺失');return order.currentBusinessHash;}return order.finalPlanSnapshot?.commercialHash||'';}
export async function cooperationFeedbackOpen(tx:any,ownerId:string,vehicleId:string,versionId?:string){return await tx.archiveFeedback.count({where:{status:'OPEN',version:{archive:{ownerId,kind:'OWNER_COOPERATION'},OR:[{scopeSnapshot:{path:['vehicleIds'],array_contains:[vehicleId]}},...(versionId?[{id:versionId}]:[])]}}})>0;}
export async function contractReady(tx:any,orderId:string,purpose:'PAYMENT'|'DELIVERY'|'CONTRACT_CHANGE'|'SETTLEMENT'|'CLOSURE'='PAYMENT'){
 await lockOrder(tx,orderId);
 return readContractReady(tx,orderId,purpose);
}
/** A prepared, not-yet-effective amendment is also a prerequisite for new money actions. */
async function activeAmendmentPaymentReady(tx:any,orderId:string){
 const change=await tx.orderChange.findFirst({where:{orderId,status:{notIn:['APPLIED','CANCELLED','REJECTED']}},select:{id:true,kind:true,activeQuoteId:true}});
 // Renewal authority is checked against each stage bill; it cannot suspend old-period receipts.
 if(change?.kind==='SUBSCRIPTION_EXTENSION')return{ready:true,blockers:[] as string[]};
 if(!change?.activeQuoteId)return{ready:true,blockers:[] as string[]};
 const quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},select:{id:true,changeId:true,financePreparedAt:true,approvedArchiveVersionId:true}});
 if(!quote||quote.changeId!==change.id)return{ready:false,blockers:['AGREEMENT_QUOTE_NOT_CONFIRMED']};
 // Draft/confirmation-stage swaps may independently pre-purchase a credit.
 if(!quote.financePreparedAt)return{ready:true,blockers:[] as string[]};
 if(typeof quote.approvedArchiveVersionId!=='string'||!quote.approvedArchiveVersionId.trim())return{ready:false,blockers:['AGREEMENT_ARCHIVE_PIN_REQUIRED']};
 const result=await readChangeAgreementReady(tx,change.id);
 if(!result.ready)return{ready:false,blockers:result.blockers};
 if(result.agreement?.mode!=='OFFLINE'||result.agreement.archiveVersionId!==quote.approvedArchiveVersionId)return{ready:false,blockers:['AGREEMENT_ARCHIVE_PIN_REQUIRED']};
 return{ready:true,blockers:[] as string[]};
}
/** Read-only projection; mutations must acquire the order lock before checking. */
export async function readContractReady(tx:any,orderId:string,purpose:'PAYMENT'|'DELIVERY'|'CONTRACT_CHANGE'|'SETTLEMENT'|'CLOSURE'='PAYMENT'){
 const order=await tx.order.findUnique({where:{id:orderId}});ensure(order,404,'NOT_FOUND','订单不存在');if(order.effectiveTermsVersionId){const terms=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});ensure(terms&&terms.orderId===order.id&&/^[a-f0-9]{64}$/.test(terms.hash),409,'TERMS_MISSING','当前有效商业条款缺失或归属不匹配');order.currentBusinessHash=terms.hash;}
 const archive=await tx.documentArchive.findFirst({where:{orderId,kind:'RENTAL'},include:{versions:{include:{feedback:true}}}});
 const chain=order.contractMode==='OFFLINE'&&order.effectiveTermsVersionId?await readEffectiveContractChain(tx,orderId):null;
 const result=order.contractMode==='ELECTRONIC'?await readElectronicSubscriptionReady(tx,orderId):chain?{ready:chain.ready,archiveId:chain.original?.archiveId??archive?.id??null,versionId:chain.ready?chain.original?.archiveVersionId??null:null,blockers:chain.blockers,amendmentVersionIds:chain.amendmentVersionIds}:readinessFromArchive(archive,orderBusinessHash(order));
 const active=order.contractMode==='OFFLINE'&&purpose==='PAYMENT'?await activeAmendmentPaymentReady(tx,orderId):{ready:true,blockers:[] as string[]};
 const feedback=await tx.archiveFeedback.count({where:{status:'OPEN',version:{archive:{orderId}}}});const lessor=order.finalPlanSnapshot?.lessorSnapshot;const cooperationOpen=lessor?.ownerId&&lessor.mode!=='SIMPLE_AGREEMENT'?await cooperationFeedbackOpen(tx,lessor.ownerId,order.vehicleId,lessor.cooperationVersionId):false;const holds=feedbackHold(order.status,feedback>0||cooperationOpen);const blocked=purpose==='PAYMENT'?holds.payment:purpose==='DELIVERY'?holds.delivery:purpose==='CONTRACT_CHANGE'?holds.contractChange:purpose==='SETTLEMENT'?holds.settlement:holds.closure;
 return{...result,ready:result.ready&&active.ready&&!blocked,blockers:[...new Set([...result.blockers,...active.blockers,...(blocked?['ARCHIVE_FEEDBACK_OPEN']:[])])],holds};
}
export async function requireContractReady(tx:any,orderId:string,purpose:Parameters<typeof contractReady>[2]='PAYMENT'){const result=await contractReady(tx,orderId,purpose);ensure(result.ready,409,result.blockers[0]||'OFFLINE_ARCHIVE_REQUIRED','当前合同签署及归档资料未就绪');return result;}
export async function handoverDocumentReady(tx:any,handoverId:string){let handover=await tx.handover.findUnique({where:{id:handoverId}});ensure(handover,404,'NOT_FOUND','交接不存在');await lockOrder(tx,handover.orderId);handover=await tx.handover.findUnique({where:{id:handoverId}});const archive=await tx.documentArchive.findFirst({where:{handoverId,kind:fieldReceiptKind(handover.type)},include:{versions:true}});return readinessFromArchive(archive,handover.manifestHash);}
export async function ownerCooperationReady(tx:any,ownerId:string,vehicleId:string,startsOn:string,endsOn:string){
 await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${ownerId} FOR UPDATE`;
 return readOwnerCooperationReady(tx,ownerId,vehicleId,startsOn,endsOn);
}
/** Read-only projection of the same cooperation gate; write callers keep their owner lock. */
export async function readOwnerCooperationReady(tx:any,ownerId:string,vehicleId:string,startsOn:string,endsOn:string){
 const simple=await readSimpleAgreementSnapshot(tx,vehicleId,{startDate:startsOn,endDate:endsOn});
 if(simple?.ownerId===ownerId)return{ready:true,archiveId:null,versionId:simple.agreementVersionId,blockers:[],mode:'SIMPLE_AGREEMENT'};
 if(simple||await hasSimpleAgreementScope(tx,vehicleId))return{ready:false,archiveId:null,versionId:null,blockers:['SIMPLE_AGREEMENT_REQUIRED'],mode:'SIMPLE_AGREEMENT'};
 const archive=await tx.documentArchive.findFirst({where:{ownerId,kind:'OWNER_COOPERATION'},include:{versions:true}}),owner=await tx.vehicleOwner.findUnique({where:{id:ownerId}});
 const current=archive?.versions.find((v:any)=>v.id===archive.currentApprovedVersionId),scope=current?.scopeSnapshot;
 const result=readinessFromArchive(archive,owner&&scope?cooperationBusinessHash(ownerId,owner.revision,scope):'');
 const covered=!!scope?.vehicleIds?.includes(vehicleId)&&scope.validFrom<=startsOn&&scope.validUntil>=endsOn;
 const feedbackOpen=archive?await cooperationFeedbackOpen(tx,ownerId,vehicleId,current?.id):false;
 return {...result,ready:result.ready&&covered&&!feedbackOpen,blockers:[...result.blockers,...(!covered?['OWNER_COOPERATION_SCOPE_MISMATCH']:[]),...(feedbackOpen?['OWNER_COOPERATION_FEEDBACK_OPEN']:[])]};
}

