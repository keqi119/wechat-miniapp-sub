import {Db} from '../common/db';
import {isOnlineHandover,onlineHandoverReadiness} from '../operations/online-handover';
import {financeView} from '../order-changes/finance';
import {readSwapCreditAvailability} from '../vehicle-changes/credits';
import {shanghaiDay} from '../usage/rules';
import {ensure} from '../common/errors';
import {accountReadiness} from '../esign/fadada/fadada-safety';
import {requireNativeSigning} from '../esign/native-signing';
import type {SignaturePolicyService} from '../esign/enterprise-seal/signature-policy.service';
import type {FadadaSettings} from '../esign/esign.settings';
import {customerOfflineArchiveView} from './customer-contract-view';
import {fieldReceiptKind} from '../field-handover/batches';

type Stage='FACTS_PENDING'|'PREPARING'|'REVIEWING'|'READY_TO_SIGN'|'VERIFYING'|'WAITING_PLATFORM'|'ARCHIVING'|'SIGNED'|'REJECTED'|'EXPIRED'|'BLOCKED';
const messages:Record<Stage,string>={FACTS_PENDING:'请先阅读本份全部交接证据，确认事实或提交异议。',PREPARING:'交接事实已确认，等待后台准备本份签署文件。',REVIEWING:'本份签署文件正在进行双人复核，完成后再由您本人签署。',READY_TO_SIGN:'本份文件及签章条件已核验，请阅读后由您本人签署。',VERIFYING:'原签署结果尚待核验，请等待状态更新，不要重复签署。',WAITING_PLATFORM:'您的签署已核实，正在等待平台完成本份交接单签署。',ARCHIVING:'签署记录已保存，签后文件尚待核验归档。',SIGNED:'本份交接单的双方签署及归档文件已核验。',REJECTED:'本份签署未完成，请联系运营核对后续安排。',EXPIRED:'本份签署已过期，请联系运营核对后续安排。',BLOCKED:'本份交接单的签署条件尚待核对，请联系运营。'};
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(record:any,item:any,customerId:string)=>!!(record&&record.kind==='HANDOVER'&&record.resourceId===item.id&&record.customerId===customerId&&record.documentHash===item.manifestHash);
async function boundFile(db:Db,id:any,hash:any,customerId:string){
 if(typeof id!=='string'||!id||!sha(hash))return false;
 const file=await db.storedFile.findFirst({where:{id,customerId,sha256:hash,mimeType:'application/pdf',purpose:{in:['contract','handover']}},select:{id:true,customerId:true,sha256:true,mimeType:true,purpose:true}});
 return !!(file&&file.id===id&&file.customerId===customerId&&file.sha256===hash&&file.mimeType==='application/pdf'&&['contract','handover'].includes(file.purpose));
}
// Read equivalents of the business guards: the original guards acquire locks/write revisions.
// Credit availability uses the same source checks as reservation, without creating lazy gifts.
async function readableCredit(db:Db,order:any,changeId:string,actualAt:Date,targetVehicleId:string){
 const account=await db.usageAccount.findUniqueOrThrow({where:{orderId:order.id}});
 await readSwapCreditAvailability(db,order,account,changeId,actualAt,targetVehicleId);
}
async function readableBusinessState(db:Db,item:any,order:any){
 if(!item.changeId){
  ensure(['DELIVERY','RETURN'].includes(item.type)&&order.status===(item.type==='DELIVERY'?'AWAITING_HANDOVER':'ACTIVE'),409);
  ensure(!await db.orderChange.count({where:{orderId:item.orderId,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}}),409);
  if(item.type==='RETURN'){
   if(await db.vehicleAssignment.count({where:{orderId:order.id}}))ensure(order.currentAssignmentId,409);
   const known=order.currentAssignmentId?await db.usageSegment.aggregate({where:{assignmentId:order.currentAssignmentId},_max:{endReadingKm:true}}):await db.usagePeriod.aggregate({where:{orderId:order.id},_max:{endReadingKm:true}});
   ensure(item.readingKm>=(known._max.endReadingKm||0),409);
  }
  const vehicle=await db.vehicle.findUnique({where:{id:order.vehicleId}});ensure(vehicle,409);
  ensure(vehicle.id===item.vehicleId&&vehicle.reservedOrderId===order.id&&vehicle.status===(item.type==='DELIVERY'?'RESERVED':'IN_USE')&&Number.isSafeInteger(item.readingKm)&&item.readingKm>=Math.max(order.confirmedMileageKm,vehicle.mileageKm),409);
  return;
 }
 const change=await db.orderChange.findUnique({where:{id:item.changeId}});
 ensure(change?.kind==='VEHICLE_CHANGE'&&change.orderId===item.orderId&&change.customerId===item.customerId,409);
 const quote=await db.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId!},include:{contract:true}}),snapshot=quote.snapshot as any;
 ensure(order.status==='ACTIVE'&&quote.contract?.status==='SIGNED'&&quote.financePreparedAt,409);
 ensure(item.actualAt&&item.actualAt<=new Date(Date.now()+300000)&&shanghaiDay(item.actualAt)===shanghaiDay(new Date(item.type==='SWAP_RETURN'?snapshot.plannedReturnAt:snapshot.plannedDeliveryAt)),409);
 const financial=await financeView(db,change);ensure(!financial.blockers.length,409);
 const vehicle=await db.vehicle.findUnique({where:{id:item.vehicleId}});ensure(vehicle,409);
 if(item.type==='SWAP_RETURN'){
  ensure(change.status==='AWAITING_FINANCE'&&(!change.returnHandoverId||change.returnHandoverId===item.id),409);
  const assignment=await db.vehicleAssignment.findUnique({where:{id:snapshot.originalAssignmentId}});
  ensure(assignment?.status==='ACTIVE'&&order.currentAssignmentId===assignment.id&&item.assignmentId===assignment.id&&item.vehicleId===assignment.vehicleId&&vehicle.reservedOrderId===order.id&&vehicle.status==='IN_USE',409);
  const readings=await db.usageSegment.aggregate({where:{assignmentId:assignment.id},_max:{endReadingKm:true}});
  ensure(item.actualAt>=assignment.startAt&&item.readingKm>=Math.max(assignment.startReadingKm,vehicle.mileageKm,readings._max.endReadingKm||0),409);
 }else{
  ensure(item.type==='SWAP_DELIVERY'&&change.status==='SWAP_RETURNED'&&(!change.deliveryHandoverId||change.deliveryHandoverId===item.id)&&!order.currentAssignmentId,409);
  const old=await db.handover.findUnique({where:{id:change.returnHandoverId!}}),hold=vehicle.holdId?await db.vehicleHold.findUnique({where:{id:vehicle.holdId}}):null;
  ensure(old?.status==='COMPLETED'&&item.actualAt>=old.actualAt!&&hold?.changeId===change.id&&hold.quoteId===quote.id&&hold.status==='HELD'&&vehicle.id===change.targetVehicleId&&!vehicle.reservedOrderId&&vehicle.status==='PUBLISHED',409);
  ensure(item.readingKm>=vehicle.mileageKm,409);await readableCredit(db,order,change.id,item.actualAt,item.vehicleId);
 }
 ensure(!await db.usagePeriod.count({where:{orderId:order.id,status:'SETTLED',effectiveEndDate:{gt:new Date(shanghaiDay(item.actualAt))}}}),409);
}
/** Display-only: no prepare/recover/query/sign actions, transactions, provider calls or mutations. */
export async function customerHandoverSigningReadiness(db:Db,customerId:string,item:any,policies?:Pick<SignaturePolicyService,'approved'>,settings?:Pick<FadadaSettings,'enabled'|'signingEnabled'>){
 if(isOnlineHandover(item))return onlineHandoverReadiness(item,customerId);
 if(item.executionMode==='OFFLINE'){
  const base={version:2,executionMode:'OFFLINE',handoverId:item.id,manifestHash:item.manifestHash,revision:item.revision,canSign:false};
  if(item.customerId!==customerId||!sha(item.manifestHash)||!Number.isSafeInteger(item.revision)||item.revision<1)return{...base,stage:'BLOCKED',message:'本份交接记录不可读取。'};
  const archive=await customerOfflineArchiveView(db,customerId,{orderId:item.orderId,kind:fieldReceiptKind(item.type),archiveId:item.offlineArchiveId,handoverId:item.id,businessHash:item.manifestHash});
  if(archive.state==='UNAVAILABLE')return{...base,stage:'BLOCKED',message:'本份交接记录不可读取。'};
  if(item.status==='PUBLISHED'||item.status==='OBJECTION_SUBMITTED')return{...base,stage:'FACTS_PENDING',message:item.status==='OBJECTION_SUBMITTED'?'交接事实异议正在处理，请等待更新。':'请核对实际车辆、读数和照片。事实确认后仍须签署纸质交接单并归档。',archive};
  if(!['CUSTOMER_CONFIRMED','COMPLETED'].includes(item.status)||item.customerResponse!=='CONFIRM'||!item.confirmedAt)return{...base,stage:'BLOCKED',message:'请先完成本份交接事实确认。',archive};
  return{...base,stage:archive.ready?'PAPER_ARCHIVED':['SUBMITTED','MISMATCH'].includes(archive.state)?'PAPER_REVIEWING':'PAPER_PENDING',message:archive.ready?'本版本纸质交接单已审核归档。交接完成状态请以订单进度为准。':['SUBMITTED','MISMATCH'].includes(archive.state)?'纸质交接单正在核对，审核通过后由工作人员完成交接。':'交接事实已确认，请按现场安排完成纸质交接单签署，等待平台审核归档。',archive};
 }
 const view=(stage:Stage)=>({version:1,handoverId:item.id,manifestHash:item.manifestHash,revision:item.revision,stage,canSign:stage==='READY_TO_SIGN',message:messages[stage]});
 try{
  ensure(item.customerId===customerId&&sha(item.manifestHash)&&Number.isSafeInteger(item.revision)&&item.revision>0,409);
  ensure(['PUBLISHED','CUSTOMER_CONFIRMED','COMPLETED'].includes(item.status)&&['DRAFT','PENDING','SIGNED','REJECTED','EXPIRED'].includes(item.signatureStatus),409);
  if(item.status==='PUBLISHED')return view('FACTS_PENDING');
  ensure(item.customerResponse==='CONFIRM'&&item.confirmedAt&&item.actualAt&&Number.isFinite(new Date(item.actualAt).getTime())&&new Date(item.actualAt).getTime()<=Date.now()+300000,409);
  if(item.signatureStatus==='REJECTED'||item.signatureStatus==='EXPIRED')return view(item.signatureStatus);
  if(item.signatureStatus==='SIGNED'&&!item.signedFileId)return view('ARCHIVING');
  if(!policies||!settings)return view('BLOCKED');
  const order=await db.order.findFirst({where:{id:item.orderId,customerId},select:{id:true,customerId:true,status:true}});ensure(order&&order.id===item.orderId&&order.customerId===customerId,409);
  const scope={kind:'HANDOVER',resourceId:item.id,customerId,documentHash:item.manifestHash};
  const task=await db.fadadaTask.findFirst({where:{...scope,...(item.providerTaskId?{id:item.providerTaskId}:{})},orderBy:{createdAt:'desc'}});
  ensure(!item.providerTaskId||task?.id===item.providerTaskId,409);
  if(task)ensure(same(task,item,customerId)&&['PREPARED','PENDING','SIGNED','REJECTED','EXPIRED'].includes(task.status),409);
  const approval=await db.eSignApproval.findFirst({where:{...scope,...(task?{id:task.approvalId}:{})},orderBy:{createdAt:'desc'}});
  if(!approval){ensure(!task,409);if(item.signatureStatus==='PENDING')return view('VERIFYING');ensure(item.signatureStatus==='DRAFT',409);return view('PREPARING');}
  ensure(same(approval,item,customerId)&&await boundFile(db,approval.sourceFileId,approval.sourcePdfHash,customerId),409);
  if(task)ensure(task.approvalId===approval.id&&task.sourceFileId===approval.sourceFileId&&task.sourcePdfHash===approval.sourcePdfHash,409);
  if(task?.status==='REJECTED'||task?.status==='EXPIRED')return view(task.status);
  if(item.signatureStatus==='SIGNED'||task?.status==='SIGNED'){
   ensure(task&&task.uploadedAt&&task.customerSignedAt&&task.platformSignedAt,409);
   if(!task.signedFileId||!task.signedPdfHash||!item.signedFileId)return view('ARCHIVING');
   ensure(item.signatureStatus==='SIGNED'&&task.status==='SIGNED'&&task.signedFileId===item.signedFileId&&task.signedPdfHash!==task.sourcePdfHash&&await boundFile(db,task.signedFileId,task.signedPdfHash,customerId),409);
   return view('SIGNED');
  }
  if(task?.customerSignedAt){ensure(task.uploadedAt,409);return view(task.platformSignedAt?'ARCHIVING':'WAITING_PLATFORM');}
  if(task?.uploadedAt||item.signatureStatus==='PENDING'||item.signingLeaseUntil&&item.signingLeaseUntil>new Date()||task?.processingUntil&&task.processingUntil>new Date())return view('VERIFYING');
  ensure(item.status==='CUSTOMER_CONFIRMED'&&item.signatureStatus==='DRAFT',409);
  if(approval.status==='PENDING'){ensure(approval.expiresAt>new Date(),409);return view('REVIEWING');}
  ensure(approval.status==='APPROVED'&&settings.enabled===true&&settings.signingEnabled===true,409);
  requireNativeSigning();
  // Same complete document, current policy/seal, distinct active reviewers and authorities as create().
  // approved() only reads DB and PDF bytes; accounts.readiness() only reads the stored account.
  const context=await policies.approved('HANDOVER',item.id,item.manifestHash,approval.id);
  const current=context.resource;
  ensure(current.id===item.id&&current.customerId===customerId&&current.orderId===item.orderId&&current.manifestHash===item.manifestHash&&current.revision===item.revision&&current.status==='CUSTOMER_CONFIRMED'&&current.signatureStatus==='DRAFT'&&current.providerTaskId===item.providerTaskId&&(!current.signingLeaseUntil||current.signingLeaseUntil<=new Date())&&current.customerResponse==='CONFIRM'&&current.confirmedAt,409);
  ensure(current.order?.id===item.orderId&&current.order.customerId===customerId&&current.order.status===order.status&&context.approval.id===approval.id&&context.approval.sourceFileId===approval.sourceFileId&&context.approval.sourcePdfHash===approval.sourcePdfHash&&context.policy.executionMode==='SEQUENTIAL',409);
  await readableBusinessState(db,item,current.order);
  const account=await db.eSignAccount.findUnique({where:{customerId}});ensure(accountReadiness(account).readyForSigning&&account?.providerCustomerId&&account.identityCiphertext,409);
  if(task)ensure(task.customerProviderId===account.providerCustomerId&&task.platformProviderId===context.seal.providerCustomerId,409);
  return view('READY_TO_SIGN');
 }catch{return view('BLOCKED');}
}
