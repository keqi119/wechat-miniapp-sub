import {hashSigningPlanPayload} from '../enterprise-seal/signing-plan-hash';
import {TECHNICAL_KIND,technicalEnabled,lockTechnical} from '../../technical-acceptance/rules';
import {approvedReturnUrl} from '../../h5-sign/config';
import {approvedPlatformCallback} from '../../common/platform-origins';
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
import {isFadadaQueryAbsent} from '../fadada-query-binding';
import {FadadaOwnerClient,runOwnerH5} from '../../owner-signing/fadada-owner.client';
import {assertPlatformManualTrace,assertPlatformManualContinuation,newPlatformSigningMode,manualHandoverEnabled,manualHandoverTask,platformHandoverRecord,platformManualIdentityEvidence} from '../platform-handover';
import {requireCurrentConsents} from '../../auth/consents';
import {z} from 'zod';
import {assertNewEsignAllowed} from '../../offline-documents/mode';
const manualInput=z.object({accepted:z.literal(true),documentHash:z.string().regex(/^[a-f0-9]{64}$/),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export class FadadaESignGateway extends ESignGateway {
  constructor(private db:Db,private config:FadadaSettings,private api:FadadaApiClient,private writer:ContractPdfArtifactWriterService,private policies:SignaturePolicyService,private platformClient=new FadadaOwnerClient(config)){super();}
  private enabled(kind?:string,readOnly=false){ensure(this.config.enabled&&(kind===TECHNICAL_KIND?(readOnly||technicalEnabled()):this.config.signingEnabled),503,'FADADA_SIGNING_DISABLED','法大大真实签署尚未启用');}
  private title(kind:string){return kind===TECHNICAL_KIND?'电子签署流程验证确认书':kind==='HANDOVER'?'车辆交接单':kind==='AMENDMENT'?'订阅变更补充协议':'汽车订阅合同与订阅方案';}
  private async technicalAllowed(id:string){const r=await this.db.technicalAcceptance.findUnique({where:{id}});return !!(technicalEnabled()&&r?.confirmedAt&&!r.stoppedAt&&!r.purgedAt&&!r.purgeStartedAt&&['DRAFT','PENDING'].includes(r.status));}
  private async technicalGate(id:string){ensure(await this.technicalAllowed(id),409,'ACCEPTANCE_STOPPED','本次技术验证已停止或不可继续签署');}
  private async technicalDispatch<T>(id:string,action:()=>Promise<T>,unsentTask?:{id:string;lease:Date}):Promise<T|null>{
    // Deliberately NOT db.serial: once an external call starts, automatic transaction retry is unsafe.
    // The previously committed seal marker survives timeout/unknown outcome and prevents another seal.
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "TechnicalAcceptance" WHERE id=${id} FOR UPDATE`;
      const r=await tx.technicalAcceptance.findUnique({where:{id}});
      const allowed=technicalEnabled()&&r?.confirmedAt&&!r.stoppedAt&&!r.purgedAt&&!r.purgeStartedAt&&['DRAFT','PENDING'].includes(r.status);
      if(!allowed){if(unsentTask){await tx.fadadaTask.updateMany({where:{id:unsentTask.id,processingUntil:unsentTask.lease},data:{sealRequestedAt:null}});return null;}ensure(false,409,'ACCEPTANCE_STOPPED','本次技术验证已停止，不再发起签署');}
      return action();
    },{isolationLevel:'ReadCommitted',timeout:Math.max(15000,this.config.requestTimeoutMs||15000)+10000,maxWait:5000});
  }
  private positions(approval:any,role:'CUSTOMER'|'PLATFORM'){
    const expected=approval.kind===TECHNICAL_KIND?[`TECHNICAL_${role}`]:approval.kind!=='HANDOVER'?[`STAGE1_BODY_${role}`,`STAGE1_ATTACHMENT1_${role}`]:[`STAGE2_HANDOVER_${role}`];
    const all=approval.slotCoordinates as any[];
    ensure(Array.isArray(all),409,'SIGNATURE_COORDINATES','签署坐标尚未生成');
    return expected.map(slotId=>{const rows=all.filter(row=>row.slotId===slotId);ensure(rows.length===1,409,'SIGNATURE_COORDINATES','签署坐标缺失或重复');const row=rows[0];ensure(Number.isInteger(row.pageNumber)&&row.pageNumber>=0&&Number.isFinite(row.x)&&row.x>=0&&row.x<=800&&Number.isFinite(row.y)&&row.y>=0&&row.y<=1131,409,'SIGNATURE_COORDINATES','签署坐标无效');return{pagenum:row.pageNumber,x:row.x,y:row.y};});
  }
  async create(input:Parameters<ESignGateway['create']>[0]){
    assertNewEsignAllowed();
    this.enabled(input.kind);
    if(input.kind===TECHNICAL_KIND)await this.technicalGate(input.contractId);
    approvedPlatformCallback(this.config.signNotifyUrl,'fadada-sign');
    const returnUrl=approvedReturnUrl(input.returnUrl||this.config.signReturnUrl);
    const existing=await this.db.fadadaTask.findUnique({where:{kind_resourceId_documentHash:{kind:input.kind,resourceId:input.contractId,documentHash:input.documentHash}}});
    const context=await this.policies.approved(input.kind,input.contractId,input.documentHash,existing?.approvalId);
    assertNewEsignAllowed({executionMode:(context.resource as any).executionMode,contractMode:(context.resource as any).order?.contractMode});
    ensure(context.resource.customerId===input.customerId&&context.resource.id===input.contractId,404,'NOT_FOUND','签署记录不存在');
    const account=await this.db.eSignAccount.findUnique({where:{customerId:input.customerId}});
    ensure(accountReadiness(account).readyForSigning&&account?.providerCustomerId&&account.identityCiphertext,409,'REALNAME_REQUIRED','请先完成供应商实名核验与证书绑定');
    ensure(context.policy.executionMode==='SEQUENTIAL',409,'EXECUTION_MODE','当前流程只接受先客户签署、后企业盖章的已批准策略');
    const identity=decryptIdentity(account.identityCiphertext,input.customerId,this.config.identityEncryptionKey);
    let task=existing;
    if(!task){
      const id=randomUUID();const identifier=(kind:string)=>createHash('sha256').update('independent-esign:'+id+':'+kind).digest('hex').slice(0,32);
      try {task=await this.db.fadadaTask.create({data:{id,kind:input.kind,resourceId:input.contractId,customerId:input.customerId,documentHash:input.documentHash,sourcePdfHash:context.approval.sourcePdfHash,sourceFileId:context.approval.sourceFileId,approvalId:context.approval.id,providerEnvelopeId:identifier('envelope'),customerProviderId:account.providerCustomerId,platformProviderId:context.seal.providerCustomerId,customerTransactionId:identifier('customer'),platformTransactionId:identifier('platform'),platformSigningMode:newPlatformSigningMode(input.kind)}});}
      catch(error:any){if(error.code!=='P2002')throw error;task=await this.db.fadadaTask.findUniqueOrThrow({where:{kind_resourceId_documentHash:{kind:input.kind,resourceId:input.contractId,documentHash:input.documentHash}}});}
    }
    ensure(task.customerId===input.customerId&&task.approvalId===context.approval.id&&task.sourcePdfHash===context.approval.sourcePdfHash&&task.customerProviderId===account.providerCustomerId&&task.platformProviderId===context.seal.providerCustomerId,409,'SIGNING_TASK_MISMATCH','签署任务身份或文档版本不匹配');
    ensure(!['SIGNED','REJECTED','EXPIRED'].includes(task.status),409,'SIGNATURE_STATE','当前签署任务不可重新发起');
    ensure(!task.customerSignedAt,409,'SIGNER_ALREADY_SIGNED','本人签署已核验，请继续核验企业签署与归档，无需重复签署');
    if(!task.uploadedAt){
      const uploadLeaseUntil=new Date(Date.now()+60000);
      const claim=await this.db.fadadaTask.updateMany({where:{id:task.id,uploadedAt:null,OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{processingUntil:uploadLeaseUntil}});
      ensure(claim.count===1,409,'SIGNATURE_PROCESSING','签署任务准备中，请稍后重试');
      try{if(input.kind===TECHNICAL_KIND)await this.technicalGate(input.contractId);const pdf=await this.writer.readVerified(task.sourceFileId,task.sourcePdfHash);const upload=()=>this.api.uploadDocs({contractId:task!.providerEnvelopeId,docTitle:this.title(input.kind),fileName:task!.providerEnvelopeId+'.pdf',pdf});const uploaded=input.kind===TECHNICAL_KIND?(await this.technicalDispatch(input.contractId,upload))!:await upload();const raw=uploaded.raw as any;ensure(['1','1000','success'].includes(String(raw?.code||raw?.result_code||'')),502,'FADADA_UPLOAD_UNCONFIRMED','供应商未确认签署PDF上传');const stored=await this.db.fadadaTask.updateMany({where:{id:task.id,uploadedAt:null,processingUntil:uploadLeaseUntil},data:{uploadedAt:new Date(),status:'PENDING',processingUntil:null}});ensure(stored.count===1,409,'SIGNATURE_LEASE_LOST','签署准备处理权已变化，请重新查询');task=await this.db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});}
      catch(error){await this.db.fadadaTask.updateMany({where:{id:task.id,processingUntil:uploadLeaseUntil},data:{processingUntil:null}});throw error;}
    }
    if(input.kind===TECHNICAL_KIND)await this.technicalGate(input.contractId);
    const entryAction=()=>this.api.createExternalSignUrl({contractId:task!.providerEnvelopeId,customerId:task!.customerProviderId,transactionId:task!.customerTransactionId,docTitle:this.title(input.kind),notifyUrl:this.config.signNotifyUrl!,returnUrl,signaturePositions:this.positions(context.approval,'CUSTOMER'),signerName:identity.name,signerMobile:input.mobile,validityMinutes:this.config.signUrlValidityMinutes});
    const entry=input.kind===TECHNICAL_KIND?(await this.technicalDispatch(input.contractId,entryAction))!:await entryAction();
    return {taskId:task.id,url:entry.signUrl,status:'PENDING'};
  }
  private async providerStatus(task:any,platform:boolean){
    const expected={contractId:task.providerEnvelopeId,customerId:platform?task.platformProviderId:task.customerProviderId,transactionId:platform?task.platformTransactionId:task.customerTransactionId};
    const result=await this.api.querySignResult(expected);
    const absent=isFadadaQueryAbsent(result,expected);
    if(!absent)assertSignerResult(result,expected);
    return {...result,absent};
  }
  async platformManualReadiness(customerId:string,ownerId:string,id:string,db:Db=this.db){return runOwnerH5(async()=>{
    ensure(manualHandoverEnabled(this.config),503,'PLATFORM_MANUAL_DISABLED','平台交接单手动签署入口尚未开放');
    const record=await platformHandoverRecord(db,this.config,customerId,ownerId,id),{task,resource}=record;
    assertNewEsignAllowed({executionMode:resource.executionMode,contractMode:resource.order.contractMode});
    ensure(task.uploadedAt&&task.status==='PENDING'&&resource.status==='CUSTOMER_CONFIRMED'&&resource.signatureStatus==='PENDING',409,'SIGNATURE_STATE','本份交接单当前不能继续签署');
    ensure(task.customerSignedAt,409,'PLATFORM_CUSTOMER_REQUIRED','请等待客户完成本份交接单签署');
    const current=await platformManualIdentityEvidence(db,this.config,customerId,ownerId);
    const context=await this.policies.approved('HANDOVER',task.resourceId,task.documentHash,task.approvalId,db);
    ensure(context.policy.executionMode==='SEQUENTIAL'&&context.approval.customerId===task.customerId&&context.approval.sourceFileId===task.sourceFileId&&context.approval.sourcePdfHash===task.sourcePdfHash&&context.seal.providerCustomerId===task.platformProviderId&&context.seal.providerSignatureId===current.seal.providerSignatureId,409,'DOCUMENT_MISMATCH','当前签署审批、企业印章或PDF已变化');
    const evidence={...current.evidence,accepted:true,documentHash:task.documentHash,sourceFileId:task.sourceFileId,sourcePdfHash:task.sourcePdfHash,providerEnvelopeId:task.providerEnvelopeId,platformTransactionId:task.platformTransactionId,approvalId:context.approval.id,planHash:context.approval.planHash};
    if(task.platformManualRequestedAt)await assertPlatformManualContinuation(db,task,evidence,context.approval);
    return{...record,...current,context,evidence};
  });}
  async platformManualSign(customerId:string,ownerId:string,id:string,raw:unknown){return runOwnerH5(async()=>{
    assertNewEsignAllowed();
    const input=manualInput.parse(raw);ensure(manualHandoverEnabled(this.config),503,'PLATFORM_MANUAL_DISABLED','平台交接单手动签署入口尚未开放');
    const initial=await platformHandoverRecord(this.db,this.config,customerId,ownerId,id);
    assertNewEsignAllowed({executionMode:initial.resource.executionMode,contractMode:initial.resource.order.contractMode});
    ensure(input.documentHash===initial.task.documentHash&&input.sourceSha256===initial.task.sourcePdfHash,409,'DOCUMENT_MISMATCH','请重新核对本份交接单全文及PDF');
    await requireCurrentConsents(this.db,customerId,['terms','privacy']);
    // Query only; manual tasks can never enter the automatic seal branch.
    const customer=await this.providerStatus(initial.task,false);
    ensure(customer.status==='SIGNED',409,'PLATFORM_CUSTOMER_REQUIRED','请等待客户完成本份交接单签署');
    await this.db.serial(async tx=>{
      const current=await platformHandoverRecord(tx,this.config,customerId,ownerId,id);
      assertNewEsignAllowed({executionMode:current.resource.executionMode,contractMode:current.resource.order.contractMode});
      ensure(current.resource.id===initial.resource.id&&current.task.documentHash===initial.task.documentHash&&current.task.sourcePdfHash===initial.task.sourcePdfHash,409,'DOCUMENT_MISMATCH','交接单文档或任务已变化');
      await tx.fadadaTask.updateMany({where:{id,customerSignedAt:null},data:{customerSignedAt:new Date()}});
    });
    const before=await this.platformManualReadiness(customerId,ownerId,id);
    const [certificate,seals]=await Promise.all([this.platformClient.queryCertificate(before.task.platformProviderId),this.platformClient.querySeals(before.task.platformProviderId)]);
    ensure(certificate.customerId===before.task.platformProviderId&&certificate.bound&&certificate.serialNo===before.evidence.certificateSerialNo,409,'PLATFORM_CERTIFICATE','企业证书已过期或变化，请重新核验');
    ensure(seals.some(s=>s.customerId===before.task.platformProviderId&&s.signatureId===before.seal.providerSignatureId&&s.imageHash===before.seal.imageHash),409,'PLATFORM_SEAL','当前已选企业印章不再有效');
    const platform=await this.providerStatus(before.task,true);
    if(platform.status==='SIGNED'){assertPlatformManualTrace(before.task);ensure(false,409,'SIGNER_ALREADY_SIGNED','平台已签署，请同步归档');}
    ensure(platform.status!=='FAILED'&&(platform.absent||before.task.platformManualRequestedAt),409,'PLATFORM_MANUAL_TRACE','平台已有未核验签署记录，请联系运营核对');
    await this.writer.readVerified(before.task.sourceFileId,before.task.sourcePdfHash);
    return this.db.serial(async tx=>{
      const current=await this.platformManualReadiness(customerId,ownerId,id,tx as Db);
      ensure(hashSigningPlanPayload(current.evidence)===hashSigningPlanPayload(before.evidence),409,'PLATFORM_MANUAL_IDENTITY_CHANGED','签署核验期间企业或审批信息已变化');
      await requireCurrentConsents(tx,customerId,['terms','privacy']);
      // The page is generated locally, so the marker and URL generation can share
      // a serializable transaction without retrying any external signing action.
      const entry=this.platformClient.createPlatformHandoverSignUrl({contractId:current.task.providerEnvelopeId,customerId:current.task.platformProviderId,transactionId:current.task.platformTransactionId,signatureId:current.seal.providerSignatureId,title:this.title('HANDOVER'),positions:this.positions(current.context.approval,'PLATFORM')});
      const changed=await tx.fadadaTask.updateMany({where:{id,status:'PENDING',platformSigningMode:'MANUAL',approvalId:current.task.approvalId,OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{platformManualRequestedAt:current.task.platformManualRequestedAt||new Date(),platformManualSignerId:customerId,platformManualOwnerId:ownerId,platformManualEvidence:current.evidence}});
      ensure(changed.count===1,409,'SIGNATURE_PROCESSING','签署正在处理中，请稍后重试');
      await audit(tx,customerId,'PLATFORM_HANDOVER_MANUAL_ENTRY','esign-tasks',id,{approvalId:current.task.approvalId,evidenceHash:hashSigningPlanPayload(current.evidence),priorEvidence:current.task.platformManualEvidence,evidence:current.evidence,documentHash:current.task.documentHash,sourcePdfHash:current.task.sourcePdfHash},'CUSTOMER');
      return{taskId:id,status:'PENDING',url:entry.url};
    });
  });}
  async query(taskId:string){return this.reconcileOnly(taskId);}
  async reconcileOnly(taskId:string):Promise<{status:'PENDING'|'SIGNED'|'REJECTED'|'EXPIRED';documentHash:string;signedFileId?:string}>{
    ensure(this.config.enabled,503,'FADADA_DISABLED','历史电子签渠道未配置，无法核验原交易');
    let task=await this.db.fadadaTask.findUnique({where:{id:taskId}});ensure(task?.uploadedAt,404,'SIGNATURE_TASK','签署任务未准备完成');
    const resource=await this.writer.resource(task.kind as SignatureKind,task.resourceId);
    ensure((resource as any).executionMode!=='OFFLINE'&&(resource as any).order?.contractMode!=='OFFLINE',409,'ESIGN_MODE_MISMATCH','历史电子签证据不能推进线下档案');
    ensure(resource.customerId===task.customerId&&(task.kind!=='HANDOVER'?resource.documentHash:resource.manifestHash)===task.documentHash,409,'DOCUMENT_MISMATCH','签署业务文档已变化');
    if(manualHandoverTask(task)){
      ensure(resource.id===task.resourceId&&resource.providerTaskId===task.id&&resource.confirmedAt&&resource.order?.customerId===task.customerId,409,'DOCUMENT_MISMATCH','交接事实、签署任务或客户归属已变化');
      if(task.status==='SIGNED')assertPlatformManualTrace(task);
    }
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
      if(manualHandoverTask(task)&&platform.status==='FAILED'){
        assertPlatformManualTrace(task);
        const rejected=await this.db.fadadaTask.updateMany({where:{id:task.id,status:'PENDING',processingUntil:leaseUntil},data:{status:'REJECTED'}});
        ensure(rejected.count===1,409,'SIGNATURE_LEASE_LOST','签署处理权已变化，请重新查询');
        await audit(this.db,'fadada','PLATFORM_HANDOVER_MANUAL_REJECTED','esign-tasks',task.id,{},'PROVIDER');
        return{status:'REJECTED',documentHash:task.documentHash};
      }
      if(platform.status!=='SIGNED')return{status:'PENDING',documentHash:task.documentHash};
      const current=await this.db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});if(manualHandoverTask(current))assertPlatformManualTrace(current);else ensure(current.sealRequestedAt,409,'SEAL_APPROVAL_TRACE','企业签章缺少已批准执行记录');
      const signed=await this.api.downloadSignedContract({contractId:task.providerEnvelopeId});
      if(manualHandoverTask(task))ensure(createHash('sha256').update(signed.buffer).digest('hex')!==task.sourcePdfHash,409,'SIGNATURE_ARCHIVE_REQUIRED','签后PDF不能与原始PDF相同');
      const archived=await this.writer.persistPdf(signed.buffer,{customerId:task.customerId,name:task.resourceId+'-signed.pdf',purpose:task.kind===TECHNICAL_KIND?'technical-acceptance':task.kind==='AMENDMENT'?'amendment':'contract'});
      try{await this.db.serial(async tx=>{const settled=await tx.fadadaTask.updateMany({where:{id:task!.id,processingUntil:leaseUntil,status:{not:'SIGNED'}},data:{status:'SIGNED',platformSignedAt:new Date(),signedFileId:archived.id,signedPdfHash:archived.sha256,processingUntil:null}});ensure(settled.count===1,409,'SIGNATURE_LEASE_LOST','签署归档处理权已变化，请重新查询');await audit(tx,'fadada','SIGNED_PDF_ARCHIVED','esign-tasks',task!.id,{sourcePdfHash:task!.sourcePdfHash,signedPdfHash:archived.sha256,fileId:archived.id},'PROVIDER');});}finally{if(task.kind===TECHNICAL_KIND)await this.writer.discardUnreferencedTechnicalFile(archived.id);}
      return{status:'SIGNED',documentHash:task.documentHash,signedFileId:archived.id};
    }finally{await this.db.fadadaTask.updateMany({where:{id:task.id,processingUntil:leaseUntil},data:{processingUntil:null}});}
  }
  async callback(payload:unknown,settle:(task:any,event:Awaited<ReturnType<FadadaESignGateway['query']>>)=>Promise<unknown>){
    ensure(this.config.enabled,503,'FADADA_DISABLED','签约服务尚未配置');const verified=verifiedCallback(payload,this.config);const eventId=hash(Object.fromEntries(Object.entries(verified.record).sort(([a],[b])=>a.localeCompare(b))));
    const previous=await this.db.providerEvent.findUnique({where:{provider_eventId:{provider:'FADADA_SIGN',eventId}}});if(previous?.status==='PROCESSED')return{accepted:true,replayed:true};
    const task=await this.db.fadadaTask.findFirst({where:{OR:[{customerTransactionId:verified.transactionId},{platformTransactionId:verified.transactionId}]}});ensure(task&&verified.providerContractId===task.providerEnvelopeId,404,'CALLBACK_TASK_MISMATCH','签署回调任务身份不匹配');
    await this.db.providerEvent.upsert({where:{provider_eventId:{provider:'FADADA_SIGN',eventId}},create:{provider:'FADADA_SIGN',eventId,resourceId:task.resourceId,payloadHash:eventId,status:'PROCESSING'},update:{}});
    const result=await this.reconcileOnly(task.id);await settle(task,{...result});await this.db.providerEvent.update({where:{provider_eventId:{provider:'FADADA_SIGN',eventId}},data:{status:'PROCESSED'}});return{accepted:true,replayed:false};
  }
}
