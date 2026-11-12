import {purchaseAccount} from '../swap-purchases/view';
/** The shared reader checks new capabilities but never grants or bootstraps OFFLINE facts. */
export async function readOfflineSwapPurchases(tx:any,order:any,account:any,now:Date){
 return purchaseAccount(tx,order,account,now);
}
