import {randomUUID} from 'node:crypto';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertNotAssetFiles} from '../files/asset-files';
import {archiveCommand} from '../offline-documents/command';
import {renewalId} from './types';
import {readRenewalCancellationFacts} from './cancellation-facts';
import {buildRenewalCancellationPaperSource,requireRenewalCancellationAgreement} from './cancellation-paper';
import {cancellationOpenInput,cancellationSignatureInput,cancellationCompleteInput,cancellationMutualInput} from './cancellation-inputs';
import {buildRenewalCancellationMutualAgreement} from './cancellation-timing';

type Facts=Awaited<ReturnType<typeof readRenewalCancellationFacts>>;
const same=(a:unknown,b:unknown)=>canonicalHash(a)===canonicalHash(b);

export async function cancellationPermission(tx:any,actor:any,action:'read'|'operations'|'finance'){
 ensure(actor&&Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED','请使用当前工作人员会话');
 const current=await requireCurrentStaff(tx,actor,'order-changes',action!=='read');
 ensure((action==='read'?['ADMIN','OPERATIONS','FINANCE']:action==='finance'?['ADMIN','FINANCE']:['ADMIN','OPERATIONS']).includes(current.role),403,'FORBIDDEN','当前岗位不能办理此取消动作');
 if(action==='finance')await requireCurrentStaff(tx,actor,'bills');return current;
}

/** Order is the first business lock. Successful writes CAS it; replays only read their stored receipt. */
export async function cancellationCommand(tx:any,actor:any,changeId:string,action:string,input:any,apply:()=>Promise<any>){
 const change=await tx.orderChange.findUnique({where:{id:renewalId.parse(changeId)}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION',404,'NOT_FOUND','续期变更不存在');
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${change.orderId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "UsageAccount" WHERE "orderId"=${change.orderId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "OrderServiceStage" WHERE "orderId"=${change.orderId} ORDER BY sequence FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "OrderChange" WHERE id=${change.id} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "DelayQuote" WHERE "changeId"=${change.id} ORDER BY id FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "OrderRenewalCancellation" WHERE "changeId"=${change.id} ORDER BY id FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "Bill" WHERE "orderId"=${change.orderId} ORDER BY id FOR UPDATE`;
 await tx.$queryRaw`SELECT p.id FROM "Payment" p JOIN "Bill" b ON b.id=p."billId" WHERE b."orderId"=${change.orderId} ORDER BY p.id FOR UPDATE OF p`;
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`renewal-cancellation:${actor.id}:${change.id}:${action}:${input.idempotencyKey}`},0))`;
 return archiveCommand(tx,actor,`renewal-cancellation:${change.id}`,action,input,apply);
}

async function currentCase(tx:any,facts:Facts){return tx.orderRenewalCancellation.findUnique({where:{quoteId:facts.quote.id}});}
export function assertCancellationSource(record:any,facts:Facts){
 ensure(record&&record.orderId===facts.order.id&&record.customerId===facts.order.customerId&&record.changeId===facts.change.id&&record.quoteId===facts.quote.id&&record.ownerId===facts.ownerId&&(record.serviceStageId??null)===(facts.stage?.id??null),409,'RENEWAL_CANCELLATION_SOURCE','取消案与真实续期来源不一致');
 ensure(record.sourceSnapshot?.version===1&&record.sourceSnapshot.facts?.version===1&&same(record.sourceSnapshot.facts.frozenQuoteSource,facts.sourceSnapshot.frozenQuoteSource)&&canonicalHash(record.sourceSnapshot)===record.sourceHash,409,'RENEWAL_CANCELLATION_SOURCE','取消案冻结来源已变化，请核对原记录');
}
function previewHash(facts:Facts,record:any){return canonicalHash({version:1,factsHash:facts.sourceHash,cancellation:record?{id:record.id,revision:record.revision,status:record.status,sourceHash:record.sourceHash,signatureState:record.signatureState,signatureVerifiedBy:record.signatureVerifiedBy??null,signatureVerifiedAt:record.signatureVerifiedAt??null,signatureEvidenceFileIds:record.signatureEvidenceFileIds,signatureNote:record.signatureNote??null,terminationArchiveId:record.terminationArchiveId??null,approvedArchiveVersionId:record.approvedArchiveVersionId??null,terminationArchiveHash:record.terminationArchiveHash??null}:null});}
export async function cancellationState(tx:any,changeId:string,now:Date,timingPurpose?:'PREVIEW'|'RECORD_MUTUAL_AGREEMENT'){const facts=await readRenewalCancellationFacts(tx,{changeId,...(timingPurpose?{timingPurpose}:{})},now),record=await currentCase(tx,facts);if(record)assertCancellationSource(record,facts);return{facts,record,previewHash:previewHash(facts,record)};}
export function assertCancellationInput(state:Awaited<ReturnType<typeof cancellationState>>,input:any,existing=true){
 const{facts,record}=state;ensure(facts.change.revision===input.revision&&facts.order.revision===input.orderRevision,409,'VERSION_CONFLICT','续期或订单版本已变化，请刷新');
 if(existing)ensure(record?.id===input.cancellationId&&record.revision===input.cancellationRevision&&record.status==='OPEN',409,'VERSION_CONFLICT','取消案已变化或已完成');
 ensure(state.previewHash===input.previewHash,409,'PREVIEW_CHANGED','取消签署或收退款事实已变化，请重新核对');
}
export async function bumpCancellationSource(tx:any,facts:Facts){
 ensure((await tx.orderChange.updateMany({where:{id:facts.change.id,revision:facts.change.revision},data:{revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','续期已变化');
 ensure((await tx.order.updateMany({where:{id:facts.order.id,revision:facts.order.revision},data:{revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','订单已变化');
}
export async function cancellationEvidence(tx:any,ids:string[],newOwner?:{actorId:string;fileIds:string[]}){
 await assertNotAssetFiles(tx,ids);const files=await tx.storedFile.findMany({where:{id:{in:ids}}});
 ensure(files.length===ids.length&&files.every((f:any)=>ids.includes(f.id)&&f.adminId&&!f.customerId&&!f.fieldTaskId&&f.purpose==='evidence'&&['application/pdf','image/jpeg','image/png'].includes(f.mimeType)&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<=10*1024*1024&&/^[a-f0-9]{64}$/.test(f.sha256)),403,'FILE_OWNERSHIP','请上传后台实际取消核实证据');
 ensure(!newOwner||files.every((f:any)=>!newOwner.fileIds.includes(f.id)||f.adminId===newOwner.actorId),403,'FILE_OWNERSHIP','新加入的核实依据须由本次提交人员上传');
 return files.map((f:any)=>({fileId:f.id,sha256:f.sha256,size:f.size,mimeType:f.mimeType})).sort((a:any,b:any)=>a.fileId.localeCompare(b.fileId));
}
async function cancellationSignedHistory(tx:any,record:any){
 const archives=await tx.documentArchive.findMany({where:{renewalCancellationId:record.id},include:{versions:{include:{files:true}}}});
 return archives.some((a:any)=>a.versions.some((v:any)=>(v.files?.length??0)>0||['REVIEWED','ARCHIVED','INVALIDATED'].includes(v.status)));
}
export async function cancellationSignatureReady(tx:any,state:Awaited<ReturnType<typeof cancellationState>>,now=new Date()){
 const{record,facts}=state;ensure(facts.timing.mutualAgreementVerified,409,'RENEWAL_CANCELLATION_AGREEMENT_REQUIRED','请先独立核实双方真实同意取消的时间和证据');ensure(record&&['SIGNED','UNSIGNED'].includes(record.signatureState)&&record.signatureVerifiedBy&&record.signatureVerifiedAt&&record.signatureNote&&Array.isArray(record.signatureEvidenceFileIds)&&record.signatureEvidenceFileIds.length>0,409,'RENEWAL_CANCELLATION_SIGNATURE_REQUIRED','请先核实实际签署情况及双方取消证据');
 ensure(facts.signature.blockers.length===0,409,'RENEWAL_CANCELLATION_SIGNATURE_REQUIRED','历史签署记录尚未核清');
 const evidence=await cancellationEvidence(tx,record.signatureEvidenceFileIds);
 if(record.signatureState==='UNSIGNED'){ensure(facts.signature.canDeclareUnsigned&&!await cancellationSignedHistory(tx,record),409,'RENEWAL_CANCELLATION_SIGNATURE_CONFLICT','存在历史签字资料，不能声明未签');return{evidence,agreement:null};}
 return{evidence,agreement:await requireRenewalCancellationAgreement(tx,record.id,now)};
}
function cancellationReceipt(record:any,facts:Facts){return{cancellationId:record.id,cancellationRevision:record.revision,changeId:facts.change.id,revision:facts.change.revision+1,orderRevision:facts.order.revision+1,status:record.status,signatureState:record.signatureState,stageId:record.serviceStageId??null};}
async function completedCancellationView(tx:any,changeId:string,operations:boolean){
 const change=await tx.orderChange.findUnique({where:{id:renewalId.parse(changeId)}});ensure(change?.kind==='SUBSCRIPTION_EXTENSION',404,'NOT_FOUND','续期变更不存在');
 const record=await tx.orderRenewalCancellation.findUnique({where:{quoteId:change.activeQuoteId??''}});if(record?.status!=='COMPLETED')return null;
 const{order,quote,frozenQuoteSource:frozen}=await(await import('./cancellation-history')).readCompletedRenewalCancellationSource(tx,change.id);
 const period=frozen.periods;ensure(Array.isArray(period)&&period.length>0,409,'RENEWAL_CANCELLATION_SOURCE','历史取消期间缺失');
 return{changeId:change.id,revision:change.revision,orderRevision:order.revision,quoteId:quote.id,stageId:record.serviceStageId??null,cancellationId:record.id,cancellationRevision:record.revision,status:'COMPLETED',signatureState:record.signatureState,startDate:period[0].startDate,endDate:period.at(-1).endDate,completedAt:record.completedAt instanceof Date?record.completedAt.toISOString():record.completedAt,completedBy:record.completedBy,completionHash:record.completionHash,...(operations?{signatureEvidenceFileIds:record.signatureEvidenceFileIds,signatureNote:record.signatureNote}:{}),blockers:[],previewHash:null};
}
export async function readCancellationPreview(tx:any,actor:any,changeId:string,now:Date){
 const current=await cancellationPermission(tx,actor,'read'),finance=['ADMIN','FINANCE'].includes(current.role),operations=['ADMIN','OPERATIONS'].includes(current.role),completed=await completedCancellationView(tx,changeId,operations);if(completed)return completed;
 const state=await cancellationState(tx,changeId,now,'PREVIEW'),{facts,record}=state;
 return{changeId:facts.change.id,revision:facts.change.revision,orderRevision:facts.order.revision,quoteId:facts.quote.id,stageId:facts.stage?.id??null,stageRevision:facts.stage?.revision??null,startDate:facts.period.startDate,endDate:facts.period.endDate,cancellationId:record?.id??null,cancellationRevision:record?.revision??null,status:record?.status??null,signatureState:record?.signatureState??'UNKNOWN',mutualAgreementVerified:facts.timing.mutualAgreementVerified,mutuallyAgreedAt:record?.mutuallyAgreedAt?.toISOString?.()??record?.mutuallyAgreedAt??null,mutualAgreementVerifiedAt:record?.mutualAgreementVerifiedAt?.toISOString?.()??record?.mutualAgreementVerifiedAt??null,canDeclareUnsigned:facts.signature.canDeclareUnsigned,hasHistoricalSignedUpload:facts.signature.hasHistoricalSignedUpload,...(operations?{signatureEvidenceFileIds:record?.signatureEvidenceFileIds??[],signatureNote:record?.signatureNote??null,mutualAgreementEvidenceFileIds:record?.mutualAgreementEvidenceFileIds??[],mutualAgreementNote:record?.mutualAgreementNote??null}:{}),funding:{receivedAmount:facts.funding.receivedAmount,refundedAmount:facts.funding.refundedAmount,remainingRefundAmount:facts.funding.remainingRefundAmount,fundsClear:facts.funding.fundsClear,blockers:facts.funding.blockers,...(finance?{payments:facts.funding.payments.map((p:any)=>({id:p.id,billId:p.billId,status:p.status,amount:p.amount,receivedAmount:p.receivedAmount,refundedAmount:p.refundedAmount,remainingRefundAmount:p.remainingRefundAmount,reconciliationRequired:p.reconciliationRequired,blockers:p.blockers}))}:{})},blockers:[...new Set([...facts.blockers,...(record&&!facts.timing.mutualAgreementVerified?['RENEWAL_CANCELLATION_AGREEMENT_REQUIRED']:[])])],previewHash:state.previewHash};
}
export async function openRenewalCancellation(tx:any,actor:any,changeId:string,raw:unknown,now:Date){
 const input=cancellationOpenInput.parse(raw);await cancellationPermission(tx,actor,'operations');return cancellationCommand(tx,actor,changeId,'OPEN',input,async()=>{
  const state=await cancellationState(tx,changeId,now,input.mutualAgreement?'RECORD_MUTUAL_AGREEMENT':undefined);assertCancellationInput(state,input,false);ensure(!state.record,409,'RENEWAL_CANCELLATION_EXISTS','本报价已有取消案，请打开原记录');
  const facts=state.facts,paper=await buildRenewalCancellationPaperSource(tx,facts,input.reason),sourceSnapshot={version:1,facts:facts.sourceSnapshot,cancellationPaper:paper};
  const data={id:randomUUID(),orderId:facts.order.id,customerId:facts.order.customerId,ownerId:facts.ownerId,changeId:facts.change.id,quoteId:facts.quote.id,serviceStageId:facts.stage?.id??null,revision:0,status:'OPEN',sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot),reason:input.reason,signatureState:'UNKNOWN',signatureEvidenceFileIds:[],createdBy:actor.id};
  const agreement=input.mutualAgreement?await buildRenewalCancellationMutualAgreement(tx,data,{...input.mutualAgreement,startDate:facts.period.startDate},actor,now):{};
  const record=await tx.orderRenewalCancellation.create({data:{...data,...agreement}});
  await bumpCancellationSource(tx,facts);await audit(tx,actor.id,'RENEWAL_CANCELLATION_OPEN','order-changes',changeId,{cancellationId:record.id,sourceHash:record.sourceHash,reason:input.reason,mutualAgreement:agreement});return cancellationReceipt(record,facts);
 });
}
export async function confirmRenewalCancellationAgreement(tx:any,actor:any,changeId:string,raw:unknown,now:Date){
 const input=cancellationMutualInput.parse(raw);await cancellationPermission(tx,actor,'operations');return cancellationCommand(tx,actor,changeId,'CONFIRM_MUTUAL_AGREEMENT',input,async()=>{
  const state=await cancellationState(tx,changeId,now,'RECORD_MUTUAL_AGREEMENT');assertCancellationInput(state,input);const{record,facts}=state,data=await buildRenewalCancellationMutualAgreement(tx,record,{startDate:facts.period.startDate,mutuallyAgreedAt:input.mutuallyAgreedAt,evidenceFileIds:input.evidenceFileIds,note:input.note},actor,now);
  ensure((await tx.orderRenewalCancellation.updateMany({where:{id:record.id,revision:record.revision,status:'OPEN'},data:{...data,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','取消案已变化');
  await bumpCancellationSource(tx,facts);await audit(tx,actor.id,'RENEWAL_CANCELLATION_CONFIRM_MUTUAL_AGREEMENT','order-changes',changeId,{cancellationId:record.id,sourceHash:record.sourceHash,mutualAgreement:data});return cancellationReceipt({...record,revision:input.cancellationRevision+1},facts);
 });
}
export async function verifyRenewalCancellationSignature(tx:any,actor:any,changeId:string,raw:unknown,now:Date){
 const input=cancellationSignatureInput.parse(raw);await cancellationPermission(tx,actor,'operations');return cancellationCommand(tx,actor,changeId,'VERIFY_SIGNATURE',input,async()=>{
  const state=await cancellationState(tx,changeId,now);assertCancellationInput(state,input);const{record,facts}=state,beforeEvidence=[...record.signatureEvidenceFileIds],before={signatureState:record.signatureState,verifiedBy:record.signatureVerifiedBy??null,verifiedAt:record.signatureVerifiedAt??null,note:record.signatureNote??null,evidenceFileIds:beforeEvidence},added=input.evidenceFileIds.filter(id=>!beforeEvidence.includes(id)),evidence=await cancellationEvidence(tx,input.evidenceFileIds,{actorId:actor.id,fileIds:added}),afterEvidence=[...new Set([...beforeEvidence,...input.evidenceFileIds])];
  if(input.signatureState==='UNSIGNED')ensure(record.signatureState!=='SIGNED'&&facts.signature.canDeclareUnsigned&&!await cancellationSignedHistory(tx,record),409,'RENEWAL_CANCELLATION_SIGNATURE_CONFLICT','存在真实签署记录或历史签字资料，不能声明未签');
  ensure((await tx.orderRenewalCancellation.updateMany({where:{id:record.id,revision:record.revision,status:'OPEN'},data:{signatureState:input.signatureState,signatureVerifiedBy:actor.id,signatureVerifiedAt:now,signatureEvidenceFileIds:afterEvidence,signatureNote:input.note,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','取消核实已变化');
  await bumpCancellationSource(tx,facts);await audit(tx,actor.id,'RENEWAL_CANCELLATION_VERIFY_SIGNATURE','order-changes',changeId,{cancellationId:record.id,signatureState:input.signatureState,before,after:{signatureState:input.signatureState,verifiedBy:actor.id,verifiedAt:now,note:input.note,evidenceFileIds:afterEvidence},evidence,inputFileIds:input.evidenceFileIds,beforeEvidenceFileIds:beforeEvidence,afterEvidenceFileIds:afterEvidence,note:input.note,sourceHash:record.sourceHash});return cancellationReceipt({...record,revision:input.cancellationRevision+1,signatureState:input.signatureState},facts);
 });
}
export async function completeRenewalCancellation(tx:any,actor:any,changeId:string,raw:unknown,now:Date){
 const input=cancellationCompleteInput.parse(raw);await cancellationPermission(tx,actor,'operations');return cancellationCommand(tx,actor,changeId,'COMPLETE',input,async()=>{
  const state=await cancellationState(tx,changeId,now);assertCancellationInput(state,input);const{record,facts}=state,signature=await cancellationSignatureReady(tx,state,now);
  ensure(facts.funding.fundsClear&&facts.funding.remainingRefundAmount===0&&facts.funding.blockers.length===0,409,'RENEWAL_CANCELLATION_FUNDS_UNRESOLVED','新增续期收退款或核账尚未闭环');
  const pin=signature.agreement?{terminationArchiveId:signature.agreement.archiveId,approvedArchiveVersionId:signature.agreement.archiveVersionId,terminationArchiveHash:signature.agreement.terminationArchiveHash}:{};
  const completionSnapshot={version:1,sourceHash:record.sourceHash,facts:facts.sourceSnapshot,funding:facts.funding,signatureHistory:facts.signature,signature:{state:record.signatureState,verifiedBy:record.signatureVerifiedBy,verifiedAt:record.signatureVerifiedAt,note:record.signatureNote,evidence:signature.evidence},agreement:signature.agreement,reason:input.reason,completedAt:now.toISOString()};
  if(facts.stage){
   ensure((await tx.orderServiceStage.updateMany({where:{id:facts.stage.id,orderId:facts.order.id,revision:facts.stage.revision,status:{in:['PREPARED','SCHEDULED']}},data:{status:'VOIDED',voidedBy:actor.id,voidedAt:now,voidReason:input.reason,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','未来服务段已变化');
   // Paid original bills remain financial history even after their full refunds.
   await tx.bill.updateMany({where:{orderId:facts.order.id,customerId:facts.order.customerId,serviceStageId:facts.stage.id,status:{in:['DRAFT','REVIEWED','PENDING']},paidAmount:0},data:{status:'VOID'}});
   const obligations=await tx.serviceObligation.findMany({where:{orderId:facts.order.id,serviceStageId:facts.stage.id}});
   await tx.paymentAllocation.updateMany({where:{obligationId:{in:obligations.map((o:any)=>o.id)},releasedAt:null},data:{releasedAt:now}});
   await tx.serviceObligation.updateMany({where:{orderId:facts.order.id,serviceStageId:facts.stage.id},data:{active:false}});
  }
  ensure((await tx.orderRenewalCancellation.updateMany({where:{id:record.id,revision:record.revision,status:'OPEN'},data:{status:'COMPLETED',...pin,completionSnapshot,completionHash:canonicalHash(completionSnapshot),completedBy:actor.id,completedAt:now,revision:{increment:1}}})).count===1,409,'VERSION_CONFLICT','取消案已变化');
  await tx.orderChange.update({where:{id:changeId},data:{status:'CANCELLED'}});await bumpCancellationSource(tx,facts);await audit(tx,actor.id,'RENEWAL_CANCELLATION_COMPLETE','order-changes',changeId,{cancellationId:record.id,sourceHash:record.sourceHash,completionHash:canonicalHash(completionSnapshot),...pin,reason:input.reason});return cancellationReceipt({...record,status:'COMPLETED',revision:input.cancellationRevision+1},facts);
 });
}
