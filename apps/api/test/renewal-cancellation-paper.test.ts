import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSchema} from '../src/offline-documents/schemas';
import {buildOfflinePrintModel} from '../src/offline-documents/print';

test('renewal cancellation uses its own case subject, not an order termination or quote archive',()=>{
 assert.equal(createSchema.safeParse({kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:'case-1',templateId:'cancel-template',revision:0,idempotencyKey:'cancel-paper-create'}).success,true);
});
test('a generic order print cannot be used as a renewal cancellation signing document',()=>{
 const context={requiredSigners:['CUSTOMER','OWNER','PLATFORM'],partiesSnapshot:[{role:'CUSTOMER',partyId:'customer',name:'合成客户'},{role:'OWNER',partyId:'owner',name:'合成出租方'},{role:'PLATFORM',partyId:'platform',name:'合成平台'}],scopeSnapshot:{},businessSnapshot:{}};
 assert.throws(()=>buildOfflinePrintModel({archive:{id:'archive',kind:'RENEWAL_CANCELLATION'},version:{version:1,businessSnapshotHash:'a'.repeat(64)},template:{id:'t',version:1,title:'取消',content:'普通正文'},context}), (e:any)=>e.getStatus?.()===409);
});
import {renewalCancellationFixture} from './order-renewals-cancellation-fixture';
import {readRenewalCancellationFacts} from '../src/order-renewals/cancellation-facts';
import {buildRenewalCancellationPaperSource,readRenewalCancellationPaper,requireRenewalCancellationAgreement} from '../src/order-renewals/cancellation-paper';
import {renewalNow} from './order-renewals-fixture';
import {canonicalHash} from '../src/customers/types';
import {cancellationPaperFixture,addRenewalCancellationArchive,cancellationArchiveService} from './renewal-cancellation-paper-fixture';
import {ArchiveContextService} from '../src/offline-documents/context';
import {requireCancellationPaperCurrent,renderRenewalCancellationBody} from '../src/order-renewals/cancellation-paper';
import {renewalOps,renewalFinance} from './order-renewals-fixture';
import {buildRenewalCancellationMutualAgreement} from '../src/order-renewals/cancellation-timing';

test('the real original SUBSCRIPTION contract and exact historical paper number remain the cancellation source',async()=>{
 const f=await renewalCancellationFixture();assert.equal(f.original.kind,'SUBSCRIPTION');
 const facts=await readRenewalCancellationFacts(f.tx,{changeId:f.change.id},renewalNow),paper=await buildRenewalCancellationPaperSource(f.tx,facts,'合成取消原因');
 assert.equal(paper.original.contractNumber,'REAL-RENTAL-2026');assert.equal(paper.renewal.bodyHash,f.quote.snapshot.document.bodyHash);assert.equal(paper.identity.quoteId,f.quote.id);
 f.rental.versions[0].status='INVALIDATED';
 assert.deepEqual(await buildRenewalCancellationPaperSource(f.tx,facts,'合成取消原因'),paper);
});

test('a complete real cancellation archive validates without rewriting the case, quote or money',async()=>{
 const f=await cancellationPaperFixture(),a=await addRenewalCancellationArchive(f,f.record),before=structuredClone(f.record),writes=f.writes.length;
 const result=await requireRenewalCancellationAgreement(f.tx,f.record.id);
 assert.equal(result.archiveId,a.archive.id);assert.equal(result.archiveVersionId,a.version.id);assert.equal(result.businessHash,f.record.sourceHash);assert.equal(result.scopeHash,canonicalHash(a.version.scopeSnapshot));
 assert.deepEqual(f.record,before);assert.equal(f.writes.length,writes);
 const print=buildOfflinePrintModel({archive:a.archive,version:a.version,template:a.template,context:a.context});
 assert.equal(print.signers.length,3);assert.match(print.body,/REAL-RENTAL-2026/);assert.match(print.body,/晚到/);assert.match(print.body,/不收取取消费/);assert.match(print.body,/原押金/);assert.ok(print.body.includes(f.quote.id));
});

