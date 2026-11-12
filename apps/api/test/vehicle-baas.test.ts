import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BaasService} from '../src/vehicle-baas/service';
import {AssetCostPlansService} from '../src/asset-costs/plans';
import {assetActor,assetCommand,assetError,assetFixture,assetNow,financeActor,prepareBaasRegistration} from './asset-ledger-fixture';

export const baasDraft=()=>({...assetCommand(),vehicleId:'vehicle',vehicleRevision:3,assetRevision:1,provider:'合成服务商',contractNumber:'synthetic',batteryPackage:'合成电池包',effectiveFrom:'2027-01-15',effectiveTo:'2027-12-15',billingCycle:'QUARTERLY',rentalAmount:300000,paymentDayOfMonth:31});
export async function activeBaas(){const f=assetFixture(),service=new BaasService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'BAAS'});const draft=await f.serial(tx=>service.create(tx,assetActor,baasDraft()));f.attach('BAAS',draft.id);prepareBaasRegistration(f,draft.id);Object.assign(f.rows('vehicleBaasContract')[0],{status:'ACTIVE',activatedAt:assetNow,revision:1});return{...f,service,contract:await service.detail(f.tx,assetActor,draft.id)};}

test('BAAS draft commands protect revisions and original fields, with current authorization before replay',async()=>{
 const f=assetFixture(),service=new BaasService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'UNKNOWN'});const body=baasDraft(),created=await f.serial(tx=>service.create(tx,assetActor,body));assert.equal(created.status,'DRAFT');assert.equal(created.rentalAmount,300000);const count=f.writes.length;assert.deepEqual(await f.serial(tx=>service.create(tx,assetActor,body)),created);assert.equal(f.writes.length,count);
 const updated=await f.serial(tx=>service.update(tx,assetActor,created.id,{...assetCommand(created.revision),notes:'草稿补注'}));assert.equal(updated.effectiveFrom,'2027-01-15');assert.equal(updated.rentalAmount,300000);assert.notEqual(updated.termsHash,created.termsHash);
 await assert.rejects(f.serial(tx=>service.update(tx,assetActor,created.id,{...assetCommand(created.revision),rentalAmount:1})),assetError('REVISION_CONFLICT'));
 f.revoke(assetActor.id);await assert.rejects(f.serial(tx=>service.create(tx,assetActor,body)),assetError('STAFF_SESSION_CHANGED'));assert.equal(f.rows('assetCostPlan').length,0);assert.equal(f.rows('assetCostEntry').length,0);
});

test('activation requires BAAS ownership, real bound evidence and only one active contract; corrections require an explanation',async()=>{
 const f=assetFixture(),service=new BaasService(()=>assetNow);f.seed('vehicleAssetProfile',{vehicleId:'vehicle',revision:1,batteryOwnership:'OWNED'});const draft=await f.serial(tx=>service.create(tx,assetActor,baasDraft()));
 prepareBaasRegistration(f,draft.id,true);f.attach('BAAS',draft.id);
 await assert.rejects(f.serial(tx=>service.transition(tx,assetActor,draft.id,'activate',{...assetCommand(),reason:'不能启用'})),assetError('BAAS_BATTERY_REQUIRED'));
 f.rows('vehicleAssetProfile')[0].batteryOwnership='BAAS';f.rows('assetPrivateFile').splice(0);f.rows('storedFile').splice(0);await assert.rejects(f.serial(tx=>service.transition(tx,assetActor,draft.id,'activate',{...assetCommand(),reason:'缺证据'})));
 f.attach('BAAS',draft.id);const active=await f.serial(tx=>service.transition(tx,assetActor,draft.id,'activate',{...assetCommand(),reason:'已核对'}));assert.equal(active.status,'ACTIVE');
 await assert.rejects(f.serial(tx=>service.update(tx,assetActor,draft.id,{...assetCommand(active.revision),rentalAmount:1})),assetError('BAAS_CHANGE_REASON_REQUIRED'));
 const other=await f.serial(tx=>service.create(tx,assetActor,{...baasDraft(),contractNumber:'second'}));prepareBaasRegistration(f,other.id,true);f.attach('BAAS',other.id,'second-evidence');await assert.rejects(f.serial(tx=>service.transition(tx,assetActor,other.id,'activate',{...assetCommand(),reason:'重复启用'})),assetError('BAAS_ACTIVE_CONFLICT'));
});

test('BAAS preview is read-only and binds all state; generation verifies warnings/hash and skips existing even voided plans',async()=>{
 const f=await activeBaas(),query={fromPeriod:'2027-01',toPeriod:'2027-04'},count=f.writes.length;
 const preview=await f.service.preview(f.tx,assetActor,f.contract.id,query);assert.equal(f.writes.length,count);assert.equal(f.rows('vehicleBaasContract')[0].firstCostPeriod,null);assert.equal(preview.rows.length,2);assert.equal(preview.totalAmount,600000);assert.deepEqual(preview.warningIds,['2027-01:OUTSIDE_CONTRACT_START']);
 const command={...assetCommand(f.contract.revision),...query,previewHash:preview.previewHash,acknowledgedWarningIds:[]};await assert.rejects(f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,command)),assetError('WARNINGS_NOT_ACKNOWLEDGED'));
 const made=await f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...command,acknowledgedWarningIds:preview.warningIds}));assert.equal(made.created.length,2);assert.equal(made.totalCreatedAmount,600000);assert.equal(f.rows('vehicleBaasContract')[0].firstCostPeriod,'2027-01');assert.equal(f.rows('assetCostEntry').length,0);
 const replayWrites=f.writes.length;assert.deepEqual(await f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...command,acknowledgedWarningIds:preview.warningIds})),made);assert.equal(f.writes.length,replayWrites);
 f.rows('assetCostPlan')[0].status='VOIDED';f.rows('assetCostPlan')[0].revision++;
 const fresh=await f.service.preview(f.tx,assetActor,f.contract.id,query);assert.notEqual(fresh.previewHash,preview.previewHash);assert.equal(fresh.rows[0].existingPlan.status,'VOIDED');
 await assert.rejects(f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...command,...assetCommand(made.revision),acknowledgedWarningIds:preview.warningIds})),assetError('PREVIEW_CHANGED'));
 const skipped=await f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...command,...assetCommand(made.revision),previewHash:fresh.previewHash,acknowledgedWarningIds:fresh.warningIds}));assert.equal(skipped.created.length,0);assert.equal(skipped.existing.length,2);assert.equal(f.rows('assetCostPlan').length,2);
});

