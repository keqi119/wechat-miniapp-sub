import {returnReceiptRecovery} from './return-receipt-recovery';
import {receiptFactHash,verifyReceiptFact,reviewReturnReceipt} from './return-receipt-review';
import {assertNotAssetFiles} from '../files/asset-files';
import {requireOnlineEvidence,readEvidenceBytes} from '../operations/online-handover';
import {EntitlementService} from '../entitlements/service';
import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {recordSwapReceipt,reviewSwapReceipt,respondSwapReceipt,swapReceiptView,readSwapReceiptFile} from '../vehicle-changes/swap-receipt';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {requireCurrentStaff} from '../auth/staff-session';
import type {StaffActor} from '../auth/staff.types';
import {serviceBillSequences} from '../order-changes/obligations';
import {shanghaiDay} from '../usage/rules';
import {lockOrder} from './readiness';
const id=z.string().trim().min(1).max(128);
export const receiptInput=z.object({receivedAt:z.iso.datetime({offset:true}),readingKm:z.number().int().min(0).max(2147483647),storageLocation:z.string().trim().min(1).max(500),evidenceFileIds:z.array(id).min(1).max(20).refine(v=>new Set(v).size===v.length),revision:z.number().int().nonnegative(),previousEventId:id.optional(),correctionReason:z.string().trim().min(1).max(1000).optional(),taskVersion:z.number().int().nonnegative().optional(),idempotencyKey:z.string().min(8).max(128)}).strict();
type ReceiptInput=z.infer<typeof receiptInput>;
export function assertReceiptRevision(current:{id:string;revision:number}|null,input:Pick<ReceiptInput,'revision'|'previousEventId'|'correctionReason'>,role:string){
 if(!current){ensure(input.revision===0&&!input.previousEventId,409,'REVISION_CONFLICT','首次接收须从版本0开始');return;}
 ensure(['ADMIN','OPERATIONS'].includes(role),403,'RECEIPT_CORRECTION_FORBIDDEN','更正收车事实须由运营处理');
 ensure(input.revision===current.revision,409,'REVISION_CONFLICT','收车事实已更新，请刷新');
 ensure(input.previousEventId===current.id&&input.correctionReason,409,'RECEIPT_PREVIOUS_REQUIRED','更正须关联原事件并说明原因');
}
export function isFutureUnperformedPeriod(receivedAt:Date,periodStart:Date){return periodStart.toISOString().slice(0,10)>shanghaiDay(receivedAt);}
export function requireReceiptMatchesHandover(event:{receivedAt:Date;readingKm:number}|null,handover:{actualAt:Date|null;readingKm:number}){
 ensure(!event||!!handover.actualAt&&event.receivedAt.getTime()===handover.actualAt.getTime()&&event.readingKm===handover.readingKm,409,'PHYSICAL_RECEIPT_MISMATCH','正式归还与已记录实物接收时间或读数不同，请先核对并保留更正记录');
}
export async function currentPhysicalReceipt(tx:any,orderId:string){const event=await tx.vehicleReceiptEvent.findFirst({where:{orderId,isCurrent:true},orderBy:[{createdAt:'desc'},{revision:'desc'}]});await assertNotAssetFiles(tx,event?.evidenceFileIds||[]);if(event?.factHash)await verifyReceiptFact(tx,event);return event;}
export async function guardPhysicalReceiptPeriod(tx:any,orderId:string,periodStart:Date){
 const event=await currentPhysicalReceipt(tx,orderId);
 ensure(!event||!isFutureUnperformedPeriod(event.receivedAt,periodStart),409,'PHYSICAL_RETURN_BILL_PAUSED','车辆已收回待核验，后续未履约期间账单暂停处理');
}
export async function guardPhysicalReceiptBill(tx:any,bill:any){
 const event=await currentPhysicalReceipt(tx,bill.orderId);if(!event)return;
 if(['MILEAGE_PACK','SWAP_CREDIT'].includes(bill.type))ensure(false,409,'PHYSICAL_RETURN_BILL_PAUSED','车辆已收回，不可新增用车权益付款');
 const sequence=(await serviceBillSequences(tx,bill.orderId)).get(bill.id);if(!sequence)return;
 const period=await tx.usagePeriod.findFirst({where:{orderId:bill.orderId,sequence}});
 ensure(!isFutureUnperformedPeriod(event.receivedAt,period?.startDate||bill.dueDate),409,'PHYSICAL_RETURN_BILL_PAUSED','车辆已收回待核验，后续未履约期间账单暂停处理');
}
export async function recordPhysicalReceipt(tx:any,actor:StaffActor,handoverId:string,raw:unknown,requiredTaskId?:string){
 const swap=await tx.handover.findUnique({where:{id:handoverId}});if(swap?.type==='SWAP_RETURN'&&swap.executionMode==='ELECTRONIC')return recordSwapReceipt(tx,actor,handoverId,raw,requiredTaskId);
 const electronic=swap?.executionMode==='ELECTRONIC';
 const input=(electronic?receiptInput.extend({handoverRevision:z.number().int().positive(),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),recoveryHash:z.string().optional()}):receiptInput).parse(raw),reference=await tx.handover.findUnique({where:{id:handoverId}});ensure(reference,404,'NOT_FOUND','归还查验不存在');await lockOrder(tx,reference.orderId);
 await requireCurrentStaff(tx,actor,actor.role==='FIELD'?'field-tasks':'handovers');
 ensure(['ADMIN','OPERATIONS','FIELD'].includes(actor.role),403,'FORBIDDEN','无权记录车辆接收');
 if(electronic)ensure(Number.isInteger(actor.authVersion),403,'STAFF_SESSION_CHANGED');
 const handover=await tx.handover.findUnique({where:{id:handoverId}}),order=await tx.order.findUniqueOrThrow({where:{id:reference.orderId}});
 ensure(handover.executionMode===order.contractMode&&['OFFLINE','ELECTRONIC'].includes(order.contractMode)&&handover.type==='RETURN'&&handover.customerId===order.customerId,409,'RETURN_SOURCE_REQUIRED','此入口只记录本单真实归还车辆事实');
 const current=await currentPhysicalReceipt(tx,order.id),recovery=electronic&&!current&&handover.status==='COMPLETED'?await returnReceiptRecovery(tx,order,handover):null;if(recovery)ensure(['ADMIN','OPERATIONS'].includes(actor.role)&&(input as any).recoveryHash===recovery.sourceHash,409,'RETURN_RECOVERY_SOURCE_REQUIRED');
 if(electronic){
  ensure(handover.confirmationMode==='ONLINE_RECORD'&&handover.revision===(input as any).handoverRevision&&handover.manifestHash===(input as any).manifestHash,409,'MANIFEST_CONFLICT');
  await requireOnlineEvidence(tx,handover);
  if(!current)ensure(handover.actualAt?.getTime()===Date.parse(input.receivedAt)&&handover.readingKm===input.readingKm,409,'PHYSICAL_RECEIPT_MISMATCH');
 }
 const requestHash=hash({handoverId,...input}),old=await tx.vehicleReceiptEvent.findUnique({where:{createdBy_idempotencyKey:{createdBy:actor.id,idempotencyKey:input.idempotencyKey}}}),recoveredReplay=electronic&&!!old?.sourceSnapshot?.recovery;
 if(old){ensure(old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','接收编号与内容冲突');if(recoveredReplay){ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN');await verifyReceiptFact(tx,old);}}
 if(actor.role==='FIELD'){
  ensure(requiredTaskId&&requiredTaskId===handover.fieldTaskId,404,'NOT_FOUND','任务不属于当前员工');
  await tx.$queryRaw`SELECT id FROM "FieldHandoverTask" WHERE id = ${requiredTaskId} FOR UPDATE`;
  const task=await tx.fieldHandoverTask.findUnique({where:{id:requiredTaskId}});
  ensure(task?.status==='ASSIGNED'&&task.assigneeId===actor.id&&task.currentHandoverId===handoverId&&task.vehicleId===order.vehicleId&&task.vehicleAssignmentId===order.currentAssignmentId,404,'NOT_FOUND','任务已改派或车辆批次变化');
  ensure(task.version===input.taskVersion,409,'REVISION_CONFLICT','现场任务已更新');
  ensure(await tx.storedFile.count({where:{id:{in:input.evidenceFileIds},fieldTaskId:task.id,fieldTaskGeneration:task.materialGeneration,purpose:'handover'}})===input.evidenceFileIds.length,403,'FILE_OWNERSHIP','须引用当前任务的现场证据');
 }else ensure(await tx.storedFile.count({where:{id:{in:input.evidenceFileIds},customerId:null,...(electronic?(recovery||recoveredReplay?{OR:[{adminId:actor.id},{id:{in:handover.fileIds}}]}:{adminId:actor.id}):{}),purpose:{in:['handover','evidence']}}})===input.evidenceFileIds.length,403,'FILE_OWNERSHIP','请上传本人后台收车证据');
 if(electronic)for(const file of await tx.storedFile.findMany({where:{id:{in:input.evidenceFileIds}}}))await readEvidenceBytes(file);
 await assertNotAssetFiles(tx,input.evidenceFileIds);
 if(old){await assertNotAssetFiles(tx,old.evidenceFileIds||[]);return old;}
 ensure(recovery||electronic&&current||order.status==='ACTIVE'&&!['SUPERSEDED','COMPLETED'].includes(handover.status),409,'ORDER_STATE','仅当前用车中的归还可记录接收事实');
 // A new inspection revision must not let a field user rewrite an earlier receipt.
 const latest=electronic?await tx.vehicleReceiptEvent.findFirst({where:{orderId:order.id},orderBy:{revision:'desc'}}):current;
 assertReceiptRevision(latest,input,actor.role);
 if(electronic&&latest&&latest.id!==current?.id){const review=await tx.vehicleReceiptReview.findUnique({where:{eventId:latest.id}});ensure(review&&['NEEDS_EVIDENCE','REJECTED'].includes(review.disposition),409,'RECEIPT_REVIEW_REQUIRED','请先处理当前收车更正或财务差额');}
 const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:order.vehicleId}});
 ensure(recovery|| (electronic&&current?current.vehicleId===handover.vehicleId&&current.assignmentId===handover.assignmentId:vehicle.reservedOrderId===order.id&&vehicle.status==='IN_USE'&&handover.vehicleId===order.vehicleId&&handover.assignmentId===order.currentAssignmentId),409,'VEHICLE_OWNERSHIP','车辆归属已变化');
 if(!recovery&&(!electronic||!current))ensure(input.readingKm>=Math.max(order.confirmedMileageKm,vehicle.mileageKm),409,'MILEAGE_REGRESSION','接收读数低于已核验读数');
 const receivedAt=new Date(input.receivedAt),delivery=await tx.handover.findFirst({where:{orderId:order.id,type:'DELIVERY',status:'COMPLETED'},orderBy:{completedAt:'desc'}});
 ensure(receivedAt<=new Date(Date.now()+300000)&&(!delivery?.actualAt||receivedAt>=delivery.actualAt),400,'RECEIPT_DATE_INVALID','收车时间不可在未来或早于交车');
 if(current&&!electronic)await tx.vehicleReceiptEvent.update({where:{id:current.id},data:{isCurrent:false}});
 const proof=electronic?await tx.storedFile.findMany({where:{id:{in:input.evidenceFileIds}},orderBy:{id:'asc'},select:{id:true,sha256:true,size:true,adminId:true}}):null;
 const data:any={handoverId,orderId:order.id,vehicleId:order.vehicleId,assignmentId:current?.assignmentId??(recovery?handover.assignmentId:order.currentAssignmentId),revision:(latest?.revision||0)+1,previousEventId:latest?.id,receivedAt,readingKm:input.readingKm,storageLocation:input.storageLocation,evidenceFileIds:input.evidenceFileIds,correctionReason:input.correctionReason,createdBy:actor.id,idempotencyKey:input.idempotencyKey,requestHash};
 if(electronic){data.isCurrent=!current;data.sourceSnapshot={recovery:recovery?.source??null,effectivePredecessorId:current?.id??null,handoverRevision:handover.revision,manifestHash:handover.manifestHash,fieldTaskId:handover.fieldTaskId,taskVersion:input.taskVersion??null};data.evidenceSnapshot=proof;data.factHash=receiptFactHash(data);}
 const event=await tx.vehicleReceiptEvent.create({data});
 if(!recovery){await tx.usageAccount.updateMany({where:{orderId:order.id,packStatus:'ACTIVE'},data:{packStatus:'FROZEN'}});await new EntitlementService().expire(tx,order.id);}
 await audit(tx,actor.id,current?'CORRECT_PHYSICAL_RECEIPT':'RECORD_PHYSICAL_RECEIPT','handovers',handoverId,{eventId:event.id,revision:event.revision,receivedAt:input.receivedAt,previousEventId:current?.id});return event;
}
@Controller()
export class VehicleReceiptController{
 constructor(@Inject(Db)private db:Db){}
 @Get('customer/order-changes/:id/receipts/:eventId/files/:fileId') async customerFile(@Param('id')id:string,@Param('eventId')eventId:string,@Param('fileId')fileId:string,@Req()r:any,@Res()response:any){const {file,bytes}=await this.db.serial(tx=>readSwapReceiptFile(tx,id,eventId,fileId,undefined,r.customer.id));response.setHeader('Content-Type',file.mimeType);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','private, no-store');return response.send(bytes);}
 @Get('admin/order-changes/:id/receipts/:eventId/files/:fileId') async adminFile(@Param('id')id:string,@Param('eventId')eventId:string,@Param('fileId')fileId:string,@Req()r:any,@Res()response:any){const {file,bytes}=await this.db.serial(tx=>readSwapReceiptFile(tx,id,eventId,fileId,r.admin));response.setHeader('Content-Type',file.mimeType);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','private, no-store');return response.send(bytes);}
 @Get('admin/order-changes/:id/receipts') adminRead(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>swapReceiptView(tx,id,r.admin));}
 @Get('customer/order-changes/:id/receipts') customerRead(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>swapReceiptView(tx,id,undefined,r.customer.id));}
 @Post('admin/order-changes/:id/receipts/review') review(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.db.serial(tx=>reviewSwapReceipt(tx,r.admin,id,b));}
 @Post('customer/order-changes/:id/receipts/respond') respond(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.db.serial(tx=>respondSwapReceipt(tx,r.customer.id,id,b));}
 @Post('admin/handovers/:id/receipt-review') reviewReturn(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.db.serial(tx=>reviewReturnReceipt(tx,id,b,r.admin));}
 @Post('admin/handovers/:id/received') received(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.db.serial(tx=>recordPhysicalReceipt(tx,r.admin,id,b));}
 @Post('admin/field-tasks/:id/received') field(@Param('id')id:string,@Body()b:unknown,@Req()r:any){return this.db.serial(async tx=>{const task=await tx.fieldHandoverTask.findUnique({where:{id}});ensure(task?.currentHandoverId,404,'NOT_FOUND','请先发布归还查验记录');return recordPhysicalReceipt(tx,r.admin,task.currentHandoverId,b,id);});}
}
