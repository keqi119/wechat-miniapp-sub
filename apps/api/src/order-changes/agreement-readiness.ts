import {requireElectronicRenewalAgreement} from '../order-renewals/electronic-archive';
import {requireElectronicSwapChain} from '../vehicle-changes/electronic-source';
import {requireElectronicSwapAgreement} from '../vehicle-changes/electronic-archive';
import {HttpException} from '@nestjs/common';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {readServiceStage} from '../order-service-stages/readiness';
import {ensure} from '../common/errors';
import {platformLegalEntity} from '../common/platform-legal-entity';
import {assertNotAssetFiles} from '../files/asset-files';
import {archivePrintConfirmed} from '../offline-documents/archive-workflow';
import {AgreementFactError,agreementFact,agreementHash,agreementId,agreementObject,agreementInstant,assertArchiveEvidence,assertConfirmedQuote,assertHistoricalPreparedQuote,assertOfflineContract,frozenVehicleId,offlineChangeScope} from './agreement-facts';

export type ChangeAgreement={mode:'ESIGN';contractId:string;documentHash:string}|{mode:'OFFLINE'|'ELECTRONIC';contractId:string;archiveId:string;archiveVersionId:string;quoteId:string;quoteRevision:number;commercialHash:string;fileManifestHash:string};
export type ChangeAgreementReadiness={ready:boolean;blockers:string[];agreement:ChangeAgreement|null};
export type EffectiveContractChain={ready:boolean;blockers:string[];original:null|{contractId:string;archiveId:string;archiveVersionId:string;businessHash:string};termsVersionId:string|null;termsHash:string;amendmentVersionIds:string[]};
export type ReadyEffectiveContractChain=Omit<EffectiveContractChain,'ready'|'original'>&{ready:true;original:NonNullable<EffectiveContractChain['original']>};
const archiveInclude={versions:{include:{files:{orderBy:{position:'asc' as const},include:{file:true}},feedback:true}}};
function partiesFor(order:any){
 const initial=order.finalPlanSnapshot,stored=initial?.partiesSnapshot;agreementFact(stored==null||Array.isArray(stored),'AGREEMENT_PARTIES_MISMATCH');
 const lessorOwner=initial?.lessorSnapshot?.ownerId,owner=stored?.find((p:any)=>p?.role==='OWNER')?.partyId??lessorOwner??initial?.ownerId;
 agreementFact(agreementId(owner)&&(!lessorOwner||lessorOwner===owner),'AGREEMENT_OWNER_MISSING');
 const parties=Array.isArray(stored)?stored:[{role:'CUSTOMER',partyId:order.customerId},{role:'OWNER',partyId:owner},{role:'PLATFORM',partyId:platformLegalEntity()}];
 agreementFact(parties.length===3&&['CUSTOMER','OWNER','PLATFORM'].every(role=>parties.filter((p:any)=>p?.role===role&&agreementId(p.partyId)).length===1)&&parties.find((p:any)=>p.role==='CUSTOMER')?.partyId===order.customerId,'AGREEMENT_PARTIES_MISMATCH');return{owner,parties};
}
async function noAssetFiles(tx:any,ids:string[]){try{await assertNotAssetFiles(tx,ids);}catch(error){if(error instanceof HttpException&&(error.getResponse() as any)?.error?.code==='ASSET_FILE_ROUTE_REQUIRED')throw new AgreementFactError('AGREEMENT_ASSET_FILE_FORBIDDEN');throw error;}}
async function archivedEvidence(tx:any,archive:any,version:any,businessHash:string,parties:any[],scope?:unknown){
 assertArchiveEvidence(archive,version,businessHash,parties,scope);
 await noAssetFiles(tx,[version.sourceFileId,...version.files.map((f:any)=>f.fileId)]);
 const source=await tx.storedFile.findUnique({where:{id:version.sourceFileId}});
 agreementFact(source?.id===version.sourceFileId&&source.purpose==='offline-source'&&source.mimeType==='application/pdf'&&Number.isInteger(source.size)&&source.size>0&&agreementHash(source.sha256),'AGREEMENT_SOURCE_FILE_REQUIRED');
 agreementFact(await archivePrintConfirmed(tx,archive,version),'AGREEMENT_PRINT_CONFIRMATION_REQUIRED');
}
async function loadArchive(tx:any,id:any){agreementFact(agreementId(id),'AGREEMENT_ARCHIVE_REQUIRED');const archive=await tx.documentArchive.findUnique({where:{id},include:archiveInclude});agreementFact(archive,'AGREEMENT_ARCHIVE_REQUIRED');return archive;}
function selectedVersion(archive:any,id:any){agreementFact(agreementId(id)&&Array.isArray(archive.versions),'AGREEMENT_ARCHIVE_REQUIRED');const version=archive.versions.find((v:any)=>v.id===id);agreementFact(version,'AGREEMENT_ARCHIVE_REQUIRED');return version;}
async function paperAgreement(tx:any,order:any,change:any,quote:any,contract:any){
 assertConfirmedQuote(change,quote,contract,order);return paperAgreementEvidence(tx,order,change,quote,contract);
}
async function paperAgreementEvidence(tx:any,order:any,change:any,quote:any,contract:any){
 await requireRenewalAgreementSource(tx,order,change,quote);
 assertOfflineContract(contract);const {owner,parties}=partiesFor(order),archive=await loadArchive(tx,contract.offlineArchiveId);
 agreementFact(archive.kind==='ORDER_AMENDMENT'&&archive.subjectType==='ORDER_CHANGE_QUOTE'&&archive.subjectId===quote.id&&archive.quoteId===quote.id&&archive.orderId===order.id&&archive.ownerId===owner&&!archive.handoverId,'AGREEMENT_ARCHIVE_OWNERSHIP_MISMATCH');
 const version=selectedVersion(archive,quote.approvedArchiveVersionId??archive.currentApprovedVersionId);
 agreementFact(version.templateId===quote.snapshot.document.id&&version.templateVersion===quote.snapshot.document.version,'AGREEMENT_TEMPLATE_MISMATCH');
 await archivedEvidence(tx,archive,version,quote.commercialHash,parties,offlineChangeScope(change,quote,contract));
 return{mode:'OFFLINE' as const,contractId:contract.id,archiveId:archive.id,archiveVersionId:version.id,quoteId:quote.id,quoteRevision:quote.revision,commercialHash:quote.commercialHash,fileManifestHash:version.fileManifestHash as string};
}
/** The frozen quote alone cannot establish a real previous stage or vehicle assignment. Read only. */
export async function requireRenewalAgreementSource(tx:any,order:any,change:any,quote:any){
 if(change.kind!=='SUBSCRIPTION_EXTENSION')return;
 const s=quote.snapshot,source=s.source;
 try{
  if(quote.financePreparedAt!=null||['SCHEDULED','APPLIED'].includes(change.status))agreementFact(Number.isFinite(agreementInstant(quote.financePreparedAt))&&agreementInstant(quote.financePreparedAt)>=agreementInstant(quote.confirmedAt)&&agreementId(quote.approvedArchiveVersionId),'AGREEMENT_PREPARED_QUOTE_REQUIRED');
  const account=await tx.usageAccount.findUnique({where:{orderId:order.id}});agreementFact(account?.id===source.accountId&&account.orderId===order.id&&account.customerId===order.customerId,'AGREEMENT_RENEWAL_ACCOUNT_MISMATCH');
  const previous=await readServiceStage(tx,order,source.currentStageId);
  agreementFact(['ACTIVE','ENDED'].includes(previous.stage.status)&&previous.stage.snapshotHash===source.currentStageHash&&previous.snapshot.period.endDate===s.startDate&&previous.snapshot.identity.sequence<source.nextStageSequence&&previous.snapshot.period.lastPeriodSequence<s.periods[0].sequence,'AGREEMENT_RENEWAL_STAGE_MISMATCH');
  agreementFact(previous.snapshot.kind==='INITIAL'?!Object.hasOwn(change.priorTerms,'serviceStageId'):change.priorTerms.serviceStageId===previous.stage.id,'AGREEMENT_RENEWAL_STAGE_MISMATCH');
  const assignment=await tx.vehicleAssignment.findUnique({where:{id:source.assignmentId}});
  agreementFact(assignment?.id===source.assignmentId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===source.vehicleId&&['ACTIVE','CLOSED'].includes(assignment.status)&&Number.isFinite(agreementInstant(assignment.startAt))&&agreementInstant(assignment.startAt)<=agreementInstant(quote.confirmedAt),'AGREEMENT_RENEWAL_ASSIGNMENT_MISMATCH');
  if(change.status!=='APPLIED')agreementFact(assignment.status==='ACTIVE'&&!assignment.endAt&&order.currentAssignmentId===assignment.id,'AGREEMENT_RENEWAL_ASSIGNMENT_MISMATCH');
  const delivery=assignment.deliveryHandoverId?await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}):null;
  agreementFact(delivery?.id===assignment.deliveryHandoverId&&delivery.orderId===order.id&&delivery.customerId===order.customerId&&delivery.vehicleId===assignment.vehicleId&&delivery.assignmentId===assignment.id&&['DELIVERY','SWAP_DELIVERY'].includes(delivery.type)&&delivery.status==='COMPLETED'&&Number.isFinite(agreementInstant(delivery.actualAt))&&Number.isFinite(agreementInstant(delivery.completedAt))&&agreementInstant(delivery.actualAt)===agreementInstant(assignment.startAt),'AGREEMENT_RENEWAL_ASSIGNMENT_MISMATCH');
  const originalContract=await tx.contract.findUnique({where:{id:source.originalContractId}});agreementFact(originalContract?.id===source.originalContractId&&originalContract.orderId===order.id&&originalContract.customerId===order.customerId&&agreementId(originalContract.offlineArchiveId),'AGREEMENT_RENEWAL_ORIGINAL_MISMATCH');
  const original=await tx.documentArchive.findUnique({where:{id:originalContract.offlineArchiveId},include:{versions:true}}),version=original?.versions.find((v:any)=>v.id===source.originalArchiveVersionId);
  agreementFact(version?.fileManifestHash===source.originalArchiveHash,'AGREEMENT_RENEWAL_ORIGINAL_MISMATCH');
 }catch(error){if(error instanceof HttpException&&error.getStatus()===409)throw new AgreementFactError('AGREEMENT_RENEWAL_SOURCE');throw error;}
}
async function signedPdf(tx:any,contract:any,order:any){
 agreementFact(contract?.executionMode==='ESIGN'&&contract.status==='SIGNED'&&contract.orderId===order.id&&contract.customerId===order.customerId&&agreementId(contract.signedFileId)&&agreementHash(contract.documentHash),'AGREEMENT_SIGNATURE_REQUIRED');
 const file=await tx.storedFile.findUnique({where:{id:contract.signedFileId}});agreementFact(file?.id===contract.signedFileId&&file.customerId===order.customerId&&file.mimeType==='application/pdf'&&Number.isInteger(file.size)&&file.size>0&&agreementHash(file.sha256),'AGREEMENT_SIGNED_PDF_REQUIRED');await noAssetFiles(tx,[file.id]);
}
async function chain(tx:any,orderId:string,historicalOriginalPin?:string){
 const order=await tx.order.findUnique({where:{id:orderId}});agreementFact(order,'AGREEMENT_ORDER_MISSING');agreementFact(order.contractMode==='OFFLINE','AGREEMENT_OFFLINE_REQUIRED');
 const initial=order.finalPlanSnapshot;agreementFact(agreementObject(initial)&&agreementHash(initial.commercialHash),'AGREEMENT_INITIAL_TERMS_MISSING');const {owner,parties}=partiesFor(order);
 const versions=await tx.orderTermsVersion.findMany({where:{orderId},orderBy:{version:'asc'},include:{quote:{include:{change:true,contract:true}}}});
 agreementFact(Array.isArray(versions)&&versions.every((v:any,i:number)=>v.orderId===orderId&&v.version===i+1&&agreementId(v.id))&&(versions.length?order.effectiveTermsVersionId===versions.at(-1).id:!order.effectiveTermsVersionId),'AGREEMENT_TERMS_CHAIN_BROKEN');
 const originals=await tx.contract.findMany({where:{orderId,kind:{in:['SUBSCRIPTION','RENTAL']}},orderBy:{createdAt:'asc'}});agreementFact(originals.length===1,'AGREEMENT_ORIGINAL_CONTRACT_MISSING');const original=originals[0];
 agreementFact(original.orderId===orderId&&original.customerId===order.customerId&&['SUBSCRIPTION','RENTAL'].includes(original.kind)&&original.documentHash===initial.commercialHash&&!original.delayQuoteId,'AGREEMENT_ORIGINAL_CONTRACT_MISMATCH');assertOfflineContract(original);
 const rental=await loadArchive(tx,original.offlineArchiveId);agreementFact(rental.kind==='RENTAL'&&rental.subjectType==='ORDER'&&rental.subjectId===orderId&&rental.orderId===orderId&&rental.ownerId===owner&&!rental.quoteId&&!rental.handoverId,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH');
 const originalVersion=selectedVersion(rental,versions.length?versions[0].quote?.change?.originalArchiveVersionId:historicalOriginalPin??rental.currentApprovedVersionId),initialVehicle=frozenVehicleId(initial);
 agreementFact(!historicalOriginalPin||historicalOriginalPin===originalVersion.id,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH');
 // The initial empty-body Contract indexes the commercial plan. Existing
 // archive creation can select another approved RENTAL template; the actual
 // bound paper version and its complete evidence remain authoritative.
 agreementFact(agreementObject(originalVersion.scopeSnapshot)&&agreementId(originalVersion.scopeSnapshot.vehicleId)&&(!initialVehicle||originalVersion.scopeSnapshot.vehicleId===initialVehicle),'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH');await archivedEvidence(tx,rental,originalVersion,initial.commercialHash,parties);
 let prior:any=initial,priorId:string|null=null;const amendmentVersionIds:string[]=[];
 for(const terms of versions){
  const q=terms.quote,c=q?.change,contract=q?.contract;
  agreementFact(q&&c&&contract&&terms.quoteId===q.id&&c.status==='APPLIED'&&c.orderId===orderId&&c.customerId===order.customerId&&c.originalContractId===original.id&&c.originalArchiveVersionId===originalVersion.id&&(c.priorTermsVersionId??null)===priorId&&c.priorTermsHash===hash(prior)&&agreementObject(c.priorTerms)&&hash(c.priorTerms)===hash(prior),'AGREEMENT_TERMS_CHAIN_BROKEN');
  agreementFact(agreementHash(terms.hash)&&terms.hash===q.commercialHash&&agreementObject(terms.snapshot)&&terms.snapshot.commercialHash===terms.hash&&terms.snapshot.amendmentContractId===contract.id&&agreementId(q.approvedArchiveVersionId)&&terms.offlineArchiveVersionId===q.approvedArchiveVersionId,'AGREEMENT_TERMS_ARCHIVE_MISMATCH');
  if(c.kind==='SUBSCRIPTION_EXTENSION')agreementFact(canonicalHash(terms.snapshot)===canonicalHash(q.snapshot?.renewalTerms),'AGREEMENT_RENEWAL_TERMS_MISMATCH');
  if(c.kind==='SUBSCRIPTION_EXTENSION')assertHistoricalPreparedQuote(c,q,contract,order);
  const agreement=c.kind==='SUBSCRIPTION_EXTENSION'?await paperAgreementEvidence(tx,order,c,q,contract):await paperAgreement(tx,order,c,q,contract);agreementFact(agreement.archiveVersionId===terms.offlineArchiveVersionId,'AGREEMENT_TERMS_ARCHIVE_MISMATCH');amendmentVersionIds.push(agreement.archiveVersionId);prior=terms.snapshot;priorId=terms.id;
 }
 const result:EffectiveContractChain={ready:true,blockers:[],original:{contractId:original.id,archiveId:rental.id,archiveVersionId:originalVersion.id,businessHash:initial.commercialHash},termsVersionId:priorId,termsHash:versions.length?versions.at(-1).hash:initial.commercialHash,amendmentVersionIds};return{result,order,original,originalVersion,versions,snapshot:prior};
}
/** Read only. Calling commands retain their current authorization and Order lock. */
export async function readChangeAgreementReady(tx:any,changeId:string):Promise<ChangeAgreementReadiness>{
 try{
  const change=await tx.orderChange.findUnique({where:{id:changeId}});agreementFact(change,'AGREEMENT_CHANGE_MISSING');const order=await tx.order.findUnique({where:{id:change.orderId}});agreementFact(order,'AGREEMENT_ORDER_MISSING');
  agreementFact(agreementId(change.activeQuoteId),'AGREEMENT_QUOTE_NOT_CONFIRMED');const quote=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}}),contract=quote?.contract;if(order.contractMode==='ELECTRONIC')return{ready:true,blockers:[],agreement:change.kind==='SUBSCRIPTION_EXTENSION'?await requireElectronicRenewalAgreement(tx,change,quote):await requireElectronicSwapAgreement(tx,change,quote)};assertConfirmedQuote(change,quote,contract,order);
  if(order.contractMode==='ESIGN'){
   const original=await tx.contract.findUnique({where:{id:change.originalContractId}});agreementFact(original&&['SUBSCRIPTION','RENTAL'].includes(original.kind),'AGREEMENT_ORIGINAL_CONTRACT_MISSING');await signedPdf(tx,original,order);await signedPdf(tx,contract,order);return{ready:true,blockers:[],agreement:{mode:'ESIGN',contractId:contract.id,documentHash:contract.documentHash}};
  }
  agreementFact(order.contractMode==='OFFLINE','AGREEMENT_MODE_INVALID');const current=await chain(tx,order.id);
  agreementFact(change.originalContractId===current.original.id&&change.originalArchiveVersionId===current.originalVersion.id,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH');
  if(change.status==='APPLIED')agreementFact(current.versions.some((v:any)=>v.quoteId===quote.id&&v.quote.change.id===change.id),'AGREEMENT_TERMS_CHAIN_BROKEN');
  else agreementFact((change.priorTermsVersionId??null)===current.result.termsVersionId&&change.priorTermsHash===hash(current.snapshot)&&hash(change.priorTerms)===hash(current.snapshot),'AGREEMENT_PRIOR_TERMS_MISMATCH');
  return{ready:true,blockers:[],agreement:await paperAgreement(tx,order,change,quote,contract)};
 }catch(error){if(error instanceof AgreementFactError)return{ready:false,blockers:[error.code],agreement:null};throw error;}
}
export async function requireChangeAgreementReady(tx:any,changeId:string):Promise<ChangeAgreement>{const result=await readChangeAgreementReady(tx,changeId);ensure(result.ready&&result.agreement,409,result.blockers[0]??'AGREEMENT_NOT_READY','订单变更协议证据尚未完整');return result.agreement;}
/** Read-only validation of one real prepared historical node. Callers validate financial predecessor-chain acyclicity separately. */
export async function requireHistoricalPreparedQuoteAgreement(tx:any,changeId:string,quoteId:string):Promise<ChangeAgreement>{
 try{
  agreementFact(agreementId(changeId)&&agreementId(quoteId),'AGREEMENT_PREPARED_QUOTE_REQUIRED');
  const change=await tx.orderChange.findUnique({where:{id:changeId}});agreementFact(change?.id===changeId,'AGREEMENT_CHANGE_MISSING');
  const order=await tx.order.findUnique({where:{id:change.orderId}});agreementFact(order,'AGREEMENT_ORDER_MISSING');agreementFact(order.contractMode==='OFFLINE','AGREEMENT_OFFLINE_REQUIRED');
  const quote=await tx.delayQuote.findUnique({where:{id:quoteId},include:{contract:true}});agreementFact(quote?.id===quoteId,'AGREEMENT_PREPARED_QUOTE_REQUIRED');
  assertHistoricalPreparedQuote(change,quote,quote.contract,order);
  agreementFact(agreementId(change.originalArchiveVersionId),'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH');
  const current=await chain(tx,order.id,change.originalArchiveVersionId);agreementFact(change.originalContractId===current.original.id&&change.originalArchiveVersionId===current.originalVersion.id,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH');
  const priorId=change.priorTermsVersionId??null,prior=priorId===null?order.finalPlanSnapshot:current.versions.find((v:any)=>v.id===priorId)?.snapshot;
  agreementFact(agreementObject(prior)&&change.priorTermsHash===hash(prior)&&hash(change.priorTerms)===hash(prior),'AGREEMENT_PRIOR_TERMS_MISMATCH');
  return await paperAgreementEvidence(tx,order,change,quote,quote.contract);
 }catch(error){if(error instanceof AgreementFactError)ensure(false,409,error.code,'历史财务准备协议证据尚未完整');throw error;}
}
export async function readEffectiveContractChain(tx:any,orderId:string):Promise<EffectiveContractChain>{try{const order=await tx.order.findUnique({where:{id:orderId}});if(order?.contractMode==='ELECTRONIC')return await requireElectronicSwapChain(tx,order);return(await chain(tx,orderId)).result;}catch(error){if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return{ready:false,blockers:[(error.getResponse() as any)?.error?.code||'ELECTRONIC_EFFECTIVE_CHAIN_REQUIRED'],original:null,termsVersionId:null,termsHash:'',amendmentVersionIds:[]};if(error instanceof AgreementFactError)return{ready:false,blockers:[error.code],original:null,termsVersionId:null,termsHash:'',amendmentVersionIds:[]};throw error;}}
export async function requireEffectiveContractChain(tx:any,orderId:string):Promise<ReadyEffectiveContractChain>{const result=await readEffectiveContractChain(tx,orderId);ensure(result.ready&&result.original,409,result.blockers[0]??'AGREEMENT_NOT_READY','有效线下合同链尚未完整');return{...result,ready:true,original:result.original};}
