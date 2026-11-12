import {randomUUID} from 'node:crypto';
import {fen,hash} from '../common/data';
import {ensure} from '../common/errors';
import {approvedTemplate} from '../contract/contract-template';
import {parseCustomerProfileSnapshot} from '../customers/profile';
import {day,periods} from '../usage/rules';
import {requireOfflineDelayFacts} from './context';

/** Only facts already frozen in the order/quote/archive are available to a published template. */
export const offlineDelayPlaceholders=[
 'contractNo','orderNo','applicationId','originalContractNo','originalArchiveVersionId','originalArchiveHash','priorTermsVersionId','priorTermsHash','changeId','quoteRevision','commercialHash',
 'customerName','customerPartyId','customerMobile','customerAddress','lessorName','lessorPartyId','lessorCreditCode','lessorAddress','lessorPhone','platformName','platformPartyId',
 'vehicleIdentification','months','originalStartDate','originalEndDate','newStartDate','newEndDate','periodSchedule','financialSchedule','depositText','changeReason','settlementExplanation','handoverArrangement','cancellationTerms','changeFacts',
] as const;
function required(value:any,code='LEGAL_PLACEHOLDERS'):string{ensure(typeof value==='string'&&value.trim()&&!value.includes('\0'),409,code,'线下补充协议所需冻结事实缺失');return value;}
function cash(value:any){ensure(Number.isSafeInteger(value)&&value>=0&&value<=2147483647,409,'AMOUNT_INVALID','金额须为有效非负整数分');return fen(value);}
export async function publishOfflineDelay(tx:any,order:any,change:any,q:any){
 ensure(change.kind==='DELIVERY_DELAY',409,'CHANGE_KIND','本阶段线下补充协议仅支持未交付延期');
 ensure(q.id===change.activeQuoteId&&q.changeId===change.id,409,'QUOTE_MISMATCH','当前报价不属于本次变更');
 const chain=await requireOfflineDelayFacts(tx,order,change);
 const initial=order.finalPlanSnapshot,profile=parseCustomerProfileSnapshot(initial?.customerProfileSnapshot),parties=initial?.partiesSnapshot,lessor=initial?.lessorSnapshot;
 ensure(profile,409,'OFFLINE_CUSTOMER_SNAPSHOT_REQUIRED','原订单人工资料快照缺失，不能用当前资料替代');
 const customer=parties?.find((p:any)=>p.role==='CUSTOMER'),owner=parties?.find((p:any)=>p.role==='OWNER'),platform=parties?.find((p:any)=>p.role==='PLATFORM');
 ensure(customer?.partyId===change.customerId&&customer.name===profile.name&&owner?.partyId===lessor?.ownerId&&owner.name===lessor.name&&platform?.name,409,'OFFLINE_PARTIES_SNAPSHOT_REQUIRED','原订单签约主体名称或归属不完整');
 const archive=await tx.documentArchive.findUnique({where:{id:chain.original!.archiveId},include:{versions:true}}),originalVersion=archive?.versions.find((v:any)=>v.id===change.originalArchiveVersionId);
 ensure(originalVersion&&/^[a-f0-9]{64}$/.test(originalVersion.fileManifestHash),409,'AGREEMENT_ORIGINAL_ARCHIVE_MISMATCH','原合同签字件清单摘要缺失');
 const legal=await tx.legalDocument.findFirst({where:{type:'OFFLINE_ORDER_AMENDMENT',status:'PUBLISHED',confirmedAt:{not:null}},orderBy:{version:'desc'}});
 ensure(legal?.type==='OFFLINE_ORDER_AMENDMENT',409,'LEGAL_UNAVAILABLE','线下订单补充协议正式模板尚未批准发布');approvedTemplate(legal);
 ensure(q.status==='REVIEWED'&&q.reviewedBy&&q.reviewedBy!==q.createdBy,409,'TWO_PERSON_REQUIRED','请先完成独立财务复核');
 const contractId=randomUUID(),templateHash=hash(legal.content),prior=change.priorTerms,s=q.snapshot;
 const offlineSource={policy:'OFFLINE_DELIVERY_DELAY_V1',originalContractId:change.originalContractId,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:originalVersion.fileManifestHash,priorTermsVersionId:change.priorTermsVersionId??null,priorTermsHash:change.priorTermsHash,customerProfileSnapshotHash:hash(profile),partiesSnapshotHash:hash(parties)};
 const commercialHash=hash({priorTermsHash:change.priorTermsHash,snapshot:s,templateHash,contractId,offlineSource});
 const originalEnd=periods(String(prior.startDate).slice(0,10),prior.months).at(-1)!.endDate;
 ensure(Array.isArray(s.periods)&&s.periods.length===prior.months,409,'PERIODS_REQUIRED','补充协议完整期数缺失');
 const changeFacts=[`本次办理未交付延期，变更记录${change.id}，报价第${q.revision}版；原合同编号${required(originalVersion.contractNumber)}，已签纸质版第${originalVersion.version}版。`,
  `车辆：${required(prior.commercialTerms?.vehicleIdentification)}。原服务期${required(String(prior.startDate).slice(0,10))}至${day(new Date(originalEnd.getTime()-86400000))}（含最后日）；延期后${required(s.newStartDate)}至${required(s.newEndDate)}（含最后日），仍为${prior.months}个月。`,
  `月费${cash(prior.monthlyFeeAmount)}元，原押金${cash(prior.depositAmount)}元不变；逐期应收、沿用款项及退款以本协议明细为准。`,
  `延期原因：${required(s.reason)}。结算依据：${required(s.settlementExplanation)}。交付安排：${required(s.handoverArrangement)}。取消及异常：${required(s.cancellationTerms)}。`,
  '本次不改变原冻结产品、里程政策和换车权益，不增加补能权益；充换电费用由客户自付。车辆尚未交付，后续按实际交付事实办理，延期确认不等于已经交车。'].join('\n');
 const values:Record<string,unknown>={contractNo:contractId,orderNo:order.id,applicationId:order.applicationId,originalContractNo:originalVersion.contractNumber,originalArchiveVersionId:change.originalArchiveVersionId,originalArchiveHash:offlineSource.originalArchiveHash,priorTermsVersionId:change.priorTermsVersionId??'INITIAL',priorTermsHash:change.priorTermsHash,changeId:change.id,quoteRevision:String(q.revision),commercialHash,changeFacts,
  customerName:profile.name,customerPartyId:customer.partyId,customerMobile:profile.mobile,customerAddress:prior.commercialTerms?.customerAddress,lessorName:owner.name,lessorPartyId:owner.partyId,lessorCreditCode:lessor.creditCode,lessorAddress:lessor.address,lessorPhone:lessor.phone,platformName:platform.name,platformPartyId:platform.partyId,
  vehicleIdentification:prior.commercialTerms?.vehicleIdentification,months:String(prior.months),originalStartDate:String(prior.startDate).slice(0,10),originalEndDate:day(new Date(originalEnd.getTime()-86400000)),newStartDate:s.newStartDate,newEndDate:s.newEndDate,
  periodSchedule:s.periods.map((p:any)=>`第${p.sequence}期：${required(p.startDate)}（含）至${required(p.endDate)}（不含），应收${cash(p.amount)}，付款到期日${required(p.dueDate)}；依据：${required(p.calculationBasis)}`).join('\n'),
  financialSchedule:s.periods.map((p:any)=>`第${p.sequence}期：原净实收${cash(p.netPaidAmount)}，本期沿用${cash(p.carryAmount)}，需主动补付${cash(p.chargeAmount)}，需原路退回${cash(p.refundAmount)}`).join('\n'),
  depositText:`原押金${cash(prior.depositAmount)}不变`,changeReason:s.reason,settlementExplanation:s.settlementExplanation,handoverArrangement:s.handoverArrangement,cancellationTerms:s.cancellationTerms};
 let template=legal.content;try{const parsed=JSON.parse(template);if(parsed&&typeof parsed.body==='string')template=parsed.body;}catch{}
 const legacyFacts=['vehicleIdentification','months','originalStartDate','originalEndDate','newStartDate','newEndDate','depositText','changeReason','settlementExplanation','handoverArrangement','cancellationTerms'];
 const contains=(key:string)=>template.includes(`{{${key}}}`);
 ensure(contains('periodSchedule')&&contains('financialSchedule')&&(contains('changeFacts')||legacyFacts.every(contains)),409,'LEGAL_PLACEHOLDERS','线下延期模板须完整包含变更事实、逐期金额与收退款安排');
 const body=template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g,(_:string,key:string)=>{ensure(Object.hasOwn(values,key),409,'LEGAL_PLACEHOLDERS',`线下补充协议没有可核验字段：${key}`);return required(values[key]);});
 ensure(body.trim()&&!/\{\{|\}\}|待补齐|待填写/.test(body),409,'LEGAL_PLACEHOLDERS','线下补充协议仍有未填字段');
 const document={id:legal.id,type:legal.type,version:legal.version,templateHash,bodyHash:hash(body),content:body};
 await tx.delayQuote.update({where:{id:q.id},data:{status:'PUBLISHED',commercialHash,snapshot:{...s,offlineSource,originalArchiveHash:offlineSource.originalArchiveHash,document}}});
 await tx.contract.create({data:{id:contractId,orderId:order.id,customerId:change.customerId,kind:'AMENDMENT',executionMode:'OFFLINE',status:'DRAFT',delayQuoteId:q.id,documentId:legal.id,templateVersion:legal.version,body,documentHash:commercialHash}});
 await tx.orderChange.update({where:{id:change.id},data:{status:'AWAITING_CONFIRMATION'}});
}
