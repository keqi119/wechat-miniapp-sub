import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {assertRenewalAgreementQuote} from '../order-changes/renewal-agreement';
import {AgreementFactError,assertArchiveEvidence} from '../order-changes/agreement-facts';
import {validateManifest} from '../offline-documents/files';
import {archivePrintConfirmed} from '../offline-documents/archive-workflow';
import {assertNotAssetFiles} from '../files/asset-files';
import {assertRenewalCancellationTiming} from './cancellation-timing';
import {partyCheckSchema} from '../offline-documents/schemas';
import {parseStageRow} from '../order-service-stages/source';
import type {RenewalCancellationFacts} from './cancellation-types';

const same=(a:any,b:any)=>a!==undefined&&b!==undefined&&canonicalHash(a)===canonicalHash(b);
const text=(v:any)=>typeof v==='string'&&!!v.trim()&&!v.includes('\0');
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function fact(v:unknown,message='续期取消纸档冻结来源不一致'):asserts v{ensure(v,409,'RENEWAL_CANCELLATION_PAPER_SOURCE',message);}
export type RenewalCancellationPaperSource={version:1;identity:{orderId:string;customerId:string;ownerId:string;changeId:string;quoteId:string;quoteRevision:number;stageId:string|null};original:{contractId:string;archiveId:string;archiveVersionId:string;fileManifestHash:string;contractNumber:string};renewal:{contractId:string;commercialHash:string;documentId:string;templateVersion:number;templateHash:string;bodyHash:string;startDate:string;endDate:string;months:number;monthlyFeeAmount:number;totalAmount:number;depositAmount:number;periods:any[];vehicleIdentity:string};parties:Array<{role:string;partyId:string;name:string}>;quoteSourceHash:string;reason:string;policy:'FULL_NEW_RENEWAL_RECEIPTS_NO_FEE'};

