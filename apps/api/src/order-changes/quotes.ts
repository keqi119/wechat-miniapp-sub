import {approvedTemplate} from '../contract/contract-template';
import { hash } from '../common/data';
import { ensure } from '../common/errors';
import { dateOnly } from '../billing/rules';
import { day,periods } from '../usage/rules';
import { financialContext } from './context';
import { requireCurrentConsents } from '../auth/consents';
import {accountReadiness,decryptIdentity} from '../esign/fadada/fadada-safety';
import {resolveDelayTemplate} from '../contract/delay-template';
import {randomUUID} from 'node:crypto';
export async function quote(tx:any,change:any,input:any,actor:any){
  ensure(input.externalCompensationRequired===false,409,'MANUAL_FINANCE_REQUIRED','本次涉及系统范围外额外赔付，须先由人工财务处理，不可报为已核清或发起签署；此限制不影响客户依法享有的权利');
  const active=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}}):null;const oldContract=active?await tx.contract.findUnique({where:{delayQuoteId:active.id}}):null;const signingTerminated=change.status==='AWAITING_SIGNATURE'&&(['REJECTED','EXPIRED'].includes(oldContract?.status)||(oldContract?.status==='DRAFT'&&!oldContract.providerTaskId&&!oldContract.signingLeaseUntil));const expired=active?.status==='PUBLISHED'&&new Date(active.snapshot.expiresAt)<=new Date();
  ensure(['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)||(change.status==='AWAITING_CONFIRMATION'&&expired)||signingTerminated,409,'CHANGE_STATE','当前变更不可改价');
  ensure(!/待确认|待补齐|待填写|另行通知|\{\{|\}\}/.test(JSON.stringify([input.periods,input.reason,input.settlementExplanation,input.handoverArrangement,input.cancellationTerms])),400,'COMMERCIAL_INCOMPLETE','须逐单写明真实费用与安排，不可使用待确认等占位说明');
  const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId}}),funds=await financialContext(tx,order),prior=change.priorTerms;
  ensure(funds.blockers.length===0,409,'FUNDS_UNCONFIRMED',funds.blockers.join('；'));
  ensure(dateOnly(input.newStartDate)>dateOnly(String(prior.startDate).slice(0,10)),400,'DELAY_DATE','延期起租日须晚于原有效起租日');
  ensure(new Date(input.expiresAt)>new Date(),400,'QUOTE_EXPIRY','报价有效期须为未来时间');
  const schedule=periods(input.newStartDate,prior.months);
  ensure(input.periods.length===schedule.length&&new Set(input.periods.map((p:any)=>p.sequence)).size===schedule.length,400,'PERIODS_REQUIRED','须逐期明确全部订阅月份的金额、付款日和依据');
  const rows=schedule.map(period=>{const row=input.periods.find((p:any)=>p.sequence===period.sequence),old=funds.rows.find((p:any)=>p.sequence===period.sequence)!;ensure(row,400,'PERIODS_REQUIRED','期数不完整');dateOnly(row.dueDate);return{...row,startDate:day(period.startDate),endDate:day(period.endDate),originalAmount:old.amount,netPaidAmount:old.netPaidAmount,carryAmount:Math.min(row.amount,old.netPaidAmount),chargeAmount:Math.max(0,row.amount-old.netPaidAmount),refundAmount:Math.max(0,old.netPaidAmount-row.amount)};});
  const last=schedule.at(-1)!,snapshot={expiresAt:input.expiresAt,externalCompensationRequired:false,newStartDate:input.newStartDate,newEndDate:day(new Date(last.endDate.getTime()-86400000)),months:prior.months,periods:rows,reason:input.reason,settlementExplanation:input.settlementExplanation,handoverArrangement:input.handoverArrangement,cancellationTerms:input.cancellationTerms,document:null};
  const revision=(await tx.delayQuote.aggregate({where:{changeId:change.id},_max:{revision:true}}))._max.revision+1||1;
  if(change.activeQuoteId)await tx.delayQuote.update({where:{id:change.activeQuoteId},data:{status:'SUPERSEDED'}});
  const item=await tx.delayQuote.create({data:{changeId:change.id,revision,commercialHash:hash({priorTermsHash:change.priorTermsHash,...snapshot}),snapshot,fundsSnapshot:funds.rows,createdBy:actor.id}});
  await tx.orderChange.update({where:{id:change.id},data:{activeQuoteId:item.id,status:'REVIEW_PENDING'}});
}
export async function review(tx:any,change:any,input:any,actor:any){
  ensure(change.status==='REVIEW_PENDING',409,'CHANGE_STATE','当前报价不可复核');const q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}});
  ensure(q.createdBy!==actor.id,403,'TWO_PERSON_REQUIRED','报价与财务复核须由不同人员完成');
  await tx.delayQuote.update({where:{id:q.id},data:{status:input.decision==='APPROVED'?'REVIEWED':'REJECTED',reviewedBy:actor.id,reviewNote:input.note}});
  await tx.orderChange.update({where:{id:change.id},data:{status:input.decision==='APPROVED'?'REVIEWED':'DRAFT'}});
}
export async function publish(tx:any,change:any){
  ensure(change.status==='REVIEWED',409,'CHANGE_STATE','请先完成独立财务复核');
  const q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}});
  ensure(new Date(q.snapshot.expiresAt)>new Date(),409,'QUOTE_EXPIRED','报价已过期，请重新报价及复核');
  const legal=await tx.legalDocument.findFirst({where:{type:'delivery-delay-amendment',status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}});
  ensure(legal,409,'LEGAL_UNAVAILABLE','延期补充协议尚未批准发布');approvedTemplate(legal);
  const account=await tx.eSignAccount.findUnique({where:{customerId:change.customerId}});
  ensure(accountReadiness(account).realNameStatus==='VERIFIED',409,'REALNAME_REQUIRED','请先核验客户现有实名资料再发布补充协议');
  const identity=decryptIdentity(account.identityCiphertext,change.customerId,process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'');
  const original=await tx.contract.findUnique({where:{id:change.originalContractId}}),file=original?.signedFileId?await tx.storedFile.findUnique({where:{id:original.signedFileId}}):null;
  ensure(original?.status==='SIGNED'&&original.kind==='SUBSCRIPTION'&&file?.mimeType==='application/pdf'&&file.customerId===change.customerId,409,'ORIGINAL_CONTRACT','原主合同已签归档缺失，不能发布补充协议');
  const order=await tx.order.findUniqueOrThrow({where:{id:change.orderId},include:{customer:true}}),contractId=randomUUID(),templateHash=hash(legal.content);
  const commercialHash=hash({priorTermsHash:change.priorTermsHash,snapshot:q.snapshot,templateHash,identityHash:account.verifiedIdentityHash,contractId,originalContractHash:file.sha256});
  const preview={...q.snapshot,document:{id:legal.id,type:legal.type,version:legal.version,templateHash}};
  const body=resolveDelayTemplate(legal.content,{id:contractId,orderId:order.id,order,originalContractHash:file.sha256,delayQuote:{...q,status:'PUBLISHED',commercialHash,snapshot:preview,change}},identity);
  const bodyHash=hash(body),snapshot={...preview,document:{...preview.document,hash:bodyHash,bodyHash,content:body}};
  await tx.delayQuote.update({where:{id:q.id},data:{status:'PUBLISHED',snapshot,commercialHash}});
  await tx.contract.create({data:{id:contractId,orderId:change.orderId,customerId:change.customerId,kind:'AMENDMENT',delayQuoteId:q.id,documentId:legal.id,templateVersion:legal.version,body,documentHash:commercialHash}});
  await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_CONFIRMATION'}});
}
export async function confirm(tx:any,change:any,input:any){
  ensure(change.status==='AWAITING_CONFIRMATION',409,'CHANGE_STATE','当前变更不可确认');
  await requireCurrentConsents(tx,change.customerId,['terms','privacy']);
  const q=await tx.delayQuote.findUniqueOrThrow({where:{id:change.activeQuoteId}}),document=q.snapshot.document;
  ensure(new Date(q.snapshot.expiresAt)>new Date(),409,'QUOTE_EXPIRED','报价已过期，请联系运营重新出具');
  ensure(document&&q.commercialHash===input.commercialHash,409,'QUOTE_MISMATCH','报价已更新，请重新完整阅读');
  const legal=await tx.legalDocument.findUnique({where:{id:document.id}});ensure(legal?.status==='PUBLISHED'&&legal.confirmedAt&&hash(legal.content)===document.templateHash&&hash(document.content)===document.bodyHash,409,'LEGAL_UNAVAILABLE','补充协议版本已变化，请联系运营');
  await tx.delayQuote.update({where:{id:q.id},data:{status:'CONFIRMED',confirmedAt:new Date()}});
  const contract=await tx.contract.findUnique({where:{delayQuoteId:q.id}});ensure(contract?.status==='DRAFT'&&contract.body===document.content&&contract.documentHash===q.commercialHash,409,'DOCUMENT_MISMATCH','补充协议正文已变化');
  await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_SIGNATURE'}});
}
