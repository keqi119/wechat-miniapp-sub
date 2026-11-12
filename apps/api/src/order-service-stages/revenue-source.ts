import {HttpException} from '@nestjs/common';
import {readRenewalBillSource} from '../order-renewals/payment';
import {parseStageRow} from './source';
import {readStageSwapPaymentGuard} from '../vehicle-changes/finance';

export type BillRevenueSource={ownerId:string|null;snapshot:any;verified:boolean;staged:boolean};
const owner=(value:any):string|null=>typeof value==='string'&&value.trim()?value:null;

/** Read-only. An unavailable future/historical paper source must never fall back to the original rate. */
export async function readBillRevenueSource(tx:any,bill:any):Promise<BillRevenueSource>{
 if(bill.serviceStageId==null){const original=bill.order?.finalPlanSnapshot;return{ownerId:owner(original?.revenueRuleSnapshot?.ownerId||original?.lessorSnapshot?.ownerId),snapshot:original?.revenueRuleSnapshot||{vehicleId:bill.order?.vehicleId},verified:true,staged:false};}
 const result:BillRevenueSource={ownerId:null,snapshot:null,verified:false,staged:true};
 const row=await tx.orderServiceStage.findUnique({where:{id:bill.serviceStageId}});
 // This parent identity is also the only authority for an incomplete count.
 // A foreign/missing stage cannot disclose or guess another owner's facts.
 if(!row||row.id!==bill.serviceStageId||row.orderId!==bill.orderId||row.customerId!==bill.customerId||bill.order?.id!==row.orderId||bill.order?.customerId!==row.customerId)return result;
 result.ownerId=owner(row.ownerId);
 try{
  const parsed=parseStageRow(row,bill.order);
  if(bill.type==='SWAP_ADJUSTMENT'){
   const swap=await readStageSwapPaymentGuard(tx,bill,'HISTORY'),rule=swap?.quote.snapshot.targetRevenueRuleSnapshot;
   if(!swap||!rule||rule.ownerId!==row.ownerId||rule.vehicleId!==swap.quote.snapshot.targetVehicleId)return result;
   return{ownerId:owner(rule.ownerId),snapshot:rule,verified:true,staged:true};
  }
  result.snapshot=parsed.snapshot.termsSnapshot.revenueRuleSnapshot??null;
  const ready=await readRenewalBillSource(tx,bill);
  if(!ready||ready.source.stage.id!==row.id)return result;
  return{ownerId:owner(ready.source.snapshot.identity.ownerId),snapshot:ready.source.snapshot.termsSnapshot.revenueRuleSnapshot??null,verified:true,staged:true};
 }catch(error){
  // These are expected source/permission conflicts, not failures of the verified
  // channel receipt. Unknown storage/programming failures remain retryable.
  if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus()))return result;
  throw error;
 }
}
