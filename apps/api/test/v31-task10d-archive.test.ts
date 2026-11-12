import test from 'node:test';import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {activeSwapFixture} from './v31-swap-fixture';
import {OwnerH5Service} from '../src/owner-h5/service';
import {readPartnerOrderWorkspace} from '../src/partners/order-workspace';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {tokenHash} from '../src/auth/auth.service';
test('10d verified electronic readonly archive and actual current stage remain exact and deny private drafts',async()=>{
 const h=new JourneyHarness();await h.start();try{
 Object.assign(process.env,{CONTRACT_CJK_FONT_PATH:'C:/Windows/Fonts/msyh.ttc',CONTRACT_CJK_FONT_FACE:'MicrosoftYaHei',CONTRACT_CJK_BOLD_FONT_PATH:'C:/Windows/Fonts/msyhbd.ttc',CONTRACT_CJK_BOLD_FONT_FACE:'MicrosoftYaHei-Bold'});
 const fixture=await activeSwapFixture(h.db,{actualDeliveryAt:'2026-11-07T01:00:00Z',configureTerms:(terms,customer)=>{
 terms.lessorSnapshot.sharingNotice={contentHash:'a'.repeat(64)};terms.ownerDataConsent={ownerId:terms.lessorSnapshot.ownerId,customerId:customer.id,acceptedAt:new Date().toISOString(),lessorHash:lessorIdentityHash(terms.lessorSnapshot),notice:{contentHash:'a'.repeat(64)}};
 }}),ownerId=fixture.f.owner.id,orderId=fixture.sub.order.id;
 const mobile='139'+randomInt(10000000,99999999),anon={id:'anonymous',headers:{Origin:h.origin}};
 const invite=await h.post(`/admin/partners/${ownerId}/company-admin/invitation`,{mobile,...command()});
 const preview=await h.post('/owner-h5/auth/invitation/preview',{mobile,invitationCode:invite.invitationCode},anon);
 const response=await fetch(`${h.base}/api/owner-h5/auth/invitation/confirm`,{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify({previewToken:preview.previewToken,consents:['terms','privacy'].map(t=>({documentId:h.docs[t].id,version:h.docs[t].version}))})});const session:any=await response.json();assert.equal(response.status,201,JSON.stringify(session));
 const cookie=response.headers.get('set-cookie')!.split(';')[0],login={id:'synthetic-viewer',headers:{Cookie:cookie,Origin:h.origin,'X-CSRF-Token':session.csrfToken}};
 const portalSession=await h.db.partnerPortalSession.findUniqueOrThrow({where:{id:tokenHash(cookie.split('=')[1])}});
 const current=await h.db.serial(tx=>readPartnerOrderWorkspace(tx,portalSession as any,ownerId,orderId,new Date('2026-11-08T10:00:00Z')));
 assert.ok(current.originalContract?.archive,'verified electronic archive must be projected');assert.ok(current.currentPeriod?.serviceStageId,'current period must use actual completed delivery/stage '+JSON.stringify(current));assert.equal(current.readOnly,true);
 const agreements=await h.get(`/owner-h5/owners/${ownerId}/agreements`,login);assert.ok(agreements.items[0].files.length,'electronic cooperation fileIds empty but final proof supplies PDF');
 const a=agreements.items[0],pdf=await fetch(`${h.base}/api/owner-h5/owners/${ownerId}/agreements/${a.id}/files/${a.files[0].id}`,{headers:login.headers});assert.equal(pdf.status,200);assert.ok((await pdf.arrayBuffer()).byteLength>100);
 await h.reject(`/owner-h5/owners/${ownerId}/electronic-documents/${fixture.prepared.taskId}/sign`,{},login,'PARTNER_READ_ONLY');
 assert.equal((await fetch(`${h.base}/api/owner-h5/owners/${ownerId}/electronic-documents/${fixture.prepared.taskId}`,{headers:login.headers})).status,404);
 const foreign=await fetch(`${h.base}/api/owner-h5/owners/foreign/agreements/${a.id}/files/${a.files[0].id}`,{headers:login.headers});assert.equal(foreign.status,403);
 const archiveId=current.originalContract!.archive!.id,versionId=current.originalContract!.archive!.currentApprovedVersionId!;
 const archive=await h.get(`/owner-h5/owners/${ownerId}/offline-archives/${archiveId}`,login);const fileId=archive.versions.find((v:any)=>v.id===versionId).files[0].id;
 const fileRoute=`${h.base}/api/owner-h5/owners/${ownerId}/offline-archives/${archiveId}/versions/${versionId}/files/${fileId}`;
 assert.equal((await fetch(fileRoute,{headers:login.headers})).status,200);
 await assert.rejects(h.db.storedFile.update({where:{id:fileId},data:{sha256:'0'.repeat(64)}}),'existing composite foreign key forbids changing final file evidence');
 assert.equal((await fetch(fileRoute,{headers:login.headers})).status,200);
 const task=await h.db.electronicSigningTask.findUniqueOrThrow({where:{cooperationVersionId:fixture.f.draft.latestVersion.id}}),source=await h.db.storedFile.findUniqueOrThrow({where:{id:task.sourceFileId}});
 writeFileSync('../../.runtime/task10d-ui-source.json',JSON.stringify({synthetic:true,pdfPath:source.storagePath,ownerId,orderId,current,agreements}));
 }finally{await h.close();}
});
