import type {Entity} from './core.ts';
const states=['PENDING_PAYMENT','ACTIVE','CONSUMED','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING','REFUNDED','VOID'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const pick=(v:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
export function swapPurchaseSafe(value:Record<string,unknown>):Entity{
 const safe=pick(value,['id','orderId','customerId','quantity','amount','currency','status','billId','creditId','paymentId','acceptedAt','createdAt','paidAt','expiresOn','reservedChangeId','consumedChangeId','canPay','canClose','canRequestRefund','canRestore','restoreRefundId','manualReviewRequired','statusMessage']);
 if(object(value.terms))safe.terms=pick(value.terms,['version','documentId','documentVersion','hash']);
 if(object(value.bill))safe.bill=pick(value.bill,['id','type','amount','paidAmount','status']);
 if(Array.isArray(value.refunds))safe.refunds=value.refunds.filter(object).map(r=>pick(r,['id','amount','status']));
 return safe as Entity;
}
export function validSwapPurchase(value:Record<string,unknown>){return value.quantity===1&&value.amount===80000&&value.currency==='CNY'&&states.includes(String(value.status))&&object(value.bill)&&value.bill.id===value.billId&&value.bill.type==='SWAP_CREDIT'&&value.bill.amount===80000;}
function refundable(value:Record<string,unknown>){
 if(!validSwapPurchase(value)||value.canRequestRefund!==true||!['ACTIVE','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING'].includes(String(value.status))||typeof value.paymentId!=='string'||!value.paymentId||value.reservedChangeId||value.consumedChangeId||(value.bill as Record<string,unknown>).paidAmount!==80000)return false;
 if(!Array.isArray(value.refunds)||value.refunds.some(r=>!object(r)||!['FAILED','REJECTED'].includes(String(r.status))))return false;
 return value.status!=='REFUND_PENDING'||value.refunds.length>0;
}
export function swapPurchaseActionAllowed(action:string,value:Record<string,unknown>,role?:string){
 if(role!==undefined&&!['ADMIN','FINANCE'].includes(role))return false;
 return action==='close'?validSwapPurchase(value)&&value.status==='PENDING_PAYMENT'&&value.canClose===true:action==='refund'?refundable(value):action==='restore'?restorable(value):false;
}
function restorable(value:Record<string,unknown>){return validSwapPurchase(value)&&value.status==='REFUND_PENDING'&&value.canRestore===true&&typeof value.restoreRefundId==='string'&&!value.reservedChangeId&&!value.consumedChangeId&&Array.isArray(value.refunds)&&value.refunds.length>0&&value.refunds.every(r=>object(r)&&r.status==='REJECTED')&&value.refunds.some(r=>object(r)&&r.id===value.restoreRefundId);}
export function swapCreditRestorePayload(value:Record<string,unknown>,reason:string,key?:string){if(!restorable(value))throw new Error('该来源不能恢复：须全部退款未经审批即被拒绝，并由服务端确认原次数仍可恢复');if(!reason.trim())throw new Error('请填写恢复原次数的核对原因');if(!key||key.length<8)throw new Error('请求编号缺失，请重新打开表单');return{refundId:value.restoreRefundId,reason:reason.trim(),idempotencyKey:key};}
export function swapCreditRefundPayload(value:Record<string,unknown>,reason:string,key:string){
 if(!refundable(value))throw new Error('该来源当前不支持完整例外退款，请先核对预占、消费及原退款结果');
 if(!reason.trim())throw new Error('请填写例外退款原因与依据');if(!key||key.length<8)throw new Error('请求编号缺失，请重新打开表单');
 return{paymentId:value.paymentId,amount:80000,reason:reason.trim(),idempotencyKey:key};
}
export function swapPurchaseNotice(value:Record<string,unknown>):{title:string;message:string}|undefined{
 if(value.status==='PAYMENT_REVIEW'||value.manualReviewRequired===true)return{title:'真实收款需人工核账',message:typeof value.statusMessage==='string'&&value.statusMessage.trim()?value.statusMessage:'真实晚到款已记账，可用次数为0；核对原收款与例外退款，不把已收款删除或当作未付款。'};
 if(value.status==='REFUND_PENDING')return{title:'退款未核清，次数保持冻结',message:'退款申请后次数冻结。失败、拒绝或未知结果均不自动恢复可消费；先查询原退款，只有可信成功才能记为已退。'};
 return undefined;
}
export function swapCreditStatusLabel(resource:string|undefined,status:string){if(resource!=='swap-credit-purchases')return undefined;return({PENDING_PAYMENT:'待可信到账',ACTIVE:'已可信到账',CONSUMED:'已实际消费',EXPIRED:'已到期失效',PAYMENT_REVIEW:'到账需人工核账',REFUND_PENDING:'退款核对中，次数冻结',REFUNDED:'已可信退款',VOID:'购买已撤销'}as Record<string,string>)[status];}
