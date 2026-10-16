import {ensure} from '../common/errors';
import {fen} from '../common/data';
import {periods,day} from '../usage/rules';
export function resolveDelayTemplate(template:string,resource:any,identity:any){
 const q=resource.delayQuote,change=q?.change,s=q?.snapshot,prior=change?.priorTerms;
 ensure(change&&s?.document&&['PUBLISHED','CONFIRMED'].includes(q.status)&&change.activeQuoteId===q.id,409,'AMENDMENT_STATE','补充协议报价未确认或不是当前版本');
 const oldEnd=periods(String(prior.startDate).slice(0,10),prior.months).at(-1)!.endDate;
 const values:Record<string,string>={contractNo:resource.id,orderNo:resource.orderId,applicationId:resource.order.applicationId,originalContractNo:change.originalContractId,originalContractHash:resource.originalContractHash,changeId:change.id,quoteRevision:String(q.revision),commercialHash:q.commercialHash,customerName:identity.name,customerIdentityNo:identity.idCardNo,customerMobile:resource.order.customer.mobile,customerAddress:prior.commercialTerms.customerAddress,vehicleIdentification:prior.commercialTerms.vehicleIdentification,months:String(prior.months),originalStartDate:String(prior.startDate).slice(0,10),originalEndDate:day(new Date(oldEnd.getTime()-86400000)),newStartDate:s.newStartDate,newEndDate:s.newEndDate,
 periodSchedule:s.periods.map((p:any)=>`第${p.sequence}期：${p.startDate}（含）至${p.endDate}（不含），应收${fen(p.amount)}，付款到期日${p.dueDate}；依据：${p.calculationBasis}`).join('\n'),financialSchedule:s.periods.map((p:any)=>`第${p.sequence}期：原净实收${fen(p.netPaidAmount)}，本期沿用${fen(p.carryAmount)}，需主动补付${fen(p.chargeAmount)}，需原路退回${fen(p.refundAmount)}`).join('\n'),depositText:`原押金${fen(prior.depositAmount)}不变`,changeReason:s.reason,settlementExplanation:s.settlementExplanation,handoverArrangement:s.handoverArrangement,cancellationTerms:s.cancellationTerms,platformSignatureSlot:'由企业签章区签署',customerSignatureSlot:'由客户签署区签署'};
 const body=template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_,key)=>{ensure(typeof values[key]==='string'&&values[key].trim(),409,'LEGAL_PLACEHOLDERS',`补充协议字段缺失：${key}`);return values[key];});ensure(!/\{\{|\}\}|待补齐|待填写/.test(body),409,'LEGAL_PLACEHOLDERS','补充协议有未填字段');return body;
}
