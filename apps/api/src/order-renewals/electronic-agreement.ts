import {randomUUID} from 'node:crypto';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {electronicPlatformParty} from '../electronic-documents/initial-terms';
import {approvedElectronicBody} from '../electronic-documents/print';
import {freezeV31Preparation,assertV31PreparationSourcesCurrent} from '../contract-terms/preparation';
import {assertRenewalQuote} from './types';
import {revalidateRenewalQuote} from './quotes';
import type {ElectronicPreparationContext} from '../electronic-documents/prepare';

export function electronicRenewalCommercialHash(change:any,s:any){
 const {v31Sources,customerAcceptance,...snapshot}=s,terms={...s.renewalTerms};
 delete terms.commercialHash;delete terms.amendmentContractId;
 return canonicalHash({priorTermsHash:change.priorTermsHash,snapshot:{...snapshot,renewalTerms:terms},contractId:s.electronicContractId});
}
export function assertElectronicRenewalCommercial(change:any,q:any){
 const s=assertRenewalQuote(change,q);
 ensure(s.executionMode==='ELECTRONIC'&&s.document?.type==='ELECTRONIC_V31_RENEWAL'&&typeof s.document.content==='string'&&hash(s.document.content)===s.document.bodyHash&&typeof s.electronicContractId==='string'&&q.commercialHash===electronicRenewalCommercialHash(change,s)&&s.renewalTerms.commercialHash===q.commercialHash&&s.renewalTerms.amendmentContractId===s.electronicContractId,409,'RENEWAL_QUOTE_SOURCE','05固定报价、主体或正文摘要不一致');return s;
}
/** Exact persisted05 business; no current catalog check on historical proof reads. */
export async function electronicRenewalBusiness(tx:any,id:string){
 const change=await tx.orderChange.findUnique({where:{id}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION',404,'NOT_FOUND','电子续期不存在');
 const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),q=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:{include:{electronicTask:true}}}}):null;
 ensure(order.contractMode==='ELECTRONIC'&&order.customerId===change.customerId&&q?.changeId===change.id,409,'ELECTRONIC_BUSINESS_CHANGED','电子续期归属或报价已变化');
 const s=safeQuote(change,q);return{change,order,q,s};
}
function safeQuote(change:any,q:any){return q?.snapshot?.document?assertElectronicRenewalCommercial(change,q):assertRenewalQuote(change,q);}
export async function publishElectronicRenewal(tx:any,change:any,q:any,now:Date){
 ensure(change.status==='REVIEWED'&&q.status==='REVIEWED'&&q.reviewedBy&&q.reviewedBy!==q.createdBy,409,'TWO_PERSON_REQUIRED','须先独立复核续期报价');
 const {facts}=await revalidateRenewalQuote(tx,change,q,now);await requireElectronicCustomerIdentity(tx,change.customerId);
 const template=await tx.legalDocument.findFirst({where:{type:'ELECTRONIC_V31_RENEWAL',status:'PUBLISHED'},orderBy:{version:'desc'}});approvedElectronicBody(template,'RENEWAL');
 const contractId=randomUUID(),s=q.snapshot,document={id:template.id,type:template.type,version:template.version,templateHash:hash(template.content)};
 const content=JSON.stringify({kind:'RENEWAL',template:document,originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,priorTermsVersionId:change.priorTermsVersionId,priorTermsHash:change.priorTermsHash,originalAnchor:facts.order.serviceAnchor,currentStage:{id:s.source.currentStageId,hash:s.source.currentStageHash},vehicleId:s.source.vehicleId,assignmentId:s.originalAssignmentId,product:s.product,startDate:s.startDate,endDate:s.endDate,depositAmount:s.depositAmount,periods:s.periods,paymentArrangement:s.input.settlementExplanation});
 const snapshot={...s,electronicContractId:contractId,document:{...document,content,bodyHash:hash(content)}},commercialHash=electronicRenewalCommercialHash(change,snapshot);
 snapshot.renewalTerms={...snapshot.renewalTerms,commercialHash,amendmentContractId:contractId};
 await tx.delayQuote.update({where:{id:q.id},data:{commercialHash,snapshot,status:'PUBLISHED'}});
 const sources=await freezeV31Preparation(tx,{kind:'RENEWAL',resourceId:change.id,revision:q.revision,businessHash:commercialHash});
 await tx.delayQuote.update({where:{id:q.id},data:{snapshot:{...snapshot,v31Sources:sources}}});
 await tx.contract.create({data:{id:contractId,orderId:change.orderId,customerId:change.customerId,kind:'AMENDMENT',executionMode:'ELECTRONIC',delayQuoteId:q.id,documentId:template.id,templateVersion:template.version,documentHash:commercialHash,body:content}});
 await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_CONFIRMATION'}});
}
export async function confirmElectronicRenewal(tx:any,change:any,q:any,now:Date){
 const {order,s}=await electronicRenewalBusiness(tx,change.id);await revalidateRenewalQuote(tx,change,q,now);await requireElectronicCustomerIdentity(tx,order.customerId);
 const contract=await tx.contract.findUnique({where:{delayQuoteId:q.id}});
 ensure(q.status==='PUBLISHED'&&contract?.id===s.electronicContractId&&contract.executionMode==='ELECTRONIC'&&contract.kind==='AMENDMENT'&&contract.orderId===order.id&&contract.customerId===order.customerId&&contract.documentHash===q.commercialHash&&contract.documentId===s.document.id&&contract.templateVersion===s.document.version&&contract.status==='DRAFT'&&!contract.providerTaskId&&!contract.signedFileId&&contract.body===s.document.content,409,'DOCUMENT_MISMATCH','05合同版本或归属已变化');
 assertV31PreparationSourcesCurrent(s.v31Sources,await freezeV31Preparation(tx,{kind:'RENEWAL',resourceId:change.id,revision:q.revision,businessHash:q.commercialHash}));
}
export async function electronicRenewalPreparation(tx:any,id:string):Promise<ElectronicPreparationContext>{
 const {order,change,q,s}=await electronicRenewalBusiness(tx,id);
 ensure(order.status==='ACTIVE'&&q.confirmedAt&&q.status==='CONFIRMED'&&q.contract?.executionMode==='ELECTRONIC'&&q.contract.documentHash===q.commercialHash&&['AWAITING_SIGNATURE','AWAITING_FINANCE'].includes(change.status),409,'ELECTRONIC_BUSINESS_CHANGED','客户须先确认当前续期方案');
 await revalidateRenewalQuote(tx,change,q,new Date());
 assertV31PreparationSourcesCurrent(s.v31Sources,await freezeV31Preparation(tx,{kind:'RENEWAL',resourceId:change.id,revision:q.revision,businessHash:q.commercialHash}));
 const identity=await electronicPlatformParty(tx),platform={...identity,creditCode:(await tx.vehicleOwner.findUniqueOrThrow({where:{id:identity.partyId}})).creditCode},customer=await tx.customer.findUniqueOrThrow({where:{id:order.customerId}}),owner=await tx.vehicleOwner.findUniqueOrThrow({where:{id:s.source.ownerId}}),initial=order.finalPlanSnapshot.partiesSnapshot;
 ensure(initial?.length===3&&[{role:'CUSTOMER',id:customer.id,type:'INDIVIDUAL'},{role:'OWNER',id:owner.id,type:owner.subjectType},{role:'PLATFORM',id:platform.partyId,type:'ENTERPRISE'}].every(v=>initial.filter((p:any)=>p.role===v.role&&p.partyId===v.id&&p.subjectType===v.type).length===1),409,'ELECTRONIC_PARTIES_MISMATCH','05须保持原真实三方主体');
 return{kind:'RENEWAL',archiveKind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:q.id,orderId:order.id,customerId:customer.id,ownerId:owner.id,revision:change.revision,contract:q.contract,businessHash:q.commercialHash,templateId:s.document.id,templateHash:s.document.templateHash,parties:[{role:'CUSTOMER',partyId:customer.id,name:customer.name,subjectType:'INDIVIDUAL'},{role:'OWNER',partyId:owner.id,name:owner.name,subjectType:owner.subjectType,creditCode:owner.creditCode},platform],context:{kind:'RENEWAL',orderId:order.id,platformSubjectId:platform.partyId,cooperationVersionId:s.renewalTerms.lessorSnapshot.agreementVersionId,vehicleIds:[s.source.vehicleId]},scope:{changeId:change.id,quoteId:q.id,quoteRevision:q.revision,renewalSourceHash:s.sourceHash,originalArchiveVersionId:change.originalArchiveVersionId,priorTermsVersionId:change.priorTermsVersionId,currentStageId:s.source.currentStageId,currentStageHash:s.source.currentStageHash,assignmentId:s.originalAssignmentId},sections:[],variables:{}};
}
