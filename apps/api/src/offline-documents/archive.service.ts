import {assertPaperSigningAllowed} from './mode';
import {assertOrdinaryReview,assertOrdinaryStaffReview} from '../auth/ordinary-review';
import {assertPartyDetails,updatePartyDetails,frozenPartyDetails} from './parties';
import {uploadedFileName,readableFileName} from '../files/filename';
import {freezeRenewalCancellationScope} from './renewal-cancellation-context';
import {readRenewalCancellationPaper,requireRenewalCancellationAgreement} from '../order-renewals/cancellation-paper';
import {ownerOrderSharingValid,sharedOwnerOrderIds} from './partner-access';
import {Inject,Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {renderOfflineDocument} from './print';
import {Db} from '../common/db';
import {requireCurrentStaff} from '../auth/staff-session';
import {getPartnerCapabilities,requirePartnerCapability} from '../partners/capabilities';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {projectRoot} from '../common/config';
import {ArchiveContextService} from './context';
import {archiveCommand,requireArchiveOperator} from './command';
import {ArchiveActor,createSchema,versionSchema,commandSchema,metadataSchema,reviewSchema,invalidateSchema,listSchema,uploadSchema,feedbackSchema,resolutionSchema,internalFeedbackSchema} from './schemas';
import {assertDraft,validateArchiveFile,validateManifest,assertFileBinding} from './files';
import {assertApproval} from './review';
import {archivePrintConfirmed,requireArchivePrintConfirmed} from './archive-workflow';
import {archiveSummary,canReadArchive,canReadArchiveFiles,safeArchive} from './projection';
import {lockOrder} from './readiness';
import {cooperationBusinessHash} from './snapshot';
import {assertTerminationPrintCurrent,freezeTerminationPrintContext} from './termination';
import {assertNotAssetFiles} from '../files/asset-files';
import {requireChangeAgreementReady} from '../order-changes/agreement-readiness';
const include={versions:{orderBy:{version:'desc' as const},include:{files:{orderBy:{position:'asc' as const},include:{file:true}},feedback:true}}};
const root=resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'));
async function persist(buffer:Buffer){const sha256=createHash('sha256').update(buffer).digest('hex'),path=resolve(root,sha256.slice(0,2),sha256);await fs.mkdir(resolve(root,sha256.slice(0,2)),{recursive:true});await fs.writeFile(path,buffer,{mode:0o600});return{sha256,storagePath:path};}
@Injectable()
export class ArchiveService {
 constructor(@Inject(Db) private db:Db,@Inject(ArchiveContextService) private context:ArchiveContextService){}
 private async loaded(tx:any,id:string){const a=await tx.documentArchive.findUnique({where:{id},include});ensure(a,404,'NOT_FOUND','档案不存在');return a;}
 private version(a:any,id:string){const v=a.versions.find((v:any)=>v.id===id);ensure(v,404,'NOT_FOUND','版本不存在');return v;}
 private async assertFiles(tx:any,versions:any[]){await assertNotAssetFiles(tx,[...new Set<string>(versions.flatMap((v:any)=>[v.sourceFileId,...(v.files||[]).flatMap((f:any)=>[f.fileId,f.file?.id])]).filter((id:any)=>typeof id==='string'&&id))]);}
 private async locked(tx:any,id:string){let a=await this.loaded(tx,id);if(a.orderId)await lockOrder(tx,a.orderId);else await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${a.ownerId} FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "DocumentArchive" WHERE id = ${id} FOR UPDATE`;return this.loaded(tx,id);}
 private async writable(tx:any,id:string,actor:ArchiveActor,action:'write'|'review'='write',historical=false){if(!historical)assertPaperSigningAllowed();const initial=await this.loaded(tx,id);await requireArchiveOperator(tx,actor,initial.kind,action);const a=await this.locked(tx,id);await this.assertFiles(tx,a.versions);return a;}
 private async revision(tx:any,a:any,expected:number,current=true){ensure(a.revision===expected,409,'REVISION_CONFLICT','档案版本已变化，请刷新');if(a.kind==='RENEWAL_CANCELLATION'){if(current)await this.context.resolve(tx,a);else await this.currentReadHash(tx,a);}}
 private async currentReadHash(tx:any,a:any){
  if(a.kind==='RENEWAL_CANCELLATION'){const{c}=await readRenewalCancellationPaper(tx,a.subjectId);ensure(a.renewalCancellationId===c.id&&a.orderId===c.orderId&&a.ownerId===c.ownerId&&!a.quoteId&&!a.handoverId,409,'RENEWAL_CANCELLATION_PAPER_SOURCE','取消档案归属不一致');return c.sourceHash;}
  if(a.kind==='ORDER_AMENDMENT'){const q=a.quoteId?await tx.delayQuote.findUnique({where:{id:a.quoteId},include:{change:true}}):null;return q?.change?.orderId===a.orderId&&a.subjectId===q.id?q.commercialHash:'';}
  if(a.subjectType==='OWNER'){const owner=await tx.vehicleOwner.findUnique({where:{id:a.ownerId}}),scope=a.versions.find((v:any)=>v.id===a.currentApprovedVersionId)?.scopeSnapshot||a.versions[0]?.scopeSnapshot;return owner&&scope?.vehicleIds?cooperationBusinessHash(owner.id,owner.revision,scope):'';}
  if(a.handoverId)return(await tx.handover.findUnique({where:{id:a.handoverId}}))?.manifestHash||'';
  const order=await tx.order.findUnique({where:{id:a.orderId}});if(!order)return'';
  if(a.kind==='RENTAL')return order.finalPlanSnapshot?.commercialHash||'';
  if(order.effectiveTermsVersionId){const terms=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});return terms?.orderId===order.id?terms.hash:'';}
  return order.finalPlanSnapshot?.commercialHash||'';
 }
 async partnerList(raw:unknown,actor:ArchiveActor){
  const q=listSchema.parse(raw),tx:any=this.db;ensure(actor.role==='OWNER'&&actor.ownerId,403,'FORBIDDEN','请从合作商中心读取');
  const {requireArchivePartnerIdentity}=await import('./partner-access');await requireArchivePartnerIdentity(tx,actor,actor.ownerId);
  const shared=await sharedOwnerOrderIds(tx,actor.ownerId);const where={ownerId:actor.ownerId,OR:[{orderId:null},{orderId:{in:shared}}],...(q.kind?{kind:q.kind}:{}),...(q.orderId?{orderId:q.orderId}:{}),versions:{some:{status:{in:['ARCHIVED','INVALIDATED']}}}};
  const [rows,total]=await Promise.all([tx.documentArchive.findMany({where,select:{id:true},orderBy:{createdAt:'desc'},skip:(q.page-1)*q.pageSize,take:q.pageSize}),tx.documentArchive.count({where})]);
  return{items:await Promise.all(rows.map((a:any)=>this.detail(a.id,actor))),total,page:q.page,pageSize:q.pageSize};
 }
 private async changed(tx:any,a:any,actor:ArchiveActor,action:string,versionId:string){if(['PATCH','UPLOAD','SUBMIT','PREPARE'].includes(action)){const v=this.version(a,versionId);await tx.archiveVersion.update({where:{id:versionId},data:{editorIds:[...new Set([...(v.editorIds||[]),actor.id])]}});}await tx.documentArchive.update({where:{id:a.id},data:{revision:{increment:1}}});await audit(tx,actor.id,action,'offline-archives',a.id,{versionId});}
 private async template(tx:any,id:string,kind:string,boundVersion?:number){const t=await tx.legalDocument.findUnique({where:{id}});ensure(t&&t.type===`OFFLINE_${kind}`&&(t.status==='PUBLISHED'||kind!=='RENEWAL_CANCELLATION'&&boundVersion!==undefined&&t.status==='RETIRED')&&t.confirmedBy&&t.confirmedAt&&(boundVersion===undefined||t.version===boundVersion),409,'LEGAL_NOT_APPROVED','请先启用对应合同模板版本');return t;}
 private async bind(tx:any,a:any){
  if(a.kind==='ORDER_AMENDMENT'){
   const contract=await tx.contract.findUnique({where:{delayQuoteId:a.quoteId}});
   ensure(contract?.kind==='AMENDMENT'&&contract.orderId===a.orderId&&contract.executionMode==='OFFLINE'&&contract.status==='DRAFT'&&!contract.providerTaskId&&(!contract.offlineArchiveId||contract.offlineArchiveId===a.id),409,'ARCHIVE_SNAPSHOT_MISMATCH','补充协议原记录或档案关联不一致');
   const changed=await tx.contract.updateMany({where:{id:contract.id,executionMode:'OFFLINE',status:'DRAFT',OR:[{offlineArchiveId:null},{offlineArchiveId:a.id}]},data:{offlineArchiveId:a.id}});
   ensure(changed.count===1,409,'REVISION_CONFLICT','补充协议档案关联已变化');
  }
  if(a.kind==='RENTAL'){
   const contract=await tx.contract.findFirst({where:{orderId:a.orderId,kind:{in:['SUBSCRIPTION','RENTAL']}},orderBy:{createdAt:'asc'}});
   ensure(contract?.executionMode==='OFFLINE'&&(!contract.offlineArchiveId||contract.offlineArchiveId===a.id),409,'ARCHIVE_SNAPSHOT_MISMATCH','原线下租赁合同已关联其他档案或模式不匹配');
   const changed=await tx.contract.updateMany({where:{id:contract.id,executionMode:'OFFLINE',OR:[{offlineArchiveId:null},{offlineArchiveId:a.id}]},data:{offlineArchiveId:a.id}});
   ensure(changed.count===1,409,'REVISION_CONFLICT','合同档案关联已变化');
  }
  if(a.handoverId){const changed=await tx.handover.updateMany({where:{id:a.handoverId,executionMode:'OFFLINE',OR:[{offlineArchiveId:null},{offlineArchiveId:a.id}]},data:{offlineArchiveId:a.id}});ensure(changed.count===1,409,'ARCHIVE_SNAPSHOT_MISMATCH','交接档案已关联其他档案或模式不匹配');}
 }
 private async draft(tx:any,a:any,input:any,actor:ArchiveActor){const scope=input.scope||a.versions?.[0]?.scopeSnapshot,current=await this.context.resolve(tx,a,scope),document=a.kind==='ORDER_AMENDMENT'&&'amendmentContext' in current?current.amendmentContext:undefined;
  if(a.kind==='ORDER_AMENDMENT')ensure(document&&input.templateId===document.templateId,409,'AMENDMENT_DOCUMENT_MISMATCH','请使用客户确认的补充协议模板版本');
  const t=await this.template(tx,input.templateId,a.kind,document?.templateVersion);
  if(a.kind==='ORDER_AMENDMENT')ensure(document&&t.id===document.templateId&&t.version===document.templateVersion&&hash(t.content)===document.templateHash,409,'AMENDMENT_DOCUMENT_MISMATCH','请使用客户确认的补充协议模板版本');
  let requiredSigners=current.requiredSigners;try{const content=JSON.parse(t.content);if(Array.isArray(content.requiredSigners)){ensure(content.requiredSigners.every((r:string)=>['CUSTOMER','OWNER','PLATFORM'].includes(r))&&requiredSigners.every((r:string)=>content.requiredSigners.includes(r)),409,'LEGAL_NOT_APPROVED','模板必签方无效');requiredSigners=[...new Set<string>(content.requiredSigners)];}}catch(e:any){if(e?.getStatus)throw e;}
  return tx.archiveVersion.create({data:{archiveId:a.id,createdBy:actor.id,editorIds:[actor.id],version:Math.max(0,...(a.versions||[]).map((v:any)=>v.version))+1,status:'DRAFT',templateId:t.id,templateVersion:t.version,businessSnapshotHash:current.businessSnapshotHash,partiesSnapshot:JSON.parse(JSON.stringify(frozenPartyDetails(current.partiesSnapshot,'businessSnapshot' in current?current.businessSnapshot:{}))),requiredSigners,scopeSnapshot:a.kind==='RENEWAL_CANCELLATION'&&'cancellationContext' in current?freezeRenewalCancellationScope(current,t):current.scopeSnapshot}});
 }
 async create(raw:unknown,actor:ArchiveActor){
  assertPaperSigningAllowed();
  const input=createSchema.parse(raw);
  ensure((input.kind==='OWNER_COOPERATION'&&input.subjectType==='OWNER')||(['RENTAL','TERMINATION'].includes(input.kind)&&input.subjectType==='ORDER')||(input.kind==='RENEWAL_CANCELLATION'&&input.subjectType==='ORDER_RENEWAL_CANCELLATION')||(input.kind==='ORDER_AMENDMENT'&&input.subjectType==='ORDER_CHANGE_QUOTE')||(['DELIVERY_RECEIPT','RETURN_RECEIPT'].includes(input.kind)&&input.subjectType==='HANDOVER'),400,'VALIDATION','档案类别与主体不匹配');
  return this.db.serial(async(tx:any)=>{
   await requireArchiveOperator(tx,actor,input.kind);
   const subject={kind:input.kind,subjectType:input.subjectType,subjectId:input.subjectId};
   return archiveCommand(tx,actor,[input.subjectType,input.subjectId,input.kind].join(':'),'CREATE',input,async()=>{
    const current=await this.context.resolve(tx,subject,input.scope);
    if(current.orderId)await lockOrder(tx,current.orderId);else await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${current.ownerId} FOR UPDATE`;
    ensure(!await tx.documentArchive.findUnique({where:{subjectType_subjectId_kind:{subjectType:input.subjectType,subjectId:input.subjectId,kind:input.kind}}}),409,'REVISION_CONFLICT','该主体已有同类档案');
    const a=await tx.documentArchive.create({data:{...subject,ownerId:current.ownerId,orderId:current.orderId,handoverId:current.handoverId,...(input.kind==='ORDER_AMENDMENT'?{quoteId:input.subjectId}:{}),...(input.kind==='RENEWAL_CANCELLATION'?{renewalCancellationId:input.subjectId}:{}),createdBy:actor.id}});
    const version=await this.draft(tx,{...a,versions:[]},input,actor);await this.bind(tx,a);await audit(tx,actor.id,'CREATE','offline-archives',a.id,{versionId:version.id});
    return{id:a.id,archiveId:a.id,versionId:version.id,revision:0,version:version.version,status:version.status};
   });
  });
 }
 async newVersion(id:string,raw:unknown,actor:ArchiveActor){const input=versionSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor);return archiveCommand(tx,actor,id,'NEW_VERSION',input,async()=>{await this.revision(tx,a,input.revision);
   const superseded=input.supersedeDraftVersionId?this.version(a,input.supersedeDraftVersionId):null;
   if(superseded){ensure(superseded.status==='DRAFT'&&!a.versions.some((v:any)=>v.id!==superseded.id&&(v.version>superseded.version||['DRAFT','SUBMITTED'].includes(v.status))),409,'STATE_CONFLICT','只能明确替代最新草稿，且不能有其他未完成候选版本');}
   else ensure(!a.versions.some((v:any)=>['DRAFT','SUBMITTED'].includes(v.status)),409,'STATE_CONFLICT','已有未完成候选版本');
   const v=await this.draft(tx,a,input,actor);
   if(superseded){const reason='经运营建立补正版本替代，非审核结论；原文件及原生成记录保留';await tx.archiveVersion.update({where:{id:superseded.id},data:{status:'SUPERSEDED',invalidatedBy:actor.id,invalidatedAt:new Date(),invalidationReason:reason}});await audit(tx,actor.id,'SUPERSEDE_DRAFT','offline-archives',id,{versionId:superseded.id,newVersionId:v.id,reason});}
   await this.changed(tx,a,actor,'NEW_VERSION',v.id);return{id:v.id,archiveId:id,version:v.version,status:v.status,revision:a.revision+1};});});}
 async patch(id:string,versionId:string,raw:unknown,actor:ArchiveActor){const input=metadataSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor),v=this.version(a,versionId);return archiveCommand(tx,actor,id,`PATCH:${versionId}`,input,async()=>{await this.revision(tx,a,input.revision);assertDraft(v);const{revision,idempotencyKey,fileOrder,terminationDetails,partyDetails,...metadata}=input;ensure(!terminationDetails||a.kind==='TERMINATION',400,'VALIDATION','终止事项仅适用于终止协议');if(partyDetails)ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','仅管理员或运营可核对完整主体证件');const invalidatesSource=!!partyDetails||!!terminationDetails||metadata.contractNumber!==undefined&&metadata.contractNumber!==(v.contractNumber||a.id);ensure(!invalidatesSource||!v.files.length,409,'ARCHIVE_CORRECTION_REQUIRED','本版已上传签字文件，请建立补正版本后重新生成、签署及上传；原文件保留');if(fileOrder){ensure(fileOrder.length===v.files.length&&new Set(fileOrder).size===v.files.length&&fileOrder.every(f=>v.files.some((x:any)=>x.fileId===f)),400,'ARCHIVE_FILE_INVALID','排序必须包括且仅包括本版所有文件');for(let i=0;i<fileOrder.length;i++)await tx.archiveFile.update({where:{versionId_fileId:{versionId,fileId:fileOrder[i]}},data:{position:-(i+1)}});for(let i=0;i<fileOrder.length;i++)await tx.archiveFile.update({where:{versionId_fileId:{versionId,fileId:fileOrder[i]}},data:{position:i+1}});}await tx.archiveVersion.update({where:{id:versionId},data:{...metadata,...(partyDetails?{partiesSnapshot:updatePartyDetails(v.partiesSnapshot,partyDetails)}:{}),...(terminationDetails?{scopeSnapshot:{...v.scopeSnapshot,terminationDetails,terminationPrintSnapshot:null}}:{}),...(invalidatesSource?{sourceFileId:null}:{})}});if(partyDetails)await audit(tx,actor.id,'PARTY_DETAILS_VERIFIED','offline-archives',id,{versionId,roles:partyDetails.parties.map(p=>p.role),verificationNote:partyDetails.verificationNote});await this.changed(tx,a,actor,'PATCH',versionId);return{id:versionId,revision:a.revision+1,status:'DRAFT'};});});}
 async upload(id:string,versionId:string,raw:unknown,file:Express.Multer.File,actor:ArchiveActor){
  const input=uploadSchema.parse(raw);ensure(file?.buffer,400,'ARCHIVE_FILE_INVALID','请上传原文件');const valid=validateArchiveFile(file.buffer,file.mimetype),name=uploadedFileName(file.originalname);
  const request={...input,...valid,name};
  return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor),v=this.version(a,versionId);return archiveCommand(tx,actor,id,`UPLOAD:${versionId}`,request,async()=>{
   await this.revision(tx,a,input.revision);assertDraft(v);await requireArchivePrintConfirmed(tx,a,v);if(a.kind==='TERMINATION')assertTerminationPrintCurrent(a,v,(await this.context.resolve(tx,a,v.scopeSnapshot)).terminationContext);ensure(input.position===v.files.length+1,400,'ARCHIVE_FILE_INVALID','请按顺序上传');validateManifest([...v.files,{position:input.position,file:{id:'new',...valid}}]);const stored=await persist(file.buffer);
   const f=await tx.storedFile.create({data:{name,...valid,...stored,purpose:'offline-archive',adminId:actor.id}});await tx.archiveFile.create({data:{versionId,fileId:f.id,position:input.position,uploadedBy:actor.id,uploadedRole:actor.role}});await this.changed(tx,a,actor,'UPLOAD',versionId);return{id:f.id,archiveId:id,versionId,position:input.position,sha256:f.sha256,size:f.size,mimeType:f.mimeType,revision:a.revision+1};
  });});
 }
 async submit(id:string,raw:unknown,actor:ArchiveActor){const input=commandSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor);return archiveCommand(tx,actor,id,'SUBMIT',input,async()=>{await this.revision(tx,a,input.revision);const v=this.version(a,input.versionId);assertDraft(v);await requireArchivePrintConfirmed(tx,a,v);if(a.kind==='TERMINATION')assertTerminationPrintCurrent(a,v,(await this.context.resolve(tx,a,v.scopeSnapshot)).terminationContext);ensure(v.signedOn&&v.contractNumber&&v.declaredPages,400,'ARCHIVE_METADATA_REQUIRED','签署日期、合同编号与页数须齐全');for(const f of v.files){assertFileBinding(v,f);const bytes=await fs.readFile(f.file.storagePath);const valid=validateArchiveFile(bytes,f.file.mimeType);ensure(valid.sha256===f.file.sha256&&valid.size===f.file.size,400,'ARCHIVE_FILE_INVALID','原文件摘要不匹配');}const manifest=validateManifest(v.files),current=await this.context.resolve(tx,a,v.scopeSnapshot);ensure(v.businessSnapshotHash===current.businessSnapshotHash,409,'ARCHIVE_SNAPSHOT_MISMATCH','业务快照已变化，请创建新版');await tx.archiveVersion.update({where:{id:v.id},data:{status:'SUBMITTED',submittedBy:actor.id,submittedAt:new Date(),fileManifestHash:manifest}});await this.changed(tx,a,actor,'SUBMIT',v.id);return{id:v.id,status:'SUBMITTED',revision:a.revision+1,fileManifestHash:manifest};});});}
 async review(id:string,raw:unknown,actor:ArchiveActor){
  const input=reviewSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor,'review');return archiveCommand(tx,actor,id,'REVIEW',input,async()=>{
   await this.revision(tx,a,input.revision);const v=this.version(a,input.versionId);ensure(v.status==='SUBMITTED',409,'STATE_CONFLICT','仅待审核版本可审核');
   assertOrdinaryReview(actor,[a.createdBy,v.createdBy,v.submittedBy,...(v.editorIds||[]),...v.files.flatMap((f:any)=>[f.uploadedBy,f.file?.adminId])],'ARCHIVE_SELF_REVIEW');
   if(input.decision==='APPROVE'){const current=await this.context.resolve(tx,a,v.scopeSnapshot);assertTerminationPrintCurrent(a,v,current.terminationContext);assertApproval(v,input,actor.id,current.businessSnapshotHash);}
   const status=input.decision==='APPROVE'?'REVIEWED':'REJECTED';await tx.archiveVersion.update({where:{id:v.id},data:{status,reviewedBy:actor.id,reviewedAt:new Date(),reviewChecklist:input.checklist,partyChecks:input.partyChecks,reviewReason:input.reason}});
   await this.changed(tx,a,actor,'REVIEW',v.id);return{id:v.id,status,revision:a.revision+1};
  });});
 }
 async archive(id:string,raw:unknown,actor:ArchiveActor){
  const input=commandSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor);return archiveCommand(tx,actor,id,'ARCHIVE',input,async()=>{
   await this.revision(tx,a,input.revision);const v=this.version(a,input.versionId);ensure(v.status==='REVIEWED',409,'STATE_CONFLICT','请先完成签字版审核，再归档');ensure(!a.versions.some((other:any)=>other.version>v.version),409,'ARCHIVE_VERSION_SUPERSEDED','已有后续资料版本，请完成最新版本归档');
   const current=await this.context.resolve(tx,a,v.scopeSnapshot);assertTerminationPrintCurrent(a,v,current.terminationContext);assertApproval(v,{checklist:v.reviewChecklist,partyChecks:v.partyChecks,reason:v.reviewReason},actor.id,current.businessSnapshotHash);
   ensure(v.reviewedBy&&v.reviewedAt,409,'ARCHIVE_CHECKLIST_REQUIRED','审核记录不完整');
   await tx.archiveVersion.update({where:{id:v.id},data:{status:'ARCHIVED'}});await tx.documentArchive.update({where:{id},data:{currentApprovedVersionId:v.id}});
   if(a.kind==='RENEWAL_CANCELLATION')await requireRenewalCancellationAgreement(tx,a.subjectId);
   if(a.kind==='ORDER_AMENDMENT'){
    const quote=await tx.delayQuote.findUnique({where:{id:a.quoteId}});ensure(quote,409,'ARCHIVE_SNAPSHOT_MISMATCH','补充协议报价缺失');
    const agreement=await requireChangeAgreementReady(tx,quote.changeId);ensure(agreement.mode==='OFFLINE'&&agreement.archiveVersionId===v.id,409,'ARCHIVE_CORRECTION_REQUIRED','资金安排已冻结其他签字版，请另行核对补充协议');
    const change=await tx.orderChange.findUnique({where:{id:quote.changeId}});
    if(change?.status==='AWAITING_ARCHIVE'){const changed=await tx.orderChange.updateMany({where:{id:change.id,activeQuoteId:quote.id,status:'AWAITING_ARCHIVE'},data:{status:'AWAITING_FINANCE',revision:{increment:1}}});ensure(changed.count===1,409,'REVISION_CONFLICT','订单变更已更新，请重新核对');}
   }
   if(a.kind==='RENTAL'&&a.orderId)await tx.order.updateMany({where:{id:a.orderId,contractMode:'OFFLINE',status:'AWAITING_CONTRACT_REVIEW'},data:{status:'AWAITING_PAYMENT',revision:{increment:1}}});
   await this.changed(tx,a,actor,'ARCHIVE',v.id);return{id:v.id,status:'ARCHIVED',revision:a.revision+1};
  });});
 }
 async confirmPrint(id:string,versionId:string,raw:unknown,actor:ArchiveActor){
  const input=commandSchema.omit({versionId:true}).parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor);return archiveCommand(tx,actor,id,`CONFIRM_PRINT:${versionId}`,input,async()=>{
   await this.revision(tx,a,input.revision);const v=this.version(a,versionId);assertDraft(v);ensure(v.sourceFileId,409,'ARCHIVE_SOURCE_REQUIRED','请先按本单交易条件生成合同文件');
   const current=await this.context.resolve(tx,a,v.scopeSnapshot);ensure(v.businessSnapshotHash===current.businessSnapshotHash,409,'ARCHIVE_SNAPSHOT_MISMATCH','业务条款已变化，请创建新版');assertTerminationPrintCurrent(a,v,current.terminationContext);
   await this.changed(tx,a,actor,'CONFIRM_PRINT',v.id);return{archiveId:id,versionId,sourceFileId:v.sourceFileId,printConfirmed:true,revision:a.revision+1};
  });});
 }
 async invalidate(id:string,raw:unknown,actor:ArchiveActor){const input=invalidateSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor,'write',true);return archiveCommand(tx,actor,id,'INVALIDATE',input,async()=>{await this.revision(tx,a,input.revision);const v=this.version(a,input.versionId);ensure(v.status==='ARCHIVED',409,'STATE_CONFLICT','仅已归档版本可作废');await tx.archiveVersion.update({where:{id:v.id},data:{status:'INVALIDATED',invalidatedBy:actor.id,invalidatedAt:new Date(),invalidationReason:input.reason}});if(a.currentApprovedVersionId===v.id)await tx.documentArchive.update({where:{id},data:{currentApprovedVersionId:null}});await this.changed(tx,a,actor,'INVALIDATE',v.id);return{id:v.id,status:'INVALIDATED',revision:a.revision+1};});});}
 async prepare(id:string,versionId:string,raw:unknown,actor:ArchiveActor){const input=commandSchema.omit({versionId:true}).parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor);return archiveCommand(tx,actor,id,`PREPARE:${versionId}`,input,async()=>{await this.revision(tx,a,input.revision);const v=this.version(a,versionId);assertDraft(v);ensure(!v.files.length,409,'ARCHIVE_CORRECTION_REQUIRED','本版已上传签字文件，请建立补正版本后重新生成、签署及上传；原文件保留');const t=await this.template(tx,v.templateId,a.kind,v.templateVersion),current=await this.context.resolve(tx,a,v.scopeSnapshot);ensure(current.businessSnapshotHash===v.businessSnapshotHash,409,'ARCHIVE_SNAPSHOT_MISMATCH','业务快照已变更');assertPartyDetails(v.partiesSnapshot,v.requiredSigners);const bytes=await renderOfflineDocument({archive:a,version:v,template:t,context:{...current,partiesSnapshot:v.partiesSnapshot,requiredSigners:v.requiredSigners}}),stored=await persist(bytes);const f=await tx.storedFile.create({data:{name:`offline-${id}-v${v.version}.pdf`,mimeType:'application/pdf',size:bytes.length,...stored,purpose:'offline-source',adminId:actor.id}});await tx.archiveVersion.update({where:{id:versionId},data:{sourceFileId:f.id,contractNumber:v.contractNumber||a.id,...(a.kind==='TERMINATION'?{scopeSnapshot:{...v.scopeSnapshot,terminationPrintSnapshot:freezeTerminationPrintContext(current.terminationContext!)}}:{})}});await this.changed(tx,a,actor,'PREPARE',versionId);return{archiveId:id,versionId,sourceFileId:f.id,sourceSha256:stored.sha256,revision:a.revision+1};});});}
 // Cooperation batches retain real-person provenance; only ordinary ADMIN review has the exception.
 async independentReview(tx:any,a:any,v:any,actor:ArchiveActor){
  await this.assertFiles(tx,[v]);
  const history=await tx.auditLog.findMany({where:{resourceType:'offline-archives',resourceId:a.id,action:{in:['CREATE','NEW_VERSION','PATCH','PREPARE','UPLOAD','SUBMIT']}},select:{actorId:true,action:true,data:true}});
  const edits=history.filter((row:any)=>row.data?.versionId===v.id),creator=v.createdBy||edits.find((row:any)=>['CREATE','NEW_VERSION'].includes(row.action))?.actorId;
  const source=v.sourceFileId?await tx.storedFile.findUnique({where:{id:v.sourceFileId}}):null;
  await assertOrdinaryStaffReview(tx,actor,[a.createdBy,creator,v.submittedBy,...(v.editorIds||[]),...edits.map((row:any)=>row.actorId),...v.files.flatMap((f:any)=>[f.uploadedBy,f.file?.adminId]),...(v.sourceFileId?[source?.adminId]:[])],'ARCHIVE_SELF_REVIEW');
 }
 private async authorized(tx:any,a:any,actor:ArchiveActor){
  if(['ADMIN','OPERATIONS','FINANCE','SUPPORT'].includes(actor.role)){if(a.kind==='OWNER_COOPERATION'){const staff=await requirePartnerCapability(tx,actor,'partner.cooperation.read');actor.partnerCapabilities=getPartnerCapabilities(staff);}else{await requireCurrentStaff(tx,actor,'offline-archives',false);ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN','当前员工无权读取客户档案');}return;}
  if(actor.role==='CUSTOMER'){const order=a.orderId?await tx.order.findUnique({where:{id:a.orderId}}):null;ensure(order&&order.customerId===(actor.customerId||actor.id),404,'NOT_FOUND','档案不存在');a.customerId=order.customerId;return;}
  if(actor.role==='OWNER'){ensure(actor.ownerId&&a.ownerId===actor.ownerId,404,'NOT_FOUND','档案不存在');const {requireArchivePartnerIdentity}=await import('./partner-access');await requireArchivePartnerIdentity(tx,actor,actor.ownerId);if(a.orderId){const order=await tx.order.findUnique({where:{id:a.orderId}});ensure(ownerOrderSharingValid(order,actor.ownerId),404,'NOT_FOUND','档案不存在');}return;}
  ensure(false,403,'FORBIDDEN','当前角色无档案权限');
 }
 async detail(id:string,actor:ArchiveActor){const tx:any=this.db,a=await this.loaded(tx,id);await this.authorized(tx,a,actor);await this.assertFiles(tx,a.versions.filter((v:any)=>canReadArchive(actor,a,v)));if(['ADMIN','OPERATIONS'].includes(actor.role)||a.kind==='OWNER_COOPERATION'&&actor.partnerCapabilities?.includes('partner.cooperation.read'))return {...a,...(a.kind==='TERMINATION'?{terminationContext:(await this.context.resolve(tx,a,a.versions?.[0]?.scopeSnapshot)).terminationContext}:{}),versions:await Promise.all(a.versions.map(async(v:any)=>({...v,...(!['ADMIN','OPERATIONS'].includes(actor.role)?{partiesSnapshot:(v.partiesSnapshot||[]).map(({identityNumber,phone,...party}:any)=>party)}:{}),...(!canReadArchiveFiles(actor,a,v)?{sourceFileId:null}:{}),printConfirmed:canReadArchiveFiles(actor,a,v)&&await archivePrintConfirmed(tx,a,v),files:(canReadArchiveFiles(actor,a,v)?v.files:[]).map((f:any)=>({fileId:f.fileId,position:f.position,uploadedBy:f.uploadedBy,uploadedRole:f.uploadedRole,file:{id:f.file.id,name:readableFileName(f.file.name),mimeType:f.file.mimeType,size:f.file.size,sha256:f.file.sha256}}))})))};ensure(a.versions.some((v:any)=>canReadArchive(actor,a,v)),404,'NOT_FOUND','档案不存在');return safeArchive(a,await this.currentReadHash(tx,a),actor);}
 async list(raw:unknown,actor:ArchiveActor){const q=listSchema.parse(raw),tx:any=this.db;
  let current:any;
  if(q.kind==='OWNER_COOPERATION')current=await requirePartnerCapability(tx,actor,'partner.cooperation.read');
  else if(['ADMIN','OPERATIONS'].includes(actor.role))current=await requireCurrentStaff(tx,actor,'offline-archives',false);
  else {ensure(!q.kind&&!q.orderId,403,'FORBIDDEN','当前员工仅可读取合作协议');current=await requirePartnerCapability(tx,actor,'partner.cooperation.read');}
  actor={...actor,partnerCapabilities:getPartnerCapabilities(current)};
  const cooperation=actor.partnerCapabilities!.includes('partner.cooperation.read'),customer=['ADMIN','OPERATIONS'].includes(actor.role);
  const where={...(q.kind?{kind:q.kind}:!customer?{kind:'OWNER_COOPERATION'}:!cooperation?{kind:{not:'OWNER_COOPERATION'}}:{}),...(q.orderId?{orderId:q.orderId}:{}),...(q.ownerId?{ownerId:q.ownerId}:{}),...(q.status?{versions:{some:{status:q.status}}}:{})};
  const [items,total]=await Promise.all([tx.documentArchive.findMany({where,include,orderBy:{createdAt:'desc'},skip:(q.page-1)*q.pageSize,take:q.pageSize}),tx.documentArchive.count({where})]);return{items:await Promise.all(items.map(async(a:any)=>archiveSummary(a,await this.currentReadHash(tx,a),actor))),total,page:q.page,pageSize:q.pageSize};
 }
 async readFile(id:string,versionId:string,fileId:string,actor:ArchiveActor,response:any){const tx:any=this.db,a=await this.loaded(tx,id);await this.authorized(tx,a,actor);const v=this.version(a,versionId);ensure(canReadArchive(actor,a,v),404,'NOT_FOUND','文件不存在');ensure(canReadArchiveFiles(actor,a,v),403,'ARCHIVE_FILE_PERMISSION','含个人法定信息的合作档案原件仅本人及授权运营人员可读');const binding=v.files.find((f:any)=>f.fileId===fileId);let file:any;if(binding){assertFileBinding(v,binding);file=binding.file;}else{ensure((['ADMIN','OPERATIONS'].includes(actor.role)||a.kind==='OWNER_COOPERATION'&&actor.partnerCapabilities?.includes('partner.cooperation.read'))&&v.sourceFileId===fileId,404,'NOT_FOUND','文件不存在');file=await tx.storedFile.findUnique({where:{id:fileId}});ensure(file?.purpose==='offline-source',404,'NOT_FOUND','文件不存在');}await assertNotAssetFiles(tx,[fileId]);ensure(resolve(file.storagePath).startsWith(root+sep),500,'STORAGE_PATH','文件存储异常');response.set({'Content-Type':file.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(readableFileName(file.name))}`});return response.sendFile(file.storagePath);}
 async feedback(id:string,raw:unknown,actor:ArchiveActor){ensure(actor.role!=='OWNER',403,'PARTNER_READ_ONLY','合作商入口仅供查看，请联系平台运营');const input=feedbackSchema.parse(raw);ensure(['CUSTOMER','OWNER'].includes(actor.role),403,'FORBIDDEN','仅本人客户或车主可反馈');return this.db.serial(async(tx:any)=>{const a=await this.locked(tx,id);await this.authorized(tx,a,actor);const v=this.version(a,input.versionId);ensure(canReadArchive(actor,a,v),404,'NOT_FOUND','版本不存在');return archiveCommand(tx,actor,id,'FEEDBACK',input,async()=>{const f=await tx.archiveFeedback.create({data:{versionId:v.id,actorType:actor.role,actorId:actor.id,message:input.message}});await tx.documentArchive.update({where:{id},data:{revision:{increment:1}}});await audit(tx,actor.id,'FEEDBACK','offline-archives',id,{feedbackId:f.id,versionId:v.id},actor.role);return{id:f.id,status:f.status};});});}
 async recordFeedback(id:string,raw:unknown,actor:ArchiveActor){const input=internalFeedbackSchema.parse(raw);return this.db.serial(async(tx:any)=>{const initial=await this.loaded(tx,id);ensure(initial.kind==='OWNER_COOPERATION',403,'FORBIDDEN','线下反馈登记仅用于合作协议');const a=await this.writable(tx,id,actor,'write',true);return archiveCommand(tx,actor,id,'RECORD_FEEDBACK',input,async()=>{await this.revision(tx,a,input.revision);const v=this.version(a,input.versionId);ensure(['ARCHIVED','INVALIDATED'].includes(v.status),409,'STATE_CONFLICT','仅可为已发布合作协议登记反馈');const f=await tx.archiveFeedback.create({data:{versionId:v.id,actorType:'ADMIN',actorId:actor.id,recordedBy:actor.id,source:input.source,message:input.message}});await this.changed(tx,a,actor,'RECORD_FEEDBACK',v.id);await audit(tx,actor.id,'COOPERATION_FEEDBACK_RECORDED','offline-archives',id,{feedbackId:f.id,versionId:v.id,source:input.source,recordedBy:actor.id});return{id:f.id,status:f.status,revision:a.revision+1};});});}
 async resolveFeedback(id:string,feedbackId:string,raw:unknown,actor:ArchiveActor){const input=resolutionSchema.parse(raw);return this.db.serial(async(tx:any)=>{const a=await this.writable(tx,id,actor,'write',true);return archiveCommand(tx,actor,id,`RESOLVE:${feedbackId}`,input,async()=>{await this.revision(tx,a,input.revision,false);const f=await tx.archiveFeedback.findFirst({where:{id:feedbackId,version:{archiveId:id}}});ensure(f,404,'NOT_FOUND','反馈不存在');ensure(f.status==='OPEN',409,'STATE_CONFLICT','反馈已处理');await tx.archiveFeedback.update({where:{id:feedbackId},data:{status:'RESOLVED',resolvedBy:actor.id,resolution:input.resolution,resolvedAt:new Date()}});await this.changed(tx,a,actor,'RESOLVE_FEEDBACK',f.versionId);return{id:feedbackId,status:'RESOLVED',revision:a.revision+1};});});}
}






