import {assertOrdinaryReview} from '../auth/ordinary-review';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertNotAssetFiles} from '../files/asset-files';
import {filePrivacyBoundary} from '../files/files';
import {readEvidenceBytes,requireOnlineEvidence} from '../operations/online-handover';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {lockOrder} from '../order-changes/context';
import {assertOfflineSwapHandoverSource,requireSwapFieldCompletion} from './offline-physical-source';
import {assertElectronicSwapCommercial} from './electronic-source';
import {closeAssignment} from './handovers';
import {boundaryAt} from './assignments';
import {calculateSwapFacts} from '../contract-terms/swap';

const id=z.string().trim().min(1).max(128),key=z.string().min(8).max(128);
export const swapReceiptInput=z.object({receivedAt:z.iso.datetime({offset:true}),readingKm:z.number().int().min(0).max(2147483647),storageLocation:z.string().trim().min(1).max(500),evidenceFileIds:z.array(id).min(1).max(20).refine(v=>new Set(v).size===v.length),revision:z.number().int().nonnegative(),previousEventId:id.optional(),correctionReason:z.string().trim().min(1).max(1000).optional(),handoverRevision:z.number().int().positive(),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),taskVersion:z.number().int().nonnegative().optional(),idempotencyKey:key}).strict();
export async function currentSwapReceipt(tx:any,changeId:string,projected=false){
 const events=await tx.swapReceiptEvent.findMany({where:{changeId},orderBy:{revision:'desc'}}),reviews=await tx.swapReceiptReview.findMany({where:{changeId,decision:'APPROVE'}});
 return events.find((e:any)=>!e.previousEventId||reviews.some((r:any)=>r.eventId===e.id&&(!projected||r.disposition==='APPLIED')))??null;
}
async function sources(tx:any,h:any){
 const change=await tx.orderChange.findUnique({where:{id:h.changeId}}),order=await tx.order.findUniqueOrThrow({where:{id:h.orderId}}),q=change?.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}}):null;
 ensure(order.contractMode==='ELECTRONIC'&&h.executionMode==='ELECTRONIC'&&h.confirmationMode==='ONLINE_RECORD'&&h.type==='SWAP_RETURN'&&change?.kind==='VEHICLE_CHANGE'&&change.orderId===order.id&&change.customerId===order.customerId&&h.customerId===order.customerId&&q?.changeId===change.id&&q.status==='CONFIRMED'&&q.confirmedAt,409,'SWAP_RECEIPT_SOURCE_CHANGED','须为已确认电子换车的真实归还来源');
 assertElectronicSwapCommercial(change,q);assertOfflineSwapHandoverSource(h,change,q);await requireOnlineEvidence(tx,h);
 const assignment=await tx.vehicleAssignment.findUnique({where:{id:h.assignmentId}});
 ensure(assignment?.id===q.snapshot.originalAssignmentId&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===h.vehicleId&&change.returnHandoverId===h.id,409,'SWAP_RECEIPT_SOURCE_CHANGED','原分配、报价或查验版本已变化');
 return{change,order,q,assignment};
}
async function evidence(tx:any,ids:string[],where:any){
 await assertNotAssetFiles(tx,ids);const files=await tx.storedFile.findMany({where:{id:{in:ids},...where}});
 ensure(files.length===ids.length,403,'FILE_OWNERSHIP','须使用当前接收人权限范围的证据');
 for(const file of files){ensure(['handover','evidence'].includes(file.purpose),403,'RECEIPT_EVIDENCE_PURPOSE');const privateBinding=await filePrivacyBoundary(tx,file.id);ensure(!Object.values(privateBinding).some(Boolean),403,'RECEIPT_EVIDENCE_PRIVATE','其他业务私有材料不可作为普通收车证据');await readEvidenceBytes(file);}
 return ids.map(id=>{const f=files.find((f:any)=>f.id===id);return{fileId:id,sha256:f.sha256,size:f.size};});
}
async function chronology(tx:any,a:any,at:Date,readingKm:number,current:any){
 ensure(at>=a.startAt&&at<=new Date(Date.now()+300000),409,'RECEIPT_DATE_INVALID','收车时间不得早于原交付或超过五分钟时钟容差');
 const otherSegments=await tx.usageSegment.findMany({where:{assignmentId:a.id,...(current?{NOT:{endHandoverId:current.handoverId}}:{})}});
 ensure(otherSegments.every((s:any)=>!s.endReadingKm||readingKm>=s.endReadingKm)&&readingKm>=a.startReadingKm,409,'MILEAGE_REGRESSION','更正读数不得低于此前独立核验读数');
 const later=await tx.vehicleAssignment.findFirst({where:{vehicleId:a.vehicleId,id:{not:a.id},startAt:{gte:a.startAt}},orderBy:{startAt:'asc'}});
 ensure(!later||at<=later.startAt&&readingKm<=later.startReadingKm,409,'RECEIPT_FACT_CONFLICT','更正与本车后续实际交付时间或里程冲突');
 const c=current?await tx.orderChange.findUnique({where:{id:current.changeId}}):null,delivery=c?.deliveryHandoverId?await tx.handover.findUnique({where:{id:c.deliveryHandoverId}}):null;
 ensure(!delivery||delivery.status!=='COMPLETED'||at<=delivery.actualAt,409,'RECEIPT_FACT_CONFLICT','旧车收回不得晚于已完成的新车交付');
}
/** First receipt applies immediately. Corrections are proposed evidence until independent review. */
export async function recordSwapReceipt(tx:any,actor:any,handoverId:string,raw:unknown,taskId?:string){
 const input=swapReceiptInput.parse(raw),reference=await tx.handover.findUnique({where:{id:handoverId}});ensure(reference,404,'NOT_FOUND');await lockOrder(tx,reference.orderId);
 await requireCurrentStaff(tx,actor,actor.role==='FIELD'?'field-tasks':'handovers');ensure(['ADMIN','OPERATIONS','FIELD'].includes(actor.role),403,'FORBIDDEN');
 const h=await tx.handover.findUniqueOrThrow({where:{id:handoverId}}),{change,order,q,assignment}=await sources(tx,h);
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${assignment.vehicleId} FOR UPDATE`;
 const current=await currentSwapReceipt(tx,change.id);
 const task=current&&actor.role!=='FIELD'&&h.fieldTaskId?await tx.fieldHandoverTask.findUnique({where:{id:h.fieldTaskId}}):await requireSwapFieldCompletion(tx,h,change,q);
 if(task)ensure(task.orderId===order.id&&task.changeId===change.id&&task.quoteId===q.id&&task.vehicleId===h.vehicleId&&task.vehicleAssignmentId===h.assignmentId&&task.currentHandoverId===h.id&&['ASSIGNED','COMPLETED'].includes(task.status),409,'FIELD_SWAP_SOURCE_CHANGED');
 if(task){ensure(task.version===input.taskVersion&&task.materialGeneration>=0,409,'REVISION_CONFLICT','当前接收任务版本已变化');if(actor.role==='FIELD')ensure(taskId===task.id&&task.assigneeId===actor.id,404,'NOT_FOUND','此任务已改派');}
 else ensure(actor.role!=='FIELD'&&!taskId,403,'FIELD_TASK_REQUIRED','现场接收须来自本人当前任务');
 ensure(input.handoverRevision===h.revision&&input.manifestHash===h.manifestHash,409,'MANIFEST_CONFLICT','请重新读取当前归还查验');
 const proof=await evidence(tx,input.evidenceFileIds,actor.role==='FIELD'?{fieldTaskId:task.id,fieldTaskGeneration:task.materialGeneration,purpose:'handover'}:{customerId:null,purpose:{in:['handover','evidence']}});
 const requestHash=canonicalHash({handoverId,...input}),old=await tx.swapReceiptEvent.findUnique({where:{createdBy_idempotencyKey:{createdBy:actor.id,idempotencyKey:input.idempotencyKey}}});
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT');return old;}
 const latest=await tx.swapReceiptEvent.findFirst({where:{changeId:change.id},orderBy:{revision:'desc'}});
 ensure(input.revision===(latest?.revision??0),409,'REVISION_CONFLICT','收车核验版本已变化');
 const receivedAt=new Date(input.receivedAt);await chronology(tx,assignment,receivedAt,input.readingKm,current);
 if(current){ensure(['ADMIN','OPERATIONS'].includes(actor.role)&&input.previousEventId===current.id&&input.correctionReason,403,'RECEIPT_CORRECTION_REQUIRED','更正须由运营关联当前事实并说明原因');}
 else{
  ensure(!input.previousEventId&&order.status==='ACTIVE'&&order.currentAssignmentId===assignment.id&&assignment.status==='ACTIVE'&&!['SUPERSEDED','COMPLETED'].includes(h.status)&&receivedAt.getTime()===h.actualAt.getTime()&&input.readingKm===h.readingKm,409,'SWAP_RECEIPT_SOURCE_CHANGED','首次收回须对应当前实际分配及原查验事实');
  const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:assignment.vehicleId}});ensure(vehicle.status==='IN_USE'&&vehicle.reservedOrderId===order.id&&input.readingKm>=vehicle.mileageKm,409,'VEHICLE_OWNERSHIP');
 }
 const data={orderId:order.id,customerId:order.customerId,changeId:change.id,quoteId:q.id,assignmentId:assignment.id,vehicleId:assignment.vehicleId,handoverId:h.id,handoverRevision:h.revision,manifestHash:h.manifestHash,fieldTaskId:task?.id??null,materialGeneration:task?.materialGeneration??null,revision:(latest?.revision??0)+1,previousEventId:current?.id??null,receivedAt,readingKm:input.readingKm,storageLocation:input.storageLocation,evidenceFileIds:input.evidenceFileIds,evidence:proof,correctionReason:input.correctionReason??null,createdBy:actor.id,idempotencyKey:input.idempotencyKey,requestHash};
 const event=await tx.swapReceiptEvent.create({data:{...data,factHash:canonicalHash(data)}});
 if(!current){await closeAssignment(tx,assignment,h);await tx.orderChange.update({where:{id:change.id},data:{status:'SWAP_RETURNED',revision:{increment:1}}});}
 await audit(tx,actor.id,current?'PROPOSE_SWAP_RECEIPT_CORRECTION':'RECORD_SWAP_RECEIPT','order-changes',change.id,{eventId:event.id,factHash:event.factHash});return event;
}

export const receiptReviewInput=z.object({eventId:id,revision:z.number().int().positive(),factHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['APPROVE','REJECT','REQUEST_EVIDENCE']),reason:z.string().trim().min(1).max(2000),idempotencyKey:key}).strict();
export async function reviewSwapReceipt(tx:any,actor:any,changeId:string,raw:unknown){
 const input=receiptReviewInput.parse(raw),change=await tx.orderChange.findUnique({where:{id:changeId}});ensure(change,404,'NOT_FOUND');await lockOrder(tx,change.orderId);await requireCurrentStaff(tx,actor,'handovers');ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN');
 const event=await tx.swapReceiptEvent.findUnique({where:{id:input.eventId}});ensure(event?.changeId===changeId&&event.previousEventId&&event.revision===input.revision&&event.factHash===input.factHash,409,'RECEIPT_SOURCE_CHANGED');
 const uploaders=await tx.storedFile.findMany({where:{id:{in:event.evidenceFileIds}},select:{adminId:true}});assertOrdinaryReview(actor,[event.createdBy,...uploaders.map((f:any)=>f.adminId)],'RECEIPT_SELF_REVIEW',403);
 const requestHash=canonicalHash(input),old=await tx.swapReceiptReview.findUnique({where:{reviewedBy_idempotencyKey:{reviewedBy:actor.id,idempotencyKey:input.idempotencyKey}}});if(old){ensure(old.requestHash===requestHash&&old.changeId===changeId,409,'IDEMPOTENCY_CONFLICT');return old;}
 ensure(!await tx.swapReceiptReview.findUnique({where:{eventId:event.id}}),409,'RECEIPT_ALREADY_REVIEWED','此证据已核验，补证请追加新版本');
 const current=await currentSwapReceipt(tx,changeId);ensure(current?.id===event.previousEventId,409,'RECEIPT_SOURCE_CHANGED','原有效收车版本已改变，请重新核验');
 const h=await tx.handover.findUniqueOrThrow({where:{id:event.handoverId}});await sources(tx,h);
 ensure(['orderId','customerId','quoteId','assignmentId','vehicleId','handoverId','handoverRevision','manifestHash','fieldTaskId','materialGeneration'].every(k=>event[k]===current[k]),409,'RECEIPT_SOURCE_CHANGED','更正不得替换原接收任务及报价来源');
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${event.vehicleId} FOR UPDATE`;
 const currentEvidence=await evidence(tx,event.evidenceFileIds,{});ensure(canonicalHash(currentEvidence)===canonicalHash(event.evidence),409,'RECEIPT_EVIDENCE_CHANGED','核验须使用本提案固定的原证据内容，补充材料请追加新版本');
 const assignment=await tx.vehicleAssignment.findUniqueOrThrow({where:{id:event.assignmentId}});if(input.decision==='APPROVE')await chronology(tx,assignment,event.receivedAt,event.readingKm,current);
 const segments=await tx.usageSegment.findMany({where:{assignmentId:assignment.id},include:{period:true}}),bills=await tx.bill.findMany({where:{orderId:event.orderId}}),allocations=await tx.paymentAllocation.findMany({where:{obligation:{orderId:event.orderId}},include:{payment:true}}),response=await tx.swapReceiptResponse.findUnique({where:{eventId:event.id}});
 const originalFinance=await tx.swapFactFinance.findUnique({where:{quoteId:event.quoteId}});
 const immutable=segments.some((s:any)=>s.period.status==='SETTLED'||s.endHandoverId===current.handoverId&&(event.receivedAt<s.startAt||event.receivedAt>boundaryAt(s.period.effectiveEndDate)))||change.status==='APPLIED'||!!originalFinance;
 let financialSource:any=null;
 if(originalFinance&&input.decision==='APPROVE'){
  const settlement=await tx.swapFactSettlement.findUniqueOrThrow({where:{id:originalFinance.settlementId}}),plan=originalFinance.plan,s=settlement.sourceSnapshot;
  ensure(canonicalHash(plan)===originalFinance.planHash&&canonicalHash(s)===settlement.sourceHash&&plan.sourceHash===settlement.sourceHash,409,'SWAP_FACT_SOURCE_CHANGED');
  const corrected=calculateSwapFacts(s.terms,event.receivedAt.toISOString(),s.delivery.actualAt,plan.funds.map((f:any)=>({sequence:f.sequence,netPaidAmount:f.netPaidAmount,paymentIds:f.payments.map((p:any)=>p.id)})));
  financialSource={settlementId:settlement.id,settlementSourceHash:settlement.sourceHash,financeId:originalFinance.id,planHash:originalFinance.planHash,originalAmountResponseId:originalFinance.responseId,delivery:s.delivery,originalAmounts:plan.result,correctedAmounts:corrected,grossDifferences:corrected.periods.map((p:any)=>({sequence:p.sequence,originalAmount:plan.result.periods.find((v:any)=>v.sequence===p.sequence).amount,correctedAmount:p.amount})),correctedAmountsConfirmed:false};
 }
 const meteringAudit=await tx.auditLog.findMany({where:{resourceType:'usage-segments',resourceId:{in:segments.map((s:any)=>s.id)},action:'FREEZE_SWAP_RECEIPT_METERING'},select:{id:true,action:true,resourceId:true,createdAt:true,data:true}});
 const payments=await tx.payment.findMany({where:{bill:{orderId:event.orderId}},select:{id:true,billId:true,customerId:true,amount:true,status:true,succeededAt:true,refunds:{select:{id:true,amount:true,status:true,succeededAt:true}}}});
 const disposition=input.decision==='REJECT'?'REJECTED':input.decision==='REQUEST_EVIDENCE'?'NEEDS_EVIDENCE':immutable?'REQUIRES_FINANCIAL_REVIEW':'APPLIED';
 const sourceSnapshot={version:1,changeId,eventId:event.id,factHash:event.factHash,previousEventId:current.id,previousFactHash:current.factHash,oldFacts:{receivedAt:current.receivedAt,readingKm:current.readingKm},newFacts:{receivedAt:event.receivedAt,readingKm:event.readingKm},assignment,segments,meteringAudit,financialSource,payments,bills:bills.map((b:any)=>({id:b.id,orderId:b.orderId,customerId:b.customerId,type:b.type,sequence:b.sequence,amount:b.amount,paidAmount:b.paidAmount,dueDate:b.dueDate,status:b.status,serviceStageId:b.serviceStageId})),allocations:allocations.map((a:any)=>({id:a.id,obligationId:a.obligationId,paymentId:a.paymentId,amount:a.amount,releasedAt:a.releasedAt,payment:{id:a.payment.id,billId:a.payment.billId,customerId:a.payment.customerId,amount:a.payment.amount,status:a.payment.status,succeededAt:a.payment.succeededAt}})),customerResponse:response?{id:response.id,decision:response.decision,factHash:response.factHash}:null,confirmedDifferences:input.decision==='APPROVE'?['RECEIPT_TIME','RECEIPT_READING']:[],amountsConfirmed:false};
 const review=await tx.swapReceiptReview.create({data:{eventId:event.id,changeId,decision:input.decision,disposition,reason:input.reason,sourceSnapshot:JSON.parse(JSON.stringify(sourceSnapshot)),sourceHash:canonicalHash(sourceSnapshot),reviewedBy:actor.id,idempotencyKey:input.idempotencyKey,requestHash}});
 if(disposition==='APPLIED'){
  // Only mutable projections move. The original handover and receipt remain unchanged.
  ensure(assignment.status==='CLOSED'&&assignment.returnHandoverId===current.handoverId,409,'RECEIPT_SOURCE_CHANGED');
  for(const segment of segments.filter((s:any)=>s.endHandoverId===current.handoverId)){
   ensure(event.receivedAt>=segment.startAt,409,'RECEIPT_PERIOD_REVIEW_REQUIRED','更正跨越原计量分段，须核验期间差异');
   await tx.usageSegment.update({where:{id:segment.id},data:{endAt:event.receivedAt,endReadingKm:event.readingKm,revision:{increment:1}}});
  }
  await tx.vehicleAssignment.update({where:{id:assignment.id},data:{endAt:event.receivedAt,endReadingKm:event.readingKm}});
  const later=await tx.vehicleAssignment.count({where:{vehicleId:assignment.vehicleId,id:{not:assignment.id},startAt:{gte:assignment.startAt}}});if(!later)await tx.vehicle.update({where:{id:assignment.vehicleId},data:{mileageKm:event.readingKm}});
 }
 await audit(tx,actor.id,'REVIEW_SWAP_RECEIPT_CORRECTION','order-changes',changeId,{reviewId:review.id,eventId:event.id,disposition,sourceHash:review.sourceHash});return review;
}
export async function respondSwapReceipt(tx:any,customerId:string,changeId:string,raw:unknown){
 const input=z.object({eventId:id,factHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['CONFIRM','OBJECT']),reason:z.string().trim().max(2000).default(''),evidenceFileIds:z.array(id).max(20).default([]),idempotencyKey:key}).strict().parse(raw);
 const change=await tx.orderChange.findFirst({where:{id:changeId,customerId}});ensure(change,404,'NOT_FOUND');await lockOrder(tx,change.orderId);
 const event=await tx.swapReceiptEvent.findUnique({where:{id:input.eventId}});ensure(event?.changeId===changeId&&event.customerId===customerId&&event.factHash===input.factHash,409,'RECEIPT_SOURCE_CHANGED');await requireElectronicCustomerIdentity(tx,customerId);
 ensure(input.decision!=='OBJECT'||input.reason,400,'OBJECTION_REASON_REQUIRED');await evidence(tx,input.evidenceFileIds,{customerId});
 const requestHash=canonicalHash(input),old=await tx.swapReceiptResponse.findUnique({where:{eventId:event.id}});if(old){ensure(old.customerId===customerId&&old.idempotencyKey===input.idempotencyKey&&old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT');return old;}
 const response=await tx.swapReceiptResponse.create({data:{...input,customerId,requestHash}});await audit(tx,customerId,'RESPOND_SWAP_RECEIPT','order-changes',changeId,{eventId:event.id,responseId:response.id,decision:input.decision},'CUSTOMER');return response;
}
export async function swapReceiptView(tx:any,changeId:string,actor?:any,customerId?:string){
 if(actor)await requireCurrentStaff(tx,actor,'handovers',false);else ensure(customerId,403,'FORBIDDEN');
 const change=await tx.orderChange.findFirst({where:{id:changeId,...(customerId?{customerId}:{})}});ensure(change,404,'NOT_FOUND');
 const events=await tx.swapReceiptEvent.findMany({where:{changeId},orderBy:{revision:'asc'}}),reviews=await tx.swapReceiptReview.findMany({where:{changeId}}),responses=await tx.swapReceiptResponse.findMany({where:{eventId:{in:events.map((e:any)=>e.id)}}});
 await assertNotAssetFiles(tx,[...events.flatMap((e:any)=>e.evidenceFileIds),...responses.flatMap((r:any)=>r.evidenceFileIds)]);
 return{changeId,currentEventId:(await currentSwapReceipt(tx,changeId))?.id??null,events:events.map(({requestHash,idempotencyKey,...e}:any)=>({...e,review:reviews.find((r:any)=>r.eventId===e.id)?(()=>{const r=reviews.find((r:any)=>r.eventId===e.id);return{id:r.id,decision:r.decision,disposition:r.disposition,reason:r.reason,reviewedAt:r.reviewedAt,sourceHash:r.sourceHash,...(actor?{sourceSnapshot:r.sourceSnapshot,reviewedBy:r.reviewedBy}:{})};})():null,response:responses.find((r:any)=>r.eventId===e.id)??null})),pendingReviewIds:events.filter((e:any)=>e.previousEventId&&!reviews.some((r:any)=>r.eventId===e.id)).map((e:any)=>e.id),financialReviewSourceIds:reviews.filter((r:any)=>r.disposition==='REQUIRES_FINANCIAL_REVIEW').map((r:any)=>r.id)};
}
export async function readSwapReceiptFile(tx:any,changeId:string,eventId:string,fileId:string,actor?:any,customerId?:string){
 if(actor){await requireCurrentStaff(tx,actor,'handovers',false);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'HANDOVER_FILE_PERMISSION');}else ensure(customerId,403,'FORBIDDEN');
 const event=await tx.swapReceiptEvent.findFirst({where:{id:eventId,changeId,...(customerId?{customerId}:{})}});ensure(event&&event.evidenceFileIds.includes(fileId),404,'NOT_FOUND');
 await evidence(tx,[fileId],{});const file=await tx.storedFile.findUniqueOrThrow({where:{id:fileId}}),fixed=event.evidence.find((e:any)=>e.fileId===fileId);ensure(fixed?.sha256===file.sha256&&fixed.size===file.size,409,'RECEIPT_EVIDENCE_CHANGED');
 const bytes=await readEvidenceBytes(file);await audit(tx,actor?.id||customerId!,'OPEN_SWAP_RECEIPT_EVIDENCE','order-changes',changeId,{eventId,factHash:event.factHash,fileId,sha256:file.sha256},actor?'ADMIN':'CUSTOMER');return{file,bytes};
}

