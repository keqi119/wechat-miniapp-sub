import { Prisma } from '@prisma/client';
import { ensure } from '../common/errors';
import { audit } from '../common/data';
import { lockAccount } from './rules';
export async function guardPackRefund(tx:Prisma.TransactionClient,payment:any,amount:number,freeze=false){
 const bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});if(bill.type!=='MILEAGE_PACK')return;
 const account=await lockAccount(tx,bill.orderId),pack=await tx.mileagePurchase.findUnique({where:{billId:bill.id}});
 ensure(pack&&['ACTIVE','EXPIRED','REFUND_PENDING'].includes(pack.status)&&amount===pack.amount&&payment.amount===pack.amount&&!await tx.mileageLedger.count({where:{packId:pack.id,type:'CONSUME'}}),409,'PACK_REFUND_REVIEW','通用退款仅支持完整未使用包的全额例外退款；已使用或部分退款须人工制定结算方案');
 if(freeze){await tx.mileagePurchase.update({where:{id:pack.id},data:{status:'REFUND_PENDING'}});await audit(tx,'refund-approval','FREEZE_MILEAGE_PACK','orders',account.orderId,{purchaseId:pack.id,paymentId:payment.id});}
}
export async function settlePackRefund(tx:Prisma.TransactionClient,refund:any){
 if(refund.payment.bill.type!=='MILEAGE_PACK')return;
 const account=await lockAccount(tx,refund.payment.bill.orderId),pack=await tx.mileagePurchase.findUniqueOrThrow({where:{billId:refund.payment.billId}});
 ensure(pack.status==='REFUND_PENDING'&&refund.amount===pack.amount,409,'PACK_REFUND_CONFLICT','里程包退款与冻结记录不一致，须人工核对');
 await tx.mileageLedger.create({data:{accountId:account.id,packId:pack.id,type:'REFUND',deltaKm:-pack.remainingKm,sourceKey:'refund:'+refund.id}});
 await tx.mileagePurchase.update({where:{id:pack.id},data:{status:'REFUNDED',remainingKm:0}});
}
