import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contractReady,feedbackHold,readinessFromArchive} from '../src/offline-documents/readiness';
import {ArchiveContextService} from '../src/offline-documents/context';
import {canReadArchive,archiveSummary} from '../src/offline-documents/projection';
import {workspaceProjection} from '../src/offline-documents/workspace.service';
import {workspaceTimeline,workspaceResponsibility} from '../src/offline-documents/workspace-facts';
const archived:any={id:'a',kind:'RENTAL',orderId:'o',ownerId:'owner',revision:3,currentApprovedVersionId:'v',versions:[{id:'v',status:'ARCHIVED',businessSnapshotHash:'h',feedback:[]},{id:'draft',status:'DRAFT'}]};
test('workspace follows latest rental correction instead of older reviewed version or termination',()=>{
 const order={id:'o',status:'AWAITING_CONTRACT_REVIEW',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'h'},bills:[],handovers:[]};
 const rental={...archived,currentApprovedVersionId:null,versions:[{id:'old',version:1,status:'REVIEWED'},{id:'new',version:2,status:'DRAFT'}]};
 const termination={...rental,id:'termination',kind:'TERMINATION',versions:[{id:'term',version:1,status:'REVIEWED'}]};
 let view=workspaceProjection(order,[rental,termination],{id:'staff',role:'OPERATIONS'});assert.equal(view.nextAction.code,'UPLOAD_OFFLINE_DOCUMENT');assert.equal(view.nextAction.resourceId,'a');
 rental.versions[1].status='SUBMITTED';view=workspaceProjection(order,[rental,termination],{id:'staff',role:'OPERATIONS'});assert.equal(view.nextAction.code,'REVIEW_OFFLINE_DOCUMENT');
 rental.versions[1].status='REVIEWED';view=workspaceProjection(order,[rental,termination],{id:'staff',role:'OPERATIONS'});assert.equal(view.nextAction.code,'ARCHIVE_OFFLINE_DOCUMENT');
});
test('approve_invalidate_pay_share_current_version',()=>{assert.equal(readinessFromArchive(archived,'h').ready,true);assert.equal(archiveSummary(archived,'h').status,'ARCHIVED');assert.equal(archiveSummary(archived,'h').pendingVersionStatus,'DRAFT');assert.equal(readinessFromArchive({...archived,currentApprovedVersionId:null},'h').ready,false);assert.equal(readinessFromArchive(archived,'new-hash').ready,false);});
test('feedback_creates_stage_specific_hold',()=>{assert.deepEqual(feedbackHold('AWAITING_PAYMENT',true),{payment:true,delivery:true,contractChange:true,settlement:true,closure:true});assert.deepEqual(feedbackHold('ACTIVE',true),{payment:false,delivery:false,contractChange:true,settlement:true,closure:true});assert.equal(feedbackHold('SETTLING',true).payment,false);assert.equal(feedbackHold('ACTIVE',false).closure,false);});
test('finance_support_cannot_read_customer_archives_and_only_explicit_cooperation_read_opens_necessary_versions',()=>{
 for(const role of ['FINANCE','SUPPORT']){
  const ungranted={id:'staff',role},granted={...ungranted,partnerCapabilities:['partner.cooperation.read']};
  assert.equal(canReadArchive(ungranted,archived,archived.versions[0]),false);
  assert.equal(canReadArchive(granted,archived,archived.versions[0]),false);
  assert.equal(canReadArchive(ungranted,{...archived,kind:'OWNER_COOPERATION'},archived.versions[0]),false);
  for(const status of ['DRAFT','SUBMITTED','ARCHIVED'])assert.equal(canReadArchive(granted,{...archived,kind:'OWNER_COOPERATION'},{status}),true);
 }
 assert.equal(canReadArchive({id:'c',role:'CUSTOMER',customerId:'other'},{...archived,customerId:'c'},archived.versions[0]),false);
});

test('workspace_projection_is_read_only_and_has_no_private_review_details',()=>{const order:any={id:'o',status:'AWAITING_PAYMENT',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'h'},bills:[],handovers:[]};const before=JSON.stringify({order,archived});const result=workspaceProjection(order,[archived],{id:'f',role:'FINANCE'});assert.equal(JSON.stringify({order,archived}),before);assert.equal(result.contracts[0].canRead,false);assert.equal(result.nextAction.code,'VIEW_ARCHIVE');assert.equal(JSON.stringify(result).includes('reviewChecklist'),false);});

