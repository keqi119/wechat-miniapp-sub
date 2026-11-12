import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {AssetCostPlansController} from '../src/asset-costs/controller';
import {baasTerms,depreciationTerms,generateCostPlans,loadCostSource,previewCostPlans} from '../src/asset-costs/source';
import {canonicalHash} from '../src/customers/types';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,financeActor} from './asset-ledger-fixture';

async function fixture(kind:'DEPRECIATION'|'BAAS'='DEPRECIATION'){
 const f=assetFixture(),service=new AssetCostPlansService(()=>assetNow);
 const policy={id:'policy',vehicleId:'vehicle',revision:3,method:'MANUAL',basisAmount:10000,basisSource:'已核对采购依据',basisEvidence:'合成原始依据',residualAmount:0,startDate:new Date('2027-01-01'),usefulLifeMonths:null,currency:'CNY',notes:'',previousPolicyId:null,status:'ACTIVE',activatedAt:assetNow};
 const contract={id:'contract',vehicleId:'vehicle',revision:3,provider:'合成服务商',contractNumber:'synthetic-reopen',supplierContractNumber:'',batteryPackage:'合成电池',batterySerialNumber:'',effectiveFrom:new Date('2027-01-01'),effectiveTo:new Date('2027-12-31'),billingCycle:'MONTHLY',rentalAmount:12345,paymentDayOfMonth:31,graceDays:0,invoiceRequired:false,taxIncluded:null,currency:'CNY',notes:'',previousContractId:null,status:'ACTIVE',activatedAt:assetNow,firstCostPeriod:null};
 if(kind==='DEPRECIATION')f.seed('vehicleDepreciationPolicy',{...policy,termsHash:canonicalHash(depreciationTerms(policy))});
 else f.seed('vehicleBaasContract',{...contract,termsHash:canonicalHash(baasTerms(contract))});
 const source=()=>loadCostSource(f.tx,kind==='DEPRECIATION'?{sourceKind:kind,depreciationPolicyId:'policy'}:{sourceKind:kind,baasContractId:'contract'});
 const request=kind==='DEPRECIATION'?{sourceKind:kind,manualPeriods:[{costPeriod:'2027-01',amount:6000,reason:'原始手工计提凭证 A'},{costPeriod:'2027-02',amount:1000,reason:'原始手工计提凭证 B'}]}:{sourceKind:kind,fromPeriod:'2027-01',toPeriod:'2027-02'};
 const selected=await source(),preview=await previewCostPlans(f.tx,selected,request),made=await f.serial(tx=>generateCostPlans(tx,selected,request,preview.previewHash,preview.warningIds,financeActor.id));
 const plan=await f.serial(tx=>service.void(tx,kind==='BAAS'?assetActor:financeActor,made.created[0].id,{...assetCommand(),reason:'作废原因不得替代原计提理由'}));
 return{...f,service,source,plan,other:made.created[1]};
}

test('MANUAL reopen preview reads the original batch and reasons, exposes usable revisions, and makes no writes',async()=>{
 const f=await fixture(),before=f.writes.length,locks=f.locks.length,state=structuredClone(['assetCostPlan','vehicleDepreciationPolicy','archiveCommand','auditLog'].map(name=>f.rows(name)));
 const preview=await f.service.reopenPreview(f.tx,financeActor,f.plan.id);
 assert.deepEqual(Object.keys(preview).sort(),['planId','planRevision','sourceRevision','sourceKind','costPeriod','amount','previewHash','warningIds','rows'].sort());
 assert.deepEqual({planId:preview.planId,planRevision:preview.planRevision,sourceRevision:preview.sourceRevision,sourceKind:preview.sourceKind,costPeriod:preview.costPeriod,amount:preview.amount},{planId:f.plan.id,planRevision:1,sourceRevision:3,sourceKind:'DEPRECIATION',costPeriod:'2027-01',amount:6000});
 assert.deepEqual(preview.rows.map((row:any)=>[row.costPeriod,row.amount,row.reason]),[['2027-01',6000,'原始手工计提凭证 A'],['2027-02',1000,'原始手工计提凭证 B']]);assert.deepEqual(preview.warningIds,[]);assert.match(preview.previewHash,/^[a-f0-9]{64}$/);assert.equal(f.writes.length,before);assert.equal(f.locks.length,locks);assert.deepEqual(['assetCostPlan','vehicleDepreciationPolicy','archiveCommand','auditLog'].map(name=>f.rows(name)),state);
 const reopened=await f.serial(tx=>f.service.reopen(tx,financeActor,f.plan.id,{...assetCommand(preview.planRevision),sourceRevision:preview.sourceRevision,previewHash:preview.previewHash,reason:'复核原始依据后重开'}));assert.equal(reopened.status,'SCHEDULED');assert.equal(reopened.amount,6000);
});

