import {requireOwnerContractCurrent} from './contract-state';
import {createHash,randomUUID} from 'node:crypto';
import {Db} from '../common/db';
import {audit,hash} from '../common/data';
import {ensure} from '../common/errors';
import {FadadaSettings} from '../esign/esign.settings';
import {FadadaApiClient} from '../esign/fadada/fadada-api.client';
import {accountReadiness,assertSignerResult,decryptIdentity,verifiedCallback} from '../esign/fadada/fadada-safety';
import {isFadadaQueryAbsent} from '../esign/fadada-query-binding';
import {miniappReturnUrl} from '../esign/native-signing';
import {platformCallback} from '../common/platform-origins';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {SignatureService} from '../orders/signature.service';
import {FadadaOwnerClient} from './fadada-owner.client';
import {OwnerSigningTasks} from './tasks';
import {OwnerIdentityService} from './identity';
import {OwnerAuthorizationService} from './authorization';
import {assertNewEsignAllowed} from '../offline-documents/mode';
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function ownerManualContractsEnabled(config:FadadaSettings){return config.enabled&&process.env.OWNER_CONTRACTS_ENABLED==='true'&&(config.signingEnabled||process.env.OWNER_MANUAL_CONTRACTS_ENABLED==='true');}

/** Actual owner and customer identities are pinned separately; Xiaolang is never a fallback signer. */
export class OwnerContractGateway {
 constructor(private db:Db,private config:FadadaSettings,private api:FadadaApiClient,private ownerApi:FadadaOwnerClient,private writer:ContractPdfArtifactWriterService,private tasks:OwnerSigningTasks,private identity:OwnerIdentityService,private authority:OwnerAuthorizationService){}
 private enabled(){ensure(this.config.enabled&&this.config.signingEnabled&&process.env.OWNER_CONTRACTS_ENABLED==='true',503,'OWNER_CONTRACTS_DISABLED','实际车主合同签署尚未开放');}
 private manualEnabled(){ensure(ownerManualContractsEnabled(this.config),503,'OWNER_CONTRACTS_DISABLED','实际车主合同手动签署尚未开放');}
 private async load(id:string){
  const t=await this.db.ownerSigningTask.findUnique({where:{id},include:{parties:true,owner:{include:{esignAccount:true}}}});ensure(t&&['SUBSCRIPTION','AMENDMENT'].includes(t.kind),404,'NOT_FOUND','车主合同任务不存在');
  const c=await this.db.contract.findUnique({where:{id:t.resourceId},include:{order:true,delayQuote:{include:{change:true}}}}),s=t.snapshot as any;
  ensure((c as any)?.executionMode!=='OFFLINE'&&(c?.order as any)?.contractMode!=='OFFLINE',409,'ESIGN_MODE_MISMATCH','历史电子签证据不能推进线下档案');
  ensure(c&&c.kind===t.kind&&c.customerId===t.customerId&&c.providerTaskId===t.id&&c.documentHash===t.documentHash&&c.sourceFileId===t.sourceFileId&&(c.order.finalPlanSnapshot as any).lessorSnapshot?.ownerId===t.ownerId,409,'DOCUMENT_MISMATCH','合同主体或文件版本已变化');
  ensure(t.parties.length===2&&t.parties.some(p=>p.role==='OWNER'&&p.providerCustomerId===s.lessor?.providerCustomerId&&p.providerSignatureId===s.lessor?.providerSignatureId)&&t.parties.some(p=>p.role==='CUSTOMER'&&p.providerCustomerId!==s.lessor?.providerCustomerId),409,'OWNER_PARTY_BINDING','合同双方身份未绑定');
  return {...t,contract:c};
 }
 private positions(t:any,role:'OWNER'|'CUSTOMER'){
  const all=t.snapshot.slotCoordinates;
  ensure(Array.isArray(all),409,'SIGNATURE_COORDINATES','签署坐标尚未生成');
  return [`STAGE1_BODY_${role}`,`STAGE1_ATTACHMENT1_${role}`].map(slotId=>{const rows=all.filter((r:any)=>r.slotId===slotId);ensure(rows.length===1,409,'SIGNATURE_COORDINATES','签署坐标缺失或重复');const r=rows[0];ensure(Number.isInteger(r.pageNumber)&&r.pageNumber>=0&&Number.isFinite(r.x)&&r.x>=0&&r.x<=800&&Number.isFinite(r.y)&&r.y>=0&&r.y<=1131,409,'SIGNATURE_COORDINATES','签署坐标无效');return{pagenum:r.pageNumber,x:r.x,y:r.y};});
 }
 private async upload(id:string){
  let t=await this.load(id);ensure(t.reviewedAt&&t.reviewedBy,409,'OWNER_REVIEW_REQUIRED','请先由运营核对本份完整PDF及签署区');
  const source=await this.writer.readVerified(t.sourceFileId,t.sourceSha256);if(t.uploadedAt)return t;
  const token=randomUUID(),until=new Date(Date.now()+120000);
  const claimed=await this.db.ownerSigningTask.updateMany({where:{id,uploadedAt:null,OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{processingToken:token,processingUntil:until}});ensure(claimed.count===1,409,'SIGNATURE_PROCESSING','签署文件准备中');
  try{
   t=await this.load(id);
   if(['UPLOADING','UPLOAD_UNKNOWN'].includes(t.status)){
    const remote=await this.api.downloadSignedContract({contractId:t.providerContractId});ensure(digest(remote.buffer)===t.sourceSha256,409,'OWNER_UPLOAD_UNKNOWN','供应商文件状态待核对，不能重复上传');
   }else{
    ensure(t.status==='PREPARED',409,'SIGNATURE_STATE','当前文件不能上传');
    await this.db.ownerSigningTask.update({where:{id},data:{status:'UPLOADING'}});
    const result=await this.api.uploadDocs({contractId:t.providerContractId,docTitle:'车辆订阅租赁合同',fileName:t.providerContractId+'.pdf',pdf:source});
    ensure(['1','1000','success'].includes(String((result.raw as any)?.code||(result.raw as any)?.result_code||'')),502,'FADADA_UPLOAD_UNCONFIRMED','供应商尚未确认上传，请核验原文件');
   }
   const changed=await this.db.ownerSigningTask.updateMany({where:{id,processingToken:token,processingUntil:{gt:new Date()},uploadedAt:null},data:{uploadedAt:new Date(),status:'READY'}});ensure(changed.count===1,409,'SIGNATURE_LEASE_LOST','文件准备处理权已变化');
   return await this.load(id);
  }catch(error){await this.db.ownerSigningTask.updateMany({where:{id,processingToken:token,uploadedAt:null,status:'UPLOADING'},data:{status:'UPLOAD_UNKNOWN'}});throw error;}
  finally{await this.db.ownerSigningTask.updateMany({where:{id,processingToken:token},data:{processingToken:null,processingUntil:null}});}
 }
 async customerSign(customerId:string,contractId:string){
  assertNewEsignAllowed();
  this.manualEnabled();const c=await this.db.contract.findFirst({where:{id:contractId,customerId}});ensure(c?.providerTaskId,409,'OWNER_DOCUMENT_NOT_READY','请等待运营准备并核对合同');
  let t=await this.load(c.providerTaskId);ensure(t.customerId===customerId,404,'NOT_FOUND','合同不存在');ensure(['DRAFT','PENDING'].includes(c.status),409,'SIGNATURE_STATE','当前合同不可重新签署');
  requireOwnerContractCurrent(t.contract);const party=t.parties.find(p=>p.role==='CUSTOMER')!,account=await this.db.eSignAccount.findUnique({where:{customerId}});ensure(accountReadiness(account).readyForSigning&&account?.identityCiphertext&&account.providerCustomerId===party.providerCustomerId,409,'REALNAME_REQUIRED','本人实名及证书与合同不一致');
  if(party.attemptedAt){const state=await this.queryParty(t,party);this.requireManualReentryResult(state);}
  t=await this.upload(t.id);const identity=decryptIdentity(account.identityCiphertext,customerId,this.config.identityEncryptionKey),customer=await this.db.customer.findUniqueOrThrow({where:{id:customerId}});
  await this.db.serial(async tx=>{const changed=await tx.contract.updateMany({where:{id:contractId,customerId,providerTaskId:t.id,status:{in:['DRAFT','PENDING']}},data:{status:'PENDING'}});ensure(changed.count===1,409,'SIGNATURE_STATE','合同状态已变化');await tx.ownerSigningParty.updateMany({where:{id:party.id,attemptedAt:null},data:{attemptedAt:new Date(),status:'SUBMITTING'}});});
  const entry=await this.api.createExternalSignUrl({contractId:t.providerContractId,customerId:party.providerCustomerId,transactionId:party.transactionId,docTitle:'车辆订阅租赁合同',notifyUrl:platformCallback('fadada-owner-sign'),returnUrl:miniappReturnUrl(),signaturePositions:this.positions(t,'CUSTOMER'),signerName:identity.name,signerMobile:customer.mobile,validityMinutes:this.config.signUrlValidityMinutes});
  return{taskId:t.id,status:'PENDING',url:entry.signUrl};
 }
 async ownerSign(customerId:string,ownerId:string,id:string){
  assertNewEsignAllowed();
  this.manualEnabled();let t=await this.load(id);ensure(t.ownerId===ownerId,404,'NOT_FOUND','本企业合同不存在');
  ensure(t.contract.status==='PENDING'&&t.uploadedAt,409,'OWNER_DOCUMENT_NOT_READY','合同尚未进入签署');
  ensure(t.parties.some(p=>p.role==='CUSTOMER'&&p.status==='SIGNED'&&p.verifiedAt&&p.queryEvidenceHash),409,'OWNER_CUSTOMER_SIGNATURE_REQUIRED','请先等待客户签署并核验签署结果');
  requireOwnerContractCurrent(t.contract);await this.identity.refresh(customerId,ownerId);
  const party=t.parties.find(p=>p.role==='OWNER')!;
  if(party.attemptedAt){ensure(t.ownerMode==='MANUAL'&&t.manualBy===customerId,409,'OWNER_ALREADY_DISPATCHED','本文件已发起企业签署，请查询原交易');const result=await this.queryParty(t,party);this.requireManualReentryResult(result);await this.tasks.assertManualReentry(customerId,ownerId,id);}
  else{await this.tasks.claimManual(customerId,ownerId,id);await this.tasks.beginManual(customerId,ownerId,id);}
  t=await this.load(id);ensure(t.contract.status==='PENDING'&&t.uploadedAt,409,'OWNER_DOCUMENT_NOT_READY','合同尚未进入签署');
  return{taskId:id,status:'PENDING',...this.ownerApi.createManualSignUrl({customerId:party.providerCustomerId,signatureId:party.providerSignatureId!,contractId:t.providerContractId,transactionId:party.transactionId,title:'车辆订阅租赁合同',positions:this.positions(t,'OWNER')})};
 }
 async chooseManual(customerId:string,ownerId:string,id:string){
  assertNewEsignAllowed();const task=await this.db.ownerSigningTask.findUnique({where:{id}});ensure(task&&task.ownerId===ownerId,404,'NOT_FOUND','本企业签署任务不存在');
  const resource=await this.db.contract.findUnique({where:{id:task.resourceId},include:{order:true}});ensure(resource,404,'NOT_FOUND','签署合同不存在');
  assertNewEsignAllowed({executionMode:resource.executionMode,contractMode:resource.order.contractMode});return this.tasks.claimManual(customerId,ownerId,id);
 }
 private requireManualReentryResult(result:{status:string;absent:boolean}){
  ensure(result.status!=='SIGNED',409,'SIGNER_ALREADY_SIGNED','本方已签署，请核验双方签署与归档');
  ensure(!['REJECTED','EXPIRED'].includes(result.status),409,'SIGNATURE_STATE','本份签署已结束，请查询结果并联系运营');
  ensure(result.absent,409,'SIGNATURE_RESULT_UNKNOWN','原签署结果仍待核验，请先查询原交易，不要重复发起签署');
 }
 private async queryParty(t:any,p:any){
  const terminalStatuses=['SIGNED','REJECTED','EXPIRED'];
  if(p.attemptedAt&&terminalStatuses.includes(p.status)&&p.verifiedAt&&p.queryEvidenceHash)return{status:p.status as string,absent:false};
  const expected={contractId:t.providerContractId,customerId:p.providerCustomerId,transactionId:p.transactionId},result=await this.api.querySignResult(expected),absent=isFadadaQueryAbsent(result,expected);
  if(!absent)assertSignerResult(result,expected);
  const status=result.status==='FAILED'?'REJECTED':result.status;
  if(!absent&&['SIGNED','REJECTED','EXPIRED'].includes(status)){
   ensure(p.attemptedAt,409,'OWNER_SIGNATURE_TRACE','签署结果缺少本平台发起记录');
   await this.db.ownerSigningParty.updateMany({where:{id:p.id,status:{notIn:terminalStatuses}},data:{status,verifiedAt:new Date(),queryEvidenceHash:hash({expected,result:result.raw})}});
  }
  else if(p.attemptedAt){
   // A trusted absent result permits reopening only this original transaction. Unknown results remain blocked.
   await this.db.ownerSigningParty.updateMany({where:{id:p.id,status:{notIn:terminalStatuses}},data:{status:absent?'PENDING':'UNKNOWN',verifiedAt:absent?new Date():null,queryEvidenceHash:absent?hash({expected,result:result.raw}):null}});
  }
  const saved=await this.db.ownerSigningParty.findUniqueOrThrow({where:{id:p.id},select:{status:true,attemptedAt:true,verifiedAt:true,queryEvidenceHash:true}});
  if(saved.attemptedAt&&terminalStatuses.includes(saved.status)&&saved.verifiedAt&&saved.queryEvidenceHash)return{...result,status:saved.status,absent:false};
  return{...result,status,absent};
 }
 async query(id:string,_advanceAuto=false){return this.reconcileOnly(id);}
 async reconcileOnly(id:string):Promise<{status:'PENDING'|'SIGNED'|'REJECTED'|'EXPIRED';taskId:string;documentHash:string;signedFileId?:string}>{
  ensure(this.config.enabled,503,'FADADA_DISABLED','签署核验尚未配置');let t=await this.load(id);const pending={status:'PENDING' as const,taskId:id,documentHash:t.documentHash};
  if(t.status==='ARCHIVED')return this.settle(t);
  if(['REJECTED','EXPIRED'].includes(t.status)){const result={status:t.status as 'REJECTED'|'EXPIRED',taskId:id,documentHash:t.documentHash};if(t.contract.status!==result.status)await new SignatureService(this.db).settleContract(t.resourceId,result);return result;}
  if(!t.uploadedAt)return pending;
  const token=randomUUID();const claimed=await this.db.ownerSigningTask.updateMany({where:{id,status:{not:'ARCHIVED'},OR:[{processingUntil:null},{processingUntil:{lt:new Date()}}]},data:{processingToken:token,processingUntil:new Date(Date.now()+120000)}});if(!claimed.count)return pending;
  try{
   t=await this.load(id);const cp=t.parties.find(p=>p.role==='CUSTOMER')!,op=t.parties.find(p=>p.role==='OWNER')!;
   const customer=await this.queryParty(t,cp);let owner=await this.queryParty(t,op);
   const terminal=[customer,owner].find(r=>!r.absent&&['REJECTED','EXPIRED'].includes(r.status));if(terminal){const status=terminal.status as 'REJECTED'|'EXPIRED';await this.db.ownerSigningTask.updateMany({where:{id,processingToken:token},data:{status}});const event={status,taskId:id,documentHash:t.documentHash};await new SignatureService(this.db).settleContract(t.resourceId,event);return event;}
   if(customer.status!=='SIGNED')return pending;
   if(owner.status!=='SIGNED')return pending;
   t=await this.load(id);ensure(t.ownerDispatchAt&&t.parties.every(p=>p.status==='SIGNED'&&p.verifiedAt&&p.queryEvidenceHash),409,'OWNER_SIGNATURE_TRACE','双方签署证据尚未齐备');
   const result=await this.api.downloadSignedContract({contractId:t.providerContractId});ensure(digest(result.buffer)!==t.sourceSha256,409,'OWNER_SIGNED_PDF_REQUIRED','供应商尚未返回签后文件，请稍后核验');
   const file=await this.writer.persistPdf(result.buffer,{customerId:t.customerId,name:t.resourceId+'-owner-signed.pdf',purpose:'contract'});
   await this.db.serial(async tx=>{const changed=await tx.ownerSigningTask.updateMany({where:{id,processingToken:token,processingUntil:{gt:new Date()},status:{not:'ARCHIVED'}},data:{status:'ARCHIVED',archivedAt:new Date(),signedFileId:file.id,signedPdfHash:file.sha256}});ensure(changed.count===1,409,'SIGNATURE_LEASE_LOST','归档处理权已变化，请重新读取');await audit(tx,'fadada','OWNER_CONTRACT_ARCHIVED','contracts',t.resourceId,{taskId:id,sourceHash:t.sourceSha256,signedHash:file.sha256},'PROVIDER');});
   return this.settle(await this.load(id));
  }finally{await this.db.ownerSigningTask.updateMany({where:{id,processingToken:token},data:{processingToken:null,processingUntil:null}});}
 }
 private async settle(t:any){ensure(t.signedFileId&&t.signedPdfHash,409,'SIGNATURE_ARCHIVE_REQUIRED','签后文件尚未归档');await this.writer.readVerified(t.signedFileId,t.signedPdfHash);const result={status:'SIGNED' as const,taskId:t.id,documentHash:t.documentHash,signedFileId:t.signedFileId};await new SignatureService(this.db).settleContract(t.resourceId,result);return result;}
 async callback(payload:unknown){
  const verified=verifiedCallback(payload,this.config),party=await this.db.ownerSigningParty.findUnique({where:{transactionId:verified.transactionId},include:{task:true}});ensure(party&&party.task.providerContractId===verified.providerContractId,404,'CALLBACK_TASK_MISMATCH','回调交易与合同不匹配');
  await this.reconcileOnly(party.taskId);return{accepted:true};
 }
}
