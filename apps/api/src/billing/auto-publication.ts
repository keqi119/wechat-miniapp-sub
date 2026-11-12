import {readElectronicSubscriptionReady} from '../electronic-documents/subscription';
import {assertVirtualPayment} from '../virtual-acceptance/payment';
import {HttpException} from '@nestjs/common';
import type {Db} from '../common/db';
import {audit,notify} from '../common/data';
import {ensure} from '../common/errors';
import {lockOrder,readContractReady} from '../offline-documents/readiness';
import {guardPhysicalReceiptBill} from '../offline-documents/vehicle-receipt';
import {readDelayPaymentGuard} from '../order-changes/finance';
import {serviceBillSequences} from '../order-changes/obligations';
import {shanghaiDay} from '../usage/rules';
import {dateOnly} from './rules';

const dayMs=86400000;
export const isAutomaticBill=(type:string)=>type==='SUBSCRIPTION'||type==='DEPOSIT';
/** A bill's PostgreSQL DATE is a calendar day, not a UTC payment instant. */
export function billAutoPublishOn(dueDate:Date):string{
 return new Date(dateOnly(dueDate.toISOString().slice(0,10)).getTime()-3*dayMs).toISOString().slice(0,10);
}
export function billAutoPublishCutoff(now:Date):Date{
 return new Date(dateOnly(shanghaiDay(now)).getTime()+3*dayMs);
}

/** Shared with read-only projections. Execution callers must first lock and reread the order/bill. */
export async function evaluateBillAutoPublication(tx:any,bill:any,now:Date):Promise<{publishOn:string}>{
 if(bill.serviceStageId){const stage=await tx.orderServiceStage.findUnique({where:{id:bill.serviceStageId}});if(stage?.changeId)await(await import('../order-renewals/cancellation-state')).assertRenewalNotCancelling(tx,stage.changeId);}
 ensure(isAutomaticBill(bill.type),409,'BILL_AUTO_PUBLICATION_UNSUPPORTED','此类费用由原专项审核流程发布');
 ensure(bill.status==='DRAFT'&&bill.paidAmount===0,409,'BILL_NOT_DRAFT','账单当前不属于待自动发布草稿');
 ensure(Number.isSafeInteger(bill.amount)&&bill.amount>0&&bill.amount<=2147483647,409,'BILL_AMOUNT_INVALID','账单金额须为有效正整数分');
 const order=await tx.order.findUnique({where:{id:bill.orderId}});
 ensure(order&&order.customerId===bill.customerId,409,'BILL_OWNERSHIP','账单与订单客户归属不一致');
 await assertVirtualPayment(tx,bill,order);
 ensure(!['CANCELLED','COMPLETED'].includes(order.status),409,'ORDER_STATE','订单已取消或完成，不可发布账单');
 if(order.contractMode==='ELECTRONIC'){const gate=await readElectronicSubscriptionReady(tx,order.id);ensure(gate.ready,409,gate.blockers[0]||'ELECTRONIC_ARCHIVE_REQUIRED','当前三方合同签署归档未就绪');ensure(bill.type!=='SUBSCRIPTION'||bill.sequence===1||order.serviceAnchor,409,'ACTUAL_DELIVERY_REQUIRED','未来订阅月须先完成实际交付');}
 else if(order.contractMode==='OFFLINE'){
  const gate=await readContractReady(tx,order.id,'PAYMENT');
  ensure(gate.ready,409,gate.blockers[0]||'OFFLINE_ARCHIVE_REQUIRED','当前线下合同资料未就绪');
 }else{
  ensure(order.contractMode==='ESIGN',409,'CONTRACT_MODE_INVALID','订单合同模式需人工核对');
  const contract=await tx.contract.findFirst({where:{orderId:order.id,customerId:bill.customerId,executionMode:'ESIGN',kind:'SUBSCRIPTION',status:'SIGNED',signedFileId:{not:null}},orderBy:{createdAt:'asc'}});
  ensure(contract&&await tx.storedFile.count({where:{id:contract.signedFileId,OR:[{customerId:bill.customerId},{customerId:null}]}}),409,'SIGNATURE_ARCHIVE_REQUIRED','电子合同须已签署并归档后才能发布账单');
 }
 await guardPhysicalReceiptBill(tx,bill);
 await readDelayPaymentGuard(tx,bill);
 const usage=await tx.usageAccount.findUnique({where:{orderId:bill.orderId}});
 if(usage?.returnedOn){
  const last=await tx.usagePeriod.aggregate({where:{accountId:usage.id,status:{not:'CANCELLED'}},_max:{sequence:true}});
  const sequence=(await serviceBillSequences(tx,bill.orderId)).get(bill.id);
  ensure(!sequence||sequence<=(last._max.sequence||0),409,'RETURN_FUTURE_BILL','车辆已交还，未来未履约月份须先结算，不可发布');
 }
 const publishOn=billAutoPublishOn(bill.dueDate);
 ensure(publishOn<=shanghaiDay(now),409,'BILL_AUTO_PUBLICATION_NOT_DUE','尚未到达约定自动发布日期');
 return{publishOn};
}

