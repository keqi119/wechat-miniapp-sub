import { hash, audit } from '../common/data';
import { ensure } from '../common/errors';
import { lockAccount, PACK_TERMS } from './rules';
export async function guardPackPayment(tx:any,bill:any){
  if(bill.type!=='MILEAGE_PACK')return;
  const account=await lockAccount(tx,bill.orderId),purchase=await tx.mileagePurchase.findUnique({where:{billId:bill.id}});
  ensure(account.packStatus==='ACTIVE'&&purchase?.status==='PENDING_PAYMENT',409,'PACK_NOT_PAYABLE','里程包已失效或订阅已交还，请查询已有支付结果');
}
export async function grantPaidPack(tx:any,bill:any,paymentId:string){
  if(bill.type!=='MILEAGE_PACK')return;
  const account=await lockAccount(tx,bill.orderId),p=await tx.mileagePurchase.findUnique({where:{billId:bill.id}});
  ensure(p&&p.customerId===bill.customerId&&p.amount===bill.amount&&p.status==='PENDING_PAYMENT'&&account.packStatus!=='EXPIRED',409,'PACK_PAYMENT_CONFLICT','里程包支付归属或结算状态异常，请人工核对');
  const terms=p.termsSnapshot as any,doc=await tx.legalDocument.findUnique({where:{id:terms.documentId}});
  ensure(doc?.confirmedAt&&doc.type==='mileage-pack'&&doc.version===terms.documentVersion&&hash(doc.content)===terms.hash&&terms.version===PACK_TERMS&&terms.accepted===true,409,'PACK_CONSENT','里程包购买说明缺少有效同意快照');
  await tx.mileagePurchase.update({where:{id:p.id},data:{status:'ACTIVE',remainingKm:p.km,paidAt:new Date()}});
  await tx.mileageLedger.create({data:{accountId:account.id,packId:p.id,type:'GRANT',deltaKm:p.km,sourceKey:'payment:'+paymentId}});
  await audit(tx,'payment-provider','GRANT_MILEAGE_PACK','orders',bill.orderId,{purchaseId:p.id,km:p.km,paymentId},'PROVIDER');
}
export async function expireRemainingPacks(tx:any,account:any){
  const unclosed=await tx.usagePeriod.count({where:{accountId:account.id,status:{notIn:['SETTLED','CANCELLED']}}});
  if(!account.returnedOn||unclosed)return;
  const packs=await tx.mileagePurchase.findMany({where:{accountId:account.id,status:'ACTIVE'}});
  for(const p of packs){if(p.remainingKm)await tx.mileageLedger.create({data:{accountId:account.id,packId:p.id,type:'EXPIRE',deltaKm:-p.remainingKm,sourceKey:'expire:'+p.id}});await tx.mileagePurchase.update({where:{id:p.id},data:{status:'EXPIRED',remainingKm:0}});}
  await tx.usageAccount.update({where:{id:account.id},data:{packStatus:'EXPIRED'}});
  await tx.returnSettlement.updateMany({where:{accountId:account.id,status:'READINGS_REQUIRED'},data:{status:'PENDING_PAYMENT',revision:{increment:1}}});
}
export async function voidUnpaidQuotes(tx:any,accountId:string,throughSequence:number){
  const purchases=await tx.mileagePurchase.findMany({where:{accountId,status:'PENDING_PAYMENT',applicableFromSequence:{lte:throughSequence}}});
  for(const p of purchases){ensure(!await tx.payment.count({where:{billId:p.billId,status:{in:['CREATING','PENDING','SUCCEEDED']}}}),409,'PACK_PAYMENT_PENDING','里程包存在未核清支付，须先查询到账或渠道关单');await tx.bill.update({where:{id:p.billId},data:{status:'VOID'}});await tx.mileagePurchase.update({where:{id:p.id},data:{status:'VOID'}});}
}