test('BAAS anchor cannot shift and another contract cannot overlap effective plans',async()=>{
 const f=await activeBaas(),query={fromPeriod:'2027-01',toPeriod:'2027-01'},preview=await f.service.preview(f.tx,assetActor,f.contract.id,query);await f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...assetCommand(f.contract.revision),...query,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));
 await assert.rejects(f.service.preview(f.tx,assetActor,f.contract.id,{fromPeriod:'2027-02',toPeriod:'2027-02'}),assetError('BAAS_PERIOD_PHASE'));
 const original=f.rows('vehicleBaasContract')[0];await f.serial(tx=>f.service.transition(tx,assetActor,original.id,'suspend',{...assetCommand(original.revision),reason:'暂停但计划保留'}));
 const next=await f.serial(tx=>f.service.create(tx,assetActor,{...baasDraft(),contractNumber:'successor',previousContractId:original.id}));f.attach('BAAS',next.id,'successor-evidence');prepareBaasRegistration(f,next.id);Object.assign(f.rows('vehicleBaasContract')[1],{status:'ACTIVE',activatedAt:assetNow,revision:1});const active=await f.service.detail(f.tx,assetActor,next.id);
 const nextPreview=await f.service.preview(f.tx,assetActor,next.id,query);await assert.rejects(f.serial(tx=>f.service.generate(tx,assetActor,next.id,{...assetCommand(active.revision),...query,previewHash:nextPreview.previewHash,acknowledgedWarningIds:nextPreview.warningIds})),assetError('COST_PERIOD_OVERLAP'));
});

test('terminated history remains readable, cannot generate new plans, and finance cannot mutate BAAS',async()=>{
 const f=await activeBaas();const suspended=await f.serial(tx=>f.service.transition(tx,assetActor,f.contract.id,'suspend',{...assetCommand(f.contract.revision),reason:'暂停'}));
 assert.equal((await f.service.preview(f.tx,assetActor,f.contract.id,{fromPeriod:'2027-01',toPeriod:'2027-01'})).rows.length,1);
 await assert.rejects(f.serial(tx=>f.service.transition(tx,assetActor,f.contract.id,'resume',{...assetCommand(suspended.revision),reason:'旧季度合同不默默换月价'})),assetError('BAAS_REGISTRATION_INCOMPLETE'));const ended=await f.serial(tx=>f.service.transition(tx,assetActor,f.contract.id,'terminate',{...assetCommand(suspended.revision),reason:'实际终止'}));
 assert.equal((await f.service.detail(f.tx,financeActor,ended.id)).status,'TERMINATED');await assert.rejects(f.service.preview(f.tx,assetActor,ended.id,{fromPeriod:'2027-01',toPeriod:'2027-01'}),assetError('BAAS_STATE'));
 await assert.rejects(f.serial(tx=>f.service.transition(tx,financeActor,ended.id,'archive',{...assetCommand(ended.revision),reason:'越权'})),assetError('FORBIDDEN'));
 assert.equal(f.rows('assetCostEntry').length,0);assert.equal(f.rows('assetManualPaymentRecord').length,0);
});

test('plan void/reopen preserves source amount and requires fresh source/plan preview before a formerly voided plan can return',async()=>{
 const f=await activeBaas(),plans=new AssetCostPlansService(()=>assetNow),query={fromPeriod:'2027-01',toPeriod:'2027-01'},preview=await f.service.preview(f.tx,assetActor,f.contract.id,query),generated=await f.serial(tx=>f.service.generate(tx,assetActor,f.contract.id,{...assetCommand(f.contract.revision),...query,previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds}));
 const plan=generated.created[0],voided=await f.serial(tx=>plans.void(tx,assetActor,plan.id,{...assetCommand(plan.revision),reason:'撤销错误计划'})),fresh=await f.service.preview(f.tx,assetActor,f.contract.id,query);
 await assert.rejects(f.serial(tx=>plans.reopen(tx,assetActor,plan.id,{...assetCommand(voided.revision),sourceRevision:generated.revision,previewHash:preview.previewHash,reason:'过期预览'})),assetError('PREVIEW_CHANGED'));
 const reopened=await f.serial(tx=>plans.reopen(tx,assetActor,plan.id,{...assetCommand(voided.revision),sourceRevision:generated.revision,previewHash:fresh.previewHash,reason:'重新核对原合同'}));assert.equal(reopened.status,'SCHEDULED');assert.equal(reopened.amount,300000);assert.equal(f.rows('assetCostPlan').length,1);
});
