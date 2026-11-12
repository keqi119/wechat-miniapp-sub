import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {assertElectronicTaskSnapshot} from '../electronic-documents/repository';
import {hasActualSigningEvidence} from '../electronic-documents/signing-evidence';
import {loadElectronicArchiveProof} from '../electronic-documents/archive';
import {readElectronicSubscriptionOrigin} from '../electronic-documents/subscription';
import {assertNotAssetFiles} from '../files/asset-files';

export async function lockCancellation04(tx:any,orderId:string){
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "UsageAccount" WHERE "orderId"=${orderId} ORDER BY id FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "OrderPreDeliveryCancellation" WHERE "orderId"=${orderId} ORDER BY id FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "Bill" WHERE "orderId"=${orderId} ORDER BY id FOR UPDATE`;
 await tx.$queryRaw`SELECT p.id FROM "Payment" p JOIN "Bill" b ON b.id=p."billId" WHERE b."orderId"=${orderId} ORDER BY p.id FOR UPDATE OF p`;
}
export async function assertNeverDelivered04(tx:any,order:any){
 const renewal=await tx.orderChange.findFirst({where:{orderId:order.id,kind:'SUBSCRIPTION_EXTENSION'}});
 ensure(!renewal,409,'CANCELLATION_FUTURE_RENEWAL','新增续期取消须走05自身的真实合意路径');
 const actual=await tx.handover.findFirst({where:{orderId:order.id,type:'DELIVERY',OR:[{status:{in:['CUSTOMER_CONFIRMED','COMPLETED']}},{completedAt:{not:null}}]}});
 const stage=await tx.orderServiceStage.findFirst({where:{orderId:order.id}});
 ensure(!actual&&!order.serviceAnchor&&!order.effectiveTermsVersionId&&!stage,409,'CANCELLATION_ALREADY_DELIVERED','04仅适用于原车从未实际交付，已交付及未来续期须按相应路径办理');
 const unclear=await tx.handover.count({where:{orderId:order.id,OR:[{signatureStatus:'PENDING'},{actualAt:{not:null},status:{notIn:['CUSTOMER_CONFIRMED','COMPLETED']}}]}});
 ensure(!unclear,409,'CANCELLATION_DELIVERY_REVIEW_REQUIRED','存在未核清实际交付记录，请核对原始交接事实');
}
export async function cancellation04Source(tx:any,orderId:string){
 const order=await tx.order.findUnique({where:{id:orderId}});ensure(order?.contractMode==='ELECTRONIC',404,'NOT_FOUND');
 await assertNeverDelivered04(tx,order);
 const b=order.finalPlanSnapshot,contract=await tx.contract.findFirst({where:{orderId,kind:'SUBSCRIPTION'},orderBy:{createdAt:'desc'},include:{electronicTask:{include:{parties:true,archiveVersion:{include:{archive:true}}}}}}),task=contract?.electronicTask,v=task?.archiveVersion;
 ensure(task&&v&&task.kind==='SUBSCRIPTION'&&task.orderId===orderId&&task.customerId===order.customerId&&task.ownerId===b?.lessorSnapshot?.ownerId&&contract.customerId===order.customerId&&contract.documentHash===b.commercialHash&&task.businessHash===b.commercialHash&&v.businessSnapshotHash===b.commercialHash&&v.archive.orderId===orderId&&v.archive.ownerId===task.ownerId&&v.scopeSnapshot?.vehicleId===order.vehicleId&&v.scopeSnapshot?.lessorHash===canonicalHash(b.lessorSnapshot),409,'CANCELLATION_ORIGINAL_REQUIRED','须绑定原01真实签署与业务来源');
 assertElectronicTaskSnapshot(task);
 ensure(!task.withdrawnAt&&!task.retiredAt&&!v.invalidatedAt&&task.parties.length===3&&task.parties.every((p:any)=>hasActualSigningEvidence(p)&&p.verifiedAt&&b.partiesSnapshot?.some((r:any)=>r.role===p.role&&r.partyId===p.subjectId&&r.subjectType===p.subjectType)),409,'CANCELLATION_ORIGINAL_REVIEW_REQUIRED','原签署结果或主体尚未核清，请核验原渠道记录');
 const latest=await tx.archiveVersion.findFirst({where:{archiveId:v.archiveId},orderBy:{version:'desc'},select:{id:true}});ensure(latest?.id===v.id,409,'CANCELLATION_ORIGINAL_REVIEW_REQUIRED');
 if(task.status==='ARCHIVED'){await loadElectronicArchiveProof(tx,v.id);const origin=await readElectronicSubscriptionOrigin(tx,orderId);ensure(origin.ready&&origin.taskId===task.id,409,'CANCELLATION_ORIGINAL_REVIEW_REQUIRED');}
 const pin={orderId,customerId:order.customerId,ownerId:task.ownerId,platformSubjectId:task.platformSubjectId,vehicleId:order.vehicleId,originalContractId:contract.id,originalTaskId:task.id,originalArchiveVersionId:v.id,originalBusinessHash:task.businessHash,sourceSha256:task.sourceSha256,partiesHash:canonicalHash(b.partiesSnapshot)};
 return{order,contract,task,version:v,pin,sourceHash:canonicalHash(pin)};
}
export async function cancellation04Money(tx:any,orderId:string){
 const bills=await tx.bill.findMany({where:{orderId},orderBy:{id:'asc'},include:{payments:{orderBy:{id:'asc'},include:{refunds:{orderBy:{id:'asc'}}}}}});
 const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});
 ensure(bills.every((b:any)=>b.customerId===order.customerId&&b.payments.every((p:any)=>p.customerId===order.customerId)),409,'CANCELLATION_MONEY_REVIEW_REQUIRED');
 const payments=bills.flatMap((b:any)=>b.payments.filter((p:any)=>p.status==='SUCCEEDED').map((p:any)=>({paymentId:p.id,billId:b.id,billType:b.type,amount:p.amount,transactionId:p.providerTransactionId,succeededAt:p.succeededAt?.toISOString()??null,refundedAmount:p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((n:number,r:any)=>n+r.amount,0),refunds:p.refunds.map((r:any)=>({id:r.id,amount:r.amount,status:r.status,providerRefundId:r.providerRefundId,succeededAt:r.succeededAt?.toISOString()??null,cancellationId:r.preDeliveryCancellationId,sourceHash:r.preDeliveryCancellationSourceHash}))})));
 ensure(payments.every((p:any)=>p.transactionId&&Number.isSafeInteger(p.amount)&&p.amount>0&&p.refundedAmount<=p.amount),409,'CANCELLATION_MONEY_REVIEW_REQUIRED','真实支付渠道凭据不完整');
 const pending=bills.some((b:any)=>b.payments.some((p:any)=>['CREATING','PENDING'].includes(p.status)||p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING'].includes(r.status))));
 ensure(bills.every((b:any)=>b.paidAmount===0||b.payments.filter((p:any)=>p.status==='SUCCEEDED').reduce((n:number,p:any)=>n+p.amount,0)>=b.paidAmount),409,'CANCELLATION_MONEY_REVIEW_REQUIRED','账单实收缺少真实原付款凭据');
 return{payments,pending,pendingPayments:bills.some((b:any)=>b.payments.some((p:any)=>['CREATING','PENDING'].includes(p.status))),hash:canonicalHash(payments),receivedAmount:payments.reduce((n:number,p:any)=>n+p.amount,0),refundedAmount:payments.reduce((n:number,p:any)=>n+p.refundedAmount,0)};
}
/** Existing legal effect: preserve the original immutable signing lineage, not today's order projection. */
export async function historicalCancellation04Source(tx:any,record:any){
 const pin=record.sourceSnapshot;
 ensure(pin.orderId===record.orderId&&pin.customerId===record.customerId&&pin.ownerId===record.ownerId&&pin.originalTaskId===record.originalTaskId&&pin.originalContractId===record.originalContractId&&pin.originalArchiveVersionId===record.originalArchiveVersionId,409,'CANCELLATION_SOURCE_CHANGED');
 const task=await tx.electronicSigningTask.findUnique({where:{id:record.originalTaskId},include:{parties:true,archiveVersion:{include:{archive:true}}}}),version=task?.archiveVersion;
 ensure(task&&version&&task.kind==='SUBSCRIPTION'&&task.contractId===record.originalContractId&&task.archiveVersionId===record.originalArchiveVersionId&&task.orderId===record.orderId&&task.customerId===record.customerId&&task.ownerId===record.ownerId&&task.platformSubjectId===pin.platformSubjectId&&task.businessHash===pin.originalBusinessHash&&task.sourceSha256===pin.sourceSha256,409,'CANCELLATION_SOURCE_CHANGED');
 assertElectronicTaskSnapshot(task);
 ensure(version.executionMode==='ELECTRONIC'&&version.businessSnapshotHash===task.businessHash&&version.sourceFileId===task.sourceFileId&&version.archive.orderId===record.orderId&&version.archive.ownerId===record.ownerId&&version.scopeSnapshot?.vehicleId===pin.vehicleId&&task.parties.length===3&&task.parties.every((p:any)=>hasActualSigningEvidence(p)&&p.verifiedAt),409,'CANCELLATION_SOURCE_CHANGED');
 const source=await tx.storedFile.findUnique({where:{id:task.sourceFileId}});ensure(source&&source.sha256===pin.sourceSha256&&source.customerId===record.customerId,409,'CANCELLATION_SOURCE_CHANGED');
 return{pin,parties:task.parties};
}
export async function evidence04(tx:any,ids:string[],actorId:string,customerId:string){
 await assertNotAssetFiles(tx,ids);const rows=await tx.storedFile.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}});
 ensure(rows.length===ids.length&&rows.every((f:any)=>f.purpose==='evidence'&&!f.fieldTaskId&&(f.adminId===actorId&&!f.customerId||f.customerId===customerId&&!f.adminId)&&['application/pdf','image/png','image/jpeg'].includes(f.mimeType)&&f.size>0&&/^[a-f0-9]{64}$/.test(f.sha256)),409,'CANCELLATION_EVIDENCE_REQUIRED','须使用本单客户或经办人原始凭据');
 return rows.map((f:any)=>({id:f.id,sha256:f.sha256,adminId:f.adminId,customerId:f.customerId}));
}
export async function verifyEvidence04(tx:any,refs:any[]){
 for(const f of refs){const row=await tx.storedFile.findUnique({where:{id:f.id}});ensure(row&&row.sha256===f.sha256&&row.adminId===f.adminId&&row.customerId===f.customerId&&row.purpose==='evidence',409,'CANCELLATION_EVIDENCE_CHANGED');}
}
/** Compare fixed obligations; original-route execution progress is not a new agreement. */
export function cancellation04Execution(record:any,current:any){
 const p=record.proposal,original=p.money.payments;
 ensure(!current.pendingPayments&&current.payments.length===original.length,409,'CANCELLATION_MONEY_CHANGED','新款或未明支付须核对，不能套用原04金额');
 for(const receipt of current.payments){
  const before=original.find((r:any)=>r.paymentId===receipt.paymentId);
  ensure(before&&before.billId===receipt.billId&&before.amount===receipt.amount&&before.transactionId===receipt.transactionId,409,'CANCELLATION_MONEY_CHANGED');
  for(const refund of receipt.refunds){const known=before.refunds.find((r:any)=>r.id===refund.id);ensure(known?known.amount===refund.amount&&(known.status!=='SUCCEEDED'||refund.status==='SUCCEEDED'):refund.cancellationId===record.id&&refund.sourceHash===record.proposalHash,409,'CANCELLATION_MONEY_CHANGED','新退款尚未绑定同一已确认解除义务');}
  ensure(before.refunds.every((r:any)=>receipt.refunds.some((a:any)=>a.id===r.id)),409,'CANCELLATION_MONEY_CHANGED');
  const deductions=p.costs.filter((c:any)=>c.paymentId===receipt.paymentId).reduce((n:number,c:any)=>n+c.amount,0),reserved=receipt.refunds.filter((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)).reduce((n:number,r:any)=>n+r.amount,0);
  ensure(reserved<=receipt.amount-deductions,409,'CANCELLATION_MONEY_CHANGED');
 }
 const performedAmount=current.refundedAmount-p.money.refundedAmount;ensure(performedAmount>=0&&performedAmount<=p.netRefundAmount,409,'CANCELLATION_MONEY_CHANGED');
 return{observedAt:new Date().toISOString(),sourceHash:current.hash,payments:current.payments,receivedAmount:current.receivedAmount,refundedAmount:current.refundedAmount,agreedRefundAmount:p.netRefundAmount,performedAmount,remainingRefundAmount:p.netRefundAmount-performedAmount};
}
