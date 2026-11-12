import {randomUUID} from 'node:crypto';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {electronicPlatformParty} from '../electronic-documents/initial-terms';
import {freezeV31Preparation,assertV31PreparationSourcesCurrent} from '../contract-terms/preparation';
import {approvedElectronicBody} from '../electronic-documents/print';
import {assertOfflineSwapQuote,requireOfflineSwapTarget} from './offline-target';
import {requireOfflineSwapFacts} from './offline-facts';
import type {ElectronicPreparationContext} from '../electronic-documents/prepare';
import {requireElectronicSwapChain,assertElectronicSwapCommercial} from './electronic-source';

export async function electronicSwapBusiness(tx:any,changeId:string){
 const change=await tx.orderChange.findUnique({where:{id:changeId}});ensure(change?.kind==='VEHICLE_CHANGE',404,'NOT_FOUND','电子换车不存在');
 const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),q=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:{include:{electronicTask:true}}}}):null;
 ensure(order.contractMode==='ELECTRONIC'&&order.customerId===change.customerId&&order.status==='ACTIVE'&&q?.changeId===change.id&&!['CANCELLED','REJECTED'].includes(change.status),409,'ELECTRONIC_BUSINESS_CHANGED','电子换车订单或当前报价已变化');
 const s=assertOfflineSwapQuote(change,q),f=s.electronicTerms;
 if(s.document)assertElectronicSwapCommercial(change,q);
 if(change.status!=='APPLIED')await requireElectronicSwapChain(tx,order);
 ensure(s.executionMode==='ELECTRONIC'&&f?.hash===canonicalHash(f.snapshot)&&f.snapshot.changeId===change.id&&f.snapshot.orderId===order.id&&f.snapshot.customerId===order.customerId&&f.snapshot.priorTermsHash===change.priorTermsHash&&f.snapshot.originalAssignmentId===s.originalAssignmentId&&f.snapshot.targetVehicleId===change.targetVehicleId&&f.snapshot.ownerId===change.priorTerms.lessorSnapshot?.ownerId&&f.snapshot.targetOwnerId===s.targetLessorSnapshot?.ownerId&&f.snapshot.depositAmount===change.priorTerms.depositAmount&&s.depositAmount===change.priorTerms.depositAmount&&f.snapshot.targetMonthlyFeeAmount===s.newMonthlyFeeAmount&&canonicalHash(f.snapshot.targetProduct)===canonicalHash(s.targetSource.product),409,'SWAP_QUOTE_SOURCE_MISMATCH','电子换车固定价格、车辆或原押金来源不一致');
 return{change,order,q,s};
}
export async function publishElectronicSwap(tx:any,order:any,change:any,q:any){
 await electronicSwapBusiness(tx,change.id);await requireOfflineSwapFacts(tx,order,change);await requireOfflineSwapTarget(tx,order,change,q,new Date(q.snapshot.plannedDeliveryAt));
 ensure(q.status==='REVIEWED'&&q.reviewedBy&&q.reviewedBy!==q.createdBy,409,'TWO_PERSON_REQUIRED','须先独立复核报价');
 const template=await tx.legalDocument.findFirst({where:{type:'ELECTRONIC_V31_VEHICLE_SWAP',status:'PUBLISHED'},orderBy:{version:'desc'}});approvedElectronicBody(template,'VEHICLE_SWAP');
 await requireElectronicCustomerIdentity(tx,order.customerId);
 const contractId=randomUUID(),document={id:template.id,type:template.type,version:template.version,templateHash:hash(template.content)},base={...q.snapshot,electronicContractId:contractId,document};
 // Public confirmation is the exact commercial summary; private complete03 PDF is prepared next.
 const content=JSON.stringify({kind:'VEHICLE_SWAP',template:document,terms:q.snapshot.electronicTerms,continuingBenefits:{mileagePerMonthKm:change.priorTerms.mileagePerMonthKm,excessMileagePriceAmount:change.priorTerms.excessMileagePriceAmount,usagePolicy:change.priorTerms.usagePolicy,swapPolicy:change.priorTerms.productSnapshot.swapPolicy},serviceFeeSource:q.snapshot.serviceFeeSource,customerBaas:{prior:(change.priorTerms.currentVehicleProductSnapshot??change.priorTerms.productSnapshot).customerBaas,target:q.snapshot.targetSource.product.customerBaas},plannedReturnAt:q.snapshot.plannedReturnAt,plannedDeliveryAt:q.snapshot.plannedDeliveryAt,handoverArrangement:q.snapshot.handoverArrangement});
 const snapshot={...base,document:{...document,content,bodyHash:hash(content)}};
 const commercialHash=canonicalHash({priorTermsHash:change.priorTermsHash,snapshot,contractId});
 await tx.delayQuote.update({where:{id:q.id},data:{commercialHash,snapshot,status:'PUBLISHED'}});
 const sources=await freezeV31Preparation(tx,{kind:'VEHICLE_SWAP',resourceId:change.id,revision:q.revision,businessHash:commercialHash});
 await tx.delayQuote.update({where:{id:q.id},data:{snapshot:{...snapshot,v31Sources:sources}}});
 await tx.contract.create({data:{id:contractId,orderId:order.id,customerId:order.customerId,kind:'AMENDMENT',executionMode:'ELECTRONIC',delayQuoteId:q.id,documentId:template.id,templateVersion:template.version,documentHash:commercialHash,body:content}});
 await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_CONFIRMATION'}});
}
export async function confirmElectronicSwap(tx:any,change:any,q:any){
 const {order,s}=await electronicSwapBusiness(tx,change.id);
 await requireOfflineSwapFacts(tx,order,change);await requireOfflineSwapTarget(tx,order,change,q,new Date(s.plannedDeliveryAt));await requireElectronicCustomerIdentity(tx,order.customerId);
 ensure(q.status==='PUBLISHED'&&s.document?.type==='ELECTRONIC_V31_VEHICLE_SWAP',409,'DOCUMENT_MISMATCH','须使用本次独立03正文');
 const current=await freezeV31Preparation(tx,{kind:'VEHICLE_SWAP',resourceId:change.id,revision:q.revision,businessHash:q.commercialHash});assertV31PreparationSourcesCurrent(s.v31Sources,current);
}
export async function electronicSwapPreparation(tx:any,id:string):Promise<ElectronicPreparationContext>{
 const {order,change,q,s}=await electronicSwapBusiness(tx,id);
 ensure(q.confirmedAt&&q.status==='CONFIRMED'&&q.contract?.executionMode==='ELECTRONIC'&&q.contract.documentHash===q.commercialHash&&['AWAITING_SIGNATURE','SWAP_RETURNED','AWAITING_FINANCE'].includes(change.status),409,'ELECTRONIC_BUSINESS_CHANGED','客户须先确认当前换车方案');
 assertV31PreparationSourcesCurrent(s.v31Sources,await freezeV31Preparation(tx,{kind:'VEHICLE_SWAP',resourceId:change.id,revision:q.revision,businessHash:q.commercialHash}));
 const platformIdentity=await electronicPlatformParty(tx),platform={...platformIdentity,creditCode:(await tx.vehicleOwner.findUniqueOrThrow({where:{id:platformIdentity.partyId}})).creditCode},customer=await tx.customer.findUniqueOrThrow({where:{id:order.customerId}}),owner=await tx.vehicleOwner.findUniqueOrThrow({where:{id:s.targetLessorSnapshot.ownerId}}),initial=order.finalPlanSnapshot.partiesSnapshot;
 ensure(initial?.find((p:any)=>p.role==='CUSTOMER')?.partyId===customer.id&&initial?.find((p:any)=>p.role==='OWNER')?.partyId===owner.id&&initial?.find((p:any)=>p.role==='PLATFORM')?.partyId===platform.partyId,409,'ELECTRONIC_PARTIES_MISMATCH','换车必须沿用原真实三方主体');
 return{kind:'VEHICLE_SWAP',archiveKind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:q.id,orderId:order.id,customerId:customer.id,ownerId:owner.id,revision:change.revision,contract:q.contract,businessHash:q.commercialHash,templateId:s.document.id,templateHash:s.document.templateHash,parties:[{role:'CUSTOMER',partyId:customer.id,name:customer.name,subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode},platform],context:{kind:'VEHICLE_SWAP',orderId:order.id,platformSubjectId:platform.partyId,cooperationVersionId:s.targetLessorSnapshot.agreementVersionId,vehicleIds:[s.electronicTerms.snapshot.originalVehicleId,change.targetVehicleId]},scope:{changeId:change.id,quoteId:q.id,quoteRevision:q.revision,termsHash:s.electronicTerms.hash,originalArchiveVersionId:change.originalArchiveVersionId},sections:[],variables:{}};
}