/** Only immutable quote evidence and the exact historical original pin are read here. */
async function buildPaper(tx:any,frozen:any,stageId:string|null,stageSnapshotHash:string|null,reason:string):Promise<RenewalCancellationPaperSource>{
 fact(frozen&&text(frozen.orderId)&&text(frozen.changeId)&&text(frozen.quoteId)&&text(reason)&&reason.length<=2000);
 const [order,change,q]=await Promise.all([tx.order.findUnique({where:{id:frozen.orderId}}),tx.orderChange.findUnique({where:{id:frozen.changeId}}),tx.delayQuote.findUnique({where:{id:frozen.quoteId},include:{contract:true}})]);
 fact(order&&change&&q&&q.changeId===change.id&&change.kind==='SUBSCRIPTION_EXTENSION'&&q.status==='CONFIRMED');
 const s=assertRenewalAgreementQuote(change,q,q.contract,order),original={contractId:change.originalContractId,archiveVersionId:change.originalArchiveVersionId,archiveHash:s.source.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash};
 const actual={orderId:order.id,customerId:order.customerId,changeId:change.id,quoteId:q.id,quoteRevision:q.revision,commercialHash:q.commercialHash,confirmedAt:new Date(q.confirmedAt).toISOString(),contractId:q.contract.id,original,document:s.document,source:s.source,sourceHash:s.sourceHash,periods:s.periods,renewalTerms:s.renewalTerms,usagePricing:s.usagePricing,swapPolicy:s.swapPolicy,customerAcceptance:s.customerAcceptance};
 fact(same(frozen,actual));
 const contract=await tx.contract.findUnique({where:{id:original.contractId}});
 fact(contract&&contract.orderId===order.id&&contract.customerId===order.customerId&&['RENTAL','SUBSCRIPTION'].includes(contract.kind)&&contract.executionMode==='OFFLINE'&&text(contract.offlineArchiveId));
 const archive=await tx.documentArchive.findUnique({where:{id:contract.offlineArchiveId},include:{versions:{include:{files:{include:{file:true}},feedback:true}}}}),v=archive?.versions?.find((v:any)=>v.id===original.archiveVersionId);
 const parties=order.finalPlanSnapshot?.partiesSnapshot,roles=['CUSTOMER','OWNER','PLATFORM'];
 fact(Array.isArray(parties)&&parties.length===3&&roles.every(role=>parties.filter((p:any)=>p?.role===role&&text(p.partyId)&&text(p.name)).length===1));
 fact(parties.find((p:any)=>p.role==='CUSTOMER').partyId===order.customerId&&parties.find((p:any)=>p.role==='OWNER').partyId===s.source.ownerId);
 fact(archive&&archive.kind==='RENTAL'&&archive.subjectType==='ORDER'&&archive.subjectId===order.id&&archive.orderId===order.id&&archive.ownerId===s.source.ownerId&&!archive.quoteId&&!archive.handoverId&&!archive.renewalCancellationId);
 fact(v&&v.archiveId===archive.id&&['ARCHIVED','INVALIDATED'].includes(v.status)&&v.businessSnapshotHash===order.finalPlanSnapshot.commercialHash&&v.fileManifestHash===original.archiveHash&&digest(v.fileManifestHash)&&text(v.contractNumber));
 fact(Array.isArray(v.partiesSnapshot)&&v.partiesSnapshot.length===3&&roles.every(role=>v.partiesSnapshot.filter((p:any)=>p.role===role&&p.partyId===parties.find((p:any)=>p.role===role).partyId).length===1));
 fact(Array.isArray(v.files)&&v.files.every((b:any)=>b.versionId===v.id&&b.fileId===b.file?.id)&&validateManifest(v.files)===v.fileManifestHash);
 await assertNotAssetFiles(tx,[v.sourceFileId,...v.files.map((b:any)=>b.fileId)].filter(Boolean));
 if(stageId!==null){const stage=await tx.orderServiceStage.findUnique({where:{id:stageId}});fact(stage&&stage.id===s.renewalTerms.serviceStageId&&stage.orderId===order.id&&stage.customerId===order.customerId&&stage.ownerId===s.source.ownerId&&stage.changeId===change.id&&stage.quoteId===q.id&&stage.kind==='RENEWAL'&&digest(stageSnapshotHash)&&stage.snapshotHash===stageSnapshotHash);const parsed=parseStageRow(stage,order);fact(same(parsed.snapshot.termsSnapshot,s.renewalTerms)&&same(parsed.snapshot.billingSchedule,s.periods)&&parsed.snapshot.source.agreement.commercialHash===q.commercialHash&&parsed.snapshot.source.agreement.quoteRevision===q.revision);}
 else fact(stageSnapshotHash===null);
 const vehicleIdentity=s.renewalTerms.commercialTerms?.vehicleIdentification;fact(text(vehicleIdentity));
 return{version:1,identity:{orderId:order.id,customerId:order.customerId,ownerId:s.source.ownerId,changeId:change.id,quoteId:q.id,quoteRevision:q.revision,stageId},original:{contractId:contract.id,archiveId:archive.id,archiveVersionId:v.id,fileManifestHash:v.fileManifestHash,contractNumber:v.contractNumber},renewal:{contractId:q.contract.id,commercialHash:q.commercialHash,documentId:s.document.id,templateVersion:s.document.version,templateHash:s.document.templateHash,bodyHash:s.document.bodyHash,startDate:s.startDate,endDate:s.endDate,months:s.months,monthlyFeeAmount:s.monthlyFeeAmount,totalAmount:s.totalAmount,depositAmount:s.depositAmount,periods:structuredClone(s.periods),vehicleIdentity},parties:roles.map(role=>{const p=parties.find((p:any)=>p.role===role);return{role,partyId:p.partyId,name:p.name};}),quoteSourceHash:canonicalHash(actual),reason,policy:'FULL_NEW_RENEWAL_RECEIPTS_NO_FEE'};
}

export async function buildRenewalCancellationPaperSource(tx:any,facts:RenewalCancellationFacts,reason:string){
 fact(facts?.version===1&&canonicalHash(facts.sourceSnapshot)===facts.sourceHash);
 const paper=await buildPaper(tx,facts.sourceSnapshot.frozenQuoteSource,facts.stage?.id??null,facts.stage?.snapshotHash??null,reason);
 fact(paper.identity.orderId===facts.order.id&&paper.identity.customerId===facts.order.customerId&&paper.identity.changeId===facts.change.id&&paper.identity.quoteId===facts.quote.id&&paper.identity.ownerId===facts.ownerId&&paper.renewal.startDate===facts.period.startDate&&paper.renewal.endDate===facts.period.endDate);
 return paper;
}

