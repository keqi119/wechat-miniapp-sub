import {assertVirtualOrder} from '../virtual-acceptance/quotes';
import {runBoundElectronicOperation,newOrderContractMode} from '../offline-documents/mode';
import {requireCurrentVirtualScope} from '../virtual-acceptance/scope';
import {readContractWorkspace} from './workspace';
import {requireOwnerLegalRepresentative} from '../owner-h5/legal-representative';
import {activateTermination06} from '../orders/termination';
import {activateCancellation04} from '../orders/cancellation04';
import {confirmV31Authority,reviewV31Authority,switchV31Authority,listV31Authorities} from './authority-commands';
import {assertGrantSourcesCurrent} from './seal-authorization';
import {hasActualSigningEvidence,signingEvidenceUpdate} from './signing-evidence';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,key,hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {archiveCommand} from '../offline-documents/command';
import {ContractPdfArtifactWriterService} from '../contract/contract-pdf-artifact-writer.service';
import {verifiedCallback} from '../esign/fadada/fadada-safety';
import {electronicAccess,ElectronicActor} from './access';
import {resolveSigningParties,requireElectronicOwnerActor} from './identities';
import {assertElectronicTaskSnapshot,electronicTaskFacts,frozenParty,lockElectronicTask,reserveElectronicOperation} from './repository';
import {electronicHash,electronicAutoAuthorityReady,nextSigningAction,selectSigningModes} from './policy';
import {finalizeElectronicArchive,captureStoppedSigningEvidence,proofFor} from './archive';
import {ElectronicProvider,ElectronicProviderDocument} from './provider';
import {assertElectronicCooperationCurrent} from './cooperation';
import {prepareElectronicDocument} from './prepare';
import {assertV31PreparationCurrent} from '../contract-terms/preparation';
import type {SignerRole,SigningPartyInput} from './types';

