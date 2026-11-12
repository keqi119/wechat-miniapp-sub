import {randomUUID} from 'node:crypto';
import {hash} from '../common/data';
import {ensure} from '../common/errors';
import {approvedTemplate} from '../contract/contract-template';
import {parseCustomerProfileSnapshot} from '../customers/profile';
import {freezeSwapPolicy} from '../swap-purchases/policy';
import {requireOfflineSwapFacts} from './offline-facts';
import {assertOfflineSwapQuote,requireOfflineSwapTarget} from './offline-target';

const required=(v:any)=>{ensure(typeof v==='string'&&v.trim()&&!v.includes('\0'),409,'LEGAL_PLACEHOLDERS','补充协议所需冻结事实缺失');return v;};
const cash=(v:any)=>{ensure(Number.isSafeInteger(v)&&v>=0,409,'AMOUNT_INVALID','冻结金额无效');const n=BigInt(v);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;};
export const offlineSwapTemplateGroups=['changeFacts','periodSchedule','financialSchedule'] as const;

export async function publishOfflineSwap(tx:any,order:any,change:any,q:any){
 const s=assertOfflineSwapQuote(change,q),facts=await requireOfflineSwapFacts(tx,order,change,new Date(),!!s.previousPreparedQuoteId);
 await requireOfflineSwapTarget(tx,order,change,q,new Date(s.plannedDeliveryAt));
 const initial=order.finalPlanSnapshot,profile=parseCustomerProfileSnapshot(initial?.customerProfileSnapshot),parties=initial?.partiesSnapshot;
 ensure(profile,409,'OFFLINE_CUSTOMER_SNAPSHOT_REQUIRED','原订单客户资料快照缺失');
 const customer=parties?.find((p:any)=>p.role==='CUSTOMER'),owner=parties?.find((p:any)=>p.role==='OWNER'),platform=parties?.find((p:any)=>p.role==='PLATFORM'),lessor=s.targetLessorSnapshot;
 ensure(customer?.partyId===change.customerId&&customer.name===profile.name&&owner?.partyId===lessor.ownerId&&owner.name===lessor.name&&platform?.name,409,'OFFLINE_PARTIES_SNAPSHOT_REQUIRED','原签约主体与目标车辆出租方不一致');
 const archive=await tx.documentArchive.findUnique({where:{id:facts.chain.original.archiveId},include:{versions:true}}),original=archive?.versions.find((v:any)=>v.id===change.originalArchiveVersionId);
 ensure(original&&/^[a-f0-9]{64}$/.test(original.fileManifestHash),409,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH','原签字件清单摘要缺失');
 const legal=await tx.legalDocument.findFirst({where:{type:'OFFLINE_ORDER_AMENDMENT',status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}});
 ensure(legal?.type==='OFFLINE_ORDER_AMENDMENT',409,'LEGAL_UNAVAILABLE','线下补充协议模板尚未批准发布');approvedTemplate(legal);
 ensure(q.status==='REVIEWED'&&q.reviewedBy&&q.reviewedBy!==q.createdBy,409,'TWO_PERSON_REQUIRED','须先完成独立报价复核');
 let template=legal.content;try{const parsed=JSON.parse(template);if(parsed&&typeof parsed.body==='string')template=parsed.body;}catch{}
 const missing=offlineSwapTemplateGroups.filter(key=>!template.includes(`{{${key}}}`)&&!(key==='changeFacts'&&template.includes('{{swapFacts}}')));ensure(!missing.length,409,'LEGAL_PLACEHOLDERS',`OFFLINE_SWAP_V2模板缺少事实组：${missing.join('、')}`);
 const contractId=randomUUID(),templateHash=hash(legal.content),policy=freezeSwapPolicy(s.serviceStageScope?{finalPlanSnapshot:change.priorTerms}:order),prior=change.priorTerms;
 const offlineSource={policy:'OFFLINE_SWAP_V2',originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:original.fileManifestHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash,customerProfileSnapshotHash:hash(profile),partiesSnapshotHash:hash(parties),pricingHash:s.pricingHash,targetSourceHash:s.targetSource.product.sourceHash};
 const commercialHash=hash({priorTermsHash:change.priorTermsHash,snapshot:s,templateHash,contractId,offlineSource});
 const swapRule=policy?`${s.serviceStageScope?'本服务段':'原合同期'}赠送${policy.includedCount}次，额外单次服务费${cash(policy.extraFeeAmount)}元；本次实际完成仅扣一次，${s.serviceStageScope?'本服务段':'原合同期'}不重置。`:'沿用原历史次数来源，不因选择新版商品新增赠送次数。';
 const swapFacts=[`原车：${required(s.oldVehicleIdentification)}；换入车：${required(s.targetVehicleIdentification)}。`,
  `同一实际出租方：${owner.name}（${owner.partyId}）；商品${s.targetSource.product.listingId}，版本${s.targetSource.product.listingRevision}；产品${required(s.targetSource.product.name)}，版本${s.targetSource.product.version}；商品来源${s.targetSource.product.sourceHash}。`,
  `原服务期${required(s.newStartDate)}至${required(s.newEndDate)}（含最后日），原${prior.months}个月不延长。原当前月费${cash(s.pricing.currentMonthlyFeeAmount)}元，新月费${cash(s.newMonthlyFeeAmount)}元。`,
  `计划旧车归还${required(s.plannedReturnAt)}，新车交付${required(s.plannedDeliveryAt)}；实际交付日计入新车，逐期按原服务月实际天数折算并四舍五入到分，差额合计${cash(s.pricing.pricing.totalDifferenceAmount)}元。`,
  `押金${cash(s.depositAmount)}元；依据：${required(s.depositBasis)}。本报价未另收交接费。`,
  `保险及责任：${required(s.insuranceResponsibility)}；无车期间：${required(s.downtimeArrangement)}；交接：${required(s.handoverArrangement)}。`,
  `结算：${required(s.settlementExplanation)}；取消及异常：${required(s.cancellationTerms)}。`,swapRule,
  '原用量政策、原服务月和已购里程余额沿用，目标商品里程或赠送次数不覆盖原权益；充换电费用由客户自付。',
  '先核清本次应退、押金及交付所在期及之前应收；未来月份仍按原到期日主动付款，不自动扣款。'].join('\n');
 const values:Record<string,unknown>={contractNo:contractId,orderNo:order.id,applicationId:order.applicationId,originalContractNo:required(original.contractNumber),originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:original.fileManifestHash,priorTermsVersionId:change.priorTermsVersionId??'INITIAL',priorTermsHash:change.priorTermsHash,changeId:change.id,quoteRevision:String(q.revision),commercialHash,customerName:profile.name,customerPartyId:customer.partyId,customerMobile:profile.mobile,customerAddress:prior.commercialTerms?.customerAddress,lessorName:owner.name,lessorPartyId:owner.partyId,lessorCreditCode:lessor.creditCode,lessorAddress:lessor.address,lessorPhone:lessor.phone,platformName:platform.name,platformPartyId:platform.partyId,swapFacts,
  periodSchedule:s.periods.map((p:any,index:number)=>{const math=s.pricing.pricing.periods[index];return`第${p.sequence}期原服务月${p.startDate}（含）至${p.endDate}（不含），共${math.totalDays}天，新车计${math.chargeDays}天；原应收${cash(p.originalAmount)}元，本次差价${cash(p.differenceAmount)}元，新应收${cash(p.amount)}元，到期${p.dueDate}。`;}).join('\n'),
  financialSchedule:[...s.periods.map((p:any)=>`第${p.sequence}期实际净收${cash(p.netPaidAmount)}元，沿用${cash(p.carryAmount)}元，补收${cash(p.chargeAmount)}元，原路应退${cash(p.refundAmount)}元。`),`押金原净收${cash(s.depositNetPaidAmount)}元，补收${cash(s.depositChargeAmount)}元，原路应退${cash(s.depositRefundAmount)}元。`].join('\n')};
 values.changeFacts=swapFacts;
 const body=template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_:string,key:string)=>{ensure(Object.hasOwn(values,key),409,'LEGAL_PLACEHOLDERS',`线下换车协议没有可核验字段：${key}`);return required(values[key]);});
 ensure(body.trim()&&!/\{\{|\}\}|待补齐|待填写/.test(body),409,'LEGAL_PLACEHOLDERS','补充协议仍有未填字段');
 const document={id:legal.id,type:legal.type,version:legal.version,templateHash,bodyHash:hash(body),content:body};
 await tx.delayQuote.update({where:{id:q.id},data:{status:'PUBLISHED',commercialHash,snapshot:{...s,offlineSource,originalArchiveHash:original.fileManifestHash,document}}});
 await tx.contract.create({data:{id:contractId,orderId:order.id,customerId:change.customerId,kind:'AMENDMENT',executionMode:'OFFLINE',status:'DRAFT',delayQuoteId:q.id,documentId:legal.id,templateVersion:legal.version,body,documentHash:commercialHash}});
 await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_CONFIRMATION'}});
}
