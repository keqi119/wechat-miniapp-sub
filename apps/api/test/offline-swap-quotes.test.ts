import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/common/data';
import {canonicalHash} from '../src/customers/types';
import {versionSnapshot} from '../src/products/snapshot';
import {swapQuote,swapQuoteDto} from '../src/vehicle-changes/quotes';
import {VehicleChangesService} from '../src/vehicle-changes/service';
import {swapAccountView} from '../src/vehicle-changes/account';
import {swapView} from '../src/vehicle-changes/view';
import {OrderChangesService} from '../src/order-changes/service';
import {offlineSwapFixture,swapV2Input,swapOps} from './offline-swap-quotes-fixture';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;

test('existing quote parser accepts strict v2 and keeps legacy parsed request shape untouched',()=>{
 const f=offlineSwapFixture();assert.equal(swapQuoteDto.safeParse(swapV2Input(f)).success,true);
 const legacy={revision:1,idempotencyKey:'legacy-quote-key',targetVehicleId:'target',plannedReturnAt:'2026-11-01T09:00:00+08:00',plannedDeliveryAt:'2026-11-01T10:00:00+08:00',newMonthlyFeeAmount:10000,depositAmount:0,periods:[{sequence:1,amount:10000,dueDate:'2026-10-01',calculationBasis:'真实原条款'}],handoverFeeAmount:0,handoverFeeBasis:'不收取',depositBasis:'不变',insuranceResponsibility:'原责任',downtimeArrangement:'明确安排',settlementExplanation:'原规则',handoverArrangement:'现场交接',cancellationTerms:'原约定',reason:'原请求',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};assert.equal(JSON.stringify(swapQuoteDto.parse(legacy)),JSON.stringify(legacy));
 assert.equal(swapQuoteDto.safeParse({...swapV2Input(f),periods:legacy.periods}).success,false);
});

test('v2 draft locks Order then selected Vehicle and freezes automatic periods/source without money writes or consumption',async()=>{
 const f=offlineSwapFixture(),before=structuredClone(f.initial),input=swapV2Input(f);await swapQuote(f.tx,f.change,input,swapOps);const q=f.quotes.at(-1)!;
 assert.equal(f.change.status,'REVIEW_PENDING');assert.equal(q.snapshot.pricingVersion,2);assert.equal(q.snapshot.newMonthlyFeeAmount,20000);assert.equal(q.snapshot.handoverFeeAmount,0);assert.equal(q.snapshot.targetVehicleId,'target');assert.equal(q.snapshot.targetSource.product.sourceHash,input.targetSourceHash);assert.equal(q.snapshot.pricingHash,canonicalHash(q.snapshot.pricing));
 assert.deepEqual(q.snapshot.periods.map((p:any)=>p.amount),[10000,20000,20000]);assert.deepEqual(q.snapshot.periods.map((p:any)=>p.differenceAmount),[0,10000,10000]);assert.equal(q.snapshot.targetLessorSnapshot.ownerId,'owner');assert.equal(q.snapshot.targetRevenueRuleSnapshot.agreementVersionId,'simple-version');assert.equal(q.snapshot.originalArchiveVersionId,f.rental.currentApprovedVersionId);assert.equal(q.snapshot.priorTermsVersionId,null);
 assert.equal(f.holds.length,1);assert.equal(f.target.holdId,f.holds[0].id);assert.equal(f.credits.length,1);assert.equal(f.reservations.filter(r=>r.status==='RESERVED').length,1);assert.equal(f.ledger.length,2);assert.deepEqual(f.ledger.map(l=>l.type),['GRANT','RESERVE']);assert.deepEqual(f.initial,before);assert.equal(f.obligations.length,0);assert.equal(f.refunds.length,0);assert.equal(f.account.packKm,1200);
 assert(f.locks[0].includes('Order'));assert(f.locks.findIndex(x=>x.includes('Vehicle'))>0);
});

