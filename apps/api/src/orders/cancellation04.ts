import {HttpException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {archiveCommand} from '../offline-documents/command';
import {assertElectronicTaskSnapshot} from '../electronic-documents/repository';
import {hasActualSigningEvidence} from '../electronic-documents/signing-evidence';
import {loadElectronicArchiveProof} from '../electronic-documents/archive';
import {approvedElectronicBody} from '../electronic-documents/print';
import {cancellation04Source,cancellation04Money,cancellation04Execution,historicalCancellation04Source,lockCancellation04,evidence04,verifyEvidence04,assertNeverDelivered04} from './cancellation04-source';

const id=z.string().min(1).max(200),note=z.string().trim().min(1).max(2000),files=z.array(id).min(1).max(20).refine(v=>new Set(v).size===v.length),instant=z.string().datetime({offset:true});
const command={revision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(128)};
const intention=z.object({subjectId:id,personName:note,personReference:note,intention:note,occurredAt:instant,fileIds:files,authorityFrom:instant.optional(),authorityUntil:instant.optional(),authorityScope:note.optional(),authorityFileIds:files.optional()}).strict();
const cost=z.object({kind:z.enum(['PERFORMED_INDEPENDENT_SERVICE','PROVEN_NECESSARY_LOSS']),amount:z.number().int().positive().safe(),paymentId:id,creditorOwnerId:id,description:note,agreement:note,responsibility:note,performedAt:instant,evidenceFileIds:files}).strict();
const proposalSchema=z.object({...command,sourceHash:z.string(),reason:note,responsibility:z.enum(['CUSTOMER','OWNER','PLATFORM','MIXED','NO_FAULT']),neverDeliveredEvidenceFileIds:files,costs:z.array(cost).max(20),earlierAgreement:z.object({customer:intention,owner:intention,platform:intention,amountConfirmedAt:instant,confirmedNetRefundAmount:z.number().int().nonnegative().safe(),terms:note}).strict().optional()}).strict();

async function staff04(tx:any,actor:any,write=true){const staff=await requireCurrentStaff(tx,actor,'orders',write);ensure((write?['ADMIN','OPERATIONS']:['ADMIN','OPERATIONS','FINANCE','SUPPORT']).includes(staff.role),403,'FORBIDDEN');return staff;}
export async function readCase04(tx:any,id:string){
 const record=await tx.orderPreDeliveryCancellation.findUnique({where:{id}});ensure(record,404,'NOT_FOUND');
 ensure(canonicalHash(record.sourceSnapshot)===record.sourceHash&&canonicalHash(record.proposal)===record.proposalHash,409,'CANCELLATION_SOURCE_CHANGED');
 const facts=await tx.preDeliveryCancellationFact.findMany({where:{cancellationId:id},orderBy:{revision:'asc'}});
 for(let i=0;i<facts.length;i++){const {factHash,...body}=facts[i],p=facts[i-1];ensure(body.revision===i+1&&body.predecessorId===(p?.id??null)&&body.predecessorHash===(p?.factHash??null)&&body.sourceHash===record.sourceHash&&body.proposalHash===record.proposalHash&&canonicalHash(body)===factHash,409,'CANCELLATION_FACT_CHAIN');}
 ensure(facts.length===record.revision&&facts.at(-1)?.kind===record.state,409,'CANCELLATION_FACT_CHAIN');
 return{record,facts,head:facts.at(-1)};
}
async function append04(tx:any,s:any,kind:string,payload:any,actorId:string,occurredAt=new Date()){
 const body={id:randomUUID(),cancellationId:s.record.id,kind,revision:s.record.revision+1,predecessorId:s.head?.id??null,predecessorHash:s.head?.factHash??null,sourceHash:s.record.sourceHash,proposalHash:s.record.proposalHash,payload:JSON.parse(JSON.stringify(payload)),actorId,occurredAt,recordedAt:new Date()};
 ensure(occurredAt<=body.recordedAt,409,'CANCELLATION_FUTURE_FACT');
 const fact=await tx.preDeliveryCancellationFact.create({data:{...body,factHash:canonicalHash(body)}});
 await tx.orderPreDeliveryCancellation.update({where:{id:s.record.id},data:{revision:body.revision,state:kind}});
 await audit(tx,actorId,'CANCELLATION04_'+kind,'orders',s.record.orderId,{caseId:s.record.id,factId:fact.id,factHash:fact.factHash,...(payload.review?{review:payload.review}:{})});return readCase04(tx,s.record.id);
}
export function caseView04(s:any){
 const c=s.record,p=c.proposal,e=s.facts.find((f:any)=>f.kind==='EFFECTIVE'),a=s.facts.find((f:any)=>f.kind==='ARCHIVED'),confirmed=s.facts.find((f:any)=>f.kind==='CONFIRMED');
 const earlier=p.earlierAgreement&&e,amountFact=earlier?s.facts.find((f:any)=>f.id===e.payload.reviewFactId):confirmed;
 return{id:c.id,version:c.version,revision:c.revision,state:c.state,proposalHash:c.proposalHash,sourceHash:c.sourceHash,reason:p.reason,responsibility:p.responsibility,costs:p.costs,paymentReferences:p.money.payments,netRefundAmount:p.netRefundAmount,effectiveAt:e?.occurredAt.toISOString()??null,effectiveFactId:e?.id??null,effectiveFactHash:e?.factHash??null,amountConfirmedAt:earlier?p.earlierAgreement.amountConfirmedAt:confirmed?.occurredAt.toISOString()??null,amountConfirmationFactId:amountFact?.id??null,amountConfirmationFactHash:amountFact?.factHash??null,archivedAt:a?.recordedAt.toISOString()??null,contractId:c.contractId};
}
export async function assertCurrentCase04(tx:any,s:any,checkMoney=true){
 const source=await cancellation04Source(tx,s.record.orderId);ensure(source.sourceHash===s.record.sourceHash,409,'CANCELLATION_SOURCE_CHANGED');
 const latest=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId:source.order.id},orderBy:{version:'desc'}});ensure(latest?.id===s.record.id,409,'CANCELLATION_SOURCE_CHANGED');
 await verifyEvidence04(tx,s.record.proposal.evidence);
 if(checkMoney){const money=await cancellation04Money(tx,source.order.id);if(s.facts.some((f:any)=>f.kind==='EFFECTIVE'))cancellation04Execution(s.record,money);else ensure(!money.pending&&money.hash===s.record.proposal.money.hash,409,'CANCELLATION_MONEY_CHANGED','成功收退款已有变化，请形成新一致版本');}
 return source;
}
export class Cancellation04Service{
 constructor(private db:Db){}
 async read(orderId:string,actor?:any,customerId?:string){return this.db.serial(async tx=>{
 if(actor)await staff04(tx,actor,false);const order=await tx.order.findUnique({where:{id:orderId}});ensure(order&&(!customerId||order.customerId===customerId),404,'NOT_FOUND');
 const latest=await (tx as any).orderPreDeliveryCancellation.findFirst({where:{orderId},orderBy:{version:'desc'}}),s=latest?await readCase04(tx,latest.id):null;
 let source:any=null;const blockers:any[]=[];try{source=await cancellation04Source(tx,orderId);}catch(error){if(!(error instanceof HttpException))throw error;blockers.push((error.getResponse() as any).error);}
 if(s&&source){try{await assertCurrentCase04(tx,s,false);}catch(error){if(!(error instanceof HttpException))throw error;blockers.push((error.getResponse() as any).error);}}
 const money=await cancellation04Money(tx,orderId),document=s?await tx.electronicSigningTask.findUnique({where:{contractId:s.record.contractId},include:{parties:true}}):null;
 let financialExecution:any=null;if(s){try{financialExecution={ready:true,...cancellation04Execution(s.record,money)};}catch(error){if(!(error instanceof HttpException))throw error;financialExecution={ready:false,blocker:(error.getResponse() as any).error,sourceHash:money.hash};}}
 return{reviewSource:actor&&['ADMIN','OPERATIONS'].includes(actor.role)&&s?{proposal:s.record.proposal,source:s.record.sourceSnapshot,facts:s.facts}:null,financialExecution,blockers,canPropose:!!source&&order.status!=='CANCELLED',electronicDocument:document?{id:document.id,status:document.status,revision:document.revision,sourceSha256:document.sourceSha256,archivedAt:document.archivedAt,legalCompletedAt:document.legalCompletedAt,stopStatus:document.stopStatus,parties:document.parties.map((p:any)=>({role:p.role,status:p.status,mode:p.mode,signedAt:p.providerSignedAt}))}:null,orderId,orderRevision:order.revision,sourceHash:source?.sourceHash??null,case:s?caseView04(s):null,currentPayments:money.payments,financialSourceHash:money.hash,signing:source?{taskId:source.task.id,legalSigned:true,archivedAt:source.task.archivedAt}:null,unilateralPath:'VERIFIED_GROUND_AND_NOTICE_TASK8D'};
 });}
 async propose(orderId:string,raw:unknown,actor:any){const input=proposalSchema.parse(raw);return this.db.serial(async(tx:any)=>{
 await lockCancellation04(tx,orderId);await staff04(tx,actor);
 return archiveCommand(tx,actor,orderId,'CANCELLATION04_PROPOSE',input,async()=>{
 const source=await cancellation04Source(tx,orderId);ensure(source.order.revision===input.revision,409,'REVISION_CONFLICT');ensure(source.sourceHash===input.sourceHash,409,'CANCELLATION_SOURCE_CHANGED');ensure(source.order.status!=='CANCELLED',409,'ORDER_STATE');
 const old=await tx.orderPreDeliveryCancellation.findFirst({where:{orderId},orderBy:{version:'desc'}});
 if(old){const s=await readCase04(tx,old.id),t=await tx.electronicSigningTask.findUnique({where:{contractId:old.contractId},include:{parties:true}});ensure(!s.facts.some((f:any)=>f.kind==='EFFECTIVE')&&(!t||!!t.withdrawnAt&&(!t.parties.some((p:any)=>p.attemptedAt)||t.stopStatus==='PROVIDER_CLOSED')),409,'ELECTRONIC_STOP_REVIEW_REQUIRED','旧版本须停止并核清外部结果后才能建立新条件');}
 const money=await cancellation04Money(tx,orderId);ensure(!money.pending,409,'PAYMENT_PENDING');
 const evidence=await evidence04(tx,input.neverDeliveredEvidenceFileIds,actor.id,source.order.customerId);
 const costs=[];for(const c of input.costs){ensure(['CUSTOMER','MIXED'].includes(input.responsibility)&&[source.pin.ownerId,source.pin.platformSubjectId].includes(c.creditorOwnerId)&&new Date(c.performedAt)<=new Date(),409,'CANCELLATION_COST_UNSUPPORTED');const p=money.payments.find((p:any)=>p.paymentId===c.paymentId);ensure(p,409,'CANCELLATION_COST_UNSUPPORTED');const refs=await evidence04(tx,c.evidenceFileIds,actor.id,source.order.customerId);evidence.push(...refs);costs.push({...c,itemId:randomUUID(),sourceHash:canonicalHash({...c,evidence:refs}),accountingNature:c.kind==='PERFORMED_INDEPENDENT_SERVICE'?'INDEPENDENT_SERVICE_FEE':'LOSS_COMPENSATION',evidence:refs});}
 for(const p of money.payments){const deduct=costs.filter(c=>c.paymentId===p.paymentId).reduce((n,c)=>n+c.amount,0);ensure(deduct<=p.amount-p.refundedAmount,409,'CANCELLATION_COST_UNSUPPORTED');}
 let earlierAgreement:any=null;
 if(input.earlierAgreement){const a=input.earlierAgreement;for(const [role,subjectId]of [['customer',source.order.customerId],['owner',source.pin.ownerId],['platform',source.pin.platformSubjectId]]){const i=(a as any)[role];ensure(i.subjectId===subjectId&&new Date(i.occurredAt)<=new Date(),409,'CANCELLATION_EARLIER_AGREEMENT_INVALID');if(role==='owner')ensure(!await tx.adminUser.findUnique({where:{id:i.personReference}}),409,'CANCELLATION_EARLIER_AUTHORITY_REQUIRED','平台岗位不能替代实际出租方的有权身份');if(role!=='customer')ensure(i.authorityScope&&i.authorityFileIds?.length&&new Date(i.authorityFrom)<=new Date(i.occurredAt)&&new Date(i.occurredAt)<new Date(i.authorityUntil),409,'CANCELLATION_EARLIER_AUTHORITY_REQUIRED');evidence.push(...await evidence04(tx,[...new Set<string>([...i.fileIds,...(i.authorityFileIds??[])])],actor.id,source.order.customerId));}
 ensure(new Date(a.amountConfirmedAt)<=new Date(),409,'CANCELLATION_EARLIER_AGREEMENT_INVALID');ensure(a.confirmedNetRefundAmount===money.receivedAmount-money.refundedAmount-costs.reduce((n,c)=>n+c.amount,0)&&money.payments.every((p:any)=>p.succeededAt&&new Date(p.succeededAt)<=new Date(a.amountConfirmedAt))&&costs.every(c=>new Date(c.performedAt)<=new Date(a.amountConfirmedAt)),409,'CANCELLATION_EARLIER_AMOUNT_INVALID','早期无争议金额须精确对应当时已发生的真实收款及费用');earlierAgreement=a;}
 const template=await tx.legalDocument.findFirst({where:{type:'ELECTRONIC_V31_PRE_DELIVERY_CANCELLATION',status:'PUBLISHED'},orderBy:{version:'desc'}});approvedElectronicBody(template,'PRE_DELIVERY_CANCELLATION');
 const proposal={reason:input.reason,responsibility:input.responsibility,neverDeliveredEvidenceFileIds:input.neverDeliveredEvidenceFileIds,costs,money,evidence:[...new Map(evidence.map((e:any)=>[e.id,e])).values()],earlierAgreement,netRefundAmount:money.receivedAmount-money.refundedAmount-costs.reduce((n,c)=>n+c.amount,0),template:{id:template.id,version:template.version,hash:hash(template.content)}};
 const id=randomUUID(),proposalHash=canonicalHash(proposal),contract=await tx.contract.create({data:{orderId,customerId:source.order.customerId,kind:'TERMINATION',executionMode:'ELECTRONIC',documentHash:proposalHash,documentId:template.id,templateVersion:template.version,body:JSON.stringify({format:'CANCELLATION04_SUMMARY',caseId:id,proposalHash})}});
 const record=await tx.orderPreDeliveryCancellation.create({data:{id,orderId,customerId:source.order.customerId,ownerId:source.pin.ownerId,originalContractId:source.contract.id,originalTaskId:source.task.id,originalArchiveVersionId:source.version.id,version:(old?.version??0)+1,sourceHash:source.sourceHash,sourceSnapshot:source.pin,proposalHash,proposal,contractId:contract.id,createdBy:actor.id}});
 const result=await append04(tx,{record,head:null},'PROPOSED',{},actor.id);await tx.order.update({where:{id:orderId},data:{revision:{increment:1}}});return caseView04(result);
 });});}
 async review(id:string,raw:unknown,actor:any){const input=z.object({...command,decision:z.enum(['VERIFIED','REJECTED']),note}).strict().parse(raw);return this.db.serial(async(tx:any)=>{
 const row=await tx.orderPreDeliveryCancellation.findUnique({where:{id}});ensure(row,404,'NOT_FOUND');await lockCancellation04(tx,row.orderId);await staff04(tx,actor);
 return archiveCommand(tx,actor,id,'CANCELLATION04_REVIEW',input,async()=>{let s=await readCase04(tx,id);ensure(s.record.revision===input.revision,409,'REVISION_CONFLICT');ensure(s.record.state==='PROPOSED',409,'CANCELLATION_REVIEW_REQUIRED');await assertCurrentCase04(tx,s);
 const sources=[...new Set<string>([row.createdBy,...row.proposal.evidence.map((e:any)=>e.adminId).filter(Boolean)])];if(actor.role!=='ADMIN')await assertIndependentStaffReview(tx,actor.id,sources,'CANCELLATION_SELF_REVIEW');
 const review={policy:actor.role==='ADMIN'?'ADMIN_EXCEPTION':'INDEPENDENT_PERSON',sourceActorIds:sources};s=await append04(tx,s,input.decision,{note:input.note,review},actor.id);
 if(input.decision==='VERIFIED'&&row.proposal.earlierAgreement){const a=row.proposal.earlierAgreement;s=await append04(tx,s,'EFFECTIVE',{basis:'EARLIER_THREE_PARTY_AGREEMENT',reviewFactId:s.head.id,reviewFactHash:s.head.factHash,amountConfirmedAt:a.amountConfirmedAt},actor.id,new Date(Math.max(...[a.customer,a.owner,a.platform].map(i=>Date.parse(i.occurredAt)))));await applyCancellation04(tx,s);}
 return caseView04(s);});});}
 async confirm(id:string,raw:unknown,customerId:string){const input=z.object({...command,proposalHash:z.string(),accepted:z.literal(true)}).strict().parse(raw);return this.db.serial(async(tx:any)=>{
 const row=await tx.orderPreDeliveryCancellation.findUnique({where:{id}});ensure(row?.customerId===customerId,404,'NOT_FOUND');await lockCancellation04(tx,row.orderId);
 return archiveCommand(tx,{id:customerId,role:'CUSTOMER'},id,'CANCELLATION04_CONFIRM',input,async()=>{const s=await readCase04(tx,id);ensure(s.record.revision===input.revision,409,'REVISION_CONFLICT');ensure(['VERIFIED','EFFECTIVE'].includes(s.record.state),409,'CANCELLATION_REVIEW_REQUIRED');ensure(row.proposalHash===input.proposalHash,409,'CANCELLATION_SOURCE_CHANGED');await assertCurrentCase04(tx,s);return caseView04(await append04(tx,s,'CONFIRMED',{customerId,proposalHash:row.proposalHash,netRefundAmount:row.proposal.netRefundAmount},customerId));});});}
}
export async function applyCancellation04(tx:any,s:any){
 const order=await tx.order.findUniqueOrThrow({where:{id:s.record.orderId}});await assertNeverDelivered04(tx,order);ensure(s.facts.some((f:any)=>f.kind==='EFFECTIVE'),409,'CANCELLATION_04_REQUIRED');
 if(order.status==='CANCELLED')return;
 await tx.bill.updateMany({where:{orderId:order.id,paidAmount:0,status:{in:['DRAFT','REVIEWED','PENDING']}},data:{status:'VOID'}});
 await tx.entitlement.updateMany({where:{orderId:order.id,status:'PENDING'},data:{status:'EXPIRED'}});
 await tx.handover.updateMany({where:{orderId:order.id,status:{in:['DRAFT','PUBLISHED']}},data:{status:'SUPERSEDED'}});
 await tx.vehicle.updateMany({where:{id:order.vehicleId,reservedOrderId:order.id},data:{status:'UNPUBLISHED',reservedOrderId:null}});
 await tx.order.update({where:{id:order.id},data:{status:'CANCELLED',cancellationReason:s.record.proposal.reason,cancelledAt:s.facts.find((f:any)=>f.kind==='EFFECTIVE').occurredAt,revision:{increment:1}}});
}
/** Trusted exact task results, independent from filing time. Stopped evidence never calls this. */
export async function activateCancellation04(tx:any,task:any){
 if(task.kind!=='PRE_DELIVERY_CANCELLATION'||task.withdrawnAt||task.retiredAt)return;
 await lockCancellation04(tx,task.orderId);const record=await tx.orderPreDeliveryCancellation.findUnique({where:{contractId:task.contractId}});ensure(record,409,'CANCELLATION_04_REQUIRED');let s=await readCase04(tx,record.id);
 const alreadyEffective=s.facts.some((f:any)=>f.kind==='EFFECTIVE'),historical=alreadyEffective?await historicalCancellation04Source(tx,record):null,source=alreadyEffective?null:await assertCurrentCase04(tx,s,false),pin=historical?.pin??source!.pin,expectedParties=historical?.parties??source!.order.finalPlanSnapshot.partiesSnapshot.map((p:any)=>({...p,subjectId:p.partyId}));
 assertElectronicTaskSnapshot(task);const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}});ensure(version?.archive.subjectType==='PRE_DELIVERY_CANCELLATION'&&version.archive.subjectId===record.id&&version.archive.orderId===record.orderId&&version.archive.ownerId===record.ownerId&&version.scopeSnapshot?.cancellationId===record.id&&version.scopeSnapshot?.sourceHash===record.sourceHash&&version.scopeSnapshot?.originalTaskId===record.originalTaskId&&version.scopeSnapshot?.originalArchiveVersionId===record.originalArchiveVersionId&&version.businessSnapshotHash===record.proposalHash&&version.sourceFileId===task.sourceFileId&&s.facts.some((f:any)=>f.kind==='CONFIRMED'),409,'CANCELLATION_SOURCE_CHANGED');ensure(task.orderId===record.orderId&&task.businessHash===record.proposalHash&&task.customerId===record.customerId&&task.ownerId===record.ownerId&&task.platformSubjectId===pin.platformSubjectId,409,'CANCELLATION_SOURCE_CHANGED');
 const sourceFile=await tx.storedFile.findUnique({where:{id:task.sourceFileId}});ensure(sourceFile&&sourceFile.sha256===task.sourceSha256&&sourceFile.customerId===record.customerId,409,'CANCELLATION_SOURCE_CHANGED');
 if(!task.parties||!task.parties.every((p:any)=>hasActualSigningEvidence(p)&&p.verifiedAt))return;
 ensure(task.parties.length===3&&task.parties.every((p:any)=>p.mode==='MANUAL'&&expectedParties.some((r:any)=>r.role===p.role&&r.subjectId===p.subjectId&&r.subjectType===p.subjectType)),409,'CANCELLATION_SOURCE_CHANGED');
 const legalAt=new Date(Math.max(...task.parties.map((p:any)=>p.providerSignedAt.getTime())));await tx.electronicSigningTask.update({where:{id:task.id},data:{legalCompletedAt:legalAt}});
 if(!s.facts.some((f:any)=>f.kind==='EFFECTIVE'))s=await append04(tx,s,'EFFECTIVE',{basis:'VERIFIED_ELECTRONIC04',taskId:task.id,archiveVersionId:task.archiveVersionId,signatures:task.parties.map((p:any)=>({id:p.id,queryEvidenceHash:p.queryEvidenceHash,providerSignedAt:p.providerSignedAt}))},'electronic-verified',new Date(Math.max(...task.parties.map((p:any)=>p.providerSignedAt.getTime()))));
 if(!alreadyEffective)await applyCancellation04(tx,s);
 if(task.status==='ARCHIVED'&&!s.facts.some((f:any)=>f.kind==='ARCHIVED')){
  await loadElectronicArchiveProof(tx,task.archiveVersionId);let sourceReview:any=null;
  if(alreadyEffective){try{await assertCurrentCase04(tx,s,false);}catch(error){if(!(error instanceof HttpException))throw error;sourceReview={...(error.getResponse() as any).error,observedAt:new Date().toISOString()};await audit(tx,'electronic-verified','CANCELLATION04_HISTORICAL_SOURCE_REVIEW','orders',record.orderId,{caseId:record.id,taskId:task.id,sourceReview});}}
  await tx.contract.update({where:{id:record.contractId},data:{status:'SIGNED',signedFileId:task.finalFileId}});s=await append04(tx,s,'ARCHIVED',{taskId:task.id,archiveVersionId:task.archiveVersionId,finalFileId:task.finalFileId,sourceReview},'electronic-verified');
 }
 return caseView04(s);
}
