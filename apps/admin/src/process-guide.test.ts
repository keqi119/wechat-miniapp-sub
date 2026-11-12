import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archiveProcess,insuranceProcess,productProcess,partnerProcess,returnProcess,handoverProcess,runCommittedCommand} from './process-guide-model.ts';
import {contractWorkflow} from './contract-workflow-model.ts';

test('superseded drafts are readable history and do not invent signed or completed stages',()=>{
 const flow=contractWorkflow({id:'old',status:'SUPERSEDED',templateId:'t',files:[]});
 assert.equal(flow.known,true);assert.equal(flow.superseded,true);assert.equal(flow.archived,false);assert.equal(flow.rejected,false);
 assert.equal(flow.current,'generate');assert.equal(flow.materialsComplete,false);
 assert.equal(flow.steps.find(step=>step.key==='signed')?.done,false);assert.equal(flow.steps.find(step=>step.key==='archive')?.enabled,false);
});

test('archive guide permits ADMIN to review own ordinary records without reusing old approval',()=>{
 const p=archiveProcess({id:'a',kind:'RENTAL',versions:[{id:'v2',version:2,status:'SUBMITTED',submittedBy:'me',sourceFileId:'print',files:[{fileId:'f',uploadedBy:'me'}],signedOn:'2026-10-29',contractNumber:'n',originalCustodian:'x',originalLocation:'y',declaredPages:1},{id:'v1',version:1,status:'ARCHIVED'}]},'me',true,'ADMIN');
 assert.equal(p.currentStep,'signed');assert.equal(p.steps.find(s=>s.key==='archive')?.state,'WAITING');assert.equal(p.blockers.length,0);assert.equal(p.primaryAction?.kind,'OPEN_FORM');
});
test('contract draft requires source preview confirmation before materials, while reviewed requires explicit archival',()=>{
 const draft={id:'a',kind:'RENTAL',versions:[{id:'v',version:1,status:'DRAFT',templateId:'t',templateVersion:1,sourceFileId:'source',files:[],contractNumber:'a'}]};
 const unconfirmed=archiveProcess(draft,'me',true);assert.equal(unconfirmed.currentStep,'preview');assert.equal(unconfirmed.steps.find(s=>s.key==='signed')?.state,'WAITING');
 const confirmed=archiveProcess({...draft,versions:[{...draft.versions[0],printConfirmed:true}]},'me',true);assert.equal(confirmed.currentStep,'signed');
 const reviewed=archiveProcess({...draft,versions:[{...draft.versions[0],status:'REVIEWED'}]},'me',true);assert.equal(reviewed.currentStep,'archive');assert.equal(reviewed.steps.find(s=>s.key==='archive')?.state,'CURRENT');assert.equal(reviewed.primaryAction?.key,'archive-archive-v');
});
test('insurance distinguishes uploaded files from files selected into current version',()=>{
 const p=insuranceProcess({id:'i',files:[{fileId:'uploaded'}],versions:[{id:'v',version:1,status:'DRAFT',fileIds:[],vehicleIds:['car']}]},'staff',true,new Date('2026-10-29'));
 assert.equal(p.currentStep,'originals');assert.match(p.blockers.map(b=>b.description).join(' '),/选入|选择/);assert.equal(p.primaryAction?.key,'insurance-edit-v');
 const approved=insuranceProcess({id:'i',versions:[{id:'v',status:'APPROVED',startAt:'2027-01-01',endAt:'2028-01-01',fileIds:['f']}]},'staff',true,new Date('2026-10-29'));
 assert(approved.attention.some(c=>/尚未开始/.test(c.description||'')));assert.equal(approved.steps.find(s=>s.key==='review')?.state,'DONE');
});
test('new product draft does not imply the previously published version stopped',()=>{
 const p=productProcess({id:'p',versions:[{id:'new',version:2,status:'DRAFT',configurationVersion:2},{id:'live',version:1,status:'PUBLISHED'}]},true);
 assert.equal(p.currentStep,'draft');assert(p.attention.some(c=>/第 1 版/.test(c.description||'')));assert.equal(p.primaryAction?.key,'product-edit-new');
});
test('company administrator invitation is independent of effective cooperation agreement',()=>{
 const p=partnerProcess({id:'o',agreements:[{id:'a',status:'ACTIVE',currentVersion:{fileIds:['f'],partnerRateBps:0,vehicleIds:['v']}}]}, {status:'PENDING'},true);
 assert.equal(p.steps.find(s=>s.key==='agreement')?.state,'DONE');assert.equal(p.steps.find(s=>s.key==='viewer')?.state,'WAITING');assert.equal(p.blockers.length,0);assert(p.attention.some(c=>/不影响|独立/.test(c.description||'')));
});
test('return guide uses actual unresolved facts and never enables completion just because bills are paid',()=>{
 const p=returnProcess({id:'r',orderId:'o',status:'PENDING_PAYMENT',unsettledPeriodIds:[],bills:[{id:'b',status:'PAID'}],depositRefundRequiredAmount:0,documentBlockers:['TERMINATION_REQUIRED'],canComplete:false});
 assert.equal(p.currentStep,'documents');assert(p.blockers.some(c=>c.code==='TERMINATION_REQUIRED'));assert.notEqual(p.primaryAction?.key,'return-complete');
 const u=returnProcess({id:'r',orderId:'o',status:'PENDING_PAYMENT',unsettledPeriodIds:[],bills:[],documentBlockers:[],depositRefundRequiredAmount:0,canComplete:false});
 assert(u.blockers.some(c=>c.state==='UNKNOWN'));assert.notEqual(u.primaryAction?.key,'return-complete');
 const inconsistent=returnProcess({id:'r',orderId:'o',status:'PENDING_PAYMENT',unsettledPeriodIds:[],bills:[],documentBlockers:['TERMINATION_REQUIRED'],depositRefundRequiredAmount:0,canComplete:true});assert.notEqual(inconsistent.primaryAction?.key,'return-complete');
});
test('field task assignment alone never means customer confirmation or delivery completed',()=>{
 const p=handoverProcess({id:'t',orderId:'o',status:'ASSIGNED',type:'DELIVERY',handover:{id:'h',status:'PUBLISHED',executionMode:'OFFLINE'}});
 assert.equal(p.currentStep,'customer');assert.equal(p.steps.find(s=>s.key==='complete')?.state,'WAITING');assert.equal(p.primaryAction?.kind,'WAIT');
 const stale=handoverProcess({id:'t',orderId:'o',status:'ASSIGNED',type:'DELIVERY',contractMode:'OFFLINE',handover:{id:'h',status:'CUSTOMER_CONFIRMED',executionMode:'OFFLINE'},offlineReceipt:{status:'ARCHIVED',manifestMatches:false}});assert.equal(stale.currentStep,'paper');assert.notEqual(stale.steps.find(s=>s.key==='paper')?.state,'DONE');
});
test('successful mutation with failed readback is committed and never retried',async()=>{
 let writes=0,reads=0;const result=await runCommittedCommand(async()=>{writes++;return{id:'saved'};},async()=>{reads++;throw Error('unavailable');});
 assert.equal(writes,1);assert.equal(reads,1);assert.equal(result.committed,true);assert.equal(result.refreshed,false);
 await assert.rejects(runCommittedCommand(async()=>{throw Error('denied');},async()=>{reads++;}));assert.equal(reads,1);
});

