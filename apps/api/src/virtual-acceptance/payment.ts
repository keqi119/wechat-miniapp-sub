import {ensure} from '../common/errors';
import {assertVirtualOrder} from './quotes';

/** New receivables/payment requests only. Verified money reconciliation never calls this gate. */
export async function assertVirtualPayment(tx:any,bill:any,order:any){
 const scope=await assertVirtualOrder(tx,order);if(!scope)return;
 ensure(bill.orderId===scope.orderId&&bill.customerId===scope.customerId&&bill.amount===100&&!bill.serviceStageId&&((bill.type==='DEPOSIT'&&bill.sequence===0)||(bill.type==='SUBSCRIPTION'&&bill.sequence===1)),409,'VIRTUAL_PAYMENT_SCOPE_REQUIRED','仅允许指定测试订单的100分押金和100分首期付款');
}