test('v2 rejects stale source, allocation restriction, owner change, broken chain and qualification before quote writes',async()=>{
 const cases:[(f:ReturnType<typeof offlineSwapFixture>)=>void,string][]=[
  [f=>f.plan.listing.revision++,'GOODS_SOURCE_CHANGED'],[f=>f.tx.vehicleOperationalRestriction.count=async()=>1,'VEHICLE_ALLOCATION_RESTRICTED'],
  [f=>{f.owner.id='other-owner';f.agreement.ownerId='other-owner';f.agreementVersion.ownerId='other-owner';},'OWNER_SWAP_BINDING'],
  [f=>f.rental.versions[0].status='REVIEWED','AGREEMENT_ARCHIVE_REQUIRED'],[f=>f.qualification.status='REJECTED','CUSTOMER_QUALIFICATION_REQUIRED'],
 ];
 for(const [mutate,expected]of cases){const f=offlineSwapFixture(),input=swapV2Input(f);mutate(f);await assert.rejects(swapQuote(f.tx,f.change,input,swapOps),code(expected));assert.equal(f.quotes.length,0);assert.equal(f.holds.length,0);}
});

test('v2 cannot enter signed-money recovery or replace actual returned facts',async()=>{
 for(const state of ['AWAITING_FINANCE','SWAP_RETURNED','REVIEWED']){const f=offlineSwapFixture();f.change.status=state;f.change.activeQuoteId='paid-quote';f.quotes.push({id:'paid-quote',changeId:f.change.id,financePreparedAt:new Date(),snapshot:{financeSourceQuoteId:'original-finance'},contract:{status:'SIGNED'}});await assert.rejects(swapQuote(f.tx,f.change,swapV2Input(f),swapOps),code('OFFLINE_SWAP_REPRICE_REQUIRED'));assert.equal(f.writes.length,0);assert.equal(f.quotes.length,1);}
});

test('OFFLINE swap context recognizes actual paper/qualification and reads never bootstrap',async()=>{
 const f=offlineSwapFixture();f.changes.length=0;const service=new VehicleChangesService(f.db as any,()=>new Date('2026-10-31T00:00:00Z')),result:any=await service.context(f.tx,'order');
 assert.equal(result.offline.ready,true);assert.equal(result.offline.originalArchiveVersionId,f.rental.currentApprovedVersionId);assert.equal(result.canCreate,true);assert.equal(f.writes.length,0);
 await assert.rejects(service.create('order',{reason:'请求',expectedOrderRevision:2,priorTermsHash:hash(f.initial),idempotencyKey:'blocked-create-key'},swapOps),code('VERSION_CONFLICT'));assert.equal(f.writes.length,0);
 f.order.currentAssignmentId=null;f.tx.vehicleAssignment.count=async()=>0;const account=await swapAccountView(f.tx,'order',new Date('2026-10-31'));assert.equal(account.canRequest,false);assert.equal(account.currentAssignment,null);assert.equal(f.writes.length,0);
});

test('public OFFLINE/v2 projections never advertise handover, completion, publication or old money recovery',async()=>{
 const f=offlineSwapFixture();f.change.status='SWAP_RETURNED';f.change.deliveryHandoverId='new-delivery';f.handovers.push({id:'new-delivery',status:'CUSTOMER_CONFIRMED',signatureStatus:'SIGNED'});const view:any=await swapView(f.tx,f.change,{snapshot:{pricingVersion:2}}, {blockers:[]},true,new Date('2026-10-31'));
 assert.equal(view.canCreateReturn,false);assert.equal(view.canCreateDelivery,false);assert.equal(view.canComplete,false);assert.equal(view.deliveryHandover.canComplete,false);assert.equal(view.canPublish,false);assert.equal(view.canPrepareFinance,false);assert.equal(view.recoveryOnly,false);assert.equal(f.writes.length,0);
});

test('old create key replays before live chain or gate without changing order revision, but current authority and ownership still apply',async()=>{
 const f=offlineSwapFixture(),input={reason:'old request',idempotencyKey:'old-create-key'},old={...f.change,createdBy:'ops',requestHash:hash(input)};f.tx.orderChange.findUnique=async()=>old;const service=new VehicleChangesService(f.db as any,()=>new Date());f.rental.versions[0].status='DRAFT';const result=await service.create('order',input,swapOps);assert.equal(result.id,old.id);assert.equal(f.writes.length,0);assert.equal(f.order.revision,3);
 await assert.rejects(service.create('order',{...input,reason:'changed'},swapOps),code('IDEMPOTENCY_CONFLICT'));
 f.tx.adminUser.findUnique=async()=>({...swapOps,active:false});await assert.rejects(service.create('order',input,swapOps),code('STAFF_SESSION_CHANGED'));
 await assert.rejects(service.create('order',input,undefined,'another-customer'),code('NOT_FOUND'));
});

