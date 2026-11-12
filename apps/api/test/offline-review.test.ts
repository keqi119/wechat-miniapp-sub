import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertApproval} from '../src/offline-documents/review';
import {ArchiveService} from '../src/offline-documents/archive.service';
const checks={partiesComplete:true,authorityChecked:true,pagesComplete:true,vehicleMatches:true,termsMatch:true,annexesComplete:true,legible:true,originalRecorded:true};
const files=[{versionId:'v',position:1,uploadedBy:'uploader',fileId:'f',file:{id:'f',size:5,mimeType:'application/pdf',sha256:'a'.repeat(64)}}];
const parties=['CUSTOMER','OWNER','PLATFORM'].map(role=>({role,partyId:role,signerName:'签署人',signedOn:'2026-10-27',signaturePageRefs:[{fileId:'f',page:1}],passed:true}));
const version:any={id:'v',archiveId:'a',status:'SUBMITTED',businessSnapshotHash:'h',fileManifestHash:null,declaredPages:3,submittedBy:'submitter',requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:parties.map(p=>({role:p.role,partyId:p.partyId})),files};
const approval:any={checklist:checks,partyChecks:parties,reason:'全文及三方签章已逐项核验'};
test('missing_any_rental_party_blocks_review',()=>{for(const role of ['CUSTOMER','OWNER','PLATFORM'])assert.throws(()=>assertApproval({...version,fileManifestHash:undefined}, {...approval,partyChecks:parties.filter(p=>p.role!==role)},'reviewer','h'),(e:any)=>e.getResponse().error.code==='ARCHIVE_PARTIES_REQUIRED');});
test('uploader_or_submitter_can_review_complete_immutable_materials',()=>{for(const id of ['uploader','submitter'])assert.doesNotThrow(()=>assertApproval({...version,fileManifestHash:validateManifest(files)},approval,id,'h'));});
test('stale_manifest_or_terms_blocks_approval',()=>{assert.throws(()=>assertApproval(version,approval,'reviewer','changed'),(e:any)=>e.getResponse().error.code==='ARCHIVE_SNAPSHOT_MISMATCH');assert.throws(()=>assertApproval({...version,fileManifestHash:'stale'},approval,'reviewer','h'),(e:any)=>e.getResponse().error.code==='ARCHIVE_SNAPSHOT_MISMATCH');assert.throws(()=>assertApproval(version,{...approval,partyChecks:parties.map(p=>({...p,signaturePageRefs:[{fileId:'wrong-version',page:1}]}))},'reviewer','h'),(e:any)=>e.getResponse().error.code==='ARCHIVE_PARTIES_REQUIRED');});

import {validateManifest} from '../src/offline-documents/files';
test('complete_three_party_review_accepts_immutable_manifest',()=>{assert.doesNotThrow(()=>assertApproval({...version,fileManifestHash:validateManifest(files)},approval,'reviewer','h'));});
test('rental_approval_waits_for_explicit_archive_without_faking_esign',async()=>{
 const v={...version,fileManifestHash:validateManifest(files)},archive:any={id:'a',kind:'RENTAL',orderId:'o',revision:3,versions:[v],currentApprovedVersionId:null};let stage='AWAITING_CONTRACT_REVIEW';
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({active:true,role:'OPERATIONS'})},documentArchive:{findUnique:async()=>archive,update:async({data}:any)=>{if(data.currentApprovedVersionId)archive.currentApprovedVersionId=data.currentApprovedVersionId;}},archiveVersion:{update:async()=>({})},archiveCommand:{findUnique:async()=>null,create:async()=>({})},order:{updateMany:async({data}:any)=>{stage=data.status;return{count:1};}},auditLog:{create:async()=>({})}};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,{resolve:async()=>({businessSnapshotHash:'h'})} as any);
 await service.review('a',{versionId:'v',revision:3,idempotencyKey:'approve-once',decision:'APPROVE',...approval},{id:'reviewer',role:'OPERATIONS'});
 assert.equal(archive.currentApprovedVersionId,null);assert.equal(stage,'AWAITING_CONTRACT_REVIEW');
});
