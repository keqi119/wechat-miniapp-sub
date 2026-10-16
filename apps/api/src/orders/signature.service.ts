import {lockOrder} from '../order-changes/context';
import { Inject, Injectable } from '@nestjs/common';
import { advanceToHandover } from './readiness';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit } from '../common/data';
export type VerifiedSignature = { status: 'PENDING'|'SIGNED'|'REJECTED'|'EXPIRED'; documentHash: string; signedFileId?: string; taskId?: string };
@Injectable()
export class SignatureService {
  constructor(@Inject(Db) private db: Db) {}
  async settleContract(contractId: string, event: VerifiedSignature) {
    return this.db.serial(async tx => {
      const item = await tx.contract.findUnique({ where: { id: contractId } }); ensure(item, 404, 'NOT_FOUND', '合同不存在');
      if(item.kind==='AMENDMENT'){await lockOrder(tx,item.orderId);const quote=await tx.delayQuote.findUnique({where:{id:item.delayQuoteId!},include:{change:true}});ensure(quote&&(item.status==='SIGNED'||quote.change.activeQuoteId===quote.id&&['AWAITING_SIGNATURE','AWAITING_FINANCE','SWAP_RETURNED','APPLIED'].includes(quote.change.status)),409,'AMENDMENT_STATE','补充协议不是当前有效变更');}
      ensure(item.documentHash === event.documentHash && (!event.taskId || item.providerTaskId === event.taskId), 409, 'DOCUMENT_MISMATCH', '签署任务或文档不匹配');
      if (item.status === 'SIGNED') return { status: item.status, documentHash: item.documentHash, signedFileId: item.signedFileId };
      ensure(item.providerTaskId && item.status === 'PENDING', 409, 'SIGNATURE_STATE', '合同签署任务未发起或已终止');
      if (event.status === 'SIGNED') { ensure(event.signedFileId && await tx.storedFile.count({ where: { id: event.signedFileId, OR: [{ customerId: item.customerId }, { customerId: null }] } }), 409, 'SIGNATURE_ARCHIVE_REQUIRED', '签署归档文件尚未核验'); }
      await tx.contract.update({ where: { id: contractId }, data: { status: event.status, signedFileId: event.signedFileId, ...(event.status !== 'PENDING' ? { signingLeaseUntil: null } : {}) } });
      if(item.kind==='AMENDMENT'&&event.status==='SIGNED'){const q=await tx.delayQuote.findUniqueOrThrow({where:{id:item.delayQuoteId!}});await tx.orderChange.update({where:{id:q.changeId},data:{status:(await tx.orderChange.findUniqueOrThrow({where:{id:q.changeId}})).returnHandoverId&&(await tx.handover.findUnique({where:{id:(await tx.orderChange.findUniqueOrThrow({where:{id:q.changeId}})).returnHandoverId!}}))?.status==='COMPLETED'?'SWAP_RETURNED':'AWAITING_FINANCE',revision:{increment:1}}});}
      if (item.kind==='SUBSCRIPTION'&&event.status === 'SIGNED') await tx.order.updateMany({ where: { id: item.orderId, status: 'AWAITING_SIGNATURE' }, data: { status: 'AWAITING_PAYMENT' } });
      if (item.kind==='SUBSCRIPTION'&&event.status === 'SIGNED') await advanceToHandover(tx, item.orderId);
      await audit(tx, 'esign-provider', 'SIGNATURE_STATUS', 'contracts', contractId, { status: event.status }, 'PROVIDER');
      return event;
    });
  }
  async settleHandover(handoverId: string, event: VerifiedSignature) {
    return this.db.serial(async tx => {
      const item = await tx.handover.findUnique({ where: { id: handoverId } }); ensure(item, 404, 'NOT_FOUND', '交接单不存在');
      ensure(item.manifestHash === event.documentHash && (!event.taskId || item.providerTaskId === event.taskId), 409, 'DOCUMENT_MISMATCH', '签署任务或文档不匹配');
      if (item.signatureStatus === 'SIGNED') return { status: item.signatureStatus, documentHash: item.manifestHash, signedFileId: item.signedFileId };
      ensure(item.status === 'CUSTOMER_CONFIRMED' && item.providerTaskId && item.signatureStatus === 'PENDING', 409, 'SIGNATURE_STATE', '交接单未完成事实确认或签署任务已终止');
      if (event.status === 'SIGNED') ensure(event.signedFileId && await tx.storedFile.count({ where: { id: event.signedFileId, OR: [{ customerId: item.customerId }, { customerId: null }] } }), 409, 'SIGNATURE_ARCHIVE_REQUIRED', '签署归档文件尚未核验');
      await tx.handover.update({ where: { id: handoverId }, data: { signatureStatus: event.status, signedFileId: event.signedFileId, ...(event.status !== 'PENDING' ? { signingLeaseUntil: null } : {}) } });
      await audit(tx, 'esign-provider', 'SIGNATURE_STATUS', 'handovers', handoverId, { status: event.status }, 'PROVIDER'); return event;
    });
  }
}