test('completed paper reads the immutable original quote and pinned cancellation version after current terms change',async()=>{
 const f=await cancellationPaperFixture(),a=await addRenewalCancellationArchive(f,f.record),proof=await requireRenewalCancellationAgreement(f.tx,f.record.id);
 Object.assign(f.record,{status:'COMPLETED',terminationArchiveId:proof.archiveId,approvedArchiveVersionId:proof.archiveVersionId,terminationArchiveHash:proof.terminationArchiveHash});f.change.status='CANCELLED';f.order.effectiveTermsVersionId='unrelated-later-terms';
 assert.deepEqual(await requireRenewalCancellationAgreement(f.tx,f.record.id),proof);
 await assert.rejects(()=>new ArchiveContextService().resolve(f.tx,a.archive,a.version.scopeSnapshot),(e:any)=>e.getStatus?.()===409);
});

test('UNKNOWN, UNSIGNED and start-day generation fail; opening alone is not mutual cancellation evidence',async()=>{
 const f=await cancellationPaperFixture(),paper=f.record.sourceSnapshot.cancellationPaper;
 for(const state of ['UNKNOWN','UNSIGNED'])await assert.rejects(()=>requireCancellationPaperCurrent(f.tx,{...f.record,signatureState:state},paper,renewalNow));
 await assert.rejects(()=>requireCancellationPaperCurrent(f.tx,f.record,paper,new Date(paper.renewal.startDate+'T00:00:00+08:00')));
});

test('opening before renewal signed upload does not permanently block a later signed cancellation',async()=>{
 const f=await renewalCancellationFixture();f.unsigned();
 const facts=await readRenewalCancellationFacts(f.tx,{changeId:f.change.id},renewalNow),p=await buildRenewalCancellationPaperSource(f.tx,facts,'先冻结真实续期报价');
 assert.equal(p.renewal.contractId,f.contract.id);assert.ok(!Object.hasOwn(p.renewal,'contractNumber'));
});

test('new paper rejects template substitution, unsupported placeholders, missing fact groups and tampered source',async()=>{
 const f=await cancellationPaperFixture(),a=await addRenewalCancellationArchive(f,f.record);
 for(const content of ['通用文本','{{cancellationFacts}} {{refundPolicy}} {{unknown}}'])assert.throws(()=>renderRenewalCancellationBody(content,f.record.sourceSnapshot.cancellationPaper));
 a.template.content+=' changed';await assert.rejects(()=>requireRenewalCancellationAgreement(f.tx,f.record.id));a.template.content=a.template.content.replace(' changed','');
 f.record.sourceSnapshot.cancellationPaper.reason='篡改';await assert.rejects(()=>readRenewalCancellationPaper(f.tx,f.record.id));
});

test('cross-case archives, missing print confirmation, open feedback, asset evidence and incomplete three-party signatures cannot finalize',async()=>{
 for(const mutation of [
  (f:any,a:any)=>{a.archive.renewalCancellationId='other';},
  (f:any,a:any)=>{f.commands.splice(f.commands.indexOf(a.printCommand),1);},
  (f:any,a:any)=>{a.version.feedback.push({status:'OPEN'});},
  (f:any,a:any)=>{f.assetIds.add(a.version.files[0].fileId);},
  (f:any,a:any)=>{a.version.partyChecks.pop();},
  (f:any,a:any)=>{delete a.version.partyChecks[0].signerName;},
  (f:any,a:any)=>{a.version.status='REVIEWED';},
 ]){const f=await cancellationPaperFixture(),a=await addRenewalCancellationArchive(f,f.record);mutation(f,a);await assert.rejects(()=>requireRenewalCancellationAgreement(f.tx,f.record.id));}
});

test('actual ArchiveService creates a cancellation FK and frozen template without binding the original renewal contract',async()=>{
 const f=await cancellationPaperFixture(),{service,template}=cancellationArchiveService(f),contractBefore=structuredClone(f.contract),caseBefore=structuredClone(f.record);
 const body={kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:f.record.id,templateId:template.id,revision:0,idempotencyKey:'paper-create-real'};
 const result=await service.create(body,renewalOps),archive:any=f.archives.find(a=>a.id===result.archiveId),v=archive.versions[0];
 assert.equal(archive.renewalCancellationId,f.record.id);assert.equal(archive.quoteId,undefined);assert.equal(archive.handoverId,null);assert.equal(v.scopeSnapshot.document.templateId,template.id);assert.equal(v.businessSnapshotHash,f.record.sourceHash);assert.deepEqual(f.contract,contractBefore);assert.deepEqual(f.record,caseBefore);
 f.record.status='COMPLETED';assert.deepEqual(await service.create(body,renewalOps),result);
 await assert.rejects(()=>service.newVersion(archive.id,{templateId:template.id,revision:archive.revision,idempotencyKey:'after-complete-new'},renewalOps));
 await assert.rejects(()=>service.create(body,renewalFinance),(e:any)=>e.getStatus?.()===403);
});