/** Bind a mutable metering projection to the approved physical fact, never to old photos. */
export async function swapReceiptMeteringSource(tx:any,segment:any){
 const assignment=segment.assignment,order=await tx.order.findUniqueOrThrow({where:{id:assignment.orderId}});
 if(order.contractMode!=='ELECTRONIC'||!segment.endHandoverId)return null;
 const h=await tx.handover.findUnique({where:{id:segment.endHandoverId}});
 ensure(h,409,'SWAP_METERING_SOURCE_CHANGED','计量截止交接来源不存在');
 if(h.type!=='SWAP_RETURN')return null;
 const {change,q}=await sources(tx,h),event=await currentSwapReceipt(tx,change.id,true);
 ensure(event&&event.orderId===order.id&&event.customerId===order.customerId&&event.quoteId===q.id&&event.assignmentId===assignment.id&&event.vehicleId===segment.vehicleId&&event.handoverId===h.id&&event.handoverRevision===h.revision&&event.manifestHash===h.manifestHash&&assignment.returnHandoverId===h.id&&assignment.endAt?.getTime()===event.receivedAt.getTime()&&assignment.endReadingKm===event.readingKm&&segment.endAt?.getTime()===event.receivedAt.getTime()&&segment.endReadingKm===event.readingKm,409,'SWAP_METERING_SOURCE_CHANGED','分段读数须绑定本车已核验收车版本');
 const {id:eventId,createdAt,factHash,...fact}=event;ensure(canonicalHash(fact)===factHash,409,'SWAP_METERING_SOURCE_CHANGED','收车事实摘要不一致');
 const files=await evidence(tx,event.evidenceFileIds,{});ensure(canonicalHash(files)===canonicalHash(event.evidence),409,'RECEIPT_EVIDENCE_CHANGED');
 const review=event.previousEventId?await tx.swapReceiptReview.findUnique({where:{eventId:event.id}}):null;
 ensure(!event.previousEventId||review?.decision==='APPROVE'&&review.disposition==='APPLIED'&&review.sourceSnapshot.eventId===event.id&&review.sourceSnapshot.factHash===event.factHash&&canonicalHash(review.sourceSnapshot)===review.sourceHash,409,'SWAP_METERING_SOURCE_CHANGED');
 return{receipt:{eventId:event.id,revision:event.revision,factHash:event.factHash,reviewId:review?.id??null,reviewSourceHash:review?.sourceHash??null,evidence:files},originalHandover:{id:h.id,revision:h.revision,manifestHash:h.manifestHash,actualAt:h.actualAt,readingKm:h.readingKm,fileIds:h.fileIds},fileIds:event.evidenceFileIds};
}
