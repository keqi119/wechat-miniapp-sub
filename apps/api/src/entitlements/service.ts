import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {requireCurrentStaff} from '../auth/staff-session';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {lockOrder} from '../offline-documents/readiness';
import {benefitInput} from '../products/types';
import {commandInput,consumeInput,reserveInput,releaseInput,reverseInput,EntitlementActor,EntitlementBalances,EntitlementLedgerFact,EntitlementReservationFact,EntitlementRow,EntitlementTx,EntitlementView} from './types';

type FrozenRow={orderId:string;customerId:string;sourceKey:string;productVersionId:string|null;benefitVersionId:string|null;title:string;description:string;status:'PENDING';kind:'DESCRIPTION'|'COUNT';unit:string|null;totalQuantity:number|null;sourceSnapshot:Record<string,unknown>;sourceHash:string};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function buildFrozenEntitlements(order:{id:string;customerId:string;finalPlanSnapshot:unknown}):FrozenRow[]{
 const snapshot=record(order.finalPlanSnapshot),product=record(snapshot.productSnapshot);
 if(snapshot.productSnapshot!==undefined&&snapshot.productSnapshot!==null){
  ensure(typeof product.productVersionId==='string'&&product.productVersionId&&Array.isArray(product.benefits),409,'ENTITLEMENT_SNAPSHOT_REQUIRED','订单的已确认产品权益快照不完整');
  const keys=new Set<string>();return product.benefits.map((raw:unknown)=>{
   const item=record(raw);ensure(typeof item.benefitVersionId==='string'&&item.benefitVersionId&&!keys.has(item.benefitVersionId),409,'ENTITLEMENT_SNAPSHOT_REQUIRED','订单权益版本缺失或重复');keys.add(item.benefitVersionId);
   const benefit=benefitInput.parse(Object.fromEntries(['kind','name','description','provider','conditions','validity','unit','totalQuantity'].map(k=>[k,item[k]])));
   ensure(benefit.kind!=='COUNT'||!/(?:换车(?:次数|额度)|里程(?:额度|包|次数))/.test(benefit.name),409,'ENTITLEMENT_EXISTING_LEDGER','里程及换车额度继续使用原有账本');
   const sourceSnapshot={...benefit,benefitVersionId:item.benefitVersionId,definitionId:item.definitionId,version:item.version,productVersionId:product.productVersionId};
   return{orderId:order.id,customerId:order.customerId,sourceKey:item.benefitVersionId,productVersionId:product.productVersionId as string,benefitVersionId:item.benefitVersionId,title:benefit.name,description:benefit.description,status:'PENDING',kind:benefit.kind,unit:benefit.unit,totalQuantity:benefit.totalQuantity,sourceSnapshot,sourceHash:hash(sourceSnapshot)};
  });
 }
 // Old text is an historical promise, never an inferred usable counter.
 const titles=Array.isArray(snapshot.benefits)?snapshot.benefits.filter((v):v is string=>typeof v==='string'&&!!v.trim()):[];
 return titles.map((title,index)=>{const sourceSnapshot={kind:'DESCRIPTION',name:title,description:'以已确认方案及纸质合同约定为准',provider:'以已确认合同为准',conditions:'人工核对服务约定',validity:'ORDER',unit:null,totalQuantity:null};return{orderId:order.id,customerId:order.customerId,sourceKey:`legacy:${index}:${hash(title).slice(0,16)}`,productVersionId:null,benefitVersionId:null,title,description:sourceSnapshot.description,status:'PENDING',kind:'DESCRIPTION',unit:null,totalQuantity:null,sourceSnapshot,sourceHash:hash(sourceSnapshot)};});
}
export function entitlementBalance(item:{kind:string;status:string;totalQuantity:number|null},reservations:EntitlementReservationFact[],entries:EntitlementLedgerFact[]):EntitlementBalances{
 const pending=reservations.filter(r=>r.status==='RESERVED');
 if(item.kind!=='COUNT')return{totalQuantity:null,reservedQuantity:null,usedQuantity:null,availableQuantity:null,expiredQuantity:null,pendingServiceCount:pending.length};
 const total=item.totalQuantity;ensure(Number.isSafeInteger(total)&&total!>0,409,'ENTITLEMENT_LEDGER_INVALID','权益额度缺失');
 const reserved=pending.reduce((n,r)=>n+r.quantity,0),used=entries.reduce((n,e)=>n+(e.type==='CONSUME'?e.quantity:e.type==='REVERSE'?-e.quantity:0),0);
 ensure(Number.isSafeInteger(reserved)&&reserved>=0&&Number.isSafeInteger(used)&&used>=0&&used+reserved<=total!,409,'ENTITLEMENT_LEDGER_INVALID','权益流水须人工核对');
 const remaining=total!-reserved-used;
 return{totalQuantity:total,reservedQuantity:reserved,usedQuantity:used,availableQuantity:item.status==='ACTIVE'?remaining:0,expiredQuantity:item.status==='EXPIRED'?remaining:0,pendingServiceCount:pending.length};
}
export function assertReservationCapacity(balance:EntitlementBalances,quantity:number){ensure(Number.isSafeInteger(quantity)&&quantity>0&&balance.availableQuantity!==null&&quantity<=balance.availableQuantity,409,'ENTITLEMENT_EXHAUSTED','可用服务次数不足');}
export function assertReverseCapacity(original:number,reversed:number,quantity:number){ensure(Number.isSafeInteger(quantity)&&quantity>0&&reversed>=0&&quantity<=original-reversed,409,'ENTITLEMENT_REVERSE_LIMIT','冲正不可超过原已使用次数');}
export function assertServiceConsumption(status:string){ensure(status==='COMPLETED',409,'SERVICE_STATE','服务履约完成时才可核销次数');}

