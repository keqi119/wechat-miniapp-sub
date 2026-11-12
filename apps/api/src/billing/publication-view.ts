import {HttpException} from '@nestjs/common';
import {billAutoPublishOn,evaluateBillAutoPublication,isAutomaticBill} from './auto-publication';

export type BillPublication={mode:'AUTOMATIC'|'MANUAL';scheduledDate:string|null;state:'SCHEDULED'|'WAITING'|'BLOCKED'|'PUBLISHED'|'CLOSED'|'MANUAL';message:string;blockers:string[]};
const messages:Record<string,string>={
 BILL_AUTO_PUBLICATION_DISABLED:'自动发布服务暂未启用，请联系平台管理员。',
 OFFLINE_ARCHIVE_REQUIRED:'等待当前线下合同审核归档，完成后按计划自动发布。',
 ARCHIVE_SNAPSHOT_MISMATCH:'合同归档与当前方案不一致，请先完成当前版本合同归档。',
 ARCHIVE_FEEDBACK_OPEN:'合同资料存在未处理反馈，请先处理反馈。',
 TERMS_MISSING:'当前有效商业条款不完整，请先核对合同方案。',
 SIGNATURE_ARCHIVE_REQUIRED:'等待合同签署及归档完成。',
 ORDER_STATE:'订单已关闭或当前阶段不允许自动发布。',
 BILL_AMOUNT_INVALID:'账单金额状态异常，请联系财务核对。',
 BILL_OWNERSHIP:'账单与订单的客户归属不一致，请联系平台管理员核对。',
 CONTRACT_MODE_INVALID:'订单合同模式异常，请联系平台管理员核对。',
 ORDER_CHANGE_PAYMENT_BLOCKED:'订单变更尚未完成，请按已签补充协议处理资金安排。',
 PHYSICAL_RETURN_BILL_PAUSED:'车辆已实际收回，未来未履约月份暂停发布，待归还结算。',
 RETURN_FUTURE_BILL:'车辆已归还，未来未履约月份暂停发布，待归还结算。',
 BILL_AUTO_PUBLICATION_CHECK_FAILED:'暂时无法核对自动发布条件，系统将重试；请稍后刷新。',
};

/** Allowlisted, read-only administrative explanation. Never disclose internal exception details. */
export async function billPublicationView(tx:any,bill:any,now=new Date(),enabled=process.env.BILL_AUTO_PUBLISH_ENABLED==='true'):Promise<BillPublication>{
 if(!isAutomaticBill(bill.type))return{mode:'MANUAL',scheduledDate:null,state:'MANUAL',message:'按费用或权益对应流程办理。',blockers:[]};
 const scheduledDate=billAutoPublishOn(bill.dueDate),base={mode:'AUTOMATIC' as const,scheduledDate};
 if(['PENDING','PAID'].includes(bill.status))return{...base,state:'PUBLISHED',message:bill.status==='PAID'?'已支付':'已发布，等待客户支付。',blockers:[]};
 if(bill.status!=='DRAFT')return{...base,state:'CLOSED',message:'账单已结束，不再自动发布。',blockers:[]};
 let blocker:string|undefined;
 if(!enabled)blocker='BILL_AUTO_PUBLICATION_DISABLED';
 else try{await evaluateBillAutoPublication(tx,bill,now);}catch(error){
  const code=error instanceof HttpException?(error.getResponse() as any)?.error?.code:undefined;
  if(code==='BILL_AUTO_PUBLICATION_NOT_DUE')return{...base,state:'SCHEDULED',message:`预计 ${scheduledDate} 自动发布（北京时间，到期前3天）。`,blockers:[]};
  blocker=code&&messages[code]?code:'BILL_AUTO_PUBLICATION_CHECK_FAILED';
 }
 if(blocker)return{...base,state:'BLOCKED',message:messages[blocker],blockers:[blocker]};
 return{...base,state:'WAITING',message:'已进入发布窗口，系统将在下一次扫描自动发布。',blockers:[]};
}

export async function withBillPublication(tx:any,bills:any[],now=new Date()){
 // Bound query pressure for a 100-row admin page; no locks or writes on reads.
 const result:any[]=[];
 for(const bill of bills)result.push({...bill,publication:await billPublicationView(tx,bill,now)});
 return result;
}
