import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {electronicRenewalBusiness} from '../order-renewals/electronic-agreement';
import type {ArchiveParty} from '../offline-documents/parties';

/** Private05 renderer. No identity number or full text is persisted in generic source JSON. */
export async function renewalRenderValues(tx:any,frozen:any,parties:ArchiveParty[],number:string,format:{enterprise:(role:string)=>string;product:(p:any)=>string;vehicle:(v:any)=>string;money:(v:any)=>string}){
 const {change,order,q,s}=await electronicRenewalBusiness(tx,frozen.context.resourceId);
 ensure(q.commercialHash===frozen.context.businessHash,409,'V31_SOURCES_CHANGED','续期方案已变化');
 const customer=parties.find(p=>p.role==='CUSTOMER'),original=await tx.archiveVersion.findUnique({where:{id:change.originalArchiveVersionId}}),stage=await tx.orderServiceStage.findUnique({where:{id:s.source.currentStageId}});
 ensure(customer?.identityNumber&&customer.phone&&original?.contractNumber&&original.fileManifestHash===s.source.originalArchiveHash&&stage?.snapshotHash===s.source.currentStageHash&&canonicalHash(stage.snapshot)===stage.snapshotHash,409,'V31_SOURCE_REQUIRED','续期原合同、服务段或客户实名来源缺失');
 const v=frozen.snapshot.vehicles.find((v:any)=>v.id===s.source.vehicleId),anchor=s.renewalTerms.serviceAnchor,address=change.priorTerms.commercialTerms?.customerAddress;
 ensure(v&&anchor?.ruleVersion==='V31'&&typeof address==='string'&&address.trim(),409,'V31_SOURCE_REQUIRED','续期车辆、原起租日号或联系地址缺失');
 const values:Record<string,string>={
  'document.referencesAndParties':`本续期协议${number}，业务${change.id}，订单${order.id}，原合同${original.contractNumber} / 档案${original.id} / ${original.fileManifestHash}；有效补充文件条款${change.priorTermsVersionId??'INITIAL'} / ${change.priorTermsHash}；甲方：${customer.name}，证件号码${customer.identityNumber}，已核验手机号${customer.phone}，联系地址${address}；乙方：${format.enterprise('OWNER')}；丙方：${format.enterprise('PLATFORM')}`,
  'renewal.originalTerms':`同一实际在用车辆：${format.vehicle(v)}；实际分配${s.originalAssignmentId}。首次实际起租${anchor.firstStartDay}，原日号${anchor.anchorDay}；原阶段${stage.snapshot.period.startDate}至${stage.snapshot.period.endDate}（止日不含）；当前月费${format.money(change.priorTerms.monthlyFeeAmount)}，原押金${format.money(s.depositAmount)}保持不变。`,
  'renewal.newTerms':`${format.product(s.product)}；续期${s.startDate}至${s.endDate}（止日不含），共${s.months}个月，沿用原日号${anchor.anchorDay}。各期：${s.periods.map((p:any)=>`第${p.stageSequence}期${p.startDate}至${p.endDate}（止日不含），金额${format.money(p.amount)}，到期${p.dueDate}`).join('；')}。已确认付款安排：${s.input.settlementExplanation}。原押金继续沿用且不重复收取。新阶段服务和赠送换车${s.swapPolicy.includedCount}次仅在真实阶段起日激活，原未用赠送不结转；另购里程和换车次数保持购买时有效期，不延长、重置或恢复。`,
  'product.minimumTermMonths':String(s.product.minimumTermMonths),
 };
 const exceptions=frozen.snapshot.cooperation.terms.exceptions;
 if(exceptions?.length)values['renewal.exceptions']=exceptions.map((e:any)=>e.description).join('；');
 return values;
}
