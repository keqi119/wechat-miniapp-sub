import {requireOrderChangeScope,orderChangeScopeEnabled} from '../offline-documents/change-mode';
import {assertRealVehicle} from '../virtual-acceptance/scope';
import {swapAccountView} from './account';
import {Inject,Injectable} from '@nestjs/common';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {financialContext,lockOrder,terminal} from '../order-changes/context';
import {USAGE_CLOCK} from '../usage/rules';
import {requireCurrentStaff} from '../auth/staff-session';
import {offlineSwapEligibility} from './offline-facts';
@Injectable()
export class VehicleChangesService {
 constructor(@Inject(Db)readonly db:Db,@Inject(USAGE_CLOCK)readonly clock:()=>Date){}
 async account(tx:any,orderId:string,customerId?:string){return swapAccountView(tx,orderId,this.clock(),customerId);}
 async adminContext(tx:any,id:string,actor:any){await requireCurrentStaff(tx,actor,'order-changes',false);const context=await this.context(tx,id);return{...context,canCreate:context.canCreate&&['ADMIN','OPERATIONS'].includes(actor.role)};}
 async context(tx:any,id:string){const a=await this.account(tx,id),order=await tx.order.findUniqueOrThrow({where:{id}}),f=await financialContext(tx,order),active=await tx.orderChange.findFirst({where:{orderId:id,status:{notIn:terminal}}}),offline=['OFFLINE','ELECTRONIC'].includes(order.contractMode)?await offlineSwapEligibility(tx,order,this.clock()):null;return{orderId:id,orderRevision:order.revision,priorTermsHash:hash(f.terms),startDate:a.startedOn,endDate:a.endDate,months:f.terms.months,depositAmount:f.terms.depositAmount,periods:f.rows.map(({payments,sourceBillIds,...r}:any)=>r),currentAssignment:a.currentAssignment,swapAccount:a,offline,canCreate:orderChangeScopeEnabled(order,'VEHICLE_CHANGE')&&a.canRequest&&!f.blockers.length&&(!offline||offline.ready),activeChangeId:active?.id??null,blockers:[...a.blockers,...f.blockers,...(offline?.blockers||[]),...(orderChangeScopeEnabled(order,'VEHICLE_CHANGE')?[]:['本版变更请联系平台办理线下资料'])],capabilityNote:order.contractMode==='ELECTRONIC'?'原押金、原服务月与里程权益沿用；旧车实际收回独立留存，新车完成交付前核验03、本人实际金额确认及当期和已到期资金。':'先归还旧车，再交付新车；原期限、里程月和里程包不重置。本次应退、押金调整及交付所在期应收核清后交旧车。'};}
 async create(orderId:string,input:any,actor?:any,customerId?:string){return this.db.serial(async tx=>{
  if(actor){await requireCurrentStaff(tx,actor,'order-changes',true);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅当前运营可发起换车');}else ensure(customerId,403,'FORBIDDEN','请先登录');
  const order=await tx.order.findFirst({where:{id:orderId,...(customerId?{customerId}:{})}});ensure(order,404,'NOT_FOUND','订单不存在');
  const old=await tx.orderChange.findUnique({where:{orderId_idempotencyKey:{orderId,idempotencyKey:input.idempotencyKey}}});if(old){ensure(old.kind==='VEHICLE_CHANGE'&&old.requestHash===hash(input)&&old.createdBy===(actor?.id||customerId),409,'IDEMPOTENCY_CONFLICT','请求编号已用于其他内容');return{id:old.id,kind:old.kind,status:old.status,revision:old.revision};}
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const current=await tx.order.findUniqueOrThrow({where:{id:orderId}});await assertRealVehicle(tx,current.vehicleId);requireOrderChangeScope(current,'VEHICLE_CHANGE');
  const context=await this.context(tx,orderId);ensure(context.canCreate,409,'CHANGE_BLOCKED',context.blockers.join('；'));if(actor)ensure(current.revision===input.expectedOrderRevision&&context.priorTermsHash===input.priorTermsHash,409,'VERSION_CONFLICT','订单条款已更新');
  const offline=context.offline;ensure(!offline||offline.contractId,409,'SIGNATURE_REQUIRED','主合同依据尚未完整');const contract=offline?await tx.contract.findUnique({where:{id:offline.contractId!}}):await tx.contract.findFirst({where:{orderId,kind:'SUBSCRIPTION',status:'SIGNED'}});ensure(contract,409,'SIGNATURE_REQUIRED','主合同依据尚未完整');
  const f=await financialContext(tx,current);await lockOrder(tx,orderId);
  const c=await tx.orderChange.create({data:{orderId,customerId:current.customerId,kind:'VEHICLE_CHANGE',priorTermsHash:context.priorTermsHash,priorTerms:f.terms,originalContractId:contract.id,...(offline?{originalArchiveVersionId:offline.originalArchiveVersionId,priorTermsVersionId:offline.priorTermsVersionId}:{}),reason:input.reason,createdBy:actor?.id||customerId,idempotencyKey:input.idempotencyKey,requestHash:hash(input)}});await audit(tx,actor?.id||customerId,'VEHICLE_CHANGE_REQUEST','order-changes',c.id,{},actor?'ADMIN':'CUSTOMER');return{id:c.id,kind:c.kind,status:c.status,revision:c.revision};});}
}
