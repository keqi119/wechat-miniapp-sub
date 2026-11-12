import {z} from 'zod';
import {key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {lockOrder} from './readiness';
import {archiveCommand} from './command';
export async function handoverCommand(tx:any,actor:any,id:string,action:string,raw:any,operation:()=>Promise<any>,create=false){
 await requireCurrentStaff(tx,actor,'handovers');const ref=create?await tx.order.findUnique({where:{id}}):await tx.handover.findUnique({where:{id}});ensure(ref,404,'NOT_FOUND','交接或订单不存在');await lockOrder(tx,create?id:ref.orderId);
 const current=create?await tx.order.findUnique({where:{id}}):await tx.handover.findUnique({where:{id}});
 if(!['OFFLINE','ELECTRONIC'].includes(create?current.contractMode:current.executionMode))return operation();
 const command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).passthrough().parse(raw||{});
 return archiveCommand(tx,actor,id,`HANDOVER_${action}`,command,async()=>{ensure(command.revision===current.revision,409,'REVISION_CONFLICT','订单或查验资料已变化，请刷新后核对');return operation();});
}
