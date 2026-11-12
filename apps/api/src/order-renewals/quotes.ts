import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {buildRenewalPreview} from './context';
import {previewFields,renewalQuoteInput,renewalSourceHash,assertRenewalQuote} from './types';
export {renewalSourceHash,assertRenewalQuote} from './types';
export async function revalidateRenewalQuote(tx:any,change:any,q:any,now:Date){
 const s=assertRenewalQuote(change,q),order=await tx.order.findUnique({where:{id:change.orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
 ensure(new Date(s.expiresAt)>now,409,'QUOTE_EXPIRED','续期报价已过期，请重新报价');
 const fresh=await buildRenewalPreview(tx,change.orderId,{...s.input,orderRevision:order.revision},now,change.id);
 ensure(renewalSourceHash(fresh.value)===s.sourceHash,409,'RENEWAL_SOURCE_CHANGED','续期来源已变化，请重新预览并出具报价');return fresh;
}
export async function createRenewalQuote(tx:any,change:any,raw:unknown,actor:any,now:Date){
 const input=renewalQuoteInput.parse(raw),old=change.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}}):null;
 ensure(['DRAFT','REVIEW_PENDING','REVIEWED'].includes(change.status)||change.status==='AWAITING_CONFIRMATION'&&old?.status==='PUBLISHED'&&new Date(old.snapshot.input.expiresAt)<=now,409,'CHANGE_STATE','当前续期不可重新报价');
 const p=await buildRenewalPreview(tx,change.orderId,previewFields(input),now,change.id);ensure(p.previewHash===input.previewHash,409,'PREVIEW_CHANGED','预览来源已变化，请重新核对');
 ensure(change.priorTermsHash===hash(p.facts.terms)&&change.originalContractId===p.value.source.originalContractId&&change.originalArchiveVersionId===p.value.source.originalArchiveVersionId&&(change.priorTermsVersionId??null)===(p.value.source.priorTermsVersionId??null),409,'AGREEMENT_PRIOR_TERMS_MISMATCH','当前有效条款已改变');
 if(old){ensure(!old.confirmedAt&&!old.financePreparedAt&&!old.approvedArchiveVersionId,409,'CHANGE_STATE','已确认或有资金来源的报价不可覆盖');await tx.delayQuote.update({where:{id:old.id},data:{status:'SUPERSEDED'}});}
 const revision=((await tx.delayQuote.aggregate({where:{changeId:change.id},_max:{revision:true}}))._max.revision??0)+1;
 const snapshot={...p.value,sourceHash:renewalSourceHash(p.value),previewHash:p.previewHash,document:null};
 const q=await tx.delayQuote.create({data:{changeId:change.id,revision,snapshot,fundsSnapshot:[],commercialHash:hash({priorTermsHash:change.priorTermsHash,snapshot}),createdBy:actor.id}});
 await tx.orderChange.update({where:{id:change.id},data:{activeQuoteId:q.id,status:'REVIEW_PENDING'}});return q;
}
