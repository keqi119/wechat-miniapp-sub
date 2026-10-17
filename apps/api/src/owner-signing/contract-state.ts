import {ensure} from '../common/errors';
import {hash} from '../common/data';

/** New dispatches require the exact still-active customer-confirmed amendment. */
export function requireOwnerContractCurrent(resource:any){
 if(resource.kind==='SUBSCRIPTION'){
  ensure(resource.order.status==='AWAITING_SIGNATURE',409,'SIGNATURE_STATE','当前订单不可发起合同签署');return;
 }
 const q=resource.delayQuote,change=q?.change,doc=q?.snapshot?.document;
 ensure(resource.kind==='AMENDMENT'&&q?.status==='CONFIRMED'&&q.confirmedAt&&change?.activeQuoteId===q.id&&change.status==='AWAITING_SIGNATURE'&&change.orderId===resource.orderId&&change.customerId===resource.customerId&&q.commercialHash===resource.documentHash&&doc?.bodyHash===hash(resource.body)&&doc.content===resource.body,409,'AMENDMENT_STATE','补充协议不是当前经客户确认的版本');
}