test('new vehicle cooperation covers only its remaining service interval',async()=>{
 const f=offlineSwapFixture();f.agreementVersion.validFrom='2026-11-01';await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);const q=f.quotes.at(-1)!;
 assert.deepEqual(q.snapshot.targetLessorSnapshot.leaseRange,{startDate:'2026-11-01',endDate:'2026-12-31'});assert.equal(q.snapshot.newStartDate,'2026-10-01');
});

test('last-day swap uses exactly the one remaining service day without extending the original term or cooperation range',async()=>{
 const last=offlineSwapFixture(),original=structuredClone(last.initial);last.agreementVersion.validFrom='2026-12-31';last.agreementVersion.validUntil='2026-12-31';await swapQuote(last.tx,last.change,{...swapV2Input(last),plannedReturnAt:'2026-12-31T09:00:00+08:00',plannedDeliveryAt:'2026-12-31T10:00:00+08:00'},swapOps);
 const q=last.quotes.at(-1)!;assert.deepEqual(q.snapshot.targetLessorSnapshot.leaseRange,{startDate:'2026-12-31',endDate:'2026-12-31'});assert.equal(q.snapshot.newEndDate,'2026-12-31');assert.equal(q.snapshot.newStartDate,'2026-10-01');assert.equal(q.snapshot.pricing.pricing.endDate,'2027-01-01');assert.equal(q.snapshot.pricing.pricing.periods.at(-1).chargeDays,1);assert.deepEqual(q.snapshot.periods.map((p:any)=>p.amount),[10000,10000,10323]);assert.deepEqual(last.initial,original);assert.equal(last.agreementVersion.validFrom,'2026-12-31');assert.equal(last.agreementVersion.validUntil,'2026-12-31');
});

test('first-time OFFLINE manual-price requests cannot fall back to the historical v1 path',async()=>{
 const f=offlineSwapFixture();await assert.rejects(swapQuote(f.tx,f.change,{revision:1,idempotencyKey:'manual-offline-key',targetVehicleId:'target',newMonthlyFeeAmount:1,periods:[]},swapOps),code('OFFLINE_SWAP_PRICING_REQUIRED'));assert.equal(f.quotes.length,0);assert.equal(f.holds.length,0);
});

test('common action replay keeps the original frozen v2 price after source withdrawal and rejects changed body or revoked staff',async()=>{
 const f=offlineSwapFixture(),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31')),input=swapV2Input(f);await service.act(f.change.id,'quotes',input,swapOps);
 const quote=structuredClone(f.quotes.at(-1)),hold=structuredClone(f.holds[0]);f.plan.listing.status='WITHDRAWN';f.plan.productVersion.status='SUSPENDED';
 await service.act(f.change.id,'quotes',input,swapOps);assert.deepEqual(f.quotes.at(-1),quote);assert.deepEqual(f.holds[0],hold);assert.equal(f.quotes.length,1);assert.equal(f.holds.length,1);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);
 await assert.rejects(service.act(f.change.id,'quotes',{...input,reason:'different'},swapOps),code('IDEMPOTENCY_CONFLICT'));f.tx.adminUser.findUnique=async()=>({...swapOps,active:false});await assert.rejects(service.act(f.change.id,'quotes',input,swapOps),code('STAFF_SESSION_CHANGED'));
});

test('replacement quote locks every old and new vehicle in stable order before owner locks or hold changes',async()=>{
 const f=offlineSwapFixture();f.holds.push({id:'old-hold',changeId:f.change.id,vehicleId:'a-previous-target',status:'HELD'});
 await swapQuote(f.tx,f.change,swapV2Input(f),swapOps);
 const vehicleLocks=f.locks.filter(x=>x.includes('FROM "Vehicle"'));
 assert(vehicleLocks[0].endsWith('a-previous-target'));assert(vehicleLocks[1].endsWith('target'));
 assert.equal(f.holds[0].status,'RELEASED');assert.equal(f.holds.filter(h=>h.status==='HELD').length,1);
});

