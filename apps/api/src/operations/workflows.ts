import {servicePeriods} from '../service-calendar/rules';
import {shanghaiDay} from '../usage/rules';
import {customerHandoverDTO,isOnlineHandover,requireOnlineConfirmation,onlineConfirmationData,requireOnlineEvidence,requireEvidenceOpened,archiveOnlineCompletion} from './online-handover';
import {requireCurrentQualification} from '../customers/qualifications';
import {assertNotAssetFiles} from '../files/asset-files';
import {handoverCommand} from '../offline-documents/handover-command';
import {changeService} from '../entitlements/service-workflow';
import {EntitlementService} from '../entitlements/service';
import {deliveryBusinessReady,leaseRange} from '../orders/business-gates';
import {createLeaseRenewalReminders} from '../insurance/reminders';
import { requireOfflineHandoverReady } from '../offline-documents/handover';
import { lockOrder } from '../offline-documents/readiness';
import { requireCurrentStaff } from '../auth/staff-session';
import { assertNewEsignAllowed } from '../offline-documents/mode';
import {customerHandoverSigningReadiness} from '../orders/customer-handover-view';
import {SignaturePolicyService} from '../esign/enterprise-seal/signature-policy.service';
import {ESIGN_SETTINGS, FadadaSettings} from '../esign/esign.settings';
import {createHandoverRecord,reviseHandoverRecord,publishHandoverRecord,guardHandoverOrder,handoverChecklistView,handoverFileIds} from './handover-records';
import {miniappReturnUrl,runNativeSigning} from '../esign/native-signing';
import {ensureAssignments} from '../vehicle-changes/assignments';
import {effectiveTerms} from '../order-changes/context';
import {guardSwapHandover,completeSwapHandover} from '../vehicle-changes/handovers';
import {reviewSegment} from '../vehicle-changes/segments';
import { Body, Controller, Get, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import {activateInitialService} from '../electronic-documents/initial-service';
import {prepareInitialServiceStageSnapshot,createInitialServiceStage} from '../order-service-stages/initial';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import { initializeUsage } from '../usage/rules';
import { recordUsageReturn } from '../usage/returns';
import { reviewUsageReading } from '../usage/usage.service';
import { claimSigning, failSigning, finishSigning, recoverSigning } from '../orders/signature-preparation';
import { deliveryReady } from '../orders/readiness';
import { SignatureService } from '../orders/signature.service';
import { ESignGateway } from '../common/gateways';
import { ensure } from '../common/errors';
import { audit, fileIds, hash, key, mobile, notify, text } from '../common/data';
async function ownedFiles(tx: any, ids: string[], customerId: string, includeAdmin = false) { const count = await tx.storedFile.count({ where: { id: { in: ids }, ...(includeAdmin ? { OR: [{ customerId }, { customerId: null }] } : { customerId }) } }); ensure(count === new Set(ids).size, 403, 'FILE_OWNERSHIP', '附件归属无效'); await assertNotAssetFiles(tx,ids); }
async function checkedHandoverCommand(...args:Parameters<typeof handoverCommand>){const result=await handoverCommand(...args);await assertNotAssetFiles(args[0],handoverFileIds(result));return result;}
@Controller()
export class WorkflowsController {
  constructor(@Inject(Db) private db: Db, @Inject(ESignGateway) private esign: ESignGateway, @Inject(SignatureService) private signatures: SignatureService, @Optional() @Inject(SignaturePolicyService) private policies?:SignaturePolicyService, @Optional() @Inject(ESIGN_SETTINGS) private signingSettings?:FadadaSettings) {}
  @Post('customer/services') async service(@Body() body: any, @Req() request: any) {
    const input = z.object({ type: z.enum(['rescue','accident','benefit']), entitlementId:text.optional(), orderId:text.optional(), location: text, description: z.string().min(1).max(5000), mobile, fileIds, idempotencyKey: key }).parse(body); const customerId = request.customer.id; const requestHash = hash(input);
    return this.db.serial(async tx => { const existing = await tx.serviceRequest.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: input.idempotencyKey } } }); if (existing) { ensure(existing.requestHash === requestHash, 409, 'IDEMPOTENCY_CONFLICT', '请求编号与内容冲突'); await assertNotAssetFiles(tx,existing.fileIds||[]); return existing; } const order = await tx.order.findFirst({ where: { ...(input.orderId?{id:input.orderId}:{}),customerId, status: 'ACTIVE' } }); ensure(order, 409, 'ACTIVE_ORDER_REQUIRED', '当前没有用车中的订阅');if(await tx.vehicleAssignment.count({where:{orderId:order.id}}))ensure(order.currentAssignmentId,409,'NO_CURRENT_VEHICLE','当前换车待交付，请联系运营处理无车期间服务'); await ownedFiles(tx, input.fileIds, customerId);ensure(input.type!=='benefit'||input.entitlementId,400,'ENTITLEMENT_REQUIRED','请选择本订单的服务权益');if(input.entitlementId)await new EntitlementService().requireServiceBinding(tx,order.id,customerId,input.entitlementId); const item = await tx.serviceRequest.create({ data: { ...input, customerId, orderId: order.id, requestHash } }); await audit(tx, customerId, 'SUBMIT', 'services', item.id, {}, 'CUSTOMER'); return item; });
  }
  @Post('customer/services/:id/cancel') cancel(@Param('id') id: string, @Body() body: any, @Req() request: any) { const { reason } = z.object({ reason: z.string().max(1000).default('') }).parse(body); return this.db.serial(async tx => { const item = await tx.serviceRequest.findFirst({ where: { id, customerId: request.customer.id } }); ensure(item, 404, 'NOT_FOUND', '工单不存在'); await assertNotAssetFiles(tx,item.fileIds||[]); ensure(item.status === 'SUBMITTED', 409, 'STATE_CONFLICT', '工单已受理，不可自行取消'); const updated = await tx.serviceRequest.update({ where: { id }, data: { status: 'CANCELLED', note: reason } }); await audit(tx, request.customer.id, 'CANCEL', 'services', id, { reason }, 'CUSTOMER'); return updated; }); }
  @Post('admin/services/:id/assign') assign(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return this.db.serial(tx=>changeService(tx,request.admin,id,body,true));}
  @Post('admin/services/:id/status') status(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return this.db.serial(tx=>changeService(tx,request.admin,id,body));}
  @Post('customer/mileages') mileage(@Body() body: any, @Req() request: any) {
    const input = z.object({ orderId: text, readingKm: z.number().int().nonnegative(), recordedAt: z.string().datetime(), fileIds: fileIds.refine(v => v.length > 0, '请上传仪表照片'), idempotencyKey: key }).parse(body); const customerId = request.customer.id;
    return this.db.serial(async tx => { const existing = await tx.mileage.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: input.idempotencyKey } } }); if (existing) { ensure(existing.orderId === input.orderId && existing.readingKm === input.readingKm && existing.recordedAt.toISOString() === new Date(input.recordedAt).toISOString() && hash(existing.fileIds) === hash(input.fileIds), 409, 'IDEMPOTENCY_CONFLICT', '请求编号与内容冲突'); await assertNotAssetFiles(tx,existing.fileIds||[]); return existing; } const order = await tx.order.findFirst({ where: { id: input.orderId, customerId, status: 'ACTIVE' } }); ensure(order, 404, 'NOT_FOUND', '用车订单不存在'); ensure(!await tx.usageAccount.count({where:{orderId:order.id}}),409,'MONTHLY_READING_REQUIRED','请从指定订阅月提交仪表照片'); ensure(input.readingKm >= order.confirmedMileageKm, 409, 'MILEAGE_REGRESSION', '申报里程不可低于已确认里程'); ensure(new Date(input.recordedAt).getTime() <= Date.now() + 300_000, 400, 'VALIDATION', '记录时间不能在未来'); await ownedFiles(tx, input.fileIds, customerId); const item = await tx.mileage.create({ data: { ...input, customerId, recordedAt: new Date(input.recordedAt) } }); await audit(tx, customerId, 'SUBMIT', 'mileages', item.id, {}, 'CUSTOMER'); return item; });
  }
  @Post('admin/mileages/:id/review') reviewMileage(@Param('id') id: string, @Body() body: any, @Req() request: any) { const input = z.object({ decision: z.enum(['APPROVED','REJECTED']), note: z.string().max(2000).default(''), boundaryConfirmed:z.boolean().optional() }).strict().parse(body); return this.db.serial(async tx => { const item = await tx.mileage.findUnique({ where: { id }, include: { order: true } }); ensure(item?.status === 'SUBMITTED', 409, 'STATE_CONFLICT', '里程记录已处理'); await assertNotAssetFiles(tx,item.fileIds||[]); if(item.segmentId)return reviewSegment(tx,item,input,request.admin.id); if(item.periodId)return reviewUsageReading(tx,item,input,request.admin.id); if (input.decision === 'APPROVED') { const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: item.order.vehicleId } }); ensure(item.order.status === 'ACTIVE' && vehicle.reservedOrderId === item.orderId && vehicle.status === 'IN_USE', 409, 'VEHICLE_OWNERSHIP', '车辆已不归属当前用车订单'); ensure(item.readingKm >= Math.max(item.order.confirmedMileageKm, vehicle.mileageKm), 409, 'MILEAGE_REGRESSION', '已有更新的确认里程'); await tx.order.update({ where: { id: item.orderId }, data: { confirmedMileageKm: item.readingKm } }); await tx.vehicle.update({ where: { id: item.order.vehicleId }, data: { mileageKm: item.readingKm } }); } const updated = await tx.mileage.update({ where: { id }, data: { status: input.decision, note: input.note, reviewedBy: request.admin.id } }); await audit(tx, request.admin.id, 'REVIEW', 'mileages', id, input); return updated; }); }
  @Post('customer/notifications/:id/read') async read(@Param('id') id: string, @Req() request: any) { const result = await this.db.notification.updateMany({ where: { id, customerId: request.customer.id, readAt: null }, data: { readAt: new Date() } }); const item = await this.db.notification.findFirst({ where: { id, customerId: request.customer.id } }); ensure(item, 404, 'NOT_FOUND', '通知不存在'); return item; }
  @Post('admin/handovers') handover(@Body() body:any,@Req() request:any) {
    const input=z.object({orderId:text,type:z.enum(['DELIVERY','RETURN']),actualAt:z.string().datetime({offset:true}),readingKm:z.number().int().nonnegative(),fileIds,checklist:z.array(z.object({label:text,value:text})).min(1).max(100)}).parse(body);
    return this.db.serial(tx=>checkedHandoverCommand(tx,request.admin,input.orderId,`CREATE_${input.type}`,body,()=>createHandoverRecord(tx,input,request.admin.id),true));
  }
  @Post('admin/handovers/:id/revise') reviseHandover(@Param('id') id:string,@Body() body:any,@Req() request:any) {
    const input=z.object({actualAt:z.string().datetime({offset:true}),readingKm:z.number().int().nonnegative(),fileIds,checklist:z.array(z.object({label:text,value:text})).min(1).max(100),resolutionNote:text}).parse(body);
    return this.db.serial(tx=>checkedHandoverCommand(tx,request.admin,id,'REVISE',body,()=>reviseHandoverRecord(tx,id,input,request.admin.id)));
  }
  @Post('admin/handovers/:id/publish') publishHandover(@Param('id') id:string,@Req() request:any,@Body()body:any={}) {return this.db.serial(tx=>checkedHandoverCommand(tx,request.admin,id,'PUBLISH',body,()=>publishHandoverRecord(tx,id,request.admin.id)));}
  @Get('customer/handovers/:id') async getHandover(@Param('id') id: string, @Req() request: any) { const item = await this.db.handover.findFirst({ where: { id, customerId: request.customer.id, status: { not: 'DRAFT' } } }); ensure(item, 404, 'NOT_FOUND', '交接单不存在'); await assertNotAssetFiles(this.db,handoverFileIds(item)); const evidence = await this.db.storedFile.findMany({ where: { id: { in: item.fileIds } }, select: { id: true, name: true, mimeType: true, size: true } }); const vehicle=item.vehicleId?await this.db.vehicle.findUnique({where:{id:item.vehicleId}}):null;const signingReadiness=await customerHandoverSigningReadiness(this.db,request.customer.id,item,this.policies,this.signingSettings);const safe=customerHandoverDTO(item);return { ...safe, checklist:handoverChecklistView(safe.checklist), vehicleTitle:vehicle?.title??null, evidence:evidence.map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,size:f.size})), signingReadiness }; }
  @Post('customer/handovers/:id/confirm') confirmHandover(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.respond(id, body, request, false); }
  @Post('customer/handovers/:id/object') objectHandover(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.respond(id, body, request, true); }
  private respond(id:string,body:any,request:any,object:boolean){
    const input=z.object({manifestHash:text,readFileIds:fileIds,reason:z.string().max(2000).default(''),fileIds,idempotencyKey:key,revision:z.number().int().positive().optional(),documentId:text.optional(),termsVersion:text.optional(),termsHash:text.optional(),termsAccepted:z.boolean().optional()}).parse(body);
    return this.db.serial(async tx=>{
      const reference=await tx.handover.findFirst({where:{id,customerId:request.customer.id}});ensure(reference,404,'NOT_FOUND','交接单不存在');await lockOrder(tx,reference.orderId);
      const item=await tx.handover.findFirst({where:{id,customerId:request.customer.id}});ensure(item,404,'NOT_FOUND','交接单不存在');ensure(item.manifestHash===input.manifestHash,409,'MANIFEST_CONFLICT','交接证据已更新');await assertNotAssetFiles(tx,handoverFileIds(item));
      const online=isOnlineHandover(item);
      if(online)ensure(input.revision===item.revision,409,'MANIFEST_CONFLICT','交接版本已更新，请更新小程序并重新读取');
      if(item.responseKey){ensure(item.responseKey===input.idempotencyKey&&item.customerResponse===(object?'OBJECT':'CONFIRM')&&(item.responseReason||'')===input.reason&&hash(item.responseFileIds)===hash(input.fileIds)&&(!online||(item.onlineConfirmation as any)?.requestHash===hash(input)),409,'IDEMPOTENCY_CONFLICT','交接单已经响应');return customerHandoverDTO(item);}
      ensure(item.status==='PUBLISHED',409,'STATE_CONFLICT','交接单尚未发布');
      let confirmation:any;
      if(object){ensure(input.reason.trim(),400,'VALIDATION','请说明异议事实');if(online)confirmation={decision:'OBJECT',customerId:item.customerId,handoverId:id,revision:item.revision,manifestHash:item.manifestHash,requestHash:hash(input),respondedAt:new Date().toISOString()};}
      else if(online){confirmation=onlineConfirmationData(item,input,request.customer.id);await requireOnlineEvidence(tx,item);await requireEvidenceOpened(tx,item,request.customer.id);await requireCurrentQualification(tx,item.customerId);const order=await tx.order.findUniqueOrThrow({where:{id:item.orderId}});if(order.contractMode==='ELECTRONIC')await requireElectronicCustomerIdentity(tx,item.customerId);}
      else ensure(item.fileIds.every(f=>input.readFileIds.includes(f)),400,'EVIDENCE_UNREAD','请阅读全部交接证据');
      await ownedFiles(tx,input.fileIds,request.customer.id);
      const updated=await tx.handover.update({where:{id},data:{status:object?'OBJECTION_SUBMITTED':'CUSTOMER_CONFIRMED',customerResponse:object?'OBJECT':'CONFIRM',responseReason:input.reason,responseFileIds:input.fileIds,responseKey:input.idempotencyKey,confirmedAt:object?null:new Date(),...(online?{onlineConfirmation:confirmation}:{})}});
      await audit(tx,request.customer.id,object?'OBJECT':'CONFIRM_FACTS','handovers',id,{manifestHash:input.manifestHash,...(online?{onlineConfirmation:confirmation}:{})},'CUSTOMER');return customerHandoverDTO(updated);
    });
  }
  @Post('admin/handovers/:id/complete') complete(@Param('id') id: string, @Req() request: any,@Body()body:any={}) {
    return this.db.serial(tx=>checkedHandoverCommand(tx,request.admin,id,'COMPLETE',body,async()=>{
      const reference=await tx.handover.findUnique({where:{id}});ensure(reference,404,'NOT_FOUND','交接不存在');await lockOrder(tx,reference.orderId);await requireCurrentStaff(tx,request.admin,'handovers');
      const item=await tx.handover.findUniqueOrThrow({where:{id},include:{order:true}});
      await assertNotAssetFiles(tx,handoverFileIds(item));
      if(item.status==='COMPLETED')return item;
      if(item.changeId)return completeSwapHandover(tx,item,request.admin.id);
      if(item.executionMode==='ELECTRONIC'){ensure(isOnlineHandover(item)&&item.status==='CUSTOMER_CONFIRMED',409,'HANDOVER_NOT_READY','须完成本版线上交接确认');await requireOnlineConfirmation(tx,item);await requireElectronicCustomerIdentity(tx,item.customerId);}
      else if(item.executionMode==='OFFLINE')await requireOfflineHandoverReady(tx,item);
      else ensure(item.status==='CUSTOMER_CONFIRMED'&&item.signatureStatus==='SIGNED',409,'HANDOVER_NOT_READY','须先确认事实并完成独立交接单签署');
      ensure(item.customerId===item.order.customerId,409,'OWNERSHIP','交接客户与订单不匹配');
      ensure(item.executionMode===item.order.contractMode,409,'EXECUTION_MODE_MISMATCH','交接执行方式与订单不匹配');
      await guardHandoverOrder(tx,item.order,item.type,item.readingKm);
      if(item.type==='DELIVERY')ensure(await deliveryReady(tx,item.orderId,item.executionMode==='ELECTRONIC'?item.actualAt??undefined:undefined),409,'HANDOVER_NOT_READY','合同、押金及首期费用尚未就绪或存在退款');
      if(item.type==='DELIVERY'&&['OFFLINE','ELECTRONIC'].includes(item.executionMode)){ensure(item.actualAt,409,'HANDOVER_DATE_REQUIRED','须记录真实交付时间');const gate=await deliveryBusinessReady(tx,item.orderId,item.actualAt||new Date());ensure(gate.ready,409,gate.blockers[0]?.code||'DELIVERY_BUSINESS_NOT_READY',gate.blockers[0]?.label||'当前交车业务资料未就绪');await audit(tx,request.admin.id,'DELIVERY_COVERAGE_CHECK','handovers',id,{coverageEvidence:gate.coverageEvidence});const terms=await effectiveTerms(tx,item.order);await createLeaseRenewalReminders(tx,item.order.vehicleId,item.executionMode==='ELECTRONIC'?new Date(servicePeriods({firstStartDay:shanghaiDay(item.actualAt),anchorDay:Number(shanghaiDay(item.actualAt).slice(-2)),ruleVersion:'V31'},1,terms.months).at(-1)!.endDayExclusive+'T00:00:00+08:00'):new Date(leaseRange(terms.startDate,terms.months).endDate),new Date());}
      if(item.type==='DELIVERY'){if(item.executionMode==='ELECTRONIC')await activateInitialService(tx,item.orderId,item.id);else await initializeUsage(tx,item.order,item);}else await recordUsageReturn(tx,item.order,item);
      const completedAt=new Date();await archiveOnlineCompletion(tx,item,request.admin.id,completedAt);
      const updated=await tx.handover.update({where:{id},data:{status:'COMPLETED',completedAt}});
      await tx.order.update({where:{id:item.orderId},data:{status:item.type==='DELIVERY'?'ACTIVE':'SETTLING',confirmedMileageKm:item.readingKm}});
      const keepHeld=item.executionMode==='OFFLINE'&&item.type==='RETURN';
      await tx.vehicle.update({where:{id:item.order.vehicleId},data:{mileageKm:item.readingKm,status:item.type==='DELIVERY'||keepHeld?'IN_USE':'UNPUBLISHED',...(keepHeld?{reservedOrderId:item.orderId}:item.type==='RETURN'?{reservedOrderId:null}:{})}});
      if(item.type==='DELIVERY')await ensureAssignments(tx,await tx.order.findUniqueOrThrow({where:{id:item.orderId}}));
      if(item.type==='DELIVERY'&&item.executionMode==='ELECTRONIC'){const current=await tx.order.findUniqueOrThrow({where:{id:item.orderId}});await createInitialServiceStage(tx,{orderId:current.id,expectedOrderRevision:current.revision,snapshot:await prepareInitialServiceStageSnapshot(tx,current)});}
      if(item.type==='DELIVERY')await new EntitlementService().grant(tx,item.orderId);else await new EntitlementService().expire(tx,item.orderId);
      await tx.fieldHandoverTask.updateMany({where:{currentHandoverId:id,status:'ASSIGNED'},data:{status:'COMPLETED',version:{increment:1}}});
      await audit(tx,request.admin.id,'COMPLETE','handovers',id);return updated;
    }));
  }
  @Post('customer/handovers/:id/sign') nativeSignHandover(@Param('id') id:string,@Req()request:any){return runNativeSigning(()=>this.signHandover(id,{...request,signingReturnUrl:miniappReturnUrl()}));}
  async signHandover(id: string, request: any) {
    const claim = await this.db.serial(async tx => {
      const handover = await tx.handover.findFirst({where:{id,customerId:request.customer.id},include:{order:true}}); ensure(handover?.status==='CUSTOMER_CONFIRMED' && handover.signatureStatus!=='SIGNED',409,'STATE_CONFLICT','请先确认交接事实');
      assertNewEsignAllowed({executionMode:handover.executionMode,contractMode:handover.order.contractMode});
      await assertNotAssetFiles(tx,handoverFileIds(handover));
      if(handover.changeId)await guardSwapHandover(tx,handover);else await guardHandoverOrder(tx,handover.order,handover.type,handover.readingKm);
      return claimSigning(tx,'HANDOVER',handover);
    });
    const item=claim.item;
    try {
      if(claim.task?.uploadedAt && ['SIGNED','REJECTED','EXPIRED'].includes(claim.task.status)){ const state=await this.signStatus(id,request);return{taskId:claim.task.id,...state}; }
      const result = await this.esign.create({ contractId:id,customerId:item.customerId,documentHash:item.manifestHash,kind:'HANDOVER',returnUrl:request.signingReturnUrl,customerName:request.customer.name,mobile:request.customer.mobile });
      await finishSigning(this.db,'HANDOVER',item,claim.leaseUntil,result.taskId);return result;
    } catch(error) { await failSigning(this.db,'HANDOVER',item,claim.leaseUntil);throw error; }
  }
  @Get('customer/handovers/:id/sign-status') async signStatus(@Param('id') id: string, @Req() request: any) {
    const view=await this.getHandover(id,request);ensure(view.executionMode!=='OFFLINE',409,'OFFLINE_EXECUTION_MODE','本交接使用纸质归档，不生成签署任务'); const recovered=await recoverSigning(this.db,'HANDOVER',id,request.customer.id);const item=recovered.item;
    if(!item.providerTaskId||recovered.pendingPreparation)return recovered.state;
    const result=await this.esign.query(item.providerTaskId);ensure(result.documentHash===item.manifestHash,409,'DOCUMENT_MISMATCH','签署文档哈希不匹配');return this.signatures.settleHandover(id,{...result,taskId:item.providerTaskId});
  }
}
