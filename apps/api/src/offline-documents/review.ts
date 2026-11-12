import {ensure} from '../common/errors';
import {assertFileBinding,validateManifest} from './files';
export function assertApproval(version:any,input:any,actorId:string,currentHash:string){
 ensure(version.businessSnapshotHash===currentHash,409,'ARCHIVE_SNAPSHOT_MISMATCH','业务快照已变更');
 ensure(['SUBMITTED','REVIEWED'].includes(version.status),409,'STATE_CONFLICT','仅已提交材料可审核或归档');
 for(const file of version.files)assertFileBinding(version,file);
 const roles=version.requiredSigners as string[],parties=version.partiesSnapshot as any[];
 const checks=['partiesComplete','authorityChecked','pagesComplete','vehicleMatches','termsMatch','annexesComplete','legible'];
 ensure(input.reason?.trim()&&checks.every(key=>input.checklist?.[key]===true),409,'ARCHIVE_CHECKLIST_REQUIRED','审核检查项及说明不完整');
 ensure(input.partyChecks.length===roles.length&&new Set(input.partyChecks.map((p:any)=>p.role)).size===roles.length,409,'ARCHIVE_PARTIES_REQUIRED','必签署方核查不完整');
 for(const role of roles){const check=input.partyChecks.find((p:any)=>p.role===role),party=parties.find(p=>p.role===role);ensure(check&&party&&check.partyId===party.partyId&&check.passed===true&&check.signaturePageRefs?.length&&check.signaturePageRefs.every((r:any)=>version.files.some((f:any)=>f.fileId===r.fileId)&&r.page>0&&r.page<=version.declaredPages)&&(check.authorityFileIds||[]).every((id:string)=>version.files.some((f:any)=>f.fileId===id)),409,'ARCHIVE_PARTIES_REQUIRED','签署主体、签章页或授权附件不匹配');}
 ensure(version.fileManifestHash===validateManifest(version.files),409,'ARCHIVE_SNAPSHOT_MISMATCH','提交文件清单已变更');
}
