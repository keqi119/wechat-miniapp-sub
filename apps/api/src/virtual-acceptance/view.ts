import {isVirtualVehicle,VIRTUAL_NOTICE} from './scope';
import {readElectronicSubscriptionReady} from '../electronic-documents/subscription';
import {readDeliveryFunding} from '../orders/readiness';
/** Historical display derives only from archived signature proof and retained real funds. */
export async function virtualOrderView(tx:any,order:any){
 if(!await isVirtualVehicle(tx,order.vehicleId))return null;
 const archive=await readElectronicSubscriptionReady(tx,order.id),funding=await readDeliveryFunding(tx,order);
 const completed=archive.ready&&funding.ready&&funding.bills.length===2&&funding.bills.every((b:any)=>b.amount===100)&&funding.bills.some((b:any)=>b.type==='DEPOSIT'&&b.sequence===0)&&funding.bills.some((b:any)=>b.type==='SUBSCRIPTION'&&b.sequence===1);
 return{kind:'VIRTUAL_ACCEPTANCE',notice:VIRTUAL_NOTICE,completed,title:completed?'测试签约与付款已完成':'虚拟流程验收进行中',description:completed?'本测试到此结束，无需车辆交付':VIRTUAL_NOTICE+'。请依次完成本人实名、合同签署归档及押金和首期各1元付款。'};
}
