import {isOnlineHandover,requireOnlineConfirmation} from '../operations/online-handover';
import {ensure} from '../common/errors';
import {handoverDocumentReady} from './readiness';
export function assertOfflineInspection(handover:{status:string;customerResponse?:string|null;confirmedAt?:Date|null},completed=false){
 ensure((completed?handover.status==='COMPLETED':handover.status==='CUSTOMER_CONFIRMED')&&handover.customerResponse==='CONFIRM'&&handover.confirmedAt,409,'HANDOVER_NOT_READY','须由客户确认当前版本查验事实');
}
export async function requireOfflineHandoverReady(tx:any,handover:any,completed=false){
 assertOfflineInspection(handover,completed);
 const ready=isOnlineHandover(handover)?await requireOnlineConfirmation(tx,handover):await handoverDocumentReady(tx,handover.id);
 ensure(ready.ready,409,ready.blockers[0]||'OFFLINE_ARCHIVE_REQUIRED','须完成当前查验版本纸质交接单归档');
 ensure(!await tx.archiveFeedback.count({where:{status:'OPEN',version:{archive:{orderId:handover.orderId}}}}),409,'ARCHIVE_FEEDBACK_OPEN','本单仍有未解决的合同或交接资料反馈');
 return ready;
}
