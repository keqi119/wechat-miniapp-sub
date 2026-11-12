import {isMonthlyPack,validateMonthlyPack} from './monthly-pack';
import { Prisma } from '@prisma/client';
import { ensure } from '../common/errors';
import { audit } from '../common/data';
import { lockAccount } from './rules';
async function refundablePack(tx:Prisma.TransactionClient,payment:any,bill:any,account:any,pack:any,amount:number){
 const matches=pack&&payment.billId===bill.id&&pack.billId===bill.id&&pack.accountId===account.id&&pack.orderId===bill.orderId&&account.orderId===bill.orderId&&pack.customerId===payment.customerId&&bill.customerId===payment.customerId&&account.customerId===payment.customerId&&amount===pack.amount&&payment.amount===pack.amount;
 ensure(matches,409,'PACK_REFUND_REVIEW','里程包、付款和退款金额归属不一致');
 const neverIssued=pack.paidAt===null&&pack.remainingKm===0&&['PENDING_PAYMENT','REFUND_PENDING','REFUNDED',...(isMonthlyPack(pack)?['VOID']:[])].includes(pack.status);
 if(isMonthlyPack(pack)&&!neverIssued)await validateMonthlyPack(tx,pack,account,bill);
 if(neverIssued){
  ensure(payment.status==='SUCCEEDED'&&payment.providerTransactionId&&payment.reconciliationRequired===true,409,'PACK_REFUND_REVIEW','未发放里程的退款须对应已核验的异常到账');
  const ledger=await tx.mileageLedger.findMany({where:{packId:pack.id}});
  ensure(pack.status!=='REFUNDED'||ledger.length>0,409,'PACK_REFUND_REVIEW','已退款里程包缺少原退款凭据');
  for(const row of ledger){
   ensure(row.accountId===account.id&&row.packId===pack.id&&row.type==='REFUND'&&row.deltaKm===0&&typeof row.sourceKey==='string'&&row.sourceKey.startsWith('refund:'),409,'PACK_REFUND_REVIEW','未发放里程包仅允许可核验的零额度退款流水');
   const refundId=row.sourceKey.slice('refund:'.length),prior=await tx.refund.findUnique({where:{id:refundId},include:{payment:true}}),source=prior?.payment;
   ensure(prior&&prior.id===refundId&&prior.status==='SUCCEEDED'&&prior.providerRefundId&&prior.approvedBy&&prior.requestedBy&&prior.approvedBy!==prior.requestedBy&&prior.amount===pack.amount&&prior.customerId===payment.customerId&&source&&prior.paymentId===source.id&&source.status==='SUCCEEDED'&&source.providerTransactionId&&source.billId===bill.id&&source.customerId===payment.customerId&&source.amount===pack.amount,409,'PACK_REFUND_REVIEW','原零额度流水须对应同账单已独立批准并全额实际退回的付款');
  }
  return 'UNISSUED' as const;
 }else if(payment.status==='SUCCEEDED'&&payment.providerTransactionId&&payment.reconciliationRequired===true&&!await tx.mileageLedger.count({where:{type:'GRANT',sourceKey:'payment:'+payment.id}})){
  // A second verified receipt buys no second quota. Its refund must never
  // freeze or retire the quota granted by the independently verified first one.
  ensure(pack.paidAt&&['ACTIVE','EXPIRED','REFUND_PENDING','REFUNDED'].includes(pack.status),409,'PACK_REFUND_REVIEW','额外到账缺少已发放的原里程包');
  const grants=await tx.mileageLedger.findMany({where:{packId:pack.id,type:'GRANT'}}),grant=grants[0];
  ensure(grants.length===1&&grant.packId===pack.id&&grant.accountId===account.id&&grant.deltaKm===pack.km&&grant.sourceKey.startsWith('payment:'),409,'PACK_REFUND_REVIEW','原里程发放来源不完整');
  const sourceId=grant.sourceKey.slice('payment:'.length),source=await tx.payment.findUnique({where:{id:sourceId}});
  ensure(source&&source.id===sourceId&&source.id!==payment.id&&source.status==='SUCCEEDED'&&source.providerTransactionId&&source.providerTransactionId!==payment.providerTransactionId&&source.billId===bill.id&&source.customerId===payment.customerId&&source.amount===pack.amount,409,'PACK_REFUND_REVIEW','原里程须对应本账单另一笔可核验成功付款');
  return 'EXTRA_RECEIPT' as const;
 }else ensure(['ACTIVE','EXPIRED','REFUND_PENDING'].includes(pack.status)&&await tx.mileageLedger.count({where:{packId:pack.id,type:'GRANT',sourceKey:'payment:'+payment.id}})===1&&!await tx.mileageLedger.count({where:{packId:pack.id,type:'CONSUME'}}),409,'PACK_REFUND_REVIEW','通用退款仅支持原付款对应完整未使用包的全额例外退款；已使用或部分退款须人工制定结算方案');
 return 'PACK' as const;
}
export async function guardPackRefund(tx:Prisma.TransactionClient,payment:any,amount:number,freeze=false){
 const bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});if(bill.type!=='MILEAGE_PACK')return;
 const account=await lockAccount(tx,bill.orderId),pack=await tx.mileagePurchase.findUnique({where:{billId:bill.id}});
 ensure(pack,409,'PACK_REFUND_REVIEW','里程包购买记录不存在');
 const mode=await refundablePack(tx,payment,bill,account,pack,amount);
 if(mode==='EXTRA_RECEIPT'){if(freeze)await audit(tx,'refund-approval','APPROVE_EXTRA_MILEAGE_RECEIPT_REFUND','orders',account.orderId,{purchaseId:pack.id,paymentId:payment.id,amount});return;}
 if(mode==='UNISSUED'&&pack.status==='REFUNDED'){if(freeze)await audit(tx,'refund-approval','APPROVE_UNISSUED_MILEAGE_RECEIPT_REFUND','orders',account.orderId,{purchaseId:pack.id,paymentId:payment.id,amount});return;}
 if(freeze){await tx.mileagePurchase.update({where:{id:pack.id},data:{status:'REFUND_PENDING'}});await audit(tx,'refund-approval','FREEZE_MILEAGE_PACK','orders',account.orderId,{purchaseId:pack.id,paymentId:payment.id});}
}
export async function settlePackRefund(tx:Prisma.TransactionClient,refund:any){
 if(refund.payment.bill.type!=='MILEAGE_PACK')return;
 const account=await lockAccount(tx,refund.payment.bill.orderId),pack=await tx.mileagePurchase.findUniqueOrThrow({where:{billId:refund.payment.billId}});
 ensure(refund.paymentId===refund.payment.id&&refund.customerId===refund.payment.customerId,409,'PACK_REFUND_CONFLICT','退款与原付款归属不一致');
 const mode=await refundablePack(tx,refund.payment,refund.payment.bill,account,pack,refund.amount);
 if(mode==='EXTRA_RECEIPT'){await audit(tx,'payment-provider','SETTLE_EXTRA_MILEAGE_RECEIPT_REFUND','orders',account.orderId,{purchaseId:pack.id,paymentId:refund.paymentId,refundId:refund.id,amount:refund.amount},'PROVIDER');return;}
 ensure((pack.status==='REFUND_PENDING'||mode==='UNISSUED'&&pack.status==='REFUNDED')&&refund.amount===pack.amount,409,'PACK_REFUND_CONFLICT','里程包退款与冻结记录不一致，须人工核对');
 await tx.mileageLedger.create({data:{accountId:account.id,packId:pack.id,type:'REFUND',deltaKm:0-pack.remainingKm,sourceKey:'refund:'+refund.id}});
 await tx.mileagePurchase.update({where:{id:pack.id},data:{status:'REFUNDED',remainingKm:0}});
}
