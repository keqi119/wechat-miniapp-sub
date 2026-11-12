import {randomUUID} from 'node:crypto';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {approvedTemplate} from '../contract/contract-template';
import {parseCustomerProfileSnapshot} from '../customers/profile';
import {usagePolicyAppendix} from '../usage/policy';
import {revalidateRenewalQuote} from './quotes';
import {renewalCommercialHash} from './types';
const required=(v:any)=>{ensure(typeof v==='string'&&v.trim()&&!v.includes('\0'),409,'LEGAL_PLACEHOLDERS','续期纸文所需冻结事实缺失');return v;};
const cash=(value:number)=>{ensure(Number.isSafeInteger(value)&&value>=0,409,'AMOUNT_INVALID','金额无效');return`${BigInt(value)/100n}.${String(BigInt(value)%100n).padStart(2,'0')}`;};

export async function publishRenewal(tx:any,change:any,q:any,now:Date){
 ensure(change.status==='REVIEWED'&&q.status==='REVIEWED'&&q.reviewedBy&&q.reviewedBy!==q.createdBy,409,'TWO_PERSON_REQUIRED','须先完成独立财务复核');
 const {facts}=await revalidateRenewalQuote(tx,change,q,now),s=q.snapshot,profile=parseCustomerProfileSnapshot(facts.order.finalPlanSnapshot.customerProfileSnapshot),parties=facts.order.finalPlanSnapshot.partiesSnapshot,lessor=s.renewalTerms.lessorSnapshot;
 const customer=parties?.find((p:any)=>p.role==='CUSTOMER'),owner=parties?.find((p:any)=>p.role==='OWNER'),platform=parties?.find((p:any)=>p.role==='PLATFORM');
 ensure(profile&&customer?.partyId===change.customerId&&customer.name===profile.name&&owner?.partyId===lessor.ownerId&&owner.name===lessor.name&&platform?.name,409,'OFFLINE_PARTIES_SNAPSHOT_REQUIRED','原签约主体与续期实际出租方不一致');
 const legal=await tx.legalDocument.findFirst({where:{type:'OFFLINE_ORDER_AMENDMENT',status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}});ensure(legal?.type==='OFFLINE_ORDER_AMENDMENT',409,'LEGAL_UNAVAILABLE','线下补充协议模板未正式批准发布');approvedTemplate(legal);
 let template=legal.content;try{const parsed=JSON.parse(template);if(typeof parsed?.body==='string')template=parsed.body;}catch{}
 ensure(['changeFacts','periodSchedule','financialSchedule'].every(k=>template.includes(`{{${k}}}`)),409,'LEGAL_PLACEHOLDERS','共同补充协议模板必须包含变更、逐期价格和资金事实组');
 const contractId=randomUUID(),templateHash=hash(legal.content),offlineSource={policy:'OFFLINE_RENEWAL_V1',originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:s.source.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash,renewalSourceHash:s.sourceHash,serviceStageId:s.renewalTerms.serviceStageId};
 const commercialHash=renewalCommercialHash(change,s,templateHash,contractId,offlineSource);
 const changeFacts=[`原订单同一实际车辆${facts.vehicle.title}；VIN：${facts.vehicle.vin||'未登记'}；车牌：${facts.vehicle.plateNumber||'未登记'}。同一实际出租方：${lessor.name}。`,
  `原服务期至${facts.current.snapshot.period.endDate}（不含）；续期${s.startDate}（含）至${s.endDate}（不含），共${s.months}个月，不新增交付或归还事实。`,
  `选择商品${s.product.listingId}版本${s.product.listingRevision}；产品${s.product.name}版本${s.product.version}，来源摘要${s.product.sourceHash}。原月费${cash(facts.terms.monthlyFeeAmount)}元；续期月费${cash(s.monthlyFeeAmount)}元。`,
  `原押金保持${cash(s.depositAmount)}元，不重复收取押金。续期每月基础${s.usagePricing.baseAllowanceKm}公里，超额每公里${cash(s.usagePricing.excessPriceAmount)}元；充换电费用由客户自付。`,
  `续期阶段赠送${s.swapPolicy.includedCount}次换车，额外单次${cash(s.swapPolicy.extraFeeAmount)}元；原免费次数到期不结转，已付费次数仍按购买时原有效期及冻结金额处理，不延长或改退款价。`,
  '客户确认、纸档归档与提前付款均不提前改变当前费率或赠送；运营须在生效日或之后核清真实来源并显式激活。保险在办理及实际激活时核实，不能将某一时点保障视为全部续期保障。',
  '原服务月按原冻结规则结算；原已购里程按原条款和真实余额处理，不在续期时自动清零、延长或恢复。',
  `办理原因：${s.input.reason}。续期条款：${s.product.conditions}。资金安排：${s.input.settlementExplanation}。取消及异常：${s.input.cancellationTerms}。`,usagePolicyAppendix(s.renewalTerms.usagePolicy)].join('\n');
 const values:Record<string,unknown>={contractNo:contractId,orderNo:change.orderId,applicationId:facts.order.applicationId,originalContractNo:s.source.originalContractNumber,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:s.source.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??'INITIAL',priorTermsHash:change.priorTermsHash,changeId:change.id,quoteRevision:String(q.revision),commercialHash,customerName:profile.name,customerPartyId:customer.partyId,customerMobile:profile.mobile,customerAddress:facts.terms.commercialTerms?.customerAddress,lessorName:lessor.name,lessorPartyId:lessor.ownerId,lessorCreditCode:lessor.creditCode,lessorAddress:lessor.address,lessorPhone:lessor.phone,platformName:platform.name,platformPartyId:platform.partyId,changeFacts,
  periodSchedule:s.periods.map((p:any)=>`续期第${p.stageSequence}期（全单第${p.sequence}期）：${p.startDate}（含）至${p.endDate}（不含），应收${cash(p.amount)}元，到期日${p.dueDate}。`).join('\n'),
  financialSchedule:`续期${s.months}期合计${cash(s.totalAmount)}元，各期单独应收；原账单、原收款和原押金保持，不挪用原期已收款，不自动扣款或退款。财务核准后客户可主动提前支付续期首期，后续期按到期安排主动付款；首期及相关既有义务核清后才可安排待生效。`};
 const body=template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_:string,key:string)=>{ensure(Object.hasOwn(values,key),409,'LEGAL_PLACEHOLDERS',`续期协议没有可核验字段：${key}`);return required(values[key]);});ensure(body.trim()&&!/\{\{|\}\}|待补齐|待填写/.test(body),409,'LEGAL_PLACEHOLDERS','续期协议仍有未填写内容');
 const document={id:legal.id,type:legal.type,version:legal.version,templateHash,bodyHash:hash(body),content:body};
 await tx.delayQuote.update({where:{id:q.id},data:{status:'PUBLISHED',commercialHash,snapshot:{...s,offlineSource,renewalTerms:{...s.renewalTerms,commercialHash,amendmentContractId:contractId},document}}});
 await tx.contract.create({data:{id:contractId,orderId:change.orderId,customerId:change.customerId,kind:'AMENDMENT',executionMode:'OFFLINE',status:'DRAFT',delayQuoteId:q.id,documentId:legal.id,templateVersion:legal.version,body,documentHash:commercialHash}});
 await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_CONFIRMATION'}});
}