test('customer workspace hides unpublished bills and support cannot acquire finance data through aggregation',()=>{
 const order:any={id:'o',status:'AWAITING_PAYMENT',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'h'},bills:[{id:'draft',status:'DRAFT',amount:100},{id:'paid',status:'PAID',amount:100},{id:'pending',status:'PENDING',amount:100,paidAmount:0}],handovers:[]};
 const customer=workspaceProjection(order,[archived],{id:'c',role:'CUSTOMER'});assert.deepEqual(customer.billing.map(b=>b.id),['paid','pending']);assert.equal(customer.nextAction.resourceId,'pending');
 assert.deepEqual(workspaceProjection(order,[archived],{id:'s',role:'SUPPORT'}).billing,[]);
 order.bills=order.bills.filter((b:any)=>b.status!=='PENDING');const waiting=workspaceProjection(order,[archived],{id:'c',role:'CUSTOMER'});assert.equal(waiting.capabilities.canPay,false);assert.notEqual(waiting.nextAction.code,'PAY_BILL');
});
test('missing_or_cross_order_effective_terms_cannot_reuse_old_commercial_hash',async()=>{
 for(const terms of [null,{id:'terms',orderId:'other-order',hash:'b'.repeat(64)}]){
  const order={id:'o',customerId:'c',contractMode:'OFFLINE',effectiveTermsVersionId:'terms',finalPlanSnapshot:{commercialHash:'a'.repeat(64),lessorSnapshot:{ownerId:'owner'}}};
  const tx:any={$queryRaw:async()=>[],order:{findUnique:async()=>order},orderTermsVersion:{findUnique:async()=>terms},documentArchive:{findFirst:async()=>({...archived,versions:[{id:'v',status:'ARCHIVED',businessSnapshotHash:'a'.repeat(64)}]})},archiveFeedback:{count:async()=>0}};
  await assert.rejects(()=>contractReady(tx,'o'),(e:any)=>e.getResponse?.().error.code==='TERMS_MISSING');
  await assert.rejects(()=>new ArchiveContextService().resolve(tx,{subjectType:'ORDER',subjectId:'o'}),(e:any)=>e.getResponse?.().error.code==='TERMS_MISSING');
 }
});

test('workspace timeline separates physical return from closure and never copies private review material',()=>{
 const order={id:'o',status:'SETTLING',createdAt:'2026-10-01T00:00:00Z',receiptFacts:[{id:'r',receivedAt:'2026-10-03T00:00:00Z',evidenceFileIds:['secret-file']}],fieldTaskFacts:[{id:'task',status:'ASSIGNED',assignee:{name:'当前现场人员'}}],handovers:[{id:'h',type:'RETURN',status:'PUBLISHED',completedAt:null}]};
 const archives=[{id:'a',kind:'RENTAL',versions:[{id:'v',version:1,status:'ARCHIVED',submittedAt:'2026-10-01T01:00:00Z',reviewedAt:'2026-10-02T00:00:00Z',reviewReason:'PRIVATE-NOTE',files:['PRIVATE-FILE']}]}];
 const events=workspaceTimeline(order,archives,'SUPPORT');assert.equal(events.length,3);assert.equal(events.at(-1)?.resourceType,'vehicle-receipt');assert.ok(!events.some(e=>e.label.includes('正式还车已完成')));assert.ok(!JSON.stringify(events).includes('PRIVATE'));
 assert.equal(workspaceTimeline(order,archives,'OPERATIONS').length,4);
 assert.equal(workspaceResponsibility(order,'OPERATIONS').assigneeName,'当前现场人员');assert.equal(workspaceResponsibility(order,'SUPPORT').assigneeName,undefined);assert.equal(workspaceResponsibility(order,'FINANCE').role,'FINANCE');
});

test('workspace primary read actions follow delivery, use, settlement and terminal facts',()=>{
 const order:any={id:'o',status:'AWAITING_HANDOVER',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'h'},bills:[],handovers:[{id:'delivery',type:'DELIVERY',status:'PUBLISHED',customerResponse:'NONE'}]};
 const customer={id:'c',role:'CUSTOMER'};assert.equal(workspaceProjection(order,[archived],customer).nextAction.code,'CONFIRM_HANDOVER');
 order.status='ACTIVE';order.handovers=[];assert.equal(workspaceProjection(order,[archived],customer).nextAction.code,'VIEW_SERVICES');
 order.status='SETTLING';assert.equal(workspaceProjection(order,[archived],{id:'f',role:'FINANCE'}).nextAction.code,'VIEW_SETTLEMENT');
 for(const status of ['COMPLETED','CANCELLED']){order.status=status;order.bills=[{id:'late',status:'PENDING',amount:100,paidAmount:0}];const result=workspaceProjection(order,[],customer);assert.equal(result.nextAction.code,'VIEW_ORDER');assert.equal(result.capabilities.canPay,false);}
});

 test('electronic parent never advertises paper actions or paper capabilities',()=>{
 const view=workspaceProjection({id:'o',status:'AWAITING_CONTRACT',contractMode:'ELECTRONIC',bills:[],handovers:[],finalPlanSnapshot:{}},[],{id:'staff',role:'OPERATIONS'});
 assert.equal(view.nextAction.code,'OPEN_ELECTRONIC');assert.equal(view.capabilities.canUpload,false);assert.equal(view.capabilities.canReview,false);assert.deepEqual(view.blockers,[]);
 });