test('termination guide asks for settlement arrangements before generating the document',()=>{const p=archiveProcess({id:'a',kind:'TERMINATION',terminationContext:{originalContract:{number:'n'},delivery:{state:'NOT_DELIVERED'},blockers:[]},versions:[{id:'v',status:'DRAFT',templateId:'t'}]},'staff',true);assert.equal(p.currentStep,'generate');assert.equal(p.primaryAction?.key,'archive-termination-v');assert.match(p.steps.find(s=>s.key==='generate')?.summary||'',/终止安排/);});


test('insurance ordinary ADMIN self review is available while OPS own review remains blocked',()=>{
 const row={id:'p',versions:[{id:'v',version:1,status:'SUBMITTED',createdBy:'me',submittedBy:'me',fileIds:['f']}],files:[{fileId:'f',uploadedBy:'me'}]};
 const admin=insuranceProcess(row,'me',true,new Date(),'ADMIN');assert.equal(admin.primaryAction?.kind,'OPEN_FORM');assert.equal(admin.blockers.length,0);
 const ops=insuranceProcess(row,'me',true);assert.equal(ops.primaryAction?.kind,'WAIT');assert.ok(ops.blockers.some(b=>b.code==='INSURANCE_SELF_REVIEW'));
});


test('archive guide blocks OPS self review and retains the same-version materials',()=>{
 const p=archiveProcess({id:'a',kind:'RENTAL',versions:[{id:'v',status:'SUBMITTED',submittedBy:'me',files:[]}]},'me',true);
 assert.equal(p.primaryAction?.kind,'WAIT');assert.ok(p.blockers.some(b=>b.code==='ARCHIVE_SELF_REVIEW'));
});
