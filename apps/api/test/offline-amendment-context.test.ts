import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAmendmentContext} from '../src/offline-documents/amendment-context';
import {agreementFixture} from './offline-change-agreement-fixture';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {ArchiveContextService} from '../src/offline-documents/context';

function setup(){const f=agreementFixture();for(const party of f.initial.partiesSnapshot)(party as any).name='冻结'+party.role;const c=f.addChange();return{f,c};}
test('amendment generation binds only the confirmed quote and its unchanged prior contract chain',async()=>{
 const {f,c}=setup(),before=JSON.stringify(f.order),r=await resolveAmendmentContext(f.tx,{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:c.quote.id});
 assert.equal(r.orderId,f.order.id);assert.equal(r.ownerId,'owner');assert.equal(r.quoteId,c.quote.id);assert.equal(r.businessSnapshotHash,c.quote.commercialHash);assert.equal(r.scopeSnapshot.quoteId,c.quote.id);assert.equal(r.scopeSnapshot.originalArchiveVersionId,f.rental.currentApprovedVersionId);assert.equal(r.amendmentContext.body,c.contract.body);assert.equal(r.amendmentContext.templateId,c.quote.snapshot.document.id);assert.equal(JSON.stringify(f.order),before);
});
function archiveSetup(){
 const {f,c}=setup();f.archives.splice(f.archives.indexOf(c.archive),1);c.contract.offlineArchiveId=null;
 const tx=f.tx,commands:any[]=[],actor={id:'operator',role:'OPERATIONS',authVersion:1};let allowed=true,templateStatus='PUBLISHED';
 tx.$queryRaw=async()=>[];tx.adminUser={findUnique:async()=>({id:actor.id,role:allowed?'OPERATIONS':'SUPPORT',active:true,authVersion:1})};
 tx.legalDocument={findUnique:async({where}:any)=>({id:where.id,type:'OFFLINE_ORDER_AMENDMENT',version:1,content:'template-text',status:templateStatus,confirmedBy:'legal',confirmedAt:new Date()})};
 tx.archiveCommand.findUnique=async({where}:any)=>commands.find(row=>row.key===where.actorId_resourceId_action_key.key)??null;
 tx.archiveCommand.create=async({data}:any)=>{commands.push(data);return data;};tx.auditLog={create:async()=>({})};
 tx.documentArchive.create=async({data}:any)=>{const a={id:'new-archive',revision:0,...data,versions:[]};f.archives.push(a);return a;};
 tx.archiveVersion={create:async({data}:any)=>{const v={id:'new-version',...data};f.archives.find(a=>a.id===data.archiveId)!.versions.push(v);return v;}};
 tx.contract.updateMany=async({where,data}:any)=>{assert.equal(where.id,c.contract.id);Object.assign(c.contract,data);return{count:1};};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,new ArchiveContextService());
 const input={kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:c.quote.id,templateId:c.quote.snapshot.document.id,revision:0,idempotencyKey:'create-specific-amendment'};
 return{f,c,service,actor,input,revoke:()=>{allowed=false;},retire:()=>{templateStatus='RETIRED';}};
}
test('a confirmed amendment can generate its exact approved template after it is retired',async()=>{
 const {c,service,actor,input,retire}=archiveSetup();retire();const result=await service.create(input,actor);assert.ok(result.versionId);assert.equal(c.contract.offlineArchiveId,result.archiveId);
});
test('creating a paper amendment binds the actual quote contract and preserves current authorization on replay',async()=>{
 const {f,c,service,actor,input,revoke}=archiveSetup();const created=await service.create(input,actor);
 assert.equal(c.contract.offlineArchiveId,created.archiveId);assert.equal(c.contract.status,'DRAFT');assert.equal(f.archives.find(a=>a.id===created.archiveId)!.quoteId,c.quote.id);
 c.change.status='APPLIED'; // replay is authorized history, not a fresh generation request.
 assert.deepEqual(await service.create(input,actor),created);assert.equal(f.archives.filter(a=>a.kind==='ORDER_AMENDMENT').length,1);
 revoke();await assert.rejects(service.create(input,actor),(e:any)=>e.getStatus?.()===403);
});
test('paper amendment cannot generate from another approved template than the accepted quote',async()=>{
 const {c,service,actor,input}=archiveSetup();await assert.rejects(service.create({...input,templateId:'different-template'},actor),(e:any)=>e.getResponse?.().error.code==='AMENDMENT_DOCUMENT_MISMATCH');assert.equal(c.contract.offlineArchiveId,null);
});
test('explicit paper archival advances only the matching confirmed change to finance and never signs its contract',async()=>{
 const {f,c}=setup(),tx=f.tx,actor={id:'operator',role:'OPERATIONS',authVersion:1},commands:any[]=[];
 c.archive.revision=0;c.change.revision=0;c.version.status='REVIEWED';c.archive.currentApprovedVersionId=null;
 tx.$queryRaw=async()=>[];tx.adminUser={findUnique:async()=>({id:actor.id,role:actor.role,active:true,authVersion:1})};tx.auditLog={create:async()=>({})};
 tx.archiveCommand.findUnique=async({where}:any)=>commands.find(row=>row.key===where.actorId_resourceId_action_key.key)??null;tx.archiveCommand.create=async({data}:any)=>{commands.push(data);return data;};
 tx.archiveVersion={update:async({data}:any)=>Object.assign(c.version,data)};
 tx.documentArchive.update=async({data}:any)=>{if(data.revision)c.archive.revision++;if(data.currentApprovedVersionId)c.archive.currentApprovedVersionId=data.currentApprovedVersionId;return c.archive;};
 tx.orderChange.updateMany=async({where,data}:any)=>{assert.equal(where.id,c.change.id);assert.equal(where.activeQuoteId,c.quote.id);assert.equal(where.status,'AWAITING_ARCHIVE');c.change.status=data.status;c.change.revision++;return{count:1};};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,new ArchiveContextService()),input={versionId:c.version.id,revision:0,idempotencyKey:'explicit-archive-amendment'};
 const result=await service.archive(c.archive.id,input,actor);assert.equal(result.status,'ARCHIVED');assert.equal(c.change.status,'AWAITING_FINANCE');assert.equal(c.change.revision,1);assert.equal(c.contract.status,'DRAFT');assert.equal(c.quote.approvedArchiveVersionId,null);
 assert.deepEqual(await service.archive(c.archive.id,input,actor),result);assert.equal(c.change.revision,1);
});
test('amendment generation rejects stale quotes, wrong subjects, changed prior terms and incomplete original evidence',async()=>{
 for(const mutate of [(f:any,c:any)=>c.change.activeQuoteId='other',(f:any,c:any)=>c.quote.status='PUBLISHED',(f:any,c:any)=>c.change.customerId='other',(f:any,c:any)=>c.change.priorTermsHash='a'.repeat(64),(f:any)=>f.rental.versions[0].status='REVIEWED',(f:any,c:any)=>c.contract.body+='tampered',(f:any,c:any)=>c.change.targetVehicleId='']){
  const {f,c}=setup();mutate(f,c);await assert.rejects(resolveAmendmentContext(f.tx,{kind:'ORDER_AMENDMENT',subjectType:'ORDER_CHANGE_QUOTE',subjectId:c.quote.id}),(e:any)=>e.getStatus?.()===409);
 }
 const {f,c}=setup();await assert.rejects(resolveAmendmentContext(f.tx,{kind:'RENTAL',subjectType:'ORDER_CHANGE_QUOTE',subjectId:c.quote.id}),(e:any)=>e.getStatus?.()===400);
});
