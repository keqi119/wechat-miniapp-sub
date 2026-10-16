import { Inject,Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { ESignGateway } from '../common/gateways';
import { ensure } from '../common/errors';
import { SignatureService } from '../orders/signature.service';
import { claimSigning,failSigning,finishSigning,recoverSigning } from '../orders/signature-preparation';
import { SignaturePolicyService } from '../esign/enterprise-seal/signature-policy.service';
import { lockOrder } from './context';
@Injectable()
export class DelaySigning {
 constructor(@Inject(Db)private db:Db,@Inject(ESignGateway)private gateway:ESignGateway,@Inject(SignatureService)private signatures:SignatureService,@Inject(SignaturePolicyService)private policies:SignaturePolicyService){}
 private async resource(id:string,revision:number,customerId?:string){const change=await this.db.orderChange.findFirst({where:{id,...(customerId?{customerId}:{})}});ensure(change,404,'NOT_FOUND','订单变更不存在');ensure(change.revision===revision,409,'VERSION_CONFLICT','变更已更新，请刷新');const contract=await this.db.contract.findUnique({where:{delayQuoteId:change.activeQuoteId!},include:{order:{include:{customer:true}}}});ensure(contract?.kind==='AMENDMENT',409,'AMENDMENT_REQUIRED','补充协议尚未确认');return{change,contract};}
 async prepare(id:string,input:any,actorId:string){const {change,contract}=await this.resource(id,input.revision);ensure(change.status==='AWAITING_SIGNATURE',409,'CHANGE_STATE','当前变更不可准备签署');return this.policies.prepare('AMENDMENT',contract.id,input.policyId,actorId);}
 async sign(id:string,input:any,customerId:string){const {change,contract}=await this.resource(id,input.revision,customerId);ensure(change.status==='AWAITING_SIGNATURE'&&['DRAFT','PENDING'].includes(contract.status),409,'CHANGE_STATE','当前变更不可签署');
 const claim=await this.db.serial(async tx=>{await lockOrder(tx,change.orderId);const current=await tx.orderChange.findUniqueOrThrow({where:{id}});ensure(current.revision===input.revision&&current.status==='AWAITING_SIGNATURE',409,'VERSION_CONFLICT','变更状态已更新');return claimSigning(tx,'AMENDMENT',await tx.contract.findUniqueOrThrow({where:{id:contract.id}}));});
 try{if(claim.task?.uploadedAt&&['SIGNED','REJECTED','EXPIRED'].includes(claim.task.status)){const event=await this.gateway.query(claim.task.id);await this.signatures.settleContract(contract.id,{...event,taskId:claim.task.id});return{taskId:claim.task.id,...event};}const result=await this.gateway.create({kind:'AMENDMENT',contractId:contract.id,customerId,documentHash:contract.documentHash,customerName:contract.order.customer.name,mobile:contract.order.customer.mobile});await finishSigning(this.db,'AMENDMENT',claim.item,claim.leaseUntil,result.taskId);return result;}catch(error){await failSigning(this.db,'AMENDMENT',claim.item,claim.leaseUntil);throw error;}}
 async sync(id:string,input:any,customerId:string){const {contract}=await this.resource(id,input.revision,customerId),r=await recoverSigning(this.db,'AMENDMENT',contract.id,customerId);if(r.item.providerTaskId&&!r.pendingPreparation){const event=await this.gateway.query(r.item.providerTaskId);await this.signatures.settleContract(contract.id,{...event,taskId:r.item.providerTaskId});}}
}