const command=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict();
const signCommand=command.extend({sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),accepted:z.literal(true)});
const withdrawCommand=command.extend({reason:z.string().trim().min(2).max(1000)});
const inactive=(task:any)=>!!task.retiredAt||!!task.withdrawnAt||['RETIRED','WITHDRAWN','DECLINED','EXPIRED'].includes(task.status);
type Options={resolveParties?:typeof resolveSigningParties;requireOwnerActor?:typeof requireElectronicOwnerActor;refreshAuthorities?:(task:any)=>Promise<void>;afterArchive?:(tx:any,task:any)=>Promise<void>;clock?:()=>Date};
export class ElectronicDocumentService{
 private identities:typeof resolveSigningParties;private ownerActor:typeof requireElectronicOwnerActor;private now:()=>Date;
 constructor(private db:Db,private provider:ElectronicProvider,private writer:ContractPdfArtifactWriterService,private options:Options={}){this.identities=options.resolveParties??resolveSigningParties;this.ownerActor=options.requireOwnerActor??requireElectronicOwnerActor;this.now=options.clock??(()=>new Date());}
 private async access(tx:any,actor:ElectronicActor,task:any,write=false,historical=false){return electronicAccess(tx,actor,task,write,historical?(this.options.requireOwnerActor??requireOwnerLegalRepresentative):this.ownerActor);}
 private async business(tx:any,task:any,checkLiveSources=false){
  ensure(!inactive(task),409,'ELECTRONIC_TASK_CLOSED','本版合同已停止办理');
  const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId},include:{archive:true}}),latest=await tx.archiveVersion.findFirst({where:{archiveId:version?.archiveId||''},orderBy:{version:'desc'},select:{id:true}});
  ensure(version?.executionMode==='ELECTRONIC'&&!version.invalidatedAt&&version.businessSnapshotHash===task.businessHash&&version.sourceFileId===task.sourceFileId&&(!checkLiveSources||latest?.id===version.id),409,'ELECTRONIC_BUSINESS_CHANGED','业务文件已变化，请核对最新版本');
  if(checkLiveSources){
   if(newOrderContractMode()==='OFFLINE'){
    const frozen=version.scopeSnapshot?.v31Sources?.snapshot?.virtualAcceptance,scope=frozen?.scopeId?await tx.virtualAcceptanceScope.findUnique({where:{id:frozen.scopeId},include:{vehicle:true}}):null;
    ensure(scope?.vehicle&&scope.configurationHash===frozen.configurationHash,403,'ESIGN_INITIATION_DISABLED','普通线下业务不开放新的电子签动作');
    await requireCurrentVirtualScope(tx,{vehicleId:scope.vehicle.id,...(task.orderId?{orderId:task.orderId,customerId:task.customerId}:{}),action:'SIGNING'});
   }
   for(const fact of [...(version.scopeSnapshot?.vehicleFacts??[])].sort((a:any,b:any)=>a.id.localeCompare(b.id)))await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${fact.id} FOR UPDATE`;
   for(const ownerId of [...new Set<string>([task.ownerId,task.platformSubjectId])].sort())await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${ownerId} FOR UPDATE`;
   if(task.sealGrantId){const grant=await tx.electronicSealGrant.findUnique({where:{id:task.sealGrantId}});ensure(grant&&!grant.revokedAt,409,'V31_GRANT_REVOKED','独立授权已撤销，停止新的签署动作');}
  }
  if(checkLiveSources&&version.scopeSnapshot?.v31Sources){
   if(task.sealGrantId)await assertGrantSourcesCurrent(tx,version.scopeSnapshot.v31Sources);else await assertV31PreparationCurrent(tx,version.scopeSnapshot.v31Sources);
   const template=await tx.legalDocument.findUnique({where:{id:version.templateId}});
   ensure(template?.status==='PUBLISHED'&&template.confirmedBy&&template.confirmedAt&&template.version===version.templateVersion&&hash(template.content)===version.scopeSnapshot.templateHash,409,'V31_TEMPLATE_CHANGED','本次冻结正文已变化或停止启用');
  }
  if(checkLiveSources&&task.orderId){await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${task.orderId} FOR UPDATE`;const order=await tx.order.findUnique({where:{id:task.orderId}});if(order)await assertVirtualOrder(tx,order);ensure(order&&order.contractMode==='ELECTRONIC'&&order.customerId===task.customerId&&(task.kind==='PRE_DELIVERY_CANCELLATION'?order.status!=='RETIRED':!['CANCELLED','RETIRED'].includes(order.status)),409,'ELECTRONIC_BUSINESS_CHANGED','原订单已停止或归属发生变化');}
  if(checkLiveSources&&task.cooperationVersionId)await assertElectronicCooperationCurrent(tx,task.cooperationVersionId,task.businessHash,true);
  const facts=version.scopeSnapshot?.vehicleFacts;if(checkLiveSources&&Array.isArray(facts))for(const fact of facts){const current=await tx.vehicle.findUnique({where:{id:fact.id}});ensure(current&&current.vin===fact.vin&&current.plateNumber===fact.plateNumber,409,'ELECTRONIC_VEHICLE_CHANGED','协议中的车辆标识已变化，请核对原版本');}
  return version;
 }
 private async document(tx:any,task:any):Promise<ElectronicProviderDocument>{
  assertElectronicTaskSnapshot(task);const version=await tx.archiveVersion.findUnique({where:{id:task.archiveVersionId}}),layout=version?.scopeSnapshot?.electronicDocument;
  ensure(layout&&typeof layout.title==='string'&&layout.positions,409,'ELECTRONIC_SIGNATURE_POSITIONS','本版文档签署位置尚未准备');return{...layout,providerContractId:task.providerContractId,sourceSha256:task.sourceSha256};
 }
 private newOperation<T>(tx:any,task:any,operation:()=>Promise<T>){return runBoundElectronicOperation(async()=>{await this.business(tx,task,true);},operation);}
 private async currentEnterpriseAutomation(tx:any,task:any,now:Date){
  const context=assertElectronicTaskSnapshot(task).context;if(process.env.OWNER_AUTO_SIGNING_ENABLED==='false'||context.signaturePolicy==='MANUAL_ONLY'||context.kind==='COOPERATION_GRANT')return false;
  // Historical identity/proof is immutable. A completed enterprise still needs CURRENT
  // business/channel permission before another enterprise may automatically sign.
  const completedIndividuals=task.parties.filter((p:any)=>p.status==='SIGNED'&&p.subjectType!=='ENTERPRISE').map((p:any)=>p.identitySnapshot);
  try{
   const current=await this.identities(tx,task.archiveVersionId,now,completedIndividuals),companies=current.filter(p=>p.subjectType==='ENTERPRISE'&&(!context.kind.startsWith('COOPERATION')||p.role==='PLATFORM'));
   if(context.kind!=='SUBSCRIPTION'&&companies.some(p=>p.autoAuthority?.policyVersion!==3))return false;
   return companies.length>0&&companies.every(p=>{
    const original=task.parties.find((row:any)=>row.role===p.role);
    return original&&canonicalHash(frozenParty({...p,transactionId:original.transactionId}))===canonicalHash(frozenParty(original))&&electronicAutoAuthorityReady(p,context,now);
   });
  }catch{return false;} // Current authority/identity failure makes unissued enterprises manual, never rewrites old proof.
 }
 private async refreshPending(tx:any,task:any){
  const parties=await this.identities(tx,task.archiveVersionId,this.now(),task.parties.filter((p:any)=>p.status==='SIGNED').map((p:any)=>p.identitySnapshot)),anyAttempt=task.parties.some((p:any)=>p.attemptedAt),snapshot=assertElectronicTaskSnapshot(task);
  const automatic=anyAttempt?await this.currentEnterpriseAutomation(tx,task,this.now()):false;
  const modes=anyAttempt?null:selectSigningModes(parties,this.now(),snapshot.context);
  for(const row of task.parties){
   const live=parties.find(p=>p.role===row.role);ensure(live&&canonicalHash(frozenParty({...live,transactionId:row.transactionId}))===canonicalHash(frozenParty(row)),409,'ELECTRONIC_IDENTITY_CHANGED','冻结合同的实名、证书或印章已变化，请核对原签署任务');
   if(!row.attemptedAt){const mode=modes?.modes[row.role as SignerRole]??(row.subjectType==='ENTERPRISE'&&!automatic?'MANUAL':row.mode);if(mode!==row.mode)await audit(tx,'SYSTEM','V31_PENDING_SIGNER_MODE_CHANGED','electronic-documents',task.id,{role:row.role,from:row.mode,to:mode},'SYSTEM');await tx.electronicSigningParty.update({where:{id:row.id},data:{mode,identitySnapshot:JSON.parse(JSON.stringify(live)),authorityEvidenceHash:mode==='AUTO'?canonicalHash(live.autoAuthority):null}});}
  }
  return lockElectronicTask(tx,task.id);
 }
 private view(task:any){
  const version=task.archiveVersion,sources=version?.scopeSnapshot?.v31Sources,refs=sources?.snapshot;
  const reference=(v:any)=>v?{id:v.id,version:v.version??null,revision:v.revision??null,hash:v.hash??null}:null;
  const frozenSources={hash:sources?.hash??null,context:sources?.context?{kind:sources.context.kind,resourceId:sources.context.resourceId,revision:sources.context.revision}:null,cooperationVersionId:task.snapshot?.context?.cooperationVersionId??null,cooperation:reference(refs?.cooperation),products:(refs?.products??[]).map(reference),templates:(refs?.templates??[]).map(reference),parties:Object.fromEntries(Object.entries(refs?.parties??{}).map(([role,value])=>[role,reference(value)]))};

  let action=nextSigningAction(electronicTaskFacts(task),this.now());if(task.sealGrant?.revokedAt&&['SIGN','UPLOAD'].includes(action.kind))action={kind:'BLOCKED',code:'V31_GRANT_REVOKED'};return{id:task.id,signaturePolicy:task.snapshot?.context?.signaturePolicy??null,signingPolicyLabel:task.snapshot?.context?.signaturePolicy==='MANUAL_ONLY'?'自动用印未启用（本轮逐份确认）':null,frozenSources,archive:version?{id:version.archiveId,versionId:version.id,version:version.version,contractNumber:version.contractNumber,status:version.status,templateId:version.templateId,templateVersion:version.templateVersion,originalFileManifestHash:version.fileManifestHash,invalidatedAt:version.invalidatedAt}:null,filingStatus:task.filingStatus,verifiedAt:task.parties.map((p:any)=>({role:p.role,verifiedAt:p.verifiedAt,evidenceCheckedAt:p.evidenceCheckedAt})),archiveVersionId:task.archiveVersionId,orderId:task.orderId,kind:task.kind,status:task.status,revision:task.revision,sourceSha256:task.sourceSha256,executionMode:'ESIGN',grant:task.sealGrant?{id:task.sealGrant.id,version:task.sealGrant.version,revision:task.sealGrant.revision,sourceHash:task.sealGrant.sourceHash,cooperationVersionId:task.sealGrant.cooperationVersionId,previousGrantId:task.sealGrant.previousGrantId,signedAt:task.sealGrant.signedAt,archivedAt:task.sealGrant.archivedAt,revokedAt:task.sealGrant.revokedAt}:null,parties:task.parties.map((p:any)=>({role:p.role,subjectType:p.subjectType,mode:p.mode,status:p.status,signedAt:p.providerSignedAt})),nextAction:action,lastErrorCode:task.lastErrorCode,archivedAt:task.archivedAt,stopStatus:task.stopStatus,evidenceReviewStatus:task.evidenceReviewStatus,legalCompletedAt:task.legalCompletedAt,finalFileAvailable:(task.status==='ARCHIVED'||!!task.stoppedEvidenceId)&&!!task.finalFileId};
 }
 confirmAuthority(actor:ElectronicActor,raw:unknown){return this.db.serial(tx=>confirmV31Authority(tx,actor,raw));}
 reviewAuthority(actor:ElectronicActor,id:string,raw:unknown){return this.db.serial(tx=>reviewV31Authority(tx,actor,id,raw));}
 switchAuthority(actor:ElectronicActor,id:string,raw:unknown){return this.db.serial(tx=>switchV31Authority(tx,actor,id,raw));}
 authorities(actor:ElectronicActor,ownerId:string){return listV31Authorities(this.db,actor,ownerId);}
 workspace(actor:ElectronicActor,orderId:string,_query:unknown={}){return this.db.serial(tx=>readContractWorkspace(tx,actor,orderId,this.provider.capability?.()??{configured:false,signingEnabled:false}));}
 async detail(actor:ElectronicActor,id:string){const task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});ensure(task,404,'NOT_FOUND','电子合同不存在');await this.access(this.db,actor,task,false,true);return this.view(task);}
 async prepare(actor:ElectronicActor,raw:unknown){ensure(actor.kind==='ADMIN',403,'FORBIDDEN','仅运营可准备电子协议');const result=await this.db.serial(tx=>prepareElectronicDocument(tx,raw,actor.id,this.writer));return this.detail(actor,result.taskId);}
 async list(actor:ElectronicActor,orderId?:string,paging:unknown={}){
  const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict().parse(paging);
  const where:any={...(orderId?{orderId}:{})};
  if(actor.kind==='CUSTOMER'){where.customerId=actor.id;where.parties={some:{role:'CUSTOMER',subjectId:actor.id}};}
  else if(actor.kind==='OWNER'){ensure(actor.ownerId,404,'NOT_FOUND','企业不存在');await requireOwnerLegalRepresentative(this.db,actor.id,actor.ownerId);where.OR=[{ownerId:actor.ownerId},{platformSubjectId:actor.ownerId}];}
  else await this.access(this.db,actor,{parties:[]});
  const [rows,total]=await Promise.all([this.db.electronicSigningTask.findMany({where,include:{parties:true,sealGrant:true,archiveVersion:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.pageSize,take:q.pageSize}),this.db.electronicSigningTask.count({where})]);
  return{items:rows.map(t=>this.view(t)),total,...q};
 }
 async dependencies(actor:ElectronicActor,id:string){
  const task:any=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});ensure(task,404,'NOT_FOUND');await this.access(this.db,actor,task,false,true);
  const versionIds:string[]=[task.archiveVersion?.scopeSnapshot?.originalArchiveVersionId].filter(Boolean);
  const cooperationId=task.snapshot?.context?.cooperationVersionId;
  if(cooperationId){const cooperation=await this.db.electronicSigningTask.findUnique({where:{cooperationVersionId:cooperationId}});if(cooperation)versionIds.push(cooperation.archiveVersionId);}
  for(const party of task.parties){const frozen=(party.identitySnapshot as any)?.autoAuthority;if(!frozen?.id)continue;
   const authority=await this.db.electronicAutoAuthority.findUnique({where:{id:frozen.id}});
   if(authority?.businessEvidenceHash!==frozen.businessEvidenceHash)continue;
   const grantId=(authority?.basis as any)?.grantId;if(!grantId)continue;
   const grant=await this.db.electronicSigningTask.findUnique({where:{sealGrantId:grantId}});if(grant)versionIds.push(grant.archiveVersionId);
  }
  const rows=await this.db.electronicSigningTask.findMany({where:{archiveVersionId:{in:versionIds}},include:{parties:true,sealGrant:true,archiveVersion:true},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const items=[];for(const row of rows){try{await this.access(this.db,actor,row,false,true);items.push(this.view(row));}catch(error){if(!(error as any)?.getStatus||![403,404].includes((error as any).getStatus()))throw error;}}
  return{items};
 }
 async dependency(actor:ElectronicActor,id:string,dependencyId:string){const {items}=await this.dependencies(actor,id);const item=items.find(t=>t.id===dependencyId);ensure(item,404,'NOT_FOUND','此文书未绑定该来源版本或当前身份无权读取');return item;}

 private async acknowledge(actor:ElectronicActor,id:string,input:z.infer<typeof command>,action:string,fn?:(tx:any,task:any)=>Promise<any>){
  return this.db.serial(async tx=>{const task=await lockElectronicTask(tx,id);await this.access(tx,actor,task,actor.kind==='ADMIN');return archiveCommand(tx,{id:actor.id,role:actor.kind},id,'ELECTRONIC_'+action,input,async()=>{ensure(task.revision===input.revision,409,'VERSION_CONFLICT','合同状态已变化，请刷新');if(action!=='WITHDRAW')await this.business(tx,task,['START','CONSENT','COOPERATION_ACCEPT'].includes(action));const result=fn?await fn(tx,task):{accepted:true};await audit(tx,actor.id,'ELECTRONIC_'+action,'electronic-documents',id,{sourceSha256:task.sourceSha256,revision:input.revision},actor.kind);return result;});});
 }
 async start(actor:ElectronicActor,id:string,raw:unknown){ensure(actor.kind==='ADMIN',403,'FORBIDDEN','请由运营发起电子合同');await this.acknowledge(actor,id,command.parse(raw),'START');await this.advance(id);return this.detail(actor,id);}
 async sign(actor:ElectronicActor,id:string,raw:unknown){
  ensure(actor.kind!=='ADMIN',403,'ELECTRONIC_PERSONAL_SIGNER_REQUIRED','后台审核权限不能代替当事人本人签署');const input=signCommand.parse(raw);
  if(this.options.refreshAuthorities){
   const task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});ensure(task,404,'NOT_FOUND');
   await this.access(this.db,actor,task);
   if((task.snapshot as any)?.context?.autoSigningPolicyVersion===3){await this.business(this.db,task,true);await this.options.refreshAuthorities(task);}
  }
  const accepted=await this.acknowledge(actor,id,input,'CONSENT',async(tx,original)=>{
   const task=await this.refreshPending(tx,original),access=await this.access(tx,actor,task),role=access.role as SignerRole,party=task.parties.find((p:any)=>p.role===role),action=nextSigningAction(electronicTaskFacts(task),this.now());
   ensure(input.sourceSha256===task.sourceSha256,409,'ELECTRONIC_SOURCE_CHANGED','阅读确认的文件版本已变化');
   ensure(party?.mode==='MANUAL'&&((action.kind==='SIGN'||action.kind==='QUERY')&&action.role===role),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','尚未轮到本方签署或本方已经完成');
   if(!party.attemptedAt){const consent={version:1,taskId:id,role,actorId:actor.id,sourceSha256:task.sourceSha256,businessHash:task.businessHash,identityHash:party.identityHash,acceptedAt:this.now().toISOString()};await tx.electronicSigningParty.update({where:{id:party.id},data:{manualConsent:consent,manualConsentHash:canonicalHash(consent)}});await reserveElectronicOperation(tx,{taskId:id,revision:task.revision,kind:'SIGN',role,now:this.now()});}
   return{role};
  });
  // Reopening a manual page reuses the original transaction; it never creates a second signing attempt.
  const entry=await this.db.$transaction(async tx=>{const task=await lockElectronicTask(tx,id);await this.business(tx,task,true);await this.access(tx,actor,task);await this.refreshPending(tx,task);const p=task.parties.find((p:any)=>p.role===accepted.role),consent=p?.manualConsent;
   ensure(p&&p.mode==='MANUAL'&&p.attemptedAt&&p.status==='ISSUED'&&consent?.actorId===actor.id&&p.manualConsentHash===canonicalHash(consent)&&consent.sourceSha256===task.sourceSha256,409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','本方签署入口不可用');
   const entry=await this.newOperation(tx,task,async()=>this.provider.manualUrl(await this.document(tx,task),p,actor.kind==='CUSTOMER'?'MINIAPP':'OWNER_H5'));
   await tx.electronicSigningTask.update({where:{id},data:{processingToken:null,processingUntil:null}});return entry;
  },{isolationLevel:'ReadCommitted',timeout:45000});return{...entry,document:await this.detail(actor,id)};
 }
 async sync(actor:ElectronicActor,id:string,raw:unknown){await this.acknowledge(actor,id,command.parse(raw),'SYNC');await this.advance(id);return this.detail(actor,id);}
 async acceptCooperation(actor:ElectronicActor,id:string,raw:unknown){
  ensure(actor.kind==='OWNER',403,'ELECTRONIC_PERSONAL_SIGNER_REQUIRED','合作协议须由登记本人确认');const input=signCommand.parse(raw);
  await this.acknowledge(actor,id,input,'COOPERATION_ACCEPT',async(tx,task)=>{
   const access=await this.access(tx,actor,task);ensure(task.kind.startsWith('COOPERATION')&&access.role==='OWNER'&&input.sourceSha256===task.sourceSha256&&task.uploadStatus==='UPLOADED',409,'ELECTRONIC_SOURCE_CHANGED','请阅读已准备的本版合作协议');
   const current=await this.refreshPending(tx,task),party=current.parties.find((p:any)=>p.role==='OWNER');ensure(party?.mode==='AUTO'&&party.status==='PENDING'&&!party.attemptedAt,409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','请按当前本方签署方式办理');
   const consent={version:1,taskId:id,role:'OWNER',actorId:actor.id,sourceSha256:task.sourceSha256,businessHash:task.businessHash,identityHash:party.identityHash,acceptedAt:this.now().toISOString()};
   if(!party.documentConsentHash)await tx.electronicSigningParty.update({where:{id:party.id},data:{documentConsent:consent,documentConsentHash:canonicalHash(consent)}});
   await tx.electronicSigningTask.update({where:{id},data:{revision:{increment:1}}});return{accepted:true};
  });await this.advance(id);return this.detail(actor,id);
 }
 async revokeGrant(actor:ElectronicActor,id:string,raw:unknown){
  ensure(actor.kind==='OWNER',403,'ELECTRONIC_PERSONAL_SIGNER_REQUIRED','独立授权须由授权企业登记本人撤销');
  const input=withdrawCommand.parse(raw);
  return this.db.serial(async tx=>{
   const task=await lockElectronicTask(tx,id);const access=await this.access(tx,actor,task);
   ensure(task.kind==='COOPERATION_GRANT'&&task.sealGrantId&&access.role==='OWNER',403,'FORBIDDEN','只能撤销本企业独立用印授权');
   await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id=${task.ownerId} FOR UPDATE`;
   return archiveCommand(tx,{id:actor.id,role:actor.kind},id,'ELECTRONIC_SEAL_GRANT_REVOKE',input,async()=>{
    ensure(task.revision===input.revision,409,'VERSION_CONFLICT','授权任务版本已变化');
    const grant=await tx.electronicSealGrant.findUniqueOrThrow({where:{id:task.sealGrantId!}});
    if(!grant.revokedAt)await tx.electronicSealGrant.update({where:{id:grant.id},data:{revokedAt:this.now(),revision:{increment:1}}});
    await audit(tx,actor.id,'ELECTRONIC_SEAL_GRANT_REVOKED','electronic-seal-grants',grant.id,{reason:input.reason,taskId:id},'OWNER');
    return{grantId:grant.id,revoked:true};
   });
  });
 }
 async withdraw(actor:ElectronicActor,id:string,raw:unknown){ensure(actor.kind==='ADMIN',403,'FORBIDDEN','仅运营可撤回未生效电子合同');const input=withdrawCommand.parse(raw);await this.acknowledge(actor,id,input,'WITHDRAW',async(tx,task)=>{ensure(task.status!=='ARCHIVED',409,'ELECTRONIC_ALREADY_ARCHIVED','已归档合同须通过相应变更或终止协议办理');await tx.electronicSigningTask.update({where:{id},data:{status:'WITHDRAWN',stopStatus:task.parties.some((p:any)=>p.attemptedAt)?'NEEDS_REVIEW':'STOPPED_LOCAL_ONLY',withdrawnAt:this.now(),revision:{increment:1},processingToken:null,processingUntil:null}});return{withdrawn:true};});try{await this.reconcileStopped(id);}catch{/* The durable stop remains in NEEDS_REVIEW; the bounded reconciler retries evidence. */}return this.detail(actor,id);}
 /** Internal command; HTTP callers use withdraw with RBAC, audit and idempotency. */
 async stopSigning(taskId:string,revision:number):Promise<'STOPPED_LOCAL_ONLY'|'PROVIDER_CLOSED'|'NEEDS_REVIEW'>{
  await this.db.serial(async tx=>{const task=await lockElectronicTask(tx,taskId);ensure(task.revision===revision,409,'VERSION_CONFLICT','合同版本已变化');ensure(task.status!=='ARCHIVED',409,'ELECTRONIC_ALREADY_ARCHIVED','已归档合同须另行办理');await tx.electronicSigningTask.update({where:{id:taskId},data:{status:'WITHDRAWN',withdrawnAt:task.withdrawnAt??this.now(),stopStatus:task.parties.some((p:any)=>p.attemptedAt)?'NEEDS_REVIEW':'STOPPED_LOCAL_ONLY',revision:{increment:1},processingToken:null,processingUntil:null}});});
  await this.reconcileStopped(taskId);return (await this.db.electronicSigningTask.findUniqueOrThrow({where:{id:taskId}})).stopStatus as any;
 }
 /** Query only an already attempted original transaction; commit its proof independently. */
 private async recoverOriginalParty(id:string,partyId:string){
  await this.db.$transaction(async tx=>{
   const task=await lockElectronicTask(tx,id),party=task.parties.find((v:any)=>v.id===partyId);if(hasActualSigningEvidence(party))return;
   ensure(party?.attemptedAt&&['ISSUED','UNKNOWN','SIGNED'].includes(party.status),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','原签署请求不存在');
   const result=await this.provider.querySigner(await this.document(tx,task),party);if(result.status!=='SIGNED')return;
   ensure(result.providerSignedAt&&electronicHash(result.evidenceHash),502,'ELECTRONIC_SIGNER_UNCONFIRMED','原交易实际签署证据缺失');
   await tx.electronicSigningParty.update({where:{id:party.id},data:signingEvidenceUpdate(party,result,this.now())});
   await tx.electronicSigningOperation.updateMany({where:{taskId:id,partyId:party.id,kind:'SIGN'},data:{status:'CONFIRMED',responseHash:result.evidenceHash,settledAt:this.now()}});
  },{isolationLevel:'ReadCommitted',timeout:45000});
 }
 async reconcileStopped(id:string){
  const initial=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});if(!initial||!inactive(initial)||initial.stoppedEvidenceId)return;
  // One unavailable original must not prevent retention of another party's trusted fact.
  for(const p of initial.parties.filter(p=>p.attemptedAt&&!hasActualSigningEvidence(p))){
   try{await this.recoverOriginalParty(id,p.id);}catch{/* Missing proof remains eligible for the durable recovery queue. */}
  }
  const current=await this.db.electronicSigningTask.findUniqueOrThrow({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});if(await this.originalCertificateReview(id))return;
  if(!current.parties.every(hasActualSigningEvidence))return;
  const filing=await this.db.serial(async tx=>{const task=await lockElectronicTask(tx,id);if(task.filingStatus==='CONFIRMED')return false;if(task.filingStatus!=='NOT_STARTED')return false;await tx.electronicSigningTask.update({where:{id},data:{filingStatus:'REQUESTED'}});return true;});
  // The persisted filing intent precedes dispatch. Unknown responses only query this contract.
  await this.db.$transaction(async tx=>{const task=await lockElectronicTask(tx,id);if(task.filingStatus==='CONFIRMED')return;const doc=await this.document(tx,task),result=filing?await this.provider.fileContract(doc):await this.provider.queryFiling(doc);if('filed' in result&&!result.filed)return;await tx.electronicSigningTask.update({where:{id},data:{filingStatus:'CONFIRMED',filedAt:this.now(),filingEvidenceHash:result.evidenceHash}});},{isolationLevel:'ReadCommitted',timeout:45000});
  const captured=await this.db.$transaction(async tx=>{let task=await lockElectronicTask(tx,id);if(task.stoppedEvidenceId||task.filingStatus!=='CONFIRMED')return;const doc=await this.document(tx,task);
   if(!task.finalFileId){await this.quarantineBudget(tx,id);const result=await this.provider.downloadFinal(doc),verified=await this.verifyOrQuarantine(tx,task,doc,result.bytes);if(verified.verificationRejected)return verified;const verification=verified.verification,file=await this.writer.persistPdf(result.bytes,{customerId:task.customerId,name:doc.title+'（签署证据）.pdf',purpose:'electronic-signed'},tx);await tx.electronicSigningTask.update({where:{id},data:{finalFileId:file.id,finalSha256:file.sha256,finalVerification:verification}});}
   task=await lockElectronicTask(tx,id);const proof=await proofFor(tx,task,this.now(),this.now());await captureStoppedSigningEvidence(tx,id,proof);
  },{isolationLevel:'ReadCommitted',timeout:45000});
  if(captured?.verificationRejected)throw captured.verificationRejected;
 }
 private async originalCertificateReview(id:string){
  return this.db.serial(async tx=>{const task=await lockElectronicTask(tx,id),missing=task.parties.filter((p:any)=>!electronicHash(frozenParty(p).certSubjectHash));if(!missing.length)return false;
   if(task.evidenceReviewStatus!=='ORIGINAL_CERTIFICATE_REQUIRED'){
    await tx.electronicSigningTask.update({where:{id},data:{evidenceReviewStatus:'ORIGINAL_CERTIFICATE_REQUIRED',lastErrorCode:'ELECTRONIC_ORIGINAL_CERTIFICATE_REQUIRED'}});
    await audit(tx,'SYSTEM','ELECTRONIC_ORIGINAL_CERTIFICATE_REQUIRED','electronic-documents',id,{roles:missing.map((p:any)=>p.role),originalBindingsHash:canonicalHash(missing.map((p:any)=>({customer:p.providerCustomerId,serial:p.certSerialNo})))},'SYSTEM');
   }return true;
  });
 }
 /** Startup repair also covers legacy/capped rows that will not download again. */
 async secureExistingQuarantineArtifacts(){
  let cursor:string|undefined;
  for(;;){const rows=await this.db.electronicFileQuarantine.findMany({orderBy:{id:'asc'},take:20,...(cursor?{cursor:{id:cursor},skip:1}:{})});if(!rows.length)return;for(const row of rows)await this.writer.readQuarantined(row.fileId,row.sha256);cursor=rows[rows.length-1].id;}
 }
 private async quarantineBudget(tx:any,taskId:string){
  ensure(await tx.electronicFileQuarantine.count({where:{taskId}})<3,409,'ELECTRONIC_QUARANTINE_REVIEW_REQUIRED','异常文件已达到隔离保全上限，请由运营核查原任务');
 }
 private async verifyOrQuarantine(tx:any,task:any,doc:ElectronicProviderDocument,bytes:Buffer):Promise<any>{
  try{return{verification:await this.provider.verifyFinalFile({...doc,parties:task.parties},bytes)};}catch(error){
   const sha256=createHash('sha256').update(bytes).digest('hex'),existing=await tx.electronicFileQuarantine.findUnique({where:{taskId_sha256:{taskId:task.id,sha256}}});
   if(existing)await this.writer.readQuarantined(existing.fileId,existing.sha256);
   if(!existing){
    await this.quarantineBudget(tx,task.id);
    const file=await this.writer.persistPdf(bytes,{customerId:null,name:'isolated-signing-evidence.pdf',purpose:'electronic-quarantine'},tx),candidate=(error as any)?.getResponse?.()?.error?.code;
    const rejectionCode=typeof candidate==='string'&&/^[A-Z0-9_]{1,100}$/.test(candidate)?candidate:'ELECTRONIC_FINAL_VERIFICATION_UNCONFIRMED',receipt=(error as any)?.verificationReceiptHash,checked=(error as any)?.verificationCheckedAt;
    await tx.electronicFileQuarantine.create({data:{taskId:task.id,archiveVersionId:task.archiveVersionId,providerContractId:task.providerContractId,sourceSha256:task.sourceSha256,snapshotHash:task.snapshotHash,fileId:file.id,sha256,rejectionCode,verificationReceiptHash:electronicHash(receipt)?receipt:null,checkedAt:typeof checked==='string'&&Number.isFinite(Date.parse(checked))?new Date(checked):this.now()}});
   }
   return{verificationRejected:error};
  }
 }
 private async markError(taskId:string,operationId:string|undefined,kind:string,error:unknown){
  const code=(error as any)?.getResponse?.()?.error?.code;await this.db.serial(async tx=>{const task=await lockElectronicTask(tx,taskId);if(inactive(task))return;const data:any={lastErrorCode:typeof code==='string'&&/^[A-Z0-9_]{1,100}$/.test(code)?code:'ELECTRONIC_PROVIDER_UNCONFIRMED',processingToken:null,processingUntil:null,revision:{increment:1}};if(kind==='UPLOAD'&&task.uploadStatus!=='UPLOADED')data.uploadStatus='UNKNOWN';if(kind==='FILE'&&task.filingStatus!=='CONFIRMED')data.filingStatus='UNKNOWN';await tx.electronicSigningTask.update({where:{id:taskId},data});if(operationId)await tx.electronicSigningOperation.updateMany({where:{id:operationId,status:{not:'CONFIRMED'}},data:{status:code==='ELECTRONIC_PROVIDER_REJECTED'?'FAILED':'UNKNOWN',errorCode:data.lastErrorCode,...(electronicHash((error as any)?.providerEvidenceHash)?{responseHash:(error as any).providerEvidenceHash}:{}),settledAt:this.now()}});});
 }
 private async reserve(id:string,kind:'UPLOAD'|'SIGN'|'FILE'|'DOWNLOAD',role?:SignerRole){return this.db.serial(async tx=>{let task=await lockElectronicTask(tx,id);await this.business(tx,task,kind==='UPLOAD'||kind==='SIGN');if(kind==='UPLOAD'||kind==='SIGN')task=await this.refreshPending(tx,task);return reserveElectronicOperation(tx,{taskId:id,revision:task.revision,kind,role,now:this.now()});});}
 private async dispatch(id:string,kind:'UPLOAD'|'SIGN'|'FILE'|'DOWNLOAD',role?:SignerRole){
  const reserved=await this.reserve(id,kind,role);if(!reserved.dispatchRequired&&kind!=='DOWNLOAD')return false;
  try{
   const completed=await this.db.$transaction(async tx=>{
    const task=await lockElectronicTask(tx,id);await this.business(tx,task,kind==='UPLOAD'||kind==='SIGN');const operation=await tx.electronicSigningOperation.findUniqueOrThrow({where:{id:reserved.operation.id}});if(operation.status==='CONFIRMED')return;
    ensure(task.processingToken===operation.token||kind==='DOWNLOAD'&&!task.processingToken,409,'ELECTRONIC_PROCESSING','合同正在由另一请求办理');
    const doc=await this.document(tx,task),now=this.now();let responseHash:string;
    if(kind==='UPLOAD'){
     await this.refreshPending(tx,task);const source=await this.writer.readVerified(task.sourceFileId,task.sourceSha256),result=await this.newOperation(tx,task,()=>this.provider.upload(doc,source));responseHash=result.evidenceHash;
     await tx.electronicSigningTask.update({where:{id},data:{uploadStatus:'UPLOADED',uploadedAt:now,uploadEvidenceHash:responseHash}});
    }else if(kind==='SIGN'){
     const party=task.parties.find((p:any)=>p.role===role);ensure(party?.mode==='AUTO'&&party.status==='UNKNOWN',409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','当前任务不允许自动签署');
     // Immutable intent already exists. Re-check BOTH enterprises under the shared locks.
     ensure(await this.currentEnterpriseAutomation(tx,task,now),409,'ELECTRONIC_AUTO_AUTHORITY_REQUIRED','任一企业当前授权不足，停止新的自动签署');
     const live=await this.identities(tx,task.archiveVersionId,now,task.parties.filter((p:any)=>p.status==='SIGNED').map((p:any)=>p.identitySnapshot)),facts=electronicTaskFacts(task),p=live.find(p=>p.role===role);
     ensure(p&&canonicalHash(frozenParty({...p,transactionId:party.transactionId}))===canonicalHash(frozenParty(party)),409,'ELECTRONIC_IDENTITY_CHANGED','签署主体已变化');
     facts.parties=facts.parties.map(row=>row.role===role?{...p,...row,certificate:p.certificate,autoAuthority:p.autoAuthority,status:'PENDING'}:row);
     const action=nextSigningAction(facts,now);ensure(action.kind==='SIGN'&&action.role===role&&action.mode==='AUTO',409,'ELECTRONIC_AUTO_AUTHORITY_REQUIRED','自动签权限已变化，请核对原任务');responseHash=(await this.newOperation(tx,task,()=>this.provider.autoSign(doc,party))).evidenceHash;
    }else if(kind==='FILE'){
     ensure(task.parties.every((p:any)=>p.status==='SIGNED'&&p.queryEvidenceHash),409,'ELECTRONIC_SIGNATURES_REQUIRED','各方签署尚未核验完成');responseHash=(await this.provider.fileContract(doc)).evidenceHash;
     await tx.electronicSigningTask.update({where:{id},data:{filingStatus:'CONFIRMED',filedAt:now,filingEvidenceHash:responseHash,status:'ARCHIVING'}});
    }else{
     ensure(task.filingStatus==='CONFIRMED'&&task.parties.every((p:any)=>p.status==='SIGNED'),409,'ELECTRONIC_ARCHIVE_REQUIRED','签署及法大大归档尚未齐备');
     if(!task.finalFileId){await this.quarantineBudget(tx,id);const result=await this.provider.downloadFinal(doc),verified=await this.verifyOrQuarantine(tx,task,doc,result.bytes);if(verified.verificationRejected)return verified;const verification=verified.verification,file=await this.writer.persistPdf(result.bytes,{customerId:task.customerId,name:doc.title+'（电子签署版）.pdf',purpose:'electronic-signed'},tx);
      ensure(file.sha256!==task.sourceSha256,409,'ELECTRONIC_FINAL_PDF_REQUIRED','签后文件仍为待签原件');await tx.electronicSigningTask.update({where:{id},data:{finalFileId:file.id,finalSha256:file.sha256,finalVerification:verification}});responseHash=file.sha256;
     }else{await this.writer.readVerified(task.finalFileId,task.finalSha256);responseHash=task.finalSha256;}
     await finalizeElectronicArchive(tx,id,this.now());if(this.options.afterArchive)await this.options.afterArchive(tx,await lockElectronicTask(tx,id));
    }
    ensure(electronicHash(responseHash),502,'ELECTRONIC_PROVIDER_UNCONFIRMED','渠道结果缺少核验摘要');await tx.electronicSigningOperation.update({where:{id:operation.id},data:{status:'CONFIRMED',responseHash,settledAt:this.now(),errorCode:null}});
    await tx.electronicSigningTask.update({where:{id},data:{processingToken:null,processingUntil:null,lastErrorCode:null,revision:{increment:1}}});
   },{isolationLevel:'ReadCommitted',timeout:45000});if(completed?.verificationRejected)throw completed.verificationRejected;return true;
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
    const party=task.parties.find((p:any)=>p.role===role);if(hasActualSigningEvidence(party))return true;ensure(party?.attemptedAt&&['ISSUED','UNKNOWN','SIGNED'].includes(party.status),409,'ELECTRONIC_OPERATION_NOT_AVAILABLE','原签署请求不存在');const result=await this.provider.querySigner(doc,party);if(result.status!=='SIGNED')return false;
    ensure(electronicHash(result.evidenceHash),502,'ELECTRONIC_SIGNER_UNCONFIRMED','本人签署查询尚未核验');await tx.electronicSigningParty.update({where:{id:party.id},data:signingEvidenceUpdate(party,result,now)});
    await tx.electronicSigningOperation.updateMany({where:{taskId:id,partyId:party.id,kind:'SIGN'},data:{status:'CONFIRMED',responseHash:result.evidenceHash,settledAt:now}});
   }
   await tx.electronicSigningTask.update({where:{id},data:{processingToken:null,processingUntil:null,lastErrorCode:null,revision:{increment:1}}});return true;
  },{isolationLevel:'ReadCommitted',timeout:45000});}catch(error){await this.markError(id,undefined,kind,error);return false;}
 }
 async advance(id:string){
  for(let step=0;step<10;step++){
   let task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});if(!task||inactive(task)||task.status==='ARCHIVED')return;
   if(task.kind==='EARLY_TERMINATION'&&task.parties.every(p=>hasActualSigningEvidence(p))){try{await this.db.serial(async tx=>activateTermination06(tx,await lockElectronicTask(tx,id)));}catch(error){await this.markError(id,undefined,'TERMINATION06_REVIEW',error);return;}}
   if(task.kind==='PRE_DELIVERY_CANCELLATION'&&task.parties.every(p=>hasActualSigningEvidence(p))){try{await this.db.serial(async tx=>activateCancellation04(tx,await lockElectronicTask(tx,id)));}catch(error){await this.markError(id,undefined,'CANCELLATION04_REVIEW',error);return;}}
   if(task.processingToken&&task.processingUntil&&task.processingUntil>this.now())return;
   let action=nextSigningAction(electronicTaskFacts(task),this.now());
   if(action.kind!=='QUERY'&&task.parties.some((p:any)=>p.attemptedAt)&&await this.originalCertificateReview(id))return;
   if(action.kind==='UPLOAD'&&(task.snapshot as any)?.context?.autoSigningPolicyVersion===3||action.kind==='SIGN'&&action.mode==='AUTO'||action.kind==='BLOCKED'&&['ELECTRONIC_AUTO_AUTHORITY_REQUIRED','ELECTRONIC_IDENTITY_REQUIRED'].includes(action.code)){
    try{if(this.options.refreshAuthorities)await this.options.refreshAuthorities(task);task=await this.db.serial(async tx=>{const current=await lockElectronicTask(tx,id);await this.business(tx,current,true);return this.refreshPending(tx,current);});action=nextSigningAction(electronicTaskFacts(task),this.now());}
    catch(error){await this.markError(id,undefined,'READINESS',error);return;}
   }
   let progressed=false;
   if(action.kind==='UPLOAD')progressed=await this.dispatch(id,'UPLOAD');else if(action.kind==='QUERY_UPLOAD'||action.kind==='QUERY_FILING')progressed=await this.query(id,action.kind);else if(action.kind==='QUERY')progressed=await this.query(id,'QUERY',action.role);else if(action.kind==='SIGN'&&action.mode==='AUTO')progressed=await this.dispatch(id,'SIGN',action.role);else if(action.kind==='FILE')progressed=await this.dispatch(id,'FILE');else if(action.kind==='ARCHIVE')progressed=await this.dispatch(id,'DOWNLOAD');
   if(!progressed){if(action.kind==='SIGN'&&action.mode==='MANUAL')await this.notifyWaiting(id,action.role);if(action.kind==='BLOCKED'&&action.code==='ELECTRONIC_COOPERATION_ACCEPTANCE_REQUIRED')await this.notifyWaiting(id,'OWNER');return;}
  }
 }
 private async notifyWaiting(id:string,role:SignerRole){
  await this.db.serial(async tx=>{
   const task=await lockElectronicTask(tx,id);if(inactive(task)||task.sealGrantId&&(await tx.electronicSealGrant.findUnique({where:{id:task.sealGrantId}}))?.revokedAt)return;const action=nextSigningAction(electronicTaskFacts(task),this.now());if(!(action.kind==='SIGN'&&action.role===role&&action.mode==='MANUAL'||action.kind==='BLOCKED'&&action.code==='ELECTRONIC_COOPERATION_ACCEPTANCE_REQUIRED'&&role==='OWNER'))return;
   const party=task.parties.find((p:any)=>p.role===role),recipient=role==='CUSTOMER'?task.customerId:(await tx.ownerESignAccount.findUnique({where:{ownerId:party.subjectId}}))?.managerCustomerId;if(!recipient)return;
   await archiveCommand(tx,{id:'SYSTEM',role:'SYSTEM'},id,'ELECTRONIC_SIGNING_NOTICE',{idempotencyKey:role},async()=>{const notice=await tx.notification.create({data:{customerId:recipient,title:'宁达订阅：合同待您签署',content:'请登录宁达对应入口，阅读合同全文并由本人确认签署。',resourceType:'ELECTRONIC_DOCUMENT',resourceId:id}});return{notificationId:notice.id};});
  });
 }
 async callback(raw:unknown,config:{appId:string;appSecret:string}){
  const event=verifiedCallback(raw,config),party=await this.db.electronicSigningParty.findUnique({where:{transactionId:event.transactionId},include:{task:true}});
  ensure(party&&party.attemptedAt&&event.providerContractId===party.task.providerContractId&&(!event.record.customer_id||event.record.customer_id===party.providerCustomerId),409,'ELECTRONIC_CALLBACK_BINDING','签署回调与原始请求不匹配');
  const eventId=canonicalHash(event.record);await this.db.providerEvent.upsert({where:{provider_eventId:{provider:'FADADA_ELECTRONIC',eventId}},create:{provider:'FADADA_ELECTRONIC',eventId,resourceId:party.taskId,payloadHash:eventId,status:inactive(party.task)?'RETIRED_PENDING_QUERY':'PENDING_QUERY'},update:{}});
  try{await this.recoverOriginalParty(party.taskId,party.id);}catch{/* The verified hint stays pending until its original query succeeds. */}
  try{if(!inactive(party.task))await this.advance(party.taskId);else await this.reconcileStopped(party.taskId);}catch{/* Broader recovery cannot undo this callback party's independently committed proof. */}
  const result=await this.db.electronicSigningParty.findUniqueOrThrow({where:{id:party.id}});if(hasActualSigningEvidence(result))await this.db.providerEvent.update({where:{provider_eventId:{provider:'FADADA_ELECTRONIC',eventId}},data:{status:inactive(party.task)?'RETIRED_VERIFIED':'VERIFIED'}});
  // A provider callback is only a reconciliation hint, never proof of signing or a new business instruction.
  return{accepted:true};
 }
 async file(actor:ElectronicActor,id:string,variant:'source'|'signed'){
  const task=await this.db.electronicSigningTask.findUnique({where:{id},include:{parties:true,sealGrant:true,archiveVersion:true}});ensure(task,404,'NOT_FOUND','电子合同不存在');await this.access(this.db,actor,task,false,true);
  const fileId=variant==='source'?task.sourceFileId:(task.status==='ARCHIVED'||task.stoppedEvidenceId)?task.finalFileId:null,hash=variant==='source'?task.sourceSha256:task.finalSha256;
  ensure(fileId&&hash,409,'ELECTRONIC_ARCHIVE_REQUIRED','签后文件尚未归档');const row=await this.db.storedFile.findUniqueOrThrow({where:{id:fileId}});return{bytes:await this.writer.readVerified(fileId,hash),name:row.name};
 }
}
