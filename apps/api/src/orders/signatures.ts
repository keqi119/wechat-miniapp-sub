import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { Db } from '../common/db';
import { ESignGateway } from '../common/gateways';
import { ensure } from '../common/errors';
import { claimSigning, failSigning, finishSigning, recoverSigning } from './signature-preparation';
import { SignatureService } from './signature.service';
@Controller()
export class SignaturesController {
  constructor(@Inject(Db) private db: Db, @Inject(ESignGateway) private esign: ESignGateway, @Inject(SignatureService) private signatures: SignatureService) {}
  @Post('customer/contracts/:id/sign') sign(@Param('id') id: string, @Req() request: any) { return this.send(id, request.customer.id); }
  @Post('admin/contracts/:id/send') adminSign(@Param('id') id: string) { return this.send(id); }
  async send(id: string, customerId?: string, returnUrl?:string) {
    const claim = await this.db.serial(async tx => {
      const contract = await tx.contract.findFirst({ where: { id, ...(customerId ? { customerId } : {}) }, include: { order: { include: { customer: true } } } });
      ensure(contract, 404, 'NOT_FOUND', '合同不存在'); ensure(contract.kind==='SUBSCRIPTION',409,'CONTRACT_KIND','补充协议须从订单变更入口签署'); ensure(contract.status !== 'SIGNED' && ['AWAITING_SIGNATURE','AWAITING_PAYMENT'].includes(contract.order.status), 409, 'STATE_CONFLICT', '当前订单不可发起签署');
      return claimSigning(tx, 'SUBSCRIPTION', contract);
    });
    const item = claim.item;
    try {
      if (claim.task?.uploadedAt && ['SIGNED','REJECTED','EXPIRED'].includes(claim.task.status)) { const state = await this.sync(id); return { taskId: claim.task.id, ...state }; }
      const result = await this.esign.create({ contractId: id, customerId: item.customerId, documentHash: item.documentHash, kind: 'SUBSCRIPTION', returnUrl, customerName: item.order.customer.name, mobile: item.order.customer.mobile });
      await finishSigning(this.db, 'SUBSCRIPTION', item, claim.leaseUntil, result.taskId); return result;
    } catch (error) {
      await failSigning(this.db, 'SUBSCRIPTION', item, claim.leaseUntil); throw error;
    }
  }

  @Get('customer/contracts/:id/sign-status') async status(@Param('id') id: string, @Req() request: any) { const item = await this.db.contract.findFirst({ where: { id, customerId: request.customer.id } }); ensure(item, 404, 'NOT_FOUND', '合同不存在'); return this.sync(id); }
  @Post('admin/contracts/:id/sync') async sync(@Param('id') id: string) {
    const contract=await this.db.contract.findUnique({where:{id}});ensure(contract?.kind==='SUBSCRIPTION',409,'CONTRACT_KIND','补充协议须从订单变更入口查询');
    const recovered = await recoverSigning(this.db, 'SUBSCRIPTION', id); const item = recovered.item; if (!item.providerTaskId || recovered.pendingPreparation) return recovered.state;
    const result = await this.esign.query(item.providerTaskId); ensure(result.documentHash === item.documentHash, 409, 'DOCUMENT_MISMATCH', '签署文档与合同不匹配');
    return this.signatures.settleContract(id, { ...result, taskId: item.providerTaskId });
  }
}