test('missing physical delivery reference is an explainable eligibility blocker before querying an invalid handover ID',async()=>{
 const f=offlineSwapFixture();f.assignment.deliveryHandoverId=null;f.tx.handover.findUnique=async({where}:any)=>{assert.equal(typeof where.id,'string','do not submit null to Prisma');return null;};
 const result=await new VehicleChangesService(f.db as any,()=>new Date('2026-10-31')).context(f.tx,'order');assert.equal(result.offline!.ready,false);assert(result.offline!.blockers.includes('ASSIGNMENT_EVIDENCE_REQUIRED'));assert.equal(f.writes.length,0);
});

test('draft API reports an explicit downgrade conflict',async()=>{
 const cheaper=offlineSwapFixture();Object.assign(cheaper.plan.productVersion,{monthlyFeeAmount:9000,baseFeeAmount:9000});cheaper.plan.listing.snapshot=versionSnapshot(cheaper.plan.productVersion);cheaper.plan.listing.productSourceHash=canonicalHash(cheaper.plan.listing.snapshot);
 await assert.rejects(swapQuote(cheaper.tx,cheaper.change,swapV2Input(cheaper),swapOps),code('DOWNGRADE_NOT_SUPPORTED'));assert.equal(cheaper.writes.length,0);
});
test('draft API reports an explicit out-of-term conflict',async()=>{
 const outside=offlineSwapFixture();await assert.rejects(swapQuote(outside.tx,outside.change,{...swapV2Input(outside),plannedDeliveryAt:'2027-01-01T00:00:00+08:00'},swapOps),code('SWAP_OUTSIDE_TERM'));assert.equal(outside.writes.length,0);
});
test('draft API reports an explicit stored amount overflow conflict',async()=>{
 const overflow=offlineSwapFixture();overflow.bills[1].amount=2147483647;await assert.rejects(swapQuote(overflow.tx,overflow.change,swapV2Input(overflow),swapOps),code('OFFLINE_SWAP_PRICING_AMOUNT_OVERFLOW'));assert.equal(overflow.writes.length,0);
});
test('unexpected target database errors are propagated unchanged',async()=>{
 const broken=offlineSwapFixture(),failure=new Error('database unavailable');broken.tx.subscriptionPlan.findUnique=async()=>{throw failure;};await assert.rejects(swapQuote(broken.tx,broken.change,swapV2Input(broken),swapOps),error=>error===failure);
});

test('a historical successful v1 quote command replays before new OFFLINE price requirements without rewriting its snapshot',async()=>{
 const f=offlineSwapFixture(),input={revision:1,idempotencyKey:'legacy-saved-quote',targetVehicleId:'target',plannedReturnAt:'2026-11-01T09:00:00+08:00',plannedDeliveryAt:'2026-11-01T10:00:00+08:00',newMonthlyFeeAmount:12345,depositAmount:0,periods:[{sequence:1,amount:10000,dueDate:'2026-10-01',calculationBasis:'原条款'}],handoverFeeAmount:100,handoverFeeBasis:'原已保存',depositBasis:'不变',insuranceResponsibility:'原责任',downtimeArrangement:'原安排',settlementExplanation:'原规则',handoverArrangement:'原交接',cancellationTerms:'原约定',reason:'原请求',expiresAt:'2099-12-31T00:00:00Z',externalCompensationRequired:false};
 f.change.activeQuoteId=f.quote.id;f.change.status='REVIEWED';f.quotes.push(f.quote);f.audits.push({resourceType:'order-changes',resourceId:f.change.id,action:'DELAY_quotes_'+input.idempotencyKey,actorId:swapOps.id,data:{requestHash:hash(input)}});
 const before=structuredClone(f.quote);f.rental.versions[0].status='DRAFT';await new OrderChangesService(f.db as any,()=>new Date('2026-10-31')).act(f.change.id,'quotes',swapQuoteDto.parse(input),swapOps);
 assert.deepEqual(f.quote,before);assert.equal(f.quotes.length,1);assert.equal(f.holds.length,0);assert.equal(f.credits.length,0);
});
