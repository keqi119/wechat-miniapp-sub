import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,key} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {verifiedCallback} from '../esign/fadada/fadada-safety';
import {electronicAccess,ElectronicActor} from './access';
import {resolveSigningParties,requireElectronicOwnerActor} from './identities';
import {assertElectronicTaskSnapshot,electronicTaskFacts,frozenParty,lockElectronicTask,reserveElectronicOperation} from './repository';
import {electronicHash,nextSigningAction,selectSigningModes} from './policy';
import {finalizeElectronicArchive} from './archive';
import {ElectronicProvider,ElectronicProviderDocument} from './provider';
import type {SignerRole,SigningPartyInput} from './types';

const command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict();
const signCommand=command.extend({sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),accepted:z.literal(true)});
const withdrawCommand=command.extend({reason:z.string().trim().min(2).max(1000)});
const inactive=(task:any)=>!!task.retiredAt||!!task.withdrawnAt||['RETIRED','WITHDRAWN','DECLINED','EXPIRED'].includes(task.status);
type Options={resolveParties?:typeof resolveSigningParties;requireOwnerActor?:typeof requireElectronicOwnerActor;refreshAuthorities?:(task:any)=>Promise<void>;afterArchive?:(tx:any,task:any)=>Promise<void>;clock?:()=>Date};
export class ElectronicDocumentService{
 private identities:typeof resolveSigningParties;private ownerActor:typeof requireElectronicOwnerActor;private now:()=>Date;
 constructor(private db:Db,private provider:ElectronicProvider,private writer:ContractPdfArtifactWriterService,private options:Options={}){this.identities=options.resolveParties??resolveSigningParties;this.ownerActor=options.requireOwnerActor??requireElectronicOwnerActor;this.now=options.clock??(()=>new Date());}
 private async access(tx:any,actor:ElectronicActor,task:any,write=false){return electronicAccess(tx,actor,task,write,this.ownerActor);}
 private async business(tx:any,task:any){
  ensure(!inactive(task),409,'ELECTRONIC_TASK_CLOSED','本版合同已停止办理');
  const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}}),latest=await tx.archiveVersion.findFirst({where:{archiveId:version?.archiveId||''},orderBy:{version:'desc'},select:{id:true}});
  ensure(version?.executionMode==='ELECTRONIC'&&!version.invalidatedAt&&version.businessSnapshotHash===task.businessHash&&version.sourceFileId===task.sourceFileId&&latest?.id===version.id,409,'ELECTRONIC_BUSINESS_CHANGED','业务文件已变化，请核对最新版本');
  if(task.orderId){await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${task.orderId} FOR UPDATE`;const order=await tx.order.findUnique({where:{id:task.orderId}});ensure(order&&order.contractMode==='ELECTRONIC'&&order.customerId===task.customerId&&!['CANCELLED','RETIRED'].includes(order.status),409,'ELECTRONIC_BUSINESS_CHANGED','原订单已停止或归属发生变化');}
  if(task.cooperationVersionId){const cooperation=await tx.partnerAgreementVersion.findUnique({where:{id:task.cooperationVersionId}});ensure(cooperation&&cooperation.ownerId===task.ownerId&&cooperation.contentHash===task.businessHash&&!['VOID','TERMINATED','RETIRED'].includes(cooperation.status),409,'ELECTRONIC_BUSINESS_CHANGED','合作协议版本已停止或条款发生变化');}
  return version;
 }
 private async document(tx:any,task:any):Promise<ElectronicProviderDocument>{
  assertElectronicTaskSnapshot(task);const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId}}),layout=version?.scopeSnapshot?.electronicDocument;
  ensure(layout&&typeof layout.title==='string'&&layout.positions,409,'ELECTRONIC_SIGNATURE_POSITIONS','本版文档签署位置尚未准备');return{...layout,providerContractId:task.providerContractId,sourceSha256:task.sourceSha256};
 }
 private async refreshPending(tx:any,task:any){
  const parties=await this.identities(tx,task.archiveVersionId,this.now(),task.parties.filter((p:any)=>p.status==='SIGNED').map((p:any)=>p.identitySnapshot)),anyAttempt=task.parties.some((p:any)=>p.attemptedAt),snapshot=assertElectronicTaskSnapshot(task);
  const modes=anyAttempt?null:selectSigningModes(parties,this.now(),snapshot.context);
  for(const row of task.parties){
   const live=parties.find(p=>p.role===row.role);ensure(live&&canonicalHash(frozenParty({...live,transactionId:row.transactionId}))===canonicalHash(frozenParty(row)),409,'ELECTRONIC_IDENTITY_CHANGED','冻结合同的实名、证书或印章已变化，请核对原签署任务');
   if(!row.attemptedAt){const mode=modes?.modes[row.role as SignerRole]??row.mode;await tx.electronicSigningParty.update({where:{id:row.id},data:{mode,identitySnapshot:JSON.parse(JSON.stringify(live)),authorityEvidenceHash:mode==='AUTO'?canonicalHash(live.autoAuthority):null}});}
  }
  return lockElectronicTask(tx,task.id);
 }
 private view(task:any){
  const action=nextSigningAction(electronicTaskFacts(task),this.now());return{id:task.id,archiveVersionId:task.archiveVersionId,orderId:task.orderId,kind:task.kind,status:task.status,revision:task.revision,sourceSha256:task.sourceSha256,executionMode:'ESIGN',parties:task.parties.map((p:any)=>({role:p.role,subjectType:p.subjectType,mode:p.mode,status:p.status,signedAt:p.verifiedAt})),nextAction:action,lastErrorCode:task.lastErrorCode,archivedAt:task.archivedAt,finalFileAvailable:task.status==='ARCHIVED'&&!!task.finalFileId};
 }
 async detail(actor:ElectronicActor,id:string){const task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true}});ensure(task,404,'NOT_FOUND','电子合同不存在');await this.access(this.db,actor,task);return this.view(task);}
 async list(actor:ElectronicActor,orderId?:string){
  let where:any={retiredAt:null,...(orderId?{orderId}:{})};if(actor.kind==='CUSTOMER')where.customerId=actor.id;else if(actor.kind==='OWNER'){ensure(actor.ownerId,404,'NOT_FOUND','企业不存在');await this.ownerActor(this.db,actor.id,actor.ownerId);where.OR=[{ownerId:actor.ownerId},{platformSubjectId:actor.ownerId}];}else await this.access(this.db,actor,{parties:[]});
  return{items:(await this.db.electronicSigningTask.findMany({where,include:{parties:true},orderBy:{createdAt:'desc'},take:100})).map(t=>this.view(t))};
 }
 private async acknowledge(actor:ElectronicActor,id:string,input:z.infer<typeof command>,action:string,fn?:(tx:any,task:any)=>Promise<any>){
  return this.db.serial(async tx=>{const task=await lockElectronicTask(tx,id);await this.access(tx,actor,task,actor.kind==='ADMIN');return archiveCommand(tx,{id:actor.id,role:actor.kind},id,'ELECTRONIC_'+action,input,async()=>{ensure(task.revision===input.revision,409,'VERSION_CONFLICT','合同状态已变化，请刷新');await this.business(tx,task);const result=fn?await fn(tx,task):{accepted:true};await audit(tx,actor.id,'ELECTRONIC_'+action,'electronic-documents',id,{sourceSha256:task.sourceSha256,revision:input.revision},actor.kind);return result;});});
 }
 async start(actor:ElectronicActor,id:string,raw:unknown){ensure(actor.kind==='ADMIN',403,'FORBIDDEN','请由运营发起电子合同');await this.acknowledge(actor,id,command.parse(raw),'START');await this.advance(id);return this.detail(actor,id);}
 async sign(actor:ElectronicActor,id:string,raw:unknown){
  ensure(actor.kind!=='ADMIN',403,'ELECTRONIC_PERSONAL_SIGNER_REQUIRED','后台审核权限不能代替当事人本人签署');const input=signCommand.parse(raw);
  const accepted=await this.acknowledge(actor,id,input,'CONSENT',async(tx,original)=>{
   const task=await this.refreshPending(tx,original),access=await this.access(tx,actor,task),role=access.role as SignerRole,party=task.parties.find((p:any)=>p.role===role),action=nextSigningAction(electronicTaskFacts(task),this.now());
   ensure(input.sourceSha256===task.sourceSha256,409,'ELECTRONIC_SOURCE_CHANGED','阅读确认的文件版本已变化');
   ensure(party?.mode==='MANUAL'&&((action.kind==='SIGN'||action.kind==='QUERY')&&action.role===role),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','尚未轮到本方签署或本方已经完成');
   if(!party.attemptedAt){const consent={version:1,taskId:id,role,actorId:actor.id,sourceSha256:task.sourceSha256,businessHash:task.businessHash,identityHash:party.identityHash,acceptedAt:this.now().toISOString()};await tx.electronicSigningParty.update({where:{id:party.id},data:{manualConsent:consent,manualConsentHash:canonicalHash(consent)}});await reserveElectronicOperation(tx,{taskId:id,revision:task.revision,kind:'SIGN',role,now:this.now()});}
   return{role};
  });
  // Reopening a manual page reuses the original transaction; it never creates a second signing attempt.
  const entry=await this.db.$transaction(async tx=>{const task=await lockElectronicTask(tx,id);await this.business(tx,task);await this.access(tx,actor,task);await this.refreshPending(tx,task);const p=task.parties.find((p:any)=>p.role===accepted.role),consent=p?.manualConsent;
   ensure(p&&p.mode==='MANUAL'&&p.attemptedAt&&p.status==='ISSUED'&&consent?.actorId===actor.id&&p.manualConsentHash===canonicalHash(consent)&&consent.sourceSha256===task.sourceSha256,409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','本方签署入口不可用');
   const entry=await this.provider.manualUrl(await this.document(tx,task),p,actor.kind==='CUSTOMER'?'MINIAPP':'OWNER_H5');
   await tx.electronicSigningTask.update({where:{id},data:{processingToken:null,processingUntil:null}});return entry;
  },{isolationLevel:'ReadCommitted',timeout:45000});return{...entry,document:await this.detail(actor,id)};
 }
 async sync(actor:ElectronicActor,id:string,raw:unknown){await this.acknowledge(actor,id,command.parse(raw),'SYNC');await this.advance(id);return this.detail(actor,id);}
 async withdraw(actor:ElectronicActor,id:string,raw:unknown){ensure(actor.kind==='ADMIN',403,'FORBIDDEN','仅运营可撤回未生效电子合同');const input=withdrawCommand.parse(raw);await this.acknowledge(actor,id,input,'WITHDRAW',async(tx,task)=>{ensure(task.status!=='ARCHIVED',409,'ELECTRONIC_ALREADY_ARCHIVED','已归档合同须通过相应变更或终止协议办理');await tx.electronicSigningTask.update({where:{id},data:{status:'WITHDRAWN',withdrawnAt:this.now(),revision:{increment:1},processingToken:null,processingUntil:null}});return{withdrawn:true};});return this.detail(actor,id);}
 private async markError(taskId:string,operationId:string|undefined,kind:string,error:unknown){
  const code=(error as any)?.getResponse?.()?.error?.code;await this.db.serial(async tx=>{const task=await lockElectronicTask(tx,taskId);if(inactive(task))return;const data:any={lastErrorCode:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/.test(code)?code:'ELECTRONIC_PROVIDER_UNCONFIRMED',processingToken:null,processingUntil:null,revision:{increment:1}};if(kind==='UPLOAD'&&task.uploadStatus!=='UPLOADED')data.uploadStatus='UNKNOWN';if(kind==='FILE'&&task.filingStatus!=='CONFIRMED')data.filingStatus='UNKNOWN';await tx.electronicSigningTask.update({where:{id:taskId},data});if(operationId)await tx.electronicSigningOperation.updateMany({where:{id:operationId,status:{not:'CONFIRMED'}},data:{status:code==='ELECTRONIC_PROVIDER_REJECTED'?'FAILED':'UNKNOWN',errorCode:data.lastErrorCode,...(electronicHash((error as any)?.providerEvidenceHash)?{responseHash:(error as any).providerEvidenceHash}:{}),settledAt:this.now()}});});
 }
 private async reserve(id:string,kind:'UPLOAD'|'SIGN'|'FILE'|'DOWNLOAD',role?:SignerRole){return this.db.serial(async tx=>{let task=await lockElectronicTask(tx,id);await this.business(tx,task);if(kind==='UPLOAD'||kind==='SIGN')task=await this.refreshPending(tx,task);return reserveElectronicOperation(tx,{taskId:id,revision:task.revision,kind,role,now:this.now()});});}
 private async dispatch(id:string,kind:'UPLOAD'|'SIGN'|'FILE'|'DOWNLOAD',role?:SignerRole){
  const reserved=await this.reserve(id,kind,role);if(!reserved.dispatchRequired&&kind!=='DOWNLOAD')return false;
  try{
   await this.db.$transaction(async tx=>{
    const task=await lockElectronicTask(tx,id);await this.business(tx,task);const operation=await tx.electronicSigningOperation.findUniqueOrThrow({where:{id:reserved.operation.id}});if(operation.status==='CONFIRMED')return;
    ensure(task.processingToken===operation.token||kind==='DOWNLOAD'&&!task.processingToken,409,'ELECTRONIC_PROCESSING','合同正在由另一请求办理');
    const doc=await this.document(tx,task),now=this.now();let responseHash:string;
    if(kind==='UPLOAD'){
     await this.refreshPending(tx,task);const source=await this.writer.readVerified(task.sourceFileId,task.sourceSha256),result=await this.provider.upload(doc,source);responseHash=result.evidenceHash;
     await tx.electronicSigningTask.update({where:{id},data:{uploadStatus:'UPLOADED',uploadedAt:now,uploadEvidenceHash:responseHash}});
    }else if(kind==='SIGN'){
     const party=task.parties.find((p:any)=>p.role===role);ensure(party?.mode==='AUTO'&&party.status==='UNKNOWN',409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','当前任务不允许自动签署');
     // Immutable intent already exists. Re-check live identity and grant before the one external dispatch.
     const live=await this.identities(tx,task.archiveVersionId,now,task.parties.filter((p:any)=>p.status==='SIGNED').map((p:any)=>p.identitySnapshot)),facts=electronicTaskFacts(task),p=live.find(p=>p.role===role);
     ensure(p&&canonicalHash(frozenParty({...p,transactionId:party.transactionId}))===canonicalHash(frozenParty(party)),409,'ELECTRONIC_IDENTITY_CHANGED','签署主体已变化');
     facts.parties=facts.parties.map(row=>row.role===role?{...p,...row,certificate:p.certificate,autoAuthority:p.autoAuthority,status:'PENDING'}:row);
     const action=nextSigningAction(facts,now);ensure(action.kind==='SIGN'&&action.role===role&&action.mode==='AUTO',409,'ELECTRONIC_AUTO_AUTHORITY_REQUIRED','自动签权限已变化，请核对原任务');responseHash=(await this.provider.autoSign(doc,party)).evidenceHash;
    }else if(kind==='FILE'){
     ensure(task.parties.every((p:any)=>p.status==='SIGNED'&&p.queryEvidenceHash),409,'ELECTRONIC_SIGNATURES_REQUIRED','各方签署尚未核验完成');responseHash=(await this.provider.fileContract(doc)).evidenceHash;
     await tx.electronicSigningTask.update({where:{id},data:{filingStatus:'CONFIRMED',filedAt:now,filingEvidenceHash:responseHash,status:'ARCHIVING'}});
    }else{
     ensure(task.filingStatus==='CONFIRMED'&&task.parties.every((p:any)=>p.status==='SIGNED'),409,'ELECTRONIC_ARCHIVE_REQUIRED','签署及法大大归档尚未齐备');
     if(!task.finalFileId){const result=await this.provider.downloadFinal(doc),file=await this.writer.persistPdf(result.bytes,{customerId:task.customerId,name:doc.title+'（电子签署版）.pdf',purpose:'electronic-signed'},tx);
      ensure(file.sha256!==task.sourceSha256,409,'ELECTRONIC_FINAL_PDF_REQUIRED','签后文件仍为待签原件');await tx.electronicSigningTask.update({where:{id},data:{finalFileId:file.id,finalSha256:file.sha256}});responseHash=file.sha256;
     }else{await this.writer.readVerified(task.finalFileId,task.finalSha256);responseHash=task.finalSha256;}
     await finalizeElectronicArchive(tx,id,this.now());if(this.options.afterArchive)await this.options.afterArchive(tx,await lockElectronicTask(tx,id));
    }
    ensure(electronicHash(responseHash),502,'ELECTRONIC_PROVIDER_UNCONFIRMED','渠道结果缺少核验摘要');await tx.electronicSigningOperation.update({where:{id:operation.id},data:{status:'CONFIRMED',responseHash,settledAt:this.now(),errorCode:null}});
    await tx.electronicSigningTask.update({where:{id},data:{processingToken:null,processingUntil:null,lastErrorCode:null,revision:{increment:1}}});
   },{isolationLevel:'ReadCommitted',timeout:45000});return true;
  }catch(error){await this.markError(id,reserved.operation.id,kind,error);return false;}
 }
 private async query(id:string,kind:'QUERY_UPLOAD'|'QUERY_FILING'|'QUERY',role?:SignerRole){
  try{return await this.db.$transaction(async tx=>{
   const task=await lockElectronicTask(tx,id);await this.business(tx,task);const doc=await this.document(tx,task),now=this.now();
   if(kind==='QUERY_UPLOAD'){
    if(task.uploadStatus==='UPLOADED')return true;ensure(['REQUESTED','UNKNOWN'].includes(task.uploadStatus),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','当前无需查询上传');const result=await this.provider.queryUpload(doc);
    ensure(result.uploaded&&electronicHash(result.evidenceHash),502,'ELECTRONIC_UPLOAD_UNCONFIRMED','上传尚未核验');await tx.electronicSigningTask.update({where:{id},data:{uploadStatus:'UPLOADED',uploadedAt:now,uploadEvidenceHash:result.evidenceHash}});
    await tx.electronicSigningOperation.updateMany({where:{taskId:id,kind:'UPLOAD'},data:{status:'CONFIRMED',responseHash:result.evidenceHash,settledAt:now}});
   }else if(kind==='QUERY_FILING'){
    if(task.filingStatus==='CONFIRMED')return true;ensure(task.parties.every((p:any)=>p.status==='SIGNED'),409,'ELECTRONIC_SIGNATURES_REQUIRED','各方签署未完成');const result=await this.provider.queryFiling(doc);if(!result.filed){
     const original=await tx.electronicSigningOperation.findFirst({where:{taskId:id,kind:'FILE'},orderBy:{requestedAt:'desc'}});
     if(original?.status!=='FAILED'||original.errorCode!=='ELECTRONIC_PROVIDER_REJECTED'||!electronicHash(result.evidenceHash))return false;
     await audit(tx,'SYSTEM','ELECTRONIC_FILING_RETRY_CONFIRMED','electronic-documents',id,{operationId:original.id,queryEvidenceHash:result.evidenceHash},'SYSTEM');
     await tx.electronicSigningTask.update({where:{id},data:{filingStatus:'NOT_STARTED',status:'SIGNED',lastErrorCode:'ELECTRONIC_FILING_RETRYABLE',processingToken:null,processingUntil:null,revision:{increment:1}}});return true;
    }
    ensure(electronicHash(result.evidenceHash),502,'ELECTRONIC_PROVIDER_UNCONFIRMED','归档查询尚未核验');await tx.electronicSigningTask.update({where:{id},data:{filingStatus:'CONFIRMED',filedAt:now,filingEvidenceHash:result.evidenceHash,status:'ARCHIVING'}});
    await tx.electronicSigningOperation.updateMany({where:{taskId:id,kind:'FILE'},data:{status:'CONFIRMED',responseHash:result.evidenceHash,settledAt:now}});
   }else{
    const party=task.parties.find((p:any)=>p.role===role);if(party?.status==='SIGNED')return true;ensure(party?.attemptedAt&&['ISSUED','UNKNOWN'].includes(party.status),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','原签署请求不存在');const result=await this.provider.querySigner(doc,party);if(result.status!=='SIGNED')return false;
    ensure(electronicHash(result.evidenceHash),502,'ELECTRONIC_SIGNER_UNCONFIRMED','本人签署查询尚未核验');await tx.electronicSigningParty.update({where:{id:party.id},data:{status:'SIGNED',verifiedAt:now,queryEvidenceHash:result.evidenceHash}});
    await tx.electronicSigningOperation.updateMany({where:{taskId:id,partyId:party.id,kind:'SIGN'},data:{status:'CONFIRMED',responseHash:result.evidenceHash,settledAt:now}});
   }
   await tx.electronicSigningTask.update({where:{id},data:{processingToken:null,processingUntil:null,lastErrorCode:null,revision:{increment:1}}});return true;
  },{isolationLevel:'ReadCommitted',timeout:45000});}catch(error){await this.markError(id,undefined,kind,error);return false;}
 }
 async advance(id:string){
  for(let step=0;step<10;step++){
   let task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true}});if(!task||inactive(task)||task.status==='ARCHIVED')return;
   if(task.processingToken&&task.processingUntil&&task.processingUntil>this.now())return;
   let action=nextSigningAction(electronicTaskFacts(task),this.now());
   if(action.kind==='SIGN'&&action.mode==='AUTO'||action.kind==='BLOCKED'&&['ELECTRONIC_AUTO_AUTHORITY_REQUIRED','ELECTRONIC_IDENTITY_REQUIRED'].includes(action.code)){
    try{if(this.options.refreshAuthorities)await this.options.refreshAuthorities(task);task=await this.db.serial(async tx=>{const current=await lockElectronicTask(tx,id);await this.business(tx,current);return this.refreshPending(tx,current);});action=nextSigningAction(electronicTaskFacts(task),this.now());}
    catch(error){await this.markError(id,undefined,'READINESS',error);return;}
   }
   let progressed=false;
   if(action.kind==='UPLOAD')progressed=await this.dispatch(id,'UPLOAD');else if(action.kind==='QUERY_UPLOAD'||action.kind==='QUERY_FILING')progressed=await this.query(id,action.kind);else if(action.kind==='QUERY')progressed=await this.query(id,'QUERY',action.role);else if(action.kind==='SIGN'&&action.mode==='AUTO')progressed=await this.dispatch(id,'SIGN',action.role);else if(action.kind==='FILE')progressed=await this.dispatch(id,'FILE');else if(action.kind==='ARCHIVE')progressed=await this.dispatch(id,'DOWNLOAD');
   if(!progressed){if(action.kind==='SIGN'&&action.mode==='MANUAL')await this.notifyWaiting(id,action.role);return;}
  }
 }
 private async notifyWaiting(id:string,role:SignerRole){
  await this.db.serial(async tx=>{
   const task=await lockElectronicTask(tx,id);if(inactive(task))return;const action=nextSigningAction(electronicTaskFacts(task),this.now());if(action.kind!=='SIGN'||action.role!==role||action.mode!=='MANUAL')return;
   const party=task.parties.find((p:any)=>p.role===role),recipient=role==='CUSTOMER'?task.customerId:(await tx.ownerESignAccount.findUnique({where:{ownerId:party.subjectId}}))?.managerCustomerId;if(!recipient)return;
   await archiveCommand(tx,{id:'SYSTEM',role:'SYSTEM'},id,'ELECTRONIC_SIGNING_NOTICE',{idempotencyKey:role},async()=>{const notice=await tx.notification.create({data:{customerId:recipient,title:'宁达订阅：合同待您签署',content:'请登录宁达对应入口，阅读合同全文并由本人确认签署。',resourceType:'ELECTRONIC_DOCUMENT',resourceId:id}});return{notificationId:notice.id};});
  });
 }
 async callback(raw:unknown,config:{appId:string;appSecret:string}){
  const event=verifiedCallback(raw,config),party=await this.db.electronicSigningParty.findUnique({where:{transactionId:event.transactionId},include:{task:true}});
  ensure(party&&party.attemptedAt&&event.providerContractId===party.task.providerContractId&&(!event.record.customer_id||event.record.customer_id===party.providerCustomerId),409,'ELECTRONIC_CALLBACK_BINDING','签署回调与原始请求不匹配');
  const eventId=canonicalHash(event.record);await this.db.providerEvent.upsert({where:{provider_eventId:{provider:'FADADA_ELECTRONIC',eventId}},create:{provider:'FADADA_ELECTRONIC',eventId,resourceId:party.taskId,payloadHash:eventId,status:inactive(party.task)?'RETIRED_PENDING_QUERY':'PENDING_QUERY'},update:{}});
  if(!inactive(party.task))await this.advance(party.taskId);
  else await this.db.$transaction(async tx=>{
   const task=await lockElectronicTask(tx,party.taskId),original=task.parties.find((p:any)=>p.id===party.id);if(original?.status==='SIGNED')return;
   ensure(inactive(task)&&original?.attemptedAt&&['UNKNOWN','ISSUED'].includes(original.status),409,'ELECTRONIC_CALLBACK_BINDING','已关闭任务缺少原签署请求');
   const result=await this.provider.querySigner(await this.document(tx,task),original);
   if(result.status==='SIGNED'&&electronicHash(result.evidenceHash)){await tx.electronicSigningParty.update({where:{id:original.id},data:{status:'SIGNED',verifiedAt:this.now(),queryEvidenceHash:result.evidenceHash}});await tx.electronicSigningOperation.updateMany({where:{taskId:task.id,partyId:original.id,kind:'SIGN'},data:{status:'CONFIRMED',responseHash:result.evidenceHash,settledAt:this.now()}});}
  },{isolationLevel:'ReadCommitted',timeout:45000});
  const result=await this.db.electronicSigningParty.findUniqueOrThrow({where:{id:party.id}});if(result.status==='SIGNED')await this.db.providerEvent.update({where:{provider_eventId:{provider:'FADADA_ELECTRONIC',eventId}},data:{status:inactive(party.task)?'RETIRED_VERIFIED':'VERIFIED'}});
  // A provider callback is only a reconciliation hint, never proof of signing or a new business instruction.
  return{accepted:true};
 }
 async file(actor:ElectronicActor,id:string,variant:'source'|'signed'){
  const task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true}});ensure(task,404,'NOT_FOUND','电子合同不存在');await this.access(this.db,actor,task);
  const fileId=variant==='source'?task.sourceFileId:task.status==='ARCHIVED'?task.finalFileId:null,hash=variant==='source'?task.sourceSha256:task.finalSha256;
  ensure(fileId&&hash,409,'ELECTRONIC_ARCHIVE_REQUIRED','签后文件尚未归档');const row=await this.db.storedFile.findUniqueOrThrow({where:{id:fileId}});return{bytes:await this.writer.readVerified(fileId,hash),name:row.name};
 }
}
