import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {resolveV31SourceIds,freezeV31Sources} from '../contract-terms/sources';
import {approvedElectronicBody} from '../electronic-documents/print';
import type {ElectronicPreparationContext} from '../electronic-documents/prepare';
import {assertCurrentCase04,readCase04} from './cancellation04';
import {lockCancellation04,cancellation04Money,cancellation04Execution} from './cancellation04-source';

export async function cancellation04DocumentSources(tx:any,context:any){
 const s=await readCase04(tx,context.resourceId),c=s.record,p=c.proposal;
 ensure(c.proposalHash===context.businessHash&&s.facts.some((f:any)=>f.kind==='CONFIRMED'),409,'CANCELLATION_CONFIRMATION_REQUIRED');
 // Confirmation is a stable revision; later signature/archive facts do not rewrite the document.
 ensure(s.facts.find((f:any)=>f.kind==='CONFIRMED')?.revision===context.revision,409,'REVISION_CONFLICT');
 const source=await assertCurrentCase04(tx,s,true);
 const template=await tx.legalDocument.findUnique({where:{id:p.template.id}});approvedElectronicBody(template,'PRE_DELIVERY_CANCELLATION');
 ensure(template.version===p.template.version&&hash(template.content)===p.template.hash,409,'V31_TEMPLATE_CHANGED');
 const current=await resolveV31SourceIds(tx,{ownerId:c.ownerId,customerId:c.customerId,platformSubjectId:source.pin.platformSubjectId,cooperationVersionId:source.order.finalPlanSnapshot.lessorSnapshot.agreementVersionId});
 const missing=current.missing.filter(m=>m.field.startsWith('CUSTOMER.identity')||m.field.startsWith('CUSTOMER.esign')||m.field.startsWith('PLATFORM.')||m.field.startsWith('parties.')||m.field.startsWith('OWNER.')&&!m.field.startsWith('OWNER.collectionAccount'));
 ensure(!missing.length,409,'V31_SOURCE_REQUIRED',JSON.stringify(missing));
 const vehicle=await tx.vehicle.findUniqueOrThrow({where:{id:source.order.vehicleId}});
 const currentMoney=await cancellation04Money(tx,c.orderId),execution=cancellation04Execution(c,currentMoney),existingTask=await tx.electronicSigningTask.findUnique({where:{contractId:c.contractId},include:{archiveVersion:true}}),financialObservation=existingTask?.archiveVersion.scopeSnapshot?.v31Sources?.snapshot?.financialObservation??execution;
 const snapshot={financialObservation,schema:'NINDA_V31_SOURCES',parties:(current.snapshot as any).parties,cancellation:{id:c.id,proposalHash:c.proposalHash,sourceHash:c.sourceHash,confirmationId:s.facts.find((f:any)=>f.kind==='CONFIRMED').id},vehicle:{id:vehicle.id,vin:vehicle.vin,plateNumber:vehicle.plateNumber},template:p.template};
 return{context,...freezeV31Sources(snapshot)};
}
export async function cancellation04Preparation(tx:any,id:string):Promise<ElectronicPreparationContext>{
 const first=await readCase04(tx,id);await lockCancellation04(tx,first.record.orderId);const s=await readCase04(tx,id),c=s.record;
 const source=await assertCurrentCase04(tx,s,true),confirmation=s.facts.find((f:any)=>f.kind==='CONFIRMED');
 ensure(confirmation,409,'CANCELLATION_CONFIRMATION_REQUIRED');
 const previous=await tx.electronicSigningTask.findUnique({where:{contractId:c.contractId}});ensure(!previous||!previous.withdrawnAt&&!previous.retiredAt&&!['DECLINED','EXPIRED'].includes(previous.status),409,'CANCELLATION_NEW_VERSION_REQUIRED','已停止的04须核清旧流后形成新方案版本');
 const parties=[];for(const role of ['CUSTOMER','OWNER','PLATFORM']){const original=source.order.finalPlanSnapshot.partiesSnapshot.find((p:any)=>p.role===role);ensure(original,409,'ELECTRONIC_PARTIES_MISMATCH');const row=role==='CUSTOMER'?await tx.customer.findUniqueOrThrow({where:{id:original.partyId}}):await tx.vehicleOwner.findUniqueOrThrow({where:{id:original.partyId}});parties.push({role,partyId:row.id,name:row.name,subjectType:original.subjectType,...(row.creditCode?{creditCode:row.creditCode}:{})});}
 return{kind:'PRE_DELIVERY_CANCELLATION',archiveKind:'PRE_DELIVERY_CANCELLATION',subjectType:'PRE_DELIVERY_CANCELLATION',subjectId:c.id,orderId:c.orderId,customerId:c.customerId,ownerId:c.ownerId,revision:c.revision,contract:await tx.contract.findUniqueOrThrow({where:{id:c.contractId},include:{electronicTask:{include:{parties:true}}}}),businessHash:c.proposalHash,parties,context:{kind:'PRE_DELIVERY_CANCELLATION',orderId:c.orderId,cooperationVersionId:source.order.finalPlanSnapshot.lessorSnapshot.agreementVersionId,platformSubjectId:source.pin.platformSubjectId,vehicleIds:[source.order.vehicleId]},scope:{cancellationId:c.id,confirmedRevision:confirmation.revision,sourceHash:c.sourceHash,originalTaskId:c.originalTaskId,originalArchiveVersionId:c.originalArchiveVersionId},sections:[],variables:{},templateId:c.proposal.template.id,templateHash:c.proposal.template.hash};
}
export async function cancellation04Render(tx:any,frozen:any,parties:any[],number:string){
 const s=await readCase04(tx,frozen.context.resourceId),c=s.record,p=c.proposal,source=await assertCurrentCase04(tx,s,false),v=frozen.snapshot.vehicle,observation=frozen.snapshot.financialObservation;
 ensure(c.proposalHash===frozen.context.businessHash,409,'CANCELLATION_SOURCE_CHANGED');
 const customer=parties.find(p=>p.role==='CUSTOMER');ensure(customer?.identityNumber&&customer.phone,409,'V31_SOURCE_REQUIRED');
 const enterprise=(role:string)=>{const p=frozen.snapshot.parties[role].content;return`${p.name}，统一社会信用代码${p.creditCode}，住所${p.address}，签署人${p.signer.name}，权限${p.contractProfile.signerAuthorityRole}，联系人${p.contractProfile.serviceContactName}，联系渠道${p.contractProfile.serviceContactChannel}`;};
 const money=(n:number)=>(n/100).toFixed(2)+'元';
 const a=p.earlierAgreement,earlier=a?`此前三方真实合意：${a.terms}；客户${a.customer.intention}，发生${a.customer.occurredAt}，依据${a.customer.fileIds.join('、')}；出租方${a.owner.personName}（${a.owner.authorityScope}）${a.owner.intention}，发生${a.owner.occurredAt}，依据${a.owner.fileIds.join('、')}；宁达${a.platform.personName}（${a.platform.authorityScope}）${a.platform.intention}，发生${a.platform.occurredAt}，依据${a.platform.fileIds.join('、')}；无争议金额实际确认${a.amountConfirmedAt}；核验时间${s.facts.find((f:any)=>f.kind==='VERIFIED')?.recordedAt.toISOString()}，不代替本次实际电子签时间。`:'无此前三方解除合意，按本协议真实三方有效签署生效。';
 return{values:{'document.referencesAndParties':`本协议${number}，业务${c.id}，订单${c.orderId}，原合同${source.version.contractNumber} / ${c.originalContractId}，原电子签${c.originalTaskId}；甲方${customer.name}，证件号码${customer.identityNumber}，已核验手机号${customer.phone}，联系地址${source.order.finalPlanSnapshot.commercialTerms.customerAddress}；乙方${enterprise('OWNER')}；丙方${enterprise('PLATFORM')}。无已生效补充文件。`,
 'cancellation.facts':`原车${v.plateNumber} / VIN ${v.vin}；取消原因${p.reason}；确认责任${p.responsibility}。原车从未实际交付，原始核验凭据${p.neverDeliveredEvidenceFileIds.join('、')}；事实复核${s.facts.find((f:any)=>f.kind==='VERIFIED')?.id}。未交付期间不计算订阅租金。${earlier}`,
 'cancellation.financialTerms':`截至${observation.observedAt}的真实资金观察（后续执行另行关联，不覆盖本文）：真实成功收款${money(observation.receivedAmount)}，已成功退款${money(observation.refundedAmount)}；本次原已确认退款义务${money(observation.agreedRefundAmount)}，已履行${money(observation.performedAmount)}，剩余应退${money(observation.remainingRefundAmount)}；原付款逐笔：${observation.payments.map((r:any)=>`${r.billType}，账单${r.billId}，原付款${r.paymentId}，渠道凭据${r.transactionId}，实收${money(r.amount)}，已退${money(r.refundedAmount)}`).join('；')||'无'}。已具体确认费用：${p.costs.map((r:any)=>`${r.description}，责任人客户，债权人${r.creditorOwnerId}，已约定依据${r.agreement}，责任依据${r.responsibility}，真实履行${r.performedAt}，原始证据${r.evidenceFileIds.join('、')}，最终协商金额${money(r.amount)}，客户同意从原付款${r.paymentId}扣抵同一债务，不再重复追收`).join('；')||'无，零元'}。原确认无争议退款义务${money(p.netRefundAmount)}，无已确认应补款；退款责任及原路退款按正文第四条执行，不预记未来发起或到账。无自动准备费，无未来车损或违章预留。`}};
}
