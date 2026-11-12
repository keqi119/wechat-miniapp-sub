import {test} from 'node:test';
import assert from 'node:assert/strict';
import {partnerRenewalFixture} from './partner-renewal-workspace-fixture';
import {readPartnerOrderWorkspace,listPartnerOrderWorkspaces} from '../src/partners/order-workspace';
import {renewalNow} from './order-renewals-fixture';
import {OfflineWorkspaceService} from '../src/offline-documents/workspace.service';

const read=(f:any,at=renewalNow)=>readPartnerOrderWorkspace(f.tx,f.session,f.owner.id,f.order.id,at);
const error=(e:any)=>[401,403,404].includes(e.getStatus?.());
test('confirmed future renewal is distinct from current fees and only actual archived paper is linked',async()=>{
 const f=await partnerRenewalFixture(),unchanged=f.readOnly(),v=await read(f);
 assert.equal(v.ownerId,f.owner.id);assert.equal(v.accessVersion,3);assert.equal(v.readOnly,true);assert.equal(v.currentPeriod?.monthlyFeeAmount,10000);
 assert.equal(v.futureRenewals[0].monthlyFeeAmount,20000);assert.equal(v.futureRenewals[0].includedSwapCount,0);assert.equal(v.futureRenewals[0].status,'AWAITING_FINANCE');assert.equal(v.futureRenewals[0].archive?.id,f.archive.id);assert.equal(v.amendments[0].quoteId,f.quote.id);unchanged();
});
test('confirmed pre-archive renewal needs no stage and never offers a draft file',async()=>{
 const f=await partnerRenewalFixture();f.change.status='AWAITING_ARCHIVE';f.version.status='DRAFT';f.archive.currentApprovedVersionId=null;
 const unchanged=f.readOnly(),v=await read(f);assert.equal(v.futureRenewals.length,1);assert.equal(v.futureRenewals[0].archive,null);assert.equal(v.futureRenewals[0].serviceStageId,null);unchanged();
 for(const state of ['DRAFT','REVIEWED','PUBLISHED']){f.quote.status=state;assert.equal((await read(f)).futureRenewals.length,0);}
});
test('SCHEDULED remains future and a passed original boundary does not activate it on read',async()=>{
 const f=await partnerRenewalFixture(),s=await f.prepare();Object.assign(s,{status:'SCHEDULED',scheduledBy:'finance',scheduledAt:renewalNow});f.change.status='SCHEDULED';const unchanged=f.readOnly();
 assert.equal((await read(f)).currentPeriod?.monthlyFeeAmount,10000);const v=await read(f,new Date('2027-10-02T01:00:00Z'));assert.equal(v.currentPeriod,null);assert.equal(v.futureRenewals[0].status,'SCHEDULED');assert.equal(v.futureRenewals[0].monthlyFeeAmount,20000);unchanged();
});
test('current portal grant and original customer sharing are required before sensitive source queries',async()=>{
 for(const mutation of [(f:any)=>f.grant.accessVersion++,(f:any)=>f.grant.status='DISABLED',(f:any)=>f.session.expiresAt=new Date('2000-01-01'),(f:any)=>f.initial.ownerDataConsent.customerId='foreign']){const f=await partnerRenewalFixture();mutation(f);f.tx.delayQuote.findMany=async()=>assert.fail('private quote queried before scope');await assert.rejects(read(f),error);}
 const f=await partnerRenewalFixture();await assert.rejects(readPartnerOrderWorkspace(f.tx,f.session,'other-owner',f.order.id,renewalNow),error);
});
test('wrong accepted owner, body hash, stage or quote cannot produce a future summary',async()=>{
 for(const mutation of [(f:any)=>f.quote.snapshot.customerAcceptance.sharingAccepted=false,(f:any)=>f.quote.snapshot.source.ownerId='foreign',(f:any)=>f.contract.body+='tampered',(f:any)=>f.quote.changeId='foreign']){const f=await partnerRenewalFixture();mutation(f);const v=await read(f);assert.equal(v.futureRenewals.length,0);assert.ok(v.blockers.length);}
 const f=await partnerRenewalFixture(),s=await f.prepare();s.orderId='foreign';assert.equal((await read(f)).futureRenewals.length,0);
});
test('legacy order read does not initialize a stage and the owner route uses the dedicated projection',async()=>{
 const f=await partnerRenewalFixture();f.changes.length=0;f.quotes.length=0;f.stages.length=0;f.contracts.splice(1);f.archives.splice(1);const unchanged=f.readOnly();
 const service=new OfflineWorkspaceService({serial:async(fn:any)=>fn(f.tx)} as any),v=await service.order(f.order.id,{id:f.session.id,role:'OWNER',ownerId:f.owner.id,partnerSession:f.session});
 assert.ok('readOnly' in v);assert.equal(v.readOnly,true);assert.equal(v.currentPeriod?.serviceStageId,null);assert.equal(v.currentPeriod?.monthlyFeeAmount,10000);assert.equal(f.stages.length,0);unchanged();
});
test('list counts actual sharing before pagination, not unshared candidates or a page-local filter',async()=>{
 const f=await partnerRenewalFixture();f.orders.push({...f.order,id:'unshared',finalPlanSnapshot:{...f.initial,ownerDataConsent:null}},{...f.order,id:'second',createdAt:new Date('2026-11-01')});
 const result=await listPartnerOrderWorkspaces(f.tx,f.session,f.owner.id,{page:2,pageSize:1},renewalNow);assert.equal(result.total,2);assert.equal(result.items.length,1);assert.notEqual(result.items[0].orderId,'unshared');
});
test('projection excludes customer identity, internal source and finance facts and propagates unknown storage failures',async()=>{
 const f=await partnerRenewalFixture();Object.assign(f.order,{customerProfileSnapshot:{identityFrontFileId:'secret-card'},internalCost:1234});f.quote.reviewNote='secret-review';
 const v=await read(f),json=JSON.stringify(v);for(const secret of ['secret-card','secret-review','sourceSnapshot','customerProfileSnapshot','qualificationId','providerTransactionId','identityFrontFileId'])assert.equal(json.includes(secret),false,secret);
 const failure=new Error('unexpected store failure');f.tx.orderServiceStage.findMany=async()=>{throw failure;};await assert.rejects(read(f),e=>e===failure);
});
test('activated renewal is current only inside its real period; historical paper survives later pointer and archive invalidation',async()=>{
 const f=await partnerRenewalFixture(),stage=await f.prepare(),terms=f.apply();Object.assign(stage,{status:'ACTIVE',scheduledBy:'finance',scheduledAt:renewalNow,activatedBy:'ops',activatedAt:new Date('2027-10-01T00:00:00+08:00'),termsVersionId:terms.id});
 f.change.activeQuoteId='later-quote';const v=await read(f,new Date('2027-11-01T01:00:00Z'));assert.equal(v.currentPeriod?.monthlyFeeAmount,20000);assert.equal(v.futureRenewals.length,0);assert.equal(v.amendments[0].quoteId,f.quote.id);
 f.version.status='INVALIDATED';const history=await read(f,new Date('2027-11-01T01:00:00Z'));assert.equal(history.currentPeriod,null);assert.equal(history.amendments[0].archive.versions[0].status,'INVALIDATED');
});

test('OWNER delegation retains actor/session identity and cannot become a Customer-based legacy read',async()=>{
 const f=await partnerRenewalFixture(),service=new OfflineWorkspaceService({serial:async(fn:any)=>fn(f.tx)} as any);
 for(const extra of [{id:'foreign-actor'},{customerId:f.customer.id}]){
  const actor={id:f.session.id,role:'OWNER',ownerId:f.owner.id,partnerSession:f.session,...extra};
  await assert.rejects(service.order(f.order.id,actor),error);await assert.rejects(service.workbench({},actor),error);
 }
});
