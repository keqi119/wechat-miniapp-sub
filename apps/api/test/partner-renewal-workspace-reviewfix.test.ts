import {test} from 'node:test';
import assert from 'node:assert/strict';
import {partnerDelayedLegacyFixture} from './partner-renewal-workspace-reviewfix-fixture';
import {readPartnerOrderWorkspace,listPartnerOrderWorkspaces} from '../src/partners/order-workspace';
import {readEffectiveContractChain} from '../src/order-changes/agreement-readiness';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';

const now=new Date('2027-01-15T00:00:00+08:00');
const read=(f:any,at=now)=>readPartnerOrderWorkspace(f.tx,f.session,'owner',f.order.id,at);

test('applied delay without INITIAL uses the effective delivered term dates for detail and list, with zero GET writes',async()=>{
 const f=await partnerDelayedLegacyFixture(),unchanged=f.freezeReads();assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).ready,true);
 for(const v of [await read(f),(await listPartnerOrderWorkspaces(f.tx,f.session,'owner',{},now)).items[0]]){
  assert.ok(v.currentPeriod,'January 15 remains inside the effective November–February rental');assert.equal(v.currentPeriod.startDate,'2026-11-01');assert.equal(v.currentPeriod.endDate,'2027-02-01');assert.equal(v.currentPeriod.serviceStageId,null);
  assert.equal(v.currentPeriod.monthlyFeeAmount,10000);assert.equal(v.currentPeriod.baseAllowanceKm,1500);assert.equal(v.currentPeriod.excessPriceAmount,150);assert.equal(v.currentPeriod.includedSwapCount,2);
 }
 assert.equal((await read(f,new Date('2026-10-15T00:00:00+08:00'))).currentPeriod,null);assert.equal((await read(f,new Date('2027-02-01T00:00:00+08:00'))).currentPeriod,null);unchanged();
});

test('a later verified swap retains delayed dates and original usage/gift policy rather than target product defaults',async()=>{
 const f=await partnerDelayedLegacyFixture(),s=f.addChange(true);s.change.kind='VEHICLE_CHANGE';s.change.targetVehicleId='target';s.quote.snapshot.originalAssignmentId=f.assignment.id;
 const terms=s.terms!;Object.assign(terms.snapshot,{vehicleId:'target',lessorSnapshot:{...terms.snapshot.lessorSnapshot,vehicleId:'target'},monthlyFeeAmount:20000,currentVehicleProductSnapshot:{name:'换入产品',mileagePerMonthKm:9999,swapPolicy:{includedCount:9}}});
 s.version.scopeSnapshot=offlineChangeScope(s.change,s.quote,s.contract);f.assignment.vehicleId='target';f.cars.push({id:'target',title:'换入车辆',plateNumber:'沪B测试'});
 const unchanged=f.freezeReads();assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).ready,true);const v=await read(f);
 assert.ok(v.currentPeriod);assert.equal(v.currentPeriod.startDate,'2026-11-01');assert.equal(v.currentPeriod.endDate,'2027-02-01');assert.equal(v.currentPeriod.monthlyFeeAmount,20000);assert.equal(v.currentPeriod.baseAllowanceKm,1500);assert.equal(v.currentPeriod.includedSwapCount,2);assert.equal(v.vehicle?.id,'target');unchanged();
});

test('original contract number comes from its chain-pinned RENTAL version, never Contract or a later arbitrary version',async()=>{
 const f=await partnerDelayedLegacyFixture();f.rental.versions[0].contractNumber='原租赁纸档-001';f.original.contractNumber='not-a-schema-field';
 const newer={...structuredClone(f.rental.versions[0]),id:'rental-v2',version:2,contractNumber:'另一次归档-002'};f.rental.versions.unshift(newer);f.rental.currentApprovedVersionId=newer.id;
 const unchanged=f.freezeReads();assert.equal((await readEffectiveContractChain(f.tx,f.order.id)).original?.archiveVersionId,f.change.originalArchiveVersionId);
 for(const v of [await read(f),(await listPartnerOrderWorkspaces(f.tx,f.session,'owner',{},now)).items[0]])assert.equal(v.originalContract?.contractNumber,'原租赁纸档-001');unchanged();
});

test('without amendments the verified current rental version supplies the original contract number',async()=>{
 const f=await partnerDelayedLegacyFixture();f.changes.length=0;f.quotes.length=0;f.terms.length=0;f.order.effectiveTermsVersionId=null;f.contracts.splice(1);f.rental.versions[0].contractNumber='当前租赁编号';
 const unchanged=f.freezeReads();assert.equal((await read(f,new Date('2026-12-01T00:00:00+08:00'))).originalContract?.contractNumber,'当前租赁编号');unchanged();
});

test('invalidated or foreign original paper never supplies a normal contract number; invalid history keeps its explicit status',async()=>{
 for(const kind of ['INVALIDATED','FOREIGN_OWNER','FOREIGN_ORDER'] as const){const f=await partnerDelayedLegacyFixture();f.rental.versions[0].contractNumber='历史签字编号';
  if(kind==='INVALIDATED')f.rental.versions[0].status='INVALIDATED';else if(kind==='FOREIGN_OWNER')f.rental.ownerId='foreign-owner';else f.rental.orderId='foreign-order';
  const unchanged=f.freezeReads(),v=await read(f);assert.equal(v.originalContract?.contractNumber,'');assert.equal(v.currentPeriod,null);assert.ok(v.blockers.length);
  if(kind==='INVALIDATED')assert.deepEqual(v.originalContract?.archive?.versions.map((r:any)=>[r.contractNumber,r.status]),[['历史签字编号','INVALIDATED']]);else assert.equal(v.originalContract?.archive,null);unchanged();
 }
});
