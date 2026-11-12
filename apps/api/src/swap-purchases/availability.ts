import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {requireOfflineSwapFacts} from '../vehicle-changes/offline-facts';

/** Rollout only. Callers must use the stored order and still verify its current source. */
export function swapPurchaseEnabled(order:{contractMode?:string|null},env:NodeJS.ProcessEnv=process.env){
 const mode=order?.contractMode;
 return order!=null&&env.SWAP_CREDIT_PURCHASE_ENABLED==='true'&&(['OFFLINE','ELECTRONIC'].includes(mode??'')||((mode==null||mode==='ESIGN')&&env.MVP_V2_ENABLED!=='true'));
}

/** New purchase/payment only; never use current qualification to erase historical receipts. */
export async function requireSwapPurchaseEligibility(tx:any,order:any,now:Date){
 ensure(order&&[undefined,null,'ESIGN','OFFLINE','ELECTRONIC'].includes(order.contractMode),409,'SWAP_PURCHASE_MODE','换车购买订单模式无效');
 if(['OFFLINE','ELECTRONIC'].includes(order.contractMode))await requireOfflineSwapFacts(tx,order,undefined,now);
}

export async function swapPurchaseEligibilityBlockers(tx:any,order:any,now:Date):Promise<string[]>{
 try{await requireSwapPurchaseEligibility(tx,order,now);return[];}
 catch(error){if(error instanceof HttpException&&error.getStatus()===409)return[(error.getResponse() as any).error?.code||'SWAP_PURCHASE_SOURCE'];throw error;}
}