/** Historical reads do not use current terms, current catalog, or a live finance readiness gate. */
export async function readRenewalCancellationPaper(tx:any,cancellationId:string){
 const c=await tx.orderRenewalCancellation.findUnique({where:{id:cancellationId}});ensure(c,404,'NOT_FOUND','续期取消事项不存在');
 const source=c.sourceSnapshot;fact(source?.version===1&&source.facts?.version===1&&digest(c.sourceHash)&&canonicalHash(source)===c.sourceHash&&['OPEN','COMPLETED'].includes(c.status));
 fact((source.facts.observed?.stage?.id??null)===(c.serviceStageId??null));
 const paper=await buildPaper(tx,source.facts.frozenQuoteSource,c.serviceStageId??null,source.facts.observed?.stage?.snapshotHash??null,c.reason);
 fact(same(source.cancellationPaper,paper)&&c.orderId===paper.identity.orderId&&c.customerId===paper.identity.customerId&&c.ownerId===paper.identity.ownerId&&c.changeId===paper.identity.changeId&&c.quoteId===paper.identity.quoteId);
 return{c,paper};
}

/** Centralized current-generation boundary. An opening timestamp is not proof of mutual cancellation. */
export async function requireCancellationPaperCurrent(tx:any,c:any,paper:RenewalCancellationPaperSource,now=new Date()){
 ensure(c.status==='OPEN'&&c.signatureState==='SIGNED'&&text(c.signatureVerifiedBy)&&c.signatureVerifiedAt&&Array.isArray(c.signatureEvidenceFileIds)&&c.signatureEvidenceFileIds.length>0,409,'RENEWAL_CANCELLATION_PAPER_STATE','仅已核实签署、尚未完成的续期取消可办理纸档');
 await assertRenewalCancellationTiming(tx,c,paper.renewal.startDate,now);
 const change=await tx.orderChange.findUnique({where:{id:c.changeId}}),stages=await tx.orderServiceStage.findMany({where:{OR:[{changeId:c.changeId},{quoteId:c.quoteId}]}});
 ensure(change&&change.orderId===c.orderId&&change.customerId===c.customerId&&change.activeQuoteId===c.quoteId&&['AWAITING_ARCHIVE','AWAITING_FINANCE','SCHEDULED'].includes(change.status)&&stages.length===(c.serviceStageId?1:0)&&stages.every((s:any)=>s.id===c.serviceStageId&&s.orderId===c.orderId&&s.customerId===c.customerId&&s.ownerId===c.ownerId&&s.changeId===c.changeId&&s.quoteId===c.quoteId&&['PREPARED','SCHEDULED'].includes(s.status)),409,'RENEWAL_CANCELLATION_PAPER_STATE','续期已生效或取消事项关联的当前报价和服务段已变化');
}

export const cancellationScope=(c:any,paper:RenewalCancellationPaperSource)=>({policy:'OFFLINE_RENEWAL_CANCELLATION_V1',cancellationId:c.id,orderId:c.orderId,customerId:c.customerId,ownerId:c.ownerId,changeId:c.changeId,quoteId:c.quoteId,serviceStageId:c.serviceStageId??null,sourceHash:c.sourceHash,paperHash:canonicalHash(paper)});

