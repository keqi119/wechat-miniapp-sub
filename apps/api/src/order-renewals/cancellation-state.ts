import{ensure}from'../common/errors';

/** Read under the caller's existing source/order lock. Never hide storage failures. */
export async function assertRenewalNotCancelling(tx:any,changeId:string){
 const open=await tx.orderRenewalCancellation.findFirst({where:{changeId,status:'OPEN',OR:[{lifecycleState:null},{lifecycleState:{not:'REJECTED'}}]},select:{id:true}});
 ensure(!open,409,'RENEWAL_CANCELLATION_IN_PROGRESS','本次未来续期正在办理取消，请先核清取消结果');
}
