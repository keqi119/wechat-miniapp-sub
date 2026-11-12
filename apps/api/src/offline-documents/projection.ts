import {readableFileName} from '../files/filename';
import {ArchiveActor} from './schemas';
export function canReadArchive(actor:ArchiveActor,archive:any,version:any){
 if(archive.kind==='OWNER_COOPERATION'&&['ADMIN','OPERATIONS','FINANCE','SUPPORT'].includes(actor.role))return !!actor.partnerCapabilities?.includes('partner.cooperation.read');
 if(['ADMIN','OPERATIONS'].includes(actor.role))return true;
 if(!['ARCHIVED','INVALIDATED'].includes(version.status))return false;
 if(actor.role==='CUSTOMER')return archive.kind!=='OWNER_COOPERATION'&&archive.customerId===(actor.customerId||actor.id);
 if(actor.role==='OWNER')return !!actor.ownerId&&archive.ownerId===actor.ownerId;
 return false;
}
/** Cooperation lookup grants summaries, not personal legal documents, to other staff. */
export function canReadArchiveFiles(actor:ArchiveActor,archive:any,version:any){
 if(!canReadArchive(actor,archive,version))return false;
 const personal=archive.kind==='OWNER_COOPERATION'&&(version.partiesSnapshot||[]).some((p:any)=>p.subjectType==='INDIVIDUAL'||p.identityNumber);
 return !personal||['ADMIN','OPERATIONS','OWNER','CUSTOMER'].includes(actor.role);
}
export function archiveSummary(archive:any,currentHash:string,actor?:ArchiveActor){
 const external=actor?.role==='OWNER'||actor?.role==='CUSTOMER';
 const versions=(archive.versions||[]).filter((v:any)=>!external||canReadArchive(actor!,archive,v));
 const current=versions.find((v:any)=>v.id===archive.currentApprovedVersionId),latest=[...versions].sort((a:any,b:any)=>(b.version||0)-(a.version||0)).find((v:any)=>v.id!==archive.currentApprovedVersionId);
 const ready=current?.status==='ARCHIVED'&&current.businessSnapshotHash===currentHash;
 const shown=ready?current:latest||current;
 return{id:archive.id,kind:archive.kind,revision:archive.revision,executionMode:'OFFLINE' as const,status:ready?'ARCHIVED':shown?.status||(external?'UNAVAILABLE':'DRAFT'),currentApprovedVersionId:current?.id||null,...(latest&&!external?{pendingVersionStatus:latest.status}:{}),canRead:!!shown&&(actor?canReadArchive(actor,archive,shown):!!ready),blockers:ready?[]:[current?'ARCHIVE_SNAPSHOT_MISMATCH':'OFFLINE_ARCHIVE_REQUIRED']};
}
export function safeArchive(archive:any,currentHash:string,actor:ArchiveActor){return{...archiveSummary(archive,currentHash,actor),versions:(archive.versions||[]).filter((v:any)=>canReadArchive(actor,archive,v)).map((v:any)=>({id:v.id,version:v.version,status:v.status,signedOn:v.signedOn,contractNumber:v.contractNumber,files:(v.files||[]).map((f:any)=>({id:f.fileId,position:f.position,name:readableFileName(f.file.name),mimeType:f.file.mimeType,size:f.file.size,sha256:f.file.sha256}))}))};}