export async function requireRenewalCancellationAgreement(tx:any,cancellationId:string,now=new Date()){
 const{c,paper}=await readRenewalCancellationPaper(tx,cancellationId);
 if(c.status==='OPEN')await requireCancellationPaperCurrent(tx,c,paper,now);
 else fact(c.signatureState==='SIGNED'&&text(c.terminationArchiveId)&&text(c.approvedArchiveVersionId)&&digest(c.terminationArchiveHash));
 const a=await tx.documentArchive.findUnique({where:{renewalCancellationId:c.id},include:{versions:{include:{files:{include:{file:true}},feedback:true}}}});
 fact(a&&a.kind==='RENEWAL_CANCELLATION'&&a.subjectType==='ORDER_RENEWAL_CANCELLATION'&&a.subjectId===c.id&&a.renewalCancellationId===c.id&&a.orderId===c.orderId&&a.ownerId===c.ownerId&&!a.quoteId&&!a.handoverId);
 const versionId=c.status==='COMPLETED'?c.approvedArchiveVersionId:a.currentApprovedVersionId,v=a.versions?.find((v:any)=>v.id===versionId);
 fact(v&&a.currentApprovedVersionId===v.id);const scope=v.scopeSnapshot;
 fact(scope&&same(scope.source,cancellationScope(c,paper))&&scope.document?.templateId===v.templateId&&scope.document?.templateVersion===v.templateVersion&&digest(scope.document?.templateHash)&&text(scope.document?.content)&&scope.document?.bodyHash===hash(scope.document.content));
 const template=await tx.legalDocument.findUnique({where:{id:v.templateId}});
 fact(template&&template.type==='OFFLINE_RENEWAL_CANCELLATION'&&['PUBLISHED','RETIRED'].includes(template.status)&&template.confirmedBy&&template.confirmedAt&&template.version===v.templateVersion&&hash(template.content)===scope.document.templateHash);
 fact(renderRenewalCancellationBody(template.content,paper)===scope.document.content);
 fact(Array.isArray(v.partyChecks)&&v.partyChecks.every((p:any)=>partyCheckSchema.safeParse(p).success),'取消签字资料须保留各方签字人及签署日期');
 try{assertArchiveEvidence(a,v,c.sourceHash,paper.parties,scope);}catch(e){if(e instanceof AgreementFactError)ensure(false,409,'RENEWAL_CANCELLATION_AGREEMENT',e.code);throw e;}
 const file=await tx.storedFile.findUnique({where:{id:v.sourceFileId}});
 fact(file&&file.purpose==='offline-source'&&file.mimeType==='application/pdf'&&Number.isSafeInteger(file.size)&&file.size>0&&digest(file.sha256));
 await assertNotAssetFiles(tx,[v.sourceFileId,...v.files.map((f:any)=>f.fileId)]);
 fact(await archivePrintConfirmed(tx,a,v),'取消纸档缺少对应打印版本确认');
 const result={archiveId:a.id,archiveVersionId:v.id,fileManifestHash:v.fileManifestHash,businessHash:c.sourceHash,scopeHash:canonicalHash(scope),terminationArchiveHash:canonicalHash({archiveId:a.id,archiveVersionId:v.id,fileManifestHash:v.fileManifestHash,businessHash:c.sourceHash,scopeHash:canonicalHash(scope)})};
 if(c.status==='COMPLETED')fact(c.terminationArchiveId===result.archiveId&&c.approvedArchiveVersionId===result.archiveVersionId&&c.terminationArchiveHash===result.terminationArchiveHash);
 return result;
}

/** Required factual groups prevent an unrelated legal template from producing an apparently ready paper. */
export function renderRenewalCancellationBody(content:string,paper:RenewalCancellationPaperSource){
 let body=content;try{const parsed=JSON.parse(content);if(parsed&&typeof parsed.body==='string')body=parsed.body;}catch{}
 ensure(['cancellationFacts','refundPolicy'].every(key=>body.includes(`{{${key}}}`)),409,'CANCELLATION_TEMPLATE_INCOMPLETE','取消协议须包含取消事项及全额退费规则');
 const r=paper.renewal,p=paper.identity,money=(n:number)=>(n/100).toFixed(2)+'元';
 const variables:Record<string,string>={customerName:paper.parties.find(p=>p.role==='CUSTOMER')!.name,ownerName:paper.parties.find(p=>p.role==='OWNER')!.name,platformName:paper.parties.find(p=>p.role==='PLATFORM')!.name,originalContractNumber:paper.original.contractNumber,cancellationReason:paper.reason,cancellationFacts:`原纸质合同编号：${paper.original.contractNumber}；本次取消的续期报价标识：${p.quoteId}（第${p.quoteRevision}版，正文校验值${r.bodyHash}），续期安排为${r.startDate}起至${r.endDate}止（结束日不含），共${r.months}个月，车辆：${r.vehicleIdentity}，月费${money(r.monthlyFeeAmount)}，续期总额${money(r.totalAmount)}。取消原因：${paper.reason}。`,refundPolicy:`取消仅针对本次尚未开始的续期。该续期新增实际收款全部原路退回，不收取取消费；晚到的真实实收仍须核对并全额退款，未完成退款不得视为财务完成。原押金${money(r.depositAmount)}、原服务期与实际车辆交还事实保持不变。本协议不代替退款到账凭证。`};
 body=body.replace(/\{\{(\w+)\}\}/g,(match,key)=>variables[key]??match);
 ensure(body.trim()&&!body.includes('\0')&&!/\{\{|\}\}/.test(body),409,'CANCELLATION_TEMPLATE_INCOMPLETE','取消模板存在未支持或未填充的内容');return body;
}
