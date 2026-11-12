import {HttpException} from '@nestjs/common';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {assertApproval} from '../offline-documents/review';
import {followupTemplateType} from '../owner-signing/followup';
import {assertRenewalAgreementQuote,renewalAgreementScope} from './renewal-agreement';

/** Only these business-evidence failures become readiness blockers. */
export class AgreementFactError extends Error{constructor(readonly code:string){super(code);}}
export function agreementFact(value:unknown,code:string):asserts value{if(!value)throw new AgreementFactError(code);}
export const agreementId=(value:any):value is string=>typeof value==='string'&&value.trim().length>0&&!value.includes('\0');
export const agreementHash=(value:any):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const agreementObject=(value:any):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function frozenVehicleId(snapshot:any):string|undefined{
 const lessor=snapshot?.lessorSnapshot?.vehicleId,direct=snapshot?.vehicleId;
 agreementFact((lessor==null||agreementId(lessor))&&(direct==null||agreementId(direct))&&(!lessor||!direct||lessor===direct),'AGREEMENT_VEHICLE_MISMATCH');return lessor??direct??undefined;
}
export type OfflineChangeScope={policy:'OFFLINE_ORDER_CHANGE_V1'|'OFFLINE_RENEWAL_V1';orderId:string;changeId:string;quoteId:string;quoteRevision:number;commercialHash:string;priorTermsHash:string;priorTermsVersionId:string|null;originalContractId:string;originalArchiveVersionId:string;documentHash:string;vehicleId?:string;targetVehicleId:string|null;originalAssignmentId:string|null;serviceStageId?:string;currentStageId?:string;currentStageHash?:string;renewalSourceHash?:string;startDate?:string;endDate?:string;periodsHash?:string};
function renewalFact<T>(read:()=>T):T{try{return read();}catch(error){if(error instanceof HttpException&&error.getStatus()===409)throw new AgreementFactError('AGREEMENT_RENEWAL_SOURCE');throw error;}}
export function offlineChangeScope(change:any,quote:any,contract:any):OfflineChangeScope{
 agreementFact(change&&quote&&contract&&[change.orderId,change.id,quote.id,change.originalContractId,change.originalArchiveVersionId].every(agreementId)&&quote.changeId===change.id&&contract.delayQuoteId===quote.id&&contract.orderId===change.orderId,'AGREEMENT_SCOPE_MISMATCH');
 agreementFact(Number.isInteger(quote.revision)&&quote.revision>0&&agreementHash(quote.commercialHash)&&agreementHash(change.priorTermsHash)&&typeof contract.body==='string'&&contract.body.trim().length>0,'AGREEMENT_SCOPE_MISMATCH');
 const vehicleId=frozenVehicleId(change.priorTerms),priorTermsVersionId=change.priorTermsVersionId??null,targetVehicleId=change.targetVehicleId??null,originalAssignmentId=quote.snapshot?.originalAssignmentId??null;
 agreementFact([priorTermsVersionId,targetVehicleId,originalAssignmentId].every(value=>value===null||agreementId(value)),'AGREEMENT_SCOPE_MISMATCH');
 return{policy:'OFFLINE_ORDER_CHANGE_V1',orderId:change.orderId,changeId:change.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,priorTermsHash:change.priorTermsHash,priorTermsVersionId,originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,documentHash:hash(contract.body),...(vehicleId?{vehicleId}:{}),targetVehicleId,originalAssignmentId,...(change.kind==='SUBSCRIPTION_EXTENSION'?renewalFact(()=>renewalAgreementScope(change,quote,contract)):{} )};
}
function dateDay(value:string){const parts=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!parts||parts[1]==='0000')return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function agreementInstant(value:any):number{
 if(value instanceof Date)return value.getTime();
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)||!dateDay(value.slice(0,10)))return NaN;
 return new Date(value).getTime();
}
function assertQuoteOwnership(change:any,order:any){
 agreementFact(change&&order&&change.orderId===order.id&&change.customerId===order.customerId&&['DELIVERY_DELAY','VEHICLE_CHANGE','SUBSCRIPTION_EXTENSION'].includes(change.kind),'AGREEMENT_OWNERSHIP_MISMATCH');
}
export function assertConfirmedQuote(change:any,quote:any,contract:any,order:any){
 assertQuoteOwnership(change,order);
 agreementFact(quote&&change.activeQuoteId===quote.id&&quote.changeId===change.id&&quote.status==='CONFIRMED'&&(['AWAITING_ARCHIVE','AWAITING_SIGNATURE','AWAITING_FINANCE','READY','SWAP_RETURNED','APPLIED'].includes(change.status)||change.kind==='SUBSCRIPTION_EXTENSION'&&change.status==='SCHEDULED'),'AGREEMENT_QUOTE_NOT_CONFIRMED');
 assertQuoteEvidence(change,quote,contract,order);
}
/** A separate historical rule, never an override of the current active-quote validator. */
export function assertHistoricalPreparedQuote(change:any,quote:any,contract:any,order:any){
 assertQuoteOwnership(change,order);
 const prepared=agreementInstant(quote?.financePreparedAt),confirmed=agreementInstant(quote?.confirmedAt);
 agreementFact(quote&&quote.changeId===change.id&&['CONFIRMED','SUPERSEDED'].includes(quote.status)&&Number.isFinite(prepared)&&Number.isFinite(confirmed)&&prepared>=confirmed&&agreementId(quote.approvedArchiveVersionId),'AGREEMENT_PREPARED_QUOTE_REQUIRED');
 assertQuoteEvidence(change,quote,contract,order);
}
function assertQuoteEvidence(change:any,quote:any,contract:any,order:any){
 const confirmed=agreementInstant(quote.confirmedAt),expires=agreementInstant(quote.snapshot?.expiresAt);
 agreementFact(Number.isFinite(confirmed)&&Number.isFinite(expires)&&confirmed<expires,'AGREEMENT_CONFIRMATION_INVALID');
 agreementFact(contract&&contract.id&&contract.kind==='AMENDMENT'&&contract.orderId===order.id&&contract.customerId===order.customerId&&contract.delayQuoteId===quote.id&&agreementHash(quote.commercialHash)&&contract.documentHash===quote.commercialHash,'AGREEMENT_CONTRACT_MISMATCH');
 const document=quote.snapshot?.document;
 const expectedType=order.contractMode==='OFFLINE'?'OFFLINE_ORDER_AMENDMENT':followupTemplateType(order,change.kind);
 agreementFact(document&&agreementId(document.id)&&document.type===expectedType&&Number.isInteger(document.version)&&document.version>0&&agreementHash(document.templateHash)&&contract.documentId===document.id&&contract.templateVersion===document.version,'AGREEMENT_TEMPLATE_MISMATCH');
 agreementFact(document&&typeof contract.body==='string'&&contract.body.trim().length>0&&document.content===contract.body&&document.bodyHash===hash(contract.body)&&(document.hash===undefined||document.hash===document.bodyHash),'AGREEMENT_DOCUMENT_MISMATCH');
 agreementFact(agreementObject(change.priorTerms)&&agreementHash(change.priorTermsHash)&&hash(change.priorTerms)===change.priorTermsHash,'AGREEMENT_PRIOR_TERMS_MISMATCH');
 if(change.kind==='SUBSCRIPTION_EXTENSION')renewalFact(()=>assertRenewalAgreementQuote(change,quote,contract,order));
}
export function assertOfflineContract(contract:any){agreementFact(contract?.executionMode==='OFFLINE'&&contract.status==='DRAFT'&&!contract.providerTaskId&&!contract.signedFileId,'AGREEMENT_OFFLINE_CONTRACT_INVALID');}
export function assertArchiveEvidence(archive:any,version:any,businessHash:string,parties:Array<{role:string;partyId:string}>,scope?:unknown){
 agreementFact(archive&&version&&version.archiveId===archive.id&&agreementId(version.id)&&version.status==='ARCHIVED'&&!version.invalidatedAt&&!version.invalidatedBy,'AGREEMENT_ARCHIVE_REQUIRED');
 agreementFact(version.businessSnapshotHash===businessHash&&agreementHash(businessHash)&&(!scope||agreementObject(version.scopeSnapshot)&&canonicalHash(version.scopeSnapshot)===canonicalHash(scope)),'AGREEMENT_ARCHIVE_SCOPE_MISMATCH');
 agreementFact(Array.isArray(archive.versions)&&archive.versions.every((v:any)=>Array.isArray(v.feedback))&&!archive.versions.some((v:any)=>v.feedback.some((f:any)=>f.status==='OPEN')),'AGREEMENT_FEEDBACK_OPEN');
 agreementFact(agreementId(version.sourceFileId)&&agreementId(version.templateId)&&Number.isInteger(version.templateVersion)&&version.templateVersion>0&&dateDay(version.signedOn)&&agreementId(version.contractNumber)&&Number.isInteger(version.declaredPages)&&version.declaredPages>0&&agreementId(version.submittedBy)&&Number.isFinite(agreementInstant(version.submittedAt))&&agreementId(version.reviewedBy)&&Number.isFinite(agreementInstant(version.reviewedAt)),'AGREEMENT_ARCHIVE_EVIDENCE_INCOMPLETE');
 const roles=['CUSTOMER','OWNER','PLATFORM'];
 agreementFact(Array.isArray(version.requiredSigners)&&version.requiredSigners.length===roles.length&&new Set(version.requiredSigners).size===roles.length&&roles.every(role=>version.requiredSigners.includes(role))&&Array.isArray(version.partiesSnapshot)&&version.partiesSnapshot.length===roles.length&&roles.every(role=>version.partiesSnapshot.filter((p:any)=>p?.role===role&&p.partyId===parties.find(p=>p.role===role)?.partyId).length===1),'AGREEMENT_ARCHIVE_PARTIES_MISMATCH');
 agreementFact(Array.isArray(version.files)&&version.files.every((f:any)=>f?.file)&&Array.isArray(version.partyChecks)&&version.partyChecks.every((p:any)=>p&&Array.isArray(p.signaturePageRefs)&&p.signaturePageRefs.every((ref:any)=>ref&&Number.isInteger(ref.page))&&(!p.authorityFileIds||Array.isArray(p.authorityFileIds))),'AGREEMENT_ARCHIVE_EVIDENCE_INCOMPLETE');
 try{assertApproval({...version,status:'REVIEWED'},{checklist:version.reviewChecklist,partyChecks:version.partyChecks,reason:version.reviewReason},version.reviewedBy,businessHash);}catch(error){if(error instanceof HttpException)throw new AgreementFactError('AGREEMENT_ARCHIVE_EVIDENCE_INCOMPLETE');throw error;}
}
