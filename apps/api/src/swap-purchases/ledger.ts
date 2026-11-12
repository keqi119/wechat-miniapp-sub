import {randomUUID} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {lockAccount} from '../usage/rules';
import {currentPhysicalReceipt} from '../offline-documents/vehicle-receipt';
import {withinTerm} from './rules';
import {readHistoricalSwapSource,withinSwapSource} from '../order-service-stages/swap-source';
import {swapPurchaseEnabled,requireSwapPurchaseEligibility} from './availability';
import {validateSwapPurchase,validateSwapCredit,validateSwapPurchaseCredit,frozenAddonSwapSource} from './policy';
async function readMoneySource(tx:any,order:any,account:any,p:any,allowFrozen=false){
 ensure(account?.orderId===order.id&&account.customerId===order.customerId,409,'SWAP_PURCHASE_SOURCE','购买资金与本单用量账户归属不符');
 try{const source=await readHistoricalSwapSource(tx,order,account,p?.serviceStageId);validateSwapPurchase(order,p,undefined,undefined,source);return{source,invalid:false};}
 catch(error){if(!(allowFrozen&&p?.pricingSnapshot?.version===3&&error instanceof HttpException&&[404,409].includes(error.getStatus())))throw error;return{source:frozenAddonSwapSource(order,p),invalid:true};}
}
/** Only exception receipts/refunds may consult the immutable ENDED source, never payment or use guards. */
export async function readSwapPurchaseReviewSource(tx:any,order:any,account:any,p:any){return(await readMoneySource(tx,order,account,p,['PAYMENT_REVIEW','REFUND_PENDING','REFUNDED'].includes(p?.status))).source;}
// All callers use a serial transaction. The order/account lock is shared with
// swap reservations, completion, physical return and refund approval.
export async function guardSwapPayment(tx:any,bill:any,now:Date){
 if(bill.type!=='SWAP_CREDIT')return;const account=await lockAccount(tx,bill.orderId),order=await tx.order.findUniqueOrThrow({where:{id:bill.orderId}}),p=await tx.swapCreditPurchase.findUnique({where:{billId:bill.id}});
 ensure(swapPurchaseEnabled(order),409,'SWAP_NOT_PAYABLE','本版换车次数新支付暂未开放');await requireSwapPurchaseEligibility(tx,order,now);const source=await readHistoricalSwapSource(tx,order,account,p?.serviceStageId);validateSwapPurchase(order,p,bill,undefined,source);
 ensure(p.status==='PENDING_PAYMENT'&&withinSwapSource(order,account,source,now)&&now<p.expiresAt,409,'SWAP_NOT_PAYABLE','换车次数购买已结束或订阅已归还/到期，请查询原支付记录');
}
export async function grantSwapCredit(tx:any,bill:any,paymentId:string,now:Date,forceFreeze=false){
 if(bill.type!=='SWAP_CREDIT')return;const account=await lockAccount(tx,bill.orderId),order=await tx.order.findUniqueOrThrow({where:{id:bill.orderId}}),p=await tx.swapCreditPurchase.findUnique({where:{billId:bill.id}}),payment=await tx.payment.findUniqueOrThrow({where:{id:paymentId}});
 const {source,invalid:sourceInvalid}=await readMoneySource(tx,order,account,p,true),amount=validateSwapPurchase(order,p,bill,payment,source),policySnapshot=source.policy;
 if(p.paymentId===paymentId&&p.creditId){const credit=await tx.swapCredit.findUniqueOrThrow({where:{id:p.creditId}});validateSwapCredit(order,credit,source);ensure(credit.sourcePaymentId===paymentId,409,'SWAP_PAYMENT_CONFLICT','原付款次数来源冲突');return p.pricingSnapshot?.version===3&&p.status==='PAYMENT_REVIEW'?'SWAP_ADDON_PAYMENT_REVIEW':null;}
 ensure(['PENDING_PAYMENT','VOID'].includes(p.status),409,'SWAP_PAYMENT_CONFLICT','换车次数真实付款与购买记录不一致，需核账');
 const physicalReturn=!!await currentPhysicalReceipt(tx,bill.orderId),active=!physicalReturn&&account.packStatus==='ACTIVE'&&!sourceInvalid&&!forceFreeze&&p.status!=='VOID'&&withinSwapSource(order,account,source,now)&&now<p.expiresAt,credit=await tx.swapCredit.create({data:{orderId:bill.orderId,source:'PAID',sourcePaymentId:paymentId,status:active?'ACTIVE':'FROZEN',...(source.serviceStageId?{serviceStageId:source.serviceStageId}:{}),...(policySnapshot?{policySnapshot}:{})}});
 await tx.swapCreditPurchase.update({where:{id:p.id},data:{paymentId,creditId:credit.id,paidAt:now,status:active?'ACTIVE':'PAYMENT_REVIEW'}});await tx.swapLedger.create({data:{orderId:bill.orderId,purchaseId:p.id,creditId:credit.id,source:'PAID',type:'GRANT',sourceKey:'grant:'+paymentId}});
 if(!active){await tx.swapLedger.create({data:{orderId:bill.orderId,purchaseId:p.id,creditId:credit.id,source:'PAID',type:'FREEZE',sourceKey:'late:'+paymentId}});if(p.pricingSnapshot?.version!==3){await tx.returnSettlement.updateMany({where:{orderId:bill.orderId,status:'COMPLETED'},data:{status:'PENDING_PAYMENT',completedAt:null,revision:{increment:1}}});await tx.order.updateMany({where:{id:bill.orderId,status:'COMPLETED'},data:{status:'SETTLING'}});}}
 await audit(tx,'payment-provider',active?'GRANT_SWAP_CREDIT':'LATE_SWAP_PAYMENT_REVIEW','orders',bill.orderId,{purchaseId:p.id,paymentId,amount,sourceInvalid},'PROVIDER');
 return p.pricingSnapshot?.version===3&&!active?(physicalReturn||account.packStatus!=='ACTIVE'?'SWAP_ADDON_PHYSICAL_RETURN':sourceInvalid?'SWAP_ADDON_SOURCE_INVALID':'SWAP_ADDON_EXPIRED'):null;
}
async function expireCredit(tx:any,orderId:string,credit:any,purchaseId?:string){
 const reservations=await tx.swapReservation.findMany({where:{creditId:credit.id,status:'RESERVED'}});for(const r of reservations){await tx.swapReservation.update({where:{id:r.id},data:{status:'RELEASED'}});await tx.swapLedger.create({data:{orderId,changeId:r.changeId,...(purchaseId?{purchaseId}:{}),creditId:credit.id,source:credit.source,type:'RELEASE',sourceKey:'release:'+r.id}});}
 await tx.swapCredit.update({where:{id:credit.id},data:{status:'EXPIRED'}});await tx.swapLedger.create({data:{orderId,...(purchaseId?{purchaseId}:{}),creditId:credit.id,source:credit.source,type:'EXPIRE',sourceKey:purchaseId?'expire-swap:'+purchaseId:'expire-term:'+credit.id}});
}
/** Caller holds Order -> UsageAccount. No revision increments, paid changes or new grants. */
export async function expireSwapStageFreeCredits(tx:any,order:any,account:any,now:Date,returned=false){
 const rows=await tx.swapCredit.findMany({where:{orderId:order.id,source:'FREE',status:'ACTIVE',consumedChangeId:null}});
 for(const credit of rows){const source=await readHistoricalSwapSource(tx,order,account,credit.serviceStageId);validateSwapCredit(order,credit,source);if(returned||account.returnedOn||now>=source.endAt)await expireCredit(tx,order.id,credit);}
}
/** Preserve the historical ESIGN read contract only when NO stage has ever been recorded. */
export async function refreshLegacySwapExpiry(tx:any,order:any,now:Date){
 if(order.contractMode!=='ESIGN')return;
 if((await tx.orderServiceStage.findMany({where:{orderId:order.id},select:{id:true},take:1})).length)return;
 const account=await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}});if(withinTerm(order,account,now))return;
 await expireSwapPurchases(tx,order.id,now);
}
export async function expireSwapPurchases(tx:any,orderId:string,now:Date,returned=false){
 if(!await tx.swapCreditPurchase.count({where:{orderId,status:{in:['ACTIVE','PENDING_PAYMENT']}}})&&!await tx.swapCredit.count({where:{orderId,source:'FREE',status:'ACTIVE',consumedChangeId:null}}))return;
 const account=await lockAccount(tx,orderId),order=await tx.order.findUniqueOrThrow({where:{id:orderId}}),rows=await tx.swapCreditPurchase.findMany({where:{orderId,status:{in:['ACTIVE','PENDING_PAYMENT']}}});
 for(const p of rows){const source=await readHistoricalSwapSource(tx,order,account,p.serviceStageId);validateSwapPurchase(order,p,undefined,undefined,source);if(!returned&&!account.returnedOn&&now<p.expiresAt)continue;
  if(p.status==='PENDING_PAYMENT'){if(await tx.payment.count({where:{billId:p.billId,status:{in:['CREATING','PENDING','SUCCEEDED']}}}))continue;await tx.bill.update({where:{id:p.billId},data:{status:'VOID'}});await tx.swapCreditPurchase.update({where:{id:p.id},data:{status:'VOID'}});continue;}
  const credit=await tx.swapCredit.findUniqueOrThrow({where:{id:p.creditId}});validateSwapPurchaseCredit(order,p,credit,source);if(credit.consumedChangeId)continue;await expireCredit(tx,orderId,credit,p.id);await tx.swapCreditPurchase.update({where:{id:p.id},data:{status:'EXPIRED'}});
 }
 await expireSwapStageFreeCredits(tx,order,account,now,returned);
}
async function extraSwapReceipt(tx:any,payment:any,bill:any,account:any,p:any,credit:any,amount:number,order:any){
 if(p?.paymentId===payment.id)return false;
 const scope=await readSwapPurchaseReviewSource(tx,order,account,p),expected=validateSwapPurchase(order,p,bill,payment,scope);validateSwapPurchaseCredit(order,p,credit,scope);
 ensure(p&&credit&&p.paidAt&&['ACTIVE','CONSUMED','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING','REFUNDED'].includes(p.status)&&payment.status==='SUCCEEDED'&&payment.providerTransactionId&&payment.reconciliationRequired===true&&amount===expected&&payment.amount===expected&&p.amount===expected&&payment.billId===bill.id&&p.billId===bill.id&&p.orderId===bill.orderId&&account.orderId===bill.orderId&&account.customerId===payment.customerId&&bill.customerId===payment.customerId&&p.customerId===payment.customerId&&credit.id===p.creditId&&credit.orderId===p.orderId&&credit.source==='PAID'&&credit.sourcePaymentId===p.paymentId,409,'SWAP_REFUND_REVIEW','额外换车到账缺少本账单已发放的原付款权益');
 ensure(!await tx.swapCredit.count({where:{sourcePaymentId:payment.id}})&&!await tx.swapLedger.count({where:{type:'GRANT',sourceKey:'grant:'+payment.id}}),409,'SWAP_REFUND_REVIEW','额外到账已关联权益，须核对原权益退款');
 const grants=await tx.swapLedger.findMany({where:{purchaseId:p.id,type:'GRANT'}}),grant=grants[0],source=await tx.payment.findUnique({where:{id:p.paymentId}});
 ensure(grants.length===1&&grant.orderId===p.orderId&&grant.purchaseId===p.id&&grant.creditId===credit.id&&grant.source==='PAID'&&grant.sourceKey==='grant:'+p.paymentId&&source&&source.id===p.paymentId&&source.id!==payment.id&&source.status==='SUCCEEDED'&&source.providerTransactionId&&source.providerTransactionId!==payment.providerTransactionId&&source.billId===bill.id&&source.customerId===payment.customerId&&source.amount===expected,409,'SWAP_REFUND_REVIEW','原换车次数须对应本账单另一笔可核验成功付款');
 return true;
}
export async function guardSwapRefund(tx:any,payment:any,amount:number){const bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});if(bill.type!=='SWAP_CREDIT')return;const account=await lockAccount(tx,bill.orderId),p=await tx.swapCreditPurchase.findUnique({where:{billId:bill.id}}),credit=p?.creditId?await tx.swapCredit.findUnique({where:{id:p.creditId}}):null,order=await tx.order.findUniqueOrThrow({where:{id:bill.orderId}});
 const source=await readSwapPurchaseReviewSource(tx,order,account,p),expected=validateSwapPurchase(order,p,bill,payment,source);if(credit)validateSwapPurchaseCredit(order,p,credit,source);
 if(await extraSwapReceipt(tx,payment,bill,account,p,credit,amount,order)){await audit(tx,'refund-review','CHECK_EXTRA_SWAP_RECEIPT_REFUND','orders',bill.orderId,{purchaseId:p.id,paymentId:payment.id,amount});return;}
 ensure(p&&credit&&amount===expected&&payment.amount===expected&&p.paymentId===payment.id&&['ACTIVE','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING'].includes(p.status)&&!credit.consumedChangeId&&!await tx.swapReservation.count({where:{creditId:credit.id,status:'RESERVED'}}),409,'SWAP_REFUND_REVIEW','仅完整未使用且未预占的换车次数可申请全额例外退款；部分金额或已使用不可通用退款');await tx.swapCredit.update({where:{id:credit.id},data:{status:'FROZEN'}});await tx.swapCreditPurchase.update({where:{id:p.id},data:{status:'REFUND_PENDING'}});if(p.status!=='REFUND_PENDING')await tx.swapLedger.create({data:{orderId:bill.orderId,purchaseId:p.id,creditId:credit.id,source:'PAID',type:'FREEZE',sourceKey:'refund-freeze:'+p.id+':'+randomUUID()}});}
