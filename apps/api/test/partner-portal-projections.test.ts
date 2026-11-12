import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerActor} from '../src/offline-documents/archive.controller';
import {workspaceProjection} from '../src/offline-documents/workspace.service';
import {archiveSummary} from '../src/offline-documents/projection';
import {ArchiveService} from '../src/offline-documents/archive.service';

const error=(code:string)=>(value:any)=>value.getResponse?.().error?.code===code;
const session={id:'portal-session',mode:'PARTNER_READONLY',scopes:[{ownerId:'partner-a',accessVersion:2}]};

test('archive actor uses the independent portal session without a Customer identity',()=>{
 const actor=ownerActor({partnerPortalSession:session},'partner-a');
 assert.equal(actor.id,session.id);
 assert.equal(actor.role,'OWNER');
 assert.equal(actor.ownerId,'partner-a');
 assert.equal(actor.customerId,undefined);
 assert.equal(actor.partnerSession,session);
});

test('a legacy Customer-based H5 request cannot form a new portal archive actor',()=>{
 assert.throws(()=>ownerActor({ownerH5Customer:{id:'customer'},ownerH5Session:{customerId:'customer'}},'partner-a'),error('PARTNER_SESSION_REQUIRED'));
});

test('partner workspace offers only a read action and never feedback or handling actions',()=>{
 const order={id:'order',customerId:'customer',status:'AWAITING_HANDOVER',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'hash'},bills:[],handovers:[]};
 const archive={id:'archive',kind:'RENTAL',ownerId:'partner-a',currentApprovedVersionId:'published',versions:[{id:'published',status:'ARCHIVED',businessSnapshotHash:'hash',version:1}]};
 const result=workspaceProjection(order,[archive],{id:session.id,role:'OWNER',ownerId:'partner-a'});
 for(const key of ['canUpload','canReview','canPay','canFeedback'])assert.equal((result.capabilities as any)[key],false,key);
 assert.ok(['VIEW_ORDER','VIEW_ARCHIVE'].includes(result.nextAction.code));
});

test('a pending replacement archive version is not exposed to the external viewer',()=>{
 const archive={id:'archive',kind:'OWNER_COOPERATION',ownerId:'partner-a',currentApprovedVersionId:'published',versions:[{id:'draft',version:2,status:'DRAFT'},{id:'published',version:1,status:'ARCHIVED',businessSnapshotHash:'old-hash'}]};
 const result=archiveSummary(archive,'current-hash',{id:session.id,role:'OWNER',ownerId:'partner-a'});
 assert.equal('pendingVersionStatus' in result,false);
 assert.equal(result.status,'ARCHIVED');
 assert.equal(result.canRead,true);
});

test('external archive feedback is rejected before any business database operation',async()=>{
 const db:any={serial(){throw new Error('must not open write transaction');}};
 await assert.rejects(new ArchiveService(db,{} as any).feedback('archive',{versionId:'v',message:'example',idempotencyKey:'readonly-feedback'}, {id:session.id,role:'OWNER',ownerId:'partner-a'}),error('PARTNER_READ_ONLY'));
});
