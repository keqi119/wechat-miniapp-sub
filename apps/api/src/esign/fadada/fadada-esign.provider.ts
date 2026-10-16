import { createHash, randomUUID } from 'node:crypto';
import { Db } from '../../common/db';
import { ESignGateway } from '../../common/gateways';
import { ensure } from '../../common/errors';
import { audit, hash } from '../../common/data';
import { ContractPdfArtifactWriterService, SignatureKind } from '../../contract/contract-pdf-artifact-writer.service';
import { SignaturePolicyService } from '../enterprise-seal/signature-policy.service';
import { FadadaSettings } from '../esign.settings';
import { FadadaApiClient } from './fadada-api.client';
import { accountReadiness, assertSignerResult, decryptIdentity, verifiedCallback } from './fadada-safety';
export class FadadaESignGateway extends ESignGateway {
  constructor(private db:Db,private config:FadadaSettings,private api:FadadaApiClient,private writer:ContractPdfArtifactWriterService,private policies:SignaturePolicyService){super();}
  private enabled(){ensure(this.config.enabled&&this.config.signingEnabled,503,'FADADA_SIGNING_DISABLED','法大大真实签署尚未启用');}
  private positions(approval:any,role:'CUSTOMER'|'PLATFORM'){
    const expected=approval.kind!=='HANDOVER'?[`STAGE1_BODY_${role}`,`STAGE1_ATTACHMENT1_${role}`]:[`STAGE2_HANDOVER_${role}`];
    const all=approval.slotCoordinates as any[];
    ensure(Array.isArray(all),409,'SIGNATURE_COORDINATES','签署坐标尚未生成');
    return expected.map(slotId=>{const rows=all.filter(row=>row.slotId===slotId);ensure(rows.length===1,409,'SIGNATURE_COORDINATES','签署坐标缺失或重复');const row=rows[0];ensure(Number.isInteger(row.pageNumber)&&row.pageNumber>=0&&Number.isFinite(row.x)&&row.x>=0&&row.x<=800&&Number.isFinite(row.y)&&row.y>=0&&row.y<=1131,409,'SIGNATURE_COORDINATES','签署坐标无效');return{pagenum:row.pageNumber,x:row.x,y:row.y};});
  }
  async create(input:Parameters<ESignGateway['create']>[0]){
    this.enabled();
    ensure(this.config.signNotifyUrl?.startsWith('https://mini-api.subauto.keybox.cloud/')&&this.config.signReturnUrl?.startsWith('https://mini-api.subauto.keybox.cloud/'),503,'FADADA_CALLBACK_CONFIG','独立平台签署回调与返回地址未配置');
    const existing=await this.db.fadadaTask.findUnique({where:{kind_resourceId_documentHash:{kind:input.kind,resourceId:input.contractId,documentHash:input.documentHash}}});
    const context=await this.policies.approved(input.kind,input.contractId,input.documentHash,existing?.approvalId);
    ensure(context.resource.customerId===input.customerId&&context.resource.id===input.contractId,404,'NOT_FOUND','签署记录不存在');
    const account=await this.db.eSignAccount.findUnique({where:{customerId:input.customerId}});
    ensure(accountReadiness(account).readyForSigning&&account?.providerCustomerId&&account.identityCiphertext,409,'REALNAME_REQUIRED','请先完成供应商实名核验与证书绑定');
    ensure(context.policy.executionMode==='SEQUENTIAL',409,'EXECUTION_MODE','当前流程只接受先客户签署、后企业盖章的已批准策略');
    const identity=decryptIdentity(account.identityCiphertext,input.customerId,this.config.identityEncryptionKey);
    let task=existing;
    if(!task){
      const id=randomUUID();const identifier=(kind:string)=>createHash('sha256').update('independent-esign:'+id+':'+kind).digest('hex').slice(0,32);
      try {task=await this.db.fadadaTask.create({data:{id,kind:input.kind,resourceId:input.contractId,customerId:input.customerId,documentHash:input.documentHash,sourcePdfHash:context.approval.sourcePdfHash,sourceFileId:context.approval.sourceFileId,approvalId:context.approval.id,providerEnvelopeId:identifier('envelope'),customerProviderId:account.providerCustomerId,platformProviderId:context.seal.providerCustomerId,customerTransactionId:identifier('customer'),platformTransactionId:identifier('platform')}});}
      catch(error:any){if(error.code!=='P2002')throw error;task=await this.db.fadadaTask.findUniqueOrThrow({where:{kind_resourceId_documentHash:{kind:input.kind,resourceId:input.contractId,documentHash:input.documentHash}}});}
    }
    ensure(task.customerId===input.customerId&&task.approvalId===context.approval.id&&task.sourcePdfHash===context.approval.sourcePdfHash&&task.customerProviderId===account.providerCustomerId&&task.platformProviderId===context.seal.providerCustomerId,409,'SIGNING_TASK_MISMATCH','签署任务身份或文档版本不匹配');
    ensure(!['SIGNED','REJECTED','EXPIRED'].includes(task.status),409,'SIGNATURE_STATE','当前签署任务不可重新发起');
    if(!task.uploadedAt){
      const uploadLeaseUntil=new Date(Date.now()+60000);
      const claim=await this.db.fadadaTask.updateMany({where:{id:task.id,uploadedAt:null,OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{processingUntil:uploadLeaseUntil}});
      ensure(claim.count===1,409,'SIGNATURE_PROCESSING','签署任务准备中，请稍后重试');
      try{const pdf=await this.writer.readVerified(task.sourceFileId,task.sourcePdfHash);const uploaded=await this.api.uploadDocs({contractId:task.providerEnvelopeId,docTitle:input.kind!=='HANDOVER'?'汽车订阅合同与订阅方案':'车辆交接单',fileName:task.providerEnvelopeId+'.pdf',pdf});const raw=uploaded.raw as any;ensure(['1','1000','success'].includes(String(raw?.code||raw?.result_code||'')),502,'FADADA_UPLOAD_UNCONFIRMED','供应商未确认签署PDF上传');const stored=await this.db.fadadaTask.updateMany({where:{id:task.id,uploadedAt:null,processingUntil:uploadLeaseUntil},data:{uploadedAt:new Date(),status:'PENDING',processingUntil:null}});ensure(stored.count===1,409,'SIGNATURE_LEASE_LOST','签署准备处理权已变化，请重新查询');task=await this.db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});}
      catch(error){await this.db.fadadaTask.updateMany({where:{id:task.id,processingUntil:uploadLeaseUntil},data:{processingUntil:null}});throw error;}
    }
    const entry=await this.api.createExternalSignUrl({contractId:task.providerEnvelopeId,customerId:task.customerProviderId,transactionId:task.customerTransactionId,docTitle:input.kind!=='HANDOVER'?'汽车订阅合同与订阅方案':'车辆交接单',notifyUrl:this.config.signNotifyUrl!,returnUrl:this.config.signReturnUrl!,signaturePositions:this.positions(context.approval,'CUSTOMER'),signerName:identity.name,signerMobile:input.mobile,validityMinutes:this.config.signUrlValidityMinutes});
    return {taskId:task.id,url:entry.signUrl,status:'PENDING'};
  }
  private async providerStatus(task:any,platform:boolean){
    const expected={contractId:task.providerEnvelopeId,customerId:platform?task.platformProviderId:task.customerProviderId,transactionId:platform?task.platformTransactionId:task.customerTransactionId};
    const result=await this.api.querySignResult(expected);
    const absent=result.status==='UNKNOWN'&&!result.resultCode&&result.resultDesc?.trim()==='签署记录为空'&&!result.providerContractId&&!result.providerCustomerId&&!result.providerTransactionId;
    if(!absent)assertSignerResult(result,expected);
    return {...result,absent};
  }
  async query(taskId:string):Promise<{status:'PENDING'|'SIGNED'|'REJECTED'|'EXPIRED';documentHash:string;signedFileId?:string}>{
    this.enabled();
    let task=await this.db.fadadaTask.findUnique({where:{id:taskId}});ensure(task?.uploadedAt,404,'SIGNATURE_TASK','签署任务未准备完成');
    const resource=await this.writer.resource(task.kind as SignatureKind,task.resourceId);
    ensure(resource.customerId===task.customerId&&(task.kind!=='HANDOVER'?resource.documentHash:resource.manifestHash)===task.documentHash,409,'DOCUMENT_MISMATCH','签署业务文档已变化');
    if(task.status==='SIGNED'){ensure(task.signedFileId&&task.signedPdfHash,409,'SIGNATURE_ARCHIVE_REQUIRED','已签署文档未归档');await this.writer.readVerified(task.signedFileId,task.signedPdfHash);return{status:'SIGNED',documentHash:task.documentHash,signedFileId:task.signedFileId};}
    if(task.status==='REJECTED'||task.status==='EXPIRED')return{status:task.status,documentHash:task.documentHash};
    const customer=await this.providerStatus(task,false);
    if(customer.status==='FAILED'){await this.db.fadadaTask.update({where:{id:task.id},data:{status:'REJECTED'}});return{status:'REJECTED',documentHash:task.documentHash};}
    if(customer.status!=='SIGNED')return{status:'PENDING',documentHash:task.documentHash};
    await this.db.fadadaTask.updateMany({where:{id:task.id,customerSignedAt:null},data:{customerSignedAt:new Date()}});
    const leaseUntil=new Date(Date.now()+60000);
    const claim=await this.db.fadadaTask.updateMany({where:{id:task.id,OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{processingUntil:leaseUntil}});
    if(!claim.count)return{status:'PENDING',documentHash:task.documentHash};
    try{
      task=await this.db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});
      let platform=await this.providerStatus(task,true);
      if(platform.status!=='SIGNED'&&!task.sealRequestedAt){
        ensure(platform.absent,409,'SEAL_PROVIDER_STATE','供应商企业签章状态不明确，不能重复盖章');
        const context=await this.policies.approved(task.kind as SignatureKind,task.resourceId,task.documentHash,task.approvalId);
        ensure(context.seal.providerCustomerId===task.platformProviderId,409,'SEAL_IDENTITY_MISMATCH','企业签署身份已变化');
        const requested=await this.db.fadadaTask.updateMany({where:{id:task.id,sealRequestedAt:null,processingUntil:leaseUntil},data:{sealRequestedAt:new Date()}});
        ensure(requested.count===1,409,'SEAL_PROCESSING','企业盖章处理中');
        await audit(this.db,context.approval.approverId!,'ENTERPRISE_SEAL_EXECUTION','esign-tasks',task.id,{approvalId:task.approvalId,planHash:context.approval.planHash,sourcePdfHash:task.sourcePdfHash});
        const sealed=await this.api.autoSealContract({contractId:task.providerEnvelopeId,customerId:task.platformProviderId,signatureId:context.seal.providerSignatureId,transactionId:task.platformTransactionId,docTitle:task.kind!=='HANDOVER'?'汽车订阅合同与订阅方案':'车辆交接单',notifyUrl:this.config.signNotifyUrl,signaturePositions:this.positions(context.approval,'PLATFORM')});
        ensure(['1','1000','success','3000'].includes(sealed.resultCode||''),502,'ENTERPRISE_SEAL_UNCONFIRMED','供应商尚未确认企业盖章，请查询状态');
        platform=await this.providerStatus(task,true);
      }
      if(platform.status!=='SIGNED')return{status:'PENDING',documentHash:task.documentHash};
      const current=await this.db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});ensure(current.sealRequestedAt,409,'SEAL_APPROVAL_TRACE','企业签章缺少已批准执行记录');
      const signed=await this.api.downloadSignedContract({contractId:task.providerEnvelopeId});
      const archived=await this.writer.persistPdf(signed.buffer,{customerId:task.customerId,name:task.resourceId+'-signed.pdf',purpose:task.kind==='AMENDMENT'?'amendment':'contract'});
      await this.db.serial(async tx=>{const settled=await tx.fadadaTask.updateMany({where:{id:task!.id,processingUntil:leaseUntil,status:{not:'SIGNED'}},data:{status:'SIGNED',platformSignedAt:new Date(),signedFileId:archived.id,signedPdfHash:archived.sha256,processingUntil:null}});ensure(settled.count===1,409,'SIGNATURE_LEASE_LOST','签署归档处理权已变化，请重新查询');await audit(tx,'fadada','SIGNED_PDF_ARCHIVED','esign-tasks',task!.id,{sourcePdfHash:task!.sourcePdfHash,signedPdfHash:archived.sha256,fileId:archived.id},'PROVIDER');});
      return{status:'SIGNED',documentHash:task.documentHash,signedFileId:archived.id};
    }finally{await this.db.fadadaTask.updateMany({where:{id:task.id,processingUntil:leaseUntil},data:{processingUntil:null}});}
  }
  async callback(payload:unknown,settle:(task:any,event:Awaited<ReturnType<FadadaESignGateway['query']>>)=>Promise<unknown>){
    this.enabled();const verified=verifiedCallback(payload,this.config);const eventId=hash(Object.fromEntries(Object.entries(verified.record).sort(([a],[b])=>a.localeCompare(b))));
    const previous=await this.db.providerEvent.findUnique({where:{provider_eventId:{provider:'FADADA_SIGN',eventId}}});if(previous?.status==='PROCESSED')return{accepted:true,replayed:true};
    const task=await this.db.fadadaTask.findFirst({where:{OR:[{customerTransactionId:verified.transactionId},{platformTransactionId:verified.transactionId}]}});ensure(task&&verified.providerContractId===task.providerEnvelopeId,404,'CALLBACK_TASK_MISMATCH','签署回调任务身份不匹配');
    await this.db.providerEvent.upsert({where:{provider_eventId:{provider:'FADADA_SIGN',eventId}},create:{provider:'FADADA_SIGN',eventId,resourceId:task.resourceId,payloadHash:eventId,status:'PROCESSING'},update:{}});
    const result=await this.query(task.id);await settle(task,{...result});await this.db.providerEvent.update({where:{provider_eventId:{provider:'FADADA_SIGN',eventId}},data:{status:'PROCESSED'}});return{accepted:true,replayed:false};
  }
}