export async function settleSwapRefund(tx:any,refund:any){if(refund.payment.bill.type!=='SWAP_CREDIT')return;const account=await lockAccount(tx,refund.payment.bill.orderId),p=await tx.swapCreditPurchase.findUniqueOrThrow({where:{billId:refund.payment.billId}}),order=await tx.order.findUniqueOrThrow({where:{id:p.orderId}});
 const scope=await readSwapPurchaseReviewSource(tx,order,account,p),expected=validateSwapPurchase(order,p,refund.payment.bill,refund.payment,scope),source=await tx.swapCredit.findUniqueOrThrow({where:{id:p.creditId}});validateSwapPurchaseCredit(order,p,source,scope);
 ensure(refund.paymentId===refund.payment.id&&refund.customerId===refund.payment.customerId,409,'SWAP_REFUND_CONFLICT','退款与原付款归属不一致');
 if(p.paymentId!==refund.paymentId){const credit=p.creditId?await tx.swapCredit.findUnique({where:{id:p.creditId}}):null;if(await extraSwapReceipt(tx,refund.payment,refund.payment.bill,account,p,credit,refund.amount,order)){await audit(tx,'payment-provider','SETTLE_EXTRA_SWAP_RECEIPT_REFUND','orders',p.orderId,{purchaseId:p.id,paymentId:refund.paymentId,refundId:refund.id,amount:refund.amount},'PROVIDER');return;}}
 ensure(p.status==='REFUND_PENDING'&&p.paymentId===refund.paymentId&&refund.amount===expected,409,'SWAP_REFUND_CONFLICT','换车次数退款与冻结来源不一致');await tx.swapCredit.update({where:{id:p.creditId},data:{status:'REFUNDED'}});await tx.swapCreditPurchase.update({where:{id:p.id},data:{status:'REFUNDED'}});await tx.swapLedger.create({data:{orderId:p.orderId,purchaseId:p.id,creditId:p.creditId,source:'PAID',type:'REFUND',sourceKey:'swap-refund:'+refund.id}});}
