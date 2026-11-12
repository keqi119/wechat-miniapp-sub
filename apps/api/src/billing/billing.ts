import {archiveCommand} from '../offline-documents/command';
import {assertVirtualPayment} from '../virtual-acceptance/payment';
import {assertIndependentStaffReview} from '../partners/capabilities';
import {RefundBankService,refundNotice,refundConflict,refundReissueConflict} from './refund-bank';
import {refundStaff,lockRefund,refundObligationGuard,independentRefundSource,consumeRefundAuthorization,refundReplacementChain,assertRefundReplacementOpen} from './refund-execution';
import {safeRefund,normalRefundAmount} from './refund-proof';
import type {RefundChannelFacts} from '../common/gateways';
import {guardCancellation04Refund,lockCancellation04Refund} from '../orders/cancellation04-gates';
import {reconcileOrdinaryReceivable,remainingBillPayment} from './receivable-state';
import {guardPhysicalReceiptBill} from '../offline-documents/vehicle-receipt';
import {assertNotInspectionFiles} from '../vehicle-inspections/service';
import {isAutomaticBill} from './auto-publication';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertRenewalCancellationRefundManaged,guardRenewalCancellationRefund,isRenewalCancellationRefund,lockRenewalCancellationRefund,requireCancellationRefundStaff} from './renewal-cancellation-refunds';
import {guardSwapPayment,grantSwapCredit,guardSwapRefund,settleSwapRefund} from '../swap-purchases/ledger';
import {contractReady,lockOrder,requireContractReady} from '../offline-documents/readiness';
import {USAGE_CLOCK,lockAccount} from '../usage/rules';
import {swapPurchaseEnabled} from '../swap-purchases/availability';
import {serviceBillSequences} from '../order-changes/obligations';
import { guardDelayPayment,allocateDelayPayment } from '../order-changes/finance';
import {stagePaymentBlocker,allocateStageSwapPayment} from './stage-payments';
import { guardPackRefund, settlePackRefund } from '../usage/refunds';
import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Req } from '@nestjs/common';
import { advanceToHandover } from '../orders/readiness';
import { dateOnly } from './rules';
import { grantPaidPack, guardPackPayment } from '../usage/ledger';
import { z } from 'zod';
import { Db } from '../common/db';
import { PaymentGateway, parsePaymentSuccessTime } from '../common/gateways';
import {recordSimpleRevenuePayment,recordSimpleRevenueRefund} from '../partners/simple-revenue';
import { ensure } from '../common/errors';
import { audit, fileIds, hash, key, money, notify, text } from '../common/data';
@Injectable()
export class BillingService {
  constructor(@Inject(Db) private db: Db, @Inject(PaymentGateway) private gateway: PaymentGateway, @Inject(USAGE_CLOCK) private clock:()=>Date=()=>new Date()) {}
  private code(error: unknown) { return error instanceof HttpException ? (error.getResponse() as any)?.error?.code : undefined; }
  private freshParameters(parameters: any) { const timestamp = Number(parameters?.timeStamp); return Number.isFinite(timestamp) && Date.now() / 1000 - timestamp >= 0 && Date.now() / 1000 - timestamp < 110 * 60; }
  private async paymentGuards(tx:any,bill:any,order:any){
    await assertVirtualPayment(tx,bill,order);
    ensure(bill.status==='PENDING'&&await remainingBillPayment(tx,bill,order)>0,409,'BILL_NOT_PAYABLE','账单当前不可支付');
    ensure(!['CANCELLED','COMPLETED'].includes(order.status),409,'ORDER_STATE','订单当前不可支付');
    if(['OFFLINE','ELECTRONIC'].includes(order.contractMode))await requireContractReady(tx,bill.orderId,'PAYMENT');
    if(order.contractMode==='ELECTRONIC'&&bill.type==='SUBSCRIPTION'&&bill.sequence>1)ensure(order.serviceAnchor,409,'ACTUAL_DELIVERY_REQUIRED','未来订阅月须先实际交付');
    await guardPhysicalReceiptBill(tx,bill);
    if(bill.type==='SWAP_CREDIT')ensure(swapPurchaseEnabled(order),503,'SWAP_PURCHASE_DISABLED','付费换车次数购买暂未开放');
    await guardSwapPayment(tx,bill,this.clock());await guardDelayPayment(tx,bill);
    const usage=await tx.usageAccount.findUnique({where:{orderId:bill.orderId}});
    if(usage){await tx.usageAccount.update({where:{id:usage.id},data:{revision:{increment:1}}});if(usage.returnedOn){const last=await tx.usagePeriod.aggregate({where:{accountId:usage.id,status:{not:'CANCELLED'}},_max:{sequence:true}});const sequence=(await serviceBillSequences(tx,bill.orderId)).get(bill.id);ensure(!sequence||sequence<=(last._max.sequence||0),409,'RETURN_FUTURE_BILL','车辆已交还，未来未履行月份须先结算，不可继续支付');}}
    await guardPackPayment(tx,bill,this.clock());
  }
  /** One successful Payment transition owns this review; duplicate receipts return above it. */
  private async reviewAddonReceipt(tx:any,bill:any,paymentId:string,reason:string){
    const p=bill.type==='SWAP_CREDIT'?await tx.swapCreditPurchase.findUnique({where:{billId:bill.id}}):bill.type==='MILEAGE_PACK'?await tx.mileagePurchase.findUnique({where:{billId:bill.id}}):null;
    if(!(p?.pricingSnapshot?.version===3&&bill.type==='SWAP_CREDIT'||p?.ruleVersion==='MILEAGE_PACK_V2'&&bill.type==='MILEAGE_PACK'))return;
    await lockAccount(tx,bill.orderId);
    await tx.returnSettlement.updateMany({where:{orderId:bill.orderId,status:'COMPLETED'},data:{status:'PENDING_PAYMENT',completedAt:null,revision:{increment:1}}});
    await tx.order.updateMany({where:{id:bill.orderId,status:'COMPLETED'},data:{status:'SETTLING'}});
    await audit(tx,'payment-provider','ADDON_RECEIPT_REVIEW','payments',paymentId,{billId:bill.id,purchaseId:p.id,reason},'PROVIDER');
  }
  async guardExecutionFunds(tx:any,item:any,verifiedCancellation:boolean){
    await assertRefundReplacementOpen(tx,item);
    if(!item.obligationId&&verifiedCancellation&&item.renewalCancellationId){
      const record=await tx.orderRenewalCancellation.findUnique({where:{id:item.renewalCancellationId}});
      // Existing, fully source-verified version1 late05 refunds retain their reviewed refund-before-REFUNDED path.
      if(record?.sourceSnapshot?.version===1)return;
      if(record?.sourceSnapshot?.version===31)ensure(item.obligationId,409,'REFUND_OBLIGATION_REQUIRED');
    }
    await refundObligationGuard(tx,item.payment,item.amount,item.obligationId,item.id);
  }
  async refundEffects(tx:any,refund:any){
    await settleSwapRefund(tx,refund);await settlePackRefund(tx,refund);
    if(['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(refund.payment.bill.type))await tx.depositEntry.create({data:{customerId:refund.customerId,orderId:refund.payment.bill.orderId,refundId:refund.id,type:'REFUND',amount:refund.amount}});
    await recordSimpleRevenueRefund(tx,refund.id);await reconcileOrdinaryReceivable(tx,refund.payment.billId);
  }
  async settleRefund(refundId: string, event: RefundChannelFacts & { status: 'PROCESSING'|'SUCCEEDED'|'FAILED'; providerRefundId?: string; paymentId: string; amount: number; totalAmount: number; succeededAt?: string }) {
    return this.db.serial(async tx => {
      const reference = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: { include: { bill: true } } } });
      if(reference)await lockOrder(tx,reference.payment.bill.orderId);
      if(reference?.payment.bill.type==='SWAP_CREDIT')await tx.order.update({where:{id:reference.payment.bill.orderId},data:{revision:{increment:1}}});
      const refund = reference?await tx.refund.findUnique({where:{id:refundId},include:{payment:{include:{bill:true}}}}):null;
      ensure(refund && refund.paymentId === event.paymentId && refund.amount === event.amount && refund.payment.amount === event.totalAmount, 409, 'REFUND_MISMATCH', '退款归属或金额不匹配');
      if(refund.method==='MANUAL_BANK'){
        ensure(!(refund.channelEvidence as any)?.providerRefundId||event.providerRefundId===((refund.channelEvidence as any)?.providerRefundId),409,'REFUND_MISMATCH');
        if(event.status!=='SUCCEEDED'||event.receiptDestination&&event.receiptDestination!=='CUSTOMER'){
          const terminal=event.nativeStatus==='CLOSED'||event.nativeStatus==='SUCCESS'&&event.receiptDestination==='MERCHANT';
          const updated=await tx.refund.update({where:{id:refundId},data:{channelEvidence:JSON.parse(JSON.stringify(event)),channelState:event.nativeStatus??'UNKNOWN',...(!refund.bankExecution?{status:terminal?'PENDING_APPROVAL':'PROCESSING',approvedBy:null,bankAccount:{...(refund.bankAccount as any),status:terminal?'SUBMITTED':'SUSPENDED_ORIGINAL_UNCERTAINTY'},revision:{increment:1}}:{})}});
          if(refund.bankExecution&&!terminal)await tx.payment.update({where:{id:refund.paymentId},data:{reconciliationRequired:true,reconciliationReason:'ORIGINAL_CHANNEL_REOPENED_AFTER_BANK_RECEIPT',revision:{increment:1}}});
          return safeRefund(updated);
        }
        if(refund.bankExecution){
          const receipt={method:'WECHAT_ORIGINAL',refundId,providerRefundId:event.providerRefundId,amount:event.amount,succeededAt:parsePaymentSuccessTime(event.succeededAt,this.clock())?.toISOString()??this.clock().toISOString()};
          if((refund.bankExecution as any).status!=='VERIFIED'&&refund.status!=='SUCCEEDED'){
            // Original customer receipt is already real; the recorded bank claim remains independently reviewable.
            const original=await tx.refund.update({where:{id:refundId},data:{method:'WECHAT_ORIGINAL',status:'SUCCEEDED',providerRefundId:event.providerRefundId,succeededAt:new Date(receipt.succeededAt),channelState:'SUCCESS',channelEvidence:JSON.parse(JSON.stringify(event)),bankAccount:{...(refund.bankAccount as any),status:'INVALIDATED_BY_ORIGINAL_SUCCESS',invalidatedAt:this.clock().toISOString(),invalidatedReason:'TRUSTED_ORIGINAL_SUCCESS'},revision:{increment:1}}});
            await this.refundEffects(tx,{...original,payment:refund.payment});
          }
          if(!refund.duplicateReceipt)await refundConflict(tx,refund,receipt,refund.bankExecution);
          return safeRefund(await tx.refund.findUniqueOrThrow({where:{id:refundId}}));
        }
        // No bank execution was recorded: the trusted customer receipt invalidates the pending bank authority.
        const changed=await tx.refund.update({where:{id:refundId},data:{method:'WECHAT_ORIGINAL',status:'PROCESSING',providerRefundId:event.providerRefundId,bankAccount:{...(refund.bankAccount as any),status:'INVALIDATED_BY_ORIGINAL_SUCCESS',invalidatedAt:this.clock().toISOString(),invalidatedReason:'TRUSTED_ORIGINAL_SUCCESS'},revision:{increment:1}}});Object.assign(refund,changed);
      }
      ensure(['PROCESSING','SUCCEEDED','FAILED'].includes(refund.status), 409, 'REFUND_STATE', '退款未获批准或已终止');
      ensure(!refund.providerRefundId||!event.providerRefundId||refund.providerRefundId===event.providerRefundId,409,'REFUND_MISMATCH');
      const acceptedAt=parsePaymentSuccessTime(event.acceptedAt,this.clock());
      const channelFacts={...(acceptedAt&&!refund.acceptedAt?{acceptedAt}:{}),...(event.nativeStatus?{channelState:event.nativeStatus==='SUCCESS'&&event.receiptDestination==='MERCHANT'?'MERCHANT_RETURNED':event.nativeStatus,channelEvidence:JSON.parse(JSON.stringify(event))}:{}),failureCode:event.status==='FAILED'?'CHANNEL_CLOSED':null};
      const confirmedAt=this.clock(),channelSuccessAt=event.status==='SUCCEEDED'?parsePaymentSuccessTime(event.succeededAt,confirmedAt):undefined;
      if (refund.status === 'SUCCEEDED') { ensure(!event.providerRefundId || event.providerRefundId === refund.providerRefundId, 409, 'REFUND_MISMATCH', '退款渠道单号不匹配'); const current=await tx.refund.update({where:{id:refundId},data:{...channelFacts,...(!refund.succeededAt&&channelSuccessAt?{succeededAt:channelSuccessAt}:{})}});if(event.status==='SUCCEEDED'&&normalRefundAmount(refund)>0){await recordSimpleRevenueRefund(tx,refundId);await reconcileOrdinaryReceivable(tx,refund.payment.billId);}return safeRefund(current); }
      const updated = await tx.refund.update({ where: { id: refundId }, data: { ...channelFacts,status: event.status, ...(event.providerRefundId ? { providerRefundId: event.providerRefundId } : {}),...(event.status==='SUCCEEDED'?{succeededAt:refund.succeededAt||channelSuccessAt||confirmedAt}:{}) } });
      if (event.status === 'SUCCEEDED') {
        ensure(event.providerRefundId, 409, 'REFUND_MISMATCH', '渠道退款单号缺失');
        const chain=await refundReplacementChain(tx,refund),normal=chain.find((r:any)=>r.id!==refundId&&r.status==='SUCCEEDED'&&normalRefundAmount(r)>0);
        if(normal){await refundReissueConflict(tx,updated,normal);return safeRefund(await tx.refund.findUniqueOrThrow({where:{id:refundId}}));}
        const unsent=chain.filter((r:any)=>r.id!==refundId&&r.status==='PENDING_APPROVAL'&&!r.dispatchedAt);
        if(unsent.length)await tx.refund.updateMany({where:{id:{in:unsent.map((r:any)=>r.id)}},data:{status:'REJECTED',failureCode:'REPLACED_EXECUTION_ALREADY_PAID',revision:{increment:1}}});
        if(chain.some((r:any)=>r.id!==refundId&&r.status==='PROCESSING'))await tx.payment.update({where:{id:refund.paymentId},data:{reconciliationRequired:true,reconciliationReason:'REFUND_REISSUE_EXECUTION_UNRESOLVED',revision:{increment:1}}});
        await this.refundEffects(tx,{...updated,payment:refund.payment});
      }
      if(refund.obligationId)await refundNotice(tx,updated,event.status);
      await audit(tx, 'payment-provider', 'REFUND_STATUS', 'refunds', refundId, { status: event.status, amount: event.amount }, 'PROVIDER');
      return safeRefund(updated);
    });
  }
  async settle(paymentId: string, event: { status: 'PENDING'|'SUCCEEDED'|'FAILED'|'CLOSED'; amount: number; transactionId?: string; succeededAt?: string }) {
    return this.db.serial(async tx => {
      const reference = await tx.payment.findUnique({ where: { id: paymentId }, include: { bill: true } });
      // Acquire the same order lock before touching money rows. Close/return
      // already lock order first; reversing that order can deadlock a receipt.
      if(reference)await lockOrder(tx,reference.bill.orderId);
      const payment = reference?await tx.payment.findUnique({where:{id:paymentId},include:{bill:true}}):null; ensure(payment, 404, 'NOT_FOUND', '支付记录不存在');
      ensure(event.amount === payment.amount, 409, 'PAYMENT_MISMATCH', '支付金额不匹配');
      const confirmedAt=this.clock(),channelSuccessAt=event.status==='SUCCEEDED'?parsePaymentSuccessTime(event.succeededAt,confirmedAt):undefined;
      if (payment.status === 'SUCCEEDED') { ensure(event.status !== 'SUCCEEDED' || event.transactionId === payment.providerTransactionId, 409, 'PAYMENT_MISMATCH', '支付交易号不匹配');const current=!payment.succeededAt&&channelSuccessAt?await tx.payment.update({where:{id:paymentId},data:{succeededAt:channelSuccessAt}}):payment;if(event.status==='SUCCEEDED')await recordSimpleRevenuePayment(tx,paymentId);return current; }
      if (payment.status === 'CLOSED' && event.status !== 'SUCCEEDED') return payment;
      let reconciliationReason:string|null=null;
      if (event.status === 'SUCCEEDED') {
        ensure(event.transactionId, 409, 'PAYMENT_MISMATCH', '渠道交易号缺失');
        const order=await tx.order.findUniqueOrThrow({where:{id:payment.bill.orderId}});
        let remaining=payment.bill.paidAmount===0?payment.bill.amount:0;
        if(payment.bill.status==='PENDING'){try{remaining=await remainingBillPayment(tx,payment.bill,order);}catch(error){if(!(error instanceof HttpException))throw error;remaining=0;}}
        const billCurrent=(payment.bill.status==='PENDING'||(payment.bill.type==='SWAP_CREDIT'&&payment.bill.status==='VOID'))&&remaining>0&&payment.amount===remaining;
        if(!billCurrent)reconciliationReason='BILL_CHANGED_AFTER_PAYMENT_REQUEST';
        else if(['CANCELLED','COMPLETED'].includes(order.status))reconciliationReason='ORDER_CLOSED_AFTER_PAYMENT_REQUEST';
        else if(['OFFLINE','ELECTRONIC'].includes(order.contractMode)){
          try{const gate=await contractReady(tx,order.id,'PAYMENT');if(!gate.ready)reconciliationReason=gate.blockers[0]||'OFFLINE_ARCHIVE_REQUIRED';}
          catch(error){if(this.code(error)==='TERMS_MISSING')reconciliationReason='TERMS_MISSING';else throw error;}
        }
        if(!reconciliationReason&&(payment.bill.serviceStageId||payment.bill.type==='SWAP_ADJUSTMENT'))reconciliationReason=await stagePaymentBlocker(tx,payment.bill,payment);
        // A verified receipt is an immutable money fact, even when local paperwork
        // or a cancelled bill now requires manual allocation/refund reconciliation.
        if(billCurrent)await tx.bill.update({where:{id:payment.billId},data:{paidAmount:payment.bill.paidAmount+payment.amount,status:'PAID'}});
        const swapBlocker=billCurrent?await grantSwapCredit(tx,payment.bill,payment.id,this.clock(),!!reconciliationReason):null;reconciliationReason=reconciliationReason||swapBlocker||null;
        const packBlocker=await grantPaidPack(tx,payment.bill,payment.id,this.clock(),channelSuccessAt,reconciliationReason);reconciliationReason=reconciliationReason||packBlocker||null;
        if(reconciliationReason)await this.reviewAddonReceipt(tx,payment.bill,payment.id,reconciliationReason);
        if(!reconciliationReason){if(!await allocateStageSwapPayment(tx,payment))await allocateDelayPayment(tx,payment);}
        if (['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(payment.bill.type)) await tx.depositEntry.create({ data: { customerId: payment.customerId, orderId: payment.bill.orderId, paymentId: payment.id, type: 'RECEIPT', amount: payment.amount } });
        await notify(tx, payment.customerId, '付款已确认', '渠道已核验付款到账。', 'payments', payment.id);
      }
      const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: event.status, ...(event.transactionId ? { providerTransactionId: event.transactionId } : {}),...(event.status==='SUCCEEDED'?{revision:{increment:1},reconciliationRequired:!!reconciliationReason,reconciliationReason,succeededAt:payment.succeededAt||channelSuccessAt||confirmedAt}:{}) } });
      if(event.status==='SUCCEEDED')await recordSimpleRevenuePayment(tx,paymentId);
      if (event.status === 'SUCCEEDED'&&!reconciliationReason) await advanceToHandover(tx, payment.bill.orderId);
      await audit(tx, 'payment-provider', 'PAYMENT_STATUS', 'payments', paymentId, { status: event.status, amount: event.amount,reconciliationReason }, 'PROVIDER');
      return updated;
    });
  }
  async pay(customer: any, billId: string, idempotencyKey: string) {
    ensure(customer.openId, 409, 'WECHAT_REQUIRED', '支付前请绑定当前小程序微信身份');
    const claim = await this.db.serial(async tx => {
      const reference=await tx.bill.findFirst({where:{id:billId,customerId:customer.id}});ensure(reference,404,'NOT_FOUND','账单不存在');await lockOrder(tx,reference.orderId);
      const bill=await tx.bill.findUniqueOrThrow({where:{id:billId}}),order=await tx.order.findUniqueOrThrow({where:{id:bill.orderId}});
      await this.paymentGuards(tx,bill,order);
      const existing = await tx.payment.findUnique({ where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey } } });
      if (existing) ensure(existing.billId === billId, 409, 'IDEMPOTENCY_CONFLICT', '请求编号已用于其他账单');
      const payment = existing || await tx.payment.findFirst({ where: { billId, status: { in: ['CREATING','PENDING'] } }, orderBy: { createdAt: 'asc' } });
      if (payment) {
        ensure(payment.amount===await remainingBillPayment(tx,bill,order),409,'PAYMENT_AMOUNT_CHANGED','待收金额已变化，请先查询或关闭原支付请求');
        ensure(['CREATING','PENDING'].includes(payment.status), 409, 'PAYMENT_STATE', '该付款请求已结束，请使用新的请求编号');
        if (payment.status === 'PENDING' && this.freshParameters(payment.clientParameters)) return { payment, mode: 'CACHED' as const };
        ensure(payment.updatedAt.getTime() <= Date.now() - 45000, 409, 'PAYMENT_RECOVERING', '支付处理中，请45秒后查询或重试');
        ensure(payment.requestSnapshot, 409, 'PAYMENT_RECOVERY_REVIEW', '原支付请求资料不完整，请联系后台关闭后重试');
        const claimed = await tx.payment.update({ where: { id: payment.id }, data: { status: 'CREATING', updatedAt: new Date() } });
        return { payment: claimed, mode: 'RECOVER' as const };
      }
      const snapshot = { amount: await remainingBillPayment(tx,bill,order), openId: customer.openId, description: '宁达汽车订阅账单' };
      const created = await tx.payment.create({ data: { billId, customerId: customer.id, amount: snapshot.amount, idempotencyKey, requestSnapshot: snapshot } });
      return { payment: created, mode: 'NEW' as const };
    });
    const payment = claim.payment;
    if (claim.mode === 'CACHED') return { paymentId: payment.id, ...(payment.clientParameters as any) };
    if (claim.mode === 'RECOVER') {
      try {
        const result = await this.gateway.query(payment.id);
        ensure(result.amount === payment.amount, 409, 'PAYMENT_MISMATCH', '支付金额不匹配');
        if (result.status !== 'PENDING') { await this.settle(payment.id, result); ensure(false, 409, 'PAYMENT_TERMINAL', '支付状态已更新，请刷新账单'); }
      } catch (error) { if (this.code(error) !== 'PAYMENT_ORDER_NOT_EXIST') throw error; }
    }
    const current = await this.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    ensure(current.status === 'CREATING', 409, 'PAYMENT_TERMINAL', '付款状态已更新，请刷新账单');
    const snapshot = payment.requestSnapshot as { amount: number; openId: string; description: string };
    await this.db.serial(async tx=>{const bill=await tx.bill.findUniqueOrThrow({where:{id:billId}});await lockOrder(tx,bill.orderId);await assertVirtualPayment(tx,bill,await tx.order.findUniqueOrThrow({where:{id:bill.orderId}}));});
    const parameters = await this.gateway.create({ paymentId: payment.id, ...snapshot });
    const ready=await this.db.serial(async tx=>{
      const bill=await tx.bill.findUniqueOrThrow({where:{id:billId}});await lockOrder(tx,bill.orderId);
      // Persist the provider request for reconciliation even if the gate changed
      // while the network call was in flight; do not return unusable parameters.
      const updated=await tx.payment.updateMany({where:{id:payment.id,status:'CREATING'},data:{status:'PENDING',clientParameters:parameters}});
      const order=await tx.order.findUniqueOrThrow({where:{id:bill.orderId}});
      let blocker:string|undefined|null;
      try{await this.paymentGuards(tx,bill,order);ensure(payment.amount===await remainingBillPayment(tx,bill,order),409,'PAYMENT_AMOUNT_CHANGED','待收金额已变化，请核对原支付请求');blocker=(bill.serviceStageId||bill.type==='SWAP_ADJUSTMENT')?await stagePaymentBlocker(tx,bill):null;}
      catch(e){if(!(e instanceof HttpException))throw e;blocker=this.code(e)||'PAYMENT_TERMINAL';}
      return {ready:updated.count===1&&!blocker,code:blocker||'PAYMENT_TERMINAL'};
    });
    ensure(ready.ready,409,ready.code,'付款条件已变化，请刷新账单后联系平台核对');
    return { paymentId: payment.id, ...parameters };
  }
  async sync(paymentId: string) { return this.settle(paymentId, await this.gateway.query(paymentId)); }
  async close(paymentId: string, customerId?: string) {
    const payment = await this.db.payment.findFirst({ where: { id: paymentId, ...(customerId ? { customerId } : {}) } }); ensure(payment, 404, 'NOT_FOUND', '支付记录不存在');
    if (payment.status === 'CLOSED') return payment;
    ensure(['CREATING','PENDING'].includes(payment.status), 409, 'PAYMENT_STATE', '当前支付不可关闭');
    ensure(payment.status !== 'CREATING' || payment.updatedAt.getTime() <= Date.now() - 45000, 409, 'PAYMENT_RECOVERING', '支付请求处理中，请稍后关闭');
    const state = await this.gateway.query(paymentId);
    if (state.status !== 'PENDING') return this.settle(paymentId, state);
    ensure(state.amount === payment.amount, 409, 'PAYMENT_MISMATCH', '支付金额不匹配');
    try { await this.gateway.close(paymentId); } catch (error) { if (this.code(error) !== 'PAYMENT_ALREADY_CLOSED') throw error; }
    return this.settle(paymentId, { status: 'CLOSED', amount: payment.amount });
  }
  async dispatchRefund(refund:any){
    try {
      const result=await this.gateway.refund({refundId:refund.id,paymentId:refund.paymentId,amount:refund.amount,totalAmount:refund.payment.amount,reason:refund.reason});
      return this.settleRefund(refund.id,{...result,paymentId:refund.paymentId,amount:refund.amount,totalAmount:refund.payment.amount});
    }catch(error){
      await this.db.serial(async tx=>{const current=await lockRefund(tx,refund.id);if(current.status==='PROCESSING'&&!current.acceptedAt)await tx.refund.update({where:{id:refund.id},data:{channelState:this.code(error)==='REFUND_USER_ACCOUNT_ABNORMAL'?'REJECTED_USER_ACCOUNT':'UNKNOWN',failureCode:this.code(error)||'CHANNEL_UNKNOWN',...(this.code(error)==='REFUND_USER_ACCOUNT_ABNORMAL'?{channelEvidence:{refundId:refund.id,paymentId:refund.paymentId,amount:refund.amount,totalAmount:refund.payment.amount,code:'USER_ACCOUNT_ABNORMAL',evidenceSource:'SIGNED_REQUEST_REJECTION'}}:{})}});});throw error;
    }
  }
  async syncRefund(refundId: string) {
    try{return await this.settleRefund(refundId,await this.gateway.queryRefund(refundId));}
    catch(error){if(this.code(error)==='REFUND_NOT_FOUND')await this.db.serial(async tx=>{const r=await lockRefund(tx,refundId);if(r.method==='WECHAT_ORIGINAL'&&r.failureCode==='REFUND_USER_ACCOUNT_ABNORMAL'&&!r.acceptedAt&&!r.providerRefundId)await tx.refund.update({where:{id:refundId},data:{channelState:'NOT_ACCEPTED_UNAVAILABLE',channelEvidence:{...(r.channelEvidence as any),queryEvidence:{source:'SIGNED_QUERY_NOT_FOUND',refundId,queriedAt:this.clock().toISOString()}}}});});throw error;}
  }
  async retryRefund(refundId: string, actorId: string, actor?: any) {
    const refund = await this.db.serial(async tx => {
      await refundStaff(tx,actor);const reference=await lockRefund(tx,refundId);await refundStaff(tx,actor,reference.requestedBy);ensure(reference.method==='WECHAT_ORIGINAL',409,'REFUND_METHOD_CONFLICT');
      if(isRenewalCancellationRefund(reference)||reference?.preDeliveryCancellationId){ensure(actor?.id===actorId,403,'STAFF_SESSION_CHANGED','请使用当前财务人员会话');await requireCancellationRefundStaff(tx,actor);}
      const item = await lockCancellation04Refund(tx,await lockRenewalCancellationRefund(tx,reference));
      ensure(item?.status === 'PROCESSING' && item.approvedBy && item.payment.status === 'SUCCEEDED', 409, 'REFUND_STATE', '仅已审批且原付款成功的处理中退款可恢复');
      ensure(item.updatedAt.getTime() <= Date.now() - 45000, 409, 'REFUND_RECOVERING', '退款处理中，请45秒后再查询或恢复');
      await tx.refund.update({ where: { id: refundId }, data: { updatedAt: new Date() } });
      await audit(tx, actorId, 'RECOVER', 'refunds', refundId); return item;
    });
    try { return await this.syncRefund(refundId); }
    catch (error) { if (this.code(error) !== 'REFUND_NOT_FOUND') throw error; }
    // A verified old receipt must remain recordable even if paperwork changes.
    // Only a confirmed channel NOT_FOUND permits re-dispatch, after fresh authorization and evidence checks.
    const dispatch = await this.db.serial(async tx=>{
      const item=await lockCancellation04Refund(tx,await lockRenewalCancellationRefund(tx,await tx.refund.findUnique({where:{id:refundId},include:{payment:true}})));
      ensure(item?.status==='PROCESSING'&&item.approvedBy&&item.payment.status==='SUCCEEDED',409,'REFUND_STATE','退款状态已变化');ensure(item.channelState!=='NOT_ACCEPTED_UNAVAILABLE',409,'REFUND_ORIGINAL_ROUTE_UNAVAILABLE');
      await refundStaff(tx,actor,item.requestedBy);await independentRefundSource(tx,item,actor);const cancellation=await guardRenewalCancellationRefund(tx,item,actor,this.clock(),'RETRY');await this.guardExecutionFunds(tx,item,!!cancellation);await guardCancellation04Refund(tx,item.payment,item.amount,item,actor);return item;
    });
    return this.dispatchRefund(dispatch);
  }
}
@Controller()
export class BillingController {
  constructor(@Inject(Db) private db: Db, @Inject(BillingService) private billing: BillingService, @Inject(PaymentGateway) private gateway: PaymentGateway,@Inject(USAGE_CLOCK) private clock:()=>Date=()=>new Date()) {}
  private bank(){return new RefundBankService(this.db,(tx,r)=>this.billing.refundEffects(tx,r));}
  @Get('admin/refunds/:id/execution') execution(@Param('id')id:string,@Req()r:any){return this.db.serial(async tx=>{await refundStaff(tx,r.admin);const row=await lockRefund(tx,id);return{...safeRefund(row),notices:await tx.auditLog.findMany({where:{resourceType:'refunds',resourceId:id,action:'REFUND_NOTICE_V1'},orderBy:{createdAt:'desc'},take:20}),actions:{sync:row.method==='WECHAT_ORIGINAL',retry:row.method==='WECHAT_ORIGINAL'&&row.status==='PROCESSING',newOriginalRequest:row.status==='FAILED',bankAccount:row.method==='MANUAL_BANK',duplicateDisposition:row.duplicateReceipt||row.payment.reconciliationRequired?`/admin/payments/${row.paymentId}/reconciliations`:null,bankEvidence:row.bankExecution&&(row.bankExecution as any).status==='REJECTED'?`/admin/refunds/${id}/bank-execution/evidence`:null}};});}
  @Get('customer/refunds/:id/execution') customerExecution(@Param('id')id:string,@Req()r:any){return this.db.serial(async tx=>{const row=await lockRefund(tx,id);ensure(row.customerId===r.customer.id,404,'NOT_FOUND');const account=row.bankAccount as any;return{id:row.id,obligationId:row.obligationId,amount:row.amount,status:row.status,method:row.method,acceptedAt:row.acceptedAt,succeededAt:row.succeededAt,bankAccount:account?{version:account.version,hash:account.hash,maskedNumber:account.maskedNumber,bankName:account.bankName,status:account.status}:null,requiresReconciliation:!!row.duplicateReceipt,notices:(await tx.auditLog.findMany({where:{resourceType:'refunds',resourceId:id,action:'REFUND_NOTICE_V1'},orderBy:{createdAt:'desc'},take:20})).map(n=>n.data)};});}
  @Post('customer/refunds/:id/bank-account') bankSubmit(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.bank().submit(id,body,r.customer.id);}
  @Post('admin/refunds/:id/bank-account/verify') bankVerify(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.bank().verify(id,body,r.admin);}
  @Get('admin/refunds/:id/bank-instructions') bankInstructions(@Param('id')id:string,@Req()r:any){return this.bank().instructions(id,r.admin);}
  @Post('admin/refunds/:id/bank-execution') bankRecord(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.bank().record(id,body,r.admin);}
  @Post('admin/refunds/:id/bank-execution/evidence') bankEvidence(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.bank().correctEvidence(id,body,r.admin);}
  @Post('admin/refunds/:id/bank-execution/review') bankReview(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.bank().reconcile(id,body,r.admin);}
  @Post('admin/refunds/:id/reissue') reissue(@Param('id')id:string,@Body()raw:unknown,@Req()r:any){
    const input=z.object({revision:z.number().int().nonnegative(),reason:text,idempotencyKey:key}).strict().parse(raw);
    return this.db.serial(async tx=>{await refundStaff(tx,r.admin);const prior=await lockRefund(tx,id);return archiveCommand(tx,r.admin,`refund-reissue:${id}`,'REFUND_REISSUE',input,async()=>{
      ensure(prior.revision===input.revision,409,'REVISION_CONFLICT');const e=prior.channelEvidence as any;
      ensure(prior.obligationId&&prior.method==='WECHAT_ORIGINAL'&&prior.status==='FAILED'&&!prior.bankExecution&&e?.nativeStatus==='CLOSED'&&['QUERY','CALLBACK'].includes(e.evidenceSource)&&e.providerRefundId===prior.providerRefundId&&prior.providerRefundId&&e.paymentId===prior.paymentId&&e.amount===prior.amount,409,'REFUND_REISSUE_SOURCE');
      ensure(!await tx.refund.count({where:{replacesRefundId:id}}),409,'REFUND_REISSUE_EXISTS');await assertRefundReplacementOpen(tx,prior);
      const obligation=await refundObligationGuard(tx,prior.payment,prior.amount,prior.obligationId);
      const {paymentId,customerId,amount,obligationId,preDeliveryCancellationId,preDeliveryCancellationSourceHash,renewalCancellationId,renewalCancellationOrderId,renewalCancellationStageId,renewalCancellationBillId}=prior;
      const next=await tx.refund.create({data:{paymentId,customerId,amount,obligationId,preDeliveryCancellationId,preDeliveryCancellationSourceHash,renewalCancellationId,renewalCancellationOrderId,renewalCancellationStageId,renewalCancellationBillId,replacesRefundId:id,reason:input.reason,requestedBy:r.admin.id,idempotencyKey:input.idempotencyKey}});
      await consumeRefundAuthorization(tx,next.id,obligation?.reconciliationId);await audit(tx,r.admin.id,'REFUND_REISSUE','refunds',next.id,{replacesRefundId:id});return safeRefund(await tx.refund.findUniqueOrThrow({where:{id:next.id}}));
    });});
  }
  @Post('admin/refunds/:id/obligation') bindObligation(@Param('id')id:string,@Body()raw:any,@Req()r:any){
    const input=z.object({obligationId:text,revision:z.number().int().nonnegative(),idempotencyKey:key}).strict().parse(raw);
    return this.db.serial(async tx=>{await refundStaff(tx,r.admin);const row=await lockRefund(tx,id);return archiveCommand(tx,r.admin,`refund-obligation:${id}`,'BIND_REFUND_OBLIGATION',input,async()=>{
      ensure(row.revision===input.revision,409,'REVISION_CONFLICT');ensure(!row.obligationId||row.obligationId===input.obligationId,409,'REFUND_OBLIGATION_SOURCE');
      if(row.obligationId===input.obligationId)return safeRefund(row);
      const o=await refundObligationGuard(tx,row.payment,row.amount,input.obligationId,id,{method:row.method,collectAccountOnly:true});ensure(o,409,'REFUND_OBLIGATION_SOURCE');
      if(o.sourceKind==='CANCEL05')ensure(row.renewalCancellationId===o.sourceId&&row.renewalCancellationBillId===row.payment.billId&&row.amount===o.amount,409,'RENEWAL_CANCELLATION_REFUND_SOURCE');
      if(o.sourceKind==='CANCEL04')ensure(row.preDeliveryCancellationId===o.sourceId&&row.preDeliveryCancellationSourceHash===(o.source as any).refs.proposalHash,409,'REFUND_OBLIGATION_SOURCE');
      const bound=await tx.refund.update({where:{id},data:{obligationId:o.id,revision:{increment:1}}});await audit(tx,r.admin.id,'BIND_REFUND_OBLIGATION','refunds',id,{obligationId:o.id});return safeRefund(bound);
    });});
  }
  @Post('customer/bills/:id/pay') pay(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.billing.pay(request.customer, id, z.object({ idempotencyKey: key }).parse(body).idempotencyKey); }
  @Get('customer/payments/:id') async getPayment(@Param('id') id: string, @Req() request: any) { const payment = await this.db.payment.findFirst({ where: { id, customerId: request.customer.id } }); ensure(payment, 404, 'NOT_FOUND', '支付记录不存在'); const current = ['CREATING','PENDING'].includes(payment.status) ? await this.billing.sync(id) : payment; const { clientParameters, requestSnapshot, ...safe } = current; return safe; }
  @Post('admin/payments/:id/sync') sync(@Param('id') id: string) { return this.billing.sync(id); }
  @Post('admin/payments/:id/close') async closeAdmin(@Param('id') id: string, @Req() request: any) { const payment = await this.billing.close(id); await audit(this.db, request.admin.id, 'CLOSE_REQUEST', 'payments', id, { status: payment.status }); return payment; }
  @Post('customer/payments/:id/close') async closeCustomer(@Param('id') id: string, @Req() request: any) { const { requestSnapshot, clientParameters, ...payment } = await this.billing.close(id, request.customer.id); await audit(this.db, request.customer.id, 'CLOSE_REQUEST', 'payments', id, { status: payment.status }, 'CUSTOMER'); return payment; }
  @Post('admin/refunds/:id/sync') syncRefund(@Param('id') id: string) { return this.billing.syncRefund(id); }
  @Post('admin/refunds/:id/retry') retryRefund(@Param('id') id: string, @Req() request: any) { return this.billing.retryRefund(id, request.admin.id, request.admin); }
  @Post('admin/bills') createBill(@Body() body: any, @Req() request: any) {
    const input = z.object({ orderId: text, type: z.enum(['EXTRA_FEE','RETURN_SETTLEMENT']), amount: money.positive(), dueDate: z.string().refine(value => { try { dateOnly(value); return true; } catch { return false; } }, '日期无效'), description: text, fileIds, idempotencyKey: key }).parse(body); const dueDate = dateOnly(input.dueDate);
    return this.db.serial(async tx => { await requireCurrentStaff(tx,request.admin,'bills');
      await assertNotInspectionFiles(tx,input.fileIds);
      const old = await tx.bill.findUnique({ where: { orderId_idempotencyKey: { orderId: input.orderId, idempotencyKey: input.idempotencyKey } } });
      if (old) { await assertNotInspectionFiles(tx,old.evidenceFileIds); ensure(old.type === input.type && old.amount === input.amount && old.description === input.description && old.dueDate.getTime() === dueDate.getTime() && hash(old.evidenceFileIds) === hash(input.fileIds), 409, 'IDEMPOTENCY_CONFLICT', '费用账单编号与内容冲突'); return old; }
      const order = await tx.order.findUnique({ where: { id: input.orderId } }); ensure(order && ['ACTIVE','SETTLING','COMPLETED'].includes(order.status), 409, 'ORDER_STATE', '仅用车中或已归还订单可产生附加费用');
      if (input.type === 'RETURN_SETTLEMENT') ensure(await tx.handover.count({ where: { orderId: order.id, type: 'RETURN', status: 'COMPLETED' } }), 409, 'RETURN_REQUIRED', '归还结算须先完成还车交接');
      ensure(await tx.storedFile.count({ where: { id: { in: input.fileIds }, customerId: null, purpose: 'evidence' } }) === new Set(input.fileIds).size, 403, 'FILE_OWNERSHIP', '请上传后台费用证据');
      const max = await tx.bill.aggregate({ where: { orderId: order.id, type: input.type }, _max: { sequence: true } });
      const {fileIds: evidenceFileIds, ...data} = input;
      const bill = await tx.bill.create({ data: { ...data, dueDate, evidenceFileIds, customerId: order.customerId, sequence: (max._max.sequence || 0) + 1, createdBy: request.admin.id } });
      await audit(tx, request.admin.id, 'CREATE_FEE', 'bills', bill.id, input); return bill;
    });
  }
  @Post('admin/bills/:id/review') reviewBill(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ decision: z.enum(['APPROVED','REJECTED']), note: text }).parse(body);
    return this.db.serial(async tx => { await requireCurrentStaff(tx,request.admin,'bills'); const bill = await tx.bill.findUnique({ where: { id } }); ensure(bill?.status === 'DRAFT' && ['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS'].includes(bill.type), 409, 'STATE_CONFLICT', '仅附加费用草稿可复核'); await refundStaff(tx,request.admin,bill.createdBy);ensure(bill.createdBy,409,'STAFF_PERSON_UNVERIFIED'); const updated = await tx.bill.update({ where: { id }, data: { status: input.decision === 'APPROVED' ? 'REVIEWED' : 'VOID', reviewedBy: request.admin.id, reviewedAt: new Date(), reviewNote: input.note } }); await audit(tx, request.admin.id, 'REVIEW_FEE', 'bills', id, input); return updated; });
  }
  @Post('admin/bills/:id/publish') publish(@Param('id') id: string, @Req() request: any) { return this.db.serial(async tx => { await requireCurrentStaff(tx,request.admin,'bills'); const bill = await tx.bill.findUnique({ where: { id } }); ensure(bill, 404, 'NOT_FOUND', '账单不存在'); ensure(!isAutomaticBill(bill.type),409,'BILL_AUTO_PUBLICATION_MANAGED','月租和押金账单由系统在到期日前3天自动发布'); ensure(bill.status === (['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS'].includes(bill.type) ? 'REVIEWED' : 'DRAFT'), 409, 'STATE_CONFLICT', '费用账单须完成独立复核后发布'); if(['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS'].includes(bill.type)){await refundStaff(tx,request.admin);await assertIndependentStaffReview(tx,bill.reviewedBy!,[bill.createdBy],'DUAL_APPROVAL');} const order = await tx.order.findUniqueOrThrow({ where: { id: bill.orderId } }); ensure(order.status !== 'CANCELLED', 409, 'ORDER_STATE', '订单已取消'); if(['OFFLINE','ELECTRONIC'].includes(order.contractMode))await requireContractReady(tx,order.id,'PAYMENT'); await guardPhysicalReceiptBill(tx,bill); const result = await tx.bill.update({ where: { id }, data: { status: 'PENDING' } }); await audit(tx, request.admin.id, 'PUBLISH', 'bills', id); await notify(tx, bill.customerId, '新账单待支付', '请核对账单并主动支付。', 'bills', id); return result; }); }
  @Post('admin/refunds') requestRefund(@Body() body: any, @Req() request: any) {
    const input = z.object({ paymentId: text, obligationId:text.optional(),amount: money.positive(), reason: text, idempotencyKey: key }).strict().parse(body);
    return this.db.serial(async tx => { await requireCurrentStaff(tx,request.admin,'bills');
      const existing = await tx.refund.findUnique({ where: { requestedBy_idempotencyKey: { requestedBy: request.admin.id, idempotencyKey: input.idempotencyKey } } });
      if (existing) { ensure(existing.paymentId === input.paymentId && existing.amount === input.amount && existing.reason === input.reason && (existing.obligationId??undefined)===input.obligationId, 409, 'IDEMPOTENCY_CONFLICT', '退款请求编号与内容冲突'); return safeRefund(existing); }
      let payment = await tx.payment.findUnique({ where: { id: input.paymentId } }); ensure(payment?.status === 'SUCCEEDED', 409, 'PAYMENT_STATE', '仅成功支付可申请退款');
      const bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});await lockOrder(tx,bill.orderId);payment=await tx.payment.findUniqueOrThrow({where:{id:payment.id}});await refundStaff(tx,request.admin);await assertRenewalCancellationRefundManaged(tx,bill);const obligation=await refundObligationGuard(tx,payment,input.amount,input.obligationId);await tx.order.update({where:{id:bill.orderId},data:{revision:{increment:1}}});ensure(obligation?.sourceKind==='SWAP03'||await tx.orderChange.count({where:{orderId:bill.orderId,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}})===0,409,'CHANGE_REFUND_MANAGED','订单变更期间退款须使用已签补充协议生成的退款安排');
      const cancellation04=await guardCancellation04Refund(tx,payment,input.amount);await guardSwapRefund(tx,payment,input.amount);await guardPackRefund(tx,payment,input.amount);
      const sum = await tx.refund.aggregate({ where: { paymentId: input.paymentId, status: { in: ['PENDING_APPROVAL','PROCESSING','SUCCEEDED'] } }, _sum: { amount: true } });
      ensure((sum._sum.amount || 0) + input.amount <= payment.amount, 409, 'REFUND_LIMIT', '退款累计金额不可超过实付');
      const refund = await tx.refund.create({ data: { ...input,...(cancellation04?{preDeliveryCancellationId:cancellation04.caseId,preDeliveryCancellationSourceHash:cancellation04.proposalHash}:{}), customerId: payment.customerId, requestedBy: request.admin.id } }); await consumeRefundAuthorization(tx,refund.id,obligation?.reconciliationId);await audit(tx, request.admin.id, 'REQUEST', 'refunds', refund.id, input); return safeRefund(refund);
    });
  }
  @Post('admin/refunds/:id/reject') reject(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const {reason}=z.object({reason:text}).parse(body);
    return this.db.serial(async tx=>{
      await requireCurrentStaff(tx,request.admin,'bills');
      const refund=await lockCancellation04Refund(tx,await lockRenewalCancellationRefund(tx,await tx.refund.findUnique({where:{id}})));
      ensure(refund?.status==='PENDING_APPROVAL',409,'STATE_CONFLICT','退款请求已处理');
      let updated;
      if(isRenewalCancellationRefund(refund)){
        await requireCancellationRefundStaff(tx,request.admin);
        ensure((await tx.refund.updateMany({where:{id,status:'PENDING_APPROVAL'},data:{status:'REJECTED',reason}})).count===1,409,'STATE_CONFLICT','退款请求已处理');
        updated=await tx.refund.findUnique({where:{id}});
      }else updated=await tx.refund.update({where:{id},data:{status:'REJECTED',reason}});
      ensure(updated,409,'STATE_CONFLICT','退款请求已变化');
      await audit(tx,request.admin.id,'REJECT','refunds',id,{reason});return safeRefund(updated);
    });
  }
  @Post('admin/refunds/:id/approve') async approve(@Param('id') id: string, @Req() request: any) {
    const refund=await this.db.serial(async tx=>{
      await requireCurrentStaff(tx,request.admin,'bills');
      const item=await lockCancellation04Refund(tx,await lockRenewalCancellationRefund(tx,await lockRefund(tx,id)));
      ensure(item?.status==='PENDING_APPROVAL',409,'STATE_CONFLICT','退款请求已处理');
      await refundStaff(tx,request.admin,item.requestedBy);await independentRefundSource(tx,item,request.admin);ensure(item.method==='WECHAT_ORIGINAL',409,'REFUND_METHOD_CONFLICT');
      const cancellation=await guardRenewalCancellationRefund(tx,item,request.admin,this.clock(),'APPROVE');await this.billing.guardExecutionFunds(tx,item,!!cancellation);
      await guardCancellation04Refund(tx,item.payment,item.amount,item,request.admin);await guardSwapRefund(tx,item.payment,item.amount);await guardPackRefund(tx,item.payment,item.amount,true);
      let updated;
      if(cancellation){
        ensure((await tx.refund.updateMany({where:{id,status:'PENDING_APPROVAL',paymentId:item.paymentId,amount:item.amount},data:{status:'PROCESSING',approvedBy:request.admin.id,dispatchedAt:item.dispatchedAt??this.clock(),channelState:'DISPATCHING'}})).count===1,409,'STATE_CONFLICT','退款请求已处理');
        updated=await tx.refund.findUnique({where:{id},include:{payment:true}});
      }else updated=await tx.refund.update({where:{id},data:{status:'PROCESSING',approvedBy:request.admin.id,dispatchedAt:item.dispatchedAt??this.clock(),channelState:'DISPATCHING'},include:{payment:true}});
      ensure(updated,409,'STATE_CONFLICT','退款请求已变化');
      await audit(tx,request.admin.id,'APPROVE','refunds',id,cancellation??undefined);return updated;
    });
    return this.billing.dispatchRefund(refund);
  }
}