export class EntitlementService {
 async view(tx:EntitlementTx,item:EntitlementRow):Promise<EntitlementView>{
  const [reservations,entries]=await Promise.all([tx.entitlementReservation.findMany({where:{entitlementId:item.id}}),tx.entitlementLedger.findMany({where:{entitlementId:item.id}})]),source=record(item.sourceSnapshot);
  return{id:item.id,orderId:item.orderId,customerId:item.customerId,title:item.title,description:item.description,status:item.status,kind:item.kind==='COUNT'?'COUNT':'DESCRIPTION',unit:item.kind==='COUNT'?item.unit:null,revision:item.revision,benefitVersionId:item.benefitVersionId,provider:typeof source.provider==='string'?source.provider:'以已确认合同为准',conditions:typeof source.conditions==='string'?source.conditions:'人工核对服务约定',validity:'ORDER',activatedAt:item.activatedAt,expiredAt:item.expiredAt,...entitlementBalance(item,reservations,entries)};
 }
 async list(tx:EntitlementTx,orderId:string,customerId?:string):Promise<EntitlementView[]>{
  ensure(await tx.order.findFirst({where:{id:orderId,...(customerId?{customerId}:{})}}),404,'NOT_FOUND','订单不存在');
  const items=await tx.entitlement.findMany({where:{orderId,...(customerId?{customerId}:{})},orderBy:{createdAt:'asc'}});return Promise.all(items.map(item=>this.view(tx,item)));
 }
 async freeze(tx:EntitlementTx,orderId:string):Promise<EntitlementView[]>{
  await lockOrder(tx,orderId);const order=await tx.order.findUniqueOrThrow({where:{id:orderId}}),existing=await tx.entitlement.findMany({where:{orderId}}),product=record(record(order.finalPlanSnapshot).productSnapshot);
  // Existing pre-migration description rows are retained verbatim.
  if(!product.productVersionId&&existing.length)return Promise.all(existing.map(item=>this.view(tx,item)));
  const rows=buildFrozenEntitlements(order);
  ensure(!existing.some(item=>!item.sourceKey&&rows.length>0),409,'ENTITLEMENT_MIGRATION_REQUIRED','已有权益须先核对历史映射，不重复授予');
  for(const row of rows){const old=existing.find(item=>item.sourceKey===row.sourceKey);if(old){ensure(old.sourceHash===row.sourceHash&&old.customerId===order.customerId,409,'ENTITLEMENT_SNAPSHOT_CHANGED','已冻结权益与订单快照不一致');continue;}ensure(!['COMPLETED','CANCELLED','SETTLING'].includes(order.status),409,'ORDER_STATE','已结束订单不可新增权益');await tx.entitlement.create({data:{...row,sourceSnapshot:row.sourceSnapshot as Prisma.InputJsonValue}});}
  return this.list(tx,orderId);
 }
 async grant(tx:EntitlementTx,orderId:string):Promise<EntitlementView[]>{
  await lockOrder(tx,orderId);const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});
  ensure(order.status==='ACTIVE'&&await tx.handover.count({where:{orderId,type:'DELIVERY',status:'COMPLETED'}}),409,'ENTITLEMENT_DELIVERY_REQUIRED','完成正式交车后才可激活权益');
  await this.freeze(tx,orderId);const pending=await tx.entitlement.findMany({where:{orderId,status:'PENDING'}});
  for(const item of pending){await tx.entitlement.update({where:{id:item.id},data:{status:'ACTIVE',activatedAt:new Date(),revision:{increment:1}}});await tx.entitlementLedger.create({data:{entitlementId:item.id,orderId,customerId:item.customerId,type:'GRANT',quantity:item.totalQuantity||0,actorId:'order-delivery',idempotencyKey:`grant:${item.id}`,reason:'正式交车激活整单约定权益'}});}
  if(pending.length)await audit(tx,'order-delivery','ENTITLEMENTS_GRANTED','orders',orderId,{entitlementIds:pending.map(e=>e.id)},'SYSTEM');return this.list(tx,orderId);
 }
 async expire(tx:EntitlementTx,orderId:string):Promise<EntitlementView[]>{
  await lockOrder(tx,orderId);const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});
  ensure(['SETTLING','COMPLETED','CANCELLED'].includes(order.status)||await tx.vehicleReceiptEvent.count({where:{orderId,isCurrent:true}}),409,'ENTITLEMENT_RETURN_REQUIRED','记录实际收车或订单结束后才能到期权益');
  const items=await tx.entitlement.findMany({where:{orderId,status:{in:['PENDING','ACTIVE']}}});
  for(const item of items){const view=await this.view(tx,item);await tx.entitlement.update({where:{id:item.id},data:{status:'EXPIRED',expiredAt:new Date(),revision:{increment:1}}});await tx.entitlementLedger.create({data:{entitlementId:item.id,orderId,customerId:item.customerId,type:'EXPIRE',quantity:view.availableQuantity||0,actorId:'order-return',idempotencyKey:`expire:${item.id}`,reason:'未使用权益到期，在途预占保留待处理'}});}
  if(items.length)await audit(tx,'order-return','ENTITLEMENTS_EXPIRED','orders',orderId,{entitlementIds:items.map(e=>e.id)},'SYSTEM');return this.list(tx,orderId);
 }
 private async command(tx:EntitlementTx,ctx:EntitlementActor,id:string,action:string,input:z.infer<typeof commandInput>,run:(item:EntitlementRow)=>Promise<void>):Promise<EntitlementView>{
  await requireCurrentStaff(tx,ctx,'entitlements');ensure(['ADMIN','OPERATIONS'].includes(ctx.role),403,'ENTITLEMENT_OPERATOR_REQUIRED','权益次数由运营人员处理');
  const reference=await tx.entitlement.findUnique({where:{id}});ensure(reference,404,'NOT_FOUND','权益不存在');await lockOrder(tx,reference.orderId);await tx.$queryRaw`SELECT id FROM "Entitlement" WHERE id = ${id} FOR UPDATE`;
  const item=await tx.entitlement.findUniqueOrThrow({where:{id}}),requestHash=hash(input),where={entitlementId_action_idempotencyKey:{entitlementId:id,action,idempotencyKey:input.idempotencyKey}},old=await tx.entitlementCommand.findUnique({where});
  if(old){ensure(old.actorId===ctx.id&&old.requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT','权益操作编号与人员或内容冲突');return old.resultSnapshot as unknown as EntitlementView;}
  ensure(item.revision===input.revision,409,'REVISION_CONFLICT','权益记录已更新，请刷新');
  const order=await tx.order.findUniqueOrThrow({where:{id:item.orderId}}),service=await tx.serviceRequest.findUnique({where:{id:input.serviceRequestId}});
  ensure(item.customerId===order.customerId&&service?.orderId===item.orderId&&service.customerId===item.customerId&&service.entitlementId===item.id,409,'ENTITLEMENT_SERVICE_SCOPE','工单须关联本客户本订单权益');
  ensure(item.kind==='COUNT',409,'ENTITLEMENT_DESCRIPTION_ONLY','说明型权益不使用次数账本');
  await run(item);const updated=await tx.entitlement.update({where:{id},data:{revision:{increment:1}}}),result=await this.view(tx,updated);
  await tx.entitlementCommand.create({data:{entitlementId:id,actorId:ctx.id,action,idempotencyKey:input.idempotencyKey,requestHash,resultSnapshot:JSON.parse(JSON.stringify(result))}});await audit(tx,ctx.id,`ENTITLEMENT_${action}`,'entitlements',id,{serviceRequestId:service.id,revision:result.revision,idempotencyKey:input.idempotencyKey});return result;
 }
 async reserve(tx:EntitlementTx,ctx:EntitlementActor,id:string,raw:unknown):Promise<EntitlementView>{const input=reserveInput.parse(raw);return this.command(tx,ctx,id,'RESERVE',input,async item=>{
  const order=await tx.order.findUniqueOrThrow({where:{id:item.orderId}}),service=await tx.serviceRequest.findUniqueOrThrow({where:{id:input.serviceRequestId}});
  ensure(item.status==='ACTIVE'&&order.status==='ACTIVE'&&!await tx.vehicleReceiptEvent.count({where:{orderId:order.id,isCurrent:true}}),409,'ENTITLEMENT_INACTIVE','权益未激活或车辆已收回，不能新增预占');
  ensure(['ACCEPTED','ASSIGNED','IN_PROGRESS'].includes(service.status),409,'SERVICE_STATE','服务受理后才可预占权益');ensure(!await tx.entitlementReservation.findUnique({where:{serviceRequestId:service.id}}),409,'ENTITLEMENT_ALREADY_RESERVED','此工单已有预占或处理记录');assertReservationCapacity(await this.view(tx,item),input.quantity);
  const reservation=await tx.entitlementReservation.create({data:{entitlementId:id,orderId:item.orderId,customerId:item.customerId,serviceRequestId:service.id,quantity:input.quantity,reservedBy:ctx.id}});await tx.entitlementLedger.create({data:{entitlementId:id,orderId:item.orderId,customerId:item.customerId,serviceRequestId:service.id,reservationId:reservation.id,type:'RESERVE',quantity:input.quantity,actorId:ctx.id,idempotencyKey:input.idempotencyKey}});
 });}
 async consume(tx:EntitlementTx,ctx:EntitlementActor,id:string,raw:unknown):Promise<EntitlementView>{const input=consumeInput.parse(raw);return this.command(tx,ctx,id,'CONSUME',input,async item=>{
  const reservation=await tx.entitlementReservation.findUnique({where:{id:input.reservationId}}),service=await tx.serviceRequest.findUniqueOrThrow({where:{id:input.serviceRequestId}});
  ensure(reservation?.entitlementId===id&&reservation.serviceRequestId===input.serviceRequestId&&reservation.status==='RESERVED',409,'ENTITLEMENT_RESERVATION_STATE','预占记录不匹配或已处理');assertServiceConsumption(service.status);
  await tx.entitlementReservation.update({where:{id:reservation.id},data:{status:'CONSUMED',resolvedBy:ctx.id,resolvedAt:new Date()}});await tx.entitlementLedger.create({data:{entitlementId:id,orderId:item.orderId,customerId:item.customerId,serviceRequestId:service.id,reservationId:reservation.id,type:'CONSUME',quantity:reservation.quantity,actorId:ctx.id,idempotencyKey:input.idempotencyKey}});
 });}
 async release(tx:EntitlementTx,ctx:EntitlementActor,id:string,raw:unknown):Promise<EntitlementView>{const input=releaseInput.parse(raw);return this.command(tx,ctx,id,'RELEASE',input,async item=>{
  const reservation=await tx.entitlementReservation.findUnique({where:{id:input.reservationId}}),service=await tx.serviceRequest.findUniqueOrThrow({where:{id:input.serviceRequestId}});
  ensure(reservation?.entitlementId===id&&reservation.serviceRequestId===input.serviceRequestId&&reservation.status==='RESERVED',409,'ENTITLEMENT_RESERVATION_STATE','预占记录不匹配或已处理');ensure(service.status==='CANCELLED',409,'SERVICE_STATE','取消服务后才可释放预占');
  await tx.entitlementReservation.update({where:{id:reservation.id},data:{status:'RELEASED',resolvedBy:ctx.id,resolvedAt:new Date()}});await tx.entitlementLedger.create({data:{entitlementId:id,orderId:item.orderId,customerId:item.customerId,serviceRequestId:service.id,reservationId:reservation.id,type:'RELEASE',quantity:reservation.quantity,actorId:ctx.id,idempotencyKey:input.idempotencyKey,reason:input.reason}});
 });}
 async reverse(tx:EntitlementTx,ctx:EntitlementActor,id:string,raw:unknown):Promise<EntitlementView>{const input=reverseInput.parse(raw);return this.command(tx,ctx,id,'REVERSE',input,async item=>{
  const original=await tx.entitlementLedger.findUnique({where:{id:input.entryId}});ensure(original?.type==='CONSUME'&&original.entitlementId===id&&original.serviceRequestId===input.serviceRequestId,409,'ENTITLEMENT_REVERSE_SOURCE','须关联本工单原核销记录');const reversed=await tx.entitlementLedger.aggregate({where:{originalEntryId:original.id,type:'REVERSE'},_sum:{quantity:true}});assertReverseCapacity(original.quantity,reversed._sum.quantity||0,input.quantity);
  await tx.entitlementLedger.create({data:{entitlementId:id,orderId:item.orderId,customerId:item.customerId,serviceRequestId:input.serviceRequestId,reservationId:original.reservationId,type:'REVERSE',quantity:input.quantity,originalEntryId:original.id,actorId:ctx.id,idempotencyKey:input.idempotencyKey,reason:input.reason}});
 });}
 async requireServiceBinding(tx:EntitlementTx,orderId:string,customerId:string,entitlementId:string){await lockOrder(tx,orderId);const item=await tx.entitlement.findFirst({where:{id:entitlementId,orderId,customerId,status:'ACTIVE'}});ensure(item,404,'NOT_FOUND','当前订单权益不存在或未激活');const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});ensure(order.customerId===customerId&&order.status==='ACTIVE'&&!await tx.vehicleReceiptEvent.count({where:{orderId,isCurrent:true}}),409,'ENTITLEMENT_INACTIVE','车辆已收回或订单已结束，不可新建权益服务');return this.view(tx,item);}
}