test('new paper creation rejects draft/retired templates and mismatched kind/subject before producing a version',async()=>{
 for(const status of ['DRAFT','RETIRED']){const f=await cancellationPaperFixture(),{service,template}=cancellationArchiveService(f);template.status=status;
  await assert.rejects(()=>service.create({kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:f.record.id,templateId:template.id,revision:0,idempotencyKey:'bad-template-'+status},renewalOps),(e:any)=>e.getResponse?.().error.code==='LEGAL_NOT_APPROVED');
 }
 const f=await cancellationPaperFixture(),{service,template}=cancellationArchiveService(f);
 await assert.rejects(()=>service.create({kind:'RENEWAL_CANCELLATION',subjectType:'ORDER',subjectId:f.order.id,templateId:template.id,revision:0,idempotencyKey:'wrong-paper-subject'},renewalOps));
});

test('explicit archive verifies complete cancellation evidence but leaves the case pin and completion to finalize',async()=>{
 const f=await cancellationPaperFixture(),a=await addRenewalCancellationArchive(f,f.record),{service}=cancellationArchiveService(f);a.version.status='SUBMITTED';a.archive.currentApprovedVersionId=null;
 const before=structuredClone(f.record),result=await service.review(a.archive.id,{versionId:a.version.id,revision:a.archive.revision,idempotencyKey:'paper-real-review',decision:'APPROVE',checklist:a.version.reviewChecklist,partyChecks:a.version.partyChecks,reason:'逐项核准真实三方签字'},renewalOps);
 assert.equal(result.status,'REVIEWED');
 const receipt=await service.archive(a.archive.id,{versionId:a.version.id,revision:a.archive.revision,idempotencyKey:'paper-real-archive'},renewalOps);
 assert.equal(receipt.status,'ARCHIVED');assert.equal(a.archive.currentApprovedVersionId,a.version.id);assert.deepEqual(f.record,before);assert.equal(f.change.status,'AWAITING_FINANCE');
 assert.equal((await requireRenewalCancellationAgreement(f.tx,f.record.id)).archiveVersionId,a.version.id);
});

test('verified actual mutual consent before start permits later paperwork without changing the opening body',async()=>{
 const f=await cancellationPaperFixture(),paper=f.record.sourceSnapshot.cancellationPaper,body=renderRenewalCancellationBody('{{cancellationFacts}}\n{{refundPolicy}}',paper),boundary=new Date(paper.renewal.startDate+'T00:00:00+08:00'),after=new Date(boundary.getTime()+86400000);
 Object.assign(f.record,await buildRenewalCancellationMutualAgreement(f.tx,f.record,{startDate:paper.renewal.startDate,mutuallyAgreedAt:new Date(boundary.getTime()-1000).toISOString(),evidenceFileIds:[f.evidence.id],note:'双方起租前真实同意，之后核实留证'},renewalOps,after));
 await requireCancellationPaperCurrent(f.tx,f.record,paper,after);
 assert.equal(renderRenewalCancellationBody('{{cancellationFacts}}\n{{refundPolicy}}',paper),body);
});

test('current paper cannot continue after the renewal has already applied, regardless of an OPEN case',async()=>{
 const f=await cancellationPaperFixture();f.change.status='APPLIED';
 await assert.rejects(async()=>requireCancellationPaperCurrent(f.tx,f.record,f.record.sourceSnapshot.cancellationPaper,renewalNow));
});