test('BAAS operations gets a single-period preview; depreciation and revoked or unrelated roles remain forbidden',async()=>{
 const baas=await fixture('BAAS'),preview=await baas.service.reopenPreview(baas.tx,assetActor,baas.plan.id);assert.deepEqual(preview.rows.map((row:any)=>[row.costPeriod,row.amount]),[['2027-01',12345]]);assert.equal(preview.sourceKind,'BAAS');
 const f=await fixture();await assert.rejects(f.service.reopenPreview(f.tx,assetActor,f.plan.id),assetError('FORBIDDEN'));
 for(const role of ['SUPPORT','FIELD'])await assert.rejects(f.service.reopenPreview(f.tx,{id:role.toLowerCase(),role,authVersion:1},f.plan.id),assetError('FORBIDDEN'));
 f.revoke(financeActor.id);await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.plan.id),assetError('STAFF_SESSION_CHANGED'));
});

test('reopen preview refuses non-voided, previously confirmed, unknown and inactive sources without mutations',async()=>{
 const f=await fixture(),before=f.writes.length;await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.other.id),assetError('COST_PLAN_STATE'));
 f.seed('assetCostEntry',{id:'historic-cost',planId:f.plan.id,effect:'COST'});await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.plan.id),assetError('COST_PLAN_STATE'));f.rows('assetCostEntry').pop();
 const row=f.rows('assetCostPlan').find(p=>p.id===f.plan.id);row.sourceKind='UNKNOWN';await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.plan.id),assetError('COST_SOURCE_MISMATCH'));row.sourceKind='DEPRECIATION';
 f.rows('vehicleDepreciationPolicy')[0].status='ARCHIVED';await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.plan.id),assetError('DEPRECIATION_STATE'));assert.equal(f.writes.length,before);
});

test('preview checks the same cumulative budget and cross-source overlap as actual reopen',async()=>{
 const f=await fixture(),source=await f.source(),request={sourceKind:'DEPRECIATION' as const,manualPeriods:[{costPeriod:'2027-03',amount:4000,reason:'后续真实依据'}]},p=await previewCostPlans(f.tx,source,request);await f.serial(tx=>generateCostPlans(tx,source,request,p.previewHash,[],financeActor.id));
 const before=f.writes.length;await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.plan.id),assetError('DEPRECIATION_LIMIT'));assert.equal(f.writes.length,before);
 const overlap=await fixture('BAAS');overlap.seed('assetCostPlan',{...overlap.rows('assetCostPlan')[0],id:'other-source-period',baasContractId:'other-contract',status:'SCHEDULED'});await assert.rejects(overlap.service.reopenPreview(overlap.tx,financeActor,overlap.plan.id),assetError('COST_PERIOD_OVERLAP'));
});

test('preview cannot reopen after asset or source revisions change, and tampered frozen manual reasons are rejected',async()=>{
 const f=await fixture(),preview=await f.service.reopenPreview(f.tx,financeActor,f.plan.id),command={...assetCommand(preview.planRevision),sourceRevision:preview.sourceRevision,previewHash:preview.previewHash,reason:'核对重开'};f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1});
 await assert.rejects(f.serial(tx=>f.service.reopen(tx,financeActor,f.plan.id,command)),assetError('PREVIEW_CHANGED'));assert.equal(f.rows('assetCostPlan')[0].status,'VOIDED');
 f.rows('vehicleDepreciationPolicy')[0].revision++;await assert.rejects(f.serial(tx=>f.service.reopen(tx,financeActor,f.plan.id,command)),assetError('REVISION_CONFLICT'));
 f.rows('assetCostPlan')[0].sourceSnapshot.request.manualPeriods[0].reason='篡改原始理由';await assert.rejects(f.service.reopenPreview(f.tx,financeActor,f.plan.id),assetError('COST_SOURCE_MISMATCH'));
});

test('reopen preview is registered as a GET on the plan resource',()=>{
 const method=AssetCostPlansController.prototype.reopenPreview;assert.equal(typeof method,'function');assert.equal(Reflect.getMetadata('path',method),':id/reopen-preview');assert.equal(Reflect.getMetadata('method',method),0);
});