export async function publishBillAutomatically(db:Pick<Db,'serial'>,billId:string,now:Date):Promise<{published:boolean}>{
 return db.serial(async tx=>{
  const reference=await tx.bill.findUnique({where:{id:billId},select:{orderId:true}});
  if(!reference)return{published:false};
  await lockOrder(tx,reference.orderId);
  const bill=await tx.bill.findUnique({where:{id:billId}});
  // Another scheduler or a cancellation may already have consumed the draft.
  if(!bill||bill.status!=='DRAFT')return{published:false};
  const evaluation=await evaluateBillAutoPublication(tx,bill,now);
  const changed=await tx.bill.updateMany({where:{id:bill.id,status:'DRAFT',paidAmount:0},data:{status:'PENDING'}});
  if(changed.count!==1)return{published:false};
  await audit(tx,'billing-scheduler','AUTO_PUBLISH','bills',bill.id,{scheduledOn:evaluation.publishOn,dueDate:bill.dueDate.toISOString().slice(0,10),publishedAt:now.toISOString(),leadDays:3},'SYSTEM');
  await notify(tx,bill.customerId,'新账单待支付','请核对账单并主动支付。','bills',bill.id);
  return{published:true};
 });
}

export type AutomaticBillScan={scanned:number;published:number;blocked:number;failed:number};
export async function scanAutomaticBills(db:Pick<Db,'serial'|'bill'>,now:Date,options:{batchSize?:number;shouldStop?:()=>boolean}={}):Promise<AutomaticBillScan>{
 const batchSize=options.batchSize??100;
 ensure(Number.isInteger(batchSize)&&batchSize>0&&batchSize<=1000,400,'BILL_SCAN_BATCH_INVALID','账单扫描批量无效');
 const result:AutomaticBillScan={scanned:0,published:0,blocked:0,failed:0};let cursor:string|undefined;
 for(;;){
  if(options.shouldStop?.())return result;
  const batch=await db.bill.findMany({where:{status:'DRAFT',type:{in:['SUBSCRIPTION','DEPOSIT']},paidAmount:0,dueDate:{lte:billAutoPublishCutoff(now)},...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:batchSize,select:{id:true}});
  if(!batch.length)return result;
  for(const bill of batch){
   if(options.shouldStop?.())return result;
   result.scanned++;
   try{if((await publishBillAutomatically(db,bill.id,now)).published)result.published++;else result.blocked++;}
   catch(error){if(error instanceof HttpException&&[404,409].includes(error.getStatus()))result.blocked++;else result.failed++;}
  }
  // Advance past blocked drafts too; otherwise an unready first page starves all later bills.
  cursor=batch[batch.length-1].id;
  if(batch.length<batchSize)return result;
 }
}