test('actual prepare, confirm-print, upload, submit, review and explicit archive complete with synthetic bytes and no case side effect',async()=>{
 const f=await cancellationPaperFixture(),{service,template}=cancellationArchiveService(f),caseBefore=structuredClone(f.record);
 const receipt=await service.create({kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:f.record.id,templateId:template.id,revision:0,idempotencyKey:'pipeline-create-paper'},renewalOps),a:any=f.archives.find(a=>a.id===receipt.archiveId),v=a.versions[0];
 const command=(key:string)=>({revision:a.revision,idempotencyKey:key});
 await service.patch(a.id,v.id,{...command('pipeline-metadata'),contractNumber:'SYN-CANCEL-PIPELINE',signedOn:'2026-10-31',declaredPages:1},renewalOps);
 const oldFont=process.env.CONTRACT_CJK_FONT_PATH;process.env.CONTRACT_CJK_FONT_PATH='C:/Windows/Fonts/simhei.ttf';
 try{await service.prepare(a.id,v.id,command('pipeline-prepare'),renewalOps);}finally{if(oldFont===undefined)delete process.env.CONTRACT_CJK_FONT_PATH;else process.env.CONTRACT_CJK_FONT_PATH=oldFont;}
 const file={buffer:Buffer.from('%PDF-1.4 synthetic cancellation signature evidence'),mimetype:'application/pdf',originalname:'synthetic-signature.pdf'} as Express.Multer.File;
 await assert.rejects(()=>service.upload(a.id,v.id,{...command('pipeline-before-confirm'),position:1},file,renewalOps),(e:any)=>e.getResponse?.().error.code==='ARCHIVE_PRINT_CONFIRMATION_REQUIRED');
 await service.confirmPrint(a.id,v.id,command('pipeline-confirm-print'),renewalOps);
 const uploaded=await service.upload(a.id,v.id,{...command('pipeline-upload'),position:1},file,renewalOps);
 await service.submit(a.id,{...command('pipeline-submit'),versionId:v.id},renewalOps);
 await service.review(a.id,{...command('pipeline-review'),versionId:v.id,decision:'APPROVE',reason:'合成材料逐项核准',checklist:f.rental.versions[0].reviewChecklist,partyChecks:v.partiesSnapshot.map((p:any)=>({role:p.role,partyId:p.partyId,signerName:p.name,signedOn:'2026-10-31',passed:true,signaturePageRefs:[{fileId:uploaded.id,page:1}],authorityFileIds:[]}))},renewalOps);
 await service.archive(a.id,{...command('pipeline-archive'),versionId:v.id},renewalOps);
 assert.equal((await requireRenewalCancellationAgreement(f.tx,f.record.id)).archiveVersionId,v.id);assert.deepEqual(f.record,caseBefore);
 const replay={...command('pipeline-completed-replay'),contractNumber:'SYN-CANCEL-PIPELINE'};
 await assert.rejects(()=>service.patch(a.id,v.id,replay,renewalOps));
 f.staff.get('ops')!.active=false;
 await assert.rejects(()=>service.create({kind:'RENEWAL_CANCELLATION',subjectType:'ORDER_RENEWAL_CANCELLATION',subjectId:f.record.id,templateId:template.id,revision:0,idempotencyKey:'pipeline-create-paper'},renewalOps),(e:any)=>[401,403].includes(e.getStatus?.()));
});

test('a customer can raise a historical paper question after completion and current operations can resolve it without reopening cancellation',async()=>{
 const f=await cancellationPaperFixture(),a=await addRenewalCancellationArchive(f,f.record),{service}=cancellationArchiveService(f),pin=await requireRenewalCancellationAgreement(f.tx,f.record.id);
 Object.assign(f.record,{status:'COMPLETED',terminationArchiveId:pin.archiveId,approvedArchiveVersionId:pin.archiveVersionId,terminationArchiveHash:pin.terminationArchiveHash});f.change.status='CANCELLED';const before=structuredClone(f.record);
 const feedback=await service.feedback(a.archive.id,{versionId:a.version.id,message:'合成历史纸档问题',idempotencyKey:'completed-customer-question'},{id:f.customer.id,role:'CUSTOMER'});
 const result=await service.resolveFeedback(a.archive.id,feedback.id,{revision:a.archive.revision,idempotencyKey:'completed-question-resolve',resolution:'已逐项核对并回复历史资料问题'},renewalOps);
 assert.equal(result.status,'RESOLVED');assert.deepEqual(f.record,before);assert.equal(f.change.status,'CANCELLED');
 await assert.rejects(()=>service.newVersion(a.archive.id,{templateId:a.template.id,revision:a.archive.revision,idempotencyKey:'completed-still-no-version'},renewalOps));
});

test('a prepared stage remains bound to its actual frozen snapshot after opening, not merely its row ID',async()=>{
 const f=await renewalCancellationFixture(true),facts=await readRenewalCancellationFacts(f.tx,{changeId:f.change.id},renewalNow),paper=await buildRenewalCancellationPaperSource(f.tx,facts,'保留真实预备期');
 assert.equal(paper.identity.stageId,f.stage.id);f.stage.snapshotHash='a'.repeat(64);
 await assert.rejects(()=>buildRenewalCancellationPaperSource(f.tx,facts,'保留真实预备期'));
});
