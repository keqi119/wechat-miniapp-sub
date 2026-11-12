import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {readRenewalCancellationFacts} from '../src/order-renewals/cancellation-facts';
import {buildRenewalCancellationPaperSource} from '../src/order-renewals/cancellation-paper';
import {resolveRenewalCancellationContext,freezeRenewalCancellationScope} from '../src/offline-documents/renewal-cancellation-context';
import {validateManifest} from '../src/offline-documents/files';
import {canonicalHash} from '../src/customers/types';
import {renewalNow} from './order-renewals-fixture';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {ArchiveContextService} from '../src/offline-documents/context';

export const cancellationTemplate={id:'cancel-template',type:'OFFLINE_RENEWAL_CANCELLATION',title:'合成续期取消协议',version:1,status:'PUBLISHED',confirmedBy:'legal-reviewer',confirmedAt:renewalNow,content:'承租人：{{customerName}}\n出租方：{{ownerName}}\n平台：{{platformName}}\n{{cancellationFacts}}\n{{refundPolicy}}'};
export async function cancellationPaperFixture(){
 const f=await renewalCancellationFixture(),facts=await readRenewalCancellationFacts(f.tx,{changeId:f.change.id},renewalNow),reason='双方核对后取消尚未开始的续期';
 const sourceSnapshot={version:1,facts:facts.sourceSnapshot,cancellationPaper:await buildRenewalCancellationPaperSource(f.tx,facts,reason)};
 const record:any={id:'cancellation',orderId:f.order.id,customerId:f.customer.id,ownerId:f.owner.id,changeId:f.change.id,quoteId:f.quote.id,serviceStageId:null,revision:0,status:'OPEN',sourceSnapshot,sourceHash:canonicalHash(sourceSnapshot),reason,signatureState:'SIGNED',signatureVerifiedBy:'ops',signatureVerifiedAt:renewalNow,signatureEvidenceFileIds:[f.evidence.id],signatureNote:'实际核对双方签字',createdBy:'ops'};f.cases.push(record);
 return{...f,record};
}

/** Synthetic persisted evidence built through the real context and frozen-template renderer. No readiness stub. */
export async function addRenewalCancellationArchive(f:any,record:any){
 const tx=f.tx,template={...cancellationTemplate},oldTemplate=tx.legalDocument.findUnique;
 tx.legalDocument.findUnique=async(args:any)=>args.where.id===template.id?template:oldTemplate(args);
 const archive:any={id:'cancel-archive',kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:record.id,renewalCancellationId:record.id,orderId:record.orderId,ownerId:record.ownerId,handoverId:null,quoteId:null,revision:0,currentApprovedVersionId:'cancel-archive-v1',versions:[]};
 const context=await resolveRenewalCancellationContext(tx,archive),scope=freezeRenewalCancellationScope(context,template),source=f.source('cancel-print-source'),signed=f.source('cancel-signed-source');signed.purpose='offline-archive';
 const id=archive.currentApprovedVersionId,binding={versionId:id,fileId:signed.id,file:signed,position:1};
 const version:any={...structuredClone(f.rental.versions[0]),id,archiveId:archive.id,version:1,status:'ARCHIVED',invalidatedAt:null,invalidatedBy:null,templateId:template.id,templateVersion:template.version,businessSnapshotHash:record.sourceHash,partiesSnapshot:context.partiesSnapshot,requiredSigners:context.requiredSigners,scopeSnapshot:scope,sourceFileId:source.id,contractNumber:'SYN-CANCEL-2026',signedOn:'2026-10-31',files:[binding],fileManifestHash:validateManifest([binding]),partyChecks:context.partiesSnapshot.map((p:any)=>({role:p.role,partyId:p.partyId,signerName:p.name,signedOn:'2026-10-31',passed:true,signaturePageRefs:[{fileId:signed.id,page:1}],authorityFileIds:[]})),feedback:[]};
 archive.versions.push(version);f.archives.push(archive);
 const printCommand={id:'cancel-print-command',resourceId:archive.id,action:`CONFIRM_PRINT:${id}`,resultSnapshot:{sourceFileId:source.id}};f.commands.push(printCommand);
 const oldFind=tx.archiveCommand.findFirst;
 tx.archiveCommand.findFirst=async(args:any)=>args.where.resourceId===archive.id?f.commands.find((c:any)=>c.resourceId===archive.id&&c.action===args.where.action&&c.resultSnapshot?.sourceFileId===args.where.resultSnapshot?.equals)??null:oldFind(args);
 return{archive,version,template,context:{...context,scopeSnapshot:scope,cancellationContext:{...context.cancellationContext,scope}},printCommand};
}

export function cancellationArchiveService(f:any){
 const tx=f.tx,template={...cancellationTemplate},oldTemplate=tx.legalDocument.findUnique;
 tx.legalDocument.findUnique=async(args:any)=>args.where.id===template.id?template:oldTemplate(args);
 tx.documentArchive.create=async({data}:any)=>{const a={id:'new-cancel-archive',revision:0,versions:[],...data};f.archives.push(a);return a;};
 tx.archiveVersion.create=async({data}:any)=>{const v={id:'new-cancel-version-'+data.version,files:[],feedback:[],...data};f.archives.find((a:any)=>a.id===data.archiveId).versions.push(v);return v;};
 tx.archiveVersion.update=async({where,data}:any)=>{const v=f.archives.flatMap((a:any)=>a.versions).find((v:any)=>v.id===where.id);Object.assign(v,data);return v;};
 tx.storedFile.create=async({data}:any)=>{const file={id:'cancel-real-file-'+f.files.length,...data};f.files.push(file);return file;};
 tx.archiveFile.create=async({data}:any)=>{const binding={...data,file:f.files.find((f:any)=>f.id===data.fileId)},v=f.archives.flatMap((a:any)=>a.versions).find((v:any)=>v.id===data.versionId);v.files.push(binding);return binding;};
 tx.archiveFeedback={...tx.archiveFeedback,create:async({data}:any)=>{const row={id:'cancel-feedback',status:'OPEN',...data};f.archives.flatMap((a:any)=>a.versions).find((v:any)=>v.id===data.versionId).feedback.push(row);return row;},findFirst:async({where}:any)=>f.archives.filter((a:any)=>a.id===where.version.archiveId).flatMap((a:any)=>a.versions).flatMap((v:any)=>v.feedback).find((r:any)=>r.id===where.id)??null,update:async({where,data}:any)=>{const row=f.archives.flatMap((a:any)=>a.versions).flatMap((v:any)=>v.feedback).find((r:any)=>r.id===where.id);Object.assign(row,data);return row;}};
 const oldPrint=tx.archiveCommand.findFirst;
 tx.archiveCommand.findFirst=async(args:any)=>args.where.resourceId==='new-cancel-archive'?f.commands.find((c:any)=>c.resourceId===args.where.resourceId&&c.action===args.where.action&&c.resultSnapshot?.sourceFileId===args.where.resultSnapshot?.equals)??null:oldPrint(args);
 return{service:new ArchiveService(f.db as any,new ArchiveContextService()),template};
}
