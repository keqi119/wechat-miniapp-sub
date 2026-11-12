import {guardCancellation04Delivery} from '../orders/cancellation04-gates';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {readElectronicSubscriptionReady} from './subscription';
import {initializeUsage,shanghaiDay} from '../usage/rules';
import {servicePeriods,validTermMonths} from '../service-calendar/rules';
import {dateOnly} from '../billing/rules';
import {readDeliveryFunding} from '../orders/readiness';
/** Existing authorized delivery transaction owns locks/RBAC/revision. Never invoke from GET or archive callback. */
export async function activateInitialService(tx:any,orderId:string,actualDeliveryEventId:string){
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
 const order=await tx.order.findUniqueOrThrow({where:{id:orderId}}),event=await tx.handover.findUnique({where:{id:actualDeliveryEventId}}),t=order.finalPlanSnapshot;
 ensure(order.contractMode==='ELECTRONIC'&&event?.orderId===order.id&&event.customerId===order.customerId&&event.vehicleId===order.vehicleId&&event.type==='DELIVERY'&&!event.changeId&&event.confirmationMode==='ONLINE_RECORD'&&['CUSTOMER_CONFIRMED','COMPLETED'].includes(event.status)&&event.actualAt&&event.actualAt<=new Date(Date.now()+300000),409,'INITIAL_DELIVERY_REQUIRED','须引用本单真实已确认初次交付事件');
 const existing=await tx.auditLog.findFirst({where:{resourceType:'orders',resourceId:orderId,action:'V31_INITIAL_SERVICE_STARTED'}});
 if(existing){ensure(existing.data?.actualDeliveryEventId===event.id&&order.serviceAnchor?.firstStartDay===shanghaiDay(event.actualAt),409,'INITIAL_DELIVERY_CONFLICT','原始实际交付锚点不可替换');return order.serviceAnchor;}
 await guardCancellation04Delivery(tx,orderId);
 ensure(!order.serviceAnchor&&order.status==='AWAITING_HANDOVER'&&!order.effectiveTermsVersionId&&t.months===t.productSnapshot?.months&&t.productSnapshot?.minimumTermMonths!=null&&validTermMonths(t.months,t.productSnapshot?.minimumTermMonths),409,'INITIAL_DELIVERY_CONFLICT','本单已起租或期限来源无效');
 ensure((await readElectronicSubscriptionReady(tx,order.id)).ready&&(await readDeliveryFunding(tx,order)).ready,409,'HANDOVER_NOT_READY','须先完成三方归档及首期有效到账');
 const actual=shanghaiDay(event.actualAt),anchor={firstStartDay:actual,anchorDay:Number(actual.slice(-2)),ruleVersion:'V31' as const},rows=servicePeriods(anchor,1,t.months);
 const bills=await tx.bill.findMany({where:{orderId,customerId:order.customerId,type:'SUBSCRIPTION'},orderBy:{sequence:'asc'}});
 ensure(bills.some((b:any)=>b.sequence===1)&&bills.every((b:any)=>b.sequence>=1&&b.sequence<=t.months&&b.amount===t.monthlyFeeAmount),409,'INITIAL_BILL_SOURCE','原订阅账单金额或期次不符');
 for(const row of rows){const bill=bills.find((b:any)=>b.sequence===row.index);
  if(!bill)await tx.bill.create({data:{orderId,customerId:order.customerId,type:'SUBSCRIPTION',sequence:row.index,amount:t.monthlyFeeAmount,dueDate:dateOnly(row.startDay)}});
  else if(row.index>1){ensure(bill.status==='DRAFT'&&bill.paidAmount===0&&!await tx.payment.count({where:{billId:bill.id}}),409,'INITIAL_BILL_SOURCE','未来期已有资金事实，须人工核对');await tx.bill.update({where:{id:bill.id},data:{dueDate:dateOnly(row.startDay)}});}
 }
 const current=await tx.order.update({where:{id:orderId},data:{serviceAnchor:anchor}});await initializeUsage(tx,current,event);
 await audit(tx,'actual-delivery','V31_INITIAL_SERVICE_STARTED','orders',orderId,{actualDeliveryEventId:event.id,serviceAnchor:anchor,commercialHash:t.commercialHash},'SYSTEM');return anchor;
}
