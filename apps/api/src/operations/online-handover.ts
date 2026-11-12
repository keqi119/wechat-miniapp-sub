import {canonicalHash} from '../customers/types';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {projectRoot} from '../common/config';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentQualification} from '../customers/qualifications';
import {assertNotAssetFiles} from '../files/asset-files';

export const isOnlineHandover=(h:any)=>h?.confirmationMode==='ONLINE_RECORD';
const scalars=(value:any,keys:string[]):Record<string,any>=>Object.fromEntries(keys.filter(k=>value?.[k]===null||['string','number','boolean'].includes(typeof value?.[k])||value?.[k] instanceof Date).map(k=>[k,value[k]]));
const ids=(value:any)=>Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
const checklist=(value:any)=>Array.isArray(value)?value.map(v=>scalars(v,['label','value'])):[];
/** Only names and stable party IDs identify the lessor here; contract/account data stays private. */
function lessorIdentity(value:any){return scalars({id:value?.ownerId??value?.partyId??value?.id,type:value?.ownerType??value?.type,name:value?.name},['id','type','name']);}
export function publicOnlineRecord(s:any){
 if(!s||typeof s!=='object')return null;
 return{...scalars(s,['documentId','termsVersion','termsTitle','termsContent','termsHash','publishedAt']),facts:{...scalars(s.facts,['handoverId','orderId','customerId','type','vehicleId','assignmentId','changeId','revision','actualAt','readingKm']),fileIds:ids(s.facts?.fileIds),checklist:checklist(s.facts?.checklist)},evidence:Array.isArray(s.evidence)?s.evidence.map((e:any)=>scalars(e,['fileId','sha256','size'])):[],parties:{...scalars(s.parties,['customerId','customerName','vehicleId','vehicleTitle','plateNumber']),lessor:lessorIdentity(s.parties?.lessor??s.parties?.lessorSnapshot)}};
}
export function publicOnlineConfirmation(c:any){return c&&typeof c==='object'?{...scalars(c,['customerId','handoverId','revision','manifestHash','documentId','termsVersion','termsHash','termsAccepted','confirmedAt','respondedAt','decision']),readFileIds:ids(c.readFileIds)}:null;}
/** Used by GET, responses and idempotent replay; never spread a database row into a customer DTO. */
export function customerHandoverDTO(h:any){return{...scalars(h,['id','orderId','customerId','vehicleId','assignmentId','changeId','type','executionMode','confirmationMode','status','readingKm','actualAt','manifestHash','revision','previousHandoverId','resolutionNote','customerResponse','responseReason','confirmedAt','signatureStatus','signedFileId','offlineArchiveId','completedAt','createdAt']),executionMode:typeof h.executionMode==='string'?h.executionMode:undefined,fileIds:ids(h.fileIds),responseFileIds:ids(h.responseFileIds),checklist:checklist(h.checklist),onlineRecord:publicOnlineRecord(h.onlineRecordSnapshot),onlineConfirmation:publicOnlineConfirmation(h.onlineConfirmation)};}
export function onlineRecordFacts(h:any){return{handoverId:h.id,orderId:h.orderId,customerId:h.customerId,type:h.type,vehicleId:h.vehicleId,assignmentId:['DELIVERY','SWAP_DELIVERY'].includes(h.type)?null:h.assignmentId??null,changeId:h.changeId??null,revision:h.revision??1,actualAt:h.actualAt?new Date(h.actualAt).toISOString():null,readingKm:h.readingKm,fileIds:h.fileIds,checklist:h.checklist};}
export async function requireOnlineTerms(tx:any){
 const d=await tx.legalDocument.findFirst({where:{type:'ONLINE_HANDOVER_TERMS',status:'PUBLISHED',publishedAt:{lte:new Date()}},orderBy:{version:'desc'}});
 ensure(d?.confirmedBy&&d.confirmedAt&&d.title?.trim()&&d.content?.trim(),409,'ONLINE_HANDOVER_TERMS_REQUIRED','线上交接约定尚未批准发布，请联系运营；不能跳过约定确认');
 return{documentId:d.id,termsVersion:String(d.version),termsTitle:d.title,termsContent:d.content,termsHash:hash(d.content)};
}
export async function newHandoverMode(tx:any,executionMode:string){if(!['OFFLINE','ELECTRONIC'].includes(executionMode))return{};await requireOnlineTerms(tx);return{confirmationMode:'ONLINE_RECORD'};}
export function assertOnlineRecord(h:any){
 const s=h.onlineRecordSnapshot;
 ensure(isOnlineHandover(h)&&s?.documentId&&typeof s.termsVersion==='string'&&s.termsTitle?.trim()&&s.termsContent?.trim()&&s.termsHash===hash(s.termsContent)&&h.manifestHash===canonicalHash(s)&&canonicalHash(s.facts)===canonicalHash(onlineRecordFacts(h))&&Array.isArray(s.evidence)&&s.evidence.length===h.fileIds.length&&s.evidence.length>0&&s.evidence.every((e:any,i:number)=>e.fileId===h.fileIds[i]&&/^[a-f0-9]{64}$/.test(e.sha256)&&Number.isSafeInteger(e.size)&&e.size>0),409,'ONLINE_RECORD_CHANGED','线上交接证据或约定与当前版本不一致，请重新发布并确认');
 return s;
}
export async function readEvidenceBytes(file:any){
 const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
 ensure(typeof file.storagePath==='string'&&resolve(file.storagePath).startsWith(root+sep),409,'HANDOVER_EVIDENCE_CHANGED','交接证据存储路径不可用');
 let bytes:Buffer;try{bytes=await fs.readFile(file.storagePath);}catch{ensure(false,409,'HANDOVER_EVIDENCE_UNAVAILABLE','交接证据暂不可读取，请联系运营');}
 ensure(bytes!.length===file.size&&createHash('sha256').update(bytes!).digest('hex')===file.sha256,409,'HANDOVER_EVIDENCE_CHANGED','交接证据内容已变化，请重新核对版本');return bytes!;
}
export async function requireOnlineEvidence(tx:any,h:any){
 const s=assertOnlineRecord(h);await assertNotAssetFiles(tx,h.fileIds);
 const files=await tx.storedFile.findMany({where:{id:{in:h.fileIds}}});
 ensure(files.length===s.evidence.length,409,'HANDOVER_EVIDENCE_UNAVAILABLE','交接证据不完整');
 for(const e of s.evidence){const f=files.find((f:any)=>f.id===e.fileId);ensure(f&&f.sha256===e.sha256&&f.size===e.size&&(f.customerId===h.customerId||!f.customerId&&f.adminId),409,'HANDOVER_EVIDENCE_CHANGED','证据归属或摘要已变化');await readEvidenceBytes(f);}
 return s;
}
export async function freezeOnlineRecord(tx:any,h:any,actorId:string){
 const terms=await requireOnlineTerms(tx),qualification=await requireCurrentQualification(tx,h.customerId),customer=await tx.customer.findUniqueOrThrow({where:{id:h.customerId}}),vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:h.vehicleId}}),order=await tx.order.findUniqueOrThrow({where:{id:h.orderId}});
 const currentTerms=order.effectiveTermsVersionId?await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}}):null;
 const orderSnapshot=currentTerms?.snapshot||order.finalPlanSnapshot;
 let quote:any=null;if(h.changeId){const change=await tx.orderChange.findUniqueOrThrow({where:{id:h.changeId}});quote=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}});}
 ensure(h.fileIds.length>0&&new Set(h.fileIds).size===h.fileIds.length&&h.actualAt&&new Date(h.actualAt)<=new Date(Date.now()+300000)&&Number.isSafeInteger(h.readingKm)&&Array.isArray(h.checklist)&&h.checklist.length>0,409,'ONLINE_EVIDENCE_REQUIRED','请完整采集本版本实际时间、里程、检查清单及现场证据');
 const files=await tx.storedFile.findMany({where:{id:{in:h.fileIds}}}),evidence=[];
 ensure(files.length===h.fileIds.length,409,'ONLINE_EVIDENCE_REQUIRED','现场证据不完整');
 for(const id of h.fileIds){const f=files.find((f:any)=>f.id===id);ensure(f&&(f.customerId===h.customerId||!f.customerId&&f.adminId)&&['image/jpeg','image/png','application/pdf'].includes(f.mimeType),403,'FILE_OWNERSHIP','交接证据归属无效');await readEvidenceBytes(f);evidence.push({fileId:f.id,sha256:f.sha256,size:f.size});}
 const snapshot={...terms,facts:onlineRecordFacts(h),evidence,parties:{customerId:customer.id,customerName:customer.name,vehicleId:vehicle.id,vehicleTitle:vehicle.title,plateNumber:vehicle.plateNumber,lessor:lessorIdentity(h.type==='SWAP_DELIVERY'?quote?.snapshot?.targetLessorSnapshot:orderSnapshot?.lessorSnapshot)},source:{orderSnapshotHash:canonicalHash(orderSnapshot),termsVersionId:currentTerms?.id||null,termsVersion:currentTerms?.version||null,quoteId:quote?.id||null,quoteRevision:quote?.revision||null,quoteSnapshotHash:quote?canonicalHash(quote.snapshot):null,qualificationId:qualification.id,qualificationRevision:qualification.revision,commercialHash:quote?.commercialHash||null,agreementArchiveVersionId:quote?.approvedArchiveVersionId||null},sourceHash:h.manifestHash,publishedBy:actorId,publishedAt:new Date().toISOString()};
 return{onlineRecordSnapshot:snapshot,manifestHash:canonicalHash(snapshot)};
}
export function onlineConfirmationData(h:any,input:any,customerId:string){
 const s=assertOnlineRecord(h);ensure(h.customerId===customerId,404,'NOT_FOUND','交接记录不存在');
 ensure(input.revision===h.revision&&input.manifestHash===h.manifestHash,409,'MANIFEST_CONFLICT','交接版本已变化，请重新读取');
 ensure(input.termsAccepted===true&&input.documentId===s.documentId&&input.termsVersion===s.termsVersion&&input.termsHash===s.termsHash,409,'ONLINE_TERMS_CONFIRMATION_REQUIRED','请更新小程序并阅读确认当前版本线上交接约定');
 ensure(Array.isArray(input.readFileIds)&&input.readFileIds.length===h.fileIds.length&&new Set(input.readFileIds).size===h.fileIds.length&&h.fileIds.every((id:string)=>input.readFileIds.includes(id)),400,'EVIDENCE_UNREAD','请打开本版本全部交接证据');
 return{customerId,handoverId:h.id,revision:h.revision,manifestHash:h.manifestHash,documentId:s.documentId,termsVersion:s.termsVersion,termsHash:s.termsHash,termsAccepted:true,readFileIds:input.readFileIds,requestHash:hash(input),confirmedAt:new Date().toISOString()};
}
export async function requireEvidenceOpened(tx:any,h:any,customerId:string){
 const rows=await tx.auditLog.findMany({where:{actorId:customerId,actorType:'CUSTOMER',action:'OPEN_HANDOVER_EVIDENCE',resourceType:'handovers',resourceId:h.id},select:{data:true}});
 ensure(h.fileIds.every((id:string)=>rows.some((r:any)=>r.data?.fileId===id&&r.data.manifestHash===h.manifestHash&&r.data.revision===h.revision)),400,'EVIDENCE_UNREAD','请先打开当前版本的全部交接附件');
}
export async function recordOnlineEvidenceOpened(tx:any,file:any,customerId:string){
 const rows=await tx.handover.findMany({where:{customerId,confirmationMode:'ONLINE_RECORD',status:{in:['PUBLISHED','CUSTOMER_CONFIRMED','COMPLETED','OBJECTION_SUBMITTED','SUPERSEDED']},fileIds:{has:file.id}}});
 if(!rows.length)return null;const bytes=await readEvidenceBytes(file);
 for(const h of rows){const s=assertOnlineRecord(h),e=s.evidence.find((e:any)=>e.fileId===file.id);ensure(e?.sha256===file.sha256&&e.size===file.size,409,'HANDOVER_EVIDENCE_CHANGED','当前证据与发布版本不一致');await audit(tx,customerId,'OPEN_HANDOVER_EVIDENCE','handovers',h.id,{manifestHash:h.manifestHash,revision:h.revision,fileId:file.id,sha256:file.sha256},'CUSTOMER');}return bytes;
}
export async function requireOnlineConfirmation(tx:any,h:any){
 const s=await requireOnlineEvidence(tx,h),c=h.onlineConfirmation;
 ensure(c?.customerId===h.customerId&&c.handoverId===h.id&&c.revision===h.revision&&c.manifestHash===h.manifestHash&&c.documentId===s.documentId&&c.termsVersion===s.termsVersion&&c.termsHash===s.termsHash&&c.termsAccepted===true&&h.customerResponse==='CONFIRM'&&h.confirmedAt,409,'ONLINE_CONFIRMATION_REQUIRED','须由本人确认当前版本证据与线上交接约定');
 if(h.status!=='COMPLETED')await requireCurrentQualification(tx,h.customerId);return{ready:true,blockers:[]};
}
export async function archiveOnlineCompletion(tx:any,h:any,actorId:string,completedAt:Date){if(isOnlineHandover(h))await audit(tx,actorId,'ONLINE_HANDOVER_RECORDED','handovers',h.id,{manifestHash:h.manifestHash,revision:h.revision,onlineRecord:h.onlineRecordSnapshot,onlineConfirmation:h.onlineConfirmation,completedAt:completedAt.toISOString()});}
export function onlineHandoverReadiness(h:any,customerId:string){
 const base={version:3,executionMode:h.executionMode,confirmationMode:'ONLINE_RECORD',handoverId:h.id,manifestHash:h.manifestHash,revision:h.revision,canSign:false};
 try{
  const s=assertOnlineRecord(h);ensure(h.customerId===customerId,404);const terms={documentId:s.documentId,termsVersion:s.termsVersion,termsHash:s.termsHash};
  if(h.status==='SUPERSEDED')return{...base,...terms,stage:'SUPERSEDED',message:'本版已被替代，请查看当前版本；历史证据保留。'};
  if(h.status==='OBJECTION_SUBMITTED')return{...base,...terms,stage:'OBJECTION_SUBMITTED',message:'本版已提交异议，请等待核实并发布新版本。'};
  if(h.status==='PUBLISHED')return{...base,...terms,stage:'FACTS_PENDING',message:'请打开本版全部证据，阅读线上交接约定后确认或提出异议。'};
  const c=h.onlineConfirmation;ensure(['CUSTOMER_CONFIRMED','COMPLETED'].includes(h.status)&&h.customerResponse==='CONFIRM'&&h.confirmedAt&&c?.customerId===customerId&&c.handoverId===h.id&&c.revision===h.revision&&c.manifestHash===h.manifestHash&&c.documentId===s.documentId&&c.termsVersion===s.termsVersion&&c.termsHash===s.termsHash&&c.termsAccepted===true,409);
  if(h.status==='COMPLETED'){ensure(h.completedAt,409);return{...base,...terms,stage:'RECORDED',message:'本版线上交接已完成并留存，确认及证据只读可查。'};}
  return{...base,...terms,stage:'WAITING_COMPLETION',message:'您已确认当前版本，等待后台核对并完成实际交接。'};
 }catch{return{...base,stage:'BLOCKED',message:'当前线上交接版本或确认资料不完整，请联系运营。'};}
}
